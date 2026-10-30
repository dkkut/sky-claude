#!/usr/bin/env bash
# ============================================================
#  ВОССТАНОВЛЕНИЕ Sky ИЗ ОДНОГО ZIP на НОВОМ сервере (чистая Ubuntu).  От root.
#
#      sudo bash restore.sh --zip /root/sky-migration/sky-migration-….zip --key /путь/backup.key  [--yes] [--force] [--skip-deploy] [--strict] [--keep-extracted]
#
#  Что делает, по порядку:
#    1. ставит недостающее (unzip, age, curl) и проверяет Docker;
#    2. проверяет zip (целостность и, если лежит рядом, .sha256) и распаковывает в рабочий каталог;
#    3. сверяет sha256 КАЖДОЙ части набора с MANIFEST.txt — повреждённое не восстанавливает;
#    4. если на сервере ещё нет кода Sky — берёт его из source.tar.gz внутри zip (GitHub не нужен);
#    5. проверяет, что ключ age открывает набор, и восстанавливает: настройки (.env, secrets/) → база (в ПУСТУЮ базу) → сборка и запуск → файлы → сертификаты → настройки хоста
#       (это делает scripts/migrate-server.sh restore; поверх непустой базы не пишет без --force);
#    6. СВЕРКА «БЕЗ ПОТЕРЬ»: сравнивает число строк в каждой таблице и число/объём файлов с STATS.txt, снятым при упаковке. Меньше, чем было, — потеря: об этом
#       сказано прямо, код выхода 3 (с --strict — и при любой разнице в таблицах).
#    7. удаляет распакованное (оно зашифровано, но лишнее) — кроме случая --keep-extracted.
#  Секретный ключ age читается только для расшифровки; после переноса удалите его и zip с этого сервера.
#  Старый сервер не трогайте, пока новый не отработал сутки.
# ============================================================
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/sky}"; SRC_DIR="${SRC_DIR:-/opt/sky-src}"
ZIP=""; KEY=""; YES=0; FORCE=0; SKIP_DEPLOY=0; STRICT=0; KEEP=0; WORK=""
while [ $# -gt 0 ]; do case "$1" in
  --zip) ZIP="$2"; shift 2;; --key) KEY="$2"; shift 2;; --app-dir) APP_DIR="$2"; shift 2;; --src-dir) SRC_DIR="$2"; shift 2;; --work) WORK="$2"; shift 2;;
  --yes) YES=1; shift;; --force) FORCE=1; shift;; --skip-deploy) SKIP_DEPLOY=1; shift;; --strict) STRICT=1; shift;; --keep-extracted) KEEP=1; shift;;
  -h|--help) sed -n 2,22p "$0"; exit 0;; *) echo "Неизвестный параметр: $1"; exit 1;; esac; done
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "Нужен root."
[ -f "$ZIP" ] || die "Укажите zip: --zip /путь/sky-migration-….zip"
[ -r "$KEY" ] && grep -q AGE-SECRET-KEY "$KEY" || die "Укажите секретный ключ age: --key /путь/backup.key (файл с AGE-SECRET-KEY-…)"
MIGRATE_REL="scripts/migrate-server.sh"; STAMP="$(date +%Y-%m-%d_%H%M%S)"
WORK="${WORK:-/root/sky-restore-$STAMP}"

echo "==> 1. Программы"
miss=(); for c in unzip age curl sha256sum tar; do command -v "$c" >/dev/null 2>&1 || miss+=("$c"); done
if [ "${#miss[@]}" -gt 0 ]; then
  command -v apt-get >/dev/null 2>&1 || die "Не хватает: ${miss[*]} — поставьте вручную."
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unzip age curl coreutils tar >/dev/null && ok "установлено: ${miss[*]}"
else ok "unzip, age, curl на месте"; fi

