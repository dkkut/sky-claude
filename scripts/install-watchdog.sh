#!/usr/bin/env bash
# Установка самолечения сервера (запускать от root на самом сервере; откат — --uninstall, состояние — --status).
#   bash scripts/install-watchdog.sh            установить: проверка раз в минуту + защита от нехватки памяти
#   bash scripts/install-watchdog.sh --status
#   bash scripts/install-watchdog.sh --uninstall
# Ставит: /usr/local/sbin/sky-watchdog (systemd-таймер), файл подкачки (если её нет и памяти < 8 ГБ),
# earlyoom (гасит сборки раньше, чем сервер зависнет; базу, Docker, nginx и SSH не трогает),
# sysctl: kernel.panic=10 — после паники ядра сервер сам перезагружается через 10 с, а не висит до звонка хостеру.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Нужен root"; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
case "${1:-}" in
  --status) /usr/local/sbin/sky-watchdog --status; systemctl list-timers sky-watchdog.timer --no-pager 2>/dev/null | head -3; exit 0;;
  --uninstall)
    systemctl disable --now sky-watchdog.timer 2>/dev/null || true
    rm -f /etc/systemd/system/sky-watchdog.{service,timer} /usr/local/sbin/sky-watchdog /etc/sysctl.d/90-sky-recovery.conf
    systemctl daemon-reload; echo "Самолечение снято (swap и earlyoom оставлены: удалить — apt remove earlyoom, swapoff /swapfile)."; exit 0;;
esac
install -m 755 "$SRC/sky-watchdog.sh" /usr/local/sbin/sky-watchdog
[ -f /etc/sky-watchdog.env ] || { printf '# APP_DIR=/opt/sky\n# WATCHDOG_TG_TOKEN=\n# WATCHDOG_TG_CHAT=\n' > /etc/sky-watchdog.env; chmod 600 /etc/sky-watchdog.env; }
cat > /etc/systemd/system/sky-watchdog.service <<'U'
[Unit]
Description=Sky: самолечение сервера
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/sky-watchdog
Nice=10
U
cat > /etc/systemd/system/sky-watchdog.timer <<'U'
[Unit]
Description=Sky: проверка раз в минуту
[Timer]
OnBootSec=90
OnUnitActiveSec=60
AccuracySec=5s
[Install]
WantedBy=timers.target
U
printf 'kernel.panic = 10\nkernel.panic_on_oops = 1\nvm.swappiness = 20\n' > /etc/sysctl.d/90-sky-recovery.conf
sysctl --system >/dev/null 2>&1 || true
# Подкачка: без неё первый же всплеск памяти (сборка, импорт) кладёт сервер.
mem_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo)
if [ "$(swapon --show --noheadings | wc -l)" = 0 ] && [ "$mem_kb" -lt 8000000 ] && [ ! -f /swapfile ]; then
  echo "==> Создаю файл подкачки 2 ГБ"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
if ! command -v earlyoom >/dev/null 2>&1; then echo "==> Ставлю earlyoom"; apt-get install -y earlyoom >/dev/null; fi
if [ -f /etc/default/earlyoom ]; then
  sed -i '/^EARLYOOM_ARGS=/d' /etc/default/earlyoom
  echo "EARLYOOM_ARGS=\"-m 6 -s 10 -r 3600 --prefer '(gradle|java|wine|electron|esbuild|vite)' --avoid '(dockerd|containerd|postgres|redis-server|sshd|nginx|systemd)'\"" >> /etc/default/earlyoom
  systemctl enable --now earlyoom >/dev/null 2>&1 || true; systemctl restart earlyoom 2>/dev/null || true
fi
systemctl daemon-reload; systemctl enable --now sky-watchdog.timer
/usr/local/sbin/sky-watchdog || true
echo "Готово. Состояние: bash $0 --status   Журнал: /var/log/sky-watchdog.log   Оповещения в Telegram: /etc/sky-watchdog.env"
