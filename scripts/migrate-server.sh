#!/usr/bin/env bash
# ============================================================
#  Перенос Sky на другой сервер «на всякий случай».
#
#   СТАРЫЙ сервер (или любой исправный):
#      sudo bash scripts/migrate-server.sh check                       # что мешает упаковке
#      sudo bash scripts/migrate-server.sh pack [--out DIR] [--with-certs] [--push]
#   НОВЫЙ сервер (чистая Ubuntu, repo уже склонирован, Docker поставлен — scripts/bootstrap-server.sh):
#      sudo bash scripts/migrate-server.sh check --new
#      sudo bash scripts/migrate-server.sh restore --from DIR  --key /путь/backup.key   [--app-dir /opt/sky] [--yes] [--force] [--skip-deploy]
#      sudo bash scripts/migrate-server.sh restore --from-storage --s3-env /путь/s3.env --key /путь/backup.key
#
#  pack  — свежий набор: база (db-*), файлы (files-*), .env и secrets/ (config-*), настройки хоста: таймеры, SSH-шлюз, Sky Control… (host-config-*),
#          по желанию сертификаты (certs-*, --with-certs) — всё зашифровано age; MANIFEST.txt с контрольными суммами. --push — ещё и в хранилище копий.
#  restore — раскладывает config в APP_DIR, поднимает postgres/redis, заливает базу в ПУСТУЮ базу, собирает и запускает приложение (deploy-local.sh),
#          восстанавливает файлы в тома, возвращает настройки хоста и сертификаты и печатает, что переключить вручную (DNS, таймеры).
#  Ничего на старом сервере не останавливает и не удаляет. Секретный ключ age (--key) читается только для расшифровки; после переноса удалите его с сервера.
#
#  Порядок «на всякий случай»:  1) pack (можно по расписанию — install-backup.sh --storage даёт то же без host-config и certs);
#   2) на новом сервере check --new → restore; 3) проверить сайт по hosts/временному домену; 4) включить «Технические работы» на старом, сделать pack ещё раз
#   (разница — минуты), restore повторить на свежем стенде либо принять потерю последних минут; 5) переключить DNS; 6) выпустить сертификат, если certs не переносили.
# ============================================================
set -euo pipefail
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${APP_DIR:-/opt/sky}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
cmd="${1:-help}"; shift || true
OUT=""; WITH_CERTS=0; PUSH=0; NEW=0; FROM=""; FROM_STORAGE=0; S3ENV=""; KEY=""; YES=0; FORCE=0; SKIP_DEPLOY=0
while [ $# -gt 0 ]; do case "$1" in
  --out) OUT="$2"; shift 2;; --with-certs) WITH_CERTS=1; shift;; --push) PUSH=1; shift;; --new) NEW=1; shift;;
  --from) FROM="$2"; shift 2;; --from-storage) FROM_STORAGE=1; shift;; --s3-env) S3ENV="$2"; shift 2;; --key) KEY="$2"; shift 2;;
  --app-dir) APP_DIR="$2"; shift 2;; --yes) YES=1; shift;; --force) FORCE=1; shift;; --skip-deploy) SKIP_DEPLOY=1; shift;;
  *) echo "Неизвестный параметр: $1"; exit 1;; esac; done

ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✖\033[0m %s\n' "$*"; BAD=1; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
BAD=0
[ "$(id -u)" = 0 ] || die "Нужен root."
get_env() { grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//" || true; }
need() { command -v "$1" >/dev/null 2>&1 && ok "$1" || bad "нет $1${2:+ — $2}"; }
dc() { ( cd "$APP_DIR" && docker compose "$@" ); }
hb_host() { # hostbackup-s3 в одноразовом контейнере node (api-образ на новом сервере ещё не собран): $1 — каталог на хосте, остальное — аргументы
  local dir="$1"; shift
  docker run --rm --user root --env-file "$S3ENV" -e STORAGE_S3_ALLOW_INSECURE="${STORAGE_S3_ALLOW_INSECURE:-0}" -v "$dir:/work" -v "$SRC_DIR/scripts/hostbackup-s3.mjs:/app/scripts/hostbackup-s3.mjs:ro" \
    -v "$SRC_DIR/server/skystorages3.mjs:/app/server/skystorages3.mjs:ro" -w /app node:22-slim node scripts/hostbackup-s3.mjs "$@"; }
dec() { age -d -i "$KEY" "$1"; }   # расшифровка в stdout

# ---------------------------------------------------------------- check
if [ "$cmd" = check ]; then
  if [ "$NEW" = 1 ]; then
    echo "== Проверка НОВОГО сервера"
    need docker; docker compose version >/dev/null 2>&1 && ok "docker compose" || bad "нет docker compose"
    need age "apt install -y age"; need gzip; need tar; need curl
    [ -f "$SRC_DIR/docker-compose.yml" ] && ok "репозиторий: $SRC_DIR" || bad "в $SRC_DIR нет docker-compose.yml"
    free_gb=$(df -P --output=avail -BG "$(dirname "$APP_DIR")" 2>/dev/null | tail -n1 | tr -dc 0-9); [ "${free_gb:-0}" -ge 20 ] && ok "свободно ${free_gb} ГБ" || warn "свободно ${free_gb:-?} ГБ — на базу, файлы и образы нужно с запасом"
    for p in 80 443; do ss -ltn "sport = :$p" 2>/dev/null | grep -q LISTEN && warn "порт $p уже занят" || ok "порт $p свободен"; done
    [ -e "$APP_DIR/.env" ] && warn "в $APP_DIR уже есть .env — при restore он будет сохранён как .env.before-restore" || ok "$APP_DIR/.env нет"
    if [ -n "$KEY" ]; then [ -r "$KEY" ] && grep -q AGE-SECRET-KEY "$KEY" && ok "секретный ключ age читается" || bad "--key: не похоже на секретный ключ age"; else warn "ключ age не указан (--key) — на restore он обязателен"; fi
  else
    echo "== Проверка СТАРОГО сервера (перед pack)"
    need docker; need age "apt install -y age"; need tar; need gzip
    [ -f "$APP_DIR/docker-compose.yml" ] && [ -f "$APP_DIR/.env" ] && ok "$APP_DIR: compose и .env" || bad "в $APP_DIR нет compose или .env"
    [ -n "$(get_env BACKUP_AGE_RECIPIENT)" ] && ok "публичный ключ age задан" || bad "нет BACKUP_AGE_RECIPIENT в .env (bash scripts/install-backup.sh --genkey)"
    dc ps --status running --services 2>/dev/null | grep -qx postgres && ok "postgres работает" || bad "postgres не запущен"
    dc ps --status running --services 2>/dev/null | grep -qx api && ok "api работает" || bad "api не запущен"
    used=$(du -sm /var/lib/docker/volumes 2>/dev/null | cut -f1); free=$(df -P --output=avail -BM "${OUT:-/root}" | tail -n1 | tr -dc 0-9)
    [ "${free:-0}" -gt "${used:-0}" ] && ok "места на набор хватает (данных ≈ ${used:-?} МБ, свободно ${free} МБ)" || warn "места может не хватить (данных ≈ ${used:-?} МБ, свободно ${free:-?} МБ) — задайте --out на большой диск"
    [ -n "$(get_env STORAGE_BACKUP_S3_BUCKET)" ] && ok "хранилище копий настроено (для --push)" || warn "хранилище копий не настроено — --push недоступен"
  fi
  [ "$BAD" = 0 ] && echo "Можно продолжать." || { echo "Есть проблемы — исправьте и повторите."; exit 1; }
  exit 0
fi

# ---------------------------------------------------------------- pack
if [ "$cmd" = pack ]; then
  OUT="${OUT:-/root/sky-migrate-$STAMP}"
  AGE_PUB="$(get_env BACKUP_AGE_RECIPIENT)"
  [ -n "$AGE_PUB" ] || die "Нет BACKUP_AGE_RECIPIENT в $APP_DIR/.env: bash scripts/install-backup.sh --genkey (копии без шифрования не делаем)."
  command -v age >/dev/null || die "Нужна программа age (apt install -y age)."
  mkdir -p "$OUT"; chmod 700 "$OUT"
  echo "==> База, файлы, .env и secrets/ (scripts/backup.sh)"
  APP_DIR="$APP_DIR" DEST="$OUT" KEEP=1 BACKUP_AGE_RECIPIENT="$AGE_PUB" bash "$SRC_DIR/scripts/backup.sh"
  echo "==> Настройки хоста (таймеры, SSH-шлюз, Sky Control…)"
  HC=(); for f in /etc/sky-backup.env /etc/sky-watchdog.env /etc/sky-ssh-gate.conf /etc/sky-ssh-gate.totp /etc/sky-rescue.user /etc/sky-control /etc/sky-guard.env /etc/sky-sandbox.env /etc/sky-ssh-gate.off; do [ -e "$f" ] && HC+=("${f#/}"); done
  if [ "${#HC[@]}" -gt 0 ]; then tar czf - -C / "${HC[@]}" 2>/dev/null | age -r "$AGE_PUB" > "$OUT/host-config-$STAMP.tar.gz.age"; ok "host-config-$STAMP.tar.gz.age (${#HC[@]} путей)"; else warn "настроек хоста не найдено"; fi
  if [ "$WITH_CERTS" = 1 ]; then
    echo "==> Сертификаты (закрытые ключи! только в зашифрованном виде)"
    dc run --rm --no-deps -T --entrypoint sh certbot -c 'tar czf - -C /etc/letsencrypt .' | age -r "$AGE_PUB" > "$OUT/certs-$STAMP.tar.gz.age"; ok "certs-$STAMP.tar.gz.age"
  fi
  echo "==> Опись"
  { echo "Sky: набор для переноса $STAMP"; echo "Домен: $(get_env DOMAIN)  Лендинг: $(get_env SITE_DOMAIN)  Резервный: $(get_env RESERVE_DOMAIN)"
    echo "Версия кода: $(cd "$SRC_DIR" && git rev-parse --short HEAD 2>/dev/null || echo ?)"
    echo "Образы: $(get_env WEB_IMAGE) $(get_env API_IMAGE)"
    echo "Таймеры/службы хоста: $(systemctl list-unit-files 'sky-*' --no-legend 2>/dev/null | awk '{print $1}' | tr '\n' ' ')"
    echo; echo "sha256:"; ( cd "$OUT" && sha256sum *.age ); } > "$OUT/MANIFEST.txt"
  cat "$OUT/MANIFEST.txt" | sed -n 1,6p
  if [ "$PUSH" = 1 ]; then
    echo "==> В хранилище копий"
    ( cd "$APP_DIR" && docker compose run --rm --no-deps -T --user root -v "$OUT:/backups" -v "$SRC_DIR/scripts/hostbackup-s3.mjs:/app/scripts/hostbackup-s3.mjs:ro" -v "$SRC_DIR/server/skystorages3.mjs:/app/server/skystorages3.mjs:ro" api node scripts/hostbackup-s3.mjs push /backups )
  fi
  cat <<MSG

Набор готов: $OUT
  • Скопируйте его на новый сервер (rsync -a $OUT/ root@новый:/root/sky-migrate/) или возьмите из хранилища копий (restore --from-storage).
  • Секретный ключ age (backup.key) и ENCRYPTION_KEY храните ВНЕ серверов — без ключа age набор не открыть. ENCRYPTION_KEY уже внутри config-*.age.
  • Дальше на новом сервере:  bash scripts/migrate-server.sh check --new   →   restore --from <каталог> --key <backup.key>
MSG
  exit 0
fi

# ---------------------------------------------------------------- restore
if [ "$cmd" = restore ]; then
  command -v age >/dev/null || die "Нужна программа age (apt install -y age)."
  command -v docker >/dev/null || die "Нужен Docker (bash scripts/bootstrap-server.sh)."
  [ -r "$KEY" ] || die "Укажите секретный ключ age: --key /путь/backup.key"
  grep -q AGE-SECRET-KEY "$KEY" || die "--key не похож на секретный ключ age."
  if [ "$FROM_STORAGE" = 1 ]; then
    [ -r "$S3ENV" ] || die "Для --from-storage нужен файл с STORAGE_BACKUP_S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY/PREFIX: --s3-env /путь/s3.env"
    FROM="$(mktemp -d /root/sky-restore.XXXXXX)"; chmod 700 "$FROM"
    echo "==> Скачиваю свежий набор из хранилища копий"
    hb_host "$FROM" pull latest /work
    hb_host "$FROM" pull "$(hb_host "$FROM" list | awk -F'\t' '/^host-config-/{print $1; exit}')" /work 2>/dev/null || true
    hb_host "$FROM" pull "$(hb_host "$FROM" list | awk -F'\t' '/^certs-/{print $1; exit}')" /work 2>/dev/null || true
  fi
  [ -d "$FROM" ] || die "Укажите каталог набора: --from DIR (или --from-storage)."
  latest() { ls -1t "$FROM"/$1-*.age 2>/dev/null | head -n1; }
  DB="$(latest db)"; FILES="$(latest files)"; CFG="$(latest config)"; HCF="$(latest host-config)"; CERTS="$(latest certs)"
  [ -n "$DB" ] && [ -n "$FILES" ] && [ -n "$CFG" ] || die "В $FROM нет db-*, files-* или config-* (.age)."
  [ -f "$FROM/MANIFEST.txt" ] && ( cd "$FROM" && grep -E '^[0-9a-f]{64}  ' MANIFEST.txt | sha256sum -c --quiet - ) && ok "контрольные суммы набора сходятся" || warn "MANIFEST.txt нет или суммы не сошлись — продолжайте только если понимаете почему"
  echo "Будет восстановлено в $APP_DIR:  $(basename "$DB"), $(basename "$FILES"), $(basename "$CFG")${HCF:+, $(basename "$HCF")}${CERTS:+, $(basename "$CERTS")}"
  if [ "$YES" != 1 ]; then read -r -p "Продолжить? [y/N] " a; [ "$a" = y ] || [ "$a" = Y ] || die "Отменено."; fi

  echo "==> 1. Проверка расшифровки"
  dec "$CFG" | tar tzf - >/dev/null || die "Не удалось расшифровать config: неверный ключ age?"
  ok "ключ подходит"

  echo "==> 2. Настройки (.env, secrets/) → $APP_DIR"
  mkdir -p "$APP_DIR"
  [ -e "$APP_DIR/.env" ] && mv "$APP_DIR/.env" "$APP_DIR/.env.before-restore" && warn "прежний .env сохранён как .env.before-restore"
  dec "$CFG" | tar xzf - -C "$APP_DIR"
  chmod 600 "$APP_DIR/.env"; [ -d "$APP_DIR/secrets" ] && chmod 700 "$APP_DIR/secrets"
  ok ".env и secrets/ на месте (ENCRYPTION_KEY и остальные — те же, что на старом сервере)"
  if [ "$(cd "$SRC_DIR" && pwd -P)" != "$(cd "$APP_DIR" && pwd -P)" ]; then cp "$SRC_DIR/docker-compose.yml" "$APP_DIR/docker-compose.yml"; mkdir -p "$APP_DIR/scripts"; cp -r "$SRC_DIR/scripts/." "$APP_DIR/scripts/"; fi

  echo "==> 3. База данных"
  dc up -d postgres redis
  for _ in $(seq 1 30); do dc exec -T postgres pg_isready -U sky >/dev/null 2>&1 && break; sleep 2; done
  tables="$(dc exec -T postgres psql -U sky sky -Atc "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null | tr -d '\r' || echo 0)"
  if [ "${tables:-0}" -gt 0 ] && [ "$FORCE" != 1 ]; then die "База уже не пустая ($tables таблиц). Восстановление поверх чужих данных не делаю (--force — только если уверены)."; fi
  dec "$DB" | gunzip | dc exec -T postgres psql -U sky sky -v ON_ERROR_STOP=1 -q >/dev/null
  ok "база восстановлена: $(dc exec -T postgres psql -U sky sky -Atc "select count(*) from profiles" | tr -d '\r') профилей"

  if [ "$SKIP_DEPLOY" != 1 ]; then
    echo "==> 4. Сборка и запуск приложения (deploy-local.sh)"
    APP_DIR="$APP_DIR" SRC_DIR="$SRC_DIR" SKIP_PULL=1 bash "$SRC_DIR/scripts/deploy-local.sh"
  fi

  echo "==> 5. Файлы (музыка, кино, книги, вложения…)"
  dec "$FILES" | dc exec -T --user root api tar xzf - -C /data
  dc restart api >/dev/null
  ok "файлы возвращены в тома, api перезапущен"

  if [ -n "$CERTS" ]; then
    echo "==> 6. Сертификаты"
    dec "$CERTS" | dc run --rm --no-deps -T --entrypoint sh certbot -c 'tar xzf - -C /etc/letsencrypt'
    dc restart web >/dev/null 2>&1 || true
    ok "сертификаты возвращены (действуют, пока домен указывает на сервер и срок не вышел)"
  fi
  if [ -n "$HCF" ]; then
    echo "==> 7. Настройки хоста"
    dec "$HCF" | tar xzf - -C / && ok "файлы /etc/sky-* возвращены"
  fi

  echo "==> Проверка"
  dc ps --format 'table {{.Service}}\t{{.Status}}'
  curl -fsS -m 10 http://127.0.0.1/healthz >/dev/null 2>&1 && ok "/healthz отвечает" || warn "/healthz пока не отвечает (nginx слушает 80? сертификат нужен для 443)"
  cat <<MSG

Что осталось вручную:
  1. Проверьте сайт до переключения: в /etc/hosts своего компьютера впишите IP нового сервера и домен $(get_env DOMAIN), войдите, откройте музыку/кино/чат.
  2. DNS: A-записи $(get_env DOMAIN), $(get_env SITE_DOMAIN), $(get_env RESERVE_DOMAIN) → IP нового сервера (при Cloudflare — серое облако на время выпуска сертификата).
  3. Сертификат (если certs не переносили): bash scripts/init-letsencrypt.sh   (и add-site-cert.sh / add-reserve-domain.sh, если эти домены есть).
  4. Службы хоста (не переезжают сами): bash scripts/install-watchdog.sh; bash scripts/install-backup.sh --install --storage; при необходимости setup-ssh-gate.sh, install-control.sh, rescue-access.sh.
  5. Ключи S3 хранилища/копий в .env — те же; убедитесь в админке Sky Storage, что площадка доступна. Старый сервер не выключайте, пока новый не отработал сутки.
  6. Удалите с сервера секретный ключ age ($KEY) и каталог набора, если он больше не нужен.
MSG
  exit 0
fi

sed -n 2,26p "$0"; exit 1
