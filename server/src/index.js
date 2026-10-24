require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { auth, allow, adminTier, requireVerification } = require('./middleware');
const { calculatePay } = require('./pricing');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { hashIdentifier } = require('./identifier-hash');
const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const app = express();
app.use(helmet());

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
}));

app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, limit: 100 }));
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
// Run schema changes one at a time: concurrent ALTER TABLE statements were deadlocking at startup.
let schemaQueue = Promise.resolve();
function enqueueSchemaChange(task, label) {
  const runWithRetry = async () => {
    let lastError;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        const transientLockError = error && (
          error.code === 'ER_LOCK_DEADLOCK' ||
          error.code === 'ER_LOCK_WAIT_TIMEOUT' ||
          error.errno === 1213 ||
          error.errno === 1205
        );
        if (!transientLockError || attempt === 5) throw error;
        const delayMs = attempt * 500;
        console.warn('Retrying schema change "' + label + '" after database lock conflict (' + attempt + '/5).');
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  };
  const result = schemaQueue.then(runWithRetry);
  schemaQueue = result.catch(error => {
    console.error('Could not initialise ' + label + ':', error.message);
  });
  return result;
}
function addColumn(table, definition, label) {
  return enqueueSchemaChange(async () => {
    // Avoid acquiring a metadata lock on every server start when the column
    // already exists. This is especially important for larger tables such as users.
    const column = String(definition).trim().split(/\s+/, 1)[0];
    const [existing] = await db.query('SHOW COLUMNS FROM ' + table + ' LIKE ?', [column]);
    if (existing.length) return;
    try { await db.query('ALTER TABLE ' + table + ' ADD COLUMN ' + definition); }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
  }, label);
}
function createTable(sql, label) {
  return enqueueSchemaChange(async () => { await db.query(sql); }, label);
}
const ensureProfilePictureColumn = addColumn('users','profile_picture LONGTEXT NULL','profile pictures');
const ensurePublicUserIdColumn = addColumn('users','public_user_id VARCHAR(24) NULL','unique public user IDs');
const ensurePublicUserIds = enqueueSchemaChange(async()=>{await db.execute("UPDATE users SET public_user_id=CONCAT('HYRZ-',LPAD(id,8,'0')) WHERE public_user_id IS NULL OR public_user_id=''");try{await db.query('ALTER TABLE users ADD UNIQUE KEY uq_users_public_user_id (public_user_id)');}catch(error){if(error.code!=='ER_DUP_KEYNAME'&&error.code!=='ER_DUP_FIELDNAME')throw error;}},'backfill unique public user IDs');
const ensureSignupTermsColumns = (async()=>{await addColumn('users','terms_accepted_at DATETIME NULL','signup terms acceptance timestamp');await addColumn('users',"terms_version VARCHAR(40) NULL",'signup terms version');})();
const ensureShiftContractColumns = (async()=>{await addColumn('applications','contract_accepted_at DATETIME NULL','shift contract acceptance timestamp');await addColumn('applications','contract_snapshot LONGTEXT NULL','accepted shift contract snapshot');})();
const ensureShiftPublishingColumns = (async()=>{await addColumn('shifts',"shift_type VARCHAR(80) NOT NULL DEFAULT 'hospitality'",'shift type');await addColumn('shifts','requirements JSON NULL','shift requirements');await addColumn('shifts','perks JSON NULL','shift perks');await addColumn('shifts','preferences JSON NULL','shift preferences');})();
const ensureApplicationCancellationFee = addColumn('applications','cancellation_fee DECIMAL(10,2) NOT NULL DEFAULT 0','application cancellation fee');
const ensureApplicationPreferencesColumn = addColumn('applications','confirmed_preferences JSON NULL','confirmed applicant preferences');
const ensureUserAddressColumns = (async()=>{
  await addColumn('users','address_line_1 VARCHAR(255) NULL','user address line');
  await addColumn('users','address_city VARCHAR(120) NULL','user address city');
  await addColumn('users','address_postcode VARCHAR(20) NULL','user address postcode');
})();
const ensureWorkerPhoneVisibilityColumn = addColumn('users','phone_visible_to_employers TINYINT(1) NOT NULL DEFAULT 0','worker phone visibility preference');
const adminLoginNamesReady = createTable(`CREATE TABLE IF NOT EXISTS admin_login_names (user_id BIGINT UNSIGNED PRIMARY KEY, username VARCHAR(80) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,'administrator usernames');
const ensureUniqueEmails = enqueueSchemaChange(async () => {
  const [duplicates] = await db.query("SELECT LOWER(TRIM(email)) AS normalized_email, COUNT(*) AS account_count FROM users GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1 LIMIT 1");
  if (duplicates.length) {
    console.error('Email uniqueness migration paused: existing accounts share an email address after normalization. Resolve duplicates before enabling the database constraint.');
    return false;
  }
  await db.query('UPDATE users SET email=LOWER(TRIM(email)) WHERE email<>LOWER(TRIM(email))');
  try { await db.query("ALTER TABLE users ADD COLUMN email_normalized VARCHAR(254) GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED"); }
  catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
  try { await db.query('ALTER TABLE users ADD UNIQUE KEY uq_users_email_normalized (email_normalized)'); }
  catch (error) { if (error.code !== 'ER_DUP_KEYNAME') throw error; }
  return true;
},'case-insensitive email uniqueness');
const ensureBusinessAddressColumns = (async()=>{
  await addColumn('businesses','address_line_1 VARCHAR(255) NULL','business address line');
  await addColumn('businesses','city VARCHAR(120) NULL','business city');
})();
const ensureBlockedIdentifiers = createTable(`CREATE TABLE IF NOT EXISTS blocked_identifiers (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, identifier_type ENUM('company_number','national_insurance','worker_permit') NOT NULL, identifier_hash CHAR(64) NOT NULL, blocked_user_id BIGINT UNSIGNED NULL, created_by BIGINT UNSIGNED NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_blocked_identifier(identifier_type,identifier_hash), FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE SET NULL, FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL)`,'blocked identifiers');
const ensureApplicationRateNegotiation = (async()=>{await addColumn('applications','requested_hourly_rate DECIMAL(8,2) NULL','application requested hourly rate');await addColumn('applications','rate_message TEXT NULL','application rate message');await addColumn('applications','rate_decision VARCHAR(20) NULL','application rate decision');await addColumn('applications','negotiated_hourly_rate DECIMAL(8,2) NULL','application negotiated hourly rate');})();
const ensureCheckoutCounterColumns = (async()=>{
  await addColumn('checkouts','employer_comment TEXT NULL','checkout employer comment');
  await addColumn('checkouts','counter_start DATETIME NULL','checkout counter start');
  await addColumn('checkouts','counter_end DATETIME NULL','checkout counter end');
  await addColumn('checkouts','counter_break_minutes INT NULL','checkout counter break');
  await addColumn('checkouts','counter_gross_pay DECIMAL(10,2) NULL','checkout counter gross pay');
})();
const ensureClockCheckoutColumns = (async()=>{
  await addColumn('checkouts','clocked_in_at DATETIME NULL','checkout clock-in time');
  await addColumn('checkouts','clocked_out_at DATETIME NULL','checkout clock-out time');
  await addColumn('checkouts','worker_adjustment_reason TEXT NULL','checkout worker time adjustment reason');
  await addColumn('checkouts','is_test TINYINT(1) NOT NULL DEFAULT 0','test checkout marker');
})();
const ensureWorkerAvailabilityTable = (async()=>{await createTable(`CREATE TABLE IF NOT EXISTS worker_availability (user_id BIGINT UNSIGNED PRIMARY KEY, timings JSON NOT NULL, min_hourly_rate DECIMAL(8,2) NOT NULL DEFAULT 8.00, min_total_pay DECIMAL(8,2) NOT NULL DEFAULT 20.00, max_distance INT NOT NULL DEFAULT 10, roles JSON NOT NULL, shift_types JSON NOT NULL, automatic_enabled TINYINT(1) NOT NULL DEFAULT 0, employer_mode VARCHAR(20) NOT NULL DEFAULT 'all', preferred_employer_ids JSON NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,'worker availability');await addColumn('worker_availability',"employer_mode VARCHAR(20) NOT NULL DEFAULT 'all'",'worker availability employer mode');await addColumn('worker_availability','preferred_employer_ids JSON NULL','worker availability preferred employers');})();
const ensureWorkerIdentifierColumns = (async()=>{
  await addColumn('worker_profiles','national_insurance_hash CHAR(64) NULL','worker National Insurance hash');
  await addColumn('worker_profiles','worker_permit_hash CHAR(64) NULL','worker permit hash');
})();
const audit = async (req, action, entityType, entityId, details={}) => {
  await db.execute('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details,ip_address) VALUES(?,?,?,?,?,?)',
    [req.user?.id || null, action, entityType, entityId || null, JSON.stringify(details), req.ip]);
};
app.get('/api/health', asyncRoute(async(req,res)=>{ await db.query('SELECT 1'); res.json({ok:true,service:'hyrz-api'}); }));


