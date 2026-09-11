#!/usr/bin/env bash
# ============================================================
#  Владелец сервиса.
#
#      cd /opt/sky && bash scripts/set-owner.sh @ник
#
#  Владелец — это ник, записанный в .env. Сервер сверяет его с базой
#  на каждом действии: владелец всегда администратор, и снять с него
#  права не может никто, включая других администраторов.
#
#  Поэтому порядок важен: ник сначала должен быть занят вами в самом
#  приложении. Если записать сюда свободный ник, владельцем станет
#  тот, кто зарегистрирует его первым. Скрипт это проверяет и без
#  вашего подтверждения свободный ник не примет.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Здесь нет .env — запускайте из каталога приложения."; exit 1; }

if { : </dev/tty; } 2>/dev/null; then INPUT=/dev/tty; else INPUT=/dev/stdin; fi
ask() { read -r "$1" <"$INPUT"; }

NICK="${1-}"
if [ -z "$NICK" ]; then
  printf 'Ник владельца: '; ask NICK
fi
# Собака и пробелы — привычная форма записи, а в базе ника с ними нет.
NICK="$(printf '%s' "$NICK" | tr -d '@[:space:]')"
[ -n "$NICK" ] || { echo "Пустой ник — ничего не меняю."; exit 1; }

CURRENT="$(grep -E '^OWNER_USERNAME=' .env | head -1 | cut -d= -f2- || true)"
echo "Сейчас владелец: ${CURRENT:-не задан}"
echo "Ставлю владельцем: $NICK"

# Проверяем по базе, занят ли ник. Без базы (контейнер не поднят)
# просто предупреждаем: настройку это не ломает.
FOUND=""
if docker compose ps postgres --format '{{.State}}' 2>/dev/null | grep -q running; then
  FOUND="$(docker compose exec -T postgres psql -U sky -d sky -tAc \
    "SELECT username FROM profiles WHERE lower(username) = lower('$NICK')" 2>/dev/null | tr -d '[:space:]' || true)"
  if [ -z "$FOUND" ]; then
    echo
    echo "В базе нет профиля с ником «$NICK»."
    echo "Пока ник свободен, владельцем станет тот, кто займёт его первым."
    echo "Обычный порядок: сначала зарегистрировать ник в приложении, потом этот скрипт."
    printf 'Всё равно записать? (да/нет): '; ask ANSWER
    case "$ANSWER" in да|Да|yes|y) ;; *) echo "Ничего не меняю."; exit 1;; esac
  else
    echo "Профиль найден: @$FOUND"
  fi
else
  echo "База не запущена — проверить существование ника не могу."
fi

if grep -qE '^OWNER_USERNAME=' .env; then
  sed -i "s|^OWNER_USERNAME=.*|OWNER_USERNAME=$NICK|" .env
else
  printf 'OWNER_USERNAME=%s\n' "$NICK" >> .env
fi

echo "==> Перезапускаю api, чтобы он прочитал новое значение"
docker compose up -d api >/dev/null

# Проверяем не собственную запись в .env, а то, что об этом думает сам
# сервер: спрашиваем у его же функции прав.
sleep 3
RESULT="$(docker compose exec -T api node -e "
  const { isOwner, isAdmin } = await import('/app/server/admin.mjs');
  const { query } = await import('/app/server/db.mjs');
  const { rows } = await query('SELECT id FROM profiles WHERE lower(username) = lower(\$1)', ['$NICK']);
  if (!rows[0]) { console.log('нет-профиля'); process.exit(0); }
  console.log(await isOwner(rows[0].id) && await isAdmin(rows[0].id) ? 'подтверждено' : 'нет');
  process.exit(0);
" 2>/dev/null | tr -d '[:space:]' || true)"

echo
case "$RESULT" in
  подтверждено) echo "Готово: @$NICK — владелец. Сервер это подтверждает.";;
  нет-профиля)  echo "Записано: OWNER_USERNAME=$NICK. Права появятся, как только этот ник будет зарегистрирован.";;
  *)            echo "Записано: OWNER_USERNAME=$NICK, но подтвердить у сервера не вышло."
                echo "Проверьте: docker compose logs api --tail 30";;
esac
