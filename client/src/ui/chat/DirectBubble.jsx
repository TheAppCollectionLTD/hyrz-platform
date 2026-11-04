import React, { useState } from 'react';
import { Ban, Check, CheckCheck, Clock, CornerUpLeft, SmilePlus, Trash2 } from 'lucide-react';
import MessageBody from './MessageBody';
import ChatPhoto from './ChatPhoto';
import { QUICK_REACTIONS, bigEmojiCount, fullName, isGif, previewText, timeOf } from './chatUtils';

export default function DirectBubble({ conversationId, m, meId, mine, tail, onReply, onReact, onDelete, focused, onQuoteClick }) {
  const [menu, setMenu] = useState(false);
  const [selected, setSelected] = useState(false);
  const close = () => { setMenu(false); setSelected(false); };
  const deleted = Boolean(m.deleted_at);
  const photo = !deleted && Boolean(Number(m.has_image));
  const gif = !deleted && !photo && isGif(m.body);
  const big = !deleted && !gif && bigEmojiCount(m.body);
  const testId = `direct-message-${m.id}`;
  const reactions = m.reactions || [];
  const cls = ['hz-bubble', (gif || photo) && 'gif', photo && 'photo', big && 'big', deleted && 'deleted', reactions.length && 'has-reactions'].filter(Boolean).join(' ');

  return (
    <div id={`direct-msg-${m.id}`} className={`hz-row ${mine ? 'mine' : 'theirs'} ${tail ? 'tail' : ''} ${focused ? 'focused' : ''} ${selected ? 'selected' : ''}`} onMouseLeave={close} data-testid={testId}>
      <div className={cls} onClick={e => { if (!m.pending && !deleted && !e.target.closest('button')) setSelected(v => !v); }}>
        {m.reply_to_message_id && <button type="button" className={`hz-quote ${Number(m.reply_sender_id) === Number(meId) ? '' : 'other'}`} onClick={() => onQuoteClick(m.reply_to_message_id)}>
          <b>{Number(m.reply_sender_id) === Number(meId) ? 'You' : fullName(m.reply_sender_first_name, m.reply_sender_last_name, 'Message')}</b>
          <span>{m.reply_deleted_at ? 'This message was deleted.' : previewText(m.reply_body)}</span>
        </button>}
        {deleted ? <span className="hz-deleted"><Ban size={14} /> This message was deleted</span> : photo ? <><ChatPhoto conversationId={conversationId} messageId={m.id} localSrc={m.localImage} />{m.body !== '📷 Photo' && <span className="hz-text hz-caption">{m.body}</span>}</> : <span className="hz-text"><MessageBody body={m.body} /></span>}
        <span className="hz-meta">
          {timeOf(m.created_at)}
          {mine && !deleted && (m.pending ? <Clock size={13} /> : m.read_at ? <CheckCheck size={16} className="hz-tick read" aria-label="Read" /> : <Check size={16} className="hz-tick" aria-label="Sent" />)}
        </span>
        {reactions.length > 0 && <div className="hz-reactions" data-testid={`${testId}-reactions`}>
          {reactions.map(r => <button type="button" key={r.emoji} className={r.reacted_by_me ? 'me' : ''} onClick={() => onReact(r.emoji)}>{r.emoji}{r.count > 1 && <small>{r.count}</small>}</button>)}
        </div>}
        {!m.pending && !deleted && <div className="hz-actions">
          <button type="button" onClick={() => setMenu(v => !v)} aria-label="React" data-testid={`${testId}-react-btn`}><SmilePlus size={16} /></button>
          <button type="button" onClick={() => { close(); onReply(); }} aria-label="Reply" data-testid={`${testId}-reply-btn`}><CornerUpLeft size={16} /></button>
          {mine && <button type="button" onClick={() => { close(); onDelete(); }} aria-label="Delete" data-testid={`${testId}-delete-btn`}><Trash2 size={16} /></button>}
        </div>}
        {menu && <div className="hz-react-bar" data-testid={`${testId}-react-bar`}>
          {QUICK_REACTIONS.map(e => <button type="button" key={e} onClick={() => { onReact(e); close(); }}>{e}</button>)}
        </div>}
      </div>
    </div>
  );
}