async function sendInvoiceReminder(invoice) {
  if (!resend) throw new Error('Invoice email service is not configured');
  const result=await resend.emails.send({
    from:process.env.EMAIL_FROM,
    to:invoice.client_email,
    subject:'hyrz invoice reminder #'+invoice.id,
    html:'<p>Hello '+String(invoice.client_first_name||'there').replace(/[&<>"]/g,'')+',</p>'+
      '<p>This is a reminder for hyrz invoice #'+invoice.id+'.</p>'+
      '<p>Business: '+String(invoice.business_name||'').replace(/[&<>"]/g,'')+'</p>'+
      '<p>Shift: '+String(invoice.shift_title||'').replace(/[&<>"]/g,'')+'</p>'+
      '<p>Amount due: £'+Number(invoice.total).toFixed(2)+'</p>'+
      '<p>Due date: '+String(invoice.due_at).slice(0,10)+'</p>'+
      '<p>Please contact hyrz support if you believe this reminder is incorrect.</p>'
  });
  if(result.error) throw new Error(result.error.message||'Invoice reminder email failed');
}
async function sendVerificationEmail(email, rawToken) {
  if (!resend) throw new Error('Email service is not configured');

  const link = new URL('/', process.env.APP_URL);
  link.searchParams.set('verify-email', rawToken);

  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Verify your hyrz email address',
    html: '<p>Welcome to hyrz.</p>' +
      '<p>Verify your email address to activate your account.</p>' +
      '<p><a href="' + link.toString() + '">Verify my email</a></p>' +
      '<p>This link expires in 30 minutes. If you did not create this account, you can ignore this email.</p>'
  });

  if (result.error) {
    console.error('Resend email error:', result.error.message);
    throw new Error('Could not send verification email');
  }
}

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const {
    email, password, role = 'worker', firstName = '', lastName = '',
    businessName, companyNumber, companyRole, postcode, businessAddress, businessCity, nationalInsuranceNumber, workerPermitNumber, confirmPassword
  } = req.body;

  if (req.body?.termsAccepted !== true || req.body?.termsVersion !== '2026-10-19') return res.status(400).json({error:'You must agree to the current Hyrz Terms & Conditions before creating an account.'});

  if (!email || !/^\S+@\S+\.\S+$/.test(email) ||
      typeof password !== 'string' || password.length < 12) {
    return res.status(400).json({
      error: 'Valid email and password of at least 12 characters required'
    });
  }

  if (typeof confirmPassword !== 'string' || password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  if (!['worker', 'employer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid registration role' });
  }

  if (role === 'employer' && (!businessName || !String(firstName || '').trim() || !String(lastName || '').trim() || !String(companyRole || '').trim() || !String(businessAddress || '').trim() || !String(businessCity || '').trim() || !String(postcode || '').trim())) {
    return res.status(400).json({
      error: 'Business name, owner/contact name, business address, city, postcode and your role at the company are required'
    });
  }

  if (role === 'worker' && !String(nationalInsuranceNumber||'').trim() && !String(workerPermitNumber||'').trim()) return res.status(400).json({error:'A National Insurance number or worker permit number is required for account security checks.'});

  const normalizedEmail = email.toLowerCase().trim();
  const emailConstraintReady = await ensureUniqueEmails;
  if (!emailConstraintReady) return res.status(503).json({error:'Account creation is temporarily unavailable while duplicate email addresses are reviewed.'});
  const [existingEmail] = await db.execute('SELECT id FROM users WHERE LOWER(TRIM(email))=? LIMIT 1',[normalizedEmail]);
  if (existingEmail.length) return res.status(409).json({error:'This email address is already linked to an account. Please sign in or use a different email address.'});
  if (role === 'worker') {
    await ensureBlockedIdentifiers;
    await ensureWorkerIdentifierColumns;
    for (const [type,raw] of [['national_insurance',nationalInsuranceNumber],['worker_permit',workerPermitNumber]]) {
      const normalized=String(raw||'').replace(/\\s+/g,'').toUpperCase();
      if (!normalized) continue;
      const hash=hashIdentifier(normalized);
      const [blocked]=await db.execute('SELECT id FROM blocked_identifiers WHERE identifier_type=? AND identifier_hash=? LIMIT 1',[type,hash]).catch(error=>{if(error.code==='ER_NO_SUCH_TABLE')return [[]];throw error;});
      if (blocked.length) return res.status(403).json({error:'These worker identity details cannot be used to create a hyrz account. Please contact support if you believe this is an error.'});
    }
  }
  if (role === 'employer' && companyNumber) {
    await ensureBlockedIdentifiers;
    const normalizedCompanyNumber=String(companyNumber).replace(/\s+/g,'').toUpperCase();
    const [blocked]=await db.execute("SELECT id FROM blocked_identifiers WHERE identifier_type='company_number' AND identifier_hash=? LIMIT 1",[hashIdentifier(normalizedCompanyNumber)]).catch(error=>{if(error.code==='ER_NO_SUCH_TABLE')return [[]];throw error;});
    if (blocked.length) return res.status(403).json({error:'This company registration number cannot be used to create a hyrz account. Please contact support if you believe this is an error.'});
  }
  await ensureSignupTermsColumns;
  await ensurePublicUserIds;
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [result] = await conn.execute(
      'INSERT INTO users (email,password_hash,role,first_name,last_name,email_verification_token_hash,email_verification_expires_at,terms_accepted_at,terms_version,public_user_id) VALUES (?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE),UTC_TIMESTAMP(),?,?)',
      [
        normalizedEmail,
        await bcrypt.hash(password, 12),
        role,
        firstName,
        lastName,
        tokenHash,
        '2026-10-19',
        'PENDING-' + crypto.randomBytes(12).toString('hex').toUpperCase()
      ]
    );

    if (role === 'worker') {
      await conn.execute(
        'INSERT INTO worker_profiles (user_id,national_insurance_hash,worker_permit_hash) VALUES (?,?,?)',
        [result.insertId,
          nationalInsuranceNumber ? hashIdentifier(nationalInsuranceNumber) : null,
          workerPermitNumber ? hashIdentifier(workerPermitNumber) : null]
      );
    } else {
      await ensureBusinessAddressColumns;
      await conn.execute(
        'INSERT INTO businesses (owner_user_id,name,company_number,postcode,role_at_company,address_line_1,city) VALUES (?,?,?,?,?,?,?)',
        [
          result.insertId,
          String(businessName).trim(),
          companyNumber || null,
          String(postcode).trim().toUpperCase(),
          String(companyRole).trim(),
          String(businessAddress).trim(),
          String(businessCity).trim()
        ]
      );
    }

    await conn.execute("UPDATE users SET public_user_id=CONCAT('HYRZ-',LPAD(?,8,'0')) WHERE id=?",[result.insertId,result.insertId]);
    await conn.commit();

    try {
      await sendVerificationEmail(normalizedEmail, rawToken);
    } catch (emailError) {
      console.error('Verification email could not be sent.');
      return res.status(503).json({
        error: 'Your account was created, but the verification email could not be sent. Please request another email.'
      });
    }

    return res.status(201).json({
      message: 'Account created. Check your email for a verification link.',
      email: normalizedEmail,
      userId: 'HYRZ-' + String(result.insertId).padStart(8,'0')
    });
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already registered' });
    }

    throw error;
  } finally {
    conn.release();
  }
}));

app.post('/api/auth/verify-email', asyncRoute(async (req, res) => {
  const rawToken = req.body.token;

  if (typeof rawToken !== 'string' || !/^[a-f0-9]{64}$/i.test(rawToken)) {
    return res.status(400).json({ error: 'Invalid or expired verification link' });
  }

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const [result] = await db.execute(
    'UPDATE users SET email_verified_at=UTC_TIMESTAMP(), email_verification_token_hash=NULL, email_verification_expires_at=NULL WHERE email_verification_token_hash=? AND email_verification_expires_at>UTC_TIMESTAMP() AND email_verified_at IS NULL',
    [tokenHash]
  );

  if (result.affectedRows !== 1) {
    return res.status(400).json({
      error: 'This verification link is invalid, expired, or already used.'
    });
  }

  return res.json({ message: 'Email verified successfully. You can now log in.' });
}));

app.post('/api/auth/resend-verification', asyncRoute(async (req, res) => {
  const genericMessage = 'If the account exists and needs verification, a new email will be sent.';

  const email = String(req.body.email || '').toLowerCase().trim();

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.json({ message: genericMessage });
  }

  const [users] = await db.execute(
    'SELECT id FROM users WHERE email=? AND email_verified_at IS NULL AND status="active"',
    [email]
  );

  if (users.length && resend) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await db.execute(
      'UPDATE users SET email_verification_token_hash=?, email_verification_expires_at=DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE) WHERE id=? AND email_verified_at IS NULL',
      [tokenHash, users[0].id]
    );

    try {
      await sendVerificationEmail(email, rawToken);
        } catch (emailError) {
      console.error(
        'Resending verification email failed:',
        emailError.message
      );
    }
  }

  return res.json({ message: genericMessage });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  await adminLoginNamesReady;
  const identifier = String(req.body.email || req.body.username || '').trim();
  const [rows] = await db.execute(
    `SELECT u.id,u.email,u.password_hash,u.role,u.admin_tier,u.status,u.first_name,u.last_name,u.email_verified_at
     FROM users u LEFT JOIN admin_login_names n ON n.user_id=u.id
     WHERE LOWER(TRIM(u.email))=? OR (u.role='admin' AND n.username=?) LIMIT 1`,
    [identifier.toLowerCase(), identifier]
  );

  if (!rows.length ||
      !(await bcrypt.compare(req.body.password || '', rows[0].password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = rows[0];

  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Account unavailable' });
  }

  if (!user.email_verified_at) {
    return res.status(403).json({
      code: 'EMAIL_NOT_VERIFIED',
      error: 'Please verify your email before logging in.'
    });
  }

  const token = jwt.sign(
    { sub: user.id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      admin_tier: user.admin_tier,
      first_name: user.first_name,
      last_name: user.last_name
    }
  });
}));

app.get('/api/auth/me',auth,asyncRoute(async(req,res)=>{
 await Promise.all([ensureProfilePictureColumn,ensureUserAddressColumns,ensureWorkerPhoneVisibilityColumn]);
 const [u]=await db.execute('SELECT id,email,role,admin_tier,first_name,last_name,phone,phone_visible_to_employers,profile_picture,status,created_at,address_line_1,address_city,address_postcode,email_verified_at FROM users WHERE id=?',[req.user.id]);
 if(u[0]?.role==='worker'){
  await db.query("CREATE TABLE IF NOT EXISTS worker_strikes (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,worker_id BIGINT UNSIGNED NOT NULL,application_id BIGINT UNSIGNED NOT NULL,shift_id BIGINT UNSIGNED NOT NULL,reason VARCHAR(255) NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uniq_worker_strike_application (application_id))");
  const [[strikeCount]]=await db.execute('SELECT COUNT(*) AS strikes FROM worker_strikes WHERE worker_id=?',[req.user.id]);
  u[0].strikes=Math.min(3,Number(strikeCount?.strikes||0));
 }
 res.json({user:u[0]});
}));
app.patch('/api/auth/profile', auth, asyncRoute(async (req, res) => {
 await Promise.all([ensureProfilePictureColumn,ensureUserAddressColumns,ensureWorkerPhoneVisibilityColumn]);
 const firstName = String(req.body.firstName || '').trim();
 const lastName = String(req.body.lastName || '').trim();
 const phone = String(req.body.phone || '').trim();
 const addressLine1 = req.body.addressLine1 === undefined ? undefined : String(req.body.addressLine1 || '').trim();
 const addressCity = req.body.addressCity === undefined ? undefined : String(req.body.addressCity || '').trim();
 const addressPostcode = req.body.addressPostcode === undefined ? undefined : String(req.body.addressPostcode || '').trim().toUpperCase();
 const email = req.body.email === undefined ? undefined : String(req.body.email || '').trim().toLowerCase();
 const profilePicture = req.body.profilePicture === '' ? null : req.body.profilePicture;
 if (profilePicture !== undefined && profilePicture !== null && (typeof profilePicture !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(profilePicture) || profilePicture.length > 550000)) return res.status(400).json({ error: 'Choose a valid profile picture smaller than 400 KB.' });
 if (firstName.length > 100 || lastName.length > 100 || phone.length > 40 || (addressLine1||'').length>255 || (addressCity||'').length>120 || (addressPostcode||'').length>20) return res.status(400).json({ error: 'One or more profile fields are too long.' });
 if(email!==undefined && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)) return res.status(400).json({error:'Enter a valid email address.'});
 if(email!==undefined){
   const [existing]=await db.execute('SELECT id FROM users WHERE email_normalized=? AND id<>? LIMIT 1',[email,req.user.id]);
   if(existing.length) return res.status(409).json({error:'That email address is already in use.'});
 }
 const updates=[],values=[];
 if(req.body.profilePicture!==undefined){updates.push('profile_picture=?');values.push(profilePicture);}
 if(req.body.addressLine1!==undefined){updates.push('address_line_1=?');values.push(addressLine1||null);}
 if(req.body.addressCity!==undefined){updates.push('address_city=?');values.push(addressCity||null);}
 if(req.body.addressPostcode!==undefined){updates.push('address_postcode=?');values.push(addressPostcode||null);}
 if(email!==undefined){updates.push('email=?');values.push(email);updates.push('email_verified_at=NULL');}
 if(req.body.phone!==undefined){updates.push('phone=?');values.push(phone||null);}
 if(req.user.role==='worker'&&req.body.phoneVisibleToEmployers!==undefined){updates.push('phone_visible_to_employers=?');values.push(req.body.phoneVisibleToEmployers?1:0);}
 if(updates.length){values.push(req.user.id);await db.execute('UPDATE users SET '+updates.join(', ')+' WHERE id=?',values);}
 const [rows] = await db.execute('SELECT id,email,role,admin_tier,first_name,last_name,phone,phone_visible_to_employers,profile_picture,status,created_at,address_line_1,address_city,address_postcode,email_verified_at FROM users WHERE id=?',[req.user.id]);
 return res.json({ user: rows[0], emailVerificationRequired: email!==undefined });
}));

app.post('/api/auth/change-password', auth, asyncRoute(async (req, res) => {
  const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  if (newPassword.length < 12) {
    return res.status(400).json({ error: 'Your new password must be at least 12 characters long.' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'Your new password must be different from your current password.' });
  }
  const [rows] = await db.execute('SELECT password_hash FROM users WHERE id=? LIMIT 1', [req.user.id]);
  if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    return res.status(400).json({ error: 'Your current password is incorrect.' });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.execute('UPDATE users SET password_hash=? WHERE id=?', [passwordHash, req.user.id]);
  return res.json({ ok: true, message: 'Password changed successfully.' });
}));

