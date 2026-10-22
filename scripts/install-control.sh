#!/usr/bin/env bash
# Установка Sky Control — страницы восстановления на хосте (вне Docker). См. control/sky-control.mjs и DEPLOY.md.
#   sudo bash scripts/install-control.sh [--install] [--port 8099] [--bind 127.0.0.1] [--allow IP,IP] [--tls-cert f --tls-key f]
#   sudo bash scripts/install-control.sh --status | --uninstall
# Нужен Node.js >= 18 на ХОСТЕ. Токен владельца и секрет аутентификатора показываются ОДИН раз.
set -euo pipefail
MODE=install; PORT=8099; BIND=127.0.0.1; ALLOW=""; CERT=""; KEY=""; APP_DIR="${APP_DIR:-/opt/sky}"
while [ $# -gt 0 ]; do case "$1" in
  --install) MODE=install; shift;; --status) MODE=status; shift;; --uninstall) MODE=uninstall; shift;;
  --port) PORT="$2"; shift 2;; --bind) BIND="$2"; shift 2;; --allow) ALLOW="$2"; shift 2;; --tls-cert) CERT="$2"; shift 2;; --tls-key) KEY="$2"; shift 2;;
  *) echo "Неизвестный параметр $1" >&2; exit 2;; esac; done
[ "$(id -u)" = 0 ] || { echo "Нужен root (sudo)." >&2; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"; LIB=/usr/local/lib/sky-control; BIN=/usr/local/sbin/sky-control; ENVF=/etc/sky-control.env
case "$MODE" in
status) systemctl is-active sky-control || true; [ -f "$ENVF" ] && grep -v SECRET "$ENVF"; tail -n 8 /var/log/sky-control.log 2>/dev/null || true; exit 0;;
uninstall) systemctl disable --now sky-control 2>/dev/null || true; rm -f /etc/systemd/system/sky-control.service "$BIN"; rm -rf "$LIB"; systemctl daemon-reload
  echo "Снят. Токен и секрет остались в /etc/sky-control (удалите вручную, если не нужны); /etc/sky-ssh-gate.off убрать, если окно было открыто."; exit 0;;
esac
command -v node >/dev/null || { echo "На хосте нет Node.js. Поставьте (apt install nodejs) — сервис работает вне Docker, чтобы жить при упавшем api." >&2; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || { echo "Нужен Node.js >= 18." >&2; exit 1; }
[ -n "$CERT$KEY" ] && { [ -f "$CERT" ] && [ -f "$KEY" ] || { echo "Сертификат или ключ не найдены." >&2; exit 1; }; }
if [ "$BIND" != 127.0.0.1 ] && [ -z "$CERT" ]; then echo "ВНИМАНИЕ: без TLS открывать наружу нельзя (токен пойдёт открытым текстом). Используйте --tls-cert/--tls-key или оставьте 127.0.0.1 и заходите через SSH-туннель." >&2; exit 1; fi
install -d -m 755 "$LIB"; install -m 755 "$SRC/control/sky-control.mjs" "$LIB/sky-control.mjs"; install -m 644 "$SRC/control/totp.mjs" "$LIB/totp.mjs"
printf '#!/bin/sh\nset -a; [ -f %s ] && . %s; set +a\nexec node %s/sky-control.mjs "$@"\n' "$ENVF" "$ENVF" "$LIB" > "$BIN"; chmod 755 "$BIN"
umask 077
{ echo "APP_DIR=$APP_DIR"; echo "CONTROL_PORT=$PORT"; echo "CONTROL_BIND=$BIND"; [ -n "$ALLOW" ] && echo "CONTROL_ALLOW_IPS=$ALLOW"; [ -n "$CERT" ] && { echo "CONTROL_TLS_CERT=$CERT"; echo "CONTROL_TLS_KEY=$KEY"; }; } > "$ENVF"; chmod 600 "$ENVF"
if [ ! -s /etc/sky-control/token.sha256 ]; then "$BIN" --setup; else echo "Токен уже выдан раньше (новый: sky-control --new-token)."; fi
cat > /etc/systemd/system/sky-control.service <<U
[Unit]
Description=Sky Control (host recovery page)
After=network.target docker.service
[Service]
EnvironmentFile=$ENVF
ExecStart=/usr/bin/env node $LIB/sky-control.mjs --serve
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
[Install]
WantedBy=multi-user.target
U
systemctl daemon-reload; systemctl enable --now sky-control; sleep 1; systemctl is-active sky-control
echo "Страница: http$([ -n "$CERT" ] && echo s)://$BIND:$PORT  (удалённо — ssh -L $PORT:127.0.0.1:$PORT <сервер>, если без TLS)"
echo "Для аварийного пользователя обновите: bash scripts/rescue-access.sh --install (добавит команды defense-off, unlock, gate-pause, ssh-start, control-token…)."
