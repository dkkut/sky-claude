#!/usr/bin/env bash
# ============================================================
#  Первичный выпуск TLS-сертификата.
#
#  nginx не стартует без файлов сертификата, а certbot не пройдёт
#  HTTP-проверку без работающего веб-сервера. Разрываем это так:
#  первый сертификат берём в режиме --standalone, когда nginx ещё
#  не поднят и порт 80 свободен. Дальше nginx стартует уже с готовым
#  сертификатом, а продление идёт через webroot работающего nginx
#  (этим занимается контейнер certbot из docker-compose.yml).
#
#  Запускать один раз, из каталога с docker-compose.yml.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Нет файла .env — сначала выполните scripts/bootstrap-server.sh" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env; set +a

: "${DOMAIN:?в .env не задан DOMAIN}"
: "${CERTBOT_EMAIL:?в .env не задан CERTBOT_EMAIL — на него придут письма об истечении сертификата}"

COMPOSE="docker compose"

echo "==> Домен: ${DOMAIN}"

# -- Порт 80 должен быть свободен для проверки ---------------
echo "==> Останавливаю nginx, если он запущен"
$COMPOSE stop web 2>/dev/null || true

# Для поддомена вида web.example.com версия с www не нужна: домена
# www.web.example.com не существует, а certbot проверяет ВСЕ запрошенные
# имена и падает целиком, если хоть одно не подтвердилось.
# Считаем точки: одна — это домен второго уровня, добавляем www.
DOMAIN_ARGS=(-d "${DOMAIN}")
if [[ "${CERTBOT_WWW:-auto}" == "yes" ]] || \
   { [[ "${CERTBOT_WWW:-auto}" == "auto" ]] && [[ "$(tr -cd '.' <<<"$DOMAIN" | wc -c)" -eq 1 ]]; }; then
  DOMAIN_ARGS+=(-d "www.${DOMAIN}")
  echo "==> Сертификат будет включать www.${DOMAIN}"
else
  echo "==> Сертификат только на ${DOMAIN} (www не добавляем)"
fi

STAGING_ARG=""
if [[ "${CERTBOT_STAGING:-0}" != "0" ]]; then
  echo "==> Тестовый режим Let's Encrypt: сертификат будет невалидным,"
  echo "    зато не расходуются лимиты на выпуск (5 штук в неделю на домен)."
  STAGING_ARG="--staging"
fi

# -- Выпуск ---------------------------------------------------
echo "==> Запрашиваю сертификат (режим standalone, порт 80)"
$COMPOSE run --rm -p 80:80 --entrypoint certbot certbot \
  certonly --standalone \
  ${STAGING_ARG} \
  --email "${CERTBOT_EMAIL}" \
  --agree-tos --no-eff-email \
  --non-interactive \
  --keep-until-expiring \
  "${DOMAIN_ARGS[@]}"

# -- Запуск стека ---------------------------------------------
echo "==> Поднимаю стек"
$COMPOSE up -d

echo
echo "==> Готово. Проверьте:  curl -I https://${DOMAIN}/healthz"
echo "    Продление дальше идёт автоматически: контейнер certbot"
echo "    просыпается каждые 12 часов, nginx перечитывает конфиг каждые 6."
