import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';

const KEY = import.meta.env.VITE_GIPHY_API_KEY;
const CATEGORIES = ['Thank you', 'On my way', 'Hello', 'Yes', 'Running late', 'Good job', 'Celebrate', 'Coffee'];

function toGif(g) {
  const i = g.images || {};
  return {
    id: g.id, title: g.title || 'GIF',
    thumb: i.fixed_width_small?.url || i.fixed_width?.url,
    gifUrl: i.downsized?.url || i.fixed_width?.url || i.original?.url,
    gifPreviewUrl: i.fixed_width?.url || i.downsized?.url,
  };
}

export default function GifPicker({ onPick }) {
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
        setItems((body.data || []).map(toGif).filter(g => g.thumb && g.gifUrl)); setError('');
      } catch (e) { if (e.name !== 'AbortError') setError(e.message); }
    }, 350);
    return () => { clearTimeout(timer.current); ctrl.abort(); };
  }, [q]);

  return (
    <div className="chat-panel gif" data-testid="chat-gif-panel">
      <label className="chat-search">
        <Search size={16} />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search GIPHY" data-testid="chat-gif-search-input" />
      </label>
      <div className="gif-chips">{CATEGORIES.map(c => <button key={c} onClick={() => setQ(c)} className={q === c ? 'on' : ''}>{c}</button>)}</div>
      {!KEY && <div className="gif-note" data-testid="chat-gif-not-configured">GIFs need a GIPHY API key (VITE_GIPHY_API_KEY). Add one to switch GIF search on.</div>}
      {error && <div className="gif-note">{error}</div>}
      {KEY && <div className="gif-grid" data-testid="chat-gif-grid">
        {items === null && Array.from({ length: 8 }).map((_, i) => <div key={i} className="gif-skel" />)}
        {items?.length === 0 && <div className="gif-note">No GIFs found</div>}
        {items?.map(g => <button key={g.id} onClick={() => onPick({ gifUrl: g.gifUrl, gifPreviewUrl: g.gifPreviewUrl, gifTitle: g.title })} data-testid={`chat-gif-option-${g.id}`}>
          <img src={g.thumb} alt={g.title} loading="lazy" />
        </button>)}
      </div>}
      <div className="gif-attrib">Powered by GIPHY</div>
    </div>
  );
}
