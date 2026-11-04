import React from 'react';
import { bigEmojiCount, isGif } from './chatUtils';

export default function MessageBody({ body }) {
  const text = String(body || '');
  if (isGif(text)) return <img className="hyrz-chat-gif" src={text.trim()} alt="GIF" loading="lazy" />;
  const big = bigEmojiCount(text);
  if (big) return <span className={`hyrz-big-emoji e${big}`}>{text}</span>;
  return <>{text}</>;
}
