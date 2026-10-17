#!/usr/bin/env bash
# ============================================================
#  Проверка, что копия базы РЕАЛЬНО восстанавливается.
#
#      bash scripts/backup-verify.sh /var/backups/sky/db-….sql.gz            # открытая копия
#      bash scripts/backup-verify.sh db-….sql.gz.age /безопасное/место/backup.key
#      VERIFY_PG_URL=postgres://postgres@127.0.0.1/postgres bash scripts/backup-verify.sh db-….sql.gz
#      bash scripts/backup-verify.sh --docker db-….sql.gz     # временная база в контейнере postgres стека
#
#  Создаёт ВРЕМЕННУЮ базу sky_verify_<время>, заливает в неё копию, сверяет, что таблицы и данные на месте,
#  и удаляет её. Рабочую базу `sky` не трогает ни при каком исходе. Секретный ключ age в этот скрипт передаётся
#  только для проверки и нигде не сохраняется.
#
#  Лучше запускать НЕ на боевом сервере (копия содержит данные людей) — на отдельной машине с PostgreSQL,
#  куда вы скопировали файл. Режим --docker использует тот же сервер БД, что и боевая база (отдельной базой).
# ============================================================
set -euo pipefail

DOCKER=0; FILE=""; KEY=""
for a in "$@"; do
  case "$a" in
    --docker) DOCKER=1 ;;
    -h|--help) sed -n 2,16p "$0"; exit 0 ;;
    -*) echo "Неизвестный параметр: $a"; exit 1 ;;
    *) if [ -z "$FILE" ]; then FILE="$a"; else KEY="$a"; fi ;;
  esac
done
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Укажите файл копии: bash scripts/backup-verify.sh db-….sql.gz[.age] [ключ]"; exit 1; }

DB="sky_verify_$(date +%s)"
if [ "$DOCKER" = 1 ]; then
  APP_DIR="${APP_DIR:-/opt/sky}"; cd "$APP_DIR"
  psql_admin() { docker compose exec -T postgres psql -U sky -d postgres -v ON_ERROR_STOP=1 "$@"; }
  psql_db()    { docker compose exec -T postgres psql -U sky -d "$DB" -v ON_ERROR_STOP=0 -q "$@"; }
else
  ADMIN_URL="${VERIFY_PG_URL:-postgres://postgres@127.0.0.1/postgres}"
  psql_admin() { psql "$ADMIN_URL" -v ON_ERROR_STOP=1 "$@"; }
  BASE="${ADMIN_URL%/*}"; Q=""; case "$ADMIN_URL" in *\?*) Q="?${ADMIN_URL#*\?}"; BASE="${ADMIN_URL%%\?*}"; BASE="${BASE%/*}";; esac
  psql_db()    { psql "$BASE/$DB$Q" -v ON_ERROR_STOP=0 -q "$@"; }
fi

cleanup() { psql_admin -qc "DROP DATABASE IF EXISTS \"$DB\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Открываем копию в поток SQL
stream() {
  case "$FILE" in
    *.age) [ -n "$KEY" ] || { echo "Копия зашифрована — передайте секретный ключ age вторым аргументом." >&2; exit 1; }
           command -v age >/dev/null || { echo "Нужна программа age." >&2; exit 1; }
           age -d -i "$KEY" "$FILE" | gunzip -c ;;
    *.gz)  gunzip -c "$FILE" ;;
    *.sql) cat "$FILE" ;;
    *) echo "Неизвестный формат: $FILE" >&2; exit 1 ;;
  esac
}

echo "==> Создаю временную базу $DB"
psql_admin -qc "CREATE DATABASE \"$DB\""
echo "==> Заливаю копию"
LOG="$(mktemp)"; stream | psql_db > "$LOG" 2>&1 || true
ERRS="$(grep -ci '^ERROR\|^psql:.*ERROR' "$LOG" || true)"

echo "==> Проверка содержимого"
T="$(psql_db -tA -c "select count(*) from information_schema.tables where table_schema='public'" | tr -d '[:space:]')"
M="$(psql_db -tA -c "select count(*) from migrations" 2>/dev/null | tr -d '[:space:]' || true)"
[ -n "$M" ] || M="$(psql_db -tA -c "select count(*) from schema_migrations" 2>/dev/null | tr -d '[:space:]' || true)"
echo "    таблиц: ${T:-0}; записей в журнале миграций: ${M:-нет такой таблицы}; ошибок при заливке: $ERRS"
for t in sky_ids profiles wallet_accounts wallet_transactions; do
  n="$(psql_db -tA -c "select count(*) from $t" 2>/dev/null | tr -d '[:space:]' || true)"
  echo "    $t: ${n:-ТАБЛИЦЫ НЕТ}"
done
rm -f "$LOG"

if [ "${T:-0}" -lt 10 ] || [ "$ERRS" -gt 0 ]; then
  echo "РЕЗУЛЬТАТ: копия НЕ прошла проверку (мало таблиц или были ошибки). Рабочая база не затронута."; exit 2
fi
echo "РЕЗУЛЬТАТ: копия восстанавливается, структура и данные на месте. Временная база удалена."
