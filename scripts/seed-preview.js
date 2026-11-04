// Preview-only demo data (idempotent). Run from /app/server so its node_modules and .env resolve.
require('/app/server/node_modules/dotenv').config({ path: '/app/server/.env' });
const bcrypt = require('/app/server/node_modules/bcryptjs');
const db = require('/app/server/src/db');

const sql = d => d.toISOString().slice(0, 19).replace('T', ' ');

async function seedCore() {
  const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM users');
  if (n > 0) return;
  const hash = await bcrypt.hash('HyrzDemo2026!', 12);
  const ids = {};
  for (const [email, role, first, last] of [
    ['admin@hyrz.demo', 'admin', 'Ava', 'Admin'],
    ['worker@hyrz.demo', 'worker', 'Sam', 'Taylor'],
    ['employer@hyrz.demo', 'employer', 'Priya', 'Shah'],
  ]) {
    const [r] = await db.execute('INSERT INTO users(email,password_hash,role,admin_tier,first_name,last_name,email_verified_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP())',
      [email, hash, role, role === 'admin' ? 1 : null, first, last]);
    ids[role] = r.insertId;
  }
  await db.execute("INSERT INTO worker_profiles(user_id,identity_verification_status,right_to_work_status) VALUES(?,'verified','verified')", [ids.worker]);
  const [b] = await db.execute("INSERT INTO businesses(owner_user_id,name,role_at_company,verification_status,identity_verification_status) VALUES(?,'The Brass Lantern','Owner','verified','verified')", [ids.employer]);
  for (const [title, loc, days, pay] of [['Bartender', 'Shoreditch, London', 2, 14.5], ['Event Steward', 'Manchester Arena', 4, 13.75], ['Warehouse Picker', 'Leeds LS9', 6, 15.25], ['Front of House', 'Bristol BS1', 9, 22]]) {
    const start = new Date(Date.now() + days * 86400000); start.setUTCHours(17, 0, 0, 0);
    await db.execute('INSERT INTO shifts(business_id,created_by,title,description,location,starts_at,ends_at,break_minutes,hourly_pay,slots) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [b.insertId, ids.employer, title, 'Demo shift for preview.', loc, sql(start), sql(new Date(start.getTime() + 6 * 3600000)), 30, pay, 2]);
  }
}

async function seedChat() {
  const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM conversations');
  if (n > 0) return;
  const [[worker]] = await db.query("SELECT id FROM users WHERE email='worker@hyrz.demo'");
  const [[employer]] = await db.query("SELECT id FROM users WHERE email='employer@hyrz.demo'");
  if (!worker || !employer) return;
  const [shifts] = await db.query("SELECT id,title FROM shifts WHERE title IN ('Bartender','Event Steward') ORDER BY id");
  const now = Date.now();
  const convo = async (shift, status, msgs) => {
    await db.execute('INSERT IGNORE INTO applications(shift_id,worker_id,status) VALUES(?,?,?)', [shift.id, worker.id, status]);
    const [[app]] = await db.execute('SELECT id FROM applications WHERE shift_id=? AND worker_id=?', [shift.id, worker.id]);
    const [c] = await db.execute('INSERT INTO conversations(application_id,shift_id,worker_id,employer_id) VALUES(?,?,?,?)', [app.id, shift.id, worker.id, employer.id]);
    let last = 0;
    for (const [from, minsAgo, kind, body, gif] of msgs) {
      const [m] = await db.execute('INSERT INTO chat_messages(conversation_id,sender_id,kind,body,gif_url,gif_preview_url,gif_title,created_at) VALUES(?,?,?,?,?,?,?,?)',
        [c.insertId, from === 'w' ? worker.id : employer.id, kind, body, gif || null, gif || null, gif ? 'Thumbs up' : null, sql(new Date(now - minsAgo * 60000))]);
      last = m.insertId;
    }
    await db.execute('UPDATE conversations SET last_message_at=(SELECT MAX(created_at) FROM chat_messages WHERE conversation_id=?) WHERE id=?', [c.insertId, c.insertId]);
    await db.execute('INSERT INTO conversation_members(conversation_id,user_id,last_read_message_id) VALUES(?,?,?),(?,?,?)',
      [c.insertId, worker.id, last - 1, c.insertId, employer.id, last]);
    return { conv: c.insertId, last };
  };
  const first = await convo(shifts[0], 'approved', [
    ['e', 1500, 'text', "Hi Sam! Thanks for applying for the Bartender shift at The Brass Lantern 🍸"],
    ['w', 1490, 'text', "Hi Priya, thanks for having me! Is there a dress code?"],
    ['e', 1485, 'text', "All black please, comfortable shoes. We'll give you an apron on arrival."],
    ['w', 1480, 'text', '👍'],
    ['e', 30, 'text', "You're approved for Thursday. Can you arrive 15 minutes early for a quick briefing?"],
    ['w', 25, 'text', "Absolutely, I'll be there at 16:45 😊"],
    ['e', 3, 'gif', null, 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif'],
    ['e', 2, 'text', 'Perfect, see you then!'],
  ]);
  await db.execute('INSERT IGNORE INTO chat_message_reactions(message_id,user_id,emoji) VALUES(?,?,?)', [first.last - 2, employer.id, '❤️']);
  if (shifts[1]) await convo(shifts[1], 'pending', [
    ['w', 200, 'text', "Hello! I've worked stewarding at festivals before, happy to share references."],
  ]);
}

(async () => {
  await seedCore();
  await seedChat();
  console.log('Preview demo data ready');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
