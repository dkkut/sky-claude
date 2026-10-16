#!/usr/bin/env bash
# Настройка шлюза входа по SSH: создаёт /etc/sky-ssh-gate.conf (и SSH_GATE_SECRET в .env, если его нет), по желанию ставит шлюз.
#   sudo bash scripts/setup-ssh-gate.sh            # создать конфиг, показать что сделано
#   sudo bash scripts/setup-ssh-gate.sh --install  # то же и сразу поставить шлюз (ssh-gate.sh --install)
# Секрет НЕ печатается. Идемпотентно: существующий секрет в .env не меняется; существующий конфиг перезаписывается резервной копией.
set -euo pipefail
APP="${SKY_APP_DIR:-/opt/sky}"; ENVF="$APP/.env"; CONF="${SKY_GATE_CONF:-/etc/sky-ssh-gate.conf}"
[ "$(id -u)" = 0 ] || { echo "Нужен root (sudo)."; exit 1; }
[ -f "$ENVF" ] || { echo "Нет $ENVF — запускайте на сервере с проектом."; exit 1; }

val() { sed -n "s/^$1=//p" "$ENVF" | tail -1 | tr -d '\r"'"'"; }
SECRET="$(val SSH_GATE_SECRET)"; DOMAIN="$(val DOMAIN)"
NEED_RESTART=0
if [ "${#SECRET}" -lt 24 ]; then
  SECRET="$(openssl rand -hex 24)"
  if grep -q '^SSH_GATE_SECRET=' "$ENVF"; then sed -i "s|^SSH_GATE_SECRET=.*|SSH_GATE_SECRET=$SECRET|" "$ENVF"; else printf '\nSSH_GATE_SECRET=%s\n' "$SECRET" >> "$ENVF"; fi
  chmod 600 "$ENVF"; NEED_RESTART=1
  echo "✔ В .env создан SSH_GATE_SECRET (значение не показываю)."
else
  echo "✔ SSH_GATE_SECRET в .env уже есть."
fi
[ -n "$DOMAIN" ] || { echo "✖ В .env нет DOMAIN — адрес приложения неизвестен. Добавьте DOMAIN=web.… и запустите снова."; exit 1; }

[ -f "$CONF" ] && cp -a "$CONF" "$CONF.bak.$(date +%s)"
umask 077
cat > "$CONF" <<EOF
SKY_API=https://$DOMAIN
SKY_SECRET=$SECRET
SKY_TIMEOUT=300
SKY_FAILOPEN=0
EOF
chmod 600 "$CONF"
echo "✔ Конфиг записан: $CONF (адрес https://$DOMAIN)."

if [ "$NEED_RESTART" = 1 ]; then
  echo "! Секрет новый: перезапустите API, чтобы он его узнал:"
  echo "    cd $APP && docker compose up -d api"
fi
if [ "${1:-}" = "--install" ]; then
  GATE="$(dirname "$(readlink -f "$0")")/ssh-gate.sh"; [ -f "$GATE" ] || GATE="$APP/scripts/ssh-gate.sh"
  bash "$GATE" --install
else
  echo "Дальше: bash $(dirname "$(readlink -f "$0")")/ssh-gate.sh --install   (держите текущую SSH-сессию открытой и проверьте вход во втором терминале)"
fi
