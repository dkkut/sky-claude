#!/usr/bin/env bash
# ============================================================
#  СБОРКА ОДНОГО ZIP со всем нужным для переноса Sky на другой сервер.   Запускать на СТАРОМ (рабочем) сервере, от root.
#
#      sudo bash migration/pack.sh [--out /каталог] [--with-certs] [--no-source] [--keep-parts]
#
#  В zip (всё, кроме описи и скриптов, зашифровано age — открытого текста с секретами внутри нет):
#    payload/db-*.sql.gz.age        база данных
#    payload/files-*.tar.gz.age     все загруженные файлы (музыка, кино, книги, вложения, фото… — том /data)
#    payload/config-*.tar.gz.age    .env, secrets/, docker-compose.secrets.local (ключи, пароли, ENCRYPTION_KEY)
#    payload/host-config-*.age      настройки хоста: таймеры копий, watchdog, SSH-шлюз, Sky Control…
#    payload/certs-*.age            сертификаты (только с --with-certs)
#    payload/MANIFEST.txt           контрольные суммы sha256 каждого файла
#    STATS.txt                      сколько строк в каждой таблице и сколько файлов/байт в /data на момент упаковки (для сверки «без потерь»)
#    source.tar.gz                  код Sky этой версии (git archive) — чтобы новый сервер не зависел от доступа к GitHub (--no-source — не класть)
#    restore.sh, upload.sh          скрипты переноса (положены внутрь, чтобы на новом сервере всё было под рукой)
#    РЕКВИЗИТЫ.txt                  домен, версия кода, дата
#
#  Секретный ключ age (backup.key) в zip НЕ кладётся и на сервере не хранится — без него zip открыть нельзя. Храните его отдельно.
#  Для самой точной копии перед упаковкой включите в админке «Технические работы»: тогда никто не пишет в базу, и счётчики сойдутся до единицы.
#  Старый сервер скрипт не останавливает и не меняет.
# ============================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$(cd "$HERE/.." && pwd)"
APP_DIR="${APP_DIR:-/opt/sky}"
MIGRATE_SH="${MIGRATE_SH:-$SRC_DIR/scripts/migrate-server.sh}"   # переопределяется только в тестах
STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT=""; WITH_CERTS=0; NO_SOURCE=0; KEEP_PARTS=0
while [ $# -gt 0 ]; do case "$1" in
  --out) OUT="$2"; shift 2;; --with-certs) WITH_CERTS=1; shift;; --no-source) NO_SOURCE=1; shift;; --keep-parts) KEEP_PARTS=1; shift;;
  -h|--help) sed -n 2,26p "$0"; exit 0;; *) echo "Неизвестный параметр: $1"; exit 1;; esac; done
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "Нужен root."
for c in zip unzip age sha256sum tar; do command -v "$c" >/dev/null 2>&1 || die "Нет программы $c (apt install -y zip unzip age)."; done
[ -f "$APP_DIR/docker-compose.yml" ] && [ -f "$APP_DIR/.env" ] || die "В $APP_DIR нет docker-compose.yml и .env — задайте APP_DIR."
get_env() { grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//" || true; }
dc() { ( cd "$APP_DIR" && docker compose "$@" ); }

OUT="${OUT:-/root/sky-migration}"; WORK="$OUT/.work-$STAMP"; PAY="$WORK/payload"
mkdir -p "$PAY"; chmod 700 "$OUT" "$WORK"
trap '[ "$KEEP_PARTS" = 1 ] || rm -rf "$WORK"' EXIT

# Место: набор лежит дважды (части + zip) — нужно примерно удвоенный объём данных.
used_mb=$(dc exec -T api du -sm /data 2>/dev/null | cut -f1 | tr -dc 0-9 || echo 0); free_mb=$(df -Pm "$OUT" | awk 'NR==2{print $4}' | tr -dc 0-9)
need_mb=$(( ${used_mb:-0} * 2 + 2048 ))
[ "${free_mb:-0}" -ge "$need_mb" ] && ok "места хватает: нужно ≈ ${need_mb} МБ, свободно ${free_mb} МБ" || die "Мало места в $OUT: нужно ≈ ${need_mb} МБ, свободно ${free_mb:-?} МБ. Укажите --out на диск побольше."

echo "==> 1. Счётчики для сверки «без потерь» (STATS.txt)"
{
  echo "# таблица|строк  (на $(date '+%F %T'))"
  dc exec -T postgres psql -U sky sky -At -F'|' -c "select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1" | tr -d '\r' | sed 's/^/T|/'
  echo "F|files|$(dc exec -T api sh -c 'find /data -type f | wc -l' | tr -dc 0-9)"
  echo "F|bytes|$(dc exec -T api sh -c 'du -sb /data | cut -f1' | tr -dc 0-9)"
} > "$WORK/STATS.txt" || die "Не удалось собрать счётчики (postgres/api запущены?)."
ok "таблиц: $(grep -c '^T|' "$WORK/STATS.txt"), файлов в /data: $(grep '^F|files' "$WORK/STATS.txt" | cut -d'|' -f3)"

echo "==> 2. База, файлы, настройки, хост (scripts/migrate-server.sh pack)"
args=(pack --out "$PAY"); [ "$WITH_CERTS" = 1 ] && args+=(--with-certs)
APP_DIR="$APP_DIR" bash "$MIGRATE_SH" "${args[@]}"
ls "$PAY"/db-*.age "$PAY"/files-*.age "$PAY"/config-*.age >/dev/null 2>&1 || die "В наборе нет db/files/config — упаковка не удалась."

if [ "$NO_SOURCE" != 1 ]; then
  echo "==> 3. Код Sky (source.tar.gz)"
  if git -C "$SRC_DIR" rev-parse --git-dir >/dev/null 2>&1; then
    git -C "$SRC_DIR" archive --format=tar.gz --prefix=sky-src/ -o "$WORK/source.tar.gz" HEAD && ok "git archive HEAD ($(git -C "$SRC_DIR" rev-parse --short HEAD))"
  else tar czf "$WORK/source.tar.gz" -C "$(dirname "$SRC_DIR")" --exclude=node_modules --exclude=dist --exclude=.git --transform "s,^$(basename "$SRC_DIR"),sky-src," "$(basename "$SRC_DIR")"; warn "это не git-репозиторий — взята копия каталога без node_modules и dist"; fi
fi

echo "==> 4. Реквизиты и скрипты"
{ echo "Sky: набор для переноса $STAMP"; echo "Старый сервер: $(hostname)"; echo "Домен: $(get_env DOMAIN)  Лендинг: $(get_env SITE_DOMAIN)  Резервный: $(get_env RESERVE_DOMAIN)"
  echo "Версия кода: $(git -C "$SRC_DIR" rev-parse --short HEAD 2>/dev/null || echo ?)"
  echo "Сертификаты внутри: $([ "$WITH_CERTS" = 1 ] && echo да || echo нет)"
  echo "Исходники внутри: $([ "$NO_SOURCE" = 1 ] && echo нет || echo да)"
  echo; echo "Файлы в S3-хранилище (если STORAGE_PRIMARY=s3) в набор НЕ входят — они остаются у хостера, новому серверу нужны те же ключи S3 (они внутри config)."
  echo "Как восстановить: см. РЕСТАВРАЦИЯ.md в каталоге migration/ или:  unzip -p <этот.zip> restore.sh > restore.sh; bash restore.sh --zip <этот.zip> --key backup.key"; } > "$WORK/РЕКВИЗИТЫ.txt"
cp "$HERE/restore.sh" "$HERE/upload.sh" "$WORK/"; [ -f "$HERE/README.md" ] && cp "$HERE/README.md" "$WORK/README.md"

echo "==> 5. Один zip"
ZIP="$OUT/sky-migration-$STAMP.zip"
# -0: без сжатия (внутри уже сжатое и зашифрованное), -X: без лишних атрибутов. Каталог payload/ лежит внутри.
( cd "$WORK" && zip -0 -X -q -r "$ZIP" payload STATS.txt РЕКВИЗИТЫ.txt restore.sh upload.sh $( [ -f README.md ] && echo README.md ) $( [ -f source.tar.gz ] && echo source.tar.gz ) )
chmod 600 "$ZIP"
unzip -tq "$ZIP" >/dev/null || die "Готовый zip не прошёл проверку целостности."
( cd "$OUT" && sha256sum "$(basename "$ZIP")" > "$(basename "$ZIP").sha256" ); chmod 600 "$ZIP.sha256"
ok "$(du -h "$ZIP" | cut -f1)  $ZIP (целостность проверена)"
cat <<MSG

ГОТОВО: $ZIP
         $ZIP.sha256

Дальше (с этого сервера или с вашего компьютера):
  1. Загрузить на новый сервер:   bash $HERE/upload.sh --to root@НОВЫЙ_IP --zip $ZIP
  2. На новом сервере:            bash restore.sh --zip /root/sky-migration/$(basename "$ZIP") --key /путь/backup.key
Секретный ключ age (backup.key) в zip нет — держите его отдельно от zip. После переноса удалите ключ и zip с нового сервера.
MSG
