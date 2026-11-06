import React, { useEffect, useState } from 'react';
import { request } from '../../api';
import './fee-tier.css';

const money = n => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n || 0));
const day = s => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function Meter({ label, value, target, testid }) {
  const pct = Math.min(100, Math.round((value / target) * 100));
  return <div className="fee-meter" data-testid={testid}>
    <div className="fee-meter-top"><span>{label}</span><b>{value} / {target}</b></div>
    <div className="fee-meter-bar"><i style={{ width: pct + '%' }} className={pct >= 100 ? 'done' : ''} /></div>
  </div>;
}

export default function FeeTierCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { request('/employer/fee-tier').then(setData).catch(e => setError(e.message)); }, []);
  if (error) return <p className="muted" data-testid="fee-tier-error">{error}</p>;
  if (!data) return null;
  const { rules: r, currentWeek: w, credits } = data;
  return <section className="fee-tier-card" data-testid="fee-tier-card">
    <div className="fee-tier-head">
      <div><span className="eyebrow">BULK RATE · THIS WEEK</span><h3>{day(w.start)} – {day(w.end)}</h3></div>
      <span className={`fee-tier-badge ${w.qualifies ? 'on' : ''}`} data-testid="fee-tier-status">{w.qualifies ? `Bulk rate unlocked · ${money(w.estimatedCredit)} back` : 'Standard rate'}</span>
    </div>
    <div className="fee-tier-meters">
      <Meter label="Different workers" value={w.workers} target={r.bulkMinWorkers} testid="fee-tier-workers" />
      <Meter label="Hours worked" value={w.hours} target={r.bulkMinHours} testid="fee-tier-hours" />
    </div>
    <p className="fee-tier-rules" data-testid="fee-tier-rules">Our fee is {money(r.standardHourly)} per hour worked when the hourly rate is {money(r.rateCap)} or less, and 10p for every £1 paid when it is higher. Hire {r.bulkMinWorkers}+ different workers for {r.bulkMinHours}+ hours in a Monday–Sunday week and the fee drops to {money(r.bulkHourly)} per hour. Invoices are raised at {money(r.standardHourly)}/hr and the difference comes back as a credit when the week ends.</p>
    {credits.length > 0 && <div className="fee-tier-credits" data-testid="fee-tier-credits">
      <strong>Bulk rate credits · {money(data.totalCredits)} total</strong>
      {credits.map(c => <div className="fee-tier-credit" key={c.id}><span>Week of {day(c.week_start)} · {c.workers} workers · {c.hours} hrs</span><b>−{money(c.amount)}</b></div>)}
    </div>}
  </section>;
}
