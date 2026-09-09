#!/usr/bin/env bash
# ============================================================
#  Проверка конфигурации nginx до сборки образа.
#
#  Опечатка в конфиге не видна ни tsc, ни vite: она валит веб-контейнер
#  уже на сервере, когда старый контейнер остановлен, а новый не
#  поднимается. Поэтому конфиг прогоняется здесь, ровно так же, как его
#  разворачивает образ: свой nginx.conf, шаблон через envsubst и те
#  init-скрипты, что правят конфигурацию.
# ============================================================
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# nginx -t читает сертификат, поэтому кладём самоподписанный: в образе
# nginx openssl нет, а на машине сборки есть.
mkdir -p "$work/le/live/example.test"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$work/le/live/example.test/privkey.pem" \
  -out    "$work/le/live/example.test/fullchain.pem" \
  -subj /CN=example.test 2>/dev/null
cp "$work/le/live/example.test/fullchain.pem" "$work/le/live/example.test/chain.pem"

cat > "$work/check.sh" <<'INNER'
set -e
rm -f /etc/nginx/conf.d/default.conf
cp /n/nginx.conf /etc/nginx/nginx.conf
mkdir -p /etc/nginx/snippets /etc/nginx/conf.d /var/www/certbot
cp -r /n/snippets/. /etc/nginx/snippets/
envsubst '$DOMAIN' < /n/templates/sky.conf.template > /etc/nginx/conf.d/sky.conf
# Скрипты, правящие конфигурацию. Скрипт периодической перезагрузки
# (99-) не берём: он живёт вечно и проверке не нужен.
for s in /n/docker-entrypoint.d/[0-8]*.sh; do [ -f "$s" ] && sh "$s"; done
nginx -t
INNER

# api:8080 в upstream — nginx -t проверяет и разрешение имени, поэтому
# подставляем заглушку.
docker run --rm --add-host api:127.0.0.1 -e DOMAIN=example.test \
  -v "$root/nginx:/n:ro" \
  -v "$work/le:/etc/letsencrypt:ro" \
  -v "$work/check.sh:/check.sh:ro" \
  nginx:1.27-alpine sh /check.sh