echo "==> 2. Проверка zip"
unzip -tq "$ZIP" >/dev/null || die "zip повреждён (не прошёл unzip -t): скачайте/загрузите заново (upload.sh докачивает)."
ok "целостность zip"
if [ -f "$ZIP.sha256" ]; then ( cd "$(dirname "$ZIP")" && sha256sum -c --quiet "$(basename "$ZIP").sha256" ) && ok "sha256 zip сходится" || die "sha256 zip НЕ сходится — файл испорчен при передаче."; else warn "рядом нет $(basename "$ZIP").sha256 — пропускаю"; fi
need_mb=$(( $(du -m "$ZIP" | cut -f1) * 2 + 1024 )); free_mb=$(df -Pm "$(dirname "$WORK")" | awk 'NR==2{print $4}' | tr -dc 0-9)
[ "${free_mb:-0}" -ge "$need_mb" ] || die "Мало места для распаковки: нужно ≈ ${need_mb} МБ, свободно ${free_mb:-?} МБ (задайте --work на диск побольше)."
mkdir -p "$WORK"; chmod 700 "$WORK"
[ "$KEEP" = 1 ] || trap 'rm -rf "$WORK"' EXIT
unzip -q -o "$ZIP" -d "$WORK"; ok "распаковано в $WORK"
PAY="$WORK/payload"; [ -d "$PAY" ] || die "В zip нет каталога payload/ — это не набор для переноса Sky."
[ -f "$WORK/РЕКВИЗИТЫ.txt" ] && sed -n 1,6p "$WORK/РЕКВИЗИТЫ.txt" | sed 's/^/    /'

echo "==> 3. Контрольные суммы частей набора"
if [ -f "$PAY/MANIFEST.txt" ]; then
  ( cd "$PAY" && grep -E '^[0-9a-f]{64}  ' MANIFEST.txt | sha256sum -c --quiet - ) && ok "все части набора целы" || die "Часть набора повреждена — восстановление остановлено. Соберите zip заново (pack.sh) или передайте его ещё раз."
else die "В наборе нет MANIFEST.txt — проверить целостность нельзя, останавливаюсь."; fi
for f in db files config; do ls "$PAY"/$f-*.age >/dev/null 2>&1 || die "В наборе нет $f-*.age."; done

echo "==> 4. Код Sky"
if [ ! -f "$SRC_DIR/docker-compose.yml" ]; then
  [ -f "$WORK/source.tar.gz" ] || die "На сервере нет кода Sky ($SRC_DIR) и в zip нет source.tar.gz. Склонируйте репозиторий в $SRC_DIR и повторите."
  mkdir -p "$SRC_DIR"; tar xzf "$WORK/source.tar.gz" -C "$SRC_DIR" --strip-components=1; ok "код развёрнут из zip в $SRC_DIR"
else ok "код уже есть: $SRC_DIR"; fi
[ -f "$SRC_DIR/$MIGRATE_REL" ] || die "В $SRC_DIR нет $MIGRATE_REL — версия кода слишком старая."
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  if [ -f "$SRC_DIR/scripts/bootstrap-server.sh" ]; then echo "    Docker не найден — запускаю scripts/bootstrap-server.sh"; bash "$SRC_DIR/scripts/bootstrap-server.sh"; else die "Нужен Docker с compose."; fi
fi
command -v docker >/dev/null 2>&1 || die "Docker так и не появился."

echo "==> 5. Ключ и восстановление"
age -d -i "$KEY" "$(ls -1t "$PAY"/config-*.age | head -n1)" | tar tzf - >/dev/null 2>&1 || die "Ключ age не открывает набор (не тот backup.key?)."
ok "ключ age подходит"
args=(restore --from "$PAY" --key "$KEY" --app-dir "$APP_DIR"); [ "$YES" = 1 ] && args+=(--yes); [ "$FORCE" = 1 ] && args+=(--force); [ "$SKIP_DEPLOY" = 1 ] && args+=(--skip-deploy)
APP_DIR="$APP_DIR" bash "${MIGRATE_SH:-$SRC_DIR/$MIGRATE_REL}" "${args[@]}"

echo "==> 6. СВЕРКА «БЕЗ ПОТЕРЬ» (STATS.txt ↔ новый сервер)"
dc() { ( cd "$APP_DIR" && docker compose "$@" ); }
collect() {
  dc exec -T postgres psql -U sky sky -At -F'|' -c "select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1" | tr -d '\r' | sed 's/^/T|/'
  echo "F|files|$(dc exec -T api sh -c 'find /data -type f | wc -l' | tr -dc 0-9)"; echo "F|bytes|$(dc exec -T api sh -c 'du -sb /data | cut -f1' | tr -dc 0-9)"; }
