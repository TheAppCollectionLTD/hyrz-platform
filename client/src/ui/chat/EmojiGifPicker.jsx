import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Search, Smile, X } from 'lucide-react';

const EmojiPicker = lazy(() => import('emoji-picker-react'));
const KEY = import.meta.env.VITE_GIPHY_API_KEY;
const GIF_TOPICS = ['Thank you', 'On my way', 'Hello', 'Yes', 'Running late', 'Good job', 'Celebrate', 'Coffee'];

function toGif(g) {
  const i = g.images || {};
  return { id: g.id, title: g.title || 'GIF', thumb: i.fixed_width_small?.url || i.fixed_width?.url, url: i.downsized?.url || i.fixed_width?.url || i.original?.url };
}

function GifGrid({ onPick }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    if (!KEY) return;
    clearTimeout(timer.current);
    const ctrl = new AbortController();
    timer.current = setTimeout(async () => {
      const term = q.trim().slice(0, 50);
      const url = new URL(`https://api.giphy.com/v1/gifs/${term ? 'search' : 'trending'}`);
      url.search = new URLSearchParams({ api_key: KEY, limit: '24', rating: 'pg-13', ...(term ? { q: term } : {}) });
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        const body = await r.json();
        if (!r.ok) throw new Error(body?.meta?.msg || 'GIF search failed');
        setItems((body.data || []).map(toGif).filter(g => g.thumb && g.url)); setError('');
      } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    }, 350);
    return () => { clearTimeout(timer.current); ctrl.abort(); };
  }, [q]);

  return <div className="hyrz-gif-panel" data-testid="chat-gif-panel">
    <label className="hyrz-gif-search"><Search size={16} />
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search GIPHY" data-testid="chat-gif-search-input" />
    </label>
    <div className="hyrz-gif-topics">{GIF_TOPICS.map(t => <button type="button" key={t} className={q === t ? 'on' : ''} onClick={() => setQ(t)}>{t}</button>)}</div>
    {!KEY && <p className="hyrz-gif-note" data-testid="chat-gif-not-configured">GIF search will switch on once a GIPHY key is added (VITE_GIPHY_API_KEY).</p>}
    {error && <p className="hyrz-gif-note">{error}</p>}
    {KEY && <div className="hyrz-gif-grid" data-testid="chat-gif-grid">
      {items === null && Array.from({ length: 8 }).map((_, i) => <div key={i} className="hyrz-gif-skel" />)}
      {items?.length === 0 && <p className="hyrz-gif-note">No GIFs found</p>}
      {items?.map(g => <button type="button" key={g.id} onClick={() => onPick(g.url)} data-testid={`chat-gif-option-${g.id}`}><img src={g.thumb} alt={g.title} loading="lazy" /></button>)}
    </div>}
    <div className="hyrz-gif-attrib">Powered by GIPHY</div>
  </div>;
}

export default function EmojiGifPicker({ onInsert, onSendGif, onClose, initialTab = 'emoji' }) {
  const [tab, setTab] = useState(initialTab === 'gif' ? 'gif' : 'emoji');
  const dark = typeof document !== 'undefined' && document.querySelector('.app.worker.dark, .dark-theme');
  return <div className="hyrz-picker" role="dialog" aria-label="Emoji and GIF picker" data-testid="chat-emoji-gif-picker">
    <div className="hyrz-picker-body">
      {tab === 'emoji'
        ? <Suspense fallback={<p className="hyrz-gif-note">Loading emoji…</p>}>
            <EmojiPicker onEmojiClick={e => onInsert(e.emoji)} width="100%" height="100%" theme={dark ? 'dark' : 'light'}
              lazyLoadEmojis previewConfig={{ showPreview: false }} searchPlaceholder="Search emoji" skinTonesDisabled={false} />
          </Suspense>
        : <GifGrid onPick={url => { (onSendGif || onInsert)(url); onClose(); }} />}
    </div>
    <div className="hyrz-picker-tabs">
      <button type="button" className={tab === 'emoji' ? 'on' : ''} onClick={() => setTab('emoji')} data-testid="chat-picker-tab-emoji" aria-label="Emoji"><Smile size={18} /></button>
      <button type="button" className={tab === 'gif' ? 'on' : ''} onClick={() => setTab('gif')} data-testid="chat-picker-tab-gif">GIF</button>
      <button type="button" className="close" onClick={onClose} aria-label="Close picker" data-testid="chat-picker-close"><X size={18} /></button>
    </div>
  </div>;
}
