FROM php:8.3-apache

RUN apt-get update \
 && apt-get install -y --no-install-recommends libjpeg-dev libwebp-dev libpng-dev \
 && docker-php-ext-configure gd --with-jpeg --with-webp \
 && docker-php-ext-install -j"$(nproc)" gd exif pdo_mysql \
 && a2enmod rewrite headers \
 && rm -rf /var/lib/apt/lists/*

ENV APACHE_DOCUMENT_ROOT=/var/www/site/public_html

RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
 && printf '<Directory ${APACHE_DOCUMENT_ROOT}>\n  AllowOverride All\n  Require all granted\n</Directory>\n' > /etc/apache2/conf-available/mooban.conf \
 && a2enconf mooban \
 && printf 'upload_max_filesize=10M\npost_max_size=12M\nmemory_limit=256M\ndisplay_errors=0\nlog_errors=1\n' > /usr/local/etc/php/conf.d/mooban.ini \
 && mkdir -p /var/www/cache \
 && chown www-data:www-data /var/www/cache
