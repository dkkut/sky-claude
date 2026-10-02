#!/bin/sh
# ============================================================
#  Сторож аварийного выключения (systemd-сервис sky-breach-watch,
#  см. scripts/sky-breach-watch.service). Опрашивает файл-сигнал раз
#  в 15 секунд и, если он есть, а паузы (control/pause) нет — выключает
#  машину. Сигнал пишут две независимые вещи: server/breach.mjs
#  (перебор пароля/TOTP администратора) и scripts/ssh-login-hook.sh
#  (неподтверждённый вход по SSH) — сам сторож не знает и не должен
#  знать, откуда сигнал, это намеренно: процесс API в контейнере без
#  прав root и физически не может выключить хост сам (см. breach.mjs),
#  поэтому выключает всегда этот процесс на хосте, вне Docker.
#
#  НЕ деплоится автоматически из CI — то же соображение, что и у
#  scripts/ssh-login-hook.sh: это код с правами root, запущенный
#  демоном, обновлять его молчаливым git push нельзя. Руками, см.
#  DEPLOY.md, раздел «Аварийное выключение при подозрении на взлом».
# ============================================================
SIGNAL=/opt/sky/control/shutdown-requested
PAUSE=/opt/sky/control/pause
while true; do
  if [ -f "$SIGNAL" ] && [ ! -f "$PAUSE" ]; then
    logger -t sky-breach-watch "Аварийное выключение по сигналу: $(cat "$SIGNAL" | tr '\n' ' ')"
    mv "$SIGNAL" "$SIGNAL.handled-$(date +%s)"
    /sbin/shutdown -h now
    exit 0
  fi
  sleep 15
done
