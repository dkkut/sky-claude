#!/usr/bin/env bash
# ============================================================
#  Роль БД для приложения без прав суперпользователя.
#
#      cd /opt/sky && bash scripts/db-harden.sh            # создать роль sky_app и включить её
#      bash scripts/db-harden.sh --check                   # только проверить текущее состояние
#      bash scripts/db-harden.sh --rollback                # вернуть приложение на владельца БД
#
#  ЗАЧЕМ. В образе postgres пользователь POSTGRES_USER (у нас `sky`) — суперпользователь кластера. Пока
#  приложение работает под ним, любая SQL-инъекция или захват API даёт чтение файлов сервера БД и выполнение
#  команд (COPY … PROGRAM). Под ролью sky_app такого нет: она читает/пишет таблицы и ничего больше.
#
#  Что делает:
#   1. Создаёт роль sky_app (случайный пароль) и выдаёт ей только DML (scripts/db-roles.sql).
#   2. Пишет в .env: APP_DATABASE_URL (роль приложения) и SKIP_MIGRATE_ON_START=1.
#      Пароль владельца БД остаётся в POSTGRES_PASSWORD и в окружение работающего api НЕ попадает:
#      миграции накатывает отдельный одноразовый запуск (scripts/migrate.mjs) из deploy-local.sh.
#   3. Подсказывает следующий шаг: bash scripts/deploy-local.sh (применит и перезапустит).
#
#  Откат: --rollback убирает APP_DATABASE_URL и SKIP_MIGRATE_ON_START из .env (роль в БД остаётся, но не
#  используется); затем deploy-local.sh. Данные не затрагиваются ни одной из команд.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Здесь нет .env — запускайте из каталога приложения (где docker-compose.yml)."; exit 1; }

MODE=apply
for a in "$@"; do case "$a" in --check) MODE=check ;; --rollback) MODE=rollback ;; -h|--help) sed -n 2,22p "$0"; exit 0 ;; *) echo "Неизвестный параметр: $a"; exit 1 ;; esac; done

get_env() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
set_env() {
  local key="$1" val="$2" tmp found=0 line
  tmp="$(mktemp .env.XXXXXX)"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" == "$key="* ]]; then if [ "$found" = 0 ]; then printf '%s=%s\n' "$key" "$val" >> "$tmp"; found=1; fi
    else printf '%s\n' "$line" >> "$tmp"; fi
  done < .env
  [ "$found" = 1 ] || printf '%s=%s\n' "$key" "$val" >> "$tmp"
  chmod 600 "$tmp"; mv "$tmp" .env
}
del_env() { local tmp; tmp="$(mktemp .env.XXXXXX)"; grep -vE "^$1=" .env > "$tmp" || true; chmod 600 "$tmp"; mv "$tmp" .env; }
ok() { echo "  ✔ $*"; }; bad() { echo "  ✖ $*"; }
psql_owner() { docker compose exec -T postgres psql -U sky -d sky -v ON_ERROR_STOP=1 "$@"; }

check() {
  echo "Проверка роли БД приложения:"
  if grep -q '^APP_DATABASE_URL=' .env; then ok "в .env задан APP_DATABASE_URL"; else bad "APP_DATABASE_URL не задан — приложение работает под владельцем БД (суперпользователем)"; fi
  local su
  su="$(psql_owner -tAc "select rolsuper from pg_roles where rolname='sky_app'" 2>/dev/null | tr -d '[:space:]' || true)"
  case "$su" in f) ok "роль sky_app существует и НЕ суперпользователь" ;; t) bad "sky_app — суперпользователь (так быть не должно)" ;; *) bad "роли sky_app в БД нет — запустите scripts/db-harden.sh" ;; esac
  local who
  who="$(docker compose exec -T api node -e "import('/app/server/db.mjs').then(async m=>{const r=await m.query('select current_user u, (select rolsuper from pg_roles where rolname=current_user) s');console.log(r.rows[0].u+' super='+r.rows[0].s);process.exit(0)})" 2>/dev/null | tail -n1 || true)"
  [ -n "$who" ] && echo "  • api сейчас подключён как: $who" || echo "  • api не отвечает или ещё не перезапущен"
}

case "$MODE" in
  check) check; exit 0 ;;
  rollback)
    del_env APP_DATABASE_URL; del_env SKIP_MIGRATE_ON_START
    ok "APP_DATABASE_URL и SKIP_MIGRATE_ON_START убраны из .env"; echo "Дальше: bash scripts/deploy-local.sh (api вернётся на владельца БД)."; exit 0 ;;
esac

echo "============================================"
echo " Роль БД приложения: создаю sky_app"
echo "============================================"
docker compose up -d postgres >/dev/null
for _ in $(seq 1 30); do docker compose exec -T postgres pg_isready -U sky >/dev/null 2>&1 && break; sleep 1; done

PW="$(get_env APP_DB_PASSWORD)"
[ -n "$PW" ] || PW="$(openssl rand -hex 24)"
docker compose exec -T postgres sh -c 'cat > /tmp/db-roles.sql' < scripts/db-roles.sql
psql_owner -v "app_password=$PW" -v owner=sky -v dbname=sky -f /tmp/db-roles.sql >/dev/null
docker compose exec -T postgres rm -f /tmp/db-roles.sql
ok "роль sky_app создана/обновлена, права — только DML"

set_env APP_DB_PASSWORD "$PW"
set_env APP_DATABASE_URL "postgres://sky_app:${PW}@postgres:5432/sky"
set_env SKIP_MIGRATE_ON_START 1
ok ".env обновлён (права 600)"
echo
echo "Дальше:  bash scripts/deploy-local.sh   — миграции применит владелец, api перезапустится под sky_app."
echo "Проверка: bash scripts/db-harden.sh --check"
echo "Откат:    bash scripts/db-harden.sh --rollback && bash scripts/deploy-local.sh"
