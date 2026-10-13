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
- Automated CI covers syntax checks, existing server tests and the client build. A configured MySQL environment is still required for full end-to-end admin workflow testing.
