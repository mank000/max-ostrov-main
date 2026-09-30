#!/bin/sh
set -eu
umask 077
mkdir -p /secrets
# Не меняем пароль при повторном up: в существующей базе он уже другой не станет.
if [ ! -e /secrets/postgres_password ]; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > /secrets/postgres_password.tmp
    test "$(wc -c < /secrets/postgres_password.tmp | tr -d ' ')" = 64
    mv /secrets/postgres_password.tmp /secrets/postgres_password
fi
password=$(cat /secrets/postgres_password)
case "$password" in *[!0-9a-f]*|'') echo 'Invalid database password file' >&2; exit 1;; esac
[ "${#password}" -eq 64 ] || exit 1
printf 'postgres://kutezh:%s@db:5432/kutezh?sslmode=disable' "$password" > /secrets/database_url.tmp
mv /secrets/database_url.tmp /secrets/database_url
if [ ! -e /secrets/moderation_key ]; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > /secrets/moderation_key.tmp
    test "$(wc -c < /secrets/moderation_key.tmp | tr -d ' ')" = 64
    mv /secrets/moderation_key.tmp /secrets/moderation_key
fi
key=$(cat /secrets/moderation_key)
case "$key" in *[!0-9a-f]*|'') echo 'Invalid moderation key file' >&2; exit 1;; esac
[ "${#key}" -eq 64 ] || exit 1
chown 10001:10001 /secrets/postgres_password /secrets/database_url /secrets/moderation_key
chmod 0400 /secrets/postgres_password /secrets/database_url /secrets/moderation_key
