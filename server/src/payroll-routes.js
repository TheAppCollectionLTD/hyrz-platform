const { auth, allow } = require('./middleware');
const { TAX_YEAR, NI_CATEGORIES, validTaxCode, taxWeekOf, buildPayslip } = require('./payroll');

module.exports = function registerPayrollRoutes(app, { db, asyncRoute, audit }) {
  const ready = db.query(`CREATE TABLE IF NOT EXISTS worker_pay_settings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    pay_type ENUM('contractor','paye') NOT NULL,
    tax_code VARCHAR(12) NULL,
    ni_category CHAR(1) NULL,
    effective_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_worker_pay_settings_user(user_id,effective_from)
  ) ENGINE=InnoDB`);

  async function history(userId) {
    await ready;
    const [rows] = await db.execute('SELECT pay_type,tax_code,ni_category,effective_from FROM worker_pay_settings WHERE user_id=? ORDER BY effective_from ASC,id ASC', [userId]);
    return rows;
  }
  const current = rows => rows.at(-1) || { pay_type: 'contractor', tax_code: null, ni_category: null, effective_from: null };
  const settingAt = (rows, when) => [...rows].reverse().find(r => String(r.effective_from) <= when) || { pay_type: 'contractor' };
  const view = r => ({ payType: r.pay_type, taxCode: r.tax_code, niCategory: r.ni_category, effectiveFrom: r.effective_from });

  app.get('/api/worker/pay-settings', auth, allow('worker'), asyncRoute(async (req, res) => {
    res.json({ settings: view(current(await history(req.user.id))), taxYear: TAX_YEAR.label });
  }));

  app.put('/api/worker/pay-settings', auth, allow('worker'), asyncRoute(async (req, res) => {
    const payType = String(req.body.payType || '');
    if (!['contractor', 'paye'].includes(payType)) return res.status(400).json({ error: 'Choose contractor or PAYE.' });
    let taxCode = null, niCategory = null;
    if (payType === 'paye') {
      taxCode = String(req.body.taxCode || '1257L').toUpperCase().replace(/\s+/g, '');
      niCategory = String(req.body.niCategory || 'A').toUpperCase();
      if (/^S/.test(taxCode)) return res.status(400).json({ error: 'Scottish tax codes are not supported yet. Please contact hyrz support.' });
      if (!validTaxCode(taxCode)) return res.status(400).json({ error: 'Enter a valid tax code, for example 1257L or BR.' });
      if (!NI_CATEGORIES.includes(niCategory)) return res.status(400).json({ error: 'Choose a valid National Insurance category.' });
      if (req.body.confirmed !== true) return res.status(400).json({ error: 'Please confirm your PAYE details are correct.' });
    }
    await ready;
    await db.execute('INSERT INTO worker_pay_settings(user_id,pay_type,tax_code,ni_category,effective_from) VALUES(?,?,?,?,UTC_TIMESTAMP())', [req.user.id, payType, taxCode, niCategory]);
    try { await audit(req, 'worker.pay_settings.updated', 'user', req.user.id, { payType, taxCode, niCategory }); } catch (e) { console.error('Pay settings audit failed:', e.message); }
    res.json({ ok: true, settings: view(current(await history(req.user.id))) });
  }));

  async function payslipsFor(workerId) {
    const rows = await history(workerId);
    const [checkouts] = await db.execute(`SELECT c.id,c.actual_start,COALESCE(c.counter_gross_pay,c.gross_pay) AS gross,s.title,b.name AS business_name
      FROM checkouts c JOIN shifts s ON s.id=c.shift_id JOIN businesses b ON b.id=s.business_id
      WHERE c.worker_id=? AND c.status='approved' ORDER BY c.actual_start ASC`, [workerId]);
    const groups = new Map();
    for (const c of checkouts) {
      const when = String(c.actual_start).replace('T', ' ').slice(0, 19);
      const setting = settingAt(rows, when);
      const period = taxWeekOf(new Date(when.replace(' ', 'T') + 'Z'));
      const key = `${period.taxYear}-${period.week}-${setting.pay_type}`;
      if (!groups.has(key)) groups.set(key, { period, setting, lines: [] });
      groups.get(key).lines.push({ checkoutId: c.id, date: when.slice(0, 10), shiftTitle: c.title, businessName: c.business_name, gross: Number(c.gross) });
    }
    return [...groups.values()].map(g => buildPayslip(g.period, g.setting.pay_type, g.setting, g.lines)).reverse();
  }

  app.get('/api/worker/payslips', auth, allow('worker'), asyncRoute(async (req, res) => {
    res.json({ taxYear: TAX_YEAR.label, payslips: await payslipsFor(req.user.id) });
  }));

  app.get('/api/admin/payroll-summary', auth, allow('admin'), asyncRoute(async (req, res) => {
    const [workers] = await db.query("SELECT DISTINCT c.worker_id,u.first_name,u.last_name FROM checkouts c JOIN users u ON u.id=c.worker_id WHERE c.status='approved'");
    const out = [];
    for (const w of workers) for (const p of await payslipsFor(w.worker_id)) out.push({ workerId: w.worker_id, workerName: [w.first_name, w.last_name].filter(Boolean).join(' '), ...p });
    const sum = k => Math.round(out.reduce((t, p) => t + p[k], 0) * 100) / 100;
    res.json({ taxYear: TAX_YEAR.label, totals: { gross: sum('gross'), incomeTax: sum('incomeTax'), employeeNi: sum('employeeNi'), employerNi: sum('employerNi'), net: sum('net') }, payslips: out });
  }));
};
