const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePostcode,
  extractPostcode,
  distanceMiles,
  lookupPostcodeCoordinates,
  clearPostcodeCoordinateCache
} = require('../src/postcode-distance');

test('normalizes and extracts UK postcodes from addresses', () => {
  assert.equal(normalizePostcode('sw1a 1aa'), 'SW1A1AA');
  assert.equal(extractPostcode('10 Downing Street, London SW1A 2AA'), 'SW1A2AA');
  assert.equal(extractPostcode('No postcode here'), '');
});

test('calculates a realistic straight-line distance in miles', () => {
  const london = { latitude: 51.5072, longitude: -0.1276 };
  const manchester = { latitude: 53.4808, longitude: -2.2426 };
  const distance = distanceMiles(london, manchester);
  assert.ok(distance > 160 && distance < 170, 'London to Manchester should be roughly 165 miles.');
  assert.equal(distanceMiles(london, null), null);
});

test('batches postcode lookups and caches positive and negative results', async () => {
  clearPostcodeCoordinateCache();
  let calls = 0;
  const fakeFetch = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        result: request.postcodes.map(postcode => ({
          query: postcode,
          result: postcode === 'SW1A1AA' ? { latitude: 51.501, longitude: -0.141 } : null
        }))
      })
    };
  };
  const first = await lookupPostcodeCoordinates(['sw1a 1aa', 'M1 1AE'], { fetchImpl: fakeFetch });
  assert.deepEqual(first.get('SW1A1AA'), { latitude: 51.501, longitude: -0.141 });
  assert.equal(first.get('M11AE'), null);
  const second = await lookupPostcodeCoordinates(['SW1A1AA', 'M1 1AE'], { fetchImpl: fakeFetch });
  assert.deepEqual(second.get('SW1A1AA'), { latitude: 51.501, longitude: -0.141 });
  assert.equal(calls, 1, 'Cached postcode results should avoid a second network call.');
  clearPostcodeCoordinateCache();
});

test('postcode lookup failures degrade to unknown coordinates rather than failing the caller', async () => {
  clearPostcodeCoordinateCache();
  const result = await lookupPostcodeCoordinates(['EH1 1AA'], { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(result.get('EH11AA'), null);
  clearPostcodeCoordinateCache();
});
