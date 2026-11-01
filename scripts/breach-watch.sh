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
#  ОПОВЕЩЕНИЯ (тем же способом, что у sky-watchdog: /etc/sky-watchdog.env —
#  WATCHDOG_EMAIL_TO, WATCHDOG_TG_TOKEN + WATCHDOG_TG_CHAT, WATCHDOG_URL):
#   • перед выключением — «сервер выключается, причина …»;
#   • сигнал получен, но стоит пауза — один раз, «выключения не будет, пока пауза»;
#   • после включения машины — «сервер снова включён после аварийного выключения».
#  Всё пишется и в журнал хоста: journalctl -t sky-breach-watch.
#
#  НЕ деплоится автоматически из CI — то же соображение, что и у
#  scripts/ssh-login-hook.sh: это код с правами root, запущенный
#  демоном, обновлять его молчаливым git push нельзя. Руками, см.
#  DEPLOY.md, раздел «Аварийное выключение при подозрении на взлом»:
#    install -m 755 scripts/breach-watch.sh /opt/sky/breach-watch.sh && systemctl restart sky-breach-watch
# ============================================================
[ -f /etc/sky-watchdog.env ] && . /etc/sky-watchdog.env
APP_DIR="${APP_DIR:-/opt/sky}"
SIGNAL="$APP_DIR/control/shutdown-requested"
PAUSE="$APP_DIR/control/pause"
LAST="$APP_DIR/control/last-shutdown-reason"
SEEN="$APP_DIR/control/pause-notified"

say() { logger -t sky-breach-watch "$*"; }

# Оповещение: Telegram, письмо (тем же отправщиком, что и коды входа, одноразовый контейнер), произвольный URL.
notify() {
  msg="Sky @ $(hostname): $*"
  say "$*"
  if [ -n "${WATCHDOG_TG_TOKEN:-}" ] && [ -n "${WATCHDOG_TG_CHAT:-}" ]; then
    curl -fsS -m 10 "https://api.telegram.org/bot${WATCHDOG_TG_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${WATCHDOG_TG_CHAT}" --data-urlencode "text=${msg}" >/dev/null 2>&1 || true
  fi
  if [ -n "${WATCHDOG_EMAIL_TO:-}" ] && command -v docker >/dev/null 2>&1 && [ -f "$APP_DIR/docker-compose.yml" ]; then
    ( cd "$APP_DIR" && timeout 40 docker compose run --rm --no-deps -T api \
        node scripts/notify-mail.mjs "$WATCHDOG_EMAIL_TO" "Sky: сервер $(hostname)" "$msg" ) >/dev/null 2>&1 \
      || say "письмо не отправлено"
  fi
  [ -n "${WATCHDOG_URL:-}" ] && curl -fsS -m 10 -X POST --data-urlencode "text=${msg}" "$WATCHDOG_URL" >/dev/null 2>&1 || true
}

# После включения: если перед этим было аварийное выключение — сообщить, причина в файле.
if [ -f "$LAST" ]; then
  for i in 1 2 3 4 5 6 7 8; do command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && break; sleep 15; done
  notify "сервер снова включён после аварийного выключения. Причина: $(tr '\n' ' ' < "$LAST"). Проверьте журнал безопасности и вход по SSH."
  rm -f "$LAST"
fi

while true; do
  if [ -f "$SIGNAL" ]; then
    if [ -f "$PAUSE" ]; then
      # Пауза: не выключаем, но говорим об этом один раз на каждый сигнал.
      mt="$(stat -c %Y "$SIGNAL" 2>/dev/null)"
      if [ "$(cat "$SEEN" 2>/dev/null)" != "$mt" ]; then
        echo "$mt" > "$SEEN"
        notify "получен сигнал аварийного выключения ($(tr '\n' ' ' < "$SIGNAL")), но включена пауза ($PAUSE) — выключения НЕ будет. Снимете паузу — выключение произойдёт."
      fi
    else
      reason="$(tr '\n' ' ' < "$SIGNAL")"
      printf '%s\n' "$reason" > "$LAST"
      say "Аварийное выключение по сигналу: $reason"
      mv "$SIGNAL" "$SIGNAL.handled-$(date +%s)"
      notify "СЕРВЕР ВЫКЛЮЧАЕТСЯ прямо сейчас (аварийное выключение). Причина: $reason. Включить можно только в панели хостера."
      sync
      /sbin/shutdown -h now
      exit 0
    fi
  fi
  sleep 15
done
