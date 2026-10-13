const crypto = require('node:crypto');

function normalizeIdentifier(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function hashIdentifier(value) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) return null;
  const secret = process.env.IDENTIFIER_HASH_SECRET;
  if (!secret || String(secret).length < 16) {
    throw new Error('IDENTIFIER_HASH_SECRET or a sufficiently strong JWT_SECRET is required for identifier hashing');
  }
  return crypto.createHmac('sha256', secret).update(normalized).digest('hex');
}

module.exports = { normalizeIdentifier, hashIdentifier };
