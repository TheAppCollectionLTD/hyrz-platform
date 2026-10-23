# Local testing and sign-in

This guide is for running hyrz locally with fictional test users. It does not create accounts in production and it does not bypass authentication.

## 1. Create a dedicated test database

From the repository root:

```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS hyrz_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Enter your local MySQL root password when prompted. If your MySQL setup uses a different administrative account, substitute that account.

## 2. Configure the API

Create `server/.env` from `server/.env.example` if you do not already have one:

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set the local MySQL credentials and test database:

```dotenv
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-characters
JWT_EXPIRES_IN=8h
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=hyrz_test
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
```

Replace the example database username and password with your local values. Keep `server/.env` private; it should not be committed to Git.

## 3. Initialise and seed the database

From the repository root, run:

```bash
mysql -u root -p hyrz_test < server/db/schema.sql
cd server
npm install
npm run seed:test-accounts
```

The seed command checks that `DB_NAME` is exactly `hyrz_test` and refuses to run against another database. It creates or refreshes four fictional test accounts and marks their email addresses as verified so the local sign-in flow can be tested without an email provider.

## 4. Start the API and client

In terminal 1:

```bash
cd ~/Downloads/hyrz-platform-build/hyrz-platform/server
npm run dev
```

In terminal 2:

```bash
cd ~/Downloads/hyrz-platform-build/hyrz-platform/client
npm run dev
```

Open the local Vite address shown by the client, normally `http://localhost:5173`. The API should be listening on `http://localhost:4000`.

## 5. Sign in with a seeded test account

| Role | Email | Password |
| --- | --- | --- |
| Worker | `test.worker@hyrz.local` | `HyrzTestWorker!2026` |
| Employer | `test.employer@hyrz.local` | `HyrzTestEmployer!2026` |
| Worker 2 | `test.worker2@hyrz.local` | `HyrzTestWorker2!2026` |
| Employer 2 | `test.employer2@hyrz.local` | `HyrzTestEmployer2!2026` |

If the browser fills in old credentials automatically, replace both fields with the exact values above. For example, `worker.test@hyrz.invalid` is not a seeded account and will correctly be rejected.

The API now compares email addresses case-insensitively and trims surrounding whitespace. It still requires a real account and the correct password; it does not provide a login bypass.

## Troubleshooting

- **`Invalid email or password`:** confirm the account is seeded in the database named in `server/.env`, and use the exact test credentials above.
- **`Failed to fetch`:** check that the API terminal is running on port 4000 and that the client uses `VITE_API_URL=http://localhost:4000/api` (the default in `client/src/api.js`).
- **Database connection error:** confirm MySQL is running and `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` match your local setup.
- **Seeder refuses to run:** check that `server/.env` has `DB_NAME=hyrz_test`. This guard is deliberate to protect your normal development database and production data.

These accounts and credentials are for local development only. Never deploy them or use them against a production database.
