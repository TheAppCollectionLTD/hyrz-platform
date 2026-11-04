require('dotenv').config();

const db = require('../src/db');
const bcrypt = require('bcryptjs');
const { hashIdentifier } = require('../src/identifier-hash');
const { calculatePay } = require('../src/pricing');

// Fills the demo worker/employer accounts with realistic shifts, payslips, direct chats, workchats and admin chats.
const DEMO_PASSWORD = 'HyrzDemoWorker!2026';
const EXTRA_WORKERS = [
  { email: 'priya.demo@hyrz.local', first: 'Priya', last: 'Shah', id: 'HYRZDEMOPRIYA2026' },
  { email: 'jamie.demo@hyrz.local', first: 'Jamie', last: 'Okafor', id: 'HYRZDEMOJAMIE2026' },
  { email: 'leo.demo@hyrz.local', first: 'Leo', last: 'Martins', id: 'HYRZDEMOLEO2026' }
];
const GIF = 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif';

const pad = n => String(n).padStart(2, '0');
const sql = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
const at = (days, hour, min = 0) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(hour, min, 0, 0); return d; };
const ago = minutes => new Date(Date.now() - minutes * 60000);

async function userId(conn, email) {
  const [rows] = await conn.execute('SELECT id FROM users WHERE email=?', [email]);
  if (!rows.length) throw new Error(`Missing ${email}. Run npm run seed:test-accounts first.`);
  return Number(rows[0].id);
}

async function ensureWorker(conn, w, hash) {
  const [rows] = await conn.execute('SELECT id FROM users WHERE email=?', [w.email]);
  let id = rows[0]?.id;
  if (!id) {
    const [r] = await conn.execute("INSERT INTO users(email,password_hash,role,first_name,last_name,email_verified_at,status) VALUES(?,?,'worker',?,?,UTC_TIMESTAMP(),'active')", [w.email, hash, w.first, w.last]);
    id = r.insertId;
  } else await conn.execute("UPDATE users SET password_hash=?,status='active',email_verified_at=COALESCE(email_verified_at,UTC_TIMESTAMP()) WHERE id=?", [hash, id]);
  await conn.execute("INSERT INTO worker_profiles(user_id,national_insurance_hash,identity_verification_status,right_to_work_status) VALUES(?,?,'verified','verified') ON DUPLICATE KEY UPDATE identity_verification_status='verified',right_to_work_status='verified'", [id, hashIdentifier(w.id)]);
  return Number(id);
}

async function wipe(conn, employer, workers, admin, businessId) {
  const ids = workers.join(',');
  await conn.query(`DELETE i FROM invoices i JOIN checkouts c ON c.id=i.checkout_id JOIN shifts s ON s.id=c.shift_id WHERE s.business_id=${businessId}`);
  await conn.query(`DELETE FROM ratings WHERE shift_id IN (SELECT id FROM shifts WHERE business_id=${businessId})`);
  await conn.query(`DELETE FROM checkouts WHERE shift_id IN (SELECT id FROM shifts WHERE business_id=${businessId})`);
  await conn.query(`DELETE FROM shift_chat_reminders WHERE application_id IN (SELECT a.id FROM applications a JOIN shifts s ON s.id=a.shift_id WHERE s.business_id=${businessId})`).catch(() => {});
  await conn.query(`DELETE FROM shifts WHERE business_id=${businessId}`);
  const [convs] = await conn.query(`SELECT id FROM employer_worker_conversations WHERE employer_user_id=${employer} OR worker_user_id IN (${ids})`);
  for (const { id } of convs) {
    await conn.query(`DELETE FROM direct_message_reactions WHERE conversation_id=${id}`);
    await conn.query(`DELETE FROM employer_worker_messages WHERE conversation_id=${id}`);
    await conn.query(`DELETE FROM employer_worker_conversations WHERE id=${id}`);
  }
  const [chats] = await conn.query(`SELECT id FROM workchats WHERE employer_user_id=${employer}`);
  for (const { id } of chats) for (const t of ['workchat_message_reads', 'workchat_message_reactions', 'workchat_pins', 'workchat_messages', 'workchat_participants', 'workchat_admins', 'workchat_settings', 'workchats'])
    await conn.query(`DELETE ${t === 'workchat_message_reads' ? 'r FROM workchat_message_reads r JOIN workchat_messages m ON m.id=r.message_id WHERE m.workchat_id' : `FROM ${t} WHERE ${t === 'workchats' ? 'id' : 'workchat_id'}`}=${id}`).catch(() => {});
  const keys = [employer, ...workers].map(u => `'${[u, admin].sort((a, b) => a - b).join(':')}'`).join(',');
  await conn.query(`DELETE FROM messages WHERE conversation_key IN (${keys})`);
  await conn.query(`DELETE FROM worker_pay_settings WHERE user_id IN (${ids})`);
}

