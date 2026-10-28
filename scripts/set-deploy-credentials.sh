#!/usr/bin/env bash
# Сохраняет логин и пароль (токен GitHub) для деплоя, чтобы deploy-local.sh не спрашивал их при git fetch.
#   bash scripts/set-deploy-credentials.sh           — спросить и сохранить
#   bash scripts/set-deploy-credentials.sh --check   — показать, сохранено ли (пароль не печатается)
#   bash scripts/set-deploy-credentials.sh --remove  — удалить
# Файл: /etc/sky-deploy.cred (или $DEPLOY_CRED), права 600, владелец root. Пароль — токен GitHub (repo:read), не пароль аккаунта.
set -euo pipefail
F="${DEPLOY_CRED:-/etc/sky-deploy.cred}"
case "${1:-}" in
  --check)  if [ -f "$F" ]; then echo "Сохранено: $F (логин: $(grep '^GIT_USER=' "$F" | cut -d= -f2-), пароль скрыт)"; else echo "Не сохранено."; fi; exit 0;;
  --remove) rm -f "$F"; echo "Удалено."; exit 0;;
esac
read -r -p "Логин GitHub: " U
read -r -s -p "Пароль / токен (ввод скрыт): " P; echo
[ -n "$U" ] && [ -n "$P" ] || { echo "Пусто — не сохранено."; exit 1; }
case "$U$P" in *$'\n'*|*\'*|*\"*) echo "Недопустимые символы."; exit 1;; esac
umask 077
printf 'GIT_USER=%s\nGIT_TOKEN=%s\n' "$U" "$P" > "$F"
chmod 600 "$F"
echo "Сохранено в $F (600). Проверка: bash scripts/set-deploy-credentials.sh --check"
