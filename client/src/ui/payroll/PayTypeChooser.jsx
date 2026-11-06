import React from 'react';
import { CONTRACT_VERSIONS, PAY_CONTRACTS, SWITCH_NOTES } from './payContracts';
import './payroll.css';

export const emptyPayChoice = { payType: '', taxCode: '1257L', niCategory: 'A', contractAccepted: false };
export const payChoiceBody = c => ({ payType: c.payType, taxCode: c.taxCode, niCategory: c.niCategory, contractAccepted: c.contractAccepted, contractVersion: CONTRACT_VERSIONS[c.payType] });

function TypeCard({ id, title, text, chosen, onChoose }) {
  return <button type="button" className={`pay-type-card ${chosen ? 'on' : ''}`} onClick={() => onChoose(id)} aria-pressed={chosen} data-testid={`pay-type-${id}`}>
    <span className="pay-type-radio" /><strong>{title}</strong><small>{text}</small>
  </button>;
}

export function PayContract({ type }) {
  const c = PAY_CONTRACTS[type];
  return <div className="pay-contract" data-testid={`pay-contract-${type}`}>
    <h4>{c.title}</h4>
    {c.sections.map(([h, t]) => <p key={h}><strong>{h}.</strong> {t}</p>)}
    <small>Version {CONTRACT_VERSIONS[type]}</small>
  </div>;
}

function SwitchNotes({ type }) {
  return <div className="pay-switch-notes" data-testid="pay-switch-notes"><strong>What changes when you switch</strong><ul>{SWITCH_NOTES[type].map(n => <li key={n}>{n}</li>)}</ul></div>;
}

export default function PayTypeChooser({ value, onChange, currentType = null }) {
  const set = patch => onChange({ ...value, ...patch });
  const switching = currentType && value.payType && value.payType !== currentType;
  return <div className="pay-type-chooser" data-testid="pay-type-chooser">
    <div className="pay-type-grid">
      <TypeCard id="contractor" title="Independent contractor" text="Paid your full gross pay on each business's terms, with Instant Pay where available. You handle your own tax through Self Assessment." chosen={value.payType === 'contractor'} onChoose={v => set({ payType: v, contractAccepted: false })} />
      <TypeCard id="paye" title="hyrz PAYE employee" text="Employed by hyrz and paid weekly, one week in arrears. We take off Income Tax and NI and give you a payslip every week." chosen={value.payType === 'paye'} onChoose={v => set({ payType: v, contractAccepted: false })} />
    </div>
    {value.payType === 'paye' && <div className="paye-fields">
      <label>Tax code<input value={value.taxCode} onChange={e => set({ taxCode: e.target.value.toUpperCase() })} placeholder="1257L" data-testid="paye-tax-code-input" /><small>On your P45, P60 or HMRC app. Use 1257L if this is your only job.</small></label>
      <label>National Insurance category<select value={value.niCategory} onChange={e => set({ niCategory: e.target.value })} data-testid="paye-ni-category-select">
        <option value="A">A – standard</option><option value="M">M – under 21</option><option value="H">H – apprentice under 25</option><option value="C">C – over State Pension age</option>
      </select></label>
    </div>}
    {switching && <SwitchNotes type={value.payType} />}
    {value.payType && <>
      <PayContract type={value.payType} />
      <label className="pay-contract-agree"><input type="checkbox" checked={value.contractAccepted} onChange={e => set({ contractAccepted: e.target.checked })} data-testid="pay-contract-agree-checkbox" />
        <span>I have read and agree to the {PAY_CONTRACTS[value.payType].title}{value.payType === 'paye' ? ', and confirm my tax code and NI category are correct' : ''}.</span></label>
    </>}
  </div>;
}
