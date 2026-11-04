export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const PALETTE = ['#7c9a3d', '#3d7a9a', '#9a5b3d', '#6b4f9a', '#3d9a7a', '#9a3d6b', '#8a7a2e', '#2e6f8a'];
export const avatarColor = id => PALETTE[Number(id || 0) % PALETTE.length];
export const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';

const sameDay = (a, b) => a.toDateString() === b.toDateString();
export const timeOf = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function listTime(ms) {
  const d = new Date(ms), now = new Date(), y = new Date(now.getTime() - 86400000);
  if (sameDay(d, now)) return timeOf(ms);
  if (sameDay(d, y)) return 'Yesterday';
  if (now - d < 6 * 86400000) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function dayLabel(ms) {
  const d = new Date(ms), now = new Date(), y = new Date(now.getTime() - 86400000);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, y)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u;
export function bigEmojiCount(text) {
  if (!text || !EMOJI_ONLY.test(text) || /^[\d#*\s]+$/.test(text)) return 0;
  const n = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text.replace(/\s/g, ''))].length;
  return n <= 3 ? n : 0;
}
