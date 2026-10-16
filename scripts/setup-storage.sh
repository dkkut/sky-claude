#!/usr/bin/env bash
# ============================================================
#  Sky Storage: подключение площадки резервных копий и ключа шифрования копий.
#
#      bash /opt/sky-src/scripts/setup-storage.sh            # настроить S3 (сам найдёт .env в /opt/sky) и ключ (идемпотентно)
#      bash scripts/setup-storage.sh --check                       # что настроено (без значений секретов)
#      bash scripts/setup-storage.sh --rotate                      # выпустить НОВЫЙ ключ шифрования копий (старый остаётся для чтения)
#      bash scripts/setup-storage.sh --export-kek /путь/файл       # записать ключи копий в файл (права 600) — хранить ОТДЕЛЬНО от сервера
#
#  Что делает:
#   1. Спрашивает адрес S3, регион, бакет, ключ доступа и секретный ключ (секрет — скрыто, на экран не печатается).
#   2. Выпускает KEK — ключ шифрования копий (STORAGE_KEK_K1), если его ещё нет. Существующий НЕ меняется:
#      без него уже созданные копии не расшифровать. Это отдельная сущность от ENCRYPTION_KEY и JWT_SECRET.
#   3. Пишет значения в .env (права 600), проверяет подключение живым запросом: список, запись, чтение, диапазон, удаление
#      тестового объекта; сам подбирает стиль адреса (endpoint/бакет или бакет.endpoint).
#   4. Подсказывает применить: bash scripts/deploy-local.sh
#  ВАЖНО: ключ шифрования копий сохраните отдельно (менеджер паролей/офлайн): потеряли — копии не открыть.
# ============================================================
set -euo pipefail
# Где лежит .env: APP_DIR, текущий каталог, каталог скрипта, затем /opt/sky (рабочий каталог приложения;
# /opt/sky-src — только исходники и .env там нет). Дальше работаем именно там: рядом с .env лежит docker-compose.yml.
HERE="$(cd "$(dirname "$0")/.." && pwd)"
for d in "${APP_DIR:-}" "$PWD" "$HERE" /opt/sky; do
  [ -n "$d" ] && [ -f "$d/.env" ] && { cd "$d"; break; }
done
[ -f .env ] || { echo "Нет .env ни в текущем каталоге, ни в $HERE, ни в /opt/sky — задайте APP_DIR=/путь/к/каталогу/приложения."; exit 1; }
# Скрипт проверки подключения лежит в исходниках, а образ api уже содержит каталог scripts/ из последней сборки.
SRC_DIR="$HERE"

get_env() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//" || true; }
set_env() {
  local key="$1" val="$2" tmp found=0 line
  tmp="$(mktemp .env.XXXXXX)"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" == "$key="* ]]; then if [ "$found" = 0 ]; then printf '%s=%s\n' "$key" "$val" >> "$tmp"; found=1; fi
    else printf '%s\n' "$line" >> "$tmp"; fi
  done < .env
  [ "$found" = 1 ] || printf '%s=%s\n' "$key" "$val" >> "$tmp"
  chmod 600 "$tmp"; mv "$tmp" .env
}
show() { if [ -n "$2" ]; then echo "  ✔ $1: задано"; else echo "  ✖ $1: не задано${3:+ — $3}"; fi; }
newkey() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }

status() {
  echo "Состояние Sky Storage (из .env):"
  show "STORAGE_BACKUP_TARGET" "$(get_env STORAGE_BACKUP_TARGET)" "bash scripts/setup-storage.sh"
  show "STORAGE_S3_ENDPOINT" "$(get_env STORAGE_S3_ENDPOINT)"
  show "STORAGE_S3_BUCKET" "$(get_env STORAGE_S3_BUCKET)"
  show "STORAGE_S3_REGION" "$(get_env STORAGE_S3_REGION)"
  show "STORAGE_S3_ACCESS_KEY" "$(get_env STORAGE_S3_ACCESS_KEY)"
  show "STORAGE_S3_SECRET_KEY" "$(get_env STORAGE_S3_SECRET_KEY)"
  show "STORAGE_KEK_ACTIVE (активный ключ шифрования копий)" "$(get_env STORAGE_KEK_ACTIVE)"
  for k in K1 K2 K3 K4; do [ -n "$(get_env STORAGE_KEK_$k)" ] && echo "  ✔ STORAGE_KEK_$k: есть"; done
  true
}

# Образ api мог быть собран до появления проверки: подаём скрипт и модуль S3 из исходников через том-на-лету.
probe() { docker compose run --rm --no-deps -T -v "$SRC_DIR/scripts/storage-probe.mjs:/app/scripts/storage-probe.mjs:ro" -v "$SRC_DIR/server/skystorages3.mjs:/app/server/skystorages3.mjs:ro" api node scripts/storage-probe.mjs "${1:-}" 2>&1; }

