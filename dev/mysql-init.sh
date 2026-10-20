#!/bin/sh
# Runs once on first container start (empty data dir): 4 per-stack DBs + user mb/mb.
set -eu
for db in mb_apache mb_nginx mb_node mb_python; do
  mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE \`$db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$db" < /schema.sql
done
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "
CREATE USER 'mb'@'%' IDENTIFIED BY 'mb';
GRANT ALL PRIVILEGES ON mb_apache.* TO 'mb'@'%';
GRANT ALL PRIVILEGES ON mb_nginx.* TO 'mb'@'%';
GRANT ALL PRIVILEGES ON mb_node.* TO 'mb'@'%';
GRANT ALL PRIVILEGES ON mb_python.* TO 'mb'@'%';
FLUSH PRIVILEGES;"
