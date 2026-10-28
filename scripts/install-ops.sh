#!/usr/bin/env bash
# ============================================================
#  Sky Ops: агент на хосте — выполняет задания из админки (вкладка «Сервер»): «Починить всё», деплой, сборка приложений, диагностика.
#
#      sudo bash scripts/install-ops.sh --genkey                  # секрет OPS_SECRET в /opt/sky/.env (API) и /etc/sky-ops.env (агент)
#      sudo bash scripts/deploy-local.sh                          # перезапуск api, чтобы он увидел секрет
#      sudo bash scripts/install-ops.sh --install [--api https://web.example.com] [--src /opt/sky-src]
#      sudo bash scripts/install-ops.sh --status | --uninstall
#
#  Агент — служба systemd от root (ему нужны docker и systemctl). Он принимает только ЗАКРЫТЫЙ список заданий (server/opscmds.mjs),
#  каждое подписано секретом; произвольных команд не выполняет. Секрет живёт только в .env сервера и в /etc/sky-ops.env (права 600).
#  Журнал агента — /var/log/sky-ops.log. Права в панели: server_ops (в «полные права» не входит; у владельца есть), изменяющие задания — с кодом.
# ============================================================
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/sky}"
ENVF=/etc/sky-ops.env
UNIT=/etc/systemd/system/sky-ops.service
SRC="$(cd "$(dirname "$0")/.." && pwd)"
MODE=install; API=""
while [ $# -gt 0 ]; do case "$1" in
  --genkey) MODE=genkey;; --install) MODE=install;; --status) MODE=status;; --uninstall) MODE=uninstall;;
  --api) API="$2"; shift;; --src) SRC="$2"; shift;;
  *) echo "неизвестный параметр: $1"; exit 2;; esac; shift; done
[ "$(id -u)" = 0 ] || { echo "Нужен root (sudo)."; exit 1; }

case "$MODE" in
genkey)
  [ -f "$APP_DIR/.env" ] || { echo "Нет $APP_DIR/.env"; exit 1; }
  if grep -q '^OPS_SECRET=.\{24,\}' "$APP_DIR/.env"; then
    KEY="$(grep '^OPS_SECRET=' "$APP_DIR/.env" | head -1 | cut -d= -f2-)"; echo "OPS_SECRET уже задан в $APP_DIR/.env — не меняю."
  else
    KEY="$(openssl rand -hex 32)"
    sed -i '/^OPS_SECRET=/d' "$APP_DIR/.env"; echo "OPS_SECRET=$KEY" >> "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"
  fi
  umask 077; { grep -v '^OPS_SECRET=' "$ENVF" 2>/dev/null || true; echo "OPS_SECRET=$KEY"; } > "$ENVF.new"; mv "$ENVF.new" "$ENVF"
  echo "Секрет записан (значение не печатаю). Дальше: bash $SRC/scripts/deploy-local.sh (api должен подхватить OPS_SECRET), затем --install.";;
install)
  command -v node >/dev/null || { echo "Нужен Node.js ≥ 18 на хосте"; exit 1; }
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || { echo "Нужен Node.js ≥ 18"; exit 1; }
  [ -f "$ENVF" ] && grep -q '^OPS_SECRET=' "$ENVF" || { echo "Нет секрета в $ENVF — сначала --genkey."; exit 1; }
  [ -f "$SRC/ops/agent.mjs" ] || { echo "Нет $SRC/ops/agent.mjs — укажите --src (клон репозитория)."; exit 1; }
  [ -d "$APP_DIR" ] || { echo "Нет каталога $APP_DIR"; exit 1; }
  if [ -z "$API" ]; then
    DOM="$(grep '^DOMAIN=' "$APP_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
    [ -n "$DOM" ] || { echo "Не нашёл DOMAIN в $APP_DIR/.env — задайте --api https://адрес-приложения"; exit 1; }
    API="https://$DOM"
  fi
  case "$API" in https://*) ;; *) echo "--api: только https:// (секрет подписывает запросы, но тело и ответы не должны идти открыто)"; exit 2;; esac
  grep -v -E '^(OPS_API|OPS_APP_DIR|OPS_SRC_DIR)=' "$ENVF" > "$ENVF.tmp" || true
  { cat "$ENVF.tmp"; echo "OPS_API=$API"; echo "OPS_APP_DIR=$APP_DIR"; echo "OPS_SRC_DIR=$SRC"; } > "$ENVF"; rm -f "$ENVF.tmp"; chmod 600 "$ENVF"
  NODE_BIN="$(command -v node)"
  touch /var/log/sky-ops.log; chmod 600 /var/log/sky-ops.log
  cat > "$UNIT" <<U
[Unit]
Description=Sky Ops agent (задания из админки: починка, деплой, сборка)
After=network-online.target docker.service
[Service]
EnvironmentFile=$ENVF
User=root
WorkingDirectory=$SRC
ExecStart=$NODE_BIN $SRC/ops/agent.mjs
Restart=always
RestartSec=10
Nice=5
StandardOutput=append:/var/log/sky-ops.log
StandardError=append:/var/log/sky-ops.log
# Деплой и сборка запускают собственные процессы — их не должен убивать сам systemd при перезапуске агента.
KillMode=process
[Install]
WantedBy=multi-user.target
U
  systemctl daemon-reload; systemctl enable --now sky-ops.service; sleep 3; systemctl --no-pager --lines=8 status sky-ops.service || true
  echo; echo "Готово. Откройте админку → «Сервер»: агент должен показаться «на связи» в течение минуты."
  echo "Права: у владельца есть всегда; другим выдаётся роль «Sky Ops: сервер, деплой и сборка приложений» (ops_admin).";;
status) systemctl --no-pager --lines=15 status sky-ops.service || true; [ -f "$ENVF" ] && sed 's/\(SECRET=\).*/\1***/' "$ENVF"; tail -n 15 /var/log/sky-ops.log 2>/dev/null || true;;
uninstall) systemctl disable --now sky-ops.service 2>/dev/null || true; rm -f "$UNIT"; systemctl daemon-reload; echo "Служба убрана; $ENVF и OPS_SECRET в .env оставлены.";;
esac
