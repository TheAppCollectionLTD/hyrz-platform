import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Search, X } from 'lucide-react';
import { request } from '../../api';
import DirectBubble from './DirectBubble';
import DirectComposer from './DirectComposer';
import { avatarColor, dayLabel, fullName, initials, toDate } from './chatUtils';
import './chat.css';

function lastSeen(value) {
  if (!value) return '';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  if (Date.now() - d.getTime() < 2 * 60000) return 'online';
  return `last seen ${dayLabel(value) === 'Today' ? 'today' : dayLabel(value)} at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function DirectChatRoom({ conversationId, conversation, user, onBack, onActivity = () => {}, onError = () => {} }) {
  const [messages, setMessages] = useState(null);
  const [pending, setPending] = useState([]);
  const [otherTyping, setOtherTyping] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [search, setSearch] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [showJump, setShowJump] = useState(false);
  const [bottom, setBottom] = useState(0);
  const scroller = useRef(null);
  const nearBottom = useRef(true);
  const lastId = useRef(0);
  const name = fullName(conversation?.participant_first_name, conversation?.participant_last_name, conversation?.participant_email || (user.role === 'worker' ? 'Employer' : 'Worker'));
  const base = `/conversations/${conversationId}`;

  async function load() {
    try {
      const d = await request(`${base}/messages`);
      setMessages(d.messages || []); setOtherTyping(Boolean(d.otherTyping));
      const newest = Number(d.messages?.at(-1)?.id || 0);
      if (newest > lastId.current) {
        if (lastId.current && !nearBottom.current) setShowJump(true);
        if (lastId.current) onActivity();
        lastId.current = newest;
      }
    } catch (e) { onError(e.message); }
  }

  useEffect(() => {
    load(); onActivity();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 2500);
    return () => { clearInterval(t); request(`${base}/typing`, { method: 'POST', body: JSON.stringify({ typing: false }) }).catch(() => {}); };
  }, [conversationId]);

  useLayoutEffect(() => {
    const measure = () => setBottom(document.querySelector('.worker-bottom-nav, .employer-bottom-nav')?.offsetHeight || 0);
    measure(); window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useLayoutEffect(() => {
    if (nearBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, pending, otherTyping]);

  function onScroll() {
    const el = scroller.current;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom.current) setShowJump(false);
  }
  function jump() { nearBottom.current = true; scroller.current.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); setShowJump(false); }
  function goTo(id) {
    const el = document.getElementById(`direct-msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFocusId(id); setTimeout(() => setFocusId(null), 1600);
  }

  async function send(body) {
    const temp = { id: `tmp-${Date.now()}`, pending: true, sender_id: user.id, body, created_at: new Date().toISOString(), reactions: [],
      reply_to_message_id: replyTo?.id, reply_body: replyTo?.body, reply_sender_id: replyTo?.sender_id,
      reply_sender_first_name: replyTo?.sender_first_name, reply_sender_last_name: replyTo?.sender_last_name };
    nearBottom.current = true;
    setPending(p => [...p, temp]); setReplyTo(null);
    try {
      await request(`${base}/messages`, { method: 'POST', body: JSON.stringify({ body, replyToMessageId: temp.reply_to_message_id || undefined }) });
      await load(); onActivity();
    } catch (e) { onError(e.message); }
    finally { setPending(p => p.filter(x => x.id !== temp.id)); }
  }

  async function react(m, emoji) {
    try { await request(`${base}/messages/${m.id}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) }); load(); }
    catch (e) { onError(e.message); }
  }

  async function remove(m) {
    if (!window.confirm('Delete this message for everyone?')) return;
    try { await request(`${base}/messages/${m.id}`, { method: 'DELETE' }); load(); onActivity(); }
    catch (e) { onError(e.message); }
  }

  const q = (search || '').trim().toLowerCase();
  const all = [...(messages || []), ...pending].filter(m => !q || String(m.body || '').toLowerCase().includes(q));
  const status = otherTyping ? 'typing…' : lastSeen(conversation?.participant_last_seen_at) || (user.role === 'worker' ? 'Employer' : 'Worker');

  return (
    <section className="hz-room" style={{ '--hz-bottom': `${bottom}px` }} data-testid="direct-chat-room">
      <header className="hz-head">
        <button type="button" className="hz-icon" onClick={onBack} aria-label="Back to conversations" data-testid="chat-back-button"><ArrowLeft size={20} /></button>
        {conversation?.participant_profile_picture
          ? <img className="hz-avatar" src={conversation.participant_profile_picture} alt="" />
          : <span className="hz-avatar" style={{ background: avatarColor(conversation?.participant_id) }}>{initials(name)}</span>}
        <div className="hz-title">
          <strong data-testid="chat-thread-name">{name}</strong>
          <small className={otherTyping ? 'typing' : status === 'online' ? 'online' : ''} data-testid="chat-thread-status">{status}</small>
        </div>
        {search === null
          ? <button type="button" className="hz-icon" onClick={() => setSearch('')} aria-label="Search messages" data-testid="chat-search-open"><Search size={19} /></button>
          : <label className="hz-head-search"><Search size={15} /><input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search messages" data-testid="chat-search-input" />
              <button type="button" onClick={() => setSearch(null)} aria-label="Close search"><X size={15} /></button></label>}
      </header>

      <div className="hz-wall" ref={scroller} onScroll={onScroll} data-testid="chat-messages">
        <div className="hz-note">Messages in this chat are only visible to you and {name.split(' ')[0]}. Keep conversations about work respectful.</div>
        {messages === null && <div className="hz-loading">Loading messages…</div>}
        {messages?.length === 0 && !pending.length && <div className="hz-loading">No messages yet. Say hello 👋</div>}
        {all.map((m, i) => {
          const prev = all[i - 1];
          const mine = Number(m.sender_id) === Number(user.id);
          const newDay = !prev || toDate(prev.created_at).toDateString() !== toDate(m.created_at).toDateString();
          const grouped = prev && !newDay && Number(prev.sender_id) === Number(m.sender_id) && toDate(m.created_at) - toDate(prev.created_at) < 5 * 60000;
          return <React.Fragment key={m.id}>
            {newDay && <div className="hz-day"><span>{dayLabel(m.created_at)}</span></div>}
            <DirectBubble m={m} meId={user.id} mine={mine} tail={!grouped} focused={Number(focusId) === Number(m.id)} onQuoteClick={goTo}
              onReply={() => setReplyTo(m)} onReact={e => react(m, e)} onDelete={() => remove(m)} />
          </React.Fragment>;
        })}
        {otherTyping && <div className="hz-row theirs tail" data-testid="chat-typing-indicator"><div className="hz-bubble hz-typing"><i /><i /><i /></div></div>}
      </div>
      {showJump && <button type="button" className="hz-jump" onClick={jump} aria-label="Jump to latest" data-testid="chat-jump-latest"><ChevronDown size={20} /></button>}
      <DirectComposer user={user} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onSend={send}
        onTyping={typing => request(`${base}/typing`, { method: 'POST', body: JSON.stringify({ typing }) }).catch(() => {})} />
    </section>
  );
}
