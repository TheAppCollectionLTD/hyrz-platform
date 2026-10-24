require('dotenv').config();

// Integration tests must never target the ordinary development database.
process.env.DB_NAME = 'hyrz_test';
process.env.TEST_API_URL = process.env.TEST_API_URL || 'http://127.0.0.1:4001/api';
process.env.IDENTIFIER_HASH_SECRET = process.env.IDENTIFIER_HASH_SECRET || process.env.JWT_SECRET || 'hyrz-local-test-only-identifier-hash-secret-v1';

console.log('Running Hyrz integration tests against hyrz_test and API port 4001.');
require('./admin-journeys.integration');
