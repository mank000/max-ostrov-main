#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

git fetch --quiet origin Artem
if [ "$(git branch --show-current)" != "Artem" ]; then
  echo "sync: другая ветка, обновление пропущено"
  exit 0
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "sync: есть локальные изменения, обновление пропущено"
  exit 0
fi
if git merge-base --is-ancestor origin/Artem HEAD; then
  echo "sync: локальная ветка уже актуальна"
  exit 0
fi
git merge --ff-only origin/Artem
echo "sync: Artem обновлена до $(git rev-parse --short HEAD)"