async function addShift(conn, businessId, employer, s) {
  const start = at(s.day, s.from), end = at(s.day + (s.to <= s.from ? 1 : 0), s.to);
  const [r] = await conn.execute(`INSERT INTO shifts(business_id,created_by,title,description,location,starts_at,ends_at,break_minutes,hourly_pay,slots,status,shift_type)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [businessId, employer, s.title, s.description, s.location, sql(start), sql(end), s.breakMins || 0, s.pay, s.slots, s.status, s.type]);
  return { id: Number(r.insertId), start, end, ...s };
}

async function addCheckout(conn, businessId, shift, worker, status) {
  const pay = calculatePay({ hourlyPay: shift.pay, startsAt: shift.start, endsAt: shift.end, breakMinutes: shift.breakMins || 0 });
  const [r] = await conn.execute(`INSERT INTO checkouts(shift_id,worker_id,actual_start,actual_end,break_minutes,gross_pay,platform_fee,status,clocked_in_at,clocked_out_at,reviewed_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [shift.id, worker, sql(shift.start), sql(shift.end), shift.breakMins || 0, pay.grossPay, pay.platformFee, status, sql(shift.start), sql(shift.end), status === 'approved' ? sql(shift.end) : null, sql(shift.end)]);
  if (status === 'approved') {
    const due = new Date(shift.end.getTime() + 14 * 86400000);
    await conn.execute("INSERT INTO invoices(business_id,checkout_id,subtotal,platform_fee,total,due_at,status) VALUES(?,?,?,?,?,?,?)",
      [businessId, r.insertId, pay.grossPay, pay.platformFee, pay.employerTotal, sql(due).slice(0, 10), shift.day < -10 ? 'paid' : 'issued']);
  }
}

async function direct(conn, employer, worker, msgs) {
  const last = msgs.at(-1).ago;
  const [c] = await conn.execute('INSERT INTO employer_worker_conversations(employer_user_id,worker_user_id,created_at,last_message_at) VALUES(?,?,?,?)', [employer, worker, sql(ago(msgs[0].ago + 5)), sql(ago(last))]);
  const ids = [];
  for (const m of msgs) {
    const sender = m.from === 'e' ? employer : worker;
    const [r] = await conn.execute('INSERT INTO employer_worker_messages(conversation_id,sender_id,body,read_at,created_at,reply_to_message_id) VALUES(?,?,?,?,?,?)',
      [c.insertId, sender, m.body, m.unread ? null : sql(ago(Math.max(m.ago - 2, 0))), sql(ago(m.ago)), m.reply != null ? ids[m.reply] : null]);
    ids.push(r.insertId);
    for (const [who, emoji] of m.react || []) await conn.execute('INSERT INTO direct_message_reactions(message_id,conversation_id,user_id,emoji) VALUES(?,?,?,?)', [r.insertId, c.insertId, who === 'e' ? employer : worker, emoji]);
  }
}

async function workchat(conn, employer, name, members, msgs, status = 'current') {
  const last = msgs.at(-1).ago;
  const [c] = await conn.execute('INSERT INTO workchats(employer_user_id,name,status,created_at,last_message_at) VALUES(?,?,?,?,?)', [employer, name, status, sql(ago(msgs[0].ago + 30)), sql(ago(last))]);
  const id = c.insertId;
  for (const u of [employer, ...members]) await conn.execute('INSERT INTO workchat_participants(workchat_id,user_id,added_at,last_read_at) VALUES(?,?,?,?)', [id, u, sql(ago(msgs[0].ago + 30)), u === employer ? sql(ago(last)) : sql(ago(last + 60))]);
  const ids = [];
  for (const m of msgs) {
    const [r] = await conn.execute('INSERT INTO workchat_messages(workchat_id,sender_id,body,created_at,reply_to_message_id) VALUES(?,?,?,?,?)', [id, m.from, m.body, sql(ago(m.ago)), m.reply != null ? ids[m.reply] : null]);
    ids.push(r.insertId);
    for (const [who, emoji] of m.react || []) await conn.execute('INSERT INTO workchat_message_reactions(message_id,workchat_id,user_id,emoji) VALUES(?,?,?,?)', [r.insertId, id, who, emoji]);
    for (const u of [employer, ...members]) if (u !== m.from && m.ago > 30) await conn.execute('INSERT IGNORE INTO workchat_message_reads(message_id,user_id) VALUES(?,?)', [r.insertId, u]).catch(() => {});
    if (m.pin) await conn.execute('INSERT INTO workchat_pins(message_id,workchat_id,pinned_by) VALUES(?,?,?)', [r.insertId, id, employer]);
  }
}

async function adminThread(conn, user, admin, category, subject, msgs) {
  const key = [user, admin].sort((a, b) => a - b).join(':');
  for (const m of msgs) {
    const fromAdmin = m.from === 'a';
    const [r] = await conn.execute('INSERT INTO messages(conversation_key,sender_id,body,created_at) VALUES(?,?,?,?)', [key, fromAdmin ? admin : user, m.body, sql(ago(m.ago))]);
    await conn.execute('INSERT INTO admin_message_meta(message_id,recipient_id,category,subject,read_at,created_at) VALUES(?,?,?,?,?,?)',
      [r.insertId, fromAdmin ? user : admin, category, subject, m.unread ? null : sql(ago(Math.max(m.ago - 3, 0))), sql(ago(m.ago))]);
  }
}

async function main() {
  if (process.env.DB_NAME !== 'hyrz_test') throw new Error('Refusing to seed demo data: DB_NAME must be exactly "hyrz_test". No data was changed.');
  const conn = await db.getConnection();
  try {
    const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
    const worker = await userId(conn, 'demo.worker@hyrz.local');
    const employer = await userId(conn, 'demo.employer@hyrz.local');
    const admin = await userId(conn, 'test.owner@hyrz.local');
    const [[biz]] = await conn.execute('SELECT id FROM businesses WHERE owner_user_id=? ORDER BY id LIMIT 1', [employer]);
    const businessId = Number(biz.id);
    await conn.beginTransaction();
    const extra = [];
    for (const w of EXTRA_WORKERS) extra.push(await ensureWorker(conn, w, hash));
    const [P, J, L] = extra, all = [worker, ...extra];
    await wipe(conn, employer, all, admin, businessId);

    await conn.execute("UPDATE users SET phone='07700 900123' WHERE id=? AND phone IS NULL", [employer]);
    await conn.execute("UPDATE worker_profiles SET bio=?,skills=?,postcode='E1 6AN',hourly_rate=13.00 WHERE user_id=?", ['Friendly bartender and festival crew member with 4 years in London hospitality. Cocktail trained, Personal Licence holder.', JSON.stringify(['Bartending', 'Cocktails', 'Barista', 'Festival bars', 'Cash handling']), worker]);
    await conn.execute("INSERT INTO worker_pay_settings(user_id,pay_type,tax_code,ni_category,effective_from) VALUES(?,'paye','1257L','A',?)", [worker, sql(at(-60, 0))]);
    for (const u of all) {
      await conn.execute('INSERT IGNORE INTO employer_worker_favourites(employer_user_id,worker_user_id) VALUES(?,?)', [employer, u]);
      await conn.execute('INSERT IGNORE INTO worker_employer_favourites(worker_user_id,business_id) VALUES(?,?)', [u, businessId]);
    }

    const loc = '1 Demo Street, London EC1A 4AA';
    const S = d => addShift(conn, businessId, employer, d);
    const tonight = await S({ title: 'Cocktail Bar Host', description: 'Welcome guests, run the cocktail station and keep the bar tidy.', location: loc, day: 0, from: 18, to: 23, breakMins: 15, pay: 13.75, slots: 1, status: 'filled', type: 'hospitality' });
    const tomorrow = await S({ title: 'Bartender – Friday Night', description: 'Busy Friday service. Black shirt, black trousers. Cocktail experience a plus.', location: loc, day: 1, from: 17, to: 23, breakMins: 30, pay: 13.50, slots: 3, status: 'open', type: 'hospitality' });
    const festival = await S({ title: 'Festival Bar Crew – Riverside Fest', description: 'Outdoor festival bar. Wristband and staff meal provided. Bring a waterproof.', location: 'Riverside Park, London SE1 9PX', day: 3, from: 11, to: 21, breakMins: 45, pay: 14.25, slots: 6, status: 'open', type: 'festival' });
    const popup = await S({ title: 'Retail Assistant – Pop-up Store', description: 'Help run our weekend merch pop-up: tills, stock and customer service.', location: '24 Brick Lane, London E1 6RF', day: 5, from: 9, to: 17, breakMins: 30, pay: 12.60, slots: 2, status: 'open', type: 'retail' });
    const wedding = await S({ title: 'Waiting Staff – Wedding Reception', description: 'Silver service for 120 guests. Training given on the day.', location: 'The Old Library, London EC2V 7HH', day: 7, from: 14, to: 23, breakMins: 45, pay: 13.00, slots: 4, status: 'open', type: 'hospitality' });
    await S({ title: 'Kitchen Porter', description: 'Dishwashing and kitchen support during evening service.', location: loc, day: 2, from: 16, to: 23, breakMins: 30, pay: 12.21, slots: 2, status: 'open', type: 'hospitality' });
    await S({ title: 'Barista – Weekend Brunch', description: 'Latte art lovers wanted. Fast-paced brunch service.', location: loc, day: 4, from: 8, to: 15, breakMins: 30, pay: 12.80, slots: 2, status: 'open', type: 'hospitality' });

    const past = [];
    for (const p of [
      { title: 'Bartender – Saturday Night', day: -2, from: 18, to: 23, pay: 13.50, type: 'hospitality' },
      { title: 'Festival Bar Crew – Autumn Beats', day: -6, from: 12, to: 22, pay: 14.25, type: 'festival', breakMins: 45 },
      { title: 'Retail Assistant – Stocktake', day: -9, from: 8, to: 16, pay: 12.60, type: 'retail', breakMins: 30 },
      { title: 'Waiting Staff – Corporate Dinner', day: -13, from: 17, to: 23, pay: 13.00, type: 'hospitality', breakMins: 30 },
      { title: 'Cocktail Bar Host', day: -20, from: 18, to: 23, pay: 13.75, type: 'hospitality', breakMins: 15 },
      { title: 'Festival Bar Crew – Harvest Fair', day: -27, from: 11, to: 21, pay: 14.25, type: 'festival', breakMins: 45 },
      { title: 'Bar Supervisor – Live Music Night', day: -3, from: 13, to: 23, pay: 15.50, type: 'hospitality', breakMins: 45 },
      { title: 'Festival Bar Crew – Autumn Beats', day: -7, from: 11, to: 22, pay: 14.25, type: 'festival', breakMins: 45 },
      { title: 'Retail Assistant – Late Opening', day: -10, from: 10, to: 21, pay: 12.60, type: 'retail', breakMins: 45 },
      { title: 'Waiting Staff – Gala Dinner', day: -14, from: 12, to: 23, pay: 13.00, type: 'hospitality', breakMins: 45 },
      { title: 'Bartender – Brunch & Bottomless', day: -21, from: 10, to: 22, pay: 13.50, type: 'hospitality', breakMins: 45 },
      { title: 'Festival Bar Crew – Harvest Fair', day: -28, from: 11, to: 22, pay: 14.25, type: 'festival', breakMins: 45 }
    ]) past.push(await S({ ...p, description: 'Completed shift.', location: loc, slots: 3, status: 'completed' }));
    const lastNight = await S({ title: 'Bartender – Late Bar', description: 'Completed shift.', location: loc, day: -1, from: 19, to: 23, pay: 13.50, slots: 2, status: 'completed', type: 'hospitality' });

    const apply = (shift, w, status) => conn.execute('INSERT INTO applications(shift_id,worker_id,status,created_at,contract_accepted_at) VALUES(?,?,?,?,?)', [shift.id, w, status, sql(ago(3000)), status === 'approved' ? sql(ago(2900)) : null]);
    await apply(tonight, worker, 'approved');
    await apply(tomorrow, worker, 'approved'); await apply(tomorrow, P, 'approved'); await apply(tomorrow, J, 'pending');
    await apply(festival, worker, 'approved'); await apply(festival, J, 'approved'); await apply(festival, L, 'approved'); await apply(festival, P, 'pending');
    await apply(popup, worker, 'pending');
    await apply(wedding, P, 'pending'); await apply(wedding, L, 'pending');
    for (const s of past) { await apply(s, worker, 'approved'); await addCheckout(conn, businessId, s, worker, 'approved'); }
    await apply(past[0], P, 'approved'); await addCheckout(conn, businessId, past[0], P, 'approved');
    await apply(lastNight, worker, 'approved'); await addCheckout(conn, businessId, lastNight, worker, 'submitted');
    await apply(lastNight, L, 'approved'); await addCheckout(conn, businessId, lastNight, L, 'submitted');
    for (const [s, score, comment] of [[past[1], 9, 'Brilliant on the festival bar, would book again.'], [past[3], 10, 'Super professional with our corporate guests.']])
      await conn.execute('INSERT INTO ratings(shift_id,reviewer_id,reviewee_id,score,comment) VALUES(?,?,?,?,?)', [s.id, employer, worker, score, comment]);
    await conn.execute('INSERT INTO ratings(shift_id,reviewer_id,reviewee_id,score,comment) VALUES(?,?,?,?,?)', [past[1].id, worker, employer, 9, 'Great team and a proper staff meal!']);

    const dayName = tomorrow.start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
    await direct(conn, employer, worker, [
      { from: 'e', ago: 4300, body: 'Hi Alex! Thanks for picking up the Saturday shift, the team loved working with you 🙌' },
      { from: 'w', ago: 4280, body: 'Thank you Sam! Really enjoyed it, happy to come back any time 😊', react: [['e', '❤️']] },
      { from: 'e', ago: 1500, body: "Great news, I've approved you for Riverside Fest on the bar. It's an outdoor one so bring a waterproof!" },
      { from: 'w', ago: 1480, body: 'Amazing, thank you! Is there parking on site?', reply: 2 },
      { from: 'e', ago: 1470, body: 'No parking sadly, but it is a 5 minute walk from London Bridge station.', reply: 3, react: [['w', '👍']] },
      { from: 'e', ago: 1460, body: GIF },
      { from: 'w', ago: 1440, body: '😂😂' },
      { from: 'e', ago: 320, body: `⏰ Shift reminder: Bartender – Friday Night at The Demo Bar & Kitchen is tomorrow, ${dayName}, 17:00–23:00. Location: ${loc}. Please arrive 10 minutes early.` },
      { from: 'w', ago: 300, body: 'Got it, see you tomorrow! Do I need to bring my own bar blade?', react: [['e', '👍']] },
      { from: 'e', ago: 12, body: "Yes please, and wear black. I'll have the rota printed by the till 👌", unread: true },
      { from: 'e', ago: 10, body: "Also - could you cover the Cocktail Bar Host shift tonight from 6? I've added you to it.", unread: true }
    ]);
    await direct(conn, employer, P, [
      { from: 'w', ago: 2000, body: 'Hi! Do you need anyone for the wedding next week? I have silver service experience.' },
      { from: 'e', ago: 1900, body: "Hi Priya, yes please! I'll look at your application today 👍", reply: 0 },
      { from: 'w', ago: 60, body: 'Thank you! I can also do the Friday bar shift if you still need someone.', unread: true }
    ]);
    await direct(conn, employer, J, [
      { from: 'e', ago: 2500, body: 'Hi Jamie, great to have you on the Riverside Fest crew!' },
      { from: 'w', ago: 2450, body: "Can't wait! 🎉", react: [['e', '🎉']] }
    ]);
    await direct(conn, employer, L, [
      { from: 'w', ago: 240, body: 'Hi Sam, I submitted my hours for last night. I finished 15 minutes late because of the stocktake.' },
      { from: 'e', ago: 200, body: "No problem Leo, I'll check and approve them shortly.", reply: 0 }
    ]);

    await workchat(conn, employer, 'Riverside Fest Crew 🎪', [worker, J, L, P], [
      { from: employer, ago: 2800, body: "Welcome to the Riverside Fest crew chat! I'll share everything you need here.", pin: true },
      { from: employer, ago: 2790, body: '📍 Staff entrance: Gate C on Riverside Walk. Wristbands at the crew tent. Staff meal at 3pm.', pin: true, react: [[worker, '👍'], [J, '👍'], [L, '🙏']] },
      { from: J, ago: 2000, body: 'Is the dress code all black again?' },
      { from: employer, ago: 1990, body: "Yes, black top and trousers. We'll give you a crew t-shirt on the day.", reply: 2 },
      { from: L, ago: 1400, body: 'Anyone want to meet at London Bridge at 10:30 and walk over together?' },
      { from: worker, ago: 1390, body: "I'm in! 🙋", reply: 4, react: [[L, '❤️']] },
      { from: J, ago: 1380, body: 'Me too 🙌' },
      { from: employer, ago: 90, body: "Weather update: it's looking sunny ☀️ but bring a layer for the evening." },
      { from: P, ago: 25, body: "Fingers crossed I get approved too, it sounds like a great one!", react: [[J, '🙏']] },
      { from: employer, ago: 8, body: GIF }
    ]);
    await workchat(conn, employer, 'Friday Bar Team', [worker, P], [
      { from: employer, ago: 1700, body: "Hi both! Friday's going to be busy, we've got a 40-cover private party at 8pm." },
      { from: P, ago: 1650, body: 'Sounds fun! Will we need to do table service?' },
      { from: employer, ago: 1640, body: 'Just a couple of trays of welcome drinks, the rest is at the bar.', reply: 1 },
      { from: worker, ago: 280, body: "I'll bring my bar kit. See you Friday! 🍸", react: [[employer, '🔥'], [P, '👏']] }
    ]);
    await workchat(conn, employer, 'Autumn Beats Weekend', [worker, J], [
      { from: employer, ago: 9000, body: "Thank you everyone, that was a brilliant weekend. Payslips are on their way 💸" },
      { from: J, ago: 8950, body: 'Thanks Sam, loved it!', react: [[employer, '❤️']] }
    ], 'past');

    await adminThread(conn, worker, admin, 'enquiries', 'Switching to hyrz PAYE', [
      { from: 'u', ago: 86400 / 1.2, body: 'Hi, I want hyrz to handle my tax. If I switch to PAYE, will it apply to shifts I have already worked?' },
      { from: 'a', ago: 70000, body: "Hi Alex, thanks for getting in touch! Switching to hyrz PAYE applies to shifts you work from the moment you switch. Shifts you worked before stay as contractor pay. You'll get a weekly payslip showing your Income Tax and National Insurance." },
      { from: 'u', ago: 69000, body: 'Perfect, thank you. I have switched now with tax code 1257L.' },
      { from: 'a', ago: 15, body: "Great, everything looks good on our side ✅ Your latest payslip is ready under Pay & Tax. Let us know if you have any questions.", unread: true }
    ]);
    await adminThread(conn, employer, admin, 'checkout_disputes', 'Late finish on Bartender – Late Bar', [
      { from: 'u', ago: 230, body: 'Hi hyrz team, Leo has submitted 15 minutes extra for last night. Can I approve the extra time myself?' },
      { from: 'a', ago: 30, body: "Hi Sam! Yes. Open Checkouts, choose Leo's shift and press Approve. If you disagree with the hours, use Counter to suggest different times and we'll help both sides agree.", unread: true }
    ]);
    await adminThread(conn, employer, admin, 'enquiries', 'Welcome to hyrz 👋', [
      { from: 'a', ago: 10000, body: "Welcome to hyrz, Sam! Your business is verified and you can now post shifts for hospitality, festival and retail work. Reply here any time if you need a hand." },
      { from: 'u', ago: 9900, body: 'Thanks, really easy to set up!' }
    ]);

    await conn.commit();
    console.log('Demo data ready: shifts, payslips, direct chats, workchats and admin chats for the demo accounts.');
    console.log('Extra demo workers (password ' + DEMO_PASSWORD + '): ' + EXTRA_WORKERS.map(w => w.email).join(', '));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await db.end();
  }
}

main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
