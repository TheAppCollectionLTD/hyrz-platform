require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');

// A stable, explicitly local-only secret lets fictional test accounts be seeded
// without requiring edits to the developer's private .env file.
process.env.IDENTIFIER_HASH_SECRET = process.env.IDENTIFIER_HASH_SECRET || process.env.JWT_SECRET || 'hyrz-local-test-only-identifier-hash-secret-v1';

async function main() {
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD) {
    throw new Error('Set DB_HOST, DB_USER, and DB_PASSWORD in server/.env before running local test setup.');
  }

  const databaseName = 'hyrz_test';
  console.log('Preparing the dedicated local test database: ' + databaseName);
  console.log('The existing database configured in server/.env will not be changed.');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: databaseName,
    multipleStatements: true
  });

  try {
    const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await connection.query(schema);
    console.log('Test database schema is ready.');
  } finally {
    await connection.end();
  }

  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'seed-test-accounts.js')],
    {
      stdio: 'inherit',
      env: { ...process.env, DB_NAME: databaseName }
    }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('Test-account seeding failed. Check the error above; your normal hyrz database was not targeted.');
  }

  console.log('\nLocal test setup complete. Start the API with: npm run dev:test');
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
