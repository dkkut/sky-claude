#!/bin/sh
# ============================================================
#  Сайт восстановления доступа (RECOVERY_DOMAIN, например recovery.skymessenger.online) — отдельный вхост в том же nginx.
#  Устроен как 06-site-nginx.sh: настоящий сертификат Let's Encrypt, если он есть, иначе временная самоподписанная
#  заглушка, чтобы nginx поднялся. Настоящий сертификат: scripts/add-recovery-cert.sh (после — перезапуск контейнера web).
#  Домен не задан — заглушка recovery.invalid.local, сайт никому не отвечает.
# ============================================================
set -e

DOMAIN="${RECOVERY_DOMAIN:-recovery.invalid.local}"
LE_DIR="/etc/letsencrypt/live/${DOMAIN}"
DUMMY_DIR="/etc/nginx/dummy-cert/${DOMAIN}"

if [ -f "${LE_DIR}/fullchain.pem" ] && [ -f "${LE_DIR}/privkey.pem" ]; then
  CERT_DIR="${LE_DIR}"
  echo "[recovery-nginx] Использую настоящий сертификат: ${CERT_DIR}"
else
  CERT_DIR="${DUMMY_DIR}"
  if [ ! -f "${CERT_DIR}/fullchain.pem" ]; then
    echo "[recovery-nginx] Настоящего сертификата для ${DOMAIN} ещё нет — ставлю временную самоподписанную заглушку."
    mkdir -p "${CERT_DIR}"
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout "${CERT_DIR}/privkey.pem" -out "${CERT_DIR}/fullchain.pem" \
      -subj "/CN=${DOMAIN}" 2>/dev/null
  fi
fi

RECOVERY_DOMAIN="${DOMAIN}" RECOVERY_CERT_DIR="${CERT_DIR}" \
  envsubst '${RECOVERY_DOMAIN} ${RECOVERY_CERT_DIR}' \
  < /etc/nginx/recovery-template/recovery.conf.template \
  > /etc/nginx/conf.d/recovery.conf
