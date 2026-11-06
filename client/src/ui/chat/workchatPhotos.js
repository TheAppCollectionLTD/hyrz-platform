import { request } from '../../api';

const cache = new Map();

// Group photos are fetched once per version instead of riding along every list poll.
export async function withWorkchatPhotos(items) {
  await Promise.all(items.filter(w => w.photo_version != null && cache.get(w.id)?.v !== w.photo_version).map(async w => {
    try { const r = await request(`/workchats/${w.id}/photo`); cache.set(w.id, { v: w.photo_version, src: r.photo || null }); } catch { /* keep fallback avatar */ }
  }));
  return items.map(w => ({ ...w, photo: w.photo_version != null ? cache.get(w.id)?.src || null : null }));
}