app.get('/api/onboarding/status', auth, asyncRoute(async (req, res) => {
  const onboarding = {
    role: req.user.role,
    emailVerified: Boolean(req.user.email_verified_at),
    identityStatus: 'not_started',
    rightToWorkStatus: null,
    companyStatus: null,
    canAccessPlatform: req.user.role === 'admin'
  };

  if (req.user.role === 'worker') {
    const [rows] = await db.execute(
      `SELECT identity_verification_status, right_to_work_status
       FROM worker_profiles WHERE user_id = ?`,
      [req.user.id]
    );

    if (rows.length) {
      onboarding.identityStatus = rows[0].identity_verification_status;
      onboarding.rightToWorkStatus = rows[0].right_to_work_status;
    }

    onboarding.canAccessPlatform =
      onboarding.emailVerified &&
      onboarding.identityStatus === 'verified' &&
      onboarding.rightToWorkStatus === 'verified';

  } else if (req.user.role === 'employer') {
    const [rows] = await db.execute(
      `SELECT identity_verification_status, verification_status
       FROM businesses WHERE owner_user_id = ?`,
      [req.user.id]
    );

    if (rows.length) {
      onboarding.identityStatus = rows[0].identity_verification_status;
      onboarding.companyStatus = rows[0].verification_status;
    }

    onboarding.canAccessPlatform =
      onboarding.emailVerified &&
      onboarding.identityStatus === 'verified' &&
      onboarding.companyStatus === 'verified';
  }

  res.json({ onboarding });
}));
app.get('/api/worker/notification-preferences',auth,allow('worker'),asyncRoute(async(req,res)=>{ await ensureWorkerNotificationPreferences; const [rows]=await db.execute('SELECT preferences FROM worker_notification_preferences WHERE worker_user_id=?',[req.user.id]); const defaults={shiftReminders:{email:true,inApp:true},shiftAcceptances:{email:true,inApp:true},shiftRescindments:{email:true,inApp:true},hyrzUpdates:{email:true,inApp:true}}; return res.json({preferences:rows[0]?{...defaults,...(typeof rows[0].preferences==='string'?JSON.parse(rows[0].preferences):rows[0].preferences)}:defaults}); }));
app.put('/api/worker/notification-preferences',auth,allow('worker'),asyncRoute(async(req,res)=>{ await ensureWorkerNotificationPreferences; const defaults={shiftReminders:{email:true,inApp:true},shiftAcceptances:{email:true,inApp:true},shiftRescindments:{email:true,inApp:true},hyrzUpdates:{email:true,inApp:true}}; const supplied=req.body.preferences&&typeof req.body.preferences==='object'?req.body.preferences:{}; const preferences={}; for(const type of Object.keys(defaults)){preferences[type]={}; for(const channel of ['email','inApp']) preferences[type][channel]=typeof supplied[type]?.[channel]==='boolean'?supplied[type][channel]:defaults[type][channel];} await db.execute('INSERT INTO worker_notification_preferences (worker_user_id,preferences) VALUES (?,?) ON DUPLICATE KEY UPDATE preferences=VALUES(preferences)',[req.user.id,JSON.stringify(preferences)]); res.json({ok:true,preferences}); }));
app.get('/api/worker/availability',auth,asyncRoute(async(req,res)=>{
 if(req.user.role!=='worker') return res.status(403).json({error:'Worker accounts only.'});
 await ensureWorkerAvailabilityTable;
 const [rows]=await db.execute('SELECT timings,min_hourly_rate,min_total_pay,max_distance,roles,shift_types,automatic_enabled,employer_mode,preferred_employer_ids FROM worker_availability WHERE user_id=?',[req.user.id]);
 const row=rows[0];
 res.json({availability:row?{timings:typeof row.timings==='string'?JSON.parse(row.timings):row.timings,minHourlyRate:Number(row.min_hourly_rate),minTotalPay:Number(row.min_total_pay),maxDistance:Number(row.max_distance),roles:typeof row.roles==='string'?JSON.parse(row.roles):row.roles,shiftTypes:typeof row.shift_types==='string'?JSON.parse(row.shift_types):row.shift_types,automatic:Boolean(row.automatic_enabled),employerMode:row.employer_mode||'all',preferredEmployerIds:row.preferred_employer_ids?(typeof row.preferred_employer_ids==='string'?JSON.parse(row.preferred_employer_ids):row.preferred_employer_ids):[]}:{timings:{},minHourlyRate:8,minTotalPay:20,maxDistance:10,roles:[],shiftTypes:[],automatic:false,employerMode:'all',preferredEmployerIds:[]}});
}));
app.put('/api/worker/availability',auth,asyncRoute(async(req,res)=>{
 if(req.user.role!=='worker') return res.status(403).json({error:'Worker accounts only.'});
 await ensureWorkerAvailabilityTable;
 const timings=req.body.timings&&typeof req.body.timings==='object'&&!Array.isArray(req.body.timings)?req.body.timings:{};
 const minHourlyRate=Number(req.body.minHourlyRate??8),minTotalPay=Number(req.body.minTotalPay??20),maxDistance=Number(req.body.maxDistance??10);
 const roles=Array.isArray(req.body.roles)?req.body.roles:[],shiftTypes=Array.isArray(req.body.shiftTypes)?req.body.shiftTypes:[],employerMode=req.body.employerMode==='favourites'?'favourites':'all',preferredEmployerIds=Array.isArray(req.body.preferredEmployerIds)?[...new Set(req.body.preferredEmployerIds.map(Number).filter(id=>Number.isSafeInteger(id)&&id>0))]:[];
 if(!Number.isFinite(minHourlyRate)||minHourlyRate<8||!Number.isFinite(minTotalPay)||minTotalPay<8||!Number.isInteger(maxDistance)||maxDistance<1) return res.status(400).json({error:'Minimum hourly rate and total shift pay must be at least £8; distance must be at least 1 mile.'});
 const datePattern=/^\d{4}-\d{2}-\d{2}$/;
 for(const [date,timing] of Object.entries(timings)){
   if(!datePattern.test(date)||!timing||typeof timing.start!=='string'||typeof timing.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(timing.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(timing.end)||timing.start>=timing.end) return res.status(400).json({error:'Each availability date must have valid start and end times.'});
 }
 await db.execute(`INSERT INTO worker_availability (user_id,timings,min_hourly_rate,min_total_pay,max_distance,roles,shift_types,automatic_enabled,employer_mode,preferred_employer_ids) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE timings=VALUES(timings),min_hourly_rate=VALUES(min_hourly_rate),min_total_pay=VALUES(min_total_pay),max_distance=VALUES(max_distance),roles=VALUES(roles),shift_types=VALUES(shift_types),automatic_enabled=VALUES(automatic_enabled),employer_mode=VALUES(employer_mode),preferred_employer_ids=VALUES(preferred_employer_ids)`,[req.user.id,JSON.stringify(timings),minHourlyRate,minTotalPay,maxDistance,JSON.stringify(roles),JSON.stringify(shiftTypes),req.body.automatic?1:0,employerMode,JSON.stringify(preferredEmployerIds)]);
 res.json({ok:true,availability:{timings,minHourlyRate,minTotalPay,maxDistance,roles,shiftTypes,automatic:Boolean(req.body.automatic),employerMode,preferredEmployerIds}});
}));
app.get('/api/profile',auth,asyncRoute(async(req,res)=>{
 await ensureWorkerPhoneVisibilityColumn;
 const [u]=await db.execute('SELECT id,email,role,first_name,last_name,phone,phone_visible_to_employers FROM users WHERE id=?',[req.user.id]);
 if(req.user.role==='worker'){const [p]=await db.execute('SELECT bio,skills,postcode,hourly_rate,right_to_work_status,availability FROM worker_profiles WHERE user_id=?',[req.user.id]);return res.json({user:u[0],profile:p[0]||{}});}
 res.json({user:u[0]});
}));
app.put('/api/worker/location',auth,allow('worker'),asyncRoute(async(req,res)=>{
 const postcode=String(req.body.postcode||'').trim().toUpperCase();
 if(postcode.length>20)return res.status(400).json({error:'Enter a valid UK postcode.'});
 await db.execute('INSERT INTO worker_profiles (user_id,postcode) VALUES (?,?) ON DUPLICATE KEY UPDATE postcode=VALUES(postcode)',[req.user.id,postcode||null]);
 await audit(req,'worker.location.updated','user',req.user.id);
 res.json({ok:true,postcode});
}));
app.put('/api/profile',auth,asyncRoute(async(req,res)=>{
 const {firstName,lastName,phone,bio,skills,postcode,hourlyRate,availability}=req.body;
 await db.execute('UPDATE users SET first_name=?,last_name=?,phone=? WHERE id=?',[firstName||null,lastName||null,phone||null,req.user.id]);
 if(req.user.role==='worker') await db.execute('UPDATE worker_profiles SET bio=?,skills=?,postcode=?,hourly_rate=?,availability=? WHERE user_id=?',
 [bio||null,JSON.stringify(skills||[]),postcode||null,hourlyRate||null,JSON.stringify(availability||[]),req.user.id]);
 await audit(req,'profile.updated','user',req.user.id);res.json({ok:true});
}));
// Expire open shifts once their start time is within five minutes. Shifts linked to a checkout or rating are retained for records.
async function deleteImminentOpenShifts(){
 const [result]=await db.execute(`DELETE s FROM shifts s WHERE s.status='open' AND s.starts_at<=DATE_ADD(NOW(), INTERVAL 5 MINUTE) AND NOT EXISTS (SELECT 1 FROM checkouts c WHERE c.shift_id=s.id) AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.shift_id=s.id)`);
 return result.affectedRows||0;
}
const ensureWorkerNotificationPreferences = createTable(`CREATE TABLE IF NOT EXISTS worker_notification_preferences (worker_user_id BIGINT UNSIGNED PRIMARY KEY, preferences JSON NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, FOREIGN KEY(worker_user_id) REFERENCES users(id) ON DELETE CASCADE)`,'worker notification preferences');
const ensureWorkerEmployerFavourites = createTable(`CREATE TABLE IF NOT EXISTS worker_employer_favourites (worker_user_id BIGINT UNSIGNED NOT NULL, business_id BIGINT UNSIGNED NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(worker_user_id,business_id), FOREIGN KEY(worker_user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(business_id) REFERENCES businesses(id) ON DELETE CASCADE)`,'worker employer favourites');
const ensureEmployerWorkerFavourites = createTable(`CREATE TABLE IF NOT EXISTS employer_worker_favourites (employer_user_id BIGINT UNSIGNED NOT NULL, worker_user_id BIGINT UNSIGNED NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(employer_user_id,worker_user_id), FOREIGN KEY(employer_user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(worker_user_id) REFERENCES users(id) ON DELETE CASCADE)`,'employer worker favourites');
app.get('/api/worker/employers/search',auth,allow('worker'),asyncRoute(async(req,res)=>{
 await ensureBusinessAddressColumns; await ensureWorkerEmployerFavourites;
 const q=String(req.query.q||'').trim(), role=String(req.query.role||'').trim(), location=String(req.query.location||'').trim(), past=req.query.past==='1';
 const args=[req.user.id,req.user.id];
 let sql=`SELECT b.id AS business_id,b.name AS company_name,
 COALESCE(NULLIF(CONCAT_WS(', ',NULLIF(b.address_line_1,''),NULLIF(b.city,'')),''),'') AS company_location,
 GROUP_CONCAT(DISTINCT s.title ORDER BY s.title SEPARATOR '||') AS roles_available,
 MAX(s.starts_at) AS latest_shift,
 EXISTS(SELECT 1 FROM worker_employer_favourites f WHERE f.worker_user_id=? AND f.business_id=b.id) AS is_favourite,
 EXISTS(SELECT 1 FROM applications a JOIN shifts sh ON sh.id=a.shift_id WHERE a.worker_id=? AND sh.business_id=b.id) AS worked_with
 FROM businesses b LEFT JOIN shifts s ON s.business_id=b.id WHERE 1=1`;
 if(q){sql+=' AND LOWER(b.name) LIKE LOWER(?)';args.push('%'+q+'%');}
 if(location){sql+=' AND (LOWER(COALESCE(b.address_line_1,\'\')) LIKE LOWER(?) OR LOWER(COALESCE(b.city,\'\')) LIKE LOWER(?) OR EXISTS(SELECT 1 FROM shifts sl WHERE sl.business_id=b.id AND LOWER(COALESCE(sl.location,\'\')) LIKE LOWER(?)))';args.push('%'+location+'%','%'+location+'%','%'+location+'%');}
 if(role){sql+=' AND EXISTS(SELECT 1 FROM shifts sr WHERE sr.business_id=b.id AND (LOWER(COALESCE(sr.title,\'\')) LIKE LOWER(?) OR LOWER(COALESCE(sr.description,\'\')) LIKE LOWER(?)))';args.push('%'+role+'%','%'+role+'%');}
 if(past){sql+=' AND EXISTS(SELECT 1 FROM applications ap JOIN shifts sp ON sp.id=ap.shift_id WHERE ap.worker_id=? AND sp.business_id=b.id)';args.push(req.user.id);}
 sql+=' GROUP BY b.id,b.name,b.address_line_1,b.city ORDER BY worked_with DESC,b.name LIMIT 200';
 const [rows]=await db.execute(sql,args);
 res.json({employers:rows.map(row=>({...row,rolesAvailable:row.roles_available?row.roles_available.split('||'):[],isFavourite:Boolean(row.is_favourite),workedWith:Boolean(row.worked_with)}))});
}));
app.get('/api/worker/employers/favourites',auth,allow('worker'),asyncRoute(async(req,res)=>{
 await ensureBusinessAddressColumns; await ensureWorkerEmployerFavourites;
 const [rows]=await db.execute(`SELECT b.id AS business_id,b.name AS company_name,COALESCE(NULLIF(CONCAT_WS(', ',NULLIF(b.address_line_1,''),NULLIF(b.city,'')),''),'') AS company_location,GROUP_CONCAT(DISTINCT s.title ORDER BY s.title SEPARATOR '||') AS roles_available,MAX(s.starts_at) AS latest_shift FROM worker_employer_favourites f JOIN businesses b ON b.id=f.business_id LEFT JOIN shifts s ON s.business_id=b.id WHERE f.worker_user_id=? GROUP BY b.id,b.name,b.address_line_1,b.city ORDER BY b.name`,[req.user.id]);
 res.json({employers:rows.map(row=>({...row,rolesAvailable:row.roles_available?row.roles_available.split('||'):[],isFavourite:true}))});
}));
app.get('/api/worker/employers/favourited-me',auth,allow('worker'),asyncRoute(async(req,res)=>{
 await ensureEmployerWorkerFavourites;
 const [rows]=await db.execute(`SELECT u.id AS employer_user_id,u.first_name,u.last_name,b.id AS business_id,b.name AS company_name,COALESCE(NULLIF(CONCAT_WS(', ',NULLIF(b.address_line_1,''),NULLIF(b.city,'')),''),'') AS company_location,GROUP_CONCAT(DISTINCT s.title ORDER BY s.title SEPARATOR '||') AS roles_available,ef.created_at AS favourited_at FROM employer_worker_favourites ef JOIN users u ON u.id=ef.employer_user_id LEFT JOIN businesses b ON b.owner_user_id=u.id LEFT JOIN shifts s ON s.business_id=b.id WHERE ef.worker_user_id=? GROUP BY u.id,u.first_name,u.last_name,b.id,b.name,b.address_line_1,b.city,ef.created_at ORDER BY ef.created_at DESC`,[req.user.id]);
 res.json({employers:rows.map(row=>({...row,rolesAvailable:row.roles_available?row.roles_available.split('||'):[]}))});
}));
app.post('/api/worker/employers/:businessId/favourite',auth,allow('worker'),asyncRoute(async(req,res)=>{
 await ensureWorkerEmployerFavourites; const id=Number(req.params.businessId);
 const [rows]=await db.execute('SELECT id FROM businesses WHERE id=?',[id]);
 if(!rows.length)return res.status(404).json({error:'Employer not found.'});
 await db.execute('INSERT IGNORE INTO worker_employer_favourites(worker_user_id,business_id) VALUES(?,?)',[req.user.id,id]);res.json({ok:true,favourite:true});
}));
app.delete('/api/worker/employers/:businessId/favourite',auth,allow('worker'),asyncRoute(async(req,res)=>{
 await ensureWorkerEmployerFavourites;
 await db.execute('DELETE FROM worker_employer_favourites WHERE worker_user_id=? AND business_id=?',[req.user.id,Number(req.params.businessId)]);res.json({ok:true,favourite:false});
}));
async function lookupPostcodeCoordinates(postcodes){
 const normalized=[...new Set(postcodes.map(p=>String(p||'').trim().toUpperCase()).filter(Boolean))];
 if(!normalized.length)return {};
 const result={};
 // postcodes.io bulk lookups accept at most 100 postcodes per request.
 for(let i=0;i<normalized.length;i+=100){
  const batch=normalized.slice(i,i+100);
  const response=await fetch('https://api.postcodes.io/postcodes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postcodes:batch})});
  if(!response.ok)throw new Error('Postcode location lookup is temporarily unavailable. Please try again.');
  const data=await response.json();
  for(const item of data.result||[]){if(item.result)result[String(item.query||'').toUpperCase()]={lat:item.result.latitude,lon:item.result.longitude};}
 }
 return result;
}
function distanceMiles(a,b){
 const radians=value=>value*Math.PI/180;const dLat=radians(b.lat-a.lat),dLon=radians(b.lon-a.lon);
 const h=Math.sin(dLat/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(dLon/2)**2;
 return 3958.8*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
app.get('/api/employer/workers/search',auth,allow('employer'),asyncRoute(async(req,res)=>{
 await ensureEmployerWorkerFavourites;
 const q=String(req.query.q||'').trim();
 const [employers]=await db.execute('SELECT postcode FROM businesses WHERE owner_user_id=? ORDER BY id DESC LIMIT 1',[req.user.id]);
 const [userAddress]=await db.execute('SELECT address_postcode FROM users WHERE id=?',[req.user.id]);
 const employerPostcode=String(employers[0]?.postcode||userAddress[0]?.address_postcode||'').trim().toUpperCase();
 const [rows]=await db.execute(`SELECT u.id,u.first_name,u.last_name,u.email,u.profile_picture,
 COALESCE(NULLIF(TRIM(wp.postcode),''),NULLIF(TRIM(u.address_postcode),'')) AS postcode,
 EXISTS(SELECT 1 FROM employer_worker_favourites f WHERE f.employer_user_id=? AND f.worker_user_id=u.id) AS is_favourite
 FROM users u LEFT JOIN worker_profiles wp ON wp.user_id=u.id
 WHERE u.role='worker' AND u.status='active'
 AND (?='' OR LOWER(CONCAT_WS(' ',u.first_name,u.last_name)) LIKE LOWER(?) OR LOWER(u.email) LIKE LOWER(?))
 ORDER BY u.first_name,u.last_name LIMIT 1000`,[req.user.id,q,'%'+q+'%','%'+q+'%']);
 // Do not fail the entire search if the employer or worker has not saved a postcode.
 // Show those workers explicitly as location-unverified; only apply the 10-mile filter
 // where both ends of the distance calculation can actually be verified.
 let coordinates={};
 try {
  coordinates=await lookupPostcodeCoordinates([...(employerPostcode?[employerPostcode]:[]),...rows.map(row=>row.postcode)]);
 } catch(error) {
  console.error('Employer worker search postcode lookup failed:',error.message);
 }
 const origin=employerPostcode?coordinates[employerPostcode]:null;
 const workers=rows.map(row=>{
  const point=coordinates[String(row.postcode||'').trim().toUpperCase()];
  const locationVerified=Boolean(origin&&point);
  const distance=locationVerified?Math.round(distanceMiles(origin,point)*10)/10:null;
  return {...row,distanceMiles:distance,locationVerified,isFavourite:Boolean(row.is_favourite)};
 })
 .filter(row=>!row.locationVerified||row.distanceMiles<=10)
 .sort((a,b)=>{if(a.locationVerified!==b.locationVerified)return a.locationVerified?-1:1;if(a.distanceMiles==null)return a.first_name.localeCompare(b.first_name);if(b.distanceMiles==null)return -1;return a.distanceMiles-b.distanceMiles;});
 res.json({workers,radiusMiles:10,matched:workers.filter(w=>w.locationVerified).length,locationUnverified:workers.filter(w=>!w.locationVerified).length,employerLocationVerified:Boolean(origin),searchTerm:q});
}));
app.get('/api/employer/workers/favourites',auth,allow('employer'),asyncRoute(async(req,res)=>{
 await ensureEmployerWorkerFavourites;
 const [workers]=await db.execute(`SELECT u.id,u.first_name,u.last_name,u.email
 FROM employer_worker_favourites f JOIN users u ON u.id=f.worker_user_id
 WHERE f.employer_user_id=? AND u.role='worker' AND u.status='active'
 ORDER BY u.first_name,u.last_name`,[req.user.id]);
 res.json({workers});
}));
app.post('/api/employer/workers/:workerId/favourite',auth,allow('employer'),asyncRoute(async(req,res)=>{
 await ensureEmployerWorkerFavourites;const workerId=Number(req.params.workerId);
 const [rows]=await db.execute('SELECT id FROM users WHERE id=? AND role=\'worker\'',[workerId]);
 if(!rows.length)return res.status(404).json({error:'Worker not found.'});
 await db.execute('INSERT IGNORE INTO employer_worker_favourites(employer_user_id,worker_user_id) VALUES(?,?)',[req.user.id,workerId]);res.json({ok:true,favourite:true});
}));
app.delete('/api/employer/workers/:workerId/favourite',auth,allow('employer'),asyncRoute(async(req,res)=>{
 await ensureEmployerWorkerFavourites;await db.execute('DELETE FROM employer_worker_favourites WHERE employer_user_id=? AND worker_user_id=?',[req.user.id,Number(req.params.workerId)]);res.json({ok:true,favourite:false});
}));
app.get('/api/employer/workers/past',auth,allow('employer'),asyncRoute(async(req,res)=>{
 await ensureEmployerWorkerFavourites;
 const [rows]=await db.execute(`SELECT u.id,u.first_name,u.last_name,u.email,MAX(u.profile_picture) AS profile_picture,wp.postcode,
 GROUP_CONCAT(DISTINCT s.title ORDER BY s.title SEPARATOR ', ') AS roles,
 MAX(s.starts_at) AS last_shift,
 EXISTS(SELECT 1 FROM employer_worker_favourites f WHERE f.employer_user_id=? AND f.worker_user_id=u.id) AS is_favourite
 FROM applications a
 JOIN shifts s ON s.id=a.shift_id
 JOIN businesses b ON b.id=s.business_id
 JOIN users u ON u.id=a.worker_id
 LEFT JOIN worker_profiles wp ON wp.user_id=u.id
 WHERE b.owner_user_id=? AND s.ends_at<NOW() AND a.status IN ('approved','completed')
 GROUP BY u.id,u.first_name,u.last_name,u.email,wp.postcode
 ORDER BY last_shift DESC`,[req.user.id,req.user.id]);
 res.json({workers:rows.map(row=>({...row,isFavourite:Boolean(row.is_favourite)}))});
}));
app.get('/api/shifts/mine',auth,allow('employer'),asyncRoute(async(req,res)=>{
 const [rows]=await db.execute('SELECT s.*,b.owner_user_id AS employer_id,b.name AS business_name FROM shifts s JOIN businesses b ON b.id=s.business_id WHERE b.owner_user_id=? ORDER BY s.starts_at DESC',[req.user.id]);
 res.json({shifts:rows});
}));
app.get('/api/shifts',auth,asyncRoute(async(req,res)=>{
 await deleteImminentOpenShifts();
 const {postcode,from,to,search}=req.query;
 let sql=`SELECT s.*,b.name AS business_name,u.profile_picture AS employer_profile_picture,(SELECT COUNT(*) FROM applications a WHERE a.shift_id=s.id AND a.status='approved') AS workers_hired FROM shifts s JOIN businesses b ON b.id=s.business_id JOIN users u ON u.id=b.owner_user_id WHERE s.status='open'`;
 const args=[];
 if(from){sql+=' AND s.starts_at>=?';args.push(from);}
 if(to){sql+=' AND s.starts_at<=?';args.push(to);}
 if(search){sql+=' AND (s.title LIKE ? OR s.description LIKE ? OR s.location LIKE ?)';args.push(`%${search}%`,`%${search}%`,`%${search}%`);}
 if(postcode){sql+=' AND s.location LIKE ?';args.push(`%${postcode}%`);}
 sql+=' ORDER BY s.starts_at LIMIT 200';
 const [rows]=await db.execute(sql,args);res.json({shifts:rows});
}));
app.post('/api/shifts',auth,allow('employer'),requireVerification,asyncRoute(async(req,res)=>{
 await ensureShiftPublishingColumns;
 const {title,description,location,startsAt,endsAt,breakMinutes=0,hourlyPay,slots=1,autoApprove=false,shiftType='hospitality',requirements=[],perks=[],preferences=[]}=req.body;
 if(!title||!VALID_JOB_ROLES.has(title)) return res.status(400).json({error:'Choose a job role from the approved role list.'});
 if(!startsAt||!endsAt||new Date(endsAt)<=new Date(startsAt)||Number(hourlyPay)<8||Number(slots)<1||Number(breakMinutes)<0||!Array.isArray(requirements)||requirements.length>10||requirements.some(x=>typeof x!=='string'||x.trim().length>250)||!Array.isArray(perks)||perks.length>10||perks.some(x=>typeof x!=='string'||x.trim().length>250)||!Array.isArray(preferences)||preferences.length>10||preferences.some(x=>typeof x!=='string'||x.trim().length>250)) return res.status(400).json({error:'Invalid shift details. Hourly pay must be at least £8.00'});
 const [bs]=await db.execute('SELECT id, address_line_1, city FROM businesses WHERE owner_user_id=?',[req.user.id]);
 if(!bs.length)return res.status(400).json({error:'Business profile missing'});
 const shiftLocation=String(location||[bs[0].address_line_1,bs[0].city].filter(Boolean).join(', ')||'Location to be confirmed').trim();
 const [r]=await db.execute('INSERT INTO shifts(business_id,created_by,title,description,location,starts_at,ends_at,break_minutes,hourly_pay,slots,auto_approve,shift_type,requirements,perks,preferences) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
 [bs[0].id,req.user.id,title,description||null,shiftLocation,startsAt,endsAt,breakMinutes,hourlyPay,slots,!!autoApprove,shiftType,JSON.stringify(requirements.map(x=>x.trim()).filter(Boolean)),JSON.stringify(perks.map(x=>x.trim()).filter(Boolean)),JSON.stringify(preferences.map(x=>x.trim()).filter(Boolean))]);
 await audit(req,'shift.created','shift',r.insertId);res.status(201).json({id:r.insertId});
}));
app.delete('/api/shifts/:id',auth,allow('employer'),requireVerification,asyncRoute(async(req,res)=>{
 await ensureApplicationCancellationFee;
 const [rows]=await db.execute('SELECT s.id,s.starts_at,s.ends_at,s.hourly_pay,s.break_minutes FROM shifts s JOIN businesses b ON b.id=s.business_id WHERE s.id=? AND b.owner_user_id=?',[req.params.id,req.user.id]);
 if(!rows.length)return res.status(404).json({error:'Shift not found'});
 const shift=rows[0];
 const [approved]=await db.execute("SELECT id FROM applications WHERE shift_id=? AND status='approved'",[shift.id]);
 const within24Hours=(new Date(shift.starts_at).getTime()-Date.now())<=24*60*60*1000;
 const durationHours=Math.max(0,(new Date(shift.ends_at)-new Date(shift.starts_at))/3600000-(Number(shift.break_minutes||0)/60));
 const feePerWorker=within24Hours?Math.round(Number(shift.hourly_pay)*durationHours*50)/100:0;
 const totalFee=Math.round(feePerWorker*approved.length*100)/100;
 if(approved.length&&within24Hours&&req.body?.confirmCancellationFee!==true)return res.status(409).json({error:'Cancelling within 24 hours of the shift incurs a fine of 50% of the total shift pay per approved worker.',approvedWorkers:approved.length,feePerWorker,totalFee});
 await db.execute("UPDATE applications SET status='withdrawn',cancellation_fee=? WHERE shift_id=? AND status='approved'",[feePerWorker,shift.id]);
 await db.execute("UPDATE applications SET status='withdrawn' WHERE shift_id=? AND status='pending'",[shift.id]);
 await db.execute("UPDATE shifts SET status='cancelled' WHERE id=?",[shift.id]);
 await audit(req,'shift.cancelled','shift',shift.id,{approvedWorkers:approved.length,within24Hours,feePerWorker,totalCancellationFee:totalFee});
 res.json({ok:true,approvedWorkers:approved.length,feePerWorker,totalFee});
}));
app.get('/api/shifts/:id',auth,asyncRoute(async(req,res)=>{
 const [rows]=await db.execute('SELECT s.*,b.name AS business_name FROM shifts s JOIN businesses b ON b.id=s.business_id WHERE s.id=?',[req.params.id]);
 if(!rows.length)return res.status(404).json({error:'Shift not found'});res.json({shift:rows[0]});
}));
app.post('/api/shifts/:id/apply',auth,allow('worker'),requireVerification,asyncRoute(async(req,res)=>{
 await db.query("CREATE TABLE IF NOT EXISTS worker_strikes (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,worker_id BIGINT UNSIGNED NOT NULL,application_id BIGINT UNSIGNED NOT NULL,shift_id BIGINT UNSIGNED NOT NULL,reason VARCHAR(255) NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uniq_worker_strike_application (application_id))");
 const [[strikeState]]=await db.execute('SELECT COUNT(*) AS strikes FROM worker_strikes WHERE worker_id=?',[req.user.id]);
 if(Number(strikeState?.strikes||0)>=3)return res.status(403).json({error:'Your account has reached three strikes and cannot book more shifts. Please appeal your strikes through Contact Hyrz support and wait for an administrator review.'});
 await ensureShiftPublishingColumns; await ensureApplicationPreferencesColumn; await ensureApplicationRateNegotiation; await ensureShiftContractColumns;
 if(req.body?.contractAccepted!==true)return res.status(400).json({error:'You must agree to the shift contract before applying.'});
 let contractSnapshot='';try{const parsed=JSON.parse(String(req.body?.contractSnapshot||''));if(!parsed||parsed.version!=='hyrz-shift-contract-v1')throw new Error();contractSnapshot=JSON.stringify(parsed);if(contractSnapshot.length>20000)throw new Error();}catch{return res.status(400).json({error:'A valid shift contract must be reviewed and accepted before applying.'});}
 const [s]=await db.execute('SELECT shifts.*,businesses.name AS business_name FROM shifts JOIN businesses ON businesses.id=shifts.business_id WHERE shifts.id=?',[req.params.id]);
 if(!s.length||s[0].status!=='open')return res.status(404).json({error:'Shift not available'});
 const contractShift=s[0];const contractStart=new Date(contractShift.starts_at),contractEnd=new Date(contractShift.ends_at);const contractHours=Math.max(0,(contractEnd-contractStart)/3600000-Number(contractShift.break_minutes||0)/60);const parseContractList=value=>{if(Array.isArray(value))return value.filter(Boolean);if(typeof value==='string'){try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.filter(Boolean):[]}catch{return []}}return []};const contractPaymentDate=contractShift.company_payment_date??contractShift.payment_date??contractShift.payment_due_date??contractShift.invoice_due_at??contractShift.business_payment_date;const contractPaymentDays=Number(contractShift.company_payment_days??contractShift.payment_days??contractShift.payment_terms_days??contractShift.business_payment_days);const contractPaymentDateParsed=new Date(contractPaymentDate);const contractPaymentTerms=contractPaymentDate&&!Number.isNaN(contractPaymentDateParsed.getTime())?'Payment due '+contractPaymentDateParsed.toLocaleDateString('en-GB'):(Number.isFinite(contractPaymentDays)&&contractPaymentDays>=0&&contractPaymentDays<=14?'Employer payment terms: within '+contractPaymentDays+' day'+(contractPaymentDays===1?'':'s'):'Employer payment terms: payment date shown on the employer invoice, up to 14 days');const canonicalContract={version:'hyrz-shift-contract-v1',employer:contractShift.business_name||'Employer',worker:[req.user.first_name,req.user.last_name].filter(Boolean).join(' ')||req.user.email||'Worker',role:contractShift.title||'Shift worker',location:contractShift.location||'To be confirmed',date:contractStart.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}),startTime:contractStart.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),endTime:contractEnd.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),hours:Number(contractHours.toFixed(2)),hourlyRate:Number(contractShift.hourly_pay||0),grossPay:Number((Number(contractShift.hourly_pay||0)*contractHours).toFixed(2)),paymentTerms:contractPaymentTerms,description:contractShift.description||'Duties as reasonably described by the employer for this role.',breakMinutes:Number(contractShift.break_minutes||0),requirements:parseContractList(contractShift.requirements),preferences:parseContractList(contractShift.preferences),perks:parseContractList(contractShift.perks),cancellation:'Cancellations and any applicable fees or worker strikes are handled under the Hyrz platform rules and applicable law.',records:'Hours worked must be recorded accurately and submitted for review. Payment is based on approved hours and the agreed hourly rate, subject to applicable deductions and legal requirements.'};contractSnapshot=JSON.stringify(canonicalContract);
 const requiredItems=Array.isArray(s[0].requirements)?s[0].requirements:(typeof s[0].requirements==='string'?JSON.parse(s[0].requirements||'[]'):[]);
 if(requiredItems.length&&req.body?.confirmedRequirements!==true)return res.status(400).json({error:'Confirm all shift requirements before applying.'});
 const preferredItems=Array.isArray(s[0].preferences)?s[0].preferences:(typeof s[0].preferences==='string'?JSON.parse(s[0].preferences||'[]'):[]);
 const confirmedPreferences=Array.isArray(req.body?.confirmedPreferences)?req.body.confirmedPreferences:[];
 if(confirmedPreferences.some(item=>typeof item!=='string'||!preferredItems.includes(item))||new Set(confirmedPreferences).size!==confirmedPreferences.length)return res.status(400).json({error:'One or more selected preferences are invalid.'});
 const confirmedPreferencesJson=JSON.stringify(confirmedPreferences);
 const requestedRate=req.body?.requestedHourlyRate==null||req.body.requestedHourlyRate===''?null:Number(req.body.requestedHourlyRate);const rateMessage=String(req.body?.rateMessage||'').trim();if(requestedRate!==null&&(!Number.isFinite(requestedRate)||requestedRate<Number(s[0].hourly_pay||8)||requestedRate>500))return res.status(400).json({error:'A counter-offer must be at least the advertised hourly rate and no more than £500 per hour.'});if(rateMessage.length>1000)return res.status(400).json({error:'The optional message must be 1,000 characters or fewer.'});
 const nextStatus=requestedRate!==null?'pending':(s[0].auto_approve?'approved':'pending');
 const [existing]=await db.execute('SELECT id,status FROM applications WHERE shift_id=? AND worker_id=? LIMIT 1',[req.params.id,req.user.id]);
 if(existing.length){
   if(['withdrawn','cancelled'].includes(existing[0].status)){
     await db.execute('UPDATE applications SET status=?,cancellation_fee=0,confirmed_preferences=?,requested_hourly_rate=?,rate_message=?,rate_decision=?,negotiated_hourly_rate=NULL,contract_accepted_at=UTC_TIMESTAMP(),contract_snapshot=? WHERE id=?',[nextStatus,confirmedPreferencesJson,requestedRate,rateMessage||null,requestedRate===null?null:'pending',contractSnapshot,existing[0].id]);
     return res.status(200).json({id:existing[0].id,status:nextStatus});
   }
   return res.status(409).json({error:'Already applied'});
 }
 try {
 const [r]=await db.execute('INSERT INTO applications(shift_id,worker_id,status,confirmed_preferences,requested_hourly_rate,rate_message,rate_decision,contract_accepted_at,contract_snapshot) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(),?)',[req.params.id,req.user.id,nextStatus,confirmedPreferencesJson,requestedRate,rateMessage||null,requestedRate===null?null:'pending',contractSnapshot]);
 res.status(201).json({id:r.insertId,status:nextStatus});
 }catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Already applied'});throw e;}
}));
app.get('/api/applications/mine',auth,asyncRoute(async(req,res)=>{
 await Promise.all([ensureApplicationRateNegotiation,ensureWorkerPhoneVisibilityColumn]);
 const sql=req.user.role==='worker'
 ? `SELECT a.*,a.requested_hourly_rate AS requestedHourlyRate,a.rate_message AS rateMessage,a.rate_decision AS rateDecision,s.title,s.location,s.starts_at,s.ends_at,s.hourly_pay,b.name business_name FROM applications a JOIN shifts s ON s.id=a.shift_id JOIN businesses b ON b.id=s.business_id WHERE a.worker_id=? ORDER BY a.created_at DESC`
 : `SELECT a.*,a.requested_hourly_rate AS requestedHourlyRate,a.rate_message AS rateMessage,a.rate_decision AS rateDecision,s.title,s.starts_at,s.ends_at,s.hourly_pay,u.first_name,u.last_name,u.email,u.profile_picture AS worker_profile_picture,CASE WHEN COALESCE(u.phone_visible_to_employers,0)=1 THEN u.phone ELSE NULL END AS employer_visible_phone,wp.bio AS worker_bio,wp.skills AS worker_skills,wp.hourly_rate AS worker_hourly_rate,wp.availability AS worker_availability,wp.postcode AS worker_postcode,(SELECT AVG(r.score) FROM ratings r WHERE r.reviewee_id=a.worker_id) AS average_rating,(SELECT COUNT(*) FROM ratings r WHERE r.reviewee_id=a.worker_id) AS rating_count FROM applications a JOIN shifts s ON s.id=a.shift_id JOIN users u ON u.id=a.worker_id LEFT JOIN worker_profiles wp ON wp.user_id=a.worker_id JOIN businesses b ON b.id=s.business_id WHERE b.owner_user_id=? ORDER BY a.created_at DESC`;
 const [rows]=await db.execute(sql,[req.user.id]);res.json({applications:rows});
}));
app.patch('/api/applications/:id',auth,allow('employer'),requireVerification,asyncRoute(async(req,res)=>{
 await ensureApplicationRateNegotiation;const acceptRequestedRate=req.body?.acceptRequestedRate===true;
 const status=req.body.status;if(!['approved','rejected'].includes(status))return res.status(400).json({error:'Invalid status'});
 const [rows]=await db.execute('SELECT a.id,a.shift_id FROM applications a JOIN shifts s ON s.id=a.shift_id JOIN businesses b ON b.id=s.business_id WHERE a.id=? AND b.owner_user_id=?',[req.params.id,req.user.id]);
 if(!rows.length)return res.status(404).json({error:'Application not found'});
 const [applicationRows]=await db.execute('SELECT requested_hourly_rate FROM applications WHERE id=?',[req.params.id]);const requested=applicationRows[0]?.requested_hourly_rate;if(acceptRequestedRate&&(!requested||status!=='approved'))return res.status(400).json({error:'This application has no rate counter-offer to accept.'});if(acceptRequestedRate){await db.execute("UPDATE applications SET status='approved',rate_decision='accepted',negotiated_hourly_rate=requested_hourly_rate WHERE id=?",[req.params.id]);}else{await db.execute("UPDATE applications SET status=?,rate_decision=CASE WHEN requested_hourly_rate IS NOT NULL THEN 'declined' ELSE rate_decision END WHERE id=?",[status,req.params.id]);}await audit(req,acceptRequestedRate?'application.rate_counter_accepted':'application.'+status,'application',req.params.id,{requestedHourlyRate:requested||null,acceptRequestedRate});res.json({ok:true});
}));
app.delete('/api/applications/:id',auth,allow('employer'),requireVerification,asyncRoute(async(req,res)=>{
 await ensureApplicationCancellationFee;
 const [rows]=await db.execute("SELECT a.id,a.status,a.shift_id,s.starts_at,s.ends_at,s.hourly_pay,s.break_minutes FROM applications a JOIN shifts s ON s.id=a.shift_id JOIN businesses b ON b.id=s.business_id WHERE a.id=? AND b.owner_user_id=?",[req.params.id,req.user.id]);
 if(!rows.length)return res.status(404).json({error:'Worker application not found'});
 const a=rows[0];if(a.status!=='approved')return res.status(400).json({error:'Only approved workers can be removed with this action.'});
 const within24Hours=(new Date(a.starts_at).getTime()-Date.now())<=24*60*60*1000;
 const durationHours=Math.max(0,(new Date(a.ends_at)-new Date(a.starts_at))/3600000-(Number(a.break_minutes||0)/60));
 const fee=within24Hours?Math.round(Number(a.hourly_pay)*durationHours*50)/100:0;
 if(within24Hours&&req.body?.confirmCancellationFee!==true)return res.status(409).json({error:'Removing an approved worker within 24 hours incurs a fine of 50% of the total shift pay.',fee});
 await db.execute("UPDATE applications SET status='withdrawn',cancellation_fee=? WHERE id=?",[fee,a.id]);
 await audit(req,'application.approved_worker_removed','application',a.id,{shiftId:a.shift_id,within24Hours,cancellationFee:fee});
 res.json({ok:true,fee});
}));
app.post('/api/applications/:id/cancel',auth,allow('worker'),asyncRoute(async(req,res)=>{
 const [rows]=await db.execute("SELECT a.id,a.status,a.shift_id,s.starts_at FROM applications a JOIN shifts s ON s.id=a.shift_id WHERE a.id=? AND a.worker_id=? AND a.status IN ('pending','approved')",[req.params.id,req.user.id]);
 if(!rows.length)return res.status(404).json({error:'Active application not found'});
 const a=rows[0],timeUntilStart=new Date(a.starts_at).getTime()-Date.now(),within24Hours=timeUntilStart>=0&&timeUntilStart<=24*60*60*1000;
 if(a.status==='approved'&&within24Hours&&req.body?.confirmStrike!==true)return res.status(409).json({error:'Cancelling an approved shift within 24 hours will give you a strike. Do you want to continue?',strike:true});
 await db.execute("UPDATE applications SET status='withdrawn' WHERE id=? AND worker_id=?",[a.id,req.user.id]);
 if(a.status==='approved'&&within24Hours){
   await db.execute("CREATE TABLE IF NOT EXISTS worker_strikes (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,worker_id BIGINT UNSIGNED NOT NULL,application_id BIGINT UNSIGNED NOT NULL,shift_id BIGINT UNSIGNED NOT NULL,reason VARCHAR(255) NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uniq_worker_strike_application (application_id))");
   await db.execute("INSERT IGNORE INTO worker_strikes(worker_id,application_id,shift_id,reason) VALUES(?,?,?,'Worker cancelled an approved shift within 24 hours')",[req.user.id,a.id,a.shift_id]);
 }
 await audit(req,'application.cancelled','application',req.params.id,{shiftId:a.shift_id,wasApproved:a.status==='approved',within24Hours,strikeApplied:a.status==='approved'&&within24Hours});
 res.json({ok:true,strike:a.status==='approved'&&within24Hours});
}));
app.post('/api/applications/:id/no-show',auth,allow('employer'),requireVerification,asyncRoute(async(req,res)=>{
 await db.query("CREATE TABLE IF NOT EXISTS worker_strikes (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,worker_id BIGINT UNSIGNED NOT NULL,application_id BIGINT UNSIGNED NOT NULL,shift_id BIGINT UNSIGNED NOT NULL,reason VARCHAR(255) NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uniq_worker_strike_application (application_id))");
 const [rows]=await db.execute("SELECT a.id,a.worker_id,a.shift_id,a.status,s.ends_at FROM applications a JOIN shifts s ON s.id=a.shift_id JOIN businesses b ON b.id=s.business_id WHERE a.id=? AND b.owner_user_id=?",[req.params.id,req.user.id]);
 if(!rows.length)return res.status(404).json({error:'Application not found'});
 const a=rows[0];
 if(a.status!=='approved')return res.status(409).json({error:'Only a worker confirmed for this shift can be recorded as a no-show.'});
 if(!a.ends_at||new Date(a.ends_at).getTime()>Date.now())return res.status(409).json({error:'A no-show can only be recorded after the scheduled shift has ended.'});
 const [insert]=await db.execute("INSERT IGNORE INTO worker_strikes(worker_id,application_id,shift_id,reason) VALUES(?,?,?,'Worker did not attend the confirmed shift')",[a.worker_id,a.id,a.shift_id]);
 await audit(req,'worker.no_show_recorded','application',a.id,{shiftId:a.shift_id,strikeApplied:insert.affectedRows===1});
 const [[count]]=await db.execute('SELECT COUNT(*) AS strikes FROM worker_strikes WHERE worker_id=?',[a.worker_id]);
 res.json({ok:true,strikeApplied:insert.affectedRows===1,strikes:Math.min(3,Number(count?.strikes||0))});
}));

