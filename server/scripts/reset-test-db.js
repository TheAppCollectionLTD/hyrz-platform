require('dotenv').config();

const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function main() {
  // This script is deliberately hard-pinned to the local test database.
  process.env.DB_NAME = 'hyrz_test';
  process.env.IDENTIFIER_HASH_SECRET = process.env.IDENTIFIER_HASH_SECRET || process.env.JWT_SECRET || 'hyrz-local-test-only-identifier-hash-secret-v1';

  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD) {
    throw new Error('Set DB_HOST, DB_USER, and DB_PASSWORD in server/.env before resetting hyrz_test.');
  }

  console.warn('WARNING: This will permanently drop every table and all data in hyrz_test.');
  console.warn('The configured hyrz development database is not targeted.');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'hyrz_test',
    multipleStatements: true
  });

  try {
    const [tables] = await connection.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const row of tables) {
        const tableName = String(Object.values(row)[0]);
        await connection.query('DROP TABLE IF EXISTS `' + tableName.replace(/\`/g, '\`\`') + '`');
      }
    } finally {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await connection.query(schema);
    console.log('Clean hyrz_test schema created.');
  } finally {
    await connection.end();
  }

  const seeded = spawnSync(process.execPath, [path.join(__dirname, 'seed-test-accounts.js')], {
    stdio: 'inherit',
    env: { ...process.env, DB_NAME: 'hyrz_test' }
  });
  if (seeded.error) throw seeded.error;
  if (seeded.status !== 0) throw new Error('Test-account seeding failed. Review the error above.');
  console.log('hyrz_test reset and test accounts seeded successfully.');
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
