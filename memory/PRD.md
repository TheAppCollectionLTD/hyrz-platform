# hyrz platform (TheAppCollectionLTD/hyrz-platform)
## Original request
Pull repo, then: (1) make chat nicer & functional with GIFs/emoji, easy to use; (2) automated accounting: workers choose Independent Contractor or hyrz PAYE (we do taxes & pay via PAYE).
## Constraints (user)
- Keep existing languages/stack: React (Vite) JS + Node/Express JS + MySQL 8. No Python/Mongo/TS in app code (APPROVED_STACK.md).
- Must deploy independently of Emergent: no Emergent-specific code in client/ or server/.
## Architecture in /app
- /app/client (Vite React), /app/server (Express, mysql2), schema in server/db/schema.sql
- Preview-only shims (NOT part of hyrz): /app/frontend (runs Vite on :3000 via vite.preview.config.mjs), /app/backend/server.py (boots MariaDB + Node API on :4000 via /app/scripts/preview-start.sh, proxies /api), /app/scripts/seed-preview.js. DB datadir /root/hyrz-db.
## Done (2026-06)
- Repo pulled and running in preview; CORS now reads CLIENT_ORIGIN env (server/src/index.js).
## Backlog
- P0 Chat (none exists yet; only empty messages table): conversations per shift/application, emoji, GIF search (provider TBD: Tenor/Giphy), unread, live updates
- P0 Contractor vs PAYE: worker choice, tax code/NI, UK 2026/27 income tax + NI calc, payslips, accounting reports (no HMRC RTI filing yet)
- P1 Pension auto-enrolment (TBD), admin chat access (TBD)

## 2026-11-04 Re-pull
- User updated main (commit 408f170). /app/client & /app/server replaced with latest main (App.jsx 1652 lines, new burgundy design, existing messaging: user-message-routes.js with employer_worker_conversations/messages, workchat, admin messages, privacy/last-seen, Inbox tab).
- Earlier standalone chat module (built on old code) backed up to /root/hyrz-chat-v1 (NOT in app; conflicts with /api/conversations). Reuse ideas/CSS when restyling their Inbox.
- Preview DB is hyrz_test seeded via `npm run setup:test`; preview-start.sh updated.
- NEXT: restyle their existing Inbox/direct chat WhatsApp-style + emoji picker + GIPHY GIFs (needs VITE_GIPHY_API_KEY from user).
