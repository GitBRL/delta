# Imagem PHP de desenvolvimento do Delta: FrankenPHP (Caddy + PHP) + extensões + Composer.
FROM dunglas/frankenphp:1.13-php8.5-alpine

RUN install-php-extensions \
        pdo_pgsql pgsql redis intl zip bcmath pcntl opcache gd exif sockets

COPY --from=composer:2.11 /usr/bin/composer /usr/bin/composer
COPY conf.d/delta.ini /usr/local/etc/php/conf.d/zz-delta.ini

ARG UID=1000
ARG GID=1000
RUN addgroup -g "${GID}" app \
 && adduser -D -u "${UID}" -G app app \
 && mkdir -p /data/caddy /config/caddy /composer \
 && chown -R app:app /data/caddy /config/caddy /composer

ENV COMPOSER_HOME=/composer \
    COMPOSER_CACHE_DIR=/composer/cache

WORKDIR /app
USER app
