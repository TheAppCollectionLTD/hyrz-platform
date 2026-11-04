import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { request } from '../../api';

const cache = new Map();

export async function compressImage(file, maxSide = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const data = canvas.toDataURL('image/jpeg', q);
      if (data.length < 880000) return data;
    }
    throw new Error('This photo is too large to send.');
  } finally { URL.revokeObjectURL(url); }
}

export default function ChatPhoto({ conversationId, messageId, localSrc }) {
  const key = `${conversationId}:${messageId}`;
  const [src, setSrc] = useState(localSrc || cache.get(key) || null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (src || localSrc) return;
    request(`/conversations/${conversationId}/messages/${messageId}/image`)
      .then(d => { cache.set(key, d.image); setSrc(d.image); }).catch(() => setSrc(''));
  }, [key]);

  if (src === '') return <span className="hz-photo-missing">Photo unavailable</span>;
  return <>
    {src ? <img className="hz-photo" src={src} alt="Shared photo" onClick={() => setOpen(true)} data-testid={`chat-photo-${messageId}`} />
      : <span className="hz-photo hz-photo-loading" />}
    {open && createPortal(<div className="hz-lightbox" onClick={() => setOpen(false)} data-testid="chat-photo-lightbox">
      <button type="button" aria-label="Close photo"><X size={24} /></button>
      <img src={src} alt="Shared photo full size" />
    </div>, document.body)}
  </>;
}
