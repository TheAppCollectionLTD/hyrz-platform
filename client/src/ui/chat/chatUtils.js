export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const PALETTE = ['#AD1744', '#2F6F8F', '#7A4FA0', '#2E8B6E', '#B5651D', '#5B6BC0', '#8E3B5E', '#3F7D3A'];
export const avatarColor = id => PALETTE[Math.abs(Number(id) || 0) % PALETTE.length];
export const initials = name => String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
export const fullName = (first, last, fallback) => [first, last].filter(Boolean).join(' ') || fallback;
export const toDate = value => new Date(typeof value === 'string' && !value.includes('T') ? value.replace(' ', 'T') : value);

const sameDay = (a, b) => a.toDateString() === b.toDateString();
export const timeOf = value => toDate(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function dayLabel(value) {
  const d = toDate(value), now = new Date(), y = new Date(now.getTime() - 86400000);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, y)) return 'Yesterday';
  if (now - d < 6 * 86400000) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

const GIF_URL = /^https:\/\/(?:media\d*|i)\.giphy\.com\/\S+$|^https:\/\/\S+\.(?:gif|webp)(?:\?\S*)?$/i;
export const isGif = body => GIF_URL.test(String(body || '').trim());

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u;
export function bigEmojiCount(text) {
  if (!text || !EMOJI_ONLY.test(text) || /^[\d#*\s]+$/.test(text)) return 0;
  const n = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text.replace(/\s/g, ''))].length;
  return n <= 3 ? n : 0;
}

export function previewText(body) {
  if (isGif(body)) return 'GIF';
  return String(body || '');
}
