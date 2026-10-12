#!/usr/bin/env bash
# ============================================================
#  Выпуск TLS-сертификата для второго вхоста — лендинга
#  (SITE_DOMAIN, см. nginx/site-template/site.conf.template).
#
#  В отличие от scripts/init-letsencrypt.sh (первый сертификат Sky,
#  когда nginx ещё не поднят вовсе, --standalone) здесь nginx уже
#  работает — SITE_DOMAIN уже отвечает на самоподписанной
#  заглушке (см. nginx/docker-entrypoint.d/06-site-nginx.sh). Поэтому
#  проверку домена certbot проходит через webroot, не трогая порт 80:
#  сайт продолжает работать всё это время, включая Sky.
#
#  Запускать один раз, из каталога с docker-compose.yml, ПОСЛЕ того как
#  SITE_DOMAIN добавлен в .env и стек уже поднят (docker compose up -d
#  с этим .env хотя бы раз отработал — самоподписанная заглушка на
#  месте, SITE_DOMAIN отвечает, пусть и с предупреждением
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

: "${SITE_DOMAIN:?в .env не задан SITE_DOMAIN}"
: "${CERTBOT_EMAIL:?в .env не задан CERTBOT_EMAIL — на него придут письма об истечении сертификата}"

COMPOSE="docker compose"

echo "==> Домен: ${SITE_DOMAIN}"
echo "==> Проверяю, что SITE_DOMAIN уже отвечает (нужно для webroot-проверки)"
if ! curl -fsS -o /dev/null "http://${SITE_DOMAIN}/healthz"; then
  echo "Сайт не отвечает по HTTP на ${SITE_DOMAIN}/healthz — сначала поднимите стек" >&2
  echo "(docker compose up -d) с SITE_DOMAIN, заданным в .env." >&2
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
  -d "${SITE_DOMAIN}"

echo "==> Сертификат выпущен. Перезапускаю web, чтобы он его подхватил"
echo "    (06-site-nginx.sh перечитывает наличие сертификата только при старте контейнера)."
$COMPOSE up -d --force-recreate web

echo
echo "==> Готово. Проверьте:  curl -I https://${SITE_DOMAIN}/healthz"
echo "    Дальше продление идёт автоматически вместе с сертификатом Sky —"
echo "    тот же контейнер certbot продлевает оба домена."
