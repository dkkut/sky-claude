#!/usr/bin/env bash
# ============================================================
#  Новые ключи закрытой беты.
#
#      cd /opt/sky && bash scripts/new-beta-keys.sh
#
#  Нужен, если ключи где-то засветились: старые сразу перестают
#  работать вместе со всеми выданными по ним пропусками.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Здесь нет .env — запускайте из каталога приложения."; exit 1; }

gen() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 24; }

K1="$(gen)"; K2="$(gen)"
LINE="BETA_KEYS=$K1:мой,$K2:команда"

# Прежнюю строку запоминаем: если новый ключ вдруг не заработает,
# лучше вернуть старый, чем оставить хозяина запертым снаружи.
PREV="$(grep '^BETA_KEYS=' .env || true)"
BACKUP=".env.beta-backup.$(date +%s)"
cp .env "$BACKUP"
chmod 600 "$BACKUP"

if [ -n "$PREV" ]; then
  sed -i "s|^BETA_KEYS=.*|$LINE|" .env
else
  printf '%s\n' "$LINE" >> .env
fi
chmod 600 .env

echo "==> Перезапускаю приложение"
docker compose up -d api >/dev/null

# Проверяем изнутри контейнера: наружу порт приложения не открыт —
# снаружи доступен только nginx, и стучаться туда значило бы упереться
# в ограничение частоты запросов.
in_api() { docker compose exec -T api node -e "$1" 2>/dev/null; }
# Ключ передаём переменной окружения, а не аргументом: аргументы видны
# в списке процессов, переменные вызова — нет.
probe_key() { docker compose exec -T -e BETA_PROBE="$1" api node -e "$2" 2>/dev/null; }

echo "==> Жду, пока приложение поднимется"
for _ in $(seq 1 40); do
  if [ "$(in_api "require('http').get('http://127.0.0.1:'+(process.env.API_PORT||8080)+'/healthz',r=>{console.log(r.statusCode);process.exit(0)}).on('error',()=>{console.log(0);process.exit(0)})")" = "200" ]; then
    break
  fi
  sleep 1
done

echo "==> Проверяю, что новый ключ работает"
CODE="$(probe_key "$K1" "
const http=require('http');
const body=JSON.stringify({key:process.env.BETA_PROBE});
const req=http.request({host:'127.0.0.1',port:process.env.API_PORT||8080,path:'/api/beta/unlock',method:'POST',
  headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},
  r=>{console.log(r.statusCode);process.exit(0)});
req.on('error',()=>{console.log(0);process.exit(0)});
req.end(body);
" || echo 000)"

if [ "$CODE" != "200" ]; then
  echo
  echo "!!! Новый ключ приложение не принимает (ответ $CODE). Возвращаю прежние."
  cp "$BACKUP" .env
  chmod 600 .env
  docker compose up -d api >/dev/null
  echo "Прежние ключи восстановлены. Ничего не изменилось."
  echo "Копия .env на всякий случай: $BACKUP"
  exit 1
fi

rm -f "$BACKUP"
docker compose logs api --tail 20 | grep -E '\[beta\]' || true

cat <<INFO

────────────────────────────────────────────
Новые ключи. Сохраните их СЕЙЧАС текстом — второй раз не покажутся,
в базе лежат только отпечатки. И не фотографируйте экран.

    ваш      : $K1
    команде  : $K2

Старые ключи больше не работают, как и выданные по ним пропуска:
всем, кто был внутри, понадобится новый ключ.
INFO
