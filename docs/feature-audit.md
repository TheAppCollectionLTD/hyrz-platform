# Hyrz feature inventory and audit

**Audit branch:** `admin-journeys`  
**Status:** Initial repository discovery; feature-by-feature verification is not complete.  
**Rule:** Presence in code or a README is not proof that a feature works. A feature is marked passed only after a relevant test has actually succeeded.

## 1. Repository map

| Area | Main files | What is present |
|---|---|---|
| React/Vite UI | `client/src/ui/App.jsx`, `client/src/ui/styles.css`, `client/src/api.js` | Single main React application, styling, API request helper |
| API and application logic | `server/src/index.js` | Express server; authentication, profiles, shifts, applications, checkouts, invoices, disputes, preferences and other routes |
| Admin APIs | `server/src/admin-routes.js` | Admin users, tiers, financial reports, referrals, invoices, disputes, inbox, notifications and admin account management |
| User messaging APIs | `server/src/user-message-routes.js` | Support messages, direct employer-worker conversations, group workchats, replies, reactions, pins and participant controls |
| Authentication middleware | `server/src/middleware.js` | Authentication, role access, admin tiers and verification gates |
| Database | `server/db/schema.sql` plus runtime schema helpers | Core MySQL tables and additional tables created/updated at runtime |
| Shared job catalogue | `shared/job-roles.json` | Shared role groups used by worker-facing filters and shift creation |
| Setup and tests | `scripts/setup-local-ubuntu.sh`, `server/scripts/*`, `server/test/*` | Local setup, test database seeding/reset, integration runner and postcode distance unit tests |
| Project/launch documentation | `README.md`, `docs/admin-journeys.md`, `docs/launch-readiness.md` | Setup, admin tiers, known blockers and release checklist |

## 2. Initial UI feature inventory

The client is implemented primarily in a large single file, `client/src/ui/App.jsx`. The following page/state identifiers were found during initial static inspection. These are discovery findings, not confirmation that every screen is complete or functional.

### Public and account access
- Public home/intro and informational sections
- About us and how-it-works content
- Public contact form
- Registration and account-type/role selection
- Login
- Email verification, resend verification and verification status/error screens
- Forgot-password request and reset-password screens
- Onboarding status
- Sign out

### Worker-facing areas
- Dashboard
- Account/profile
- Jobs / shift search and shift detail
- Applications
- Availability and automatic matching
- Timetable/calendar
- Favourites and employer discovery
- Inbox/support messages
- Notifications and preferences
- Workchats
- Complaints
- Checkouts / clock-in and clock-out
- Finances/funds and payment preferences

### Employer-facing areas
- Dashboard
- Business/account profile
- Shift creation and posting
- Employer shifts, including published/unfilled/filled flows where wired in the UI
- Shift templates
- Applications/applicant selection and counter-offers
- Worker search and favourites
- Private offers
- Direct conversations and group workchats
- Checkouts and review/counter-offer workflows
- Invoices and payment preferences
- Finances/funds

### Admin-facing areas
- Admin dashboard/overview
- User management and status actions
- Admin inbox, messages and replies
- Notifications and broadcasts
- Verification queue and review
- Audit logs
- Invoice and checkout reporting/management
- Disputes and assignment/resolution
- Referral commission ledger
- Admin account creation, tier changes and removal
- Admin password change

### Shared interaction features found in the UI
- Form validation and error/notice messages
- Shift filters, role/shift-type selection, date and time selection
- Shift templates (save/use/delete)
- Worker/employer favourites
- Workchat create/manage participants, send/reply/edit/delete messages, reactions, pins, typing status and messaging settings
- Profile and payment preference forms
- Public contact submission

## 3. Initial API inventory

### Authentication, account and onboarding
- `GET /api/health`
- Register, login, current-user/session lookup
- Email verification and resend
- Password reset request/confirm
- Change password
- Profile read/update
- Onboarding status

### Worker features
- Notification preference read/update
- Availability read/update
- Work location update
- Employer search, favourites, and employers who favourited the worker
- Shift search/detail and apply
- Application list, cancel and employer-side status management
- Clock-in, clock-out, checkout submission and checkout review
- Ratings
- Invoices and disputes

