FROM php:8.3-fpm

RUN apt-get update \
 && apt-get install -y --no-install-recommends libjpeg-dev libwebp-dev libpng-dev \
 && docker-php-ext-configure gd --with-jpeg --with-webp \
 && docker-php-ext-install -j"$(nproc)" gd exif pdo_mysql \
 && rm -rf /var/lib/apt/lists/*

# Same php.ini values as php-apache.Dockerfile.
COPY mooban-php.ini /usr/local/etc/php/conf.d/mooban.ini

# Pool: unix socket shared with the nginx container. Each open SSE stream holds
# one worker for up to 60 s; R7/R8 hold 10+ streams plus concurrent writes, so
# keep well above 50 workers.
COPY php-fpm-pool.conf /usr/local/etc/php-fpm.d/zz-mooban.conf
RUN mkdir -p /run/php-fpm /var/www/cache \
 && chown www-data:www-data /var/www/cache
