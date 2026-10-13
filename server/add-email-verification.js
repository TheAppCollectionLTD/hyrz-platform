const fs = require('fs');

const file = 'src/index.js';
let source = fs.readFileSync(file, 'utf8');

const start = source.indexOf("app.post('/api/auth/register'");
const end = source.indexOf("app.get('/api/auth/me'");

if (start === -1 || end === -1 || end <= start) {
  console.error('Could not locate registration/login section. No changes made.');
  process.exit(1);
}

const replacement = String.raw`
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
    businessName, companyNumber, companyRole, postcode, confirmPassword
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

  const normalizedEmail = email.toLowerCase().trim();
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
        'INSERT INTO worker_profiles (user_id) VALUES (?)',
        [result.insertId]
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
    } catch (_) {
      console.error('Resending verification email failed.');
    }
  }

  return res.json({ message: genericMessage });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id,email,password_hash,role,admin_tier,status,first_name,last_name,email_verified_at FROM users WHERE email=?',
    [String(req.body.email || '').toLowerCase().trim()]
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

`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(file, source);

console.log('Email verification endpoints installed.');