app.post('/api/admin/test-checkouts/taylor',auth,allow('admin'),asyncRoute(async(req,res)=>{
 await ensureClockCheckoutColumns;
 const [people]=await db.execute("SELECT id,first_name,last_name FROM users WHERE LOWER(TRIM(first_name))='taylor' AND LOWER(TRIM(last_name))='worker' AND role='worker' ORDER BY id LIMIT 1");
 if(!people.length)return res.status(404).json({error:'Taylor Worker account was not found.'});
 const worker=people[0];
 const [existing]=await db.execute("SELECT id,status FROM checkouts WHERE worker_id=? AND is_test=1 AND status='open' ORDER BY id DESC LIMIT 1",[worker.id]);
 if(existing.length)return res.json({ok:true,checkoutId:existing[0].id,alreadyExists:true,workerId:worker.id});
 const [shifts]=await db.execute(`SELECT s.id,s.hourly_pay FROM shifts s
   LEFT JOIN applications a ON a.shift_id=s.id AND a.worker_id=? AND a.status='approved'
   WHERE s.status<>'cancelled'
   ORDER BY (a.id IS NOT NULL) DESC,s.ends_at DESC LIMIT 1`,[worker.id]);
 if(!shifts.length)return res.status(409).json({error:'No shift exists to attach the Taylor Worker test checkout to.'});
 const shift=shifts[0];
 const start=new Date();
 const end=new Date(start.getTime()+4*60*60*1000);
 const calc=calculatePay({hourlyPay:shift.hourly_pay,startsAt:start,endsAt:end,breakMinutes:0});
 const [created]=await db.execute(`INSERT INTO checkouts(shift_id,worker_id,actual_start,actual_end,break_minutes,worker_comment,gross_pay,platform_fee,status,is_test)
   VALUES(?,?,NOW(),DATE_ADD(NOW(),INTERVAL 4 HOUR),0,?,?,?,'open',1)`,[shift.id,worker.id,'Test checkout for clock-in / clock-out workflow',calc.grossPay,calc.platformFee]);
 await audit(req,'checkout.test_created','checkout',created.insertId,{workerId:worker.id,shiftId:shift.id});
 res.status(201).json({ok:true,checkoutId:created.insertId,workerId:worker.id});
}));
app.post('/api/checkouts/clock-in',auth,allow('worker'),asyncRoute(async(req,res)=>{
 await ensureClockCheckoutColumns;
 const shiftId=Number(req.body?.shiftId);
 if(!Number.isSafeInteger(shiftId)||shiftId<1)return res.status(400).json({error:'Choose a valid shift to clock in.'});
 let [approved]=await db.execute(`SELECT a.id,s.id AS shift_id,s.starts_at,s.ends_at,s.hourly_pay
   FROM applications a JOIN shifts s ON s.id=a.shift_id
   WHERE a.shift_id=? AND a.worker_id=? AND a.status='approved' LIMIT 1`,[shiftId,req.user.id]);
 if(!approved.length){
   const [testShift]=await db.execute(`SELECT s.id AS shift_id,s.starts_at,s.ends_at,s.hourly_pay
     FROM checkouts c JOIN shifts s ON s.id=c.shift_id
     WHERE c.shift_id=? AND c.worker_id=? AND c.is_test=1 AND c.status='open' LIMIT 1`,[shiftId,req.user.id]);
   if(testShift.length)approved=testShift;
 }
 if(!approved.length)return res.status(403).json({error:'You must have an approved application for this shift before clocking in.'});
 const [existing]=await db.execute("SELECT * FROM checkouts WHERE shift_id=? AND worker_id=? ORDER BY id DESC LIMIT 1",[shiftId,req.user.id]);
 if(existing.length&&['submitted','approved','paid','completed','disputed'].includes(String(existing[0].status||'').toLowerCase()))return res.status(409).json({error:'A checkout for this shift has already been submitted or processed.'});
 if(existing.length){
   if(existing[0].clocked_in_at)return res.status(409).json({error:'You have already clocked in for this shift.'});
   await db.execute("UPDATE checkouts SET actual_start=NOW(),clocked_in_at=NOW(),actual_end=COALESCE(actual_end,?),status='open',worker_comment=NULL,worker_adjustment_reason=NULL WHERE id=?",[approved[0].ends_at,existing[0].id]);
   return res.json({ok:true,checkoutId:existing[0].id,clockedInAt:new Date().toISOString()});
 }
 const [created]=await db.execute(`INSERT INTO checkouts(shift_id,worker_id,actual_start,actual_end,break_minutes,worker_comment,gross_pay,platform_fee,status,clocked_in_at,is_test)
   VALUES(?,?,NOW(),?,0,NULL,0,0,'open',NOW(),0)`,[shiftId,req.user.id,approved[0].ends_at]);
 res.status(201).json({ok:true,checkoutId:created.insertId});
}));
app.post('/api/checkouts/:id/clock-out',auth,allow('worker'),asyncRoute(async(req,res)=>{
 await ensureClockCheckoutColumns;
 const [rows]=await db.execute("SELECT id,clocked_in_at,status FROM checkouts WHERE id=? AND worker_id=?",[req.params.id,req.user.id]);
 if(!rows.length)return res.status(404).json({error:'Checkout not found.'});
 if(String(rows[0].status).toLowerCase()!=='open')return res.status(409).json({error:'This checkout is no longer open.'});
 if(!rows[0].clocked_in_at)return res.status(400).json({error:'Clock in first, or submit your corrected times with a reason.'});
 if(rows[0].clocked_out_at)return res.status(409).json({error:'You have already clocked out for this shift.'});
 await db.execute("UPDATE checkouts SET actual_end=NOW(),clocked_out_at=NOW() WHERE id=?",[req.params.id]);
 res.json({ok:true,checkoutId:Number(req.params.id)});
}));
app.post('/api/checkouts/:id/submit',auth,allow('worker'),asyncRoute(async(req,res)=>{
 await ensureClockCheckoutColumns;
 const {actualStart,actualEnd,breakMinutes=0,reason=''}=req.body||{};
 if(!actualStart||!actualEnd||!Number.isInteger(Number(breakMinutes))||Number(breakMinutes)<0)return res.status(400).json({error:'Enter valid clock-in, clock-out and break times.'});
 const [rows]=await db.execute(`SELECT c.*,s.hourly_pay,s.starts_at AS scheduled_start,s.ends_at AS scheduled_end
   FROM checkouts c JOIN shifts s ON s.id=c.shift_id WHERE c.id=? AND c.worker_id=?`,[req.params.id,req.user.id]);
 if(!rows.length)return res.status(404).json({error:'Checkout not found.'});
 const checkout=rows[0];
 if(String(checkout.status).toLowerCase()!=='open')return res.status(409).json({error:'Only an open checkout can be submitted.'});
 if(checkout.clocked_in_at&&!checkout.clocked_out_at)return res.status(400).json({error:'Please clock out before sending this checkout for approval.'});
 const startValue=String(actualStart).replace('T',' ').slice(0,19);
 const endValue=String(actualEnd).replace('T',' ').slice(0,19);
 const originalStart=checkout.clocked_in_at||checkout.scheduled_start;
 const originalEnd=checkout.clocked_out_at||checkout.scheduled_end;
 const minuteTimestamp=value=>{const stamp=new Date(value).getTime();return Number.isFinite(stamp)?Math.floor(stamp/60000)*60000:NaN;};
 const changedStart=minuteTimestamp(actualStart)!==minuteTimestamp(originalStart);
 const changedEnd=minuteTimestamp(actualEnd)!==minuteTimestamp(originalEnd);
 if((changedStart||changedEnd)&&(!String(reason).trim()||String(reason).trim().length<5))return res.status(400).json({error:'Please give a reason of at least 5 characters for changing your clock-in or clock-out times.'});
 let calc;try{calc=calculatePay({hourlyPay:checkout.hourly_pay,startsAt:actualStart,endsAt:actualEnd,breakMinutes:Number(breakMinutes)});}catch(e){return res.status(400).json({error:e.message});}
 await db.execute("UPDATE checkouts SET actual_start=?,actual_end=?,break_minutes=?,worker_comment=?,worker_adjustment_reason=?,gross_pay=?,platform_fee=?,status='submitted' WHERE id=?",
   [startValue,endValue,Number(breakMinutes),String(reason).trim()||null,(changedStart||changedEnd)?String(reason).trim():null,calc.grossPay,calc.platformFee,checkout.id]);
 await audit(req,'checkout.submitted','checkout',checkout.id,{clockedInAt:checkout.clocked_in_at,clockedOutAt:checkout.clocked_out_at,adjusted:changedStart||changedEnd,adjustmentReason:(changedStart||changedEnd)?String(reason).trim():null});
 res.json({ok:true,id:checkout.id,...calc,status:'submitted'});
}));
app.post('/api/checkouts',auth,allow('worker'),requireVerification,asyncRoute(async(req,res)=>{
 const {shiftId,actualStart,actualEnd,breakMinutes=0,comment=''}=req.body;
 const [a]=await db.execute("SELECT a.id,s.hourly_pay FROM applications a JOIN shifts s ON s.id=a.shift_id WHERE a.shift_id=? AND a.worker_id=? AND a.status='approved'",[shiftId,req.user.id]);
 if(!a.length)return res.status(403).json({error:'You must be approved for this shift'});
 let calc;try{calc=calculatePay({hourlyPay:a[0].hourly_pay,startsAt:actualStart,endsAt:actualEnd,breakMinutes});}catch(e){return res.status(400).json({error:e.message});}
 const [r]=await db.execute('INSERT INTO checkouts(shift_id,worker_id,actual_start,actual_end,break_minutes,worker_comment,gross_pay,platform_fee) VALUES(?,?,?,?,?,?,?,?)',
 [shiftId,req.user.id,actualStart,actualEnd,breakMinutes,comment,calc.grossPay,calc.platformFee]);
 await audit(req,'checkout.submitted','checkout',r.insertId);res.status(201).json({id:r.insertId,...calc,status:'submitted'});
}));
app.get('/api/checkouts/mine',auth,asyncRoute(async(req,res)=>{
 await ensureClockCheckoutColumns;
 if(req.user.role==='worker'){
  await db.execute(`INSERT INTO checkouts(shift_id,worker_id,actual_start,actual_end,break_minutes,worker_comment,gross_pay,platform_fee,status,is_test)
   SELECT s.id,a.worker_id,s.starts_at,s.ends_at,0,'Automatically opened after scheduled shift end',ROUND(s.hourly_pay*GREATEST(0,TIMESTAMPDIFF(MINUTE,s.starts_at,s.ends_at))/60,2),ROUND((CASE WHEN s.hourly_pay<=20 THEN 2 ELSE s.hourly_pay*0.10 END)*GREATEST(0,TIMESTAMPDIFF(MINUTE,s.starts_at,s.ends_at))/60,2),'open',0
   FROM applications a JOIN shifts s ON s.id=a.shift_id
   WHERE a.worker_id=? AND a.status='approved' AND s.ends_at<=NOW()
    AND NOT EXISTS(SELECT 1 FROM checkouts c WHERE c.shift_id=s.id AND c.worker_id=a.worker_id AND c.status IN ('open','submitted','approved','paid','completed','disputed'))`,[req.user.id]);
 }
 const sql=req.user.role==='worker'
 ? 'SELECT c.*,s.title,s.location,s.starts_at,s.ends_at,s.hourly_pay FROM checkouts c JOIN shifts s ON s.id=c.shift_id WHERE c.worker_id=? ORDER BY c.created_at DESC'
 : `SELECT c.*,s.title,u.first_name,u.last_name FROM checkouts c JOIN shifts s ON s.id=c.shift_id JOIN businesses b ON b.id=s.business_id JOIN users u ON u.id=c.worker_id WHERE b.owner_user_id=? ORDER BY c.created_at DESC`;
 const [rows]=await db.execute(sql,[req.user.id]);res.json({checkouts:rows});
}));
app.post('/api/checkouts/:id/counter-offer',auth,allow('employer'),requireVerification,asyncRoute(async(req,res)=>{
 await ensureCheckoutCounterColumns;
 const {comment='',actualStart,actualEnd,breakMinutes}=req.body||{};
 if(typeof comment!=='string'||comment.trim().length<3||comment.length>3000)return res.status(400).json({error:'Please provide a counter-offer comment of 3-3000 characters'});
 const [rows]=await db.execute(`SELECT c.id,c.shift_id,c.worker_id,s.hourly_pay,b.id AS business_id FROM checkouts c JOIN shifts s ON s.id=c.shift_id JOIN businesses b ON b.id=s.business_id WHERE c.id=? AND b.owner_user_id=?`,[req.params.id,req.user.id]);
 if(!rows.length)return res.status(404).json({error:'Checkout not found'});
 let gross=null;
 if(actualStart||actualEnd||breakMinutes!==undefined){
  if(!actualStart||!actualEnd||!Number.isInteger(Number(breakMinutes))||Number(breakMinutes)<0)return res.status(400).json({error:'Provide start, end and a non-negative break duration together'});
  try { gross=calculatePay({hourlyPay:rows[0].hourly_pay,startsAt:actualStart,endsAt:actualEnd,breakMinutes:Number(breakMinutes)}).grossPay; }
  catch(e){return res.status(400).json({error:e.message});}
 }
 await db.execute('UPDATE checkouts SET employer_comment=?,counter_start=?,counter_end=?,counter_break_minutes=?,counter_gross_pay=?,status=\'disputed\' WHERE id=?',[comment.trim(),actualStart||null,actualEnd||null,breakMinutes===undefined?null:Number(breakMinutes),gross,req.params.id]);
 const [existing]=await db.execute("SELECT id FROM disputes WHERE checkout_id=? AND status IN ('open','assigned') LIMIT 1",[req.params.id]);
 if(!existing.length) await db.execute('INSERT INTO disputes(checkout_id,opened_by,reason) VALUES(?,?,?)',[req.params.id,req.user.id,'Employer counter-offer: '+comment.trim()]);
 await audit(req,'checkout.counter_offer_submitted','checkout',req.params.id,{comment:comment.trim(),actualStart:actualStart||null,actualEnd:actualEnd||null,breakMinutes:breakMinutes??null,counterGrossPay:gross});
 res.status(201).json({ok:true,status:'disputed',counterGrossPay:gross});
}));

