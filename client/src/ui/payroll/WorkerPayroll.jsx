import React, { useEffect, useState } from 'react';
import { request } from '../../api';
import './payroll.css';

const money = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n || 0));
const day = s => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function PayTypeCard({ id, title, text, chosen, onChoose }) {
  return <button type="button" className={`pay-type-card ${chosen ? 'on' : ''}`} onClick={() => onChoose(id)} aria-pressed={chosen} data-testid={`pay-type-${id}`}>
    <span className="pay-type-radio" /><strong>{title}</strong><small>{text}</small>
  </button>;
}

function Payslip({ p }) {
  const [open, setOpen] = useState(false);
  return <article className="payslip" data-testid={`payslip-${p.taxYear}-${p.week}-${p.payType}`}>
    <button type="button" className="payslip-head" onClick={() => setOpen(v => !v)}>
      <span><b>Week {p.week}</b> · {day(p.start)} – {day(p.end)} {p.taxYear}</span>
      <span className={`payslip-type ${p.payType}`}>{p.payType === 'paye' ? 'PAYE' : 'Contractor'}</span>
      <strong>{money(p.net)}</strong>
    </button>
    {open && <div className="payslip-body">
      {p.lines.map(l => <div className="payslip-line" key={l.checkoutId}><span>{day(l.date)} · {l.shiftTitle} · {l.businessName}</span><b>{money(l.gross)}</b></div>)}
      <div className="payslip-sum"><span>Gross pay</span><b>{money(p.gross)}</b></div>
      {p.payType === 'paye' ? <>
        <div className="payslip-sum minus"><span>Income Tax (code {p.taxCode})</span><b>−{money(p.incomeTax)}</b></div>
        <div className="payslip-sum minus"><span>National Insurance (cat. {p.niCategory})</span><b>−{money(p.employeeNi)}</b></div>
        <div className="payslip-sum net"><span>Take-home pay</span><b data-testid="payslip-net">{money(p.net)}</b></div>
      </> : <p className="payslip-note">Paid gross as a self-employed contractor. Remember to declare this income through Self Assessment.</p>}
    </div>}
  </article>;
}

export default function WorkerPayroll({ setNotice = () => {} }) {
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({ payType: 'contractor', taxCode: '1257L', niCategory: 'A', confirmed: false });
  const [payslips, setPayslips] = useState([]);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [s, p] = await Promise.all([request('/worker/pay-settings'), request('/worker/payslips')]);
      setSettings(s.settings); setPayslips(p.payslips || []);
      setDraft(d => ({ ...d, payType: s.settings.payType, taxCode: s.settings.taxCode || '1257L', niCategory: s.settings.niCategory || 'A' }));
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault(); setSaving(true); setError('');
    try { await request('/worker/pay-settings', { method: 'PUT', body: JSON.stringify(draft) }); setNotice('Pay settings saved. They apply to shifts from now on.'); await load(); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  const changed = settings && (draft.payType !== settings.payType || (draft.payType === 'paye' && (draft.taxCode !== settings.taxCode || draft.niCategory !== settings.niCategory)));
  return <section className="worker-payroll" data-testid="worker-payroll">
    <span className="eyebrow">PAY & TAX</span>
    <h2>How you get paid</h2>
    <p className="worker-payroll-intro">Choose how hyrz pays you. You can switch at any time; the change applies to shifts you work from now on.</p>
    <form onSubmit={save}>
      <div className="pay-type-grid">
        <PayTypeCard id="contractor" title="Independent contractor" text="Paid your full gross pay. You sort out your own tax and NI through Self Assessment." chosen={draft.payType === 'contractor'} onChoose={v => setDraft({ ...draft, payType: v })} />
        <PayTypeCard id="paye" title="hyrz PAYE" text="We take off Income Tax and National Insurance for you and give you a payslip for every week you work." chosen={draft.payType === 'paye'} onChoose={v => setDraft({ ...draft, payType: v })} />
      </div>
      {draft.payType === 'paye' && <div className="paye-fields">
        <label>Tax code<input value={draft.taxCode} onChange={e => setDraft({ ...draft, taxCode: e.target.value.toUpperCase() })} placeholder="1257L" data-testid="paye-tax-code-input" /><small>On your P45, P60 or HMRC app. Use 1257L if this is your only job.</small></label>
        <label>National Insurance category<select value={draft.niCategory} onChange={e => setDraft({ ...draft, niCategory: e.target.value })} data-testid="paye-ni-category-select">
          <option value="A">A – standard</option><option value="M">M – under 21</option><option value="H">H – apprentice under 25</option><option value="C">C – over State Pension age</option>
        </select></label>
        <label className="paye-confirm"><input type="checkbox" checked={draft.confirmed} onChange={e => setDraft({ ...draft, confirmed: e.target.checked })} data-testid="paye-confirm-checkbox" /> I confirm these details are correct and I want hyrz to pay me through PAYE.</label>
      </div>}
      {error && <div className="alert error" role="alert" data-testid="pay-settings-error">{error}</div>}
      <button className="primary" disabled={!changed || saving} data-testid="pay-settings-save-button">{saving ? 'Saving…' : 'Save pay settings'}</button>
      {settings && <small className="pay-current" data-testid="pay-settings-current">Currently paid as: <b>{settings.payType === 'paye' ? `hyrz PAYE (${settings.taxCode}, cat. ${settings.niCategory})` : 'Independent contractor'}</b></small>}
    </form>
    <h3 className="payslips-title">Payslips</h3>
    {payslips.length ? <div className="payslip-list" data-testid="payslip-list">{payslips.map(p => <Payslip key={`${p.taxYear}-${p.week}-${p.payType}`} p={p} />)}</div>
      : <p className="payslip-empty" data-testid="payslip-empty">Your payslips appear here once an employer approves your checked-out hours.</p>}
  </section>;
}
