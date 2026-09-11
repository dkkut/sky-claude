#!/usr/bin/env bash
#
# Подключить источник эфира к телеканалу Sky TV.
#
#   cd /opt/sky && bash scripts/tv-source.sh 1tv https://.../master.m3u8 "основание"
#
# Что здесь важно понимать.
#
# Узел источника обязан быть заранее разрешён в TV_ALLOWED_HOSTS в .env.
# Это не формальность: добавляя узел в тот список, вы своей рукой
# подтверждаете, что показ этого вещания обеспечен законно. Скрипт
# подскажет команду, если узла там ещё нет, но добавлять его за вас не
# станет.
#
# Основание показа — третий обязательный довод. Источник, про который
# нельзя сказать, на каком основании мы его показываем, подключать
# нечего, и сервер такой источник не примет.
set -euo pipefail

cd "$(dirname "$0")/.."

SLUG="${1:-}"
URL="${2:-}"
LICENCE="${3:-}"
KIND="${4:-hls}"
DELIVERY="${5:-redirect}"

if [ -z "$SLUG" ] || [ -z "$URL" ] || [ -z "$LICENCE" ]; then
  cat <<'USAGE'
Использование:
  bash scripts/tv-source.sh <канал> <адрес-манифеста> <основание> [hls|dash] [redirect|proxy]

Примеры:
  bash scripts/tv-source.sh otr https://example.com/otr/master.m3u8 "официальная открытая раздача вещателя"
  bash scripts/tv-source.sh 1tv https://example.com/1tv.mpd "договор №17 от 2026-01-12" dash proxy

Список заведённых каналов:
  bash scripts/tv-source.sh --список

Про способ выдачи:
  redirect — зритель забирает куски эфира прямо у источника. Быстрее и
             не тратит канал сервера. Подходит, когда адреса кусков не
             секрет.
  proxy    — куски идут через сервер потоком. Нужно, когда источник
             отвечает только нам: по ключу или по адресу.
USAGE
  exit 1
fi

DB() { docker compose exec -T postgres psql -U sky -d sky -tAc "$1"; }

if [ "$SLUG" = "--список" ] || [ "$SLUG" = "--list" ]; then
  echo "Каналы Sky TV:"
  DB "SELECT c.slug || '  ' || c.name || '  [' || c.category || ']' ||
             CASE WHEN EXISTS (SELECT 1 FROM tv_sources s WHERE s.channel_id = c.id AND s.active)
                  THEN '  — источник подключён' ELSE '  — источника нет' END
        FROM tv_channels c ORDER BY c.position, c.name"
  exit 0
fi

# Канал должен существовать: подключать источник к выдуманному имени
# бессмысленно, а опечатка в имени иначе прошла бы молча.
EXISTS="$(DB "SELECT count(*) FROM tv_channels WHERE slug = '${SLUG//\'/\'\'}'")"
if [ "$EXISTS" != "1" ]; then
  echo "Канала «$SLUG» нет. Посмотрите список: bash scripts/tv-source.sh --список" >&2
  exit 1
fi

HOST="$(printf '%s' "$URL" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##; s#^[^@]*@##; s#:[0-9]+$##' | tr 'A-Z' 'a-z')"
if [ -z "$HOST" ]; then
  echo "Не удалось разобрать узел из адреса." >&2
  exit 1
fi

ALLOWED="$(grep -E '^TV_ALLOWED_HOSTS=' .env 2>/dev/null | cut -d= -f2- || true)"
if ! printf '%s' ",$ALLOWED," | tr -d ' ' | grep -qi ",$HOST,"; then
  MATCHED=0
  IFS=',' read -ra LIST <<< "$ALLOWED"
  for a in "${LIST[@]}"; do
    a="$(printf '%s' "$a" | tr -d ' ' | tr 'A-Z' 'a-z')"
    [ -n "$a" ] || continue
    case "$HOST" in *".$a") MATCHED=1;; esac
  done
  if [ "$MATCHED" != "1" ]; then
    cat >&2 <<EOF

Узел «$HOST» не разрешён.

Sky TV не пойдёт ни по одному адресу, узел которого не назван в
TV_ALLOWED_HOSTS. Это сделано намеренно: список — то место, где вы
подтверждаете, что этому вещателю доверяете и показ обеспечен законно.

Чтобы разрешить, добавьте узел и перезапустите api:

  cd /opt/sky
  sed -i 's/^TV_ALLOWED_HOSTS=.*/&,$HOST/' .env || echo 'TV_ALLOWED_HOSTS=$HOST' >> .env
  docker compose up -d api

После этого повторите эту команду.
EOF
    exit 1
  fi
fi

OWNER="$(grep -E '^OWNER_USERNAME=' .env 2>/dev/null | cut -d= -f2- | tr -d ' ')"
if [ -z "$OWNER" ]; then
  echo "Не задан OWNER_USERNAME: подключать источники некому." >&2
  exit 1
fi

echo "Канал:    $SLUG"
echo "Узел:     $HOST  (разрешён)"
echo "Формат:   $KIND, выдача $DELIVERY"
echo "Основание: $LICENCE"
echo

# Запись идёт через сам сервер, а не мимо него: тот же путь, те же
# проверки адреса, то же шифрование. Скрипт, пишущий в базу напрямую,
# однажды разошёлся бы с сервером — и разошёлся бы молча.
docker compose exec -T \
  -e TV_SLUG="$SLUG" -e TV_URL="$URL" -e TV_LICENCE="$LICENCE" \
  -e TV_KIND="$KIND" -e TV_DELIVERY="$DELIVERY" -e TV_OWNER="$OWNER" \
  api node -e '
const run = async () => {
  const { query } = await import("/app/server/db.mjs");
  const { attachSource } = await import("/app/server/tv.mjs");
  const { rows } = await query("SELECT id FROM profiles WHERE lower(username) = lower($1)", [process.env.TV_OWNER]);
  if (!rows[0]) { console.error("Профиль владельца не найден."); process.exit(1); }
  const r = await attachSource(rows[0].id, {
    slug: process.env.TV_SLUG,
    url: process.env.TV_URL,
    licence: process.env.TV_LICENCE,
    kind: process.env.TV_KIND,
    delivery: process.env.TV_DELIVERY,
  });
  if (r.error) {
    console.error("Отказ:", r.error, r.reason ?? "", r.detail ?? "");
    process.exit(1);
  }
  console.log("Источник подключён.");
  const { checkAllSources } = await import("/app/server/tv.mjs");
  const h = await checkAllSources();
  console.log(`Проверка источников: работают ${h.ok}, не отвечают ${h.bad}.`);
  process.exit(0);
};
run().catch((e) => { console.error(e.message); process.exit(1); });
'
