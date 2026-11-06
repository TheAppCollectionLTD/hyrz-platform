import React from 'react';
import './public.css';

const Icon = ({ d }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const BENEFITS = [
  ['pick', 'Pick your own shifts', 'Browse bar, restaurant, festival, retail, hotel and warehouse shifts near you. Work the days you want, and say no to the ones you don\'t.', 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 16l2 2 4-4'],
  ['fast', 'Get paid fast', 'Contractors can be paid as soon as hours are approved on shifts showing Instant Pay. PAYE pay lands every week, on a fixed Friday.', 'M13 2 4 14h7l-1 8 9-12h-7l1-8z'],
  ['rate', 'See the pay up front', 'Every shift shows the hourly rate, times and location before you apply, and you can ask for a different rate.', 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'],
  ['checked', 'Work for checked businesses', 'Every employer verifies their identity and business before they can post a shift.', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4'],
];

export function WorkerBenefits() {
  return <section className="pub-section pub-benefits" data-testid="public-worker-benefits">
    <div className="pub-section-head"><span className="pub-eyebrow">FOR WORKERS</span><h2>Flexible work that fits around you.</h2><p>Students, parents, performers, second-jobbers and full-time flexers use hyrz to earn on their own terms.</p></div>
    <div className="pub-benefit-grid">{BENEFITS.map(([id, t, d, icon]) => <article key={id} className="pub-benefit" data-testid={`public-benefit-${id}`}><span className="pub-benefit-icon"><Icon d={icon} /></span><h3>{t}</h3><p>{d}</p></article>)}</div>
  </section>;
}

export function PayOptions({ onJoin }) {
  return <section className="pub-section pub-pay" data-testid="public-pay-options">
    <div className="pub-section-head"><span className="pub-eyebrow">YOUR PAY, YOUR WAY</span><h2>Two ways to get paid. Switch any time.</h2><p>Choose when you sign up. Change your mind later in Profile &gt; Pay &amp; tax and it applies straight away.</p></div>
    <div className="pub-pay-grid">
      <article className="pub-pay-card" data-testid="public-pay-contractor"><span className="pub-pay-tag">Independent contractor</span><h3>Paid gross, fast.</h3><ul><li>Full gross pay for your approved hours</li><li>Instant Pay on shifts that offer it</li><li>Otherwise paid on the business's terms, within 14 days</li><li>You handle your own tax through Self Assessment</li></ul></article>
      <article className="pub-pay-card sun" data-testid="public-pay-paye"><span className="pub-pay-tag">hyrz PAYE employee</span><h3>Paid weekly, tax done for you.</h3><ul><li>Employed by hyrz, with one contract for every shift</li><li>Paid every week, one week in arrears, on Friday</li><li>Income Tax and National Insurance taken off automatically</li><li>A downloadable payslip every week</li></ul></article>
    </div>
    <button type="button" className="pub-cta" onClick={onJoin} data-testid="public-pay-join-button">Create your free worker account <span aria-hidden="true">→</span></button>
  </section>;
}

export function EmployerStrip({ onHire }) {
  return <section className="pub-employer-strip" data-testid="public-employer-strip">
    <div><span className="pub-eyebrow sun">HIRING?</span><h2>Need flexible, verified staff?</h2><p>Post a shift in minutes. hyrz handles applications, timesheets, payroll and one simple invoice.</p></div>
    <button type="button" onClick={onHire} data-testid="public-employer-cta">Post a shift <span aria-hidden="true">→</span></button>
  </section>;
}
