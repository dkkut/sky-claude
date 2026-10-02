#!/bin/bash
# ============================================================
#  Хук PAM: срабатывает на каждый успешный вход по SSH (session open).
#
#  НЕ деплоится автоматически из CI (сознательно нет в списке файлов
#  в .github/workflows/deploy.yml) — это скрипт, который выполняется
#  от root при каждом входе по SSH, и автоматическое обновление такого
#  файла при обычном git push стало бы отдельной дырой: кто угодно,
#  кто может запушить в ветку деплоя, получил бы код с правами root на
#  машине. Обновляется только руками, по этой же инструкции — см.
#  DEPLOY.md, раздел «Аварийное выключение при подозрении на взлом».
#
#  Подключение (делается один раз, вручную, от root):
#    install -o root -g root -m 755 scripts/ssh-login-hook.sh /opt/sky/ssh-login-hook.sh
#    echo 'session optional pam_exec.so /opt/sky/ssh-login-hook.sh' \
#      >> /etc/pam.d/sshd
#
#  Считает вход подозрительным, пока владелец не подтвердит по ссылке
#  из письма за 10 минут — иначе сервер выключается тем же сторожем,
#  что и при взломе администраторского аккаунта (server/breach.mjs,
#  scripts/breach-watch.sh + scripts/sky-breach-watch.service).
#
#  Правка (эта версия): раньше КАЖДЫЙ вход безусловно перезаписывал
#  общий файл токена и заводил ещё один независимый 10-минутный
#  таймер — если за эти 10 минут случался ещё один вход (например, та
#  же сессия отладки с несколькими переподключениями), ссылка из более
#  раннего письма переставала совпадать с файлом токена: её клик молча
#  проваливался («ссылка недействительна»), а более ранний таймер всё
#  равно срабатывал и выключал машину — даже если более позднее
#  подключение уже было благополучно подтверждено. Теперь, если уже
#  идёт непогашенное окно подтверждения (токен свежий и ещё не
#  подтверждён), новый вход не начинает цикл заново поверх него, а
#  просто ждёт исход уже идущего — один активный токен и один таймер
#  в любой момент времени, гонки нет.
# ============================================================
[ "${PAM_TYPE:-}" = "open_session" ] || exit 0

APP_DIR=/opt/sky
CONTROL_DIR="$APP_DIR/control"
TOKEN_FILE="$CONTROL_DIR/ssh-confirm-token"
DONE_FILE="$CONTROL_DIR/ssh-login-confirmed"
SIGNAL_FILE="$CONTROL_DIR/shutdown-requested"
PAUSE_FILE="$CONTROL_DIR/pause"
DOMAIN="$(sed -n 's/^DOMAIN=//p' "$APP_DIR/.env" 2>/dev/null | tail -1)"
OWNER_EMAIL="deniskut43332@gmail.com"
CONFIRM_WINDOW_SEC=600
LOG=/var/log/sky-ssh-hook.log

mkdir -p "$CONTROL_DIR"

if [ -f "$TOKEN_FILE" ] && [ ! -f "$DONE_FILE" ]; then
  TOKEN_AGE=$(( $(date +%s) - $(stat -c %Y "$TOKEN_FILE" 2>/dev/null || echo 0) ))
  if [ "$TOKEN_AGE" -lt "$CONFIRM_WINDOW_SEC" ]; then
    echo "$(date -u '+%Y-%m-%d %H:%M:%S') UTC: вход во время уже идущего окна подтверждения — новый цикл не начинаю" >>"$LOG"
    exit 0
  fi
fi

rm -f "$DONE_FILE"
TOKEN="$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
printf '%s' "$TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
LINK="https://${DOMAIN}/ssh-confirm?token=${TOKEN}"
WHEN="$(date -u '+%Y-%m-%d %H:%M:%S')"
WHO="${PAM_USER:-unknown}@${PAM_RHOST:-unknown}"

# Письмо-уведомление. Текст письма — в файле без переменных внутри
# JS-строки (шлётся через process.env), поэтому его можно положить на
# общий с контейнером том (control/) без какой-либо подстановки
# значений в сам JS — меньше экранирования, меньше риска сломать
# скрипт случайным символом в адресе/домене.
NOTIFY_JS="$CONTROL_DIR/.ssh-notify.mjs"
cat > "$NOTIFY_JS" <<'JS'
import('/app/server/notify.mjs').then(({ sendEmail }) => sendEmail(
  process.env.TO, 'Sky: вход по SSH — подтвердите, что это вы',
  'Зафиксирован успешный вход по SSH: ' + process.env.WHO + ', ' + process.env.WHEN + ' UTC.\n\n' +
  'Если это вы — подтвердите за 10 минут: ' + process.env.LINK + '\n\n' +
  'Если нет — ничего не делайте: через 10 минут сервер выключится сам.'
));
JS

setsid bash -c "
  cd '$APP_DIR' &&
  docker compose exec -T -e TO='$OWNER_EMAIL' -e LINK='$LINK' -e WHO='$WHO' -e WHEN='$WHEN' \
    api node /control/.ssh-notify.mjs
  rm -f '$NOTIFY_JS'
" </dev/null >>"$LOG" 2>&1 &
disown

setsid bash -c "
  sleep $CONFIRM_WINDOW_SEC
  [ -f '$DONE_FILE' ] && exit 0
  [ -f '$PAUSE_FILE' ] && exit 0
  mkdir -p '$CONTROL_DIR'
  printf '%s UTC\nВход по SSH (%s) не подтверждён за 10 минут\n' '$WHEN' '$WHO' > '$SIGNAL_FILE'
" </dev/null >>"$LOG" 2>&1 &
disown

exit 0
