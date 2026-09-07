#!/usr/bin/env bash
# ============================================================
#  Смена секретов и настройка отправки кодов.
#
#  Запускать на сервере из каталога приложения:
#
#      cd /opt/sky && bash scripts/rotate-secrets.sh
#
#  Что делает:
#    • меняет JWT_SECRET, REFRESH_TOKEN_SECRET, пароли Postgres и Redis
#      (пароль Postgres меняется и в самой базе, иначе новый в .env
#      ничего не значит — база уже создана со старым);
#    • дописывает переменные, которых ещё нет: ключ шифрования,
#      ключи закрытой беты, настройки отправки кодов;
#    • спрашивает ключ TextBee и включает отправку SMS;
#    • перезапускает приложение и показывает, что сказал сервер.
#
#  Все вошедшие после этого выходят из аккаунтов — это ожидаемо:
#  подпись токенов сменилась. Данные, профили и переписка на месте.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f docker-compose.yml ] || { echo "Здесь нет docker-compose.yml. Запускайте из каталога приложения."; exit 1; }
[ -f .env ]               || { echo "Здесь нет .env. Сначала выполните scripts/bootstrap-server.sh"; exit 1; }

# ── Резервная копия ────────────────────────────────────────
BACKUP=".env.backup-$(date +%Y%m%d-%H%M%S)"
cp .env "$BACKUP"; chmod 600 "$BACKUP"
echo "Старый .env сохранён: $BACKUP"

# Секреты только из букв и цифр: так их не испортит ни кавычка в
# конфиге, ни подстановка в SQL.
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

gen() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "${1:-48}"; }

value_of() { sed -n "s|^$1=||p" .env | tail -1; }

# Заменяет строку или дописывает, если её ещё нет.
set_env() {
  local key="$1" val="$2"
  if grep -q "^$key=" .env; then
    sed -i "s|^$key=.*|$key=$val|" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}

# Дописывает, только если значения ещё нет или оно пустое.
default_env() {
  local key="$1" val="$2"
  local cur; cur="$(value_of "$key")"
  [ -n "$cur" ] || set_env "$key" "$val"
}

# ── Пароль базы: сначала в самой базе, потом в файле ───────
echo
echo "==> Меняю пароль базы данных"
OLD_PG="$(value_of POSTGRES_PASSWORD)"
NEW_PG="$(gen 40)"
if docker compose ps postgres --format '{{.State}}' 2>/dev/null | grep -q running; then
  # </dev/null обязательно: без него psql съедает стандартный ввод,
  # и ключ TextBee ниже прочитать уже не из чего.
  docker compose exec -T -e PGPASSWORD="$OLD_PG" postgres \
    psql -U sky -d sky -c "ALTER USER sky WITH PASSWORD '$NEW_PG';" >/dev/null </dev/null
  set_env POSTGRES_PASSWORD "$NEW_PG"
  PG_ROTATED=1
  echo "    пароль изменён и в базе, и в .env"
else
  echo "    контейнер базы не запущен — пароль в .env НЕ трогаю,"
  echo "    иначе приложение перестанет к ней подключаться."
fi

# ── Остальные секреты ──────────────────────────────────────
echo "==> Меняю подписи токенов и пароль Redis"
set_env JWT_SECRET           "$(gen 48)"
set_env REFRESH_TOKEN_SECRET "$(gen 48)"
set_env REDIS_PASSWORD       "$(gen 40)"

# ── Ключ шифрования ────────────────────────────────────────
# ВАЖНО: ENCRYPTION_KEY этот скрипт НЕ меняет и менять не должен.
# Этим ключом зашифрованы переписка, названия чатов и вложения. Смена
# ключа без перешифровки означает потерю всего этого — так же надёжно,
# как удаление базы. Задаётся он один раз и хранится ОТДЕЛЬНО от
# резервных копий: копия базы вместе с ключом защищает ровно ни от чего.
if [ -z "$(value_of ENCRYPTION_KEY)" ]; then
  set_env ENCRYPTION_KEY "$(gen 44)"
  echo "==> Задан отдельный ключ шифрования (ENCRYPTION_KEY)"
  echo "    Сохраните его отдельно от копий базы: без него переписку"
  echo "    не прочитать, а вместе с копией базы он бесполезен."