### Employer features
- Worker search, favourites and past workers
- Shift templates create/list/delete
- Own-shifts listing; shift creation and cancellation
- Application approval/rejection, counter-offers and no-show action
- Employer payment preferences
- Direct worker conversations
- Group workchat creation and participant/message management
- Invoice/checkouts workflows

### Admin features
- Overview, user list and user status management
- Verification queue/review
- Audit logs
- Financial reports and referral commissions
- Invoice listing/creation/status/reminders
- Dispute listing/assignment/resolution
- Admin inbox, claims, read state, replies and notifications
- Admin account create/tier update/delete and password change

### Public features
- Public contact submission
- Login/register and verification endpoints

This endpoint list is a first pass based on route declarations; route-by-route ownership, validation and error behavior still needs review.

## 4. Database entities found in the base schema

The base schema declares these tables:
- `users`
- `worker_profiles`
- `businesses`
- `shifts`
- `applications`
- `checkouts`
- `ratings`
- `invoices`
- `disputes`
- `audit_logs`
- `messages`
- `admin_login_names`
- `blocked_identifiers`
- `admin_message_meta`
- `password_reset_tokens`
- `shift_templates`
- `referral_commissions`

Additional features create/ensure some tables through runtime schema helpers, including direct employer-worker conversations and group workchat records. The complete data model review must include those runtime-created tables, foreign-key/ownership rules, migrations, and delete behavior.

## 5. Test inventory discovered so far

- Server has a Node test runner script: `npm test`.
- Server integration test runner: `npm run test:integration`.
- Isolated local test database setup/reset and fictional test accounts exist.
- Postcode distance unit tests exist in `server/test/postcode-distance.test.js`.
- Integration coverage includes admin journeys, shift capacity/validation, worker favourites/search, templates, messaging permissions/replies and password/session behavior (inspect test assertions before treating each individual case as covered).
- Client production build command exists: `npm run build` in `client`.
- Browser smoke testing remains explicitly outstanding in the launch checklist.
- The latest recorded GitHub Actions runs failed without job steps/logs; CI must not be treated as passing until a successful run is observed.

## 6. Initial verification status

| Verification item | Status | Evidence / next action |
|---|---|---|
| Repository and main architecture discovered | In progress | Main UI, API, admin, messaging, schema, shared roles and test files inspected at a high level |
| Full page-by-page feature inventory | In progress | UI page/state identifiers extracted; trace each page to handlers and APIs |
| Full endpoint authorization review | Not tested | Inspect every route's ownership, role and tier checks |
| Full schema/runtime migration review | Not tested | Compare base schema and runtime-created tables/columns |
| Server automated tests | Not run during this audit | Run `npm test` locally or in a working CI runner |
| MySQL integration suite | Not run during this audit | Run against `hyrz_test` and record the real result |
| Client production build | Not run during this audit | Run `npm run build` in `client` |
| Browser workflows | Not tested during this audit | Start local app and follow documented worker/employer/admin journeys |
| Production readiness | Not ready | See `docs/launch-readiness.md`; external integrations and operational/legal checks remain |

## 7. Audit method and next steps

1. Trace UI pages and controls to API requests and expected outcomes.
2. Review every API route for input validation, role checks, record ownership, concurrency and safe errors.
3. Compare database schema, runtime migrations and data lifecycle.
4. Run unit tests, server tests, integration tests and client build; record actual output.
5. Execute browser workflows for worker, employer and each admin tier.
6. Log confirmed defects with reproduction steps, fix on this branch, and add regression coverage.
7. Re-run affected tests and update this inventory with evidence and remaining blockers.

## 8. Important implementation caveats already documented

- This is a development MVP, not a production-certified staffing/payments system.
- Payment capture and payout are not implemented.
- Real email delivery needs a verified sender, provider credentials and deployed URL.
- Identity/right-to-work and company verification providers are not configured.
- Current shift-pay validation has an £8 floor that is not sufficient for every worker under UK statutory minimum-wage rules.
- Legal, privacy, operational, security, accessibility, load and production deployment reviews remain outstanding.

