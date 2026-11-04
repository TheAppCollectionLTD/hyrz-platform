import React, { useState } from 'react';
import { Check, CheckCheck, Clock, CornerUpLeft, SmilePlus, Trash2, Ban } from 'lucide-react';
import { QUICK_REACTIONS, bigEmojiCount, timeOf } from './chatUtils';

function Meta({ m, read }) {
  return <span className="chat-meta">
    {timeOf(m.createdAt)}
    {m.mine && (m.pending ? <Clock size={13} /> : read ? <CheckCheck size={16} className="tick read" /> : <Check size={16} className="tick" />)}
  </span>;
}

export default function MessageBubble({ m, tail, read, onReply, onReact, onDelete }) {
  const [menu, setMenu] = useState(false);
  const big = m.kind === 'text' && !m.deleted ? bigEmojiCount(m.body) : 0;
  const counts = m.reactions.reduce((acc, r) => ({ ...acc, [r.emoji]: (acc[r.emoji] || 0) + 1 }), {});
  const side = m.mine ? 'mine' : 'theirs';
  const testId = `chat-message-${m.id}`;

  return (
    <div className={`chat-row ${side} ${tail ? 'with-tail' : ''}`} onMouseLeave={() => setMenu(false)} data-testid={testId}>
      <div className={`chat-bubble ${m.kind === 'gif' ? 'gif' : ''} ${big ? `big-emoji e${big}` : ''} ${m.deleted ? 'deleted' : ''} ${m.reactions.length ? 'has-reactions' : ''}`}>
        {m.replyTo && <div className={`chat-quote ${m.replyTo.mine ? 'mine' : ''}`}><b>{m.replyTo.mine ? 'You' : 'Them'}</b><span>{m.replyTo.text}</span></div>}
        {m.deleted
          ? <span className="chat-deleted"><Ban size={14} /> This message was deleted</span>
          : m.kind === 'gif'
            ? <img src={m.gifPreviewUrl || m.gifUrl} alt={m.gifTitle || 'GIF'} loading="lazy" data-testid={`${testId}-gif`} />
            : <span className="chat-text">{m.body}</span>}
        <Meta m={m} read={read} />
        {m.reactions.length > 0 && <button className="chat-reactions" onClick={() => onReact(m.reactions.find(r => r.mine)?.emoji || Object.keys(counts)[0])} data-testid={`${testId}-reactions`}>
          {Object.entries(counts).map(([e, n]) => <span key={e}>{e}{n > 1 && <small>{n}</small>}</span>)}
        </button>}
        {!m.pending && !m.deleted && <div className="chat-actions">
          <button onClick={() => setMenu(v => !v)} aria-label="React" data-testid={`${testId}-react-btn`}><SmilePlus size={16} /></button>
          <button onClick={onReply} aria-label="Reply" data-testid={`${testId}-reply-btn`}><CornerUpLeft size={16} /></button>
          {m.mine && <button onClick={onDelete} aria-label="Delete" data-testid={`${testId}-delete-btn`}><Trash2 size={16} /></button>}
        </div>}
        {menu && <div className="chat-react-bar" data-testid={`${testId}-react-bar`}>
          {QUICK_REACTIONS.map(e => <button key={e} onClick={() => { onReact(e); setMenu(false); }}>{e}</button>)}
        </div>}
      </div>
    </div>
  );
}
