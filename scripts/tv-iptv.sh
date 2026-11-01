#!/usr/bin/env bash
#
# Подключить телеканалы Sky TV из каталога iptv-org (https://github.com/iptv-org/iptv).
#
#   cd /opt/sky && bash /opt/sky-src/scripts/tv-iptv.sh --country ru
#   bash scripts/tv-iptv.sh --category news
#   bash scripts/tv-iptv.sh --language rus
#   bash scripts/tv-iptv.sh --freetv russia     (список Free-TV/IPTV: https://github.com/Free-TV/IPTV/blob/master/lists/russia.md)
#   bash scripts/tv-iptv.sh --url https://iptv-org.github.io/iptv/countries/kz.m3u
#
# Что делает:
#   1. Скачивает НУЖНЫЙ плейлист каталога (страну, категорию или язык — целиком каталог слишком велик).
#   2. Показывает, на каких узлах лежат потоки, и спрашивает, какие узлы вы разрешаете.
#      Белый список TV_ALLOWED_HOSTS — единственное место, где вы решаете, откуда Sky TV имеет право брать эфир.
#   3. Дописывает выбранные узлы в .env, перезапускает api и запускает scripts/tv-import.sh
#      (он сначала показывает план, пишет только после вашего «да», каждый адрес проверяется на SSRF).
#
# ВАЖНО (честно): iptv-org — каталог ОБЩЕДОСТУПНЫХ ссылок на потоки, а не лицензия. Он не даёт права на показ
# и не подтверждает, что вещатель разрешил ретрансляцию (см. «Положение об использовании медиаконтента», п. 6).
# Основание показа записывается рядом с каждым источником; при обращении правообладателя канал отключается
# (админка → «Контент»/Sky TV или scripts/tv-source.sh). Подключайте то, что готовы защищать.
set -euo pipefail
cd "$(dirname "$0")/.."
HERE="$(pwd)"
for d in "${APP_DIR:-}" "$PWD" /opt/sky; do [ -n "$d" ] && [ -f "$d/.env" ] && { cd "$d"; break; }; done
[ -f .env ] || { echo "Нет .env — запустите из /opt/sky или задайте APP_DIR."; exit 1; }
IMPORT="$HERE/scripts/tv-import.sh"; [ -f "$IMPORT" ] || IMPORT="scripts/tv-import.sh"

