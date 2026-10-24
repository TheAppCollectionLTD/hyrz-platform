#!/usr/bin/env bash
set -Eeuo pipefail

# One-command local setup for Hyrz on Ubuntu.
# Creates and grants access only to the dedicated hyrz_test database.
# Does not reset or modify the normal hyrz database.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"
CLIENT_DIR="$ROOT_DIR/client"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required. Install Node.js 20+ and try again."
  exit 1
fi
if ! command -v mysql >/dev/null 2>&1; then
  echo "MySQL client is missing. Install MySQL 8+ and try again."
  exit 1
fi
if ! systemctl is-active --quiet mysql; then
  echo "Starting MySQL..."
  sudo systemctl start mysql
fi

DB_PASSWORD="$(openssl rand -hex 24)"
JWT_SECRET="$(openssl rand -hex 48)"
IDENTIFIER_HASH_SECRET="$(openssl rand -hex 48)"
DB_USER="hyrz_local"

echo "Creating isolated hyrz_test database and a local app user."
sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS hyrz_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON hyrz_test.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

if [[ -f "$SERVER_DIR/.env" ]]; then
  backup="$SERVER_DIR/.env.before-local-setup.$(date +%Y%m%d%H%M%S)"
  cp "$SERVER_DIR/.env" "$backup"
  chmod 600 "$backup"
  echo "Backed up the previous server/.env to: $backup"
fi

cat > "$SERVER_DIR/.env" <<ENV
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
APP_URL=http://localhost:5173
EMAIL_FROM=Hyrz <notifications@example.com>
RESEND_API_KEY=
JWT_SECRET=$JWT_SECRET
IDENTIFIER_HASH_SECRET=$IDENTIFIER_HASH_SECRET
JWT_EXPIRES_IN=8h
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=hyrz
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
ENV
chmod 600 "$SERVER_DIR/.env"

echo "Installing server dependencies..."
(cd "$SERVER_DIR" && npm install)

echo "Preparing schema and fictional accounts in hyrz_test..."
(cd "$SERVER_DIR" && npm run setup:test)

echo "Installing client dependencies..."
(cd "$CLIENT_DIR" && npm install)

echo
echo "Local setup completed. No app server has been started yet."
echo "Open two terminals and run:"
echo "  Terminal 1: cd \"$SERVER_DIR\" && npm run dev:test"
echo "  Terminal 2: cd \"$CLIENT_DIR\" && npm run dev:test"
echo "Then open the Vite URL shown by Terminal 2 (usually http://localhost:5173)."
echo
echo "Fictional test accounts are documented in server/LOCAL_TESTING.md."
echo "Email delivery is not configured; password reset emails will not be sent locally."
