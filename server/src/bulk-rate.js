const { auth, allow } = require('./middleware');
const { FEES, weeklyBulkCredit } = require('./pricing');

const DAY = 86400000;
const utc = s => new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z'));
const iso = d => d.toISOString().slice(0, 10);
function mondayOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
}

module.exports = function registerBulkRate(app, { db, asyncRoute }) {
  const ready = db.query(`CREATE TABLE IF NOT EXISTS fee_credits (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL,
    week_start DATE NOT NULL,
    workers INT NOT NULL,
    hours DECIMAL(10,2) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_fee_credit_week(business_id,week_start)
  ) ENGINE=InnoDB`);

  async function lines(businessId, from, to) {
    const [rows] = await db.execute(`SELECT c.worker_id AS workerId, s.hourly_pay AS rate, i.platform_fee AS fee, COALESCE(c.counter_start,c.actual_start) AS started,
      GREATEST(0, TIMESTAMPDIFF(MINUTE, COALESCE(c.counter_start,c.actual_start), COALESCE(c.counter_end,c.actual_end)) - COALESCE(c.counter_break_minutes,c.break_minutes,0)) / 60 AS hours
      FROM invoices i JOIN checkouts c ON c.id=i.checkout_id JOIN shifts s ON s.id=c.shift_id
      WHERE i.business_id=? AND i.status NOT IN ('void','draft') AND COALESCE(c.counter_start,c.actual_start)>=? AND COALESCE(c.counter_start,c.actual_start)<?`, [businessId, from, to]);
    return rows;
  }

  // Settles every finished week for a business; re-running adjusts for late or cancelled invoices.
  async function settle(businessId) {
    await ready;
    const thisMonday = mondayOf(new Date());
    const [[first]] = await db.execute(`SELECT MIN(COALESCE(c.counter_start,c.actual_start)) AS first FROM invoices i JOIN checkouts c ON c.id=i.checkout_id WHERE i.business_id=?`, [businessId]);
    if (!first.first) return;
    const all = await lines(businessId, iso(mondayOf(utc(first.first))), iso(thisMonday));
    const weeks = new Map();
    for (const l of all) { const k = iso(mondayOf(utc(l.started))); if (!weeks.has(k)) weeks.set(k, []); weeks.get(k).push(l); }
    for (const [weekStart, ls] of weeks) {
      const r = weeklyBulkCredit(ls);
      if (!r.qualifies || r.credit <= 0) { await db.execute('DELETE FROM fee_credits WHERE business_id=? AND week_start=?', [businessId, weekStart]); continue; }
      await db.execute(`INSERT INTO fee_credits(business_id,week_start,workers,hours,amount) VALUES(?,?,?,?,?)
        ON DUPLICATE KEY UPDATE workers=VALUES(workers),hours=VALUES(hours),amount=VALUES(amount)`, [businessId, weekStart, r.workers, r.hours, r.credit]);
    }
    const kept = [...weeks.keys()];
    await db.execute(`DELETE FROM fee_credits WHERE business_id=? AND week_start<?${kept.length ? ` AND week_start NOT IN (${kept.map(() => '?').join(',')})` : ''}`, [businessId, iso(thisMonday), ...kept]);
  }

  async function settleAll() {
    await ready;
    const [rows] = await db.query('SELECT DISTINCT business_id FROM invoices');
    for (const r of rows) await settle(r.business_id);
  }

  async function businessOf(userId) {
    const [[b]] = await db.execute('SELECT id FROM businesses WHERE owner_user_id=? LIMIT 1', [userId]);
    return b?.id;
  }

  app.get('/api/employer/fee-tier', auth, allow('employer'), asyncRoute(async (req, res) => {
    const businessId = await businessOf(req.user.id);
    if (!businessId) return res.status(404).json({ error: 'Business not found' });
    await settle(businessId);
    const monday = mondayOf(new Date());
    const week = weeklyBulkCredit(await lines(businessId, iso(monday), iso(new Date(monday.getTime() + 7 * DAY))));
    const [credits] = await db.execute('SELECT id,week_start,workers,hours,amount,created_at FROM fee_credits WHERE business_id=? ORDER BY week_start DESC LIMIT 52', [businessId]);
    res.json({
      rules: FEES,
      currentWeek: { start: iso(monday), end: iso(new Date(monday.getTime() + 6 * DAY)), ...week, estimatedCredit: week.credit },
      credits: credits.map(c => ({ ...c, week_start: String(c.week_start).slice(0, 10), hours: Number(c.hours), amount: Number(c.amount) })),
      totalCredits: Math.round(credits.reduce((t, c) => t + Number(c.amount), 0) * 100) / 100,
    });
  }));

  return { settle, settleAll, ready };
};
