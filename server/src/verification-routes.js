const express = require('express');
const Stripe = require('stripe');
const { auth } = require('./middleware');

// Automatic identity checks (Stripe Identity), Companies House company checks and right-to-work share codes.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const CH_BASE = (process.env.COMPANIES_HOUSE_BASE_URL || 'https://api.company-information.service.gov.uk').replace(/\/$/, '');
const STATUS_MAP = { verified: 'verified', processing: 'pending', requires_input: 'rejected', canceled: 'not_started', redacted: 'not_started' };

const norm = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const companyName = s => norm(s).replace(/\b(LIMITED|LTD|PLC|LLP|THE|COMPANY|CO)\b/g, '').replace(/\s+/g, '');

async function companiesHouse(path) {
  const r = await fetch(CH_BASE + path, { headers: { Authorization: 'Basic ' + Buffer.from(process.env.COMPANIES_HOUSE_API_KEY + ':').toString('base64'), Accept: 'application/json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error('Companies House request failed (' + r.status + ')'), { status: r.status });
  return r.json();
}

// Returns {status, reason, details}. Never throws for business mismatches; only for service errors.
async function checkCompany({ companyNumber, businessName, firstName, lastName, postcode }) {
  if (!process.env.COMPANIES_HOUSE_API_KEY) return { status: 'pending', reason: 'Automatic Companies House checks are not set up yet. An admin will review your company.' };
  const number = String(companyNumber || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(number)) return { status: 'manual_review', reason: 'No valid 8-character company number was given, so an admin will review your business.' };
  const profile = await companiesHouse('/company/' + number);
  if (!profile) return { status: 'rejected', reason: `Company number ${number} was not found at Companies House.` };
  const officers = [];
  for (let start = 0; start < 2000;) {
    const page = await companiesHouse(`/company/${number}/officers?items_per_page=100&start_index=${start}`);
    const items = page?.items || [];
    officers.push(...items);
    if (!items.length || officers.length >= (page.total_results ?? officers.length)) break;
    start += items.length;
  }
  const first = norm(firstName).split(' ')[0], last = norm(lastName).split(' ').pop();
  const officer = officers.find(o => !o.resigned_on && (() => { const n = norm(o.name); return n.includes(last) && n.split(' ').includes(first); })());
  const details = {
    companyNumber: number, registeredName: profile.company_name, companyStatus: profile.company_status,
    nameMatches: companyName(profile.company_name) === companyName(businessName),
    postcodeMatches: norm(profile.registered_office_address?.postal_code).replace(/ /g, '') === norm(postcode).replace(/ /g, ''),
    officerMatch: officer ? { name: officer.name, role: officer.officer_role } : null, checkedAt: new Date().toISOString()
  };
  if (profile.company_status !== 'active') return { status: 'rejected', reason: `${profile.company_name} is listed as "${profile.company_status}" at Companies House, not active.`, details };
  if (!details.nameMatches) return { status: 'manual_review', reason: `The business name you entered does not match the registered name "${profile.company_name}". An admin will review it.`, details };
  if (!officer) return { status: 'manual_review', reason: `${firstName} ${lastName} is not listed as a current officer of ${profile.company_name}. An admin will confirm you are authorised to act for the company.`, details };
  return { status: 'verified', reason: `Confirmed with Companies House: ${profile.company_name} is active and ${officer.name} is a current ${String(officer.officer_role || 'officer').replace(/-/g, ' ')}.`, details };
}

module.exports = function registerVerificationRoutes(app, { db, asyncRoute, audit, addColumn, createTable }) {
  const ready = (async () => {
    await createTable(`CREATE TABLE IF NOT EXISTS identity_verifications (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,stripe_session_id VARCHAR(255) NOT NULL UNIQUE,status VARCHAR(32) NOT NULL,last_error_code VARCHAR(100) NULL,last_error_reason TEXT NULL,verified_at DATETIME NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,KEY idx_identity_user(user_id))`, 'identity verifications');
    await createTable(`CREATE TABLE IF NOT EXISTS stripe_webhook_events (event_id VARCHAR(255) PRIMARY KEY,event_type VARCHAR(255) NOT NULL,received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'stripe webhook events');
    await addColumn('businesses', 'company_check_reason TEXT NULL', 'company check reason');
    await addColumn('businesses', 'company_check_details JSON NULL', 'company check details');
    await addColumn('worker_profiles', 'rtw_share_code VARCHAR(16) NULL', 'right to work share code');
    await addColumn('worker_profiles', 'rtw_date_of_birth DATE NULL', 'right to work date of birth');
    await addColumn('worker_profiles', 'rtw_submitted_at DATETIME NULL', 'right to work submitted at');
  })();

  async function applySession(session) {
    const status = STATUS_MAP[session.status] || 'pending';
    await db.execute(`UPDATE identity_verifications SET status=?,last_error_code=?,last_error_reason=?,verified_at=IF(?='verified',COALESCE(verified_at,UTC_TIMESTAMP()),verified_at) WHERE stripe_session_id=?`,
      [session.status, session.last_error?.code || null, session.last_error?.reason || null, session.status, session.id]);
    const [[row]] = await db.execute('SELECT v.user_id,u.role FROM identity_verifications v JOIN users u ON u.id=v.user_id WHERE v.stripe_session_id=?', [session.id]);
    if (!row) return status;
    const [[latest]] = await db.execute('SELECT stripe_session_id FROM identity_verifications WHERE user_id=? ORDER BY id DESC LIMIT 1', [row.user_id]);
    if (latest.stripe_session_id !== session.id) return status;
    if (row.role === 'worker') await db.execute("UPDATE worker_profiles SET identity_verification_status=? WHERE user_id=? AND identity_verification_status<>'verified'", [status, row.user_id]);
    if (row.role === 'employer') await db.execute("UPDATE businesses SET identity_verification_status=? WHERE owner_user_id=? AND identity_verification_status<>'verified'", [status, row.user_id]);
    return status;
  }

  app.post('/api/stripe/identity-webhook', express.raw({ type: 'application/json' }), asyncRoute(async (req, res) => {
    if (!stripe || !process.env.STRIPE_IDENTITY_WEBHOOK_SECRET) return res.status(503).send('not configured');
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_IDENTITY_WEBHOOK_SECRET); }
    catch { return res.status(400).send('invalid signature'); }
    await ready;
    const [ins] = await db.execute('INSERT IGNORE INTO stripe_webhook_events(event_id,event_type) VALUES(?,?)', [event.id, event.type]);
    if (ins.affectedRows && event.type.startsWith('identity.verification_session.')) await applySession(event.data.object);
    res.sendStatus(200);
  }));

  const nonAdmin = (req, res, next) => ['worker', 'employer'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Worker and employer accounts only.' });

  app.post('/api/verification/identity/session', auth, nonAdmin, asyncRoute(async (req, res) => {
    if (!req.user.email_verified_at) return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', error: 'Please verify your email address first.' });
    if (!stripe) return res.status(503).json({ error: 'Automatic ID checks are not switched on yet. Please try again later or contact hyrz support.' });
    await ready;
    const [[open]] = await db.execute("SELECT stripe_session_id FROM identity_verifications WHERE user_id=? AND status='requires_input' AND last_error_code IS NULL ORDER BY id DESC LIMIT 1", [req.user.id]);
    if (open) {
      const old = await stripe.identity.verificationSessions.retrieve(open.stripe_session_id);
      if (old.status === 'requires_input' && old.url) return res.json({ url: old.url, status: old.status });
    }
    const returnUrl = new URL('/', process.env.APP_URL); returnUrl.searchParams.set('identity-return', '1');
    const session = await stripe.identity.verificationSessions.create({
      type: 'document', return_url: returnUrl.toString(),
      options: { document: { require_matching_selfie: true, require_live_capture: true, allowed_types: ['passport', 'driving_license', 'id_card'] } },
      metadata: { hyrz_user_id: String(req.user.id), role: req.user.role }
    });
    await db.execute('INSERT INTO identity_verifications(user_id,stripe_session_id,status) VALUES(?,?,?)', [req.user.id, session.id, session.status]);
    await audit(req, 'identity.session_created', 'user', req.user.id, {});
    res.status(201).json({ url: session.url, status: session.status });
  }));

  app.get('/api/verification/identity/status', auth, nonAdmin, asyncRoute(async (req, res) => {
    await ready;
    const [[row]] = await db.execute('SELECT stripe_session_id,status,last_error_reason FROM identity_verifications WHERE user_id=? ORDER BY id DESC LIMIT 1', [req.user.id]);
    if (!row) return res.json({ status: 'not_started', configured: Boolean(stripe) });
    let status = STATUS_MAP[row.status] || 'pending', reason = row.last_error_reason;
    if (stripe && !['verified', 'canceled', 'redacted'].includes(row.status)) {
      const session = await stripe.identity.verificationSessions.retrieve(row.stripe_session_id);
      status = await applySession(session); reason = session.last_error?.reason || null;
    }
    res.json({ status, reason, configured: Boolean(stripe) });
  }));

  app.get('/api/verification/details', auth, nonAdmin, asyncRoute(async (req, res) => {
    await ready;
    if (req.user.role === 'worker') {
      const [[w]] = await db.execute('SELECT rtw_share_code,rtw_submitted_at FROM worker_profiles WHERE user_id=?', [req.user.id]);
      return res.json({ identityConfigured: Boolean(stripe), rightToWork: { shareCodeSubmitted: Boolean(w?.rtw_share_code), submittedAt: w?.rtw_submitted_at || null } });
    }
    const [[b]] = await db.execute('SELECT company_number,company_check_reason FROM businesses WHERE owner_user_id=?', [req.user.id]);
    res.json({ identityConfigured: Boolean(stripe), companyCheckConfigured: Boolean(process.env.COMPANIES_HOUSE_API_KEY), company: { companyNumber: b?.company_number || null, reason: b?.company_check_reason || null } });
  }));

  app.post('/api/verification/right-to-work', auth, nonAdmin, asyncRoute(async (req, res) => {
    if (req.user.role !== 'worker') return res.status(403).json({ error: 'Worker accounts only.' });
    await ready;
    const citizen = req.body?.britishOrIrish === true;
    const code = citizen ? 'BRITISH_IRISH' : String(req.body?.shareCode || '').replace(/[\s-]/g, '').toUpperCase();
    const dob = String(req.body?.dateOfBirth || '');
    if (!citizen && !/^[A-Z0-9]{9}$/.test(code)) return res.status(400).json({ error: 'Enter your 9-character Home Office share code (for example W12 345 67A).' });
    const d = new Date(dob + 'T00:00:00Z');
    const age = (Date.now() - d.getTime()) / (365.25 * 86400000);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(d.getTime()) || age < 16 || age > 100) return res.status(400).json({ error: 'Enter a valid date of birth. You must be at least 16.' });
    await db.execute("UPDATE worker_profiles SET rtw_share_code=?,rtw_date_of_birth=?,rtw_submitted_at=UTC_TIMESTAMP(),right_to_work_status=IF(right_to_work_status='verified','verified','pending') WHERE user_id=?", [code, dob, req.user.id]);
    await audit(req, 'right_to_work.share_code_submitted', 'user', req.user.id, {});
    res.json({ status: 'pending', message: 'Share code received. A hyrz admin will check it with the Home Office, usually within one working day.' });
  }));

  async function runCompanyCheck(userId) {
    await ready;
    const [[b]] = await db.execute('SELECT b.id,b.name,b.company_number,b.postcode,b.verification_status,u.first_name,u.last_name FROM businesses b JOIN users u ON u.id=b.owner_user_id WHERE b.owner_user_id=?', [userId]);
    if (!b || b.verification_status === 'verified') return b ? { status: 'verified' } : null;
    const result = await checkCompany({ companyNumber: b.company_number, businessName: b.name, firstName: b.first_name, lastName: b.last_name, postcode: b.postcode });
    await db.execute('UPDATE businesses SET verification_status=?,company_check_reason=?,company_check_details=? WHERE id=?', [result.status, result.reason, result.details ? JSON.stringify(result.details) : null, b.id]);
    return result;
  }

  app.post('/api/verification/company/check', auth, nonAdmin, asyncRoute(async (req, res) => {
    if (req.user.role !== 'employer') return res.status(403).json({ error: 'Employer accounts only.' });
    try { res.json(await runCompanyCheck(req.user.id)); }
    catch (e) { res.status(502).json({ error: 'Companies House could not be reached. Please try again in a few minutes.' }); }
  }));

  app.get('/api/admin/verification/:userId/evidence', auth, (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' }), asyncRoute(async (req, res) => {
    await ready;
    const [[w]] = await db.execute('SELECT rtw_share_code,rtw_date_of_birth,rtw_submitted_at FROM worker_profiles WHERE user_id=?', [req.params.userId]);
    const [[b]] = await db.execute('SELECT company_check_reason,company_check_details FROM businesses WHERE owner_user_id=?', [req.params.userId]);
    const [ids] = await db.execute('SELECT status,last_error_reason,verified_at,created_at FROM identity_verifications WHERE user_id=? ORDER BY id DESC LIMIT 5', [req.params.userId]);
    res.json({ rightToWork: w ? { shareCode: w.rtw_share_code, dateOfBirth: w.rtw_date_of_birth, submittedAt: w.rtw_submitted_at, checkUrl: 'https://www.gov.uk/view-right-to-work' } : null, company: b ? { reason: b.company_check_reason, details: b.company_check_details } : null, identityChecks: ids });
  }));

  return { runCompanyCheck };
};

module.exports.checkCompany = checkCompany;
