#!/usr/bin/env bash
# ============================================================
#  Sky Sandbox: установка раннера проверок/публикации как службы systemd.
#
#      sudo bash scripts/install-sandbox.sh --genkey                         # секрет в /opt/sky/.env (API) и /etc/sky-sandbox.env (раннер)
#      sudo bash scripts/install-sandbox.sh --install \
#            --api https://web.example.com --repo https://github.com/org/repo.git [--allow-deploy --prod-src /opt/sky-src]
#      sudo bash scripts/install-sandbox.sh --status | --uninstall
#
#  ВАЖНО: раннер, который ПРОВЕРЯЕТ чужой (ещё не принятый) код, лучше держать на ОТДЕЛЬНОЙ машине — контейнер не равен виртуальной машине.
#  На боевом хосте включайте только `--allow-deploy`-раннер, а проверки гоняйте на другой машине тем же скриптом без этого флага.
#  Скрипт сам ничего не публикует и не трогает рабочие данные.
# ============================================================
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/sky}"
ENVF=/etc/sky-sandbox.env
UNIT=/etc/systemd/system/sky-sandbox.service
SRC="$(cd "$(dirname "$0")/.." && pwd)"
MODE=install; API=""; REPO=""; DEPLOY=0; PROD_SRC=""; WMODE=docker; ALLOW_LOCAL=0
while [ $# -gt 0 ]; do case "$1" in
  --genkey) MODE=genkey;; --install) MODE=install;; --status) MODE=status;; --uninstall) MODE=uninstall;;
  --api) API="$2"; shift;; --repo) REPO="$2"; shift;; --allow-deploy) DEPLOY=1;; --prod-src) PROD_SRC="$2"; shift;; --mode) WMODE="$2"; shift;; --allow-local) ALLOW_LOCAL=1;;
  *) echo "неизвестный параметр: $1"; exit 2;; esac; shift; done
[ "$(id -u)" = 0 ] || { echo "Нужен root (sudo)."; exit 1; }

case "$MODE" in
genkey)
  if [ -f "$APP_DIR/.env" ] && grep -q '^SANDBOX_SECRET=.\{24,\}' "$APP_DIR/.env"; then echo "SANDBOX_SECRET уже задан в $APP_DIR/.env — не меняю."; exit 0; fi
  KEY="$(openssl rand -hex 32)"
  [ -f "$APP_DIR/.env" ] || { echo "Нет $APP_DIR/.env"; exit 1; }
  sed -i '/^SANDBOX_SECRET=/d' "$APP_DIR/.env"; echo "SANDBOX_SECRET=$KEY" >> "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"
  umask 077; printf 'SANDBOX_SECRET=%s\n' "$KEY" > "$ENVF.new"; mv "$ENVF.new" "$ENVF"
  echo "Секрет записан (значение не печатаю). Перезапустите api: bash $SRC/scripts/deploy-local.sh. Для раннера на ДРУГОЙ машине перенесите значение SANDBOX_SECRET безопасным путём.";;
install)
  [ -n "$API" ] && [ -n "$REPO" ] || { echo "Нужны --api и --repo"; exit 2; }
  [ "$WMODE" = docker ] || [ "$WMODE" = local ] || { echo "--mode docker|local"; exit 2; }
  command -v node >/dev/null || { echo "Нужен Node.js ≥ 20"; exit 1; }
  [ "$WMODE" = local ] && [ "$ALLOW_LOCAL" != 1 ] && { echo "Режим local НЕ изолирует проверяемый код: он выполняется на этой машине. Такую проверку нельзя публиковать. Если понимаете — добавьте --allow-local (только на отдельной машине без боевых данных)."; exit 1; }
  [ "$WMODE" = docker ] && { command -v docker >/dev/null || { echo "Режим docker: нужен docker (иначе проверка не будет изолированной)"; exit 1; }; }
  [ -f "$ENVF" ] && grep -q '^SANDBOX_SECRET=' "$ENVF" || { echo "Нет секрета в $ENVF — сначала --genkey или впишите SANDBOX_SECRET."; exit 1; }
  [ "$DEPLOY" = 1 ] && { [ -d "$PROD_SRC/.git" ] || { echo "--allow-deploy требует --prod-src (клон боевого сервера)"; exit 2; }; }
  grep -v -E '^(SANDBOX_API|SANDBOX_REPO|SANDBOX_MODE|SANDBOX_PROD_SRC|SANDBOX_APP_DIR)=' "$ENVF" > "$ENVF.tmp" || true
  { cat "$ENVF.tmp"; echo "SANDBOX_API=$API"; echo "SANDBOX_REPO=$REPO"; echo "SANDBOX_MODE=$WMODE"; echo "SANDBOX_APP_DIR=$APP_DIR"; [ -n "$PROD_SRC" ] && echo "SANDBOX_PROD_SRC=$PROD_SRC"; } > "$ENVF"; rm -f "$ENVF.tmp"; chmod 600 "$ENVF"
  EXTRA=""; [ "$DEPLOY" = 1 ] && EXTRA="--allow-deploy"
  RUNAS=root
  if [ "$DEPLOY" != 1 ]; then   # проверяющий раннер — не от root: чужой код не должен получить права хоста
    id sky-sandbox >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/sky-sandbox --shell /usr/sbin/nologin sky-sandbox
    [ "$WMODE" = docker ] && usermod -aG docker sky-sandbox
    chown -R sky-sandbox:sky-sandbox /var/lib/sky-sandbox; chmod 640 "$ENVF"; chgrp sky-sandbox "$ENVF"; RUNAS=sky-sandbox
  fi
  # Node из nvm лежит в /root или /home: пользователь sky-sandbox туда не зайдёт (systemd: status=203/EXEC) — берём копию в /usr/local/bin.
  NODE_BIN="$(command -v node)"
  case "$NODE_BIN" in /root/*|/home/*) install -m 755 "$NODE_BIN" /usr/local/bin/sky-node; NODE_BIN=/usr/local/bin/sky-node;; esac
  cat > "$UNIT" <<U
[Unit]
Description=Sky Sandbox runner (${WMODE}${EXTRA:+, deploy})
After=network-online.target docker.service
[Service]
EnvironmentFile=$ENVF
User=$RUNAS
WorkingDirectory=$SRC
ExecStart=$NODE_BIN $SRC/sandbox/runner.mjs $EXTRA
Restart=always
RestartSec=20
Nice=10
MemoryMax=${SANDBOX_MEM_MAX:-4G}
[Install]
WantedBy=multi-user.target
U
  systemctl daemon-reload; systemctl enable --now sky-sandbox.service; sleep 2; systemctl --no-pager --lines=5 status sky-sandbox.service || true;;
status) systemctl --no-pager --lines=15 status sky-sandbox.service || true; [ -f "$ENVF" ] && sed 's/\(SECRET=\).*/\1***/' "$ENVF";;
uninstall) systemctl disable --now sky-sandbox.service 2>/dev/null || true; rm -f "$UNIT"; systemctl daemon-reload; echo "Служба убрана; $ENVF оставлен.";;
esac
