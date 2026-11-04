import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Smile, SendHorizontal, X } from 'lucide-react';
import GifPicker from './GifPicker';

const EmojiPicker = lazy(() => import('emoji-picker-react'));

export default function Composer({ theme, replyTo, onCancelReply, onSend, onTyping }) {
  const [text, setText] = useState('');
  const [panel, setPanel] = useState(null);
  const input = useRef(null);
  const lastTyping = useRef(0);

  useEffect(() => {
    const el = input.current;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [text]);

  useEffect(() => { if (replyTo) input.current.focus(); }, [replyTo]);

  function change(v) {
    setText(v);
    if (v && Date.now() - lastTyping.current > 3000) { lastTyping.current = Date.now(); onTyping(); }
  }

  function insertEmoji(emoji) {
    const el = input.current, start = el.selectionStart ?? text.length, end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + emoji.length, start + emoji.length); });
  }

  function submit() {
    const body = text.trim();
    if (!body) return;
    onSend({ kind: 'text', body });
    setText(''); setPanel(null);
  }

  const toggle = p => setPanel(cur => cur === p ? null : p);

  return (
    <div className="chat-composer-wrap">
      {panel === 'emoji' && <div className="chat-panel emoji" data-testid="chat-emoji-panel">
        <Suspense fallback={<div className="chat-loading">Loading emoji…</div>}>
          <EmojiPicker onEmojiClick={e => insertEmoji(e.emoji)} theme={theme} width="100%" height={360}
            lazyLoadEmojis previewConfig={{ showPreview: false }} searchPlaceholder="Search emoji" />
        </Suspense>
      </div>}
      {panel === 'gif' && <GifPicker onPick={gif => { onSend({ kind: 'gif', ...gif }); setPanel(null); }} />}
      {replyTo && <div className="chat-reply-bar" data-testid="chat-reply-bar">
        <div className="chat-quote mine"><b>Replying to {replyTo.mine ? 'yourself' : 'them'}</b><span>{replyTo.kind === 'gif' ? 'GIF' : replyTo.body}</span></div>
        <button className="chat-icon-btn" onClick={onCancelReply} data-testid="chat-cancel-reply" aria-label="Cancel reply"><X size={18} /></button>
      </div>}
      <div className="chat-composer">
        <button className={`chat-icon-btn ${panel === 'emoji' ? 'on' : ''}`} onClick={() => toggle('emoji')} data-testid="chat-emoji-toggle" aria-label="Emoji"><Smile size={22} /></button>
        <button className={`chat-gif-btn ${panel === 'gif' ? 'on' : ''}`} onClick={() => toggle('gif')} data-testid="chat-gif-toggle">GIF</button>
        <textarea ref={input} rows={1} value={text} placeholder="Type a message" data-testid="chat-message-input"
          onChange={e => change(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === 'Escape') setPanel(null); }} />
        <button className="chat-send" onClick={submit} disabled={!text.trim()} data-testid="chat-send-button" aria-label="Send"><SendHorizontal size={20} /></button>
      </div>
    </div>
  );
}
