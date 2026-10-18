#!/usr/bin/env bash
# ============================================================
#  Sky Storage: подключение площадки резервных копий и ключа шифрования копий.
#
#      bash /opt/sky-src/scripts/setup-storage.sh            # настроить S3 (сам найдёт .env в /opt/sky) и ключ (идемпотентно)
#      bash scripts/setup-storage.sh --check                       # что настроено (без значений секретов)
#      bash scripts/setup-storage.sh --rotate                      # выпустить НОВЫЙ ключ шифрования копий (старый остаётся для чтения)
#      bash scripts/setup-storage.sh --rotate-keys                 # заменить ключи доступа к S3 на новые (с проверкой и откатом при неудаче)
#      bash scripts/setup-storage.sh --export-kek /путь/файл       # записать ключи копий в файл (права 600) — хранить ОТДЕЛЬНО от сервера
#      bash scripts/setup-storage.sh --backup-bucket                # подключить ОТДЕЛЬНЫЙ бакет/хостер для резервных копий (STORAGE_BACKUP_S3_*)
#      bash scripts/setup-storage.sh --primary on [дней_кэша]      # хранить МЕДИА (музыка, кино, подкасты, книги…) в S3; на диске — кэш (по умолчанию 7 дней)
#      bash scripts/setup-storage.sh --primary off                 # вернуть хранение на диск сервера (файлы из S3 при этом НЕ удаляются)
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
  show "STORAGE_PRIMARY (медиа в S3)" "$(get_env STORAGE_PRIMARY)" "bash scripts/setup-storage.sh --primary on"
  show "STORAGE_KEK_ACTIVE (активный ключ шифрования копий)" "$(get_env STORAGE_KEK_ACTIVE)"
  for k in K1 K2 K3 K4; do [ -n "$(get_env STORAGE_KEK_$k)" ] && echo "  ✔ STORAGE_KEK_$k: есть"; done
  true
}