app.patch('/api/checkouts/:id/review',auth,requireVerification,asyncRoute(async(req,res)=>{
 if(!['employer','admin'].includes(req.user.role))return res.status(403).json({error:'Insufficient permissions'});
 const status=req.body.status;if(!['approved','rejected','disputed'].includes(status))return res.status(400).json({error:'Invalid status'});
 let query='SELECT c.id,c.shift_id FROM checkouts c JOIN shifts s ON s.id=c.shift_id JOIN businesses b ON b.id=s.business_id WHERE c.id=?';
 const args=[req.params.id];
 if(req.user.role==='employer'){query+=' AND b.owner_user_id=?';args.push(req.user.id);}
 const [rows]=await db.execute(query,args);if(!rows.length)return res.status(404).json({error:'Checkout not found'});
 await db.execute('UPDATE checkouts SET status=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?',[status,req.user.id,req.params.id]);
 await audit(req,'checkout.'+status,'checkout',req.params.id);
 if(status==='approved'){
  const [business]=await db.execute('SELECT business_id FROM shifts WHERE id=?',[rows[0].shift_id]);
  const [c]=await db.execute('SELECT * FROM checkouts WHERE id=?',[req.params.id]);
  const due=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
  await db.execute("INSERT IGNORE INTO invoices(business_id,checkout_id,subtotal,platform_fee,total,due_at,status) VALUES(?,?,?,?,?,?,'issued')",
  [business[0].business_id, c[0].id,c[0].gross_pay,c[0].platform_fee,Number(c[0].gross_pay)+Number(c[0].platform_fee),due]);
 }
 res.json({ok:true,status});
}));
app.post('/api/ratings',auth,asyncRoute(async(req,res)=>{
 const {shiftId,revieweeId,score,comment}=req.body;
 if(!Number.isInteger(Number(score))||score<1||score>10)return res.status(400).json({error:'Score must be between 1 and 10'});
 const [done]=await db.execute("SELECT id FROM checkouts WHERE shift_id=? AND status='approved' AND (worker_id=? OR shift_id IN (SELECT id FROM shifts WHERE created_by=?))",[shiftId,req.user.id,req.user.id]);
 if(!done.length)return res.status(403).json({error:'Ratings require a completed approved checkout'});
 const [r]=await db.execute('INSERT INTO ratings(shift_id,reviewer_id,reviewee_id,score,comment) VALUES(?,?,?,?,?)',[shiftId,req.user.id,revieweeId,score,comment||null]);
 res.status(201).json({id:r.insertId});
}));
app.get('/api/ratings/shift/:shiftId',auth,asyncRoute(async(req,res)=>{const [rows]=await db.execute('SELECT r.*,u.first_name,u.last_name FROM ratings r JOIN users u ON u.id=r.reviewer_id WHERE r.shift_id=?',[req.params.shiftId]);res.json({ratings:rows});}));

