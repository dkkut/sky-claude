#!/usr/bin/env bash
# ============================================================
#  Выпуск TLS-сертификата для второго вхоста — KutRent Market
#  (market.kutrent.online, см. nginx/market-template/market.conf.template).
#
#  В отличие от scripts/init-letsencrypt.sh (первый сертификат Sky,
#  когда nginx ещё не поднят вовсе, --standalone) здесь nginx уже
#  работает — market.kutrent.online уже отвечает на самоподписанной
#  заглушке (см. nginx/docker-entrypoint.d/05-market-nginx.sh). Поэтому
#  проверку домена certbot проходит через webroot, не трогая порт 80:
#  сайт продолжает работать всё это время, включая Sky.
#
#  Запускать один раз, из каталога с docker-compose.yml, ПОСЛЕ того как
#  MARKET_DOMAIN добавлен в .env и стек уже поднят (docker compose up -d
#  с этим .env хотя бы раз отработал — самоподписанная заглушка на
#  месте, market.kutrent.online отвечает, пусть и с предупреждением
#  браузера о сертификате).
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Нет файла .env — сначала выполните scripts/bootstrap-server.sh" >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env; set +a

: "${MARKET_DOMAIN:?в .env не задан MARKET_DOMAIN}"
: "${CERTBOT_EMAIL:?в .env не задан CERTBOT_EMAIL — на него придут письма об истечении сертификата}"

COMPOSE="docker compose"

echo "==> Домен: ${MARKET_DOMAIN}"
echo "==> Проверяю, что market.kutrent.online уже отвечает (нужно для webroot-проверки)"
if ! curl -fsS -o /dev/null "http://${MARKET_DOMAIN}/healthz"; then
  echo "Сайт не отвечает по HTTP на ${MARKET_DOMAIN}/healthz — сначала поднимите стек" >&2
  echo "(docker compose up -d) с MARKET_DOMAIN, заданным в .env." >&2
  exit 1
fi

STAGING_ARG=""
if [[ "${CERTBOT_STAGING:-0}" != "0" ]]; then
  echo "==> Тестовый режим Let's Encrypt: сертификат будет невалидным,"
  echo "    зато не расходуются лимиты на выпуск (5 штук в неделю на домен)."
  STAGING_ARG="--staging"
fi

echo "==> Запрашиваю сертификат (режим webroot — nginx продолжает работать)"
$COMPOSE run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  ${STAGING_ARG} \
  --email "${CERTBOT_EMAIL}" \
  --agree-tos --no-eff-email \
  --non-interactive \
  --keep-until-expiring \
  -d "${MARKET_DOMAIN}"

echo "==> Сертификат выпущен. Перезапускаю web, чтобы он его подхватил"
echo "    (05-market-nginx.sh перечитывает наличие сертификата только при старте контейнера)."
$COMPOSE up -d --force-recreate web

echo
echo "==> Готово. Проверьте:  curl -I https://${MARKET_DOMAIN}/healthz"
echo "    Дальше продление идёт автоматически вместе с сертификатом Sky —"
echo "    тот же контейнер certbot продлевает оба домена."
