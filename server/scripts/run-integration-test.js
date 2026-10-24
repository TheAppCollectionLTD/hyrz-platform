require('dotenv').config();

// Integration tests must never target the ordinary development database.
process.env.DB_NAME = 'hyrz_test';
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
process.env.TEST_API_URL = process.env.TEST_API_URL || (isCI ? 'http://127.0.0.1:4000/api' : 'http://127.0.0.1:4001/api');
// A developer's private .env may contain OWNER_EMAIL for bootstrapping their real account.
// Never let that override the fictional local test owner unless explicitly requested.
if (!isCI) process.env.OWNER_EMAIL = process.env.TEST_OWNER_EMAIL || 'test.owner@hyrz.local';
process.env.IDENTIFIER_HASH_SECRET = process.env.IDENTIFIER_HASH_SECRET || process.env.JWT_SECRET || 'hyrz-local-test-only-identifier-hash-secret-v1';

console.log('Running Hyrz integration tests against hyrz_test and ' + process.env.TEST_API_URL + (isCI ? ' (CI owner).' : ' (fictional local test owner).'));
require('./admin-journeys.integration');