// Employer payment automation preferences. These settings do not charge a payment method by themselves;
// actual automatic collection/top-ups require a configured payment provider and confirmed payment methods.
let employerPaymentPreferencesReady;
async function ensureEmployerPaymentPreferences(){
 if(!employerPaymentPreferencesReady)employerPaymentPreferencesReady=db.query(`CREATE TABLE IF NOT EXISTS employer_payment_preferences (
  employer_user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  auto_top_up_enabled TINYINT(1) NOT NULL DEFAULT 0,
  top_up_threshold DECIMAL(10,2) NOT NULL DEFAULT 50.00,
  top_up_amount DECIMAL(10,2) NOT NULL DEFAULT 100.00,
  auto_pay_enabled TINYINT(1) NOT NULL DEFAULT 0,
  auto_pay_cadence VARCHAR(16) NOT NULL DEFAULT '7_days',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 ) ENGINE=InnoDB`);
 await employerPaymentPreferencesReady;
}
function serializePaymentPreferences(row){
 return {autoTopUpEnabled:Boolean(row?.auto_top_up_enabled),topUpThreshold:Number(row?.top_up_threshold??50).toFixed(2),topUpAmount:Number(row?.top_up_amount??100).toFixed(2),autoPayEnabled:Boolean(row?.auto_pay_enabled),autoPayCadence:row?.auto_pay_cadence||'7_days'};
}
app.get('/api/employer/payment-preferences',auth,allow('employer'),asyncRoute(async(req,res)=>{
 await ensureEmployerPaymentPreferences();
 const [rows]=await db.execute('SELECT * FROM employer_payment_preferences WHERE employer_user_id=?',[req.user.id]);
 res.json({preferences:serializePaymentPreferences(rows[0])});
}));
app.put('/api/employer/payment-preferences',auth,allow('employer'),asyncRoute(async(req,res)=>{
 await ensureEmployerPaymentPreferences();
 const threshold=Number(req.body.topUpThreshold),amount=Number(req.body.topUpAmount),cadence=String(req.body.autoPayCadence||'7_days');
 if(!Number.isFinite(threshold)||threshold<1||threshold>1000000)return res.status(400).json({error:'Top-up threshold must be between £1 and £1,000,000.'});
 if(!Number.isFinite(amount)||amount<1||amount>1000000)return res.status(400).json({error:'Top-up amount must be between £1 and £1,000,000.'});
 if(!['instant','3_days','7_days','14_days'].includes(cadence))return res.status(400).json({error:'Choose a valid automatic invoice payment schedule.'});
 await db.execute(`INSERT INTO employer_payment_preferences(employer_user_id,auto_top_up_enabled,top_up_threshold,top_up_amount,auto_pay_enabled,auto_pay_cadence)
 VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE auto_top_up_enabled=VALUES(auto_top_up_enabled),top_up_threshold=VALUES(top_up_threshold),top_up_amount=VALUES(top_up_amount),auto_pay_enabled=VALUES(auto_pay_enabled),auto_pay_cadence=VALUES(auto_pay_cadence)`,
 [req.user.id,req.body.autoTopUpEnabled?1:0,threshold.toFixed(2),amount.toFixed(2),req.body.autoPayEnabled?1:0,cadence]);
 const [rows]=await db.execute('SELECT * FROM employer_payment_preferences WHERE employer_user_id=?',[req.user.id]);
 await audit(req,'employer.payment_preferences.updated','employer',req.user.id,{autoTopUpEnabled:!!req.body.autoTopUpEnabled,autoPayEnabled:!!req.body.autoPayEnabled,autoPayCadence:cadence});
 res.json({preferences:serializePaymentPreferences(rows[0])});
}));

