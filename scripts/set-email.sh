#!/usr/bin/env bash
# ============================================================
#  Подключение почты. Это главная настройка: коды входа приходят
#  письмом, и пока почта не работает, войти не сможет никто.
#
#      cd /opt/sky && bash scripts/set-email.sh
#
#  Два пути на выбор:
#
#    Resend — письма уходят через обычный HTTPS. Годится там, где
#      хостинг закрыл почтовые порты, а это почти везде: с серверов
#      рассылают спам, и провайдеры их глушат.
#
#    SMTP — обычный почтовый ящик. Проще, но требует открытого
#      порта 465 или 587 наружу.
#
#  В обоих случаях скрипт отправляет пробное письмо тем же кодом,
#  которым приложение шлёт коды, и сохраняет настройку только после
#  того, как вы подтвердите, что письмо дошло.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Здесь нет .env — запускайте из каталога приложения."; exit 1; }

# Читаем ввод с терминала: так работает и при запуске через «bash -s»,
# когда стандартный ввод занят самим скриптом. Проверяем открытием, а не
# правами: файл может существовать, но не открываться.
if { : </dev/tty; } 2>/dev/null; then INPUT=/dev/tty; else INPUT=/dev/stdin; fi
ask()        { read -r  "$1" <"$INPUT"; }
ask_secret() { read -rs "$1" <"$INPUT"; echo; }

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

value_of() { sed -n "s|^$1=||p" .env | tail -1; }

# Пробная отправка тем же кодом, которым шлёт приложение. Переменные
# передаём разово, в файл ещё ничего не записано.
try_send() {   # try_send <адрес> <перем=знач> ...
  local to="$1"; shift
  local envs=()
  for kv in "$@"; do envs+=(-e "$kv"); done
  docker compose exec -T "${envs[@]}" api node -e "
import('/app/server/notify.mjs').then(async ({ sendEmail }) => {
  const r = await sendEmail(process.argv[1], 'Sky: проверка почты',
    'Если вы видите это письмо, отправка кодов настроена верно.');
  console.log(r.ok ? 'ОТПРАВЛЕНО' : 'ОШИБКА: ' + r.error);
  process.exit(r.ok ? 0 : 1);
});" "$to" </dev/null
}

confirm_and_save() {  # confirm_and_save <перем=знач> ...
  echo
  printf 'Письмо пришло? [д/н]: '; ask YES
  case "$YES" in
    д|да|y|yes|Д|ДА|Y|YES) ;;
    *) echo "Не сохраняю. Загляните ещё в папку «Спам»."; exit 0 ;;
  esac
  for kv in "$@"; do set_env "${kv%%=*}" "${kv#*=}"; done
  echo
  echo "==> Перезапускаю приложение"
  docker compose up -d api
  sleep 8
  echo
  docker compose logs api --tail 20 | grep -E '\[доставка\]|listening' || true
  echo
  echo "Готово: коды входа будут приходить письмом."
}

echo "Подключение почты для кодов входа."
echo
echo "  1 — сервис Resend (через HTTPS; работает, даже если хостинг"
echo "      закрыл почтовые порты)"
echo "  2 — обычный почтовый ящик (SMTP, порт 465 или 587)"
echo
printf 'Что выбираете? [1]: '; ask WAY
WAY="${WAY:-1}"

