import React, { useEffect, useState } from 'react';
import { TERMS_EFFECTIVE, TERMS_SECTIONS, TERMS_VERSION } from './termsContent';
import './terms.css';

function Contents({ active, onJump }) {
  let lastPart = '';
  return <div className="terms-contents" role="navigation" aria-label="Contents" data-testid="terms-contents">
    <strong>Contents</strong>
    <ol>{TERMS_SECTIONS.map(([id, part, title], i) => {
      const head = part !== lastPart; lastPart = part;
      return <React.Fragment key={id}>
        {head && <li className="terms-contents-part" aria-hidden="true">{part}</li>}
        <li><button type="button" className={active === id ? 'active' : ''} onClick={() => onJump(id)} data-testid={`terms-contents-${id}`}><span>{i + 1}.</span>{title}</button></li>
      </React.Fragment>;
    })}</ol>
  </div>;
}

function Section({ n, id, title, summary, points }) {
  return <section id={`terms-${id}`} className="terms-section" data-testid={`terms-section-${id}`}>
    <h3><span>{n}.</span> {title}</h3>
    <div className="terms-summary"><b>In short</b><p>{summary}</p></div>
    <ol className="terms-points">{points.map((p, i) => <li key={i}><span>{n}.{i + 1}</span><p>{p}</p></li>)}</ol>
  </section>;
}

export default function TermsDocument({ compact = false }) {
  const [active, setActive] = useState(TERMS_SECTIONS[0][0]);
  const jump = id => { setActive(id); document.getElementById(`terms-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  useEffect(() => {
    const obs = new IntersectionObserver(es => { const v = es.find(e => e.isIntersecting); if (v) setActive(v.target.id.replace('terms-', '')); }, { rootMargin: '-90px 0px -60% 0px' });
    document.querySelectorAll('.terms-section').forEach(s => obs.observe(s));
    return () => obs.disconnect();
  }, []);
  let lastPart = '';
  return <div className={`terms-doc ${compact ? 'compact' : ''}`} data-testid="terms-document">
    {!compact && <Contents active={active} onJump={jump} />}
    <article className="terms-body">
      <div className="terms-head">
        <span className="terms-eyebrow">HYRZ · TERMS &amp; CONDITIONS</span>
        <h2>Terms &amp; Conditions</h2>
        <p className="terms-meta" data-testid="terms-version">Version {TERMS_VERSION} · Effective {TERMS_EFFECTIVE}</p>
        <p className="terms-intro">Please read these terms carefully. Each section starts with a short plain-English summary, followed by the full detail. The summaries help you understand the terms but the full detail is what applies.</p>
        {!compact && <button type="button" className="terms-print" onClick={() => window.print()} data-testid="terms-print-button">Print or save as PDF</button>}
      </div>
      {TERMS_SECTIONS.map(([id, part, title, summary, points], i) => {
        const head = part !== lastPart; lastPart = part;
        return <React.Fragment key={id}>{head && <h4 className="terms-part">{part}</h4>}<Section n={i + 1} id={id} title={title} summary={summary} points={points} /></React.Fragment>;
      })}
    </article>
  </div>;
}