app.get('/api/invoices/mine',auth,asyncRoute(async(req,res)=>{
 const [rows]=req.user.role==='employer'
 ? await db.execute('SELECT i.*,s.title FROM invoices i JOIN businesses b ON b.id=i.business_id JOIN checkouts c ON c.id=i.checkout_id JOIN shifts s ON s.id=c.shift_id WHERE b.owner_user_id=? ORDER BY i.created_at DESC',[req.user.id])
 : await db.execute("SELECT i.*,s.title FROM invoices i JOIN checkouts c ON c.id=i.checkout_id JOIN shifts s ON s.id=c.shift_id WHERE c.worker_id=? ORDER BY i.created_at DESC",[req.user.id]);
 res.json({invoices:rows});
}));
app.post('/api/disputes',auth,asyncRoute(async(req,res)=>{
 const {checkoutId,reason,evidenceUrl}=req.body;if(!checkoutId||!reason)return res.status(400).json({error:'Checkout and reason required'});
 const [c]=await db.execute('SELECT id,worker_id,shift_id FROM checkouts WHERE id=?',[checkoutId]);if(!c.length)return res.status(404).json({error:'Checkout not found'});
 const [s]=await db.execute('SELECT b.owner_user_id FROM shifts s JOIN businesses b ON b.id=s.business_id WHERE s.id=?',[c[0].shift_id]);
 if(req.user.id!==c[0].worker_id&&req.user.id!==s[0].owner_user_id&&req.user.role!=='admin')return res.status(403).json({error:'Not a participant in this checkout'});
 const [r]=await db.execute('INSERT INTO disputes(checkout_id,opened_by,reason,evidence_url) VALUES(?,?,?,?)',[checkoutId,req.user.id,reason,evidenceUrl||null]);
 await db.execute("UPDATE checkouts SET status='disputed' WHERE id=?",[checkoutId]);await audit(req,'dispute.opened','dispute',r.insertId);res.status(201).json({id:r.insertId,status:'open'});
}));
app.get('/api/disputes/mine',auth,asyncRoute(async(req,res)=>{
 let sql='SELECT d.* FROM disputes d';let args=[];
 if(req.user.role==='admin'){}else if(req.user.role==='worker'){sql+=' JOIN checkouts c ON c.id=d.checkout_id WHERE c.worker_id=?';args=[req.user.id];}
 else {sql+=' JOIN checkouts c ON c.id=d.checkout_id JOIN shifts s ON s.id=c.shift_id JOIN businesses b ON b.id=s.business_id WHERE b.owner_user_id=?';args=[req.user.id];}
 sql+=' ORDER BY d.created_at DESC';const [rows]=await db.execute(sql,args);res.json({disputes:rows});
}));
require('./user-message-routes')(app, { db, asyncRoute, audit });
require('./admin-routes')(app, { db, asyncRoute, audit, sendInvoiceReminder, ensureUniqueEmails });

