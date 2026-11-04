import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, CalendarDays } from 'lucide-react';
import { request } from '../../api';
import { Avatar } from './ConversationList';
import MessageBubble from './MessageBubble';
import Composer from './Composer';
import { dayLabel } from './chatUtils';

export default function ChatThread({ conversation, user, onBack, onActivity }) {
  const [messages, setMessages] = useState(null);
  const [pending, setPending] = useState([]);
  const [otherRead, setOtherRead] = useState(0);
  const [otherTyping, setOtherTyping] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [showJump, setShowJump] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef(null);
  const lastId = useRef(0);
  const nearBottom = useRef(true);

  async function load() {
    try {
      const d = await request(`/conversations/${conversation.id}/messages`);
      setMessages(d.messages); setOtherRead(d.otherLastRead); setOtherTyping(d.otherTyping);
      const newest = d.messages.at(-1)?.id || 0;
      if (newest > lastId.current) {
        if (lastId.current && !nearBottom.current) setShowJump(true);
        lastId.current = newest;
        if (document.visibilityState === 'visible' && d.messages.some(m => !m.mine)) {
          request(`/conversations/${conversation.id}/read`, { method: 'POST', body: '{}' }).then(onActivity).catch(() => {});
        }
      }
    } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 2500);
    return () => clearInterval(t);
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

  async function send(payload) {
    const temp = { id: `tmp-${Date.now()}`, mine: true, pending: true, createdAt: Date.now(), reactions: [],
      replyTo: replyTo ? { id: replyTo.id, mine: replyTo.mine, text: replyTo.kind === 'gif' ? 'GIF' : replyTo.body } : null, ...payload };
    nearBottom.current = true;
    setPending(p => [...p, temp]);
    setReplyTo(null);
    try {
      await request(`/conversations/${conversation.id}/messages`, { method: 'POST', body: JSON.stringify({ ...payload, replyToId: temp.replyTo?.id }) });
      await load(); onActivity();
    } catch (e) { setError(e.message); }
    finally { setPending(p => p.filter(m => m.id !== temp.id)); }
  }

  async function react(m, emoji) {
    const current = m.reactions.find(r => r.mine)?.emoji;
    await request(`/chat-messages/${m.id}/reaction`, { method: 'PUT', body: JSON.stringify({ emoji: current === emoji ? null : emoji }) }).catch(e => setError(e.message));
    load();
  }

  async function remove(m) {
    if (!window.confirm('Delete this message for everyone?')) return;
    await request(`/chat-messages/${m.id}`, { method: 'DELETE' }).catch(e => setError(e.message));
    load(); onActivity();
  }

  const all = [...(messages || []), ...pending];
  const shiftDate = new Date(conversation.shiftStartsAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="chat-thread" data-testid="chat-thread">
      <header className="chat-thread-head">
        <button className="chat-icon-btn chat-back" onClick={onBack} data-testid="chat-back-button" aria-label="Back"><ArrowLeft size={20} /></button>
        <Avatar id={conversation.other.id} name={conversation.other.name} size={42} />
        <div className="chat-thread-title">
          <strong data-testid="chat-thread-name">{conversation.other.name}</strong>
          <small className={otherTyping ? 'chat-typing-text' : ''} data-testid="chat-thread-status">
            {otherTyping ? 'typing…' : conversation.other.role === 'employer' ? conversation.businessName : 'Worker'}
          </small>
        </div>
        <div className="chat-shift-chip" data-testid="chat-shift-chip">
          <CalendarDays size={14} /><span>{conversation.shiftTitle}</span><em>{shiftDate}</em>
          <b className={`chat-app-status ${conversation.applicationStatus}`}>{conversation.applicationStatus}</b>
        </div>
      </header>

      <div className="chat-wallpaper" ref={scroller} onScroll={onScroll} data-testid="chat-messages">
        <div className="chat-encryption-note">Messages about this shift are visible only to you and {conversation.other.name.split(' ')[0]}.</div>
        {messages === null && <div className="chat-loading">Loading messages…</div>}
        {all.map((m, i) => {
          const prev = all[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const grouped = prev && !newDay && prev.mine === m.mine && m.createdAt - prev.createdAt < 5 * 60000;
          return <React.Fragment key={m.id}>
            {newDay && <div className="chat-day"><span>{dayLabel(m.createdAt)}</span></div>}
            <MessageBubble m={m} tail={!grouped} read={m.mine && !m.pending && otherRead >= m.id}
              onReply={() => setReplyTo(m)} onReact={e => react(m, e)} onDelete={() => remove(m)} />
          </React.Fragment>;
        })}
        {otherTyping && <div className="chat-row theirs" data-testid="chat-typing-indicator"><div className="chat-bubble typing-bubble"><i /><i /><i /></div></div>}
      </div>
      {showJump && <button className="chat-jump" onClick={jump} data-testid="chat-jump-latest"><ChevronDown size={20} /></button>}
      {error && <div className="chat-error inline" onClick={() => setError('')} data-testid="chat-thread-error">{error}</div>}
      <Composer theme={user.role === 'worker' ? 'dark' : 'light'} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onSend={send}
        onTyping={() => request(`/conversations/${conversation.id}/typing`, { method: 'POST', body: '{}' }).catch(() => {})} />
    </div>
  );
}
