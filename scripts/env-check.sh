#!/usr/bin/env bash
# Проверка секретов в .env (значения НЕ печатаются, только имена и вердикты).
#   cd /opt/sky && bash /opt/sky-src/scripts/env-check.sh
# Код выхода: 0 — замечаний нет, 1 — есть критичные, 2 — только предупреждения.
set -uo pipefail
cd "${APP_DIR:-/opt/sky}"
ENVF="${ENV_FILE:-.env}"
bad=0; warn=0
fail() { echo "  ✖ $1"; bad=$((bad+1)); }
wr()   { echo "  ⚠ $1"; warn=$((warn+1)); }
okk()  { echo "  ✔ $1"; }
[ -f "$ENVF" ] || { [ -f "$ENVF.gpg" ] && { echo "✔ Открытого $ENVF нет, есть $ENVF.gpg (зашифрован)."; exit 0; }; echo "Нет $ENVF"; exit 1; }
val() { grep -E "^$1=" "$ENVF" | tail -n1 | cut -d= -f2- | tr -d "\"' \r"; }
has_file() { [ -n "$(grep -E "^$1_FILE=" "$ENVF" | tail -n1 | cut -d= -f2-)" ]; }

echo "Файл $ENVF"
mode="$(stat -c %a "$ENVF" 2>/dev/null)"
[ "$mode" = 600 ] || [ "$mode" = 400 ] && okk "права $mode" || fail "права $mode — нужно 600: chmod 600 $ENVF"
[ "$(stat -c %U "$ENVF" 2>/dev/null)" = root ] || wr "владелец не root"
git -C "$PWD" check-ignore -q "$ENVF" 2>/dev/null && okk ".env игнорируется git" || { git -C "$PWD" rev-parse >/dev/null 2>&1 && wr ".env не в .gitignore (или не git-каталог)"; }
[ -f "$ENVF.gpg" ] && wr "есть и открытый .env, и $ENVF.gpg — после работы: bash scripts/env-seal.sh seal"

echo "Обязательные секреты"
for k in JWT_SECRET REFRESH_TOKEN_SECRET ENCRYPTION_KEY; do
  v="$(val $k)"
  if [ -z "$v" ]; then has_file "$k" && okk "$k — из файла" || fail "$k не задан"; continue; fi
  case "$v" in change_me*|changeme*|secret|password|test*|example*|xxx*|CHANGE*) fail "$k — заглушка"; continue;; esac
  [ "${#v}" -ge 32 ] && okk "$k задан (${#v} знаков)" || fail "$k короче 32 знаков (${#v})"
done
a="$(val JWT_SECRET)"; b="$(val REFRESH_TOKEN_SECRET)"; c="$(val ENCRYPTION_KEY)"
[ -n "$a" ] && [ "$a" = "$b" ] && fail "JWT_SECRET и REFRESH_TOKEN_SECRET одинаковы"
[ -n "$c" ] && { [ "$c" = "$a" ] || [ "$c" = "$b" ]; } && fail "ENCRYPTION_KEY совпадает с ключом подписи токенов"
[ -z "$c" ] && ! has_file ENCRYPTION_KEY && wr "без ENCRYPTION_KEY ключ выводится из JWT_SECRET: смена JWT_SECRET сделает данные нечитаемыми"

echo "Пароли служб"
for k in POSTGRES_PASSWORD REDIS_PASSWORD; do
  v="$(val $k)"; [ -z "$v" ] && { fail "$k не задан"; continue; }
  [ "${#v}" -ge 20 ] && okk "$k (${#v} знаков)" || wr "$k короче 20 знаков"
done

echo "Режимы"
[ "$(val PAYMENTS_MODE)" = demo ] && wr "PAYMENTS_MODE=demo (в production игнорируется, но уберите)"
[ "$(val ADMIN_GATE)" = off ] && fail "ADMIN_GATE=off — вход в админку без подтверждения"
[ -n "$(val BACKUP_AGE_RECIPIENT)" ] && okk "ключ шифрования копий задан" || wr "BACKUP_AGE_RECIPIENT не задан — копии не делаются"
[ -n "$(val SSH_GATE_SECRET)" ] || wr "SSH_GATE_SECRET не задан (вход по SSH без подтверждения)"
[ -n "$(val DOMAIN)" ] || wr "DOMAIN не задан"

echo; echo "Итог: критичных $bad, предупреждений $warn"
[ "$bad" -gt 0 ] && exit 1; [ "$warn" -gt 0 ] && exit 2; exit 0
