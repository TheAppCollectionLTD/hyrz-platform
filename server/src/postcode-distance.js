const postcodeCoordinateCache = new Map();
const POSITIVE_CACHE_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_MS = 5 * 60 * 1000;

function normalizePostcode(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '').trim();
}

function extractPostcode(value) {
  const match = String(value || '').toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return match ? normalizePostcode(match[1]) : '';
}

function distanceMiles(origin, destination) {
  if (!origin || !destination) return null;
  const values = [origin.latitude, origin.longitude, destination.latitude, destination.longitude].map(Number);
  if (values.some(value => !Number.isFinite(value))) return null;
  const [lat1, lon1, lat2, lon2] = values.map(value => value * Math.PI / 180);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

async function lookupPostcodeCoordinates(postcodes, { fetchImpl = globalThis.fetch, timeoutMs = 1500 } = {}) {
  const unique = [...new Set((postcodes || []).map(normalizePostcode).filter(Boolean))];
  const result = new Map();
  const missing = [];
  const now = Date.now();
  for (const postcode of unique) {
    const cached = postcodeCoordinateCache.get(postcode);
    if (cached && cached.expiresAt > now) result.set(postcode, cached.coordinates);
    else missing.push(postcode);
  }
  for (let offset = 0; offset < missing.length; offset += 100) {
    const batch = missing.slice(offset, offset + 100);
    try {
      if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable');
      const response = await fetchImpl('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: batch }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error('Postcode lookup returned HTTP ' + response.status);
      const payload = await response.json();
      const byPostcode = new Map((payload.result || []).map(item => {
        const coords = item.result && Number.isFinite(Number(item.result.latitude)) && Number.isFinite(Number(item.result.longitude))
          ? { latitude: Number(item.result.latitude), longitude: Number(item.result.longitude) }
          : null;
        return [normalizePostcode(item.query), coords];
      }));
      for (const postcode of batch) {
        const coordinates = byPostcode.get(postcode) || null;
        postcodeCoordinateCache.set(postcode, { coordinates, expiresAt: Date.now() + (coordinates ? POSITIVE_CACHE_MS : NEGATIVE_CACHE_MS) });
        result.set(postcode, coordinates);
      }
    } catch {
      for (const postcode of batch) {
        postcodeCoordinateCache.set(postcode, { coordinates: null, expiresAt: Date.now() + NEGATIVE_CACHE_MS });
        result.set(postcode, null);
      }
    }
  }
  return result;
}

function clearPostcodeCoordinateCache() {
  postcodeCoordinateCache.clear();
}

module.exports = { normalizePostcode, extractPostcode, distanceMiles, lookupPostcodeCoordinates, clearPostcodeCoordinateCache };
