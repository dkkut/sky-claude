#!/usr/bin/env bash
# ============================================================
#  Отдельный ключ шифрования — без смены остальных секретов.
#
#  Запускать на сервере из каталога приложения:
#
#      cd /opt/sky && bash scripts/set-encryption-key.sh
#
#  Зачем. Переписка и секреты двухэтапной защиты хранятся в базе
#  зашифрованными. Ключ берётся из ENCRYPTION_KEY, а если её нет —
#  выводится из JWT_SECRET. Второе работает, но ставит ловушку: смена
#  подписи токенов (обычное дело) сделает все зашифрованные записи
#  нечитаемыми НАВСЕГДА.
#
#  Поэтому ключ лучше задать отдельно и сделать это как можно раньше —
#  пока зашифрованных записей мало.
#
#  Этот скрипт меняет ровно одну строку в .env. Пароли, подписи токенов
#  и ключи беты он не трогает: для этого есть rotate-secrets.sh.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f docker-compose.yml ] || { echo "Здесь нет docker-compose.yml. Запускайте из каталога приложения."; exit 1; }
[ -f .env ]               || { echo "Здесь нет .env. Сначала выполните scripts/bootstrap-server.sh"; exit 1; }

value_of() { sed -n "s|^$1=||p" .env | tail -1; }

if [ -n "$(value_of ENCRYPTION_KEY)" ]; then
  echo "ENCRYPTION_KEY уже задан — им зашифрованы записи в базе."
  echo "Менять его нельзя: старые записи станут нечитаемыми. Ничего не делаю."
  exit 0
fi

# ── Что уже зашифровано старым ключом ──────────────────────
#  Сейчас ключ выводится из JWT_SECRET, и им зашифрованы переписка,
#  названия чатов, настройки, журнал и секреты двухэтапной защиты.
#  Просто дописать новый ключ нельзя: всё это перестанет читаться.
#  Поэтому после смены запускается перешифровка.
OLD_JWT="$(value_of JWT_SECRET)"
[ -n "$OLD_JWT" ] || { echo "В .env нет JWT_SECRET — непонятно, чем зашифрованы записи."; exit 1; }

echo
echo "Сейчас записи в базе зашифрованы ключом, выведенным из JWT_SECRET."
echo "Скрипт заведёт отдельный ключ и переведёт на него всё, что уже"
echo "зашифровано: переписку, названия чатов, настройки, журнал и"
echo "секреты двухэтапной защиты. Ничего не потеряется."
echo
echo "Перед этим стоит снять резервную копию базы:"
echo "  docker compose exec -T postgres pg_dump -U sky sky > sky-\$(date +%F).sql"
echo
printf 'Продолжить? (да/нет) '
if { : </dev/tty; } 2>/dev/null; then read -r ANSWER </dev/tty; else read -r ANSWER; fi
case "$ANSWER" in
  да|yes|y|Y) ;;
  *) echo "Отменено."; exit 0 ;;
esac

BACKUP=".env.backup-$(date +%Y%m%d-%H%M%S)"
cp .env "$BACKUP"; chmod 600 "$BACKUP"
echo "Старый .env сохранён: $BACKUP"

# Только буквы и цифры: так значение не испортит ни кавычка в конфиге,
# ни подстановка при запуске контейнера.
KEY="$(openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 44)"
printf 'ENCRYPTION_KEY=%s\n' "$KEY" >> .env
echo "==> ENCRYPTION_KEY задан"

echo "==> Перезапускаю приложение"
docker compose up -d --force-recreate api >/dev/null

# ── Перешифровка ───────────────────────────────────────────
#  Идёт внутри контейнера: там уже есть и доступ к базе, и нужный код.
#  Прежний материал ключа передаётся отдельной переменной, в .env он не
#  пишется и после перехода нигде не остаётся.
echo "==> Перевожу записи на новый ключ"
if ! docker compose exec -T -e SKY_OLD_KEY="$OLD_JWT" api node -e "
  import('/app/server/rekey.mjs').then(async (m) => {
    const counts = await m.rekeyAll(process.env.SKY_OLD_KEY);
    if (counts.same) { console.log('    ключ тот же — переносить нечего'); process.exit(0); }
    for (const [name, n] of Object.entries(counts)) if (n) console.log(\`    \${name}: \${n}\`);
    process.exit(0);
  }).catch((e) => { console.error('    ошибка:', e.message); process.exit(1); });
"; then
  echo
  echo "Перешифровка не удалась. Возвращаю прежний .env — записи остаются"
  echo "читаемыми, как были."
  cp "$BACKUP" .env
  docker compose up -d --force-recreate api >/dev/null
  exit 1
fi

# ── Проверка, что сервер поднялся ──────────────────────────
for i in $(seq 1 30); do
  STATE="$(docker compose ps api --format '{{.Health}}' 2>/dev/null || true)"
  [ "$STATE" = "healthy" ] && break
  sleep 2
done

if [ "${STATE:-}" = "healthy" ]; then
  echo
  echo "Готово. Сервер работает с отдельным ключом шифрования."
  echo "Теперь смена JWT_SECRET безопасна для переписки."
else
  echo
  echo "Сервер не поднялся. Возвращаю прежний .env:"
  cp "$BACKUP" .env
  docker compose up -d --force-recreate api >/dev/null
  echo "  откат выполнен, разбирайтесь по журналу: docker compose logs api --tail 50"
  exit 1
fi
