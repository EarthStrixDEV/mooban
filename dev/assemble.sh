#!/bin/sh
# Assemble the PHP site. Usage: bash dev/assemble.sh [apache|nginx]   (default: apache)
#   apache -> build/php        (config: DB mb_apache, APP_STACK=apache, .htaccess files kept)
#   nginx  -> build/php-nginx  (config: DB mb_nginx,  APP_STACK=nginx,  no .htaccess files)
# Layout of the output tree:
#   public_html/  = shared/public/* + php/public/* (incl. .htaccess files)
#   src/          = php/src
#   seed-texts.json = shared/seed-texts.json (beside config.php, outside the docroot)
#   config.php    = created from dev values only when missing (never overwritten)
# Existing public_html/media contents (uploads) are preserved.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-apache}"
case "$TARGET" in
  apache) OUT="$ROOT/build/php"; DB=mb_apache ;;
  nginx)  OUT="$ROOT/build/php-nginx"; DB=mb_nginx ;;
  *) echo "usage: assemble.sh [apache|nginx]" >&2; exit 2 ;;
esac

mkdir -p "$OUT/public_html/media" "$OUT/src"
find "$OUT/public_html" -mindepth 1 -maxdepth 1 ! -name media -exec rm -rf {} +
rm -rf "$OUT/src"
mkdir -p "$OUT/src"

cp -R "$ROOT/shared/public/." "$OUT/public_html/"
cp -R "$ROOT/php/public/." "$OUT/public_html/"
if [ "$TARGET" = nginx ]; then
  # nginx ignores .htaccess; do not leave them around where they could be served
  find "$OUT/public_html" -name .htaccess -delete
fi
cp -R "$ROOT/php/src/." "$OUT/src/"
cp "$ROOT/shared/seed-texts.json" "$OUT/seed-texts.json"

if [ ! -f "$OUT/config.php" ]; then
  cat > "$OUT/config.php" <<PHP
<?php
declare(strict_types=1);

return [
    'DB_HOST' => 'mysql',
    'DB_NAME' => '$DB',
    'DB_USER' => 'mb',
    'DB_PASS' => 'mb',
    'APP_STACK' => '$TARGET',
    'TEST_TOKEN' => 'dev-test-token-0123456789abcd',
    'MEDIA_DIR' => '/var/www/site/public_html/media',
    'CACHE_DIR' => '/var/www/cache',
    'MAX_UPLOAD_BYTES' => 10485760,
    'MAX_PIXELS' => 24000000,
    'SSE_POLL_MS' => 1000,
    'SSE_MAX_SECONDS' => 60,
    'MAX_STREAMS_PER_IP' => 10,
];
PHP
fi
echo "assembled: $OUT"
