import React, { useState } from 'react';
import { BellRing, CalendarCheck, Megaphone, Sparkles } from 'lucide-react';
import '../checkouts/checkouts.css';

const ago = v => {
  const m = Math.round((Date.now() - new Date(v)) / 60000);
  if (m < 1) return 'Just now'; if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); return d < 7 ? `${d}d ago` : new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const groupOf = v => { const d = (Date.now() - new Date(v)) / 86400000; return d < 1 ? 'Today' : d < 7 ? 'This week' : 'Earlier'; };
const iconFor = n => /shift|remind/i.test(n.notification_type + n.title) ? CalendarCheck : /broadcast|announce/i.test(n.notification_type) ? Megaphone : BellRing;

export function NotificationsList({ items, loaded, onRead }) {
  const [tab, setTab] = useState('all');
  const unread = items.filter(n => !n.read_at).length;
  const shown = items.filter(n => tab === 'all' || !n.read_at);
  let last = '';
  return <section className="panel nt-panel" data-testid="notifications-panel">
    <div className="nt-head"><div><span className="eyebrow">hyrz updates</span><h2>Notifications</h2><p>{unread ? `${unread} unread update${unread === 1 ? '' : 's'}` : 'You\'re all caught up'}</p></div>
      <div className="nt-tabs" role="tablist"><button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')} data-testid="notifications-tab-all">All</button><button type="button" className={tab === 'unread' ? 'on' : ''} onClick={() => setTab('unread')} data-testid="notifications-tab-unread">Unread{unread ? ` (${unread})` : ''}</button></div></div>
    {!loaded ? <div className="nt-empty">Loading notifications…</div> : shown.length ? shown.map(n => {
      const g = groupOf(n.created_at), head = g !== last ? (last = g) : null, Icon = iconFor(n);
      return <React.Fragment key={n.id}>{head && <div className="nt-group">{head}</div>}
        <article className={`nt-item${n.read_at ? '' : ' unread'}${/alert|warn|strike/i.test(n.notification_type || '') ? ' kind-alert' : ''}`} data-testid={`notification-${n.id}`}>
          <span className="nt-icon" aria-hidden="true"><Icon size={19} /></span>
          <div className="nt-copy"><strong>{n.title}</strong><p>{n.body}</p><small>{ago(n.created_at)}</small></div>
          <div className="nt-meta"><small>{ago(n.created_at)}</small>{!n.read_at && <button type="button" onClick={() => onRead(n)} data-testid={`notification-read-${n.id}`}>Mark read</button>}</div>
        </article></React.Fragment>;
    }) : <div className="nt-empty" data-testid="notifications-empty"><span className="nt-empty-icon"><Sparkles size={28} /></span><strong>{tab === 'unread' ? 'No unread notifications' : 'Nothing here yet'}</strong><span>Shift updates and announcements from hyrz will show up here.</span></div>}
  </section>;
}
