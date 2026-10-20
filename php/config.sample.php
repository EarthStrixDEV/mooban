<?php
declare(strict_types=1);

// Copy to php/config.php (git-ignored), keep it OUTSIDE the document root, chmod 600.
return [
    'DB_HOST' => 'localhost',
    'DB_NAME' => '<username>_mb_apache',
    'DB_USER' => '<username>_mb',
    'DB_PASS' => 'change-me',
    'APP_STACK' => 'apache',               // value of the X-Stack header (apache | nginx)
    'TEST_TOKEN' => 'change-me-random-24+-chars',
    'MEDIA_DIR' => '/home/<username>/domains/<domain>/public_html/media',
    'CACHE_DIR' => '/home/<username>/mb_apache_cache',
    'PORT' => 0,                           // unused by PHP stacks
    'MAX_UPLOAD_BYTES' => 10485760,
    'MAX_PIXELS' => 24000000,
    'SSE_POLL_MS' => 1000,
    'SSE_MAX_SECONDS' => 60,
    'MAX_STREAMS_PER_IP' => 10,
];
