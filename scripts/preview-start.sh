#!/bin/bash
# Preview-only launcher: starts MariaDB (MySQL-compatible) and the hyrz Node API. Not part of the hyrz app.
DATADIR=/root/hyrz-db
SOCK=/tmp/hyrz-mysql.sock
if [ ! -x /usr/sbin/mariadbd ]; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-server > /tmp/maria-install.log 2>&1
fi
FRESH=0
if [ ! -d "$DATADIR/mysql" ]; then
  mariadb-install-db --datadir=$DATADIR --user=root > /tmp/maria-init.log 2>&1
  FRESH=1
fi
if ! mariadb-admin --socket=$SOCK ping > /dev/null 2>&1; then
  nohup /usr/sbin/mariadbd --datadir=$DATADIR --user=root --socket=$SOCK --port=3306 --bind-address=127.0.0.1 > /tmp/mariadb.log 2>&1 &
  for i in $(seq 1 30); do mariadb-admin --socket=$SOCK ping > /dev/null 2>&1 && break; sleep 1; done
fi
if [ "$FRESH" = "1" ]; then
  mariadb --socket=$SOCK -e "CREATE DATABASE IF NOT EXISTS hyrz;"
  mariadb --socket=$SOCK -e "CREATE USER IF NOT EXISTS 'hyrz_app'@'%' IDENTIFIED BY 'hyrz_preview_pw'; CREATE USER IF NOT EXISTS 'hyrz_app'@'localhost' IDENTIFIED BY 'hyrz_preview_pw'; GRANT ALL ON hyrz.* TO 'hyrz_app'@'%'; GRANT ALL ON hyrz.* TO 'hyrz_app'@'localhost'; FLUSH PRIVILEGES;"
  mariadb --socket=$SOCK hyrz < /app/server/db/schema.sql
  (cd /app/server && node /app/scripts/seed-preview.js)
fi
pkill -f "node /app/server/src/index.js" 2>/dev/null
cd /app/server && nohup node /app/server/src/index.js > /tmp/hyrz-api.log 2>&1 &
