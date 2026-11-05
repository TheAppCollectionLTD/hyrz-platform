import React, { useState } from 'react';
import { ArrowRight, Check, Clock, MessageCircle, Scale } from 'lucide-react';
import './checkouts.css';

const STATUS = { open: ['In progress', 'is-open'], submitted: ['To review', 'is-review'], pending: ['To review', 'is-review'], disputed: ['Disputed', 'is-disputed'], approved: ['Approved', 'is-approved'], paid: ['Paid', 'is-approved'], completed: ['Completed', 'is-approved'], rejected: ['Rejected', 'is-disputed'] };
const t = v => v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '--:--';
const day = v => v ? new Date(v).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Date not set';
const initials = n => String(n || '?').trim().split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();

function duration(start, end, breakMinutes) {
  if (!start || !end) return null;
  const mins = Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000) - Number(breakMinutes || 0));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

export function CheckoutSummary({ checkouts, money, filter, setFilter }) {
  const s = k => String(k.status || '').toLowerCase();
  const review = checkouts.filter(c => ['submitted', 'pending'].includes(s(c)));
  const disputed = checkouts.filter(c => s(c) === 'disputed');
  const approved = checkouts.filter(c => ['approved', 'paid', 'completed'].includes(s(c)));
  const sum = list => list.reduce((a, c) => a + Number(c.counter_gross_pay ?? c.gross_pay ?? 0) + Number(c.platform_fee || 0), 0);
  const cards = [['open', 'To review', review.length, review.length ? `${money(sum(review))} waiting` : 'All caught up', 'tone-sun'], ['disputed', 'Disputed', disputed.length, disputed.length ? 'Needs agreement' : 'No disputes', 'tone-red'], ['approved', 'Approved', approved.length, money(sum(approved)) + ' total', 'tone-green'], ['all', 'All timesheets', checkouts.length, 'Everything recorded', 'tone-navy']];
  return <div className="co-summary" data-testid="checkout-summary">{cards.map(([id, label, n, sub, tone]) => <button type="button" key={id} className={`co-stat ${tone}${filter === id ? ' active' : ''}`} onClick={() => setFilter(id)} data-testid={`checkout-filter-${id}`}><span>{label}</span><strong>{n}</strong><small>{sub}</small></button>)}</div>;
}

export function CheckoutCard({ checkout: c, role, money, onApprove, onMessage, workerControls, counterOffer }) {
  const [showCounter, setShowCounter] = useState(false);
  const status = String(c.status || '').toLowerCase();
  const [label, cls] = STATUS[status] || [status, 'is-open'];
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || (role === 'worker' ? c.business_name : '') || 'Worker';
  const start = c.actual_start || c.clocked_in_at, end = c.actual_end || c.clocked_out_at;
  const gross = Number(c.counter_gross_pay ?? c.gross_pay ?? 0), fee = Number(c.platform_fee || 0);
  const canReview = ['employer', 'admin'].includes(role) && status === 'submitted';
  return <article className={`co-card ${cls}`} data-testid={`checkout-card-${c.id}`}>
    <div className="co-who">
      <span className="co-avatar" aria-hidden="true">{initials(role === 'worker' ? (c.business_name || c.title) : name)}</span>
      <div className="co-who-copy">
        <strong data-testid={'checkout-worker-' + c.id}>{role === 'worker' ? (c.title || 'Shift') : name}</strong>
        <span>{role === 'worker' ? (c.business_name || '') : (c.title || 'Shift')}</span>
        <small>{day(start)} · #{c.id}{Number(c.is_test) > 0 ? ' · Test' : ''}</small>
      </div>
      <span className={`co-pill ${cls}`}>{label}</span>
    </div>
    <div className="co-time" aria-label="Hours worked">
      <div><small>Clocked in</small><b>{t(c.clocked_in_at || start)}</b></div>
      <ArrowRight size={18} className="co-arrow" aria-hidden="true" />
      <div><small>Clocked out</small><b>{t(c.clocked_out_at || end)}</b></div>
      <div className="co-dur"><Clock size={15} aria-hidden="true" /><span>{duration(start, end, c.break_minutes) || 'In progress'}{Number(c.break_minutes) ? ` · ${c.break_minutes}m break` : ''}</span></div>
    </div>
    <div className="co-money">
      <div><small>Worker pay</small><b>{money(gross)}</b></div>
      {role !== 'worker' && <div><small>hyrz fee</small><b>{money(fee)}</b></div>}
      <div className="co-total"><small>{role === 'worker' ? 'You earn' : 'Total'}</small><b>{money(role === 'worker' ? gross : gross + fee)}</b></div>
    </div>
    {c.counter_gross_pay != null && <p className="co-note"><Scale size={15} /> Counter-offer: {money(c.counter_gross_pay)}{c.employer_comment ? ` · "${c.employer_comment}"` : ''}</p>}
    {c.worker_adjustment_reason && <p className="co-note">Worker note: {c.worker_adjustment_reason}</p>}
    {workerControls}
    {(canReview || onMessage || counterOffer) && <div className="co-actions">
      {canReview && <button type="button" className="co-btn co-approve" onClick={onApprove} data-testid={'checkout-approve-' + c.id}><Check size={17} /> Approve hours</button>}
      {counterOffer && <button type="button" className={`co-btn co-ghost${showCounter ? ' on' : ''}`} onClick={() => setShowCounter(v => !v)} data-testid={'checkout-counter-toggle-' + c.id}><Scale size={16} /> Counter-offer</button>}
      {onMessage && <button type="button" className="co-btn co-ghost" onClick={onMessage} data-testid={'checkout-message-' + c.id}><MessageCircle size={16} /> Message</button>}
    </div>}
    {counterOffer && showCounter && <div className="co-counter">{counterOffer}</div>}
  </article>;
}
