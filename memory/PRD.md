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

## 2026-11-04 WhatsApp-style chats (done, tested iteration_1: backend 12/12, frontend flows pass, fixes applied)
- Direct 1:1 chats (employer<->worker) now render via client/src/ui/chat/DirectChatRoom.jsx (full-screen above bottom nav): bubbles w/ tails, day labels, sent/read ticks, typing indicator, search, reply quotes, quick reactions (one per user), delete-for-everyone, big emoji, GIF bubbles, tap-to-select actions on mobile.
- Server (user-message-routes.js): ensureDirectExtras adds reply_to_message_id, deleted_at, direct_message_reactions, direct_typing; routes POST reactions, DELETE message, POST typing; GET messages returns reactions/reply/otherTyping.
- Shared emoji+GIF picker (EmojiGifPicker.jsx: emoji-picker-react + GIPHY browser search) replaces old ChatEmojiGifPicker everywhere (workchats send GIF immediately via sendWorkchatGif). GIF messages = giphy media URL in body; MessageBody renders only giphy hosts.
- Worker shift cards (Applied/Upcoming) have "Message employer" -> opens direct chat (applications/mine now returns employer_user_id).
- GIPHY key: VITE_GIPHY_API_KEY (client env; preview reads /app/frontend/.env).
## Backlog
- P1 paging for direct messages (currently full history polled every 2.5s); workchat regression test needs a workchat (requires employer favourite)
- P1 Contractor vs PAYE accounting feature (original request)

## 2026-11-05 Demo data, payslip PDFs, verification, Plum & Blush chats (tested iterations 3-6)
- Demo data seeder: server/scripts/seed-demo-data.js (`npm run seed:demo`, idempotent; preview-start runs it once). Adds shifts (today/upcoming/past), PAYE payslips, direct chats, 3 workchats, admin threads, extra workers Priya/Jamie/Leo, unverified new.worker/new.employer.
- Payslip PDF: client/src/ui/payroll/payslipPdf.js (jsPDF); /api/worker/payslips returns worker name.
- Fixes: checkout status enum includes open/paid/completed (clock-in works); emoji reactions utf8mb4_bin; admin threads grouped; employer inbox tabs above list; checkout review/counter-offer status guards; invoice uses counter amount + recalculated fee; worker can't cancel started shift; pin only for workchat owner/admins.
- Verification (server/src/verification-routes.js + client/src/ui/verification/*): Stripe Identity (session/status/webhook /api/stripe/identity-webhook, raw body), RTW share code + admin GOV.UK check, Companies House auto check at employer signup (+ recheck). Unit test server/test/check-company.test.js. Env: STRIPE_SECRET_KEY, STRIPE_IDENTITY_WEBHOOK_SECRET, COMPANIES_HOUSE_API_KEY, RESEND_API_KEY, EMAIL_FROM (see server/.env.example). Preview syncs keys from /app/backend/.env via scripts/sync-preview-secrets.js.
- Chat theme: client/src/ui/chat/workchat-theme.css (Plum #3B1124 / blush #F9E2EC / coral #FF5C67), imported in main.jsx.
- Feature inventory: /app/memory/FEATURES.md
## Backlog
- P0 Keys from user: Stripe (Identity), Companies House, Resend (+ verified domain). Stripe webhook endpoint: <APP_URL>/api/stripe/identity-webhook (events identity.verification_session.*)
- P1 Real money movement (collect employer payments / pay workers) — not built
- P2 HMRC RTI filing (user skipped); two sign-out icons in inbox header; native date picker in RTW form; empty dashboard section cards

## 2026-11-05 Midnight & Sunshine redesign + desktop side menu + WhatsApp group info (iterations 7-8)
- Palette migrated via scripts/recolor-midnight.js (crimson/plum -> navy #0F1B2D / blue #2272EB / sunshine #FFC93C / off-white #F7F8FA) across styles.css, chat css, payroll, verification; payslip PDF navy.
- client/src/ui/theme/midnight-shell.css (imported last in main.jsx): Outfit headings, desktop >=1024px fixed left side menu (bottom navs restyled, 'hyrz.' brand), wide main 1320px, dashboard tiles (dashboard/SectionTile.jsx with lucide icons), pill tabs, admin console polish, timetable fixes (weekday alignment padding in App.jsx), landing fixes.
- WhatsApp-style group info: client/src/ui/chat/WorkchatGroupInfo.jsx + group-info.css replacing old tabbed info (worker + employer). Opens from header title or ⋮ > Group info.
## Backlog
- P1 desktop split-view inbox (list + chat side by side); remaining minor contrast items from iteration_8; two sign-out icons

## 2026-11-06 Pay types, bulk rate, worker-first site, Terms (iterations 10-13)
- Contractor/PAYE choice at sign-up + switching with contracts; PAYE weekly in arrears (Friday after tax week); PAYE jobs hide Instant Pay + shift contract.
- Employer fee £2/hr ≤£20, 10% above; bulk £1.50/hr (5+ workers & 40+ hrs Mon–Sun) as week-end credit.
- Inbox split view fixes, workchat photo payload fix (`photo_version` + `/api/workchats/:id/photo`).
- Worker-first public pages, full Terms page (v2026-11-06), hover readability fixes, auth caption no longer covered.
## Backlog
- P1: live keys (Resend, Stripe Identity, Companies House); use negotiated hourly rate in pay/fee (currently shift rate).
- P2: real payment collection/payouts; HMRC RTI; Europe/London week boundaries for bulk rate; holiday pay accrual for PAYE.