BASE="https://iptv-org.github.io/iptv"
URL=""; FREETV=""
case "${1:-}" in
  --country)  [[ "${2:-}" =~ ^[a-z]{2}$ ]] || { echo "Код страны из двух латинских букв, например ru."; exit 1; }; URL="$BASE/countries/$2.m3u" ;;
  --category) [[ "${2:-}" =~ ^[a-z]{3,20}$ ]] || { echo "Категория: news, sports, kids, music, movies…"; exit 1; }; URL="$BASE/categories/$2.m3u" ;;
  --language) [[ "${2:-}" =~ ^[a-z]{3}$ ]] || { echo "Код языка из трёх букв, например rus."; exit 1; }; URL="$BASE/languages/$2.m3u" ;;
  --freetv)   [[ "${2:-}" =~ ^[a-z_]{3,30}$ ]] || { echo "Название списка Free-TV, например russia."; exit 1; }; FREETV="$2"; URL="https://raw.githubusercontent.com/Free-TV/IPTV/master/lists/$2.md" ;;
  --url)      URL="${2:-}"; [[ "$URL" =~ ^https://iptv-org\.github\.io/iptv/[a-z/_-]+\.m3u8?$ ]] || { echo "Допустимы только плейлисты https://iptv-org.github.io/iptv/…"; exit 1; } ;;
  *) sed -n 2,12p "$0"; exit 1 ;;
esac

TMP="$(mktemp /tmp/iptv-XXXXXX.m3u)"; trap 'rm -f "$TMP" "$TMP.md"' EXIT
echo "Скачиваю $URL …"
if [ -n "$FREETV" ]; then
  curl -fsSL --max-filesize 2097152 --max-time 60 "$URL" -o "$TMP.md" || { echo "Не удалось скачать список Free-TV."; exit 1; }
  command -v node >/dev/null || { echo "Нужен Node.js на хосте для разбора списка Free-TV."; exit 1; }
  node "$HERE/scripts/freetv-to-m3u.mjs" "$TMP.md" > "$TMP"
else
  curl -fsSL --max-filesize 2097152 --max-time 60 "$URL" -o "$TMP" || { echo "Не удалось скачать (проверьте адрес и размер: до 2 МБ)."; exit 1; }
fi
head -c 7 "$TMP" | grep -q '^#EXTM3U' || { echo "Это не плейлист M3U."; exit 1; }
TOTAL=$(grep -c '^#EXTINF' "$TMP" || true)
echo "Каналов в плейлисте: $TOTAL"

echo; echo "Узлы, на которых лежат потоки (https), по числу каналов:"
grep -E '^https://' "$TMP" | sed -E 's#^https://([^/:?]+).*#\1#' | tr 'A-Z' 'a-z' | sort | uniq -c | sort -rn | head -40 | awk '{printf "  %4d  %s\n", $1, $2}'
HOSTS_ALL="$(grep -E '^https://' "$TMP" | sed -E 's#^https://([^/:?]+).*#\1#' | tr 'A-Z' 'a-z' | sort -u | grep -E '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]+$' | grep -Ev '^[0-9.]+$|(^|\.)(localhost|local|internal|lan|home|arpa)$' || true)"

CUR="$(grep -E '^TV_ALLOWED_HOSTS=' .env | tail -n1 | cut -d= -f2- || true)"
echo; echo "Уже разрешено: ${CUR:-—}"
echo
echo "Какие узлы разрешить? Укажите через запятую (поддомены входят автоматически)."
echo "«все» — разрешить ВСЕ узлы из этого плейлиста (быстро, но вы отвечаете за каждый)."
echo "Пусто — не добавлять, использовать только уже разрешённые."
read -r -p "> " CHOICE
NEW=""
if [ "$CHOICE" = "все" ]; then
  read -r -p "Подтвердите: разрешить $(echo "$HOSTS_ALL" | wc -l) узлов? Напишите «да»: " OK; [ "$OK" = "да" ] || { echo "Отменено."; exit 0; }
  NEW="$(echo "$HOSTS_ALL" | tr '\n' ',' | sed 's/,$//')"
elif [ -n "$CHOICE" ]; then
  NEW="$(echo "$CHOICE" | tr 'A-Z' 'a-z' | tr -d ' ' | tr ',' '\n' | grep -E '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]+$' | grep -Ev '(^|\.)(localhost|local|internal|lan|home|arpa)$' | tr '\n' ',' | sed 's/,$//')"
  [ -n "$NEW" ] || { echo "Не разобрал ни одного узла."; exit 1; }
fi
if [ -n "$NEW" ]; then
  MERGED="$(printf '%s,%s' "$CUR" "$NEW" | tr ',' '\n' | grep -v '^$' | sort -u | tr '\n' ',' | sed 's/,$//')"
  tmp="$(mktemp .env.XXXXXX)"; found=0
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" == TV_ALLOWED_HOSTS=* ]]; then [ "$found" = 0 ] && printf 'TV_ALLOWED_HOSTS=%s\n' "$MERGED" >> "$tmp"; found=1; else printf '%s\n' "$line" >> "$tmp"; fi
  done < .env
  [ "$found" = 1 ] || printf 'TV_ALLOWED_HOSTS=%s\n' "$MERGED" >> "$tmp"
  chmod 600 "$tmp"; mv "$tmp" .env
  echo "Разрешённые узлы обновлены. Перезапускаю api…"
  docker compose up -d api >/dev/null 2>&1 || echo "(не удалось перезапустить api — выполните: docker compose up -d api)"
  sleep 5
fi

LICENCE="Публичный поток из каталога ${FREETV:+Free-TV/IPTV}${FREETV:-iptv-org}; право вещателя на ретрансляцию не подтверждено, канал отключается по обращению правообладателя"
echo; echo "Дальше — план импорта (ничего не записывается без вашего «да»)."
bash "$IMPORT" "$TMP" "$LICENCE"
