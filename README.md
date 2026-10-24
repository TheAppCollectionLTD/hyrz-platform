# hyrz platform — implementation foundation

Brand: **hyrz** · Tagline: *Flexible Work. Real Opportunities.*

This is a full-stack TypeScript-free JavaScript MVP foundation using React/Vite, Express, MySQL, JWT authentication and role-based authorization. It includes working foundations for authentication, profiles, shifts, applications, checkouts, ratings, invoices, disputes, admin audit logs and pricing calculations.

## Important status
This is a development MVP foundation, not a certified production staffing/payments system. Identity verification, email delivery, regulated payment flows, mobile apps, legal terms, and production security require provider accounts and further integration/validation. No real money is moved by this code.

## Requirements
- Node.js 20+
- MySQL 8+
- npm

## Setup
1. Create a MySQL database and user, then run `mysql -u YOUR_USER -p YOUR_DATABASE < server/db/schema.sql`.
2. Copy `server/.env.example` to `server/.env` and configure database credentials and a long random `JWT_SECRET`.
3. In one terminal:
   ```bash
   cd server && npm install && npm run dev
   ```
4. In another terminal:
   ```bash
   cd client && npm install && npm run dev
   ```
5. Open the Vite URL shown in the terminal (normally http://localhost:5173).

## Local test accounts

Local test accounts use a dedicated `hyrz_test` database. You do not need to edit the existing `server/.env` or change its normal `DB_NAME` value. The setup and test-server commands explicitly target `hyrz_test` and leave the normal `hyrz` database alone.

From the repository root, run:

```bash
cd server
npm install
npm run setup:test
npm run dev:test
```

The MySQL user in `server/.env` must have permission to create/update tables and records in `hyrz_test`. The setup command creates the schema and seeds the fictional test accounts. If `hyrz_test` does not exist, create it with a MySQL administrator first:

```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS hyrz_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

In a second terminal, start the client in test mode so it connects to the API on port 4001:

```bash
cd client
npm install
npm run dev:test
```

Use these **fictional local-only accounts** to test sign-in:

| Role | Email | Password |
| --- | --- | --- |
| Worker | `test.worker@hyrz.local` | `HyrzTestWorker!2026` |
| Employer | `test.employer@hyrz.local` | `HyrzTestEmployer!2026` |
| Worker (second account) | `test.worker2@hyrz.local` | `HyrzTestWorker2!2026` |
| Employer (second account) | `test.employer2@hyrz.local` | `HyrzTestEmployer2!2026` |

If the sign-in page has an old email or password filled in by your browser, replace it with one of the test accounts above. An email such as `worker.test@hyrz.invalid` is not a seeded test account. Do not use these accounts on a production database.

For troubleshooting and details, see [server/LOCAL_TESTING.md](server/LOCAL_TESTING.md).

### Reset the test database and run integration checks

To remove old fixtures and start from a clean, fictional test database, run the following from `server`:

```bash
npm run reset:test
```

**This permanently drops and recreates tables in `hyrz_test` only.** Do not use the reset command against any database containing real or valuable data. Start the API with `npm run dev:test`, then run `npm run test:integration` in another server terminal. The client must be started separately with `cd client && npm run dev:test`.

## Seed an administrator

For the first Tier 1 owner, use the guarded bootstrap command described in [docs/admin-journeys.md](docs/admin-journeys.md). It requires a unique email, a private password of at least 12 characters and a database with no existing administrator. Do not manually promote accounts with SQL or expose administrator promotion through a public API.

## Implemented API routes
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET/PUT /api/profile`
- `GET/POST /api/shifts`, `GET /api/shifts/:id`, `POST /api/shifts/:id/apply`
- `GET /api/shift-templates/mine`, `POST /api/shift-templates`, `DELETE /api/shift-templates/:id` (employer-owned reusable templates; role, shift type, hourly rate and times only)
- `GET /api/applications/mine`, `PATCH /api/applications/:id`
- `POST /api/checkouts`, `GET /api/checkouts/mine`, `PATCH /api/checkouts/:id/review`
- `POST /api/ratings`, `GET /api/ratings/shift/:shiftId`
- `GET /api/invoices/mine`, `POST /api/invoices/from-checkout`
- `POST /api/disputes`, `GET /api/disputes/mine`
- `GET /api/admin/overview`, `GET /api/admin/audit-logs`

## Pricing rules
Employer platform fee per hour is £2 for hourly pay up to and including £20, and 10% of hourly pay above £20. Invoice terms are 14 days. Pricing is calculated in code; payment capture/payout is intentionally not enabled. Referral rules conflict in the original brief and should remain disabled until the rule is confirmed.

## Launch readiness

Use the tracked [launch-readiness checklist](docs/launch-readiness.md) to follow implementation, verification and external launch blockers.

## Before production
Add and verify: email verification and password reset; rate limiting and CSRF strategy; robust validation; full authorization review; privacy retention/deletion workflow; identity/right-to-work provider; email/SMS provider; payment provider with marketplace/payout compliance review; accounting/tax/legal review; automated migrations/backups; logging/monitoring; load/security testing; mobile apps.
