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
