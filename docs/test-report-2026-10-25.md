# Hyrz test report — 25 October 2026

**Repository:** `TheAppCollectionLTD/hyrz-platform`  
**Branch:** `admin-journeys`  
**Commit under review:** `fc36e1d7014e5d0b7774fe46ef6d8592937e2a7e`  
**Scope:** Tests that could be run or inspected from the available environment. This is not a production-readiness sign-off.

## Executive summary

- **14 static syntax / package-manifest checks passed** using the source fetched from the branch.
- **6 isolated logic checks passed** against the actual pricing and postcode utility source.
- **Full CI run: BLOCKED/FAILED at the runner level.** GitHub Actions reports both `server` and `client` jobs as failed with an empty `steps` array; no job logs are available. I retried the run and got the same outcome. Because no step executed, this is not evidence that application tests or the client build failed.
- **MySQL integration tests: NOT RUN.** They require the CI runner or a configured local MySQL database and a running API.
- **Frontend production build: NOT RUN.** The CI job did not reach its build step, and the available execution container cannot clone the private repository directly.
- **Browser end-to-end journeys: NOT RUN.** No running application/browser session was available in this test environment.
- **External integrations** such as real email delivery, payments/payouts and identity/company verification remain untested because they require configured services and credentials.

## 1. Passed tests

### Static parsing / manifest checks

The following files passed JavaScript parsing via a syntax compilation check, and both package manifests parsed as valid JSON:

| File | Result |
|---|---|
| `server/src/index.js` | PASS |
| `server/src/admin-routes.js` | PASS |
| `server/src/user-message-routes.js` | PASS |
| `server/src/middleware.js` | PASS |
| `server/src/postcode-distance.js` | PASS |
| `server/src/pricing.js` | PASS |
| `server/src/identifier-hash.js` | PASS |
| `server/scripts/admin-journeys.integration.js` | PASS |
| `server/scripts/reset-test-db.js` | PASS |
| `server/scripts/run-integration-test.js` | PASS |
| `server/scripts/seed-test-accounts.js` | PASS |
| `server/scripts/setup-test-db.js` | PASS |
| `server/package.json` | PASS — valid JSON |
| `client/package.json` | PASS — valid JSON |

These checks establish parseability only; they do not prove runtime correctness.

### Isolated logic checks

I loaded the actual branch source for `server/src/pricing.js` and `server/src/postcode-distance.js` and executed these focused assertions in an isolated JavaScript runtime:

| Test | Result |
|---|---|
| Pricing: £15/hour, 09:00–17:00, 60-minute break gives 7 hours, £105 gross, £14 fee, £119 employer total | PASS |
| Pricing: £30/hour for 2 hours gives £60 gross and £6 platform fee | PASS |
| Pricing rejects a shift whose end precedes its start | PASS |
| UK postcode normalization and address extraction | PASS |
| London–Manchester straight-line distance is within 160–170 miles | PASS |
| Missing distance coordinates return `null` | PASS |
| Postcode lookup caching with mocked network response | BLOCKED in the isolated harness: the runtime did not support the source's `AbortSignal.timeout` call, so the mocked fetch was never invoked. This is a harness limitation, not a confirmed product defect. |
| Postcode lookup network failure returns unknown coordinates instead of throwing | PASS |

**Count:** 6 passed; 1 blocked. No application defect was confirmed by these focused checks.

## 2. Automated tests present but not yet executed end-to-end

The repository contains:

- `server/test/pricing.test.js` — 3 Node test cases for pricing.
- `server/test/postcode-distance.test.js` — 4 Node test cases for postcode utilities.
- `server/scripts/admin-journeys.integration.js` — 29 named integration checks.
- Server scripts for test database setup/reset, test-account seeding and integration execution.
- A GitHub Actions workflow that installs dependencies, runs server syntax checks and `npm test`, initializes MySQL, starts the API, runs the integration suite and builds the client.

The presence of these tests is not equivalent to passing them.

## 3. Integration scenarios currently awaiting a real run

The 29 integration checks in the repository cover:

