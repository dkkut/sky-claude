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
# Меняем вместе с JWT_SECRET: пока отдельного ключа нет, шифрование
# опирается на подпись токенов, и её смена сделала бы уже сохранённые
# секреты двухэтапной защиты нечитаемыми.
if [ -z "$(value_of ENCRYPTION_KEY)" ]; then
  set_env ENCRYPTION_KEY "$(gen 44)"
  echo "==> Задан отдельный ключ шифрования"
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
  read -rs TB_KEY </dev/tty || TB_KEY=''
  echo
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
echo "==> Что говорит сервер"
sleep 8
docker compose logs api --tail 40 \
  | grep -E '\[доставка\]|\[beta\]|\[crypto\]|\[db\]|\[api\]|listening' || true

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

if docker compose ps api --format '{{.State}}' 2>/dev/null | grep -q running; then
  echo
  echo "Готово. Все вошедшие вышли из аккаунтов — это ожидаемо."
else
  echo
  echo "ВНИМАНИЕ: приложение не поднялось. Причина — в журнале:"
  echo "    docker compose logs api --tail 50"
  exit 1
fi
