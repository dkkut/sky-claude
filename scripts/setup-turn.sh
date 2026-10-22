#!/usr/bin/env bash
# ============================================================
#  TURN-сервер (coturn) для звонков, трансляций и голосовых комнат Sky.
#
#      bash scripts/setup-turn.sh [--host turn.example.com] [--check] [--uninstall]
#
#  Зачем: без TURN соединение «человек ↔ человек» не устанавливается при симметричном NAT и в большинстве мобильных
#  сетей — звонки и трансляции «не подключаются». Скрипт ставит coturn на ЭТУ машину, пишет конфиг с временными учётными данными
#  (REST-схема, общий секрет), открывает порты в ufw (если он есть) и вписывает TURN_URLS / TURN_SECRET в .env приложения.
#  Идемпотентен: повторный запуск секрет не меняет. Секрет на экран не печатается.
#
#  Порты: 3478 UDP+TCP (TURN) и диапазон 49160–49200 UDP (релей). У хостера они тоже должны быть открыты во внешнем файрволе.
#  Дальше: `docker compose up -d api` (или deploy-local.sh) — клиенты заберут настройки через /api/rtc/config.
#  Не проверено на боевом сервере (в среде разработки нет apt/systemd).
# ============================================================
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/sky}"
ENVF="$APP_DIR/.env"
CONF=/etc/turnserver.conf
HOST=""; MODE=install
while [ $# -gt 0 ]; do case "$1" in
  --host) HOST="$2"; shift 2;; --check) MODE=check; shift;; --uninstall) MODE=uninstall; shift;; *) echo "Неизвестный параметр: $1"; exit 1;; esac; done
[ "$(id -u)" = 0 ] || { echo "Нужен root."; exit 1; }
getenvv() { grep -E "^$1=" "$ENVF" 2>/dev/null | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
setenvv() { local k="$1" v="$2"; if grep -q "^$k=" "$ENVF"; then sed -i "s|^$k=.*|$k=$v|" "$ENVF"; else printf '%s=%s\n' "$k" "$v" >> "$ENVF"; fi; chmod 600 "$ENVF"; }

case "$MODE" in
check)
  echo "== coturn =="; systemctl is-active coturn 2>/dev/null || echo "не запущен"
  echo "== слушает =="; ss -lun 2>/dev/null | grep -E ':3478\b' || echo "UDP 3478 не слушается"; ss -ltn 2>/dev/null | grep -E ':3478\b' || echo "TCP 3478 не слушается"
  echo "== .env =="; for k in TURN_URLS TURN_SECRET; do if [ -n "$(getenvv $k)" ]; then echo "  ✓ $k задан"; else echo "  ✗ $k пуст"; fi; done
  echo "Снаружи проверьте: UDP/TCP 3478 и UDP 49160–49200 открыты у хостера."; exit 0 ;;
uninstall)
  systemctl disable --now coturn 2>/dev/null || true; apt-get remove -y coturn >/dev/null 2>&1 || true
  [ -f "$ENVF" ] && sed -i '/^TURN_URLS=/d;/^TURN_SECRET=/d' "$ENVF"
  echo "coturn удалён, TURN_* убраны из .env (перезапустите api). Клиенты вернутся к публичному STUN."; exit 0 ;;
esac

[ -f "$ENVF" ] || { echo "Нет $ENVF — задайте APP_DIR."; exit 1; }
[ -n "$HOST" ] || HOST="$(getenvv DOMAIN)"
[ -n "$HOST" ] || { echo "Не знаю адрес: передайте --host <домен или IP> (DOMAIN в .env пуст)."; exit 1; }
EXTERNAL_IP="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"

echo "==> Ставлю coturn"
export DEBIAN_FRONTEND=noninteractive
command -v turnserver >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq coturn >/dev/null; }

SECRET="$(getenvv TURN_SECRET)"
[ -n "$SECRET" ] || SECRET="$(openssl rand -hex 32)"

echo "==> Пишу конфиг $CONF"
[ -f "$CONF" ] && [ ! -f "$CONF.sky-orig" ] && cp "$CONF" "$CONF.sky-orig"
cat > "$CONF" <<CFG
# Управляется scripts/setup-turn.sh — правки вручную при повторном запуске теряются.
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=$SECRET
realm=$HOST
server-name=$HOST
${EXTERNAL_IP:+external-ip=$EXTERNAL_IP}
min-port=49160
max-port=49200
no-multicast-peers
no-cli
no-tls
no-dtls
# Релей не должен доставать внутренние адреса сервера и сети хостера (SSRF/доступ к базе):
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
total-quota=200
bps-capacity=0
log-file=/var/log/turnserver.log
simple-log
CFG
chmod 640 "$CONF"; chown root:turnserver "$CONF" 2>/dev/null || true
if [ -f /etc/default/coturn ]; then sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn; fi

echo "==> Запускаю"
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 2; systemctl is-active --quiet coturn || { echo "coturn не стартовал: journalctl -u coturn -n 30"; exit 1; }

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  echo "==> Открываю порты в ufw"
  ufw allow 3478/udp >/dev/null; ufw allow 3478/tcp >/dev/null; ufw allow 49160:49200/udp >/dev/null
fi

setenvv TURN_SECRET "$SECRET"
setenvv TURN_URLS "turn:$HOST:3478?transport=udp,turn:$HOST:3478?transport=tcp"
echo
echo "Готово: coturn работает, в $ENVF записаны TURN_URLS и TURN_SECRET (секрет не показан)."
echo "Дальше:  cd $APP_DIR && docker compose up -d api   — и проверка:  bash $0 --check"
echo "У хостера откройте UDP/TCP 3478 и UDP 49160–49200. Проверка из браузера: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/ (добавьте turn:$HOST:3478 с временным логином — или просто позвоните через мобильную сеть)."