case "${1:-}" in
  --check) status; exit 0 ;;
  -h|--help) sed -n 2,19p "$0"; exit 0 ;;
  --export-kek)
    out="${2:-}"; [ -n "$out" ] || { echo "Укажите файл: --export-kek /путь/sky-kek.txt"; exit 1; }
    [ ! -e "$out" ] || { echo "Файл уже есть: $out — выберите другой путь."; exit 1; }
    ( umask 077; { echo "# Ключи шифрования резервных копий Sky Storage — хранить отдельно от сервера и от копий"; for k in K1 K2 K3 K4; do v="$(get_env STORAGE_KEK_$k)"; [ -n "$v" ] && echo "STORAGE_KEK_$k=$v"; done; echo "STORAGE_KEK_ACTIVE=$(get_env STORAGE_KEK_ACTIVE)"; } > "$out" )
    echo "Ключи записаны в $out (права 600). Перенесите файл в менеджер паролей/на офлайн-носитель и удалите его с сервера."; exit 0 ;;
  --rotate)
    cur="$(get_env STORAGE_KEK_ACTIVE)"; [ -n "$cur" ] || { echo "Ключа ещё нет — сначала обычная настройка."; exit 1; }
    next=""; for k in K1 K2 K3 K4; do [ -z "$(get_env STORAGE_KEK_$k)" ] && { next="$k"; break; }; done
    [ -n "$next" ] || { echo "Все четыре слота ключей заняты. Старый ненужный ключ можно убрать из .env, только если ни одна копия им не зашифрована."; exit 1; }
    set_env "STORAGE_KEK_$next" "$(newkey)"; set_env STORAGE_KEK_ACTIVE "$next"
    echo "Новый ключ $next стал активным; $cur остаётся в .env для чтения старых копий."
    echo "Дальше: bash scripts/deploy-local.sh, затем в админке Sky Storage → «Ключи» — перешифровка заголовков копий. Сохраните новый ключ: --export-kek файл"; exit 0 ;;
esac

echo "== Sky Storage: площадка копий (S3-совместимая) =="
ep="$(get_env STORAGE_S3_ENDPOINT)"; reg="$(get_env STORAGE_S3_REGION)"; bk="$(get_env STORAGE_S3_BUCKET)"; ak="$(get_env STORAGE_S3_ACCESS_KEY)"
read -r -p "Адрес S3 [${ep:-https://s3.example.com}]: " v; ep="${v:-$ep}"
read -r -p "Регион [${reg:-us-east-1}]: " v; reg="${v:-${reg:-us-east-1}}"
read -r -p "Бакет (контейнер) [${bk}]: " v; bk="${v:-$bk}"
read -r -p "Ключ доступа (Access Key ID) [${ak}]: " v; ak="${v:-$ak}"
[[ "$ep" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || { echo "Адрес должен быть вида https://хост (только https)."; exit 1; }
[ -n "$bk" ] && [ -n "$ak" ] || { echo "Бакет и ключ доступа обязательны."; exit 1; }
sk="$(get_env STORAGE_S3_SECRET_KEY)"
if [ -n "$sk" ]; then read -r -s -p "Секретный ключ (Enter — оставить прежний): " v; echo; sk="${v:-$sk}"
else read -r -s -p "Секретный ключ (скрыто): " sk; echo; fi
[ "${#sk}" -ge 8 ] || { echo "Секретный ключ не введён."; exit 1; }

set_env STORAGE_BACKUP_TARGET s3
set_env STORAGE_S3_ENDPOINT "${ep%/}"; set_env STORAGE_S3_REGION "$reg"; set_env STORAGE_S3_BUCKET "$bk"
set_env STORAGE_S3_ACCESS_KEY "$ak"; set_env STORAGE_S3_SECRET_KEY "$sk"
[ -n "$(get_env STORAGE_S3_PREFIX)" ] || set_env STORAGE_S3_PREFIX "sky-backups/"

if [ -z "$(get_env STORAGE_KEK_ACTIVE)" ] || [ -z "$(get_env "STORAGE_KEK_$(get_env STORAGE_KEK_ACTIVE)")" ]; then
  set_env STORAGE_KEK_K1 "$(newkey)"; set_env STORAGE_KEK_ACTIVE K1
  echo
  echo "Выпущен ключ шифрования копий (K1). СОХРАНИТЕ ЕГО ОТДЕЛЬНО ОТ СЕРВЕРА: bash scripts/setup-storage.sh --export-kek /путь/файл"
fi

echo; echo "== Проверка подключения =="
if command -v docker >/dev/null 2>&1; then
  out="$(probe)"; echo "$out"
  style="$(echo "$out" | sed -n 's/^STYLE=//p' | tail -n1)"
  if [ -n "$style" ]; then
    [ "$style" = path ] && set_env STORAGE_S3_PATH_STYLE 1 || set_env STORAGE_S3_PATH_STYLE 0
    echo; echo "✔ Площадка работает (стиль адреса: $style). Применить: bash scripts/deploy-local.sh"
  else echo; echo "✖ Подключение не прошло — значения сохранены, исправьте их и запустите скрипт снова."; exit 1; fi
else echo "docker не найден — значения сохранены, проверку выполните позже: docker compose run --rm --no-deps -T api node scripts/storage-probe.mjs"; fi
status
