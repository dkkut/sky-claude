#!/usr/bin/env bash
#
# Загрузить телеканалы Sky TV из плейлиста M3U.
#
#   cd /opt/sky && bash scripts/tv-import.sh playlist.m3u8 "основание показа"
#
# Сначала всегда показывает, что будет сделано, и ничего не пишет.
# Записывает только после явного «да».
#
# Подключается не всё подряд. Запись пропускается, если:
#   • узла нет в TV_ALLOWED_HOSTS — то есть вы не подтвердили, что
#     показ с этого узла обеспечен законно;
#   • адрес не https — по обычному http эфир подменяют по дороге;
#   • вместо имени голый адрес или необычный порт;
#   • это страница с чужим проигрывателем, а не поток.
#
# Белый список — то место, где решение принимаете вы. Пока узла там
# нет, сервер по нему не пойдёт, сколько бы записей ни было в файле.
set -euo pipefail

cd "$(dirname "$0")/.."

FILE="${1:-}"
LICENCE="${2:-}"

if [ -z "$FILE" ] || [ -z "$LICENCE" ]; then
  cat <<'USAGE'
Использование:
  bash scripts/tv-import.sh <файл.m3u8> <основание показа>

Основание — это ответ на вопрос «на каком основании мы это показываем».
Он записывается рядом с каждым источником. Пример:

  bash scripts/tv-import.sh playlist.m3u8 "открытая раздача вещателей"

Разрешить узлы перед загрузкой:
  sed -i 's/^TV_ALLOWED_HOSTS=.*/&,smotrim.ru,cdnvideo.ru/' .env
  docker compose up -d api

Посмотреть, что уже подключено:
  bash scripts/tv-source.sh --список
USAGE
  exit 1
fi

[ -f "$FILE" ] || { echo "Файла «$FILE» нет." >&2; exit 1; }

SIZE=$(wc -c < "$FILE")
if [ "$SIZE" -gt 2097152 ]; then
  echo "Файл больше двух мегабайт — это уже не плейлист." >&2
  exit 1
fi

OWNER="$(grep -E '^OWNER_USERNAME=' .env 2>/dev/null | cut -d= -f2- | tr -d ' ')"
[ -n "$OWNER" ] || { echo "Не задан OWNER_USERNAME: подключать источники некому." >&2; exit 1; }

ALLOWED="$(grep -E '^TV_ALLOWED_HOSTS=' .env 2>/dev/null | cut -d= -f2- || true)"
if [ -z "$ALLOWED" ]; then
  cat >&2 <<'EOF'
TV_ALLOWED_HOSTS пуст — разрешённых узлов нет, и подключать нечего.

Это не помеха, а условие: список — то место, где вы подтверждаете, что
показ с этого узла обеспечен законно. Добавьте узлы и повторите:

  sed -i 's/^TV_ALLOWED_HOSTS=.*/&,узел1.example,узел2.example/' .env
  docker compose up -d api
EOF
  exit 1
fi

echo "Файл:      $FILE ($SIZE байт)"
echo "Разрешено: $ALLOWED"
echo "Основание: $LICENCE"
echo

# Разбор идёт внутри контейнера тем же кодом, что и запись: расхождение
# между «что покажем» и «что запишем» здесь было бы опаснее всего.
PLAN=$(docker compose exec -T -e TV_ALLOWED="$ALLOWED" api node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", async () => {
  const { planImport } = await import("/app/server/tvimport.mjs");
  const allowed = (process.env.TV_ALLOWED || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const r = planImport(raw, allowed);
  console.log(JSON.stringify(r));
});
' < "$FILE")

node -e '
const r = JSON.parse(process.argv[1]);
console.log(`Всего записей в плейлисте: ${r.total}\n`);
console.log(`ПОДКЛЮЧИТСЯ (${r.ready.length}):`);
for (const c of r.ready) console.log(`  ${c.name}  [${c.category}]  ${c.kind}  ${c.host}`);
console.log(`\nПРОПУЩЕНО (${r.skipped.length}):`);
const by = {};
for (const s of r.skipped) (by[s.why] ??= []).push(s.name);
for (const [why, names] of Object.entries(by)) {
  console.log(`  ${why}`);
  console.log(`    ${names.join(", ")}`);
}
' "$PLAN"

READY=$(node -e 'console.log(JSON.parse(process.argv[1]).ready.length)' "$PLAN")
if [ "$READY" = "0" ]; then
  echo
  echo "Подключать нечего. Если каналы пропущены из-за узла — добавьте узел"
  echo "в TV_ALLOWED_HOSTS, перезапустите api и повторите."
  exit 0
fi

echo
read -r -p "Подключить эти $READY каналов? Напишите «да»: " ANSWER
[ "$ANSWER" = "да" ] || { echo "Отменено, ничего не записано."; exit 0; }

docker compose exec -T -e TV_DELIVERY="${TV_DELIVERY:-proxy}" -e TV_PLAN="$PLAN" -e TV_LICENCE="$LICENCE" -e TV_OWNER="$OWNER" \
  api node -e '
const run = async () => {
  const { query } = await import("/app/server/db.mjs");
  const { upsertChannel, attachSource, checkAllSources } = await import("/app/server/tv.mjs");
  const plan = JSON.parse(process.env.TV_PLAN);
  const { rows } = await query("SELECT id FROM profiles WHERE lower(username) = lower($1)", [process.env.TV_OWNER]);
  if (!rows[0]) { console.error("Профиль владельца не найден."); process.exit(1); }
  const owner = rows[0].id;

  let added = 0; let failed = 0;
  for (const c of plan.ready) {
    const ch = await upsertChannel(owner, {
      slug: c.slug, name: c.name, category: c.category, country: c.country,
    });
    if (ch.error) { console.error(`  ✗ ${c.name}: ${ch.error}`); failed += 1; continue; }
    const src = await attachSource(owner, {
      slug: c.slug, url: c.url, kind: c.kind,
      licence: process.env.TV_LICENCE, delivery: process.env.TV_DELIVERY === "redirect" ? "redirect" : "proxy",
    });
    if (src.error) {
      console.error(`  ✗ ${c.name}: ${src.error} ${src.reason ?? ""} ${src.detail ?? ""}`.trim());
      failed += 1;
      continue;
    }
    added += 1;
  }
  console.log(`\nПодключено: ${added}, не удалось: ${failed}.`);
  const h = await checkAllSources();
  console.log(`Проверка источников: работают ${h.ok}, не отвечают ${h.bad}.`);
  console.log("Неотвечающие останутся в каталоге с пометкой «временно недоступен».");
  process.exit(0);
};
run().catch((e) => { console.error(e.message); process.exit(1); });
'
