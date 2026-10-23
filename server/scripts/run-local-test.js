require('dotenv').config();

// Keep local test runs isolated from the normal database in server/.env.
process.env.DB_NAME = 'hyrz_test';

console.log('Starting hyrz API against the dedicated hyrz_test database.');
require('../src/index');
