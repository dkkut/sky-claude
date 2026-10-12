#!/bin/sh
# ============================================================
#  Лендинг на корневом домене (SITE_DOMAIN, например skymessenger.online) — отдельный вхост в том же nginx.
#  Приложение Sky живёт на DOMAIN (web.skymessenger.online) и не затрагивается.
#  Устроен точно как 05-market-nginx.sh: настоящий сертификат Let's Encrypt, если он уже есть, иначе временная
#  самоподписанная заглушка, чтобы nginx поднялся и остальной Sky работал (подробности — в шапке 05-market-nginx.sh).
#  Настоящий сертификат: scripts/add-site-cert.sh; конфиг подхватит его при следующем перезапуске контейнера web.
# ============================================================
set -e

# Домен приложения (DOMAIN из окружения) — запоминаем до того, как имя DOMAIN займёт домен лендинга ниже.
APP_DOMAIN="${DOMAIN:-}"
DOMAIN="${SITE_DOMAIN:-site.invalid.local}"
LE_DIR="/etc/letsencrypt/live/${DOMAIN}"
DUMMY_DIR="/etc/nginx/dummy-cert/${DOMAIN}"

if [ -f "${LE_DIR}/fullchain.pem" ] && [ -f "${LE_DIR}/privkey.pem" ]; then
  CERT_DIR="${LE_DIR}"
  echo "[site-nginx] Использую настоящий сертификат: ${CERT_DIR}"
else
  CERT_DIR="${DUMMY_DIR}"
  if [ ! -f "${CERT_DIR}/fullchain.pem" ]; then
    echo "[site-nginx] Настоящего сертификата для ${DOMAIN} ещё нет — ставлю временную самоподписанную заглушку."
    mkdir -p "${CERT_DIR}"
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout "${CERT_DIR}/privkey.pem" -out "${CERT_DIR}/fullchain.pem" \
      -subj "/CN=${DOMAIN}" 2>/dev/null
  fi
fi

# Если домен приложения не задан или совпадает с лендингом, перенаправлять некуда — ссылки остаются на месте.
[ -n "${APP_DOMAIN}" ] && [ "${APP_DOMAIN}" != "${DOMAIN}" ] || APP_DOMAIN="${DOMAIN}"

SITE_DOMAIN="${DOMAIN}" SITE_CERT_DIR="${CERT_DIR}" APP_DOMAIN="${APP_DOMAIN}" \
  envsubst '${SITE_DOMAIN} ${SITE_CERT_DIR} ${APP_DOMAIN}' \
  < /etc/nginx/site-template/site.conf.template \
  > /etc/nginx/conf.d/site.conf