1. Password reset rejects invalid/expired tokens and short passwords.
2. Password reset token is one-time and revokes old sessions.
3. Admin without a valid tier is denied admin APIs.
4. Tier 1 creates Tier 2 admin.
5. Tier 1 creates Tier 3 admin.
6. Admin email login.
7. Admin email cannot be reused by a worker registration.
8. Admin email cannot be reused to create another admin.
9. Tier 2 cannot create Tier 2 admin.
10. Tier 3 cannot block users.
11. Tier 1 can change another admin's tier but not its own.
12. Tier 2 can create Tier 3 admins.
13. Tier 1 can deactivate a Tier 3 admin.
14. Tier 2 can review verification while Tier 3 cannot.
15. Tier 2 deletion restrictions for workers/admins.
16. Tier 1-only financial reports.
17. Worker support message appears in categorized admin inbox.
18. Blocking a worker prevents re-registration with the same identifier.
19. Employer counter-offer and admin acceptance.
20. Employer favourites and active worker search.
21. Shift publishing rejects invalid dates, rates and shift types.
22. Automatic shift approval respects worker capacity.
23. Employer cannot approve more workers than shift capacity.
24. Workchat reply quote and message-delete permissions.
25. Employer company block prevents repeat registration.
26. Invoice list and audit log endpoints return data.
27. Admin claims/resolves checkout dispute and invoice is created.
28. Tier 1 records and approves referral commissions.
29. Admin password change works and can be used to sign in.

**Status for all 29:** NOT RUN in this audit because the integration runner did not execute in GitHub Actions and no accessible MySQL/API environment was available.

## 4. CI run and blocker

GitHub Actions run: https://github.com/TheAppCollectionLTD/hyrz-platform/actions/runs/40151773026

- Run was retried (attempt 2).
- Both `server` and `client` jobs ended as failed.
- GitHub's job API returned `steps: []` for both jobs.
- Downloading job logs returned `BlobNotFound`.
- Therefore the failure occurred before any visible workflow step was recorded, or GitHub failed to retain/expose the job data. The precise cause is unknown.
- This run **does not establish a failing test assertion** and cannot be counted as a passing CI run either.

The next verification step is to get a functioning CI runner/job log and re-run the workflow. If GitHub Actions continues to fail before steps begin, investigate repository Actions/runner availability and workflow execution outside the application code.

## 5. Not tested yet

| Area | Why it remains untested |
|---|---|
| Full Node test runner (`npm test`) | CI did not reach the test step; no local dependency-installed checkout available |
| MySQL integration suite | Requires MySQL schema, test owner, API process and test environment |
| Client production build (`npm run build`) | CI did not reach build; no local dependency-installed checkout available |
| Browser workflows and responsive UI | No running app/browser session in this environment |
| Worker journey end-to-end | Requires live API + database and browser |
| Employer journey end-to-end | Requires live API + database and browser |
| All admin tiers end-to-end | Integration tests exist but have not run |
| Real password-reset email delivery | Requires Resend key, verified sender and configured app URL |
| Live postcode API reliability | Network access was unavailable in the test harness; only deterministic distance calculations passed |
| Payment capture, invoice settlement and payouts | Payment provider integration not configured/implemented end-to-end |
| Identity/right-to-work and company verification providers | External providers not configured |
| Load, concurrency and stress tests | Not run |
| Full authorization/record-ownership audit of every API route | Not completed |
| Accessibility, keyboard-only and screen-reader checks | Not run |
| Production deployment, backups, monitoring and recovery | Not run |
| Privacy/export/deletion legal and operational checks | Not run |

## 6. Current conclusion

The source files checked are syntactically valid, and the isolated pricing and core postcode utility checks passed. However, the most important runtime evidence is still missing: **the full server test suite, database-backed integration suite and frontend production build have not completed successfully in a functioning CI run.**

Do not interpret this report as confirmation that all screens or workflows work, and do not treat the branch as production-ready. The immediate priority is to restore a usable CI run, then fix and retest any real failures it exposes. After CI passes, perform browser-based worker, employer and each admin-tier journeys and document the outcomes separately.
