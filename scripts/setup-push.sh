#!/usr/bin/env bash
# ============================================================
#  Настройка push-уведомлений — одной командой.
#
#      cd /opt/sky-src && bash scripts/setup-push.sh            # настроить
#      bash scripts/setup-push.sh --check                       # только показать, что настроено
#      bash scripts/setup-push.sh --fcm /путь/service-account.json   # добавить Android (FCM)
#      bash scripts/setup-push.sh --regen                       # выпустить новые VAPID-ключи
#
#  Что делает:
#   1. Web Push (сайт, ПК, PWA): если в .env нет ключей VAPID — выпускает пару и записывает
#      VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT. Существующие ключи НЕ трогает:
#      смена ключей отключает все уже оформленные подписки (люди должны будут включить push заново).
#   2. FCM (Android): проверяет файл сервисного аккаунта Firebase и кладёт его одной строкой
#      в FCM_SERVICE_ACCOUNT_JSON. Ещё нужен android/app/google-services.json — скрипт напомнит.
#   3. Подсказывает, как применить: перезапуск api (deploy-local.sh).
#
#  Секреты на экран не печатаются; .env получает права 600. Без ключей push тихо выключен,
#  остальное приложение работает полностью.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Здесь нет .env — запускайте из каталога приложения (где docker-compose.yml)."; exit 1; }

MODE=setup; FCM_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check ;;
    --regen) MODE=regen ;;
    --fcm) FCM_FILE="${2:-}"; [ -n "$FCM_FILE" ] || { echo "--fcm требует путь к JSON-файлу"; exit 1; }; shift ;;
    -h|--help) sed -n 2,22p "$0"; exit 0 ;;
    *) echo "Неизвестный параметр: $1 (см. --help)"; exit 1 ;;
  esac
  shift
done

# Значение переменной из .env (последнее вхождение), без кавычек.
get_env() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }

# Запись переменной в .env. Без sed/awk -v: в JSON сервисного аккаунта есть \n и спецсимволы,
# которые они приняли бы за управляющие последовательности.
set_env() {
  local key="$1" val="$2" tmp found=0 line
  tmp="$(mktemp .env.XXXXXX)"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" == "$key="* ]]; then
      if [ "$found" = 0 ]; then printf '%s=%s\n' "$key" "$val" >> "$tmp"; found=1; fi
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < .env
  [ "$found" = 1 ] || printf '%s=%s\n' "$key" "$val" >> "$tmp"
  chmod 600 "$tmp"; mv "$tmp" .env
}

show() { # название, значение, подсказка
  if [ -n "$2" ]; then echo "  ✔ $1: задано"; else echo "  ✖ $1: не задано${3:+ — $3}"; fi
}

status() {
  echo "Состояние push (из .env):"
  show "VAPID_PUBLIC_KEY (Web Push)" "$(get_env VAPID_PUBLIC_KEY)" "bash scripts/setup-push.sh"
  show "VAPID_PRIVATE_KEY" "$(get_env VAPID_PRIVATE_KEY)"
  show "VAPID_SUBJECT" "$(get_env VAPID_SUBJECT)" "будет mailto:admin@localhost"
  show "FCM_SERVICE_ACCOUNT_JSON (Android)" "$(get_env FCM_SERVICE_ACCOUNT_JSON)" "bash scripts/setup-push.sh --fcm файл.json"
  if [ -f android/app/google-services.json ]; then echo "  ✔ android/app/google-services.json: есть"
  else echo "  ✖ android/app/google-services.json: нет — без него Android-сборка не получит токен FCM"; fi
}

# ── Выпуск пары VAPID: локальный node с web-push, иначе внутри контейнера api.
gen_vapid() {
  if [ -d server/node_modules/web-push ] && command -v node >/dev/null 2>&1; then
    node scripts/gen-vapid.mjs
  elif command -v docker >/dev/null 2>&1; then
    docker compose run --rm --no-deps -T --entrypoint node api -e \
      "const w=require('web-push');const k=w.generateVAPIDKeys();console.log('VAPID_PUBLIC_KEY='+k.publicKey+'\nVAPID_PRIVATE_KEY='+k.privateKey)"
  else
    echo "Нужен либо node с установленным server/node_modules, либо docker." >&2; return 1
  fi
}

if [ "$MODE" = check ]; then status; exit 0; fi

echo "============================================"
echo " Push-уведомления — настройка"
echo "============================================"

# 1. Web Push
if [ "$MODE" = regen ] || [ -z "$(get_env VAPID_PUBLIC_KEY)" ] || [ -z "$(get_env VAPID_PRIVATE_KEY)" ]; then
  if [ "$MODE" = regen ] && [ -n "$(get_env VAPID_PUBLIC_KEY)" ]; then
    echo "ВНИМАНИЕ: новые ключи отключат все уже оформленные подписки — людям придётся включить push заново."
  fi
  echo "==> Выпускаю ключи VAPID"
  OUT="$(gen_vapid)"
  PUB="$(printf '%s\n' "$OUT" | grep '^VAPID_PUBLIC_KEY=' | cut -d= -f2-)"
  PRIV="$(printf '%s\n' "$OUT" | grep '^VAPID_PRIVATE_KEY=' | cut -d= -f2-)"
  [ -n "$PUB" ] && [ -n "$PRIV" ] || { echo "Не удалось получить ключи VAPID." >&2; exit 1; }
  set_env VAPID_PUBLIC_KEY "$PUB"; set_env VAPID_PRIVATE_KEY "$PRIV"
  echo "    ключи записаны в .env (на экран не выводятся)"
else
  echo "==> Ключи VAPID уже есть — не трогаю (для новых: --regen)"
fi
if [ -z "$(get_env VAPID_SUBJECT)" ]; then
  MAIL="$(get_env CERTBOT_EMAIL)"
  set_env VAPID_SUBJECT "mailto:${MAIL:-admin@localhost}"
  echo "==> VAPID_SUBJECT = mailto:${MAIL:-admin@localhost} (адрес для связи с вами у службы push)"
fi

# 2. FCM (Android)
if [ -n "$FCM_FILE" ]; then
  [ -f "$FCM_FILE" ] || { echo "Нет файла: $FCM_FILE" >&2; exit 1; }
  ONE="$(python3 - "$FCM_FILE" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for k in ("project_id", "client_email", "private_key"):
    if not d.get(k):
        sys.exit("в файле нет поля %s — нужен ключ СЕРВИСНОГО аккаунта Firebase (Настройки проекта → Сервисные аккаунты)" % k)
print(json.dumps(d, separators=(",", ":")))
PY
)" || { echo "Файл не подошёл: $ONE" >&2; exit 1; }
  set_env FCM_SERVICE_ACCOUNT_JSON "$ONE"
  echo "==> FCM: сервисный аккаунт записан в .env (одной строкой)"
fi

echo
status
echo
echo "Дальше:"
echo "  1) Применить:   bash scripts/deploy-local.sh   (или: docker compose up -d api)"
echo "  2) Проверить:   откройте сайт → Профиль → Настройки → уведомления → включите push;"
echo "                  владельцу — там же «Уведомления владельца»: что присылать и куда."
echo "  3) Android:     положите google-services.json в android/app/ и пересоберите .apk."
chmod 600 .env
