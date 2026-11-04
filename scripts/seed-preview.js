// Preview-only demo data. Run from /app/server so its node_modules and .env resolve.
require('/app/server/node_modules/dotenv').config({ path: '/app/server/.env' });
const bcrypt = require('/app/server/node_modules/bcryptjs');
const db = require('/app/server/src/db');

(async () => {
  const hash = await bcrypt.hash('HyrzDemo2026!', 12);
  const users = [
    ['admin@hyrz.demo', 'admin', 'Ava', 'Admin'],
    ['worker@hyrz.demo', 'worker', 'Sam', 'Taylor'],
    ['employer@hyrz.demo', 'employer', 'Priya', 'Shah'],
  ];
  const ids = {};
  for (const [email, role, first, last] of users) {
    const [r] = await db.execute(
      'INSERT INTO users(email,password_hash,role,admin_tier,first_name,last_name,email_verified_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP())',
      [email, hash, role, role === 'admin' ? 1 : null, first, last]);
    ids[role] = r.insertId;
  }
  await db.execute("INSERT INTO worker_profiles(user_id,identity_verification_status,right_to_work_status) VALUES(?,'verified','verified')", [ids.worker]);
  const [b] = await db.execute("INSERT INTO businesses(owner_user_id,name,role_at_company,verification_status,identity_verification_status) VALUES(?,'The Brass Lantern','Owner','verified','verified')", [ids.employer]);
  const shifts = [
    ['Bartender', 'Shoreditch, London', 2, 14.5],
    ['Event Steward', 'Manchester Arena', 4, 13.75],
    ['Warehouse Picker', 'Leeds LS9', 6, 15.25],
    ['Front of House', 'Bristol BS1', 9, 22],
  ];
  for (const [title, loc, days, pay] of shifts) {
    const start = new Date(Date.now() + days * 86400000); start.setUTCHours(17, 0, 0, 0);
    const end = new Date(start.getTime() + 6 * 3600000);
    await db.execute('INSERT INTO shifts(business_id,created_by,title,description,location,starts_at,ends_at,break_minutes,hourly_pay,slots) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [b.insertId, ids.employer, title, 'Demo shift for preview.', loc, start.toISOString().slice(0, 19).replace('T', ' '), end.toISOString().slice(0, 19).replace('T', ' '), 30, pay, 2]);
  }
  console.log('Preview demo data seeded');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
