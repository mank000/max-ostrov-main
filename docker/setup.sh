#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -e "$root/.env" ]; then
    printf '%s\n' '.env уже есть, оставлен без изменений.'
else
    (umask 077; cp "$root/.env.example" "$root/.env")
    printf '%s\n' 'Создан .env. Для локального демо можно изменить порты; для HTTPS заполните домены и токен MAX.'
fi
