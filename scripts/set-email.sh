#!/usr/bin/env bash
# ============================================================
#  Подключение почты. Это главная настройка: коды входа приходят
#  письмом, и пока почта не работает, войти не сможет никто.
#
#      cd /opt/sky && bash scripts/set-email.sh
#
#  Спрашивает данные почтового ящика, отправляет пробное письмо и
#  сохраняет настройку только после того, как вы подтвердите, что
#  письмо дошло. Пароль на экране не появляется.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Здесь нет .env — запускайте из каталога приложения."; exit 1; }

# Читаем ввод с терминала: так работает и при запуске через «bash -s»,
# когда стандартный ввод занят самим скриптом. Если терминала нет
# (запуск из другого скрипта), берём обычный стандартный ввод.
# Проверяем открытием, а не правами: файл /dev/tty может существовать,
# но не открываться — тогда чтение из него оборвало бы скрипт.
if { : </dev/tty; } 2>/dev/null; then INPUT=/dev/tty; else INPUT=/dev/stdin; fi

ask() {        # ask ПЕРЕМЕННАЯ
  read -r "$1" <"$INPUT"
}
ask_secret() { # ask_secret ПЕРЕМЕННАЯ — значение не показывается
  read -rs "$1" <"$INPUT"
  echo
}

set_env() {
  local key="$1" val="$2"
  if grep -q "^$key=" .env; then
    # Значение может содержать что угодно, поэтому подставляем через
    # awk, а не sed: в sed спецсимволы в замене живут своей жизнью.
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="}
      $1==k && !done { print k "=" v; done=1; next } { print }' .env > .env.tmp
    mv .env.tmp .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
  chmod 600 .env
}

echo "Подключение почты для кодов входа."
echo
echo "Данные берутся в панели хостинга (раздел «Почта») или у Gmail:"
echo "  сервер smtp.gmail.com, порт 465, ящик — ваш адрес на gmail.com,"
echo "  пароль — «пароль приложения» из настроек Google (не пароль входа)."
echo

printf 'Адрес сервера (например mail.ваш-домен): '; ask HOST
printf 'Порт [465]: ';                              ask PORT
PORT="${PORT:-465}"
printf 'Ящик, от имени которого шлём (например no-reply@ваш-домен): '; ask USER_
printf 'Пароль от ящика (на экране не появится): ';  ask_secret PASS
# Google показывает пароль приложения группами по четыре: «abcd efgh ijkl
# mnop». Пробелы в него не входят, но копируются вместе с ним.
PASS="$(printf '%s' "$PASS" | tr -d ' ')"
printf 'Куда отправить пробное письмо: ';           ask TO

[ -n "$HOST" ] && [ -n "$USER_" ] && [ -n "$PASS" ] && [ -n "$TO" ] || {
  echo "Не все поля заполнены — ничего не меняю."; exit 1; }

# Знак доллара в файле настроек docker трактует как начало подстановки,
# и пароль доедет искажённым. Проще сменить пароль ящика, чем воевать
# с экранированием.
case "$PASS" in
  *'$'*) echo
         echo "В пароле есть знак «\$». Docker понимает его по-своему,"
         echo "и пароль дойдёт до почтового сервера искажённым."
         echo "Смените пароль ящика на вариант без «\$» и запустите заново."
         exit 1 ;;
esac

# 465 — соединение сразу шифрованное; 587 — шифрование включается
# внутри уже открытого соединения.
SECURE=true; [ "$PORT" = "465" ] || SECURE=false

echo
echo "Отправляю пробное письмо на $TO …"

# Проверяем тем же кодом, которым приложение шлёт коды: если письмо
# дошло, дойдёт и настоящее.
if docker compose exec -T \
     -e EMAIL_MODE=smtp -e SMTP_HOST="$HOST" -e SMTP_PORT="$PORT" \
     -e SMTP_SECURE="$SECURE" -e SMTP_USER="$USER_" -e SMTP_PASS="$PASS" \
     -e EMAIL_FROM="Sky <$USER_>" \
     api node -e "
import('/app/server/notify.mjs').then(async ({ sendEmail }) => {
  const r = await sendEmail(process.argv[1], 'Sky: проверка почты',
    'Если вы видите это письмо, отправка кодов настроена верно.');
  console.log(r.ok ? 'ОТПРАВЛЕНО' : 'ОШИБКА: ' + r.error);
  process.exit(r.ok ? 0 : 1);
});" "$TO" </dev/null
then
  echo
else
  echo
  echo "Письмо отправить не удалось. Проверьте адрес сервера, порт,"
  echo "имя ящика и пароль. Настройку не меняю."
  exit 1
fi

printf 'Письмо пришло? [д/н]: '; ask YES
case "$YES" in
  д|да|y|yes|Д|ДА|Y|YES) ;;
  *) echo "Не сохраняю. Загляните ещё в папку «Спам»."; exit 0 ;;
esac

set_env EMAIL_MODE  'smtp'
set_env SMTP_HOST   "$HOST"
set_env SMTP_PORT   "$PORT"
set_env SMTP_SECURE "$SECURE"
set_env SMTP_USER   "$USER_"
set_env SMTP_PASS   "$PASS"
set_env EMAIL_FROM  "Sky <$USER_>"
unset PASS

echo
echo "==> Перезапускаю приложение"
docker compose up -d api
sleep 8
echo
docker compose logs api --tail 20 | grep -E '\[доставка\]|listening' || true
echo
echo "Готово: коды входа будут приходить письмом."
