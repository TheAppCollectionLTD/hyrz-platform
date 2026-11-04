const { auth, allow } = require('./middleware');

// Sends one chat reminder per confirmed shift, the evening (18:00-22:00 UK time) before it starts.
module.exports = function registerShiftReminders(app, { db, asyncRoute }) {
  const ready = db.query(`CREATE TABLE IF NOT EXISTS shift_chat_reminders (
    application_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    conversation_id BIGINT UNSIGNED NOT NULL,
    message_id BIGINT UNSIGNED NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  const ukParts = date => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(date).map(p => [p.type, p.value]));
  const ukDay = date => { const p = ukParts(date); return `${p.year}-${p.month}-${p.day}`; };
  const fmt = (d, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...opts }).format(d);
  const asDate = v => new Date(String(v).replace(' ', 'T') + (String(v).includes('Z') ? '' : 'Z'));

  async function runReminders({ force = false } = {}) {
    await ready;
    const now = new Date();
    const hour = Number(ukParts(now).hour);
    if (!force && (hour < 18 || hour >= 22)) return { sent: 0, skipped: 'outside evening window' };
    const tomorrow = ukDay(new Date(now.getTime() + 24 * 3600000));
    const [rows] = await db.query(`SELECT a.id AS application_id,a.worker_id,b.owner_user_id AS employer_id,s.title,s.location,s.starts_at,s.ends_at,b.name AS business_name
      FROM applications a JOIN shifts s ON s.id=a.shift_id JOIN businesses b ON b.id=s.business_id
      LEFT JOIN shift_chat_reminders r ON r.application_id=a.id
      WHERE a.status='approved' AND r.application_id IS NULL AND s.status<>'cancelled'
        AND s.starts_at BETWEEN DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR) AND DATE_ADD(UTC_TIMESTAMP(),INTERVAL 48 HOUR)`);
    let sent = 0;
    for (const r of rows) {
      const start = asDate(r.starts_at), end = asDate(r.ends_at);
      if (ukDay(start) !== tomorrow) continue;
      await db.execute('INSERT IGNORE INTO employer_worker_conversations(employer_user_id,worker_user_id) VALUES(?,?)', [r.employer_id, r.worker_id]);
      const [[conv]] = await db.execute('SELECT id FROM employer_worker_conversations WHERE employer_user_id=? AND worker_user_id=?', [r.employer_id, r.worker_id]);
      const body = `⏰ Shift reminder: ${r.title} at ${r.business_name} is tomorrow, ${fmt(start, { weekday: 'long', day: 'numeric', month: 'long' })}, `
        + `${fmt(start, { hour: '2-digit', minute: '2-digit' })}–${fmt(end, { hour: '2-digit', minute: '2-digit' })}.\n📍 ${r.location}\n`
        + 'Please arrive a few minutes early. Reply here if anything changes. (Sent automatically by hyrz)';
      const [claim] = await db.execute('INSERT IGNORE INTO shift_chat_reminders(application_id,conversation_id,message_id) VALUES(?,?,0)', [r.application_id, conv.id]);
      if (!claim.affectedRows) continue;
      const [msg] = await db.execute('INSERT INTO employer_worker_messages(conversation_id,sender_id,body) VALUES(?,?,?)', [conv.id, r.employer_id, body]);
      await db.execute('UPDATE employer_worker_conversations SET last_message_at=NOW() WHERE id=?', [conv.id]);
      await db.execute('UPDATE shift_chat_reminders SET message_id=? WHERE application_id=?', [msg.insertId, r.application_id]);
      sent++;
    }
    return { sent };
  }

  app.post('/api/admin/shift-reminders/run', auth, allow('admin'), asyncRoute(async (req, res) => {
    res.json(await runReminders({ force: req.body.force === true }));
  }));

  const timer = setInterval(() => runReminders().catch(e => console.error('Shift reminders failed:', e.message)), 15 * 60 * 1000);
  timer.unref();
  setTimeout(() => runReminders().catch(e => console.error('Shift reminders failed:', e.message)), 20000).unref();
};
