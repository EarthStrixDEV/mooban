#!/bin/sh
# Assemble the PHP site into build/php:
#   public_html/  = shared/public/* + php/public/* (incl. .htaccess files)
#   src/          = php/src
#   config.php    = created from dev values only when missing (never overwritten)
# Existing public_html/media contents (uploads) are preserved.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/php"

mkdir -p "$OUT/public_html/media" "$OUT/src"
find "$OUT/public_html" -mindepth 1 -maxdepth 1 ! -name media -exec rm -rf {} +
rm -rf "$OUT/src"
mkdir -p "$OUT/src"

cp -R "$ROOT/shared/public/." "$OUT/public_html/"
cp -R "$ROOT/php/public/." "$OUT/public_html/"
cp -R "$ROOT/php/src/." "$OUT/src/"

if [ ! -f "$OUT/config.php" ]; then
  cat > "$OUT/config.php" <<'PHP'
<?php
declare(strict_types=1);

return [
    'DB_HOST' => 'mysql',
    'DB_NAME' => 'mb_apache',
    'DB_USER' => 'mb',
    'DB_PASS' => 'mb',
    'APP_STACK' => 'apache',
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
