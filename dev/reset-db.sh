#!/bin/sh
# Dev only: reset ONE stack's database and media dir inside the Docker dev environment.
# Usage: bash dev/reset-db.sh <apache|nginx|node|python>
#   - DROP + CREATE database mb_<stack> (utf8mb4) and reload shared/schema.sql
#   - empty that stack's media dir inside the container that writes it
#       apache/nginx: <docroot>/media  (media/.htaccess is kept)
#       node/python : /data/media
# Any other argument is refused. Never touches other stacks or other containers.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
dc() { docker compose -f dev/docker-compose.yml "$@"; }
export MSYS_NO_PATHCONV=1

case "${1:-}" in
  apache) SERVICE=apache; MEDIA=/var/www/site/public_html/media ;;
  nginx)  SERVICE=phpfpm; MEDIA=/var/www/site/public_html/media ;;
  node)   SERVICE=node;   MEDIA=/data/media ;;
  python) SERVICE=python; MEDIA=/data/media ;;
  *) echo "usage: reset-db.sh <apache|nginx|node|python>" >&2; exit 2 ;;
esac
DB="mb_$1"

dc exec -T -e MYSQL_PWD=root mysql mysql -uroot -e \
  "DROP DATABASE IF EXISTS \`$DB\`; CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
dc exec -T -e MYSQL_PWD=root mysql sh -c "mysql -uroot $DB < /schema.sql"
echo "database $DB: dropped, recreated, schema.sql loaded"

dc exec -T "$SERVICE" sh -c "mkdir -p '$MEDIA' && find '$MEDIA' -mindepth 1 -maxdepth 1 ! -name .htaccess -exec rm -rf {} +"
echo "media dir $MEDIA (service $SERVICE): emptied (.htaccess kept)"
