import React, { useEffect, useRef, useState } from 'react';
import { SendHorizontal, Smile, X } from 'lucide-react';
import EmojiGifPicker from './EmojiGifPicker';
import { fullName, previewText } from './chatUtils';

export default function DirectComposer({ user, replyTo, onCancelReply, onSend, onTyping }) {
  const [text, setText] = useState('');
  const [picker, setPicker] = useState(null);
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
    if (v && Date.now() - lastTyping.current > 3000) { lastTyping.current = Date.now(); onTyping(true); }
    if (!v) onTyping(false);
  }

  function insert(emoji) {
    const el = input.current, start = el.selectionStart ?? text.length, end = el.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + emoji.length, start + emoji.length); });
  }

  function submit(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    onSend(body); setText(''); setPicker(null); lastTyping.current = 0;
  }

  const replyName = replyTo && (Number(replyTo.sender_id) === Number(user.id) ? 'yourself' : fullName(replyTo.sender_first_name, replyTo.sender_last_name, 'them'));

  return (
    <form className="hz-composer-wrap" onSubmit={submit}>
      {picker && <EmojiGifPicker key={picker} initialTab={picker} onInsert={insert} onSendGif={url => onSend(url)} onClose={() => setPicker(null)} />}
      {replyTo && <div className="hz-reply-bar" data-testid="chat-reply-bar">
        <div className="hz-quote"><b>Replying to {replyName}</b><span>{previewText(replyTo.body)}</span></div>
        <button type="button" className="hz-icon" onClick={onCancelReply} aria-label="Cancel reply" data-testid="chat-cancel-reply"><X size={18} /></button>
      </div>}
      <div className="hz-composer">
        <button type="button" className={`hz-icon ${picker === 'emoji' ? 'on' : ''}`} onClick={() => setPicker(p => p === 'emoji' ? null : 'emoji')} aria-label="Emoji" data-testid="chat-emoji-toggle"><Smile size={22} /></button>
        <button type="button" className={`hz-gif ${picker === 'gif' ? 'on' : ''}`} onClick={() => setPicker(p => p === 'gif' ? null : 'gif')} data-testid="chat-gif-toggle">GIF</button>
        <textarea ref={input} rows={1} value={text} maxLength={5000} placeholder="Type a message" aria-label="Message" data-testid="chat-message-input"
          onChange={e => change(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } if (e.key === 'Escape') setPicker(null); }} />
        <button type="submit" className="hz-send" disabled={!text.trim()} aria-label="Send message" data-testid="chat-send-button"><SendHorizontal size={20} /></button>
      </div>
    </form>
  );
}
