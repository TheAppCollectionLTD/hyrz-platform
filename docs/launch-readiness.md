# hyrz launch-readiness checklist

**Status:** development MVP; not production-ready. Keep this checklist current as code and external integrations are completed. A feature marked “implemented” is not considered launch-ready until it has automated coverage and a browser smoke test.

## 1. Repository, repeatable setup and CI

- [x] Keep changes on `admin-journeys` and review through pull request #1.
- [x] Add isolated local test database commands and fictional test accounts.
- [x] Add repeatable test database reset command that targets only `hyrz_test`.
- [x] Add a repeatable server integration-test runner that supports local and CI API ports.
- [x] Add syntax checks and unit tests for postcode-distance calculations.
- [ ] Obtain a clean successful GitHub Actions run for the latest pull-request head. The available failed job records have no steps/logs, so the cause is not confirmed.
- [ ] Run the MySQL-backed integration suite and client production build on the latest head; record the actual result.
- [ ] Remove any stale or misleading test instructions and verify the setup guide on a clean machine.

## 2. Authentication, account security and permissions

- [x] JWT authentication and role-based route authorization.
- [x] Login rate limiting.
- [x] Password hashing and guarded first Tier 1 owner bootstrap.
- [x] Three administrator tiers with authorization tests.
- [x] Case-insensitive email uniqueness migration and duplicate-email guard.
- [x] Hash worker/company identifiers for block-list matching rather than storing raw values in the block list.
- [ ] Complete a route-by-route authorization review, including ownership checks and concurrent update behavior.
- [x] Add password-reset request/confirm endpoints, hashed one-time tokens, 30-minute expiry, request limits and client screens.
- [ ] Configure the email provider and public `APP_URL`, then test password-reset email delivery and token reuse/expiry in staging.
- [ ] Verify email-delivery configuration, token expiry and resend/rate-limit behavior in a deployed environment.
- [x] Revoke previously issued sessions after password changes/resets using a per-user session version; integration coverage asserts old tokens are rejected.
- [ ] Perform dependency, secret-leak, XSS, CSRF and API security reviews.
- [ ] Confirm privacy retention, account data export and deletion/purge processes with legal advice.

## 3. Worker and employer workflows

- [x] Role list shared between shift creation and worker-facing filtering.
- [x] Employer worker search and dedicated favourites endpoint.
- [x] Employer-owned persistent shift templates with dates/headcount excluded.
- [x] Shift publishing server validation for role, type, dates, rate, worker count, break and optional lists.
- [x] Prevent employer approvals from exceeding a shift's worker capacity, with integration-test coverage added.
- [x] Worker shift-distance calculation using postcode lookups, caching and fail-open behavior.
- [ ] Run the complete browser smoke test for registration, login, profile, search, filters, applications, counter-offers and cancellations.
- [ ] Verify calendar multi-date selection, availability automation, overnight shifts and notification preferences in the browser.
- [ ] Verify workchat reply quotes, reactions, participant permissions, message deletion and unread counts in the browser.
- [ ] Verify clock-in/out, worker time adjustments, checkout approval/dispute, invoice creation and audit records end to end.
- [ ] Add automated regression coverage for the most-used worker and employer journeys.
- [ ] Decide and implement the legally appropriate statutory minimum-wage guard. Current code has an £8 floor; that is not sufficient for every worker under current UK rates.

## 4. Admin and operations

- [x] Tier 1/Tier 2/Tier 3 authorization rules and integration coverage.
- [x] Admin inbox, message claim/read/reply paths and audit history.
- [x] Verification review, account blocking/deactivation and identifier block-list foundation.
- [x] Invoice listing, status updates, reminders, dispute resolution and financial reporting foundations.
- [x] Referral commission ledger entry/status management.
- [ ] Verify every admin page and each tier in a real browser session.
- [ ] Configure and test Resend (or the selected provider) for verification and invoice email delivery.
- [ ] Add automated referral attribution/rate calculation only after the commission policy is formally confirmed.
- [ ] Confirm finance/report calculations with test fixtures and an accountant; no payment is captured or paid out by this MVP.

## 5. Legal, verification and payments

- [ ] Obtain legal review of worker/employer terms, cancellation fees, contracts, privacy notice, cookies and data-processing terms.
- [ ] Verify UK minimum-wage rules and effective dates; determine worker age/apprentice eligibility and prevent illegal shift rates. The official rates effective 1 April 2026 are £12.71 (21+), £10.85 (18–20), and £8.00 (under 18 and qualifying apprentices); see https://www.gov.uk/national-minimum-wage-rates. The current API floor is £8.00, so this is a launch blocker until age/apprentice eligibility or a safer universal floor is implemented.
- [ ] Integrate and validate an identity/right-to-work verification provider; do not treat seeded test verification as real verification.
- [ ] Integrate company verification and any role-specific qualifications (for example, regulated security/care roles).
- [ ] Select and integrate a regulated marketplace payment provider and payout flow, including KYC/KYB, refunds, chargebacks, reconciliation and safeguarding/compliance obligations.
- [ ] Confirm tax, VAT, invoice, accounting and worker/employment-status obligations with qualified advisers.
- [ ] Configure production secrets, email domain authentication, database least-privilege credentials and secure storage.

## 6. Production infrastructure and release

- [x] Make browser CORS configurable with an explicit trusted-origin allow-list while allowing local Vite ports for development.
- [ ] Set production `CLIENT_ORIGIN`, `APP_URL`, email sender and secrets in the hosting provider; never commit real values.
- [ ] Provision production database, managed backups, point-in-time recovery and a tested restore procedure.
- [ ] Add structured logging, error reporting, uptime/health monitoring and alerting.
- [ ] Run migrations safely against a staging copy and rehearse rollback/restore.
- [ ] Run load, accessibility, responsive-layout and penetration/security tests.
- [ ] Configure HTTPS, domain/DNS, deployment pipeline, environment separation and release rollback.
- [ ] Complete the full browser smoke-test checklist in `docs/admin-journeys.md` plus worker/employer workflows.
- [ ] Decide whether mobile apps are part of launch scope; the current repository is a web application.
- [ ] Sign off the release only after all blocking items are complete or explicitly accepted by the responsible owner.

## Known external blockers

- Real email delivery requires provider credentials, a verified sender domain and a correct public `APP_URL`.
- Real identity/right-to-work checks require a selected provider and credentials.
- Real payments and payouts are not implemented; this application currently does not move money.
- Full production readiness cannot be verified without access to the deployment environment, configured services, a successful CI run and browser testing.
