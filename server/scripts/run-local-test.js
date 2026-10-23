require('dotenv').config();

// Keep local test runs isolated from the normal database in server/.env.
process.env.DB_NAME = 'hyrz_test';
// Match the identifier-hashing secret used by setup:test when no local secret is configured.
process.env.IDENTIFIER_HASH_SECRET = process.env.IDENTIFIER_HASH_SECRET || process.env.JWT_SECRET || 'hyrz-local-test-only-identifier-hash-secret-v1';

console.log('Starting hyrz API against the dedicated hyrz_test database.');
require('../src/index');