# Проверка идёт в контейнере api, но переменные подаём напрямую из .env: docker-compose.yml в рабочем каталоге мог
# ещё не обновиться (его обновляет deploy-local.sh). Скрипт и модуль S3 берём из исходников — образ мог быть собран раньше.
probe() {
  local envargs=() k
  for k in STORAGE_S3_ENDPOINT STORAGE_S3_REGION STORAGE_S3_BUCKET STORAGE_S3_ACCESS_KEY STORAGE_S3_SECRET_KEY STORAGE_S3_PREFIX STORAGE_S3_PATH_STYLE; do
    envargs+=(-e "$k=$(get_env "$k")")
  done
  docker compose run --rm --no-deps -T "${envargs[@]}" \
    -v "$SRC_DIR/scripts/storage-probe.mjs:/app/scripts/storage-probe.mjs:ro" -v "$SRC_DIR/server/skystorages3.mjs:/app/server/skystorages3.mjs:ro" \
    api node scripts/storage-probe.mjs "${1:-}" 2>&1
}
case "${1:-}" in
  --check) status; exit 0 ;;
  -h|--help) sed -n 2,21p "$0"; exit 0 ;;
  --backup-bucket)
    echo "== Sky Storage: ОТДЕЛЬНОЕ хранилище резервных копий (S3-совместимое) =="
    echo "Создайте бакет у другого хостера или хотя бы отдельный бакет с отдельным ключом доступа — не тот, где лежат медиа."
    bep="$(get_env STORAGE_BACKUP_S3_ENDPOINT)"; breg="$(get_env STORAGE_BACKUP_S3_REGION)"; bbk="$(get_env STORAGE_BACKUP_S3_BUCKET)"; bak="$(get_env STORAGE_BACKUP_S3_ACCESS_KEY)"
    read -r -p "Адрес S3 [${bep:-https://s3.example.com}]: " v; bep="${v:-$bep}"
    read -r -p "Регион [${breg:-us-east-1}]: " v; breg="${v:-${breg:-us-east-1}}"
    read -r -p "Бакет для копий [${bbk}]: " v; bbk="${v:-$bbk}"
    read -r -p "Ключ доступа (Access Key ID) [${bak}]: " v; bak="${v:-$bak}"
    [[ "$bep" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || { echo "Адрес должен быть вида https://хост (только https)."; exit 1; }
    [ -n "$bbk" ] && [ -n "$bak" ] || { echo "Бакет и ключ доступа обязательны."; exit 1; }
    if [ "${bep%/}" = "$(get_env STORAGE_S3_ENDPOINT)" ] && [ "$bbk" = "$(get_env STORAGE_S3_BUCKET)" ]; then echo "Это тот же бакет, что и основное хранение — копии в нём не будут независимыми. Укажите другой."; exit 1; fi
    bsk="$(get_env STORAGE_BACKUP_S3_SECRET_KEY)"
    if [ -n "$bsk" ]; then read -r -s -p "Секретный ключ (Enter — оставить прежний): " v; echo; bsk="${v:-$bsk}"
    else read -r -s -p "Секретный ключ (скрыто): " bsk; echo; fi
    [ "${#bsk}" -ge 8 ] || { echo "Секретный ключ не введён."; exit 1; }
    set_env STORAGE_BACKUP_TARGET s3
    set_env STORAGE_BACKUP_S3_ENDPOINT "${bep%/}"; set_env STORAGE_BACKUP_S3_REGION "$breg"; set_env STORAGE_BACKUP_S3_BUCKET "$bbk"
    set_env STORAGE_BACKUP_S3_ACCESS_KEY "$bak"; set_env STORAGE_BACKUP_S3_SECRET_KEY "$bsk"
    [ -n "$(get_env STORAGE_BACKUP_S3_PREFIX)" ] || set_env STORAGE_BACKUP_S3_PREFIX "sky-backups/"
    if [ -z "$(get_env STORAGE_KEK_ACTIVE)" ] || [ -z "$(get_env "STORAGE_KEK_$(get_env STORAGE_KEK_ACTIVE)")" ]; then
      set_env STORAGE_KEK_K1 "$(newkey)"; set_env STORAGE_KEK_ACTIVE K1
      echo "Выпущен ключ шифрования копий (K1). СОХРАНИТЕ ЕГО ОТДЕЛЬНО ОТ СЕРВЕРА: bash scripts/setup-storage.sh --export-kek /путь/файл"
    fi
    echo; echo "== Проверка подключения =="
    if command -v docker >/dev/null 2>&1; then
      envargs=(-e STORAGE_PROBE_PREFIX=STORAGE_BACKUP_S3_); for k in ENDPOINT REGION BUCKET ACCESS_KEY SECRET_KEY PREFIX PATH_STYLE; do envargs+=(-e "STORAGE_BACKUP_S3_$k=$(get_env "STORAGE_BACKUP_S3_$k")"); done
      out="$(docker compose run --rm --no-deps -T "${envargs[@]}" -v "$SRC_DIR/scripts/storage-probe.mjs:/app/scripts/storage-probe.mjs:ro" -v "$SRC_DIR/server/skystorages3.mjs:/app/server/skystorages3.mjs:ro" api node scripts/storage-probe.mjs 2>&1)" || true; echo "$out"
      style="$(echo "$out" | sed -n 's/^STYLE=//p' | tail -n1)"
      if [ -n "$style" ]; then
        [ "$style" = path ] && set_env STORAGE_BACKUP_S3_PATH_STYLE 1 || set_env STORAGE_BACKUP_S3_PATH_STYLE 0
        echo; echo "✔ Хранилище копий работает (стиль адреса: $style). Применить: bash scripts/deploy-local.sh — потом в админке Sky Storage → «Хранилище копий»."
      else echo; echo "✖ Подключение не прошло — значения сохранены, исправьте их и запустите снова."; exit 1; fi
    else echo "docker не найден — значения сохранены, проверку выполните позже."; fi
    exit 0 ;;
  --primary)
    mode="${2:-}"
    case "$mode" in
      on)
        [ -n "$(get_env STORAGE_S3_ENDPOINT)" ] && [ -n "$(get_env STORAGE_S3_SECRET_KEY)" ] || { echo "Сначала настройте S3: bash scripts/setup-storage.sh"; exit 1; }
        days="${3:-7}"; [[ "$days" =~ ^[0-9]+$ ]] || { echo "Дни кэша — число (0 — не убирать файлы с диска)."; exit 1; }
        set_env STORAGE_PRIMARY s3; set_env STORAGE_PRIMARY_CACHE_DAYS "$days"
        echo "Основное хранение медиа в S3 включено (кэш на диске: $days дн.). Применить: bash scripts/deploy-local.sh"
        echo "Важно: файлы шифруются ключом ENCRYPTION_KEY из .env — без него файлы в S3 не открыть. Сохраните его отдельно от сервера."
        echo "Файлы, уже лежащие на диске, сервер сам догрузит в S3 фоном (порциями, раз в 10 минут), после чего старые уберёт из кэша."
        echo "Резервные копии в ТОМ ЖЕ бакете — не независимая площадка: панель так и пометит. Для настоящей защиты нужен другой бакет/хостер."
        exit 0 ;;
      off)
        if command -v docker >/dev/null 2>&1 && [ "$(get_env STORAGE_PRIMARY)" = s3 ]; then
          echo "Сначала возвращаю на диск файлы, которые лежат только в S3…"
          envargs=(); for k in STORAGE_S3_ENDPOINT STORAGE_S3_REGION STORAGE_S3_BUCKET STORAGE_S3_ACCESS_KEY STORAGE_S3_SECRET_KEY STORAGE_S3_PREFIX STORAGE_S3_PATH_STYLE; do envargs+=(-e "$k=$(get_env "$k")"); done
          docker compose run --rm --no-deps -T "${envargs[@]}" -e STORAGE_PRIMARY=s3 \
            -v "$SRC_DIR/scripts/storage-pull.mjs:/app/scripts/storage-pull.mjs:ro" -v "$SRC_DIR/server:/app/server:ro" \
            api node scripts/storage-pull.mjs || { echo "✖ Не все файлы скачаны — режим НЕ отключён, чтобы ничего не потерять."; exit 1; }
        fi
        set_env STORAGE_PRIMARY ""; echo "Хранение медиа возвращено на диск сервера (файлы в S3 не удалены). Применить: bash scripts/deploy-local.sh"; exit 0 ;;
      *) echo "Использование: --primary on [дней_кэша] | --primary off"; exit 1 ;;
    esac ;;
  --rotate-keys)
    # Замена ключей доступа к S3 на НОВЫЕ (после того как вы выпустили их у хостера). Адрес, бакет и регион не меняются.
    # Старые значения возвращаются, если проверка с новыми ключами не прошла: сервер не останется без хранилища.
    command -v docker >/dev/null 2>&1 || { echo "Нужен docker (проверка живым запросом)."; exit 1; }
    oak="$(get_env STORAGE_S3_ACCESS_KEY)"; osk="$(get_env STORAGE_S3_SECRET_KEY)"
    [ -n "$(get_env STORAGE_S3_ENDPOINT)" ] && [ -n "$(get_env STORAGE_S3_BUCKET)" ] || { echo "S3 ещё не настроен — сначала bash scripts/setup-storage.sh."; exit 1; }
    echo "== Замена ключей доступа к S3 =="
    echo "Сначала выпустите НОВУЮ пару ключей у хостера (старую пока не удаляйте). Ввод секрета скрыт."
    read -r -p "Новый ключ доступа (Access Key ID): " nak
    read -r -s -p "Новый секретный ключ: " nsk; echo
    [ -n "$nak" ] && [ "${#nsk}" -ge 8 ] || { echo "Ключи не введены."; exit 1; }
    [ "$nak" != "$oak" ] && [ "$nsk" != "$osk" ] || { echo "Это прежние ключи — введите новые."; exit 1; }
    set_env STORAGE_S3_ACCESS_KEY "$nak"; set_env STORAGE_S3_SECRET_KEY "$nsk"
    echo "== Проверка новых ключей =="
    out="$(probe)" || true; echo "$out" | sed -E 's/(KEY|SECRET)[=:][^ ]*/\1=…/Ig'
    if [ -n "$(echo "$out" | sed -n 's/^STYLE=//p' | tail -n1)" ]; then
      echo; echo "✔ Новые ключи работают и записаны в .env."
      echo "Дальше по порядку:"
      echo "  1) bash scripts/deploy-local.sh   (сервер начнёт использовать новые ключи)"
      echo "  2) убедитесь в админке Sky Storage, что хранилище доступно и медиа открываются"
      echo "  3) у хостера УДАЛИТЕ старую пару ключей (Access Key ID начинался на ${oak:0:4}…) — иначе она остаётся рабочим обходом подтверждения"
      echo "  4) сохраните новые ключи в копию секретов: bash scripts/secrets-export.sh"
    else
      set_env STORAGE_S3_ACCESS_KEY "$oak"; set_env STORAGE_S3_SECRET_KEY "$osk"
      echo; echo "✖ Новые ключи не прошли проверку — в .env возвращены прежние, сервер работает как раньше."
      echo "Проверьте, что у новой пары есть права на этот бакет, и повторите."; exit 1
    fi
    exit 0 ;;
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
[ -n "$(get_env STORAGE_S3_PREFIX)" ] || set_env STORAGE_S3_PREFIX "sky/"

