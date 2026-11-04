import React from 'react';
import { CheckCheck, Check, Image as ImageIcon } from 'lucide-react';
import { avatarColor, initials, listTime } from './chatUtils';

export function Avatar({ id, name, size = 46 }) {
  return <span className="chat-avatar" style={{ background: avatarColor(id), width: size, height: size, fontSize: size * 0.36 }}>{initials(name)}</span>;
}

function Preview({ c }) {
  if (c.otherTyping) return <span className="chat-typing-text">typing…</span>;
  const m = c.lastMessage;
  if (!m) return <span className="chat-muted">No messages yet, say hello</span>;
  return <span className="chat-preview-line">
    {m.mine && (m.read ? <CheckCheck size={15} className="tick read" /> : <Check size={15} className="tick" />)}
    {m.kind === 'gif' && <ImageIcon size={14} />}
    <span>{m.text}</span>
  </span>;
}

export default function ConversationList({ conversations, loading, activeId, onSelect }) {
  if (loading) return <div className="chat-list">{[0, 1, 2].map(i => <div key={i} className="chat-skeleton" />)}</div>;
  if (!conversations.length) return <div className="chat-list-empty" data-testid="chat-list-empty">No chats yet</div>;
  return (
    <div className="chat-list" data-testid="chat-conversation-list">
      {conversations.map(c => (
        <button key={c.id} className={`chat-item ${c.id === activeId ? 'active' : ''}`} onClick={() => onSelect(c.id)} data-testid={`chat-conversation-${c.id}`}>
          <Avatar id={c.other.id} name={c.other.name} />
          <div className="chat-item-body">
            <div className="chat-item-top">
              <strong>{c.other.name}</strong>
              <small className={c.unread ? 'unread-time' : ''}>{listTime(c.activityAt)}</small>
            </div>
            <div className="chat-item-shift">{c.shiftTitle} · {c.businessName}</div>
            <div className="chat-item-bottom">
              <Preview c={c} />
              {c.unread > 0 && <span className="chat-unread" data-testid={`chat-unread-${c.id}`}>{c.unread}</span>}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
