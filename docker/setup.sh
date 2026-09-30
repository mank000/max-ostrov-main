#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -e "$root/.env" ]; then
    printf '%s\n' '.env уже есть, оставлен без изменений.'
else
    (umask 077; cp "$root/.env.docker.example" "$root/.env")
    printf '%s\n' 'Создан .env для настройки HTTPS и MAX. Заполните токен MAX и домены.'
fi
