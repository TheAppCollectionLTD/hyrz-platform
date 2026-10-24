# Local testing and sign-in

This guide runs hyrz locally against a dedicated fictional test database without changing the database name in your existing `.env` file.

## 1. Check local prerequisites

You need Node.js 20+, npm, and MySQL running. The credentials in `server/.env` must have permission to create/update tables and records in a database named `hyrz_test`. Keep this file private; never commit it.

The setup command below reads the existing local database credentials, targets only `hyrz_test`, creates the schema if needed, and seeds fictional test users. It does not seed or modify the normal `hyrz` database.

## 2. Set up the test database and accounts

After pulling the latest `admin-journeys` branch, run:

```bash
cd ~/Downloads/hyrz-platform-build/hyrz-platform/server
npm install
npm run setup:test
```

The script uses the host, port, username, and password from your existing `server/.env`, but explicitly connects to `hyrz_test`. It creates the schema and seeds the four test accounts. It fails safely if it cannot connect or lacks database permissions. You do not need to edit `server/.env` or load it as a shell script.

If setup reports an access/permission error, grant the MySQL user named in `server/.env` access to `hyrz_test` using your local MySQL administrator account. Do not change the app's normal `DB_NAME=hyrz` setting just to seed test users.

## 3. Start the API and client

In terminal 1:

```bash
cd ~/Downloads/hyrz-platform-build/hyrz-platform/server
npm run dev:test
```

This starts the API with `DB_NAME=hyrz_test` for this process only, on `http://localhost:4001`. It leaves the `DB_NAME` setting in `server/.env` unchanged and avoids conflicts with a normal development API already using port 4000.

In terminal 2:

```bash
cd ~/Downloads/hyrz-platform-build/hyrz-platform/client
npm install
npm run dev:test
```

Open the Vite address shown by the client (usually `http://localhost:5173`, or `http://localhost:5174` if port 5173 is occupied). The test API listens on `http://localhost:4001`.

For normal development against your configured database, the existing `npm run dev` command is unchanged. Use `npm run dev:test` when testing with these test accounts.

## 4. Run the integration checks

Keep the test API running in terminal 1, then open a third terminal:

```bash
cd ~/Downloads/hyrz-platform-build/hyrz-platform/server
npm run test:integration
```

The integration-test runner explicitly targets `hyrz_test` and `http://127.0.0.1:4001/api`; it does not use the normal development database. `npm run setup:test` seeds a fictional Tier 1 owner used by the integration tests. The integration suite creates test records, so rerun `npm run setup:test` and reset the test database if a previous run left duplicate fixture records.


## 5. Sign in with a seeded test account

| Role | Email | Password |
| --- | --- | --- |
| Worker | `test.worker@hyrz.local` | `HyrzTestWorker!2026` |
| Employer | `test.employer@hyrz.local` | `HyrzTestEmployer!2026` |
| Worker 2 | `test.worker2@hyrz.local` | `HyrzTestWorker2!2026` |
| Employer 2 | `test.employer2@hyrz.local` | `HyrzTestEmployer2!2026` |

If the browser fills in old credentials automatically, replace both fields with the exact values above. For example, `worker.test@hyrz.invalid` is not a seeded account and will correctly be rejected.

## Troubleshooting

- **`Invalid email or password`:** run `npm run setup:test` from `server`, then make sure the API was started with `npm run dev:test` (not `npm run dev`). Use one of the exact test accounts above.
- **Database permission/access error:** the MySQL account in `server/.env` must be able to use `hyrz_test`. The setup script reports the underlying database error.
- **Schema lock warning mentioning `profile pictures`:** the API now checks whether a column exists before attempting an `ALTER TABLE`, and startup metadata changes share a serial queue. If the warning persists against an older database, stop any duplicate API processes using that database and restart the intended API instance so the one-time migration can finish.
- **`Failed to fetch`:** check that the test API terminal is running on port 4001 and that the client was started from `client` with `npm run dev:test` so it automatically targets port 4001.
- **Email verification:** the seeder marks these fictional test accounts as verified so local sign-in does not require email delivery.

These accounts and credentials are for local development only. Never deploy them or use them against a production database.
