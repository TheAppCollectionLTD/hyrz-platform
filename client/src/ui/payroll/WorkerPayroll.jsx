import React, { useEffect, useState } from 'react';
import { request } from '../../api';
import { downloadPayslipPdf } from './payslipPdf';
import PayTypeChooser, { payChoiceBody } from './PayTypeChooser';
import './payroll.css';

const money = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n || 0));
const day = s => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const today = () => new Date().toISOString().slice(0, 10);

function Payslip({ p, worker }) {
  const [open, setOpen] = useState(false);
  return <article className="payslip" data-testid={`payslip-${p.taxYear}-${p.week}-${p.payType}`}>
    <button type="button" className="payslip-head" onClick={() => setOpen(v => !v)}>
      <span><b>Week {p.week}</b> · {day(p.start)} – {day(p.end)} {p.taxYear}</span>
      <span className={`payslip-type ${p.payType}`}>{p.payType === 'paye' ? 'PAYE' : 'Contractor'}</span>
      <strong>{money(p.net)}</strong>
    </button>
    {p.payDate && <small className="payslip-paydate" data-testid="payslip-pay-date">{p.payDate <= today() ? 'Paid' : 'Pay day'} {new Date(p.payDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · one week in arrears</small>}
    {open && <div className="payslip-body">
      {p.lines.map(l => <div className="payslip-line" key={l.checkoutId}><span>{day(l.date)} · {l.shiftTitle} · {l.businessName}</span><b>{money(l.gross)}</b></div>)}
      <div className="payslip-sum"><span>Gross pay</span><b>{money(p.gross)}</b></div>
      {p.payType === 'paye' ? <>
        <div className="payslip-sum minus"><span>Income Tax (code {p.taxCode})</span><b>−{money(p.incomeTax)}</b></div>
        <div className="payslip-sum minus"><span>National Insurance (cat. {p.niCategory})</span><b>−{money(p.employeeNi)}</b></div>
        <div className="payslip-sum net"><span>Take-home pay</span><b data-testid="payslip-net">{money(p.net)}</b></div>
      </> : <p className="payslip-note">Paid gross as a self-employed contractor. Remember to declare this income through Self Assessment.</p>}
      <button type="button" className="payslip-download" onClick={() => downloadPayslipPdf(p, worker)} data-testid={`payslip-download-${p.taxYear}-${p.week}-${p.payType}`}>Download PDF</button>
    </div>}
  </article>;
}

export default function WorkerPayroll({ setNotice = () => {} }) {
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({ payType: 'contractor', taxCode: '1257L', niCategory: 'A', contractAccepted: false });
  const [payslips, setPayslips] = useState([]);
  const [worker, setWorker] = useState({});
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [s, p] = await Promise.all([request('/worker/pay-settings'), request('/worker/payslips')]);
      setSettings(s.settings); setPayslips(p.payslips || []); setWorker(p.worker || {});
      setDraft({ payType: s.settings.payType, taxCode: s.settings.taxCode || '1257L', niCategory: s.settings.niCategory || 'A', contractAccepted: false });
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function save(e) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await request('/worker/pay-settings', { method: 'PUT', body: JSON.stringify(payChoiceBody(draft)) });
      setNotice('Pay settings saved. The change applies straight away to shifts you work from now on.');
      window.dispatchEvent(new CustomEvent('hyrz-pay-type', { detail: draft.payType }));
      await load();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  const changed = settings && (draft.payType !== settings.payType || (draft.payType === 'paye' && (draft.taxCode !== settings.taxCode || draft.niCategory !== settings.niCategory)));
  return <section className="worker-payroll" data-testid="worker-payroll">
    <span className="eyebrow">PAY & TAX</span>
    <h2>How you get paid</h2>
    <p className="worker-payroll-intro">Choose how hyrz pays you. You can switch at any time. The change applies straight away to shifts you work from then on; shifts already worked are paid the way they were worked.</p>
    <form onSubmit={save}>
      <PayTypeChooser value={draft} onChange={setDraft} currentType={settings?.payType} />
      {error && <div className="alert error" role="alert" data-testid="pay-settings-error">{error}</div>}
      <button className="primary" disabled={!changed || !draft.contractAccepted || saving} data-testid="pay-settings-save-button">{saving ? 'Saving…' : 'Save pay settings'}</button>
      {settings && <small className="pay-current" data-testid="pay-settings-current">Currently paid as: <b>{settings.payType === 'paye' ? `hyrz PAYE (${settings.taxCode}, cat. ${settings.niCategory})` : 'Independent contractor'}</b></small>}
    </form>
    <h3 className="payslips-title">Payslips</h3>
    {payslips.length ? <div className="payslip-list" data-testid="payslip-list">{payslips.map(p => <Payslip key={`${p.taxYear}-${p.week}-${p.payType}`} p={p} worker={worker} />)}</div>
      : <p className="payslip-empty" data-testid="payslip-empty">Your payslips appear here once an employer approves your checked-out hours.</p>}
  </section>;
}
