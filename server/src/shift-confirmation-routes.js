const { auth, allow, requireVerification } = require('./middleware');
const { normalizePostcode, extractPostcode, distanceMiles, lookupPostcodeCoordinates } = require('./postcode-distance');

module.exports = function registerShiftConfirmationRoutes(app, { db, asyncRoute, audit, resend }) {
  const ensureShiftConfirmationInvites = db.query(`
    CREATE TABLE IF NOT EXISTS shift_confirmation_invites (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      shift_id BIGINT UNSIGNED NOT NULL,
      application_id BIGINT UNSIGNED NOT NULL,
      worker_id BIGINT UNSIGNED NOT NULL,
      employer_user_id BIGINT UNSIGNED NOT NULL,
      invite_type ENUM('manual','automatic') NOT NULL DEFAULT 'manual',
      status ENUM('pending','confirmed','declined','expired') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME NULL,
      UNIQUE KEY uq_shift_confirmation_worker (shift_id,worker_id),
      KEY idx_shift_confirmation_worker_status (worker_id,status),
      KEY idx_shift_confirmation_shift_status (shift_id,status),
      CONSTRAINT fk_shift_confirmation_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
      CONSTRAINT fk_shift_confirmation_application FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
      CONSTRAINT fk_shift_confirmation_worker FOREIGN KEY (worker_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_shift_confirmation_employer FOREIGN KEY (employer_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  function parseJson(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : fallback; } catch {} }
    return fallback;
  }
  function timeMinutes(value) {
    if (typeof value !== 'string' || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(value)) return null;
    const [h,m] = value.split(':').map(Number); return h * 60 + m;
  }
  function availabilityMatches(row, shift) {
    const timings = typeof row.timings === 'string' ? (() => { try { return JSON.parse(row.timings); } catch { return {}; } })() : (row.timings || {});
    const timing = timings[shift.shift_date];
    if (!timing || timing.confirmed === false) return false;
    const roles = parseJson(row.roles), types = parseJson(row.shift_types);
    if (roles.length && !roles.includes(shift.title)) return false;
    if (types.length && !types.includes(shift.shift_type)) return false;
    if (Number(row.min_hourly_rate || 8) > Number(shift.hourly_pay)) return false;
    const hours = Math.max(0, (new Date(shift.ends_at) - new Date(shift.starts_at)) / 3600000 - Number(shift.break_minutes || 0) / 60);
    if (Number(row.min_total_pay || 0) > Number(shift.hourly_pay) * hours) return false;
    const start = timeMinutes(String(shift.shift_start).slice(0,5));
    const end = timeMinutes(String(shift.shift_end).slice(0,5));
    const availableStart = timing.start === 'anytime' ? 0 : timeMinutes(timing.start);
    let availableEnd = timing.end === 'shift_end' ? 2880 : timeMinutes(timing.end);
    if (typeof timing.end === 'string' && timing.end.startsWith('nextday:')) availableEnd = 1440 + timeMinutes(timing.end.slice(8));
    let shiftEnd = end;
    if (shift.shift_end_date !== shift.shift_date) shiftEnd += 1440;
    if (availableStart === null || availableEnd === null || start === null) return false;
    return start >= availableStart && shiftEnd <= availableEnd;
  }
  async function sendInviteEmail(worker, shift, businessName) {
    if (!resend || !process.env.EMAIL_FROM || !worker.email) return;
    const appUrl = process.env.APP_URL || 'https://hyrz.co.uk';
    const safe = value => String(value || '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
    try {
      await resend.emails.send({
        from: process.env.EMAIL_FROM, to: worker.email,
        subject: 'Confirm your shift on hyrz',
        html: '<p>Hello ' + safe(worker.first_name || 'there') + ',</p><p>' + safe(businessName) + ' has invited you to confirm ' + safe(shift.title) + ' on ' + safe(new Date(shift.starts_at).toLocaleString('en-GB')) + '.</p><p>Open your hyrz account to confirm. Positions are allocated to the first workers who confirm.</p><p><a href="' + safe(appUrl) + '">Open hyrz</a></p>'
      });
    } catch (error) { console.error('Shift confirmation email failed:', error.message); }
  }

  app.get('/api/shift-confirmations/mine', auth, allow('worker'), (req, res, next) => ensureShiftConfirmationInvites.then(() => asyncRoute(async (request, response) => {
    if (request.user.role !== 'worker') return response.status(403).json({ error: 'Worker accounts only.' });
    const [rows] = await db.execute(`
      SELECT i.id AS invite_id,i.invite_type,i.created_at AS invited_at,
             a.id AS application_id,a.confirmed_preferences,
             s.id AS shift_id,s.title,s.description,s.location,s.starts_at,s.ends_at,
             s.break_minutes,s.hourly_pay,s.requirements,s.preferences,s.perks,
             b.name AS business_name
      FROM shift_confirmation_invites i
      JOIN applications a ON a.id=i.application_id
      JOIN shifts s ON s.id=i.shift_id
      JOIN businesses b ON b.id=s.business_id
      WHERE i.worker_id=? AND i.status='pending' AND s.starts_at>UTC_TIMESTAMP()
      ORDER BY s.starts_at,i.created_at
    `, [request.user.id]);
    response.json({ confirmations: rows });
  }))(req,res,next).catch(next));

  app.post('/api/shift-confirmations/:id/respond', auth, allow('worker'), requireVerification, (req, res, next) => ensureShiftConfirmationInvites.then(() => asyncRoute(async (request, response) => {
    if (request.user.role !== 'worker') return response.status(403).json({ error: 'Worker accounts only.' });
    const decision = request.body?.decision;
    if (!['confirm','decline'].includes(decision)) return response.status(400).json({ error: 'Choose confirm or decline.' });
    const conn = await db.getConnection();
    let shiftId, applicationId, workerId;
    try {
      await conn.beginTransaction();
      const [invites] = await conn.execute(`
        SELECT i.*,s.starts_at,s.ends_at,s.title,s.location,s.hourly_pay,s.break_minutes,s.requirements,s.preferences,s.perks,
               s.slots,s.status AS shift_status,b.name AS business_name,u.first_name,u.last_name,u.email
        FROM shift_confirmation_invites i
        JOIN shifts s ON s.id=i.shift_id
        JOIN businesses b ON b.id=s.business_id
        JOIN users u ON u.id=i.worker_id
        WHERE i.id=? AND i.worker_id=? FOR UPDATE
      `, [request.params.id, request.user.id]);
      if (!invites.length || invites[0].status !== 'pending') { await conn.rollback(); return response.status(404).json({ error: 'This confirmation request is no longer available.' }); }
      const invite = invites[0]; shiftId = invite.shift_id; applicationId = invite.application_id; workerId = invite.worker_id;
      if (new Date(invite.starts_at).getTime() <= Date.now() || invite.shift_status !== 'open') {
        await conn.execute("UPDATE shift_confirmation_invites SET status='expired',responded_at=UTC_TIMESTAMP() WHERE id=?", [invite.id]);
        await conn.execute("UPDATE applications SET status='rejected' WHERE id=? AND status='pending'", [invite.application_id]);
        await conn.commit(); return response.status(409).json({ error: 'This shift confirmation has expired.' });
      }
      if (decision === 'decline') {
        await conn.execute("UPDATE shift_confirmation_invites SET status='declined',responded_at=UTC_TIMESTAMP() WHERE id=?", [invite.id]);
        await conn.execute("UPDATE applications SET status='rejected' WHERE id=? AND status='pending'", [applicationId]);
        await conn.commit();
        await audit(request, 'shift.confirmation_declined', 'application', applicationId, { shiftId });
        return response.json({ ok: true, status: 'declined' });
      }
      if (invite.invite_type === 'automatic' && request.body?.contractAccepted !== true) {
        await conn.rollback(); return response.status(400).json({ error: 'Please review and accept the shift contract before confirming.' });
      }
      const [locked] = await conn.execute('SELECT id,slots,status,starts_at,ends_at,title,location,hourly_pay,break_minutes,description,requirements,preferences,perks FROM shifts WHERE id=? FOR UPDATE', [shiftId]);
      const shift = locked[0];
      const [[counts]] = await conn.execute("SELECT COUNT(*) AS approved_count FROM applications WHERE shift_id=? AND status='approved'", [shiftId]);
      if (Number(counts.approved_count || 0) >= Number(shift.slots || 1)) {
        await conn.execute("UPDATE shift_confirmation_invites SET status='expired',responded_at=UTC_TIMESTAMP() WHERE shift_id=? AND status='pending'", [shiftId]);
        await conn.execute("UPDATE applications SET status='rejected' WHERE shift_id=? AND status='pending'", [shiftId]);
        await conn.commit(); return response.status(409).json({ error: 'All positions for this shift have already been filled.' });
      }
      if (invite.invite_type === 'automatic') {
        const start = new Date(shift.starts_at), end = new Date(shift.ends_at);
        const hours = Math.max(0, (end-start)/3600000 - Number(shift.break_minutes || 0)/60);
        const list = value => parseJson(value);
        const safeDate = start.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
        const snapshot = { version:'hyrz-shift-contract-v1', employer:invite.business_name, worker:[invite.first_name,invite.last_name].filter(Boolean).join(' ') || invite.email, role:shift.title, location:shift.location, date:safeDate, startTime:start.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}), endTime:end.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}), hours:Number(hours.toFixed(2)), hourlyRate:Number(shift.hourly_pay), grossPay:Number((Number(shift.hourly_pay)*hours).toFixed(2)), breakMinutes:Number(shift.break_minutes||0), description:shift.description||'Duties as reasonably described by the employer.', requirements:list(shift.requirements), preferences:list(shift.preferences), perks:list(shift.perks), cancellation:'Cancellations are handled under the hyrz platform rules and applicable law.' };
        await conn.execute("UPDATE applications SET status='approved',contract_accepted_at=UTC_TIMESTAMP(),contract_snapshot=? WHERE id=?", [JSON.stringify(snapshot),applicationId]);
      } else {
        await conn.execute("UPDATE applications SET status='approved' WHERE id=? AND status='pending'", [applicationId]);
      }
      await conn.execute("UPDATE shift_confirmation_invites SET status='confirmed',responded_at=UTC_TIMESTAMP() WHERE id=?", [invite.id]);
      const [after] = await conn.execute("SELECT COUNT(*) AS approved_count FROM applications WHERE shift_id=? AND status='approved'", [shiftId]);
      if (Number(after[0].approved_count || 0) >= Number(shift.slots || 1)) {
        await conn.execute("UPDATE shift_confirmation_invites SET status='expired',responded_at=UTC_TIMESTAMP() WHERE shift_id=? AND status='pending'", [shiftId]);
        await conn.execute("UPDATE applications SET status='rejected' WHERE shift_id=? AND status='pending'", [shiftId]);
      }
      await conn.commit();
    } catch (error) {
      try { await conn.rollback(); } catch {}
      throw error;
    } finally { conn.release(); }
    await audit(request, 'shift.confirmation_accepted', 'application', applicationId, { shiftId });
    response.json({ ok: true, status: 'approved' });
  }))(req,res,next).catch(next));

  app.post('/api/shifts/:id/automatic-invites', auth, allow('employer'), requireVerification, (req, res, next) => ensureShiftConfirmationInvites.then(() => asyncRoute(async (request, response) => {
    if (request.user.role !== 'employer') return response.status(403).json({ error: 'Employer accounts only.' });
    const shiftId = Number(request.params.id);
    const [shifts] = await db.execute(`
      SELECT s.*,b.owner_user_id,b.name AS business_name,
             DATE_FORMAT(s.starts_at,'%Y-%m-%d') AS shift_date,
             DATE_FORMAT(s.starts_at,'%H:%i') AS shift_start,
             DATE_FORMAT(s.ends_at,'%H:%i') AS shift_end,
             DATE_FORMAT(s.ends_at,'%Y-%m-%d') AS shift_end_date,
             COALESCE(s.shift_type,'hospitality') AS shift_type
      FROM shifts s JOIN businesses b ON b.id=s.business_id
      WHERE s.id=? AND b.owner_user_id=? AND s.status='open'
    `, [shiftId, request.user.id]);
    if (!shifts.length) return response.status(404).json({ error: 'Open shift not found.' });
    const shift = shifts[0];
    const hoursUntilStart = new Date(shift.starts_at).getTime() - Date.now();
    if (hoursUntilStart < 0 || hoursUntilStart > 16 * 60 * 60 * 1000) return response.status(409).json({ error: 'Automatic confirmation invitations can only be sent within 16 hours of the shift start.' });
    await db.query("CREATE TABLE IF NOT EXISTS worker_employer_favourites (worker_user_id BIGINT UNSIGNED NOT NULL,business_id BIGINT UNSIGNED NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(worker_user_id,business_id)) ENGINE=InnoDB");
    await db.query("CREATE TABLE IF NOT EXISTS worker_availability (user_id BIGINT UNSIGNED PRIMARY KEY, timings JSON NOT NULL, min_hourly_rate DECIMAL(8,2) NOT NULL DEFAULT 8.00, min_total_pay DECIMAL(8,2) NOT NULL DEFAULT 20.00, max_distance INT NOT NULL DEFAULT 10, roles JSON NOT NULL, shift_types JSON NOT NULL, automatic_enabled TINYINT(1) NOT NULL DEFAULT 0, employer_mode VARCHAR(20) NOT NULL DEFAULT 'all', preferred_employer_ids JSON NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB");
    const [workers] = await db.execute(`
      SELECT u.id,u.email,u.first_name,wa.timings,wa.roles,wa.shift_types,wa.min_hourly_rate,wa.min_total_pay,
             wa.employer_mode,wa.preferred_employer_ids,wa.max_distance,
             COALESCE(NULLIF(TRIM(wp.postcode),''),NULLIF(TRIM(u.address_postcode),'')) AS worker_postcode,
             b.postcode AS employer_postcode,s.location AS shift_location,
             EXISTS(SELECT 1 FROM worker_employer_favourites wf WHERE wf.worker_user_id=u.id AND wf.business_id=?) AS employer_is_favourite
      FROM worker_availability wa JOIN users u ON u.id=wa.user_id
      LEFT JOIN worker_profiles wp ON wp.user_id=u.id
      JOIN businesses b ON b.id=? JOIN shifts s ON s.id=?
      WHERE u.role='worker' AND u.status='active' AND wa.automatic_enabled=1
    `, [shift.business_id, shift.business_id, shiftId]);
    const postcodes = [...new Set(workers.flatMap(worker => [normalizePostcode(worker.worker_postcode), extractPostcode(worker.shift_location) || normalizePostcode(worker.employer_postcode)]).filter(Boolean))];
    let coordinates = new Map();
    try { coordinates = await lookupPostcodeCoordinates(postcodes); } catch (error) { console.warn('Could not calculate automatic-match distances:', error.message); }
    const destinationPostcode = extractPostcode(shift.location) || normalizePostcode(shift.employer_postcode);
    const destinationCoordinates = coordinates.get(destinationPostcode) || null;
    const eligible = workers.filter(worker => {
      if (!availabilityMatches(worker, shift)) return false;
      const originPostcode = normalizePostcode(worker.worker_postcode);
      const originCoordinates = coordinates.get(originPostcode) || null;
      if (originCoordinates && destinationCoordinates) {
        const miles = distanceMiles(originCoordinates, destinationCoordinates);
        if (Number.isFinite(miles) && miles > Number(worker.max_distance || 10)) return false;
      }
      if (worker.employer_mode === 'selected') return parseJson(worker.preferred_employer_ids).map(Number).includes(Number(shift.business_id));
      if (worker.employer_mode === 'favourites' && !Number(worker.employer_is_favourite)) return false;
      return true;
    });
    const conn = await db.getConnection();
    const invited = [];
    try {
      await conn.beginTransaction();
      const [locked] = await conn.execute('SELECT id,slots,status FROM shifts WHERE id=? FOR UPDATE', [shiftId]);
      if (!locked.length || locked[0].status !== 'open') throw Object.assign(new Error('This shift is no longer open.'), { status: 409 });
      for (const worker of eligible) {
        const [existing] = await conn.execute('SELECT id,status FROM applications WHERE shift_id=? AND worker_id=? LIMIT 1 FOR UPDATE', [shiftId, worker.id]);
        let applicationId;
        if (existing.length && !['withdrawn','rejected','cancelled'].includes(existing[0].status)) continue;
        if (existing.length) {
          await conn.execute("UPDATE applications SET status='pending',contract_accepted_at=NULL,contract_snapshot=NULL WHERE id=?", [existing[0].id]);
          applicationId = existing[0].id;
        } else {
          const [created] = await conn.execute("INSERT INTO applications(shift_id,worker_id,status,confirmed_preferences) VALUES(?,?,'pending','[]')", [shiftId, worker.id]);
          applicationId = created.insertId;
        }
        await conn.execute(`INSERT INTO shift_confirmation_invites(shift_id,application_id,worker_id,employer_user_id,invite_type,status)
          VALUES(?,?,?,?, 'automatic','pending')
          ON DUPLICATE KEY UPDATE application_id=VALUES(application_id),employer_user_id=VALUES(employer_user_id),invite_type='automatic',status='pending',created_at=CURRENT_TIMESTAMP,responded_at=NULL`,
          [shiftId, applicationId, worker.id, request.user.id]);
        invited.push(worker);
      }
      await conn.commit();
    } catch (error) {
      try { await conn.rollback(); } catch {}
      if (error.status) return response.status(error.status).json({ error: error.message });
      throw error;
    } finally { conn.release(); }
    for (const worker of invited) await sendInviteEmail(worker, shift, shift.business_name);
    await audit(request, 'shift.automatic_confirmation_invites_sent', 'shift', shiftId, { invitedWorkers: invited.length, availablePositions: Number(shift.slots || 1) });
    response.status(201).json({ ok: true, invitedWorkers: invited.length, message: invited.length ? 'Confirmation invitations sent to all eligible workers.' : 'No workers with matching confirmed automatic availability were found.' });
  }))(req,res,next).catch(next));
};
