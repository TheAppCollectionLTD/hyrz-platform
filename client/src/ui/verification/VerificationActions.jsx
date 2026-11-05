import React, { useEffect, useState } from 'react';
import { request } from '../../api';
import './verification.css';

function IdentityStep({ status, configured, onDone }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reason, setReason] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('identity-return')) return;
    params.delete('identity-return');
    window.history.replaceState({}, '', window.location.pathname + (params.toString() ? '?' + params : ''));
    request('/verification/identity/status').then(r => { setReason(r.reason || ''); onDone(); }).catch(e => setError(e.message));
  }, []);
  if (status === 'verified') return null;
  const start = async () => {
    setBusy(true); setError('');
    try { const r = await request('/verification/identity/session', { method: 'POST' }); window.location.assign(r.url); }
    catch (e) { setError(e.message || 'Could not start the ID check.'); setBusy(false); }
  };
  return <div className="vf-step" data-testid="verify-identity-step">
    <div><strong>Verify your identity</strong><p>Take a photo of your passport, driving licence or ID card and a quick selfie. Most checks finish in under 2 minutes.</p>
      {status === 'pending' && <p className="vf-info" data-testid="identity-processing">Your ID is being checked. This page will update when it's done.</p>}
      {status === 'rejected' && <p className="vf-warn" data-testid="identity-rejected">Your last check didn't go through{reason ? `: ${reason}` : ''}. Please try again with a clear photo.</p>}
      {!configured && <p className="vf-info">Automatic ID checks are being switched on. Please check back soon.</p>}
      {error && <p className="vf-warn" data-testid="identity-error">{error}</p>}</div>
    <button type="button" className="primary" disabled={busy || !configured || status === 'pending'} onClick={start} data-testid="start-identity-check">{busy ? 'Opening…' : status === 'rejected' ? 'Try again' : 'Verify my ID'}</button>
  </div>;
}

function RightToWorkStep({ status, submitted, onDone }) {
  const [code, setCode] = useState(''), [citizen, setCitizen] = useState(false), [dob, setDob] = useState(''), [busy, setBusy] = useState(false), [msg, setMsg] = useState(''), [error, setError] = useState('');
  if (status === 'verified') return null;
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await request('/verification/right-to-work', { method: 'POST', body: JSON.stringify({ shareCode: citizen ? '' : code, britishOrIrish: citizen, dateOfBirth: dob }) }); setMsg(r.message); onDone(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <form className="vf-step" onSubmit={submit} data-testid="rtw-step">
    <div><strong>Prove your right to work</strong><p>Get a free share code from <a href="https://www.gov.uk/prove-right-to-work" target="_blank" rel="noreferrer">GOV.UK</a> and enter it here.</p>
      {(submitted || msg) && <p className="vf-info" data-testid="rtw-submitted">{msg || 'Share code received. A hyrz admin will check it with the Home Office, usually within one working day.'}</p>}
      {error && <p className="vf-warn" data-testid="rtw-error">{error}</p>}
      <div className="vf-fields">
        {!citizen && <label>Share code<input value={code} onChange={e => setCode(e.target.value)} placeholder="W12 345 67A" maxLength={12} required data-testid="rtw-share-code" /></label>}
        <label>Date of birth<input type="date" value={dob} onChange={e => setDob(e.target.value)} required data-testid="rtw-dob" /></label>
      </div>
      <label className="vf-check"><input type="checkbox" checked={citizen} onChange={e => setCitizen(e.target.checked)} data-testid="rtw-british-irish" /> I'm a British or Irish citizen (no share code needed; we'll confirm using the passport from your ID check)</label></div>
    <button type="submit" className="primary" disabled={busy} data-testid="rtw-submit">{busy ? 'Sending…' : submitted ? 'Update share code' : 'Send share code'}</button>
  </form>;
}

function CompanyStep({ status, details, onDone }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [reason, setReason] = useState(details?.company?.reason || '');
  if (status === 'verified') return null;
  const recheck = async () => {
    setBusy(true); setError('');
    try { const r = await request('/verification/company/check', { method: 'POST' }); setReason(r.reason || ''); onDone(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="vf-step" data-testid="company-step">
    <div><strong>Company check with Companies House</strong><p>We check your company number is active, the name matches, and that you're listed as a director or officer.</p>
      {reason && <p className={status === 'rejected' ? 'vf-warn' : 'vf-info'} data-testid="company-check-reason">{reason}</p>}
      {error && <p className="vf-warn" data-testid="company-check-error">{error}</p>}</div>
    <button type="button" className="primary" disabled={busy || !details?.companyCheckConfigured} onClick={recheck} data-testid="company-recheck">{busy ? 'Checking…' : 'Check again'}</button>
  </div>;
}

export default function VerificationActions({ user, onboarding, refresh }) {
  const [details, setDetails] = useState(null);
  const load = () => request('/verification/details').then(setDetails).catch(() => setDetails({}));
  useEffect(() => { if (onboarding?.emailVerified) load(); }, [onboarding?.emailVerified]);
  if (!onboarding?.emailVerified) return <div className="vf-steps"><p className="vf-info" data-testid="verify-email-first">Open the link we emailed you to verify your email address. Then come back here to finish your checks.</p></div>;
  if (!details) return null;
  const done = async () => { await load(); await refresh(); };
  return <div className="vf-steps" data-testid="verification-actions">
    <IdentityStep status={onboarding.identityStatus} configured={details.identityConfigured} onDone={done} />
    {user.role === 'worker'
      ? <RightToWorkStep status={onboarding.rightToWorkStatus} submitted={details.rightToWork?.shareCodeSubmitted} onDone={done} />
      : <CompanyStep status={onboarding.companyStatus} details={details} onDone={done} />}
  </div>;
}
