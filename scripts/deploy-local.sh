#!/usr/bin/env bash
# ============================================================
#  Выкладка без GitHub Actions — прямо на сервере.
#
#      bash /opt/sky-src/scripts/deploy-local.sh
#
#  Делает то же, что пайплайн Deploy: тянет ветку, собирает образы
#  web и api, прописывает их в .env рабочего каталога, перезапускает
#  сервисы и ждёт, пока они станут healthy. Деньги и минуты GitHub не
#  нужны: образы собираются тут же, на сервере.
#
#  Каталоги:
#    SRC_DIR  — клон репозитория (по умолчанию каталог скрипта);
#    APP_DIR  — рабочий каталог с docker-compose.yml и .env
#               (по умолчанию /opt/sky).
#
#  Переменные:
#    BRANCH   — ветка (по умолчанию claude/project-server-setup-opwwui)
#    SKIP_PULL=1 — не делать git pull (собрать то, что уже лежит)
# ============================================================
set -euo pipefail

SRC_DIR="${SRC_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_DIR="${APP_DIR:-/opt/sky}"
BRANCH="${BRANCH:-claude/project-server-setup-opwwui}"

[ -f "$APP_DIR/docker-compose.yml" ] || { echo "В $APP_DIR нет docker-compose.yml — задайте APP_DIR."; exit 1; }
[ -f "$APP_DIR/.env" ]               || { echo "В $APP_DIR нет .env."; exit 1; }

cd "$SRC_DIR"
if [ "${SKIP_PULL:-0}" != "1" ]; then
  echo "==> Обновляю код ($BRANCH)"
  # Сохранённые логин и пароль (scripts/set-deploy-credentials.sh): через GIT_ASKPASS, в адрес и в аргументы не попадают.
  CRED="${DEPLOY_CRED:-/etc/sky-deploy.cred}"
  if [ -r "$CRED" ]; then
    GIT_USER="$(grep '^GIT_USER=' "$CRED" | cut -d= -f2-)"; GIT_TOKEN="$(grep '^GIT_TOKEN=' "$CRED" | cut -d= -f2-)"
    ASK="$(mktemp)"; trap 'rm -f "$ASK"' EXIT
    printf '#!/bin/sh\ncase "$1" in *sername*) printf %%s "$SKY_GIT_USER";; *) printf %%s "$SKY_GIT_TOKEN";; esac\n' > "$ASK"; chmod 700 "$ASK"
    export GIT_ASKPASS="$ASK" GIT_TERMINAL_PROMPT=0 SKY_GIT_USER="$GIT_USER" SKY_GIT_TOKEN="$GIT_TOKEN"
  fi
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git merge --ff-only "origin/$BRANCH"
fi
SHA="$(git rev-parse --short HEAD)"
echo "==> Версия $SHA"

# Старые образы нужны для отката: запоминаем их теги до сборки.
PREV_WEB="$(grep -E '^WEB_IMAGE=' "$APP_DIR/.env" | cut -d= -f2- || true)"
PREV_API="$(grep -E '^API_IMAGE=' "$APP_DIR/.env" | cut -d= -f2- || true)"

echo "==> Собираю образ web"
docker build -f Dockerfile     -t "sky-web:$SHA" .
echo "==> Собираю образ api"
docker build -f Dockerfile.api -t "sky-api:$SHA" .

set_env() {
  local key="$1" val="$2"
  if grep -q "^$key=" "$APP_DIR/.env"; then
    sed -i "s|^$key=.*|$key=$val|" "$APP_DIR/.env"
  else
    printf '%s=%s\n' "$key" "$val" >> "$APP_DIR/.env"
  fi
}

# Конфигурацию (compose, скрипты) берём из этой же версии кода.
# Репозиторий и рабочий каталог могут совпадать (клон лежит прямо в /opt/sky) — тогда копировать нечего,
# а cp на тот же файл завершается ошибкой и под set -e обрывал деплой после сборки образов.
if [ "$(cd "$SRC_DIR" && pwd -P)" != "$(cd "$APP_DIR" && pwd -P)" ]; then
  cp docker-compose.yml "$APP_DIR/docker-compose.yml"
  mkdir -p "$APP_DIR/scripts"
  cp -r scripts/. "$APP_DIR/scripts/"
fi

set_env WEB_IMAGE "sky-web:$SHA"
set_env API_IMAGE "sky-api:$SHA"

cd "$APP_DIR"
# Если включена роль БД приложения без прав на схему (scripts/db-harden.sh), миграции выполняет отдельный
# одноразовый запуск под владельцем: пароль владельца в окружение работающего api не попадает.
if grep -q '^SKIP_MIGRATE_ON_START=1' .env 2>/dev/null; then
  echo "==> Миграции под владельцем БД (роль приложения схему менять не может)"
  docker compose up -d postgres
  PGPASS="$(grep -E '^POSTGRES_PASSWORD=' .env | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
  docker compose run --rm --no-deps -e SKIP_MIGRATE_ON_START=0 \
    -e "DATABASE_URL=postgres://sky:${PGPASS}@postgres:5432/sky" api node scripts/migrate.mjs
fi
# Проверка конфигурации nginx нового образа ДО перезапуска: entrypoint соберёт конфиг из шаблонов
# (те же переменные и тома, что у боевого web), затем nginx -t. Сломанный конфиг не доходит до сервера.
echo "==> Проверяю конфигурацию nginx (nginx -t)"
if ! docker compose run --rm --no-deps web sh -c 'getent hosts api >/dev/null || echo "127.0.0.1 api" >> /etc/hosts; nginx -t' >/tmp/sky-nginx-test.log 2>&1; then
  tail -n 15 /tmp/sky-nginx-test.log
  echo "Конфигурация nginx не проходит проверку — деплой остановлен, работающий сайт не тронут."
  [ -n "$PREV_WEB" ] && set_env WEB_IMAGE "$PREV_WEB"
  [ -n "$PREV_API" ] && set_env API_IMAGE "$PREV_API"
  exit 1
fi
echo "==> Перезапускаю"
docker compose up -d --remove-orphans

echo "==> Жду, пока сервисы станут healthy"
unhealthy=""
for _ in $(seq 1 30); do
  unhealthy=$(docker compose ps --format '{{.Service}} {{.Health}}' \
              | awk '$1 != "certbot" && $2 != "healthy" { print $1 }' | tr '\n' ' ')
  [ -z "$unhealthy" ] && break
  sleep 5
done
docker compose ps --format 'table {{.Service}}\t{{.Status}}'

if [ -n "$unhealthy" ]; then
  echo "Сервисы не поднялись: $unhealthy"
  docker compose logs --tail 50
  if [ -n "$PREV_WEB" ] && [ -n "$PREV_API" ]; then
    echo "==> Откатываюсь на прежние образы"
    set_env WEB_IMAGE "$PREV_WEB"
    set_env API_IMAGE "$PREV_API"
    docker compose up -d --remove-orphans
  fi
  exit 1
fi

# Старые локальные образы занимают диск — оставляем три последних.
docker image ls --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' \
  | awk '$1 ~ /^sky-(web|api):/ && $1 !~ /:local$/' | sort -k2 -r \
  | awk '{print $1}' | awk -F: '{c[$1]++; if (c[$1] > 3) print $0}' \
  | xargs -r docker rmi >/dev/null 2>&1 || true

echo "Готово: $SHA"
