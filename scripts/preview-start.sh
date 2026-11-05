#!/bin/bash
# Preview-only launcher: starts MariaDB (MySQL-compatible) and the hyrz Node API against hyrz_test. Not part of the hyrz app.
DATADIR=/root/hyrz-db
SOCK=/tmp/hyrz-mysql.sock
if [ ! -x /usr/sbin/mariadbd ]; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-server > /tmp/maria-install.log 2>&1
fi
if [ ! -d "$DATADIR/mysql" ]; then
  mariadb-install-db --datadir=$DATADIR --user=root > /tmp/maria-init.log 2>&1
fi
if ! mariadb-admin --socket=$SOCK ping > /dev/null 2>&1; then
  setsid nohup /usr/sbin/mariadbd --datadir=$DATADIR --user=root --socket=$SOCK --port=3306 --bind-address=127.0.0.1 > /tmp/mariadb.log 2>&1 < /dev/null &
  for i in $(seq 1 30); do mariadb-admin --socket=$SOCK ping > /dev/null 2>&1 && break; sleep 1; done
fi
mariadb --socket=$SOCK -e "CREATE DATABASE IF NOT EXISTS hyrz_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS 'hyrz_app'@'%' IDENTIFIED BY 'hyrz_preview_pw'; CREATE USER IF NOT EXISTS 'hyrz_app'@'localhost' IDENTIFIED BY 'hyrz_preview_pw'; GRANT ALL ON hyrz_test.* TO 'hyrz_app'@'%'; GRANT ALL ON hyrz_test.* TO 'hyrz_app'@'localhost'; FLUSH PRIVILEGES;"
if [ ! -f /root/hyrz-db/.seeded-v2 ]; then
  (cd /app/server && npm run setup:test > /tmp/hyrz-seed.log 2>&1) && touch /root/hyrz-db/.seeded-v2
fi
if [ ! -f /root/hyrz-db/.seeded-demo-v1 ]; then
  (cd /app/server && npm run seed:test-accounts >> /tmp/hyrz-seed.log 2>&1 && npm run seed:demo >> /tmp/hyrz-seed.log 2>&1) && touch /root/hyrz-db/.seeded-demo-v1
fi
node /app/scripts/sync-preview-secrets.js > /tmp/hyrz-secrets-sync.log 2>&1
if ! curl -s -o /dev/null http://127.0.0.1:4000/api/health; then
  cd /app/server && setsid nohup node /app/server/src/index.js > /tmp/hyrz-api.log 2>&1 < /dev/null &
fi