if [ "$WAY" = "2" ]; then
  # ── Обычный ящик ─────────────────────────────────────────
  echo
  echo "Данные берутся в панели хостинга (раздел «Почта») или у Gmail:"
  echo "  сервер smtp.gmail.com, порт 465, ящик — ваш адрес на gmail.com,"
  echo "  пароль — «пароль приложения» из настроек Google (не пароль входа)."
  echo
  printf 'Адрес сервера (например mail.ваш-домен): '; ask HOST
  printf 'Порт [465]: ';                              ask PORT
  PORT="${PORT:-465}"
  printf 'Ящик, от имени которого шлём: ';            ask USER_
  printf 'Пароль от ящика (на экране не появится): '; ask_secret PASS
  # Google показывает пароль приложения группами по четыре. Пробелы в
  # него не входят, но копируются вместе с ним.
  PASS="$(printf '%s' "$PASS" | tr -d ' ')"
  printf 'Куда отправить пробное письмо: ';           ask TO

  [ -n "$HOST" ] && [ -n "$USER_" ] && [ -n "$PASS" ] && [ -n "$TO" ] || {
    echo "Не все поля заполнены — ничего не меняю."; exit 1; }

  case "$PASS" in
    *'$'*) echo
           echo "В пароле есть знак «\$». Docker понимает его по-своему,"
           echo "и пароль дойдёт до почтового сервера искажённым."
           echo "Смените пароль ящика на вариант без «\$»."
           exit 1 ;;
  esac

  SECURE=true; [ "$PORT" = "465" ] || SECURE=false
  FROM="Sky <$USER_>"

  echo
  echo "Отправляю пробное письмо на $TO …"
  if try_send "$TO" EMAIL_MODE=smtp SMTP_HOST="$HOST" SMTP_PORT="$PORT" \
              SMTP_SECURE="$SECURE" SMTP_USER="$USER_" SMTP_PASS="$PASS" \
              EMAIL_FROM="$FROM"; then
    confirm_and_save EMAIL_MODE=smtp SMTP_HOST="$HOST" SMTP_PORT="$PORT" \
                     SMTP_SECURE="$SECURE" SMTP_USER="$USER_" SMTP_PASS="$PASS" \
                     EMAIL_FROM="$FROM"
  else
    echo
    echo "Письмо отправить не удалось. Строка выше говорит, почему."
    echo
    echo "  EAI_AGAIN / ENOTFOUND — не нашлось имя сервера: проверьте адрес."
    echo "  ETIMEDOUT / timeout   — до сервера не достучались. Часто хостинг"
    echo "                          закрывает почтовые порты; тогда выбирайте"
    echo "                          вариант 1 (Resend)."
    echo "  EAUTH / 535           — не подошёл пароль. Для Gmail нужен"
    echo "                          «пароль приложения», а не пароль входа."
    echo
    echo "Настройку не меняю."
    exit 1
  fi
  exit 0
fi

# ── Resend ─────────────────────────────────────────────────
DOMAIN="$(value_of DOMAIN)"
SUGGEST="no-reply@${DOMAIN#web.}"

echo
echo "Что нужно сделать в resend.com заранее:"
echo "  1. Зарегистрироваться (бесплатно)."
echo "  2. Domains → Add Domain → ${DOMAIN#web.}"
echo "     Resend покажет несколько записей — их надо добавить в DNS"
echo "     домена, там же, где вы прописывали адрес сервера."
echo "  3. Дождаться, пока домен станет Verified."
echo "  4. API Keys → Create API Key → скопировать ключ (начинается с re_)."
echo
printf 'Ключ Resend (на экране не появится): '; ask_secret KEY
[ -n "$KEY" ] || { echo "Ключ пустой — ничего не меняю."; exit 1; }
echo "Принял ключ длиной ${#KEY} символов."

printf "Адрес отправителя [%s]: " "$SUGGEST"; ask FROM_ADDR
FROM_ADDR="${FROM_ADDR:-$SUGGEST}"
printf 'Куда отправить пробное письмо: '; ask TO
[ -n "$TO" ] || { echo "Не указан адрес — ничего не меняю."; exit 1; }

FROM="Sky <$FROM_ADDR>"
echo
echo "Отправляю пробное письмо на $TO …"
if try_send "$TO" EMAIL_MODE=resend RESEND_API_KEY="$KEY" EMAIL_FROM="$FROM"; then
  confirm_and_save EMAIL_MODE=resend RESEND_API_KEY="$KEY" EMAIL_FROM="$FROM"
else
  echo
  echo "Письмо отправить не удалось. Строка выше говорит, почему."
  echo
  echo "  403 / 422 — Resend не принял отправителя. Чаще всего домен"
  echo "              ещё не Verified или адрес не на этом домене."
  echo "  401       — не подошёл ключ: проверьте, что скопирован целиком."
  echo
  echo "Настройку не меняю."
  exit 1
fi
