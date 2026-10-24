# hyrz administrator setup

## First Tier 1 owner

The application does not hard-code an owner password. After creating the database from `db/schema.sql` and configuring `server/.env`, set a stable, random `IDENTIFIER_HASH_SECRET` in `server/.env` (keep it unchanged so existing block-list hashes remain comparable). Then open a terminal in the `server` directory and run:

```bash
OWNER_USERNAME=SimsonH OWNER_EMAIL=your-admin-email@example.com OWNER_PASSWORD='use-a-unique-password-of-at-least-12-characters' npm run bootstrap:owner
```

Use your real owner email and a unique password. This command only works if the database contains no administrator account. It creates a Tier 1 administrator and records the account name. Do not commit the command with a real password or put credentials in source control.

## Administrator tiers

- **Tier 1:** full admin console, financial reports, manage Tier 2/Tier 3 admins, user blocking/deactivation, verification, invoices and disputes.
- **Tier 2:** manage Tier 3 admins and client/worker accounts, verification, invoices, disputes, inbox and audit history. Cannot manage Tier 1/Tier 2 admins or view financial reports.
- **Tier 3:** view users/admins, inbox, invoices, disputes and audit history. Cannot block/delete users or manage administrator accounts.

## Important operational notes

- Worker National Insurance and permit identifiers are stored as one-way SHA-256 hashes for block-list comparisons. Do not add raw identifiers to logs.
- Account deletion currently disables access and records a deletion request while retaining related audit and financial history. It is not a physical purge.
- Referral commission entries are manually recorded by Tier 1; the commission rate and referral attribution rules have not been automated.
- Password reset uses one-time, 30-minute tokens; it requires a configured email provider and a public `APP_URL`. The link and token flow still needs an end-to-end delivery test in a configured staging environment.
- Automated CI covers syntax checks, existing server tests and the client build. A configured MySQL environment is still required for full end-to-end admin workflow testing.

## Browser smoke-test checklist

After bootstrapping the owner and starting the client/API locally:

1. Sign in as the Tier 1 owner using SimsonH or the owner email.
2. Open each section: Inbox, Users, Financial Reports, Invoices, Admin Actions, Checkout Disputes.
3. Create Tier 2 and Tier 3 admins. Confirm Tier 2 can create Tier 3 but not Tier 2, and Tier 3 cannot block/delete users or manage administrators.
4. Open Users → Verification. Set identity/right-to-work/company statuses with a reason and confirm the audit log records the review.
5. Sign in as a worker/employer and send an enquiry/complaint. Confirm it appears in the matching Inbox category. Reply from the admin, claim the issue, mark it read, then check the user message history.
6. Block a worker/client and try to register with the same identifier/company number using a different email. The API should reject the registration. Unblock the account and verify the block-list entry is removed.
7. Open Invoices, filter overdue/completed/paid, inspect client contact details, and test the reminder button with Resend configured. The email action intentionally returns a service-unavailable response when the provider is not configured.
8. Submit an employer checkout counter-offer. Review the evidence/comments/timings as an admin, assign the dispute, resolve it, and verify the resulting checkout/invoice/audit entry.
9. Check Financial Reports as Tier 1 and confirm Tier 2 receives a permission error. Create and update a referral commission ledger entry.
10. Change the owner password, sign out, and verify sign-in with the new password.

CI covers API integration flows against disposable MySQL and the production frontend build. This manual checklist still matters for browser navigation, local environment values, email delivery and responsive layout.
