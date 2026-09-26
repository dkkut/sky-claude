#!/bin/sh
# ============================================================
#  Разворачивает market-template/market.conf.template в
#  /etc/nginx/conf.d/market.conf — вручную, не через штатный
#  envsubst-on-templates образа (тот смотрит только в
#  /etc/nginx/templates, где лежит один sky.conf.template).
#
#  Зачем отдельно: сертификат KutRent Market лежит в общем томе
#  certbot-certs, который у контейнера web смонтирован read-only —
#  сам себе сертификат он туда не запишет, и до первого успешного
#  scripts/add-market-cert.sh настоящего сертификата там нет вовсе.
#  Без сертификата server{... listen 443 ssl ...} не даст nginx
#  стартовать вообще — свалится и весь остальной Sky, которому
#  market.kutrent.online отношения не имеет.
#
#  Поэтому: если настоящий сертификат уже есть в /etc/letsencrypt —
#  используем его. Если нет — генерируем самоподписанную заглушку в
#  собственном, локальном для контейнера каталоге (не в томе, значит,
#  писать можно) — просто чтобы nginx поднялся и обслуживал Sky как ни
#  в чём не бывало; сайт партнёра при этом будет отвечать с
#  предупреждением браузера о сертификате, пока не появится настоящий.
#
#  Настоящий сертификат появляется — конфиг подхватит его при
#  следующем перезапуске контейнера web (не reload: emphasized в шапке
#  market.conf.template — этот скрипт запускается только на старте).
# ============================================================
set -e

DOMAIN="${MARKET_DOMAIN:-market.invalid.local}"
LE_DIR="/etc/letsencrypt/live/${DOMAIN}"
DUMMY_DIR="/etc/nginx/dummy-cert/${DOMAIN}"

if [ -f "${LE_DIR}/fullchain.pem" ] && [ -f "${LE_DIR}/privkey.pem" ]; then
  CERT_DIR="${LE_DIR}"
  echo "[market-nginx] Использую настоящий сертификат: ${CERT_DIR}"
else
  CERT_DIR="${DUMMY_DIR}"
  if [ ! -f "${CERT_DIR}/fullchain.pem" ]; then
    echo "[market-nginx] Настоящего сертификата для ${DOMAIN} ещё нет — ставлю временную самоподписанную заглушку."
    mkdir -p "${CERT_DIR}"
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout "${CERT_DIR}/privkey.pem" -out "${CERT_DIR}/fullchain.pem" \
      -subj "/CN=${DOMAIN}" 2>/dev/null
  fi
fi

MARKET_DOMAIN="${DOMAIN}" MARKET_CERT_DIR="${CERT_DIR}" \
  envsubst '${MARKET_DOMAIN} ${MARKET_CERT_DIR}' \
  < /etc/nginx/market-template/market.conf.template \
  > /etc/nginx/conf.d/market.conf