if [ -z "$(get_env STORAGE_KEK_ACTIVE)" ] || [ -z "$(get_env "STORAGE_KEK_$(get_env STORAGE_KEK_ACTIVE)")" ]; then
  set_env STORAGE_KEK_K1 "$(newkey)"; set_env STORAGE_KEK_ACTIVE K1
  echo
  echo "Выпущен ключ шифрования копий (K1). СОХРАНИТЕ ЕГО ОТДЕЛЬНО ОТ СЕРВЕРА: bash scripts/setup-storage.sh --export-kek /путь/файл"
fi

echo; echo "== Проверка подключения =="
if command -v docker >/dev/null 2>&1; then
  out="$(probe)" || true; echo "$out"
  style="$(echo "$out" | sed -n 's/^STYLE=//p' | tail -n1)"
  if [ -n "$style" ]; then
    [ "$style" = path ] && set_env STORAGE_S3_PATH_STYLE 1 || set_env STORAGE_S3_PATH_STYLE 0
    echo; echo "✔ Площадка работает (стиль адреса: $style). Применить: bash scripts/deploy-local.sh"
  else echo; echo "✖ Подключение не прошло — значения сохранены, исправьте их и запустите скрипт снова."; exit 1; fi
else echo "docker не найден — значения сохранены, проверку выполните позже: docker compose run --rm --no-deps -T api node scripts/storage-probe.mjs"; fi
status
