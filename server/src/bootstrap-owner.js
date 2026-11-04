require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

async function main() {
  const username = String(process.env.OWNER_USERNAME || 'SimsonH').trim();
  const email = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Set OWNER_EMAIL to a valid email address.');
  if (typeof password !== 'string' || password.length < 12) throw new Error('Set OWNER_PASSWORD to a password of at least 12 characters. Do not use a shared/default password.');
  if (!/^[A-Za-z][A-Za-z0-9._-]{2,79}$/.test(username)) throw new Error('OWNER_USERNAME must be 3-80 characters and start with a letter.');
  await db.query(`CREATE TABLE IF NOT EXISTS admin_login_names (user_id BIGINT UNSIGNED PRIMARY KEY, username VARCHAR(80) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  const [admins] = await db.execute("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if (admins.length) throw new Error('An administrator already exists. This bootstrap only works on a database with no administrator.');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [user] = await conn.execute("INSERT INTO users(email,password_hash,role,admin_tier,status,email_verified_at) VALUES(?,?,'admin',1,'active',UTC_TIMESTAMP())", [email, await bcrypt.hash(password, 12)]);
    await conn.execute('INSERT INTO admin_login_names(user_id,username) VALUES(?,?)', [user.insertId, username]);
    await conn.execute("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)", [user.insertId,'admin.owner_bootstrapped','user',user.insertId,JSON.stringify({username,email,tier:1})]);
    await conn.commit();
    process.stdout.write('Tier 1 owner created successfully. Sign in with the account name or email you supplied.\n');
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await db.end();
  }
}
main().catch(async error => { console.error(error.message); try { await db.end(); } catch (_) {} process.exitCode = 1; });
