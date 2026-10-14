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
const adminLoginNamesReady = db.query(`CREATE TABLE IF NOT EXISTS admin_login_names (user_id BIGINT UNSIGNED PRIMARY KEY, username VARCHAR(80) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`).catch(err => { console.error('Could not initialise administrator usernames:', err.message); throw err; });
const ensureBlockedIdentifiers = db.query(`CREATE TABLE IF NOT EXISTS blocked_identifiers (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, identifier_type ENUM('company_number','national_insurance','worker_permit') NOT NULL, identifier_hash CHAR(64) NOT NULL, blocked_user_id BIGINT UNSIGNED NULL, created_by BIGINT UNSIGNED NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_blocked_identifier(identifier_type,identifier_hash), FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE SET NULL, FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL)`).catch(err=>{console.error('Could not initialise blocked identifiers:',err.message);throw err;});
const ensureCheckoutCounterColumns = Promise.all([
  db.query('ALTER TABLE checkouts ADD COLUMN employer_comment TEXT NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;}),
  db.query('ALTER TABLE checkouts ADD COLUMN counter_start DATETIME NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;}),
  db.query('ALTER TABLE checkouts ADD COLUMN counter_end DATETIME NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;}),
  db.query('ALTER TABLE checkouts ADD COLUMN counter_break_minutes INT NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;}),
  db.query('ALTER TABLE checkouts ADD COLUMN counter_gross_pay DECIMAL(10,2) NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;})
]).catch(err=>{console.error('Could not initialise checkout counter-offer fields:',err.message);throw err;});
const ensureWorkerIdentifierColumns = Promise.all([
  db.query('ALTER TABLE worker_profiles ADD COLUMN national_insurance_hash CHAR(64) NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;}),
  db.query('ALTER TABLE worker_profiles ADD COLUMN worker_permit_hash CHAR(64) NULL').catch(e=>{if(e.code!=='ER_DUP_FIELDNAME')throw e;})
]).catch(err=>{console.error('Could not initialise worker identifier hashes:',err.message);throw err;});
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
    businessName, companyNumber, companyRole, postcode, nationalInsuranceNumber, workerPermitNumber, confirmPassword
  } = req.body;

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

  if (role === 'employer' && (!businessName || !String(companyRole || '').trim())) {
    return res.status(400).json({
      error: 'Business name and your role at the company are required'
    });
  }

  if (role === 'worker' && !String(nationalInsuranceNumber||'').trim() && !String(workerPermitNumber||'').trim()) return res.status(400).json({error:'A National Insurance number or worker permit number is required for account security checks.'});

  const normalizedEmail = email.toLowerCase().trim();
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
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [result] = await conn.execute(
      'INSERT INTO users (email,password_hash,role,first_name,last_name,email_verification_token_hash,email_verification_expires_at) VALUES (?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE))',
      [
        normalizedEmail,
        await bcrypt.hash(password, 12),
        role,
        firstName,
        lastName,
        tokenHash
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
      await conn.execute(
        'INSERT INTO businesses (owner_user_id,name,company_number,postcode,role_at_company) VALUES (?,?,?,?,?)',
        [
          result.insertId,
          String(businessName).trim(),
          companyNumber || null,
          postcode || null,
          String(companyRole).trim()
        ]
      );
    }

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
      email: normalizedEmail
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
     WHERE u.email=? OR (u.role='admin' AND n.username=?) LIMIT 1`,
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

app.get('/api/auth/me',auth,asyncRoute(async(req,res)=>{const [u]=await db.execute('SELECT id,email,role,admin_tier,first_name,last_name,phone,status,created_at FROM users WHERE id=?',[req.user.id]);res.json({user:u[0]});}));
app.patch('/api/auth/profile', auth, asyncRoute(async (req, res) => {
  const firstName = String(req.body.firstName || '').trim();
  const lastName = String(req.body.lastName || '').trim();
  const phone = String(req.body.phone || '').trim();
  if (firstName.length > 100 || lastName.length > 100 || phone.length > 40) {
    return res.status(400).json({ error: 'Name or phone number is too long.' });
  }
  await db.execute(
    'UPDATE users SET first_name=?, last_name=?, phone=? WHERE id=?',
    [firstName || null, lastName || null, phone || null, req.user.id]
  );
  const [rows] = await db.execute(
    'SELECT id,email,role,admin_tier,first_name,last_name,phone,status,created_at FROM users WHERE id=?',
    [req.user.id]
  );
  return res.json({ user: rows[0] });
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
app.get('/api/profile',auth,asyncRoute(async(req,res)=>{
 const [u]=await db.execute('SELECT id,email,role,first_name,last_name,phone FROM users WHERE id=?',[req.user.id]);
 if(req.user.role==='worker'){const [p]=await db.execute('SELECT bio,skills,postcode,hourly_rate,right_to_work_status,availability FROM worker_profiles WHERE user_id=?',[req.user.id]);return res.json({user:u[0],profile:p[0]||{}});}
 res.json({user:u[0]});
}));
app.put('/api/profile',auth,asyncRoute(async(req,res)=>{
 const {firstName,lastName,phone,bio,skills,postcode,hourlyRate,availability}=req.body;
 await db.execute('UPDATE users SET first_name=?,last_name=?,phone=? WHERE id=?',[firstName||null,lastName||null,phone||null,req.user.id]);
 if(req.user.role==='worker') await db.execute('UPDATE worker_profiles SET bio=?,skills=?,postcode=?,hourly_rate=?,availability=? WHERE user_id=?',
 [bio||null,JSON.stringify(skills||[]),postcode||null,hourlyRate||null,JSON.stringify(availability||[]),req.user.id]);
 await audit(req,'profile.updated','user',req.user.id);res.json({ok:true});
}));
app.get('/api/shifts',auth,asyncRoute(async(req,res)=>{
 const {postcode,from,to,search}=req.query;
 let sql=`SELECT s.*,b.name AS business_name FROM shifts s JOIN businesses b ON b.id=s.business_id WHERE s.status='open'`;
 const args=[];
 if(from){sql+=' AND s.starts_at>=?';args.push(from);}
 if(to){sql+=' AND s.starts_at<=?';args.push(to);}
 if(search){sql+=' AND (s.title LIKE ? OR s.description LIKE ? OR s.location LIKE ?)';args.push(`%${search}%`,`%${search}%`,`%${search}%`);}
 if(postcode){sql+=' AND s.location LIKE ?';args.push(`%${postcode}%`);}
 sql+=' ORDER BY s.starts_at LIMIT 200';
 const [rows]=await db.execute(sql,args);res.json({shifts:rows});
}));
app.post('/api/shifts',auth,allow('employer'),requireVerification,asyncRoute(async(req,res)=>{
 const {title,description,location,startsAt,endsAt,breakMinutes=0,hourlyPay,slots=1,autoApprove=false}=req.body;
 if(!title||!location||!startsAt||!endsAt||new Date(endsAt)<=new Date(startsAt)||Number(hourlyPay)<=0||Number(slots)<1||Number(breakMinutes)<0) return res.status(400).json({error:'Invalid shift details'});
 const [bs]=await db.execute('SELECT id FROM businesses WHERE owner_user_id=?',[req.user.id]);
 if(!bs.length)return res.status(400).json({error:'Business profile missing'});
 const [r]=await db.execute('INSERT INTO shifts(business_id,created_by,title,description,location,starts_at,ends_at,break_minutes,hourly_pay,slots,auto_approve) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
 [bs[0].id,req.user.id,title,description||null,location,startsAt,endsAt,breakMinutes,hourlyPay,slots,!!autoApprove]);
 await audit(req,'shift.created','shift',r.insertId);res.status(201).json({id:r.insertId});
}));
app.get('/api/shifts/:id',auth,asyncRoute(async(req,res)=>{
 const [rows]=await db.execute('SELECT s.*,b.name AS business_name FROM shifts s JOIN businesses b ON b.id=s.business_id WHERE s.id=?',[req.params.id]);
 if(!rows.length)return res.status(404).json({error:'Shift not found'});res.json({shift:rows[0]});
}));
app.post('/api/shifts/:id/apply',auth,allow('worker'),requireVerification,asyncRoute(async(req,res)=>{
 const [s]=await db.execute('SELECT id,status,auto_approve FROM shifts WHERE id=?',[req.params.id]);
 if(!s.length||s[0].status!=='open')return res.status(404).json({error:'Shift not available'});
 try {
 const [r]=await db.execute('INSERT INTO applications(shift_id,worker_id,status) VALUES(?,?,?)',[req.params.id,req.user.id,s[0].auto_approve?'approved':'pending']);
 res.status(201).json({id:r.insertId,status:s[0].auto_approve?'approved':'pending'});
 }catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Already applied'});throw e;}
}));
app.get('/api/applications/mine',auth,asyncRoute(async(req,res)=>{
 const sql=req.user.role==='worker'
 ? `SELECT a.*,s.title,s.location,s.starts_at,s.ends_at,s.hourly_pay,b.name business_name FROM applications a JOIN shifts s ON s.id=a.shift_id JOIN businesses b ON b.id=s.business_id WHERE a.worker_id=? ORDER BY a.created_at DESC`
 : `SELECT a.*,s.title,s.starts_at,s.ends_at,u.first_name,u.last_name,u.email FROM applications a JOIN shifts s ON s.id=a.shift_id JOIN users u ON u.id=a.worker_id JOIN businesses b ON b.id=s.business_id WHERE b.owner_user_id=? ORDER BY a.created_at DESC`;
 const [rows]=await db.execute(sql,[req.user.id]);res.json({applications:rows});
}));
app.patch('/api/applications/:id',auth,allow('employer'),requireVerification,asyncRoute(async(req,res)=>{
 const status=req.body.status;if(!['approved','rejected'].includes(status))return res.status(400).json({error:'Invalid status'});
 const [rows]=await db.execute('SELECT a.id,a.shift_id FROM applications a JOIN shifts s ON s.id=a.shift_id JOIN businesses b ON b.id=s.business_id WHERE a.id=? AND b.owner_user_id=?',[req.params.id,req.user.id]);
 if(!rows.length)return res.status(404).json({error:'Application not found'});
 await db.execute('UPDATE applications SET status=? WHERE id=?',[status,req.params.id]);await audit(req,'application.'+status,'application',req.params.id);res.json({ok:true});
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
 const sql=req.user.role==='worker'
 ? 'SELECT c.*,s.title,s.location FROM checkouts c JOIN shifts s ON s.id=c.shift_id WHERE c.worker_id=? ORDER BY c.created_at DESC'
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
 if(status==='approved'&&req.user.role!=='admin'){
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
require('./admin-routes')(app, { db, asyncRoute, audit, sendInvoiceReminder });

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
app.use((err,req,res,next)=>{console.error(err);res.status(err.status||500).json({error:err.status?err.message:'Internal server error'});});
const port=Number(process.env.PORT||4000);
app.listen(port,()=>console.log(`hyrz API listening on http://localhost:${port}`));