else
  echo "==> ENCRYPTION_KEY уже задан — не трогаю (им зашифрована переписка)"
fi

# ── Настройки отправки, если их ещё нет ────────────────────
default_env SMS_FROM ''
default_env SMS_DEVICE_ID ''
default_env SMS_WEBHOOK_URL ''
default_env SMS_WEBHOOK_TOKEN ''
default_env EMAIL_MODE 'log'
default_env EMAIL_FROM ''
default_env SMTP_HOST ''
default_env SMTP_PORT '465'
default_env SMTP_SECURE 'true'
default_env SMTP_USER ''
default_env SMTP_PASS ''
default_env RESEND_API_KEY ''
default_env EMAIL_WEBHOOK_URL ''
default_env EMAIL_WEBHOOK_TOKEN ''
default_env ALLOW_LOG_CODES ''
default_env PAYMENTS_MODE 'disabled'

# ── Образы приложения ──────────────────────────────────────
# Без этих переменных compose поднимет sky-*:local — образ первой
# ручной сборки. Это тихий откат к старому коду: он не знает про
# нынешнюю схему базы и падает на запуске.
pin_image() {                       # pin_image <ПЕРЕМЕННАЯ> <часть имени>
  local key="$1" repo="$2" found
  [ -n "$(value_of "$key")" ] && return 0
  found="$(docker images --format '{{.Repository}}:{{.Tag}}|{{.CreatedAt}}' 2>/dev/null \
           | grep "$repo" | grep -v '<none>' | sort -t'|' -k2 -r | head -1 | cut -d'|' -f1)"
  if [ -n "$found" ]; then
    set_env "$key" "$found"
    echo "    $key = $found"
  else
    echo "    ВНИМАНИЕ: $key не задан, и подходящий образ не найден."
    echo "    Запустите деплой заново — иначе поднимется старая сборка."
  fi
}

echo
echo "==> Образы приложения"
pin_image API_IMAGE 'sky-claude-api'
pin_image WEB_IMAGE 'sky-claude-web'

# ── Ключи закрытой беты ────────────────────────────────────
if [ -z "$(value_of BETA_KEYS)" ]; then
  K1="$(gen 24)"; K2="$(gen 24)"
  set_env BETA_KEYS "$K1:мой,$K2:команда"
  NEW_BETA=1
fi

# ── Ключ TextBee ───────────────────────────────────────────
echo
echo "==> Отправка SMS"
CUR_SMS="$(value_of SMS_MODE)"
CUR_KEY="$(value_of SMS_API_ID)"
if [ "$CUR_SMS" = "textbee" ] && [ -n "$CUR_KEY" ]; then
  echo "    уже настроена через TextBee — не трогаю"
else
  echo "    вставьте ключ из личного кабинета TextBee."
  echo "    (Enter без ввода — пропустить; тогда войти никто не сможет.)"
  printf '    Ключ (на экране не появится): '
  # -s: ключ не печатается. Терминал часто фотографируют, и напечатанный
  # ключ утекает вместе со снимком экрана.
  ask_secret TB_KEY || TB_KEY=''
  if [ -n "$TB_KEY" ]; then
    set_env SMS_MODE   'textbee'
    set_env SMS_API_ID "$TB_KEY"
    echo "    TextBee подключён (ключ длиной ${#TB_KEY} символов)"
  else
    echo "    пропущено"
  fi
fi

chmod 600 .env

# ── Перезапуск ─────────────────────────────────────────────
# Дальше ошибка перезапуска не должна обрывать скрипт: ключи беты надо
# показать в любом случае, иначе они останутся только в .env, а человек
# уйдёт разбираться с ошибкой и потеряет их из виду.
set +e

echo
echo "==> Перезапускаю приложение"
# Пароль базы уже сменён в самой базе, поэтому приложение обязано
# подняться с новым .env. Если общий запуск споткнулся (например, не
# скачался certbot), поднимаем хотя бы то, без чего сайт не работает.
docker compose up -d
if [ $? -ne 0 ]; then
  echo "    общий запуск не удался — поднимаю основные службы"
  docker compose up -d postgres redis web
  docker compose up -d api
  echo "    certbot проверьте отдельно: docker compose up -d certbot"