app.get('/api/admin/overview',auth,allow('admin'),asyncRoute(async(req,res)=>{
 const [[users]]=await db.query('SELECT COUNT(*) count FROM users');
 const [[shifts]]=await db.query('SELECT COUNT(*) count FROM shifts');
 const [[disputes]]=await db.query("SELECT COUNT(*) count FROM disputes WHERE status IN ('open','assigned')");
 const [[checkouts]]=await db.query("SELECT COUNT(*) count FROM checkouts WHERE status='submitted'");
 res.json({users:users.count,shifts:shifts.count,openDisputes:disputes.count,pendingCheckouts:checkouts.count});
}));
app.get('/api/admin/verification-queue',auth,allow('admin'),adminTier(2),asyncRoute(async(req,res)=>{
 const [workers] = await db.execute(
  `SELECT u.id AS userId,u.email,u.first_name AS firstName,u.last_name AS lastName,
          u.email_verified_at AS emailVerified,u.created_at AS createdAt,
          'worker' AS role,wp.identity_verification_status AS identityStatus,
          wp.right_to_work_status AS rightToWorkStatus,
          NULL AS companyStatus,NULL AS businessName,NULL AS companyNumber
   FROM users u LEFT JOIN worker_profiles wp ON wp.user_id=u.id
   WHERE u.role='worker'
   ORDER BY u.created_at DESC LIMIT 500`
 );
 const [employers] = await db.execute(
  `SELECT u.id AS userId,u.email,u.first_name AS firstName,u.last_name AS lastName,
          u.email_verified_at AS emailVerified,u.created_at AS createdAt,
          'employer' AS role,b.identity_verification_status AS identityStatus,
          NULL AS rightToWorkStatus,b.verification_status AS companyStatus,
          b.name AS businessName,b.company_number AS companyNumber
   FROM users u LEFT JOIN businesses b ON b.owner_user_id=u.id
   WHERE u.role='employer'
   ORDER BY u.created_at DESC LIMIT 500`
 );
 const accounts=[...workers,...employers].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
 res.json({accounts});
}));

app.patch('/api/admin/verification/:role/:userId',auth,allow('admin'),adminTier(2),asyncRoute(async(req,res)=>{
 const {role,userId}=req.params;
 const {check,status,reason}=req.body||{};
 const allowedStatuses=['pending','verified','rejected','manual_review','not_started'];
 if(!['worker','employer'].includes(role)) return res.status(400).json({error:'Invalid account role'});
 if(!allowedStatuses.includes(status)) return res.status(400).json({error:'Invalid verification status'});
 if(typeof reason!=='string'||reason.trim().length<3||reason.trim().length>1000) return res.status(400).json({error:'Enter a review reason between 3 and 1000 characters'});
 let result;
 if(role==='worker'&&check==='identity'){
  result=await db.execute('UPDATE worker_profiles SET identity_verification_status=? WHERE user_id=?',[status,userId]);
 } else if(role==='worker'&&check==='right_to_work'){
  result=await db.execute('UPDATE worker_profiles SET right_to_work_status=? WHERE user_id=?',[status,userId]);
 } else if(role==='employer'&&check==='identity'){
  result=await db.execute('UPDATE businesses SET identity_verification_status=? WHERE owner_user_id=?',[status,userId]);
 } else if(role==='employer'&&check==='company'){
  result=await db.execute('UPDATE businesses SET verification_status=? WHERE owner_user_id=?',[status,userId]);
 } else {
  return res.status(400).json({error:'Invalid verification check for this account type'});
 }
 if(!result[0].affectedRows) return res.status(404).json({error:'Account verification record not found'});
 await audit(req,'verification.status_changed',role+'_verification',userId,{check,status,reason:reason.trim()});
 res.json({ok:true,role,userId,check,status});
}));

app.get('/api/admin/audit-logs',auth,allow('admin'),adminTier(2),asyncRoute(async(req,res)=>{
 const [rows]=await db.execute('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500');res.json({logs:rows});
}));
app.get('/api/admin/users',auth,allow('admin'),asyncRoute(async(req,res)=>{
 const [rows]=await db.execute('SELECT id,email,role,admin_tier,first_name,last_name,status,created_at FROM users ORDER BY created_at DESC LIMIT 500');res.json({users:rows});
}));
app.patch('/api/admin/users/:id/status',auth,allow('admin'),asyncRoute(async(req,res)=>{
 if(req.user.admin_tier===3)return res.status(403).json({error:'Tier 3 administrators cannot block users'});
 const status=req.body.status;if(!['active','blocked'].includes(status))return res.status(400).json({error:'Invalid status'});
 await db.execute('UPDATE users SET status=? WHERE id=?',[status,req.params.id]);await audit(req,'user.status_changed','user',req.params.id,{status});res.json({ok:true});
}));

const publicContactLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
app.post('/api/public-contact', publicContactLimiter, asyncRoute(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const message = String(req.body?.message || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (message.length < 5 || message.length > 5000) {
    return res.status(400).json({ error: 'Your message must be between 5 and 5000 characters.' });
  }
  if (!resend || !process.env.EMAIL_FROM) {
    return res.status(503).json({ error: 'The contact form is temporarily unavailable. Please try again later.' });
  }
  const [admins] = await db.execute("SELECT email FROM users WHERE role='admin' AND status='active' AND email IS NOT NULL");
  const recipients = admins.map(admin => admin.email).filter(Boolean);
  if (!recipients.length) {
    return res.status(503).json({ error: 'Hyrz support is temporarily unavailable. Please try again later.' });
  }
  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: recipients,
    replyTo: email,
    subject: 'New public Hyrz contact form message',
    text: 'From: ' + email + '\\n\\nMessage:\\n' + message
  });
  if (result?.error) {
    console.error('Public contact email failed:', result.error.message || result.error);
    return res.status(502).json({ error: 'We could not send your message right now. Please try again.' });
  }
  res.status(201).json({ message: 'Your message has been sent to Hyrz support.' });
}));

app.use((err,req,res,next)=>{console.error(err);res.status(err.status||500).json({error:err.status?err.message:'Internal server error'});});
const VALID_JOB_ROLES = new Set(require('../../shared/job-roles.json').flatMap(([, roles]) => roles));
const port=Number(process.env.PORT||4000);
app.listen(port,()=>{
 console.log(`hyrz API listening on http://localhost:${port}`);
 // Run regularly so imminent open shifts are removed even when nobody is browsing shifts.
 const expiryTimer=setInterval(()=>deleteImminentOpenShifts().catch(err=>console.error('Shift expiry cleanup failed:',err.message)),60*1000);
 if(typeof expiryTimer.unref==='function')expiryTimer.unref();
 deleteImminentOpenShifts().catch(err=>console.error('Initial shift expiry cleanup failed:',err.message));
});
