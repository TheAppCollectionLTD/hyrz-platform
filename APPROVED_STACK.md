# Approved Application Stack

This repository follows The App Collection's standard stack. New features and new applications must use these technologies unless the owner explicitly approves an exception.

## Required stack
- Language: JavaScript (ES modules). Do not introduce TypeScript or Python application code.
- Web: React. Use the repository's existing React toolchain rather than introducing a second framework.
- API/server: Node.js with Express.
- Database: MySQL 8+ using parameterised SQL queries and version-controlled schema migrations.
- Mobile: React Native with Expo, using JavaScript.
- Validation: Zod at API boundaries.
- Authentication/security: established Node packages already approved by the repository, secure password hashing, appropriate token strategy, server-side authorization, rate limits, security headers, and environment-managed secrets.
- Tests: Node's built-in test runner or the repository's existing JavaScript test framework, with API and database integration tests.

## Rules
1. Do not add Python/FastAPI, MongoDB/Motor, TypeScript, or a second database to new application code.
2. Do not rewrite working features merely to change syntax. For migrations, preserve routes, response contracts, permissions, business rules, UI behaviour, and existing data wherever possible.
3. Database changes must include repeatable migrations and a documented backup/restore path.
4. Never commit credentials, tokens, private keys, or real environment files.
5. Keep web, API, and mobile clients on documented API contracts. Test critical workflows before calling a migration complete.
6. Keep existing approved dependencies where practical; add packages only when there is a concrete need.
7. A migration is not complete until builds, automated tests, database integration tests, and a manual smoke test have been recorded.

## Canonical architecture
React web client + Node.js/Express JavaScript API + MySQL 8+ + React Native/Expo JavaScript mobile client.

This file is the stack policy for this repository and should be copied into future App Collection repositories.