fi

echo
echo "==> Проверяю, что приложение действительно работает"
# Не «контейнер запущен», а «приложение достучалось до базы и кэша».
# После смены паролей это разные вещи: процесс поднимется в любом
# случае, а вот подключиться с новым паролем может и не выйти.
READY=""
for _ in $(seq 1 45); do
  CODE="$(docker compose exec -T api node -e "
    require('http').get('http://127.0.0.1:'+(process.env.API_PORT||8080)+'/readyz',
      r=>{console.log(r.statusCode);process.exit(0)}).on('error',()=>{console.log(0);process.exit(0)})
  " 2>/dev/null || echo 0)"
  if [ "$CODE" = "200" ]; then READY=1; break; fi
  sleep 2
done

echo
echo "==> Что говорит сервер"
docker compose logs api --tail 40 \
  | grep -E '\[доставка\]|\[beta\]|\[crypto\]|\[db\]|\[api\]|\[readyz\]|listening' || true

echo
echo "────────────────────────────────────────────"
if [ "${NEW_BETA:-}" = "1" ]; then
  echo "Ключи закрытой беты — сохраните сейчас, второй раз не покажутся"
  echo "(в базе лежат только их отпечатки):"
  echo
  echo "    ваш      : $K1"
  echo "    команде  : $K2"
  echo
fi
echo "Старый .env лежит рядом: $BACKUP"
echo "(удалите, когда убедитесь, что всё работает)."

if [ -n "$READY" ]; then
  echo
  echo "Готово. Приложение отвечает, база и кэш на месте."
  echo "Все вошедшие вышли из аккаунтов — это ожидаемо: подписи токенов сменились."
  exit 0
fi

# ── Не заработало: возвращаем всё как было ─────────────────
# Просто вернуть .env недостаточно: пароль базы сменён и в самой базе,
# и старый файл с ним уже не совпадёт. Поэтому возвращаем оба — сначала
# пароль в базе, потом файл.
echo
echo "ВНИМАНИЕ: приложение не отвечает или не видит базу либо кэш."
echo "==> Возвращаю прежние настройки"

# Возвращаем пароль базы только если он действительно менялся: когда
# контейнер базы был остановлен, скрипт его не трогал.
if [ "${PG_ROTATED:-}" = "1" ] && docker compose ps postgres --format '{{.State}}' 2>/dev/null | grep -q running; then
  if docker compose exec -T -e PGPASSWORD="$NEW_PG" postgres \
       psql -U sky -d sky -c "ALTER USER sky WITH PASSWORD '$OLD_PG';" >/dev/null </dev/null 2>&1; then
    echo "    пароль базы возвращён"
  else
    echo "    !!! пароль базы вернуть не удалось — он остался новым."
    echo "        Тогда и .env возвращать нельзя: возьмите из него всё,"
    echo "        кроме POSTGRES_PASSWORD. Новый пароль базы: см. .env"
    echo "        Копия прежнего файла: $BACKUP"
    exit 1
  fi
fi

cp "$BACKUP" .env
chmod 600 .env
docker compose up -d >/dev/null 2>&1 || true

for _ in $(seq 1 30); do
  CODE="$(docker compose exec -T api node -e "
    require('http').get('http://127.0.0.1:'+(process.env.API_PORT||8080)+'/readyz',
      r=>{console.log(r.statusCode);process.exit(0)}).on('error',()=>{console.log(0);process.exit(0)})
  " 2>/dev/null || echo 0)"
  if [ "$CODE" = "200" ]; then
    echo
    echo "Прежние настройки восстановлены, приложение снова работает."
    echo "Ничего не изменилось. Причина неудачи — в журнале:"
    echo "    docker compose logs api --tail 50"
    exit 1
  fi
  sleep 2
done

echo
echo "!!! Вернуть автоматически не вышло. Копия прежнего .env: $BACKUP"
echo "    Журнал: docker compose logs api --tail 50"
exit 1
