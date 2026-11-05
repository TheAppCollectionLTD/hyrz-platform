# hyrz – Features & Processes Inventory (Nov 2026)

Status key: ✅ built & tested · ⚠️ built, needs your keys to go live · ❌ not built

## 1. Sign-up & verification (nobody can post or apply for shifts until every check passes — enforced on the server)
| Step | Who | How it works | Status |
|---|---|---|---|
| Email verification | All | Link emailed at sign-up (expires in 30 min, can be resent). Login is refused until it's clicked. | ⚠️ needs `RESEND_API_KEY` + a verified sending domain (`EMAIL_FROM`) |
| Identity (ID + selfie) | Workers & employers | "Verify my ID" opens Stripe Identity (passport / driving licence / ID card + live selfie). The result comes back automatically through a webhook, with a status check as a backup. | ⚠️ needs `STRIPE_SECRET_KEY` + `STRIPE_IDENTITY_WEBHOOK_SECRET` (Stripe charges per check) |
| Right to work | Workers | Worker enters their Home Office share code + date of birth (British/Irish citizens tick a box instead). The admin checks it on GOV.UK using the link in the queue, then approves. UK law requires an employer-side check, so this can't be fully automatic. | ✅ |
| Company check | Employers | Runs automatically at sign-up and can be re-run with "Check again". It looks the company up at Companies House and checks that it is active, the name matches, and the person signing up is a current officer. Mismatches go to admin review; dissolved or unknown companies are rejected. | ⚠️ needs `COMPANIES_HOUSE_API_KEY` (free) |
| Admin review queue | Admins (tier 2+) | Approve or reject each check with an audit reason. Shows share codes and Companies House results. | ✅ |
| Blocked identifiers | Admins | Banned NI numbers and company numbers can't sign up again. | ✅ |

## 2. Payments, fees & money rules
| Rule | Detail | Status |
|---|---|---|
| Platform fee | £2 per hour when hourly pay is £20 or less; 10% of pay per hour above £20 | ✅ tested |
| Employer total | Worker gross pay + platform fee | ✅ tested |
| Invoices | Created automatically when the employer approves a checkout; status "issued", due in 14 days | ✅ tested |
| Counter-offers | The employer can propose different hours. The invoice and payslip then both use the countered amount, with the fee recalculated. Only allowed on submitted or disputed checkouts. | ✅ tested (fixed this round) |
| Double-review guard | An approved or rejected checkout can't be reviewed again | ✅ tested (fixed) |
| Employer cancels a shift < 24h before it starts | Warning first, then a fee of 50% of shift pay per approved worker | ✅ tested |
| Employer removes an approved worker < 24h before | Warning first, then a 50% fee | ✅ tested |
| Worker cancels an approved shift < 24h before | Warning first, then a strike. Once the shift has started it can't be cancelled. | ✅ tested |
| No-shows | Can only be recorded after the shift ends; records a strike | ✅ tested |
| Employer payment preferences | Auto top-up threshold/amount (£1–£1m) and auto-pay schedule (instant / 3 / 7 / 14 days) are saved | ✅ saved only. **No card is charged.** |
| Admin invoices | List, change status, one-off invoices, reminder emails | ✅ (reminder emails need Resend) |
| Financial reports | Revenue invoiced, paid and outstanding, overdue count, referral commissions (Tier 1 admins) | ✅ tested |
| Referral commissions | Tracked and marked paid by admins | ✅ |
| Worker payroll | Choose Independent Contractor (gross pay) or hyrz PAYE (1257L-style codes, weekly Income Tax + NI 8% over £242/week; employer NI shown) | ✅ tested |
| Payslips | Weekly; a PDF can be downloaded | ✅ tested |
| Actually collecting money from employers / paying workers | Card or bank payments and payouts | ❌ not built. Invoices and payslips are records only. |
| HMRC RTI filing | Sending PAYE to HMRC | ❌ skipped (your choice) |

## 3. Shifts & work
Post shifts (hospitality, festival, retail), shift templates, auto-approve, apply with a counter rate, private offers, automatic invites based on worker availability, shift confirmations (16h window), clock-in/out, checkouts and disputes, ratings (1–10), favourite workers/employers, worker search, distance by postcode, chat reminders the evening before a shift.

## 4. Messaging
WhatsApp-style 1-to-1 chats (Plum & Blush): emoji, GIFs (GIPHY), photos, replies, reactions, read ticks, typing indicator, search. Group workchats: pinned messages, admins, participants, settings, past/current chats. Admin support threads.

## 5. Admin
Overview, users (block/delete), admin tiers, audit logs, disputes, notifications/broadcasts, inbox, verification queue, invoices, payroll summary, financial reports, test checkouts.