LOSS=0; DIFF=0
if [ -f "$WORK/STATS.txt" ]; then
  NEW="$WORK/STATS.restored.txt"
  if [ -n "${RESTORED_STATS_FILE:-}" ]; then cp "$RESTORED_STATS_FILE" "$NEW"; else sleep 5; collect > "$NEW" 2>/dev/null || warn "не удалось снять счётчики на новом сервере"; fi
  if [ -s "$NEW" ]; then
    while IFS='|' read -r kind name was; do
      [ "$kind" = T ] || continue
      now="$(grep -F "T|$name|" "$NEW" | head -n1 | cut -d'|' -f3)"
      if [ -z "$now" ]; then printf '  \033[31m✖\033[0m таблицы %s нет на новом сервере (было %s строк)\n' "$name" "$was"; LOSS=1
      elif [ "$now" -lt "$was" ]; then printf '  \033[31m✖\033[0m %s: было %s, стало %s — ПОТЕРЯНО %s\n' "$name" "$was" "$now" "$((was-now))"; LOSS=1
      elif [ "$now" -gt "$was" ]; then DIFF=1; printf '  \033[33m!\033[0m %s: было %s, стало %s (+%s: записи, появившиеся при упаковке или после пуска)\n' "$name" "$was" "$now" "$((now-was))"; fi
    done < "$WORK/STATS.txt"
    wf="$(grep '^F|files|' "$WORK/STATS.txt" | cut -d'|' -f3)"; nf="$(grep '^F|files|' "$NEW" | cut -d'|' -f3)"
    wb="$(grep '^F|bytes|' "$WORK/STATS.txt" | cut -d'|' -f3)"; nb="$(grep '^F|bytes|' "$NEW" | cut -d'|' -f3)"
    if [ "${nf:-0}" -lt "${wf:-0}" ]; then printf '  \033[31m✖\033[0m файлов в /data: было %s, стало %s — ПОТЕРЯНО %s\n' "$wf" "$nf" "$((wf-nf))"; LOSS=1; else ok "файлов в /data: было $wf, стало $nf"; fi
    if [ "${nb:-0}" -lt "${wb:-0}" ]; then printf '  \033[31m✖\033[0m объём /data: было %s Б, стало %s Б\n' "$wb" "$nb"; LOSS=1; else ok "объём /data: было ${wb} Б, стало ${nb} Б"; fi
    [ "$LOSS" = 0 ] && ok "потерь нет: во всех таблицах строк не меньше, чем при упаковке; все файлы на месте"
  fi
else warn "в zip нет STATS.txt — сверку выполнить нечем"; fi

cat <<MSG

Что осталось вручную:
  1. Проверьте сайт до переключения: в /etc/hosts своего компьютера впишите IP этого сервера и домен, войдите, откройте музыку/кино/чат/кошелёк.
  2. DNS: A-записи домена (и лендинга, резервного) → IP этого сервера (при Cloudflare — серое облако на время выпуска сертификата).
  3. Сертификат, если в набор его не клали: bash $SRC_DIR/scripts/init-letsencrypt.sh   (и add-site-cert.sh / add-reserve-domain.sh).
  4. Службы хоста: bash $SRC_DIR/scripts/install-watchdog.sh; bash $SRC_DIR/scripts/install-backup.sh --install; при необходимости ssh-gate.sh, install-control.sh, rescue-access.sh.
  5. Удалите с этого сервера секретный ключ age ($KEY) и zip, когда сайт проверен. Старый сервер не выключайте сутки.
MSG
[ "$LOSS" = 1 ] && { echo; echo "ВНИМАНИЕ: сверка нашла потери (см. выше). Не переключайте DNS, пока не выясните причину; старый сервер не тронут."; exit 3; }
[ "$STRICT" = 1 ] && [ "$DIFF" = 1 ] && { echo "--strict: числа в таблицах не совпали до единицы — для точного совпадения упаковывайте при включённых «Технических работах»."; exit 3; }
exit 0
