#!/usr/bin/env bash
# ============================================================
#  Ключи карт (Google и/или Яндекс) — одной командой, с проверкой.
#
#      cd /opt/sky && bash /opt/sky-src/scripts/set-maps-key.sh          # спросит ключи
#      bash scripts/set-maps-key.sh --check                              # проверить уже записанные
#      bash scripts/set-maps-key.sh --google КЛЮЧ --yandex КЛЮЧ          # без вопросов
#
#  Какие ключи нужны:
#   • Google (GOOGLE_MAPS_KEY) — Google Cloud → API и службы: включить «Geocoding API», «Maps Static API»
#     и (для маршрутов курьера) «Directions API». Ограничьте ключ по IP сервера.
#   • Яндекс (YANDEX_MAPS_KEY) — developer.tech.yandex.ru: «Static API»; (YANDEX_GEOCODER_KEY) — «HTTP Геокодер».
#     Если ключ геокодера не задан, берётся ключ Static API (нужны оба API на одном ключе).
#  Хватит одного поставщика. Какой рисует карту, решает место (РФ → Яндекс, остальное → Google) или выбор человека.
#
#  Ключи на экран не печатаются, живут только в .env (права 600) и в браузер не уходят.
#  Каждый ключ проверяется живым запросом: неверный виден сразу, а не когда человек откроет карту.
# ============================================================
set -uo pipefail

# Где лежит .env: текущий каталог, потом каталог скрипта, потом /opt/sky.
HERE="$(cd "$(dirname "$0")/.." && pwd)"
for d in "$PWD" "$HERE" /opt/sky; do
  if [ -f "$d/.env" ]; then cd "$d" && break; fi
done
[ -f .env ] || { echo "Нет .env ни в $PWD, ни в $HERE, ни в /opt/sky — запустите из каталога приложения."; exit 1; }

get_env() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
set_env() {
  local key="$1" val="$2" tmp found=0 line
  tmp="$(mktemp .env.XXXXXX)"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" == "$key="* ]]; then
      if [ "$found" = 0 ]; then printf '%s=%s\n' "$key" "$val" >> "$tmp"; found=1; fi
    else printf '%s\n' "$line" >> "$tmp"; fi
  done < .env
  [ "$found" = 1 ] || printf '%s=%s\n' "$key" "$val" >> "$tmp"
  chmod 600 "$tmp"; mv "$tmp" .env
}
ok()  { echo "  ✔ $*"; }
bad() { echo "  ✖ $*"; }
BAD=0

# ── Проверки живым запросом (ключ в адресе — только для curl, на экран не выводится) ──
check_google() {
  local k="$1" tmp code type
  tmp="$(mktemp)"
  code="$(curl -sS -m 12 -o "$tmp" -w '%{http_code} %{content_type}' "https://maps.googleapis.com/maps/api/staticmap?center=55.75,37.62&zoom=10&size=80x80&key=$k" 2>/dev/null || true)"
  type="${code#* }"; code="${code%% *}"
  if [ "$code" = 200 ] && [[ "$type" == image/* ]]; then ok "Google Static Maps: работает"
  else bad "Google Static Maps: не работает ($(head -c 160 "$tmp" 2>/dev/null | tr '\n' ' ')) — включите «Maps Static API» и проверьте ограничения ключа"; BAD=1; fi
  local g; g="$(curl -sS -m 12 "https://maps.googleapis.com/maps/api/geocode/json?address=Moscow&key=$k" 2>/dev/null || true)"
  if printf '%s' "$g" | grep -q '"status" *: *"OK"'; then ok "Google Geocoding (адрес → координаты): работает"
  else bad "Google Geocoding: $(printf '%s' "$g" | grep -o '"error_message" *: *"[^"]*"' | head -n1) — включите «Geocoding API»"; BAD=1; fi
  local d; d="$(curl -sS -m 12 "https://maps.googleapis.com/maps/api/directions/json?origin=55.75,37.62&destination=55.76,37.64&key=$k" 2>/dev/null || true)"
  if printf '%s' "$d" | grep -q '"status" *: *"OK"'; then ok "Google Directions (маршруты курьера): работает"
  else echo "  ! Google Directions не включён — маршруты курьера недоступны (остальное работает)"; fi
  rm -f "$tmp"
}
check_yandex_static() {
  local k="$1" code
  code="$(curl -sS -m 12 -o /dev/null -w '%{http_code}' "https://static-maps.yandex.ru/v1?ll=37.62,55.75&z=10&size=80,80&apikey=$k" 2>/dev/null || true)"
  if [ "$code" = 200 ]; then ok "Яндекс Static API (картинка карты): работает"
  else bad "Яндекс Static API: ответ $code — проверьте ключ и что подключён «Static API»"; BAD=1; fi
}
check_yandex_geocoder() {
  local k="$1" code
  code="$(curl -sS -m 12 -o /dev/null -w '%{http_code}' "https://geocode-maps.yandex.ru/1.x/?apikey=$k&geocode=Moscow&format=json" 2>/dev/null || true)"
  if [ "$code" = 200 ]; then ok "Яндекс HTTP Геокодер (адрес → координаты): работает"
  else bad "Яндекс Геокодер: ответ $code — проверьте ключ и что подключён «HTTP Геокодер»"; BAD=1; fi
}

run_checks() {
  local g y yg
  g="$(get_env GOOGLE_MAPS_KEY)"; y="$(get_env YANDEX_MAPS_KEY)"; yg="$(get_env YANDEX_GEOCODER_KEY)"
  echo "Что записано в .env:"
  [ -n "$g" ] && ok "GOOGLE_MAPS_KEY задан" || echo "  – GOOGLE_MAPS_KEY не задан"
  [ -n "$y" ] && ok "YANDEX_MAPS_KEY задан" || echo "  – YANDEX_MAPS_KEY не задан"
  [ -n "$y" ] && { [ -n "$yg" ] && ok "YANDEX_GEOCODER_KEY задан" || echo "  – YANDEX_GEOCODER_KEY не задан (будет использован YANDEX_MAPS_KEY)"; }
  [ -z "$g$y" ] && { echo "  ✖ ни одного ключа — карты не работают («карта не настроена»)"; BAD=1; return; }
  echo; echo "Проверка ключей живыми запросами:"
  [ -n "$g" ] && check_google "$g"
  [ -n "$y" ] && check_yandex_static "$y"
  [ -n "$y" ] && check_yandex_geocoder "${yg:-$y}"
}

# ── Разбор параметров ──
CHECK=0; G=""; Y=""; YG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --google) G="${2:-}"; shift ;;
    --yandex) Y="${2:-}"; shift ;;
    --yandex-geocoder) YG="${2:-}"; shift ;;
    -h|--help) sed -n 2,19p "$0"; exit 0 ;;
    *) echo "Неизвестный параметр: $1 (см. --help)"; exit 1 ;;
  esac
  shift
done

if [ "$CHECK" = 1 ]; then run_checks; exit "$BAD"; fi

# Читаем ввод с терминала (работает и при «bash -s»).
if { : </dev/tty; } 2>/dev/null; then INPUT=/dev/tty; else INPUT=/dev/stdin; fi
ask_secret() { # подсказка → переменная REPLY_SECRET
  printf '%s' "$1" >&2; read -rs REPLY_SECRET <"$INPUT"; echo >&2
}

echo "============================================"
echo " Карты — ключи"
echo "============================================"
echo "Оставьте поле пустым, чтобы не менять текущее значение."
echo

if [ -z "$G$Y$YG" ]; then
  ask_secret "Ключ Google Карт (GOOGLE_MAPS_KEY): "; G="$REPLY_SECRET"
  ask_secret "Ключ Яндекс Static API (YANDEX_MAPS_KEY): "; Y="$REPLY_SECRET"
  if [ -n "$Y" ]; then ask_secret "Ключ Яндекс HTTP Геокодера (Enter — тот же): "; YG="$REPLY_SECRET"; fi
fi

# Простейшая защита от случайной вставки лишнего: ключи — одна «строка» без пробелов и кавычек.
for v in "$G" "$Y" "$YG"; do
  if [[ "$v" =~ [[:space:]\"\'\\] ]]; then echo "В ключе пробелы или кавычки — похоже на ошибку вставки. Ничего не записано." >&2; exit 1; fi
done

echo
echo "Проверяю введённые ключи:"
[ -n "$G" ] && check_google "$G"
[ -n "$Y" ] && check_yandex_static "$Y"
[ -n "$Y$YG" ] && check_yandex_geocoder "${YG:-${Y:-$(get_env YANDEX_MAPS_KEY)}}"

if [ "$BAD" != 0 ]; then
  echo
  read -rp "Есть непроходящие проверки. Всё равно записать? [y/N] " ANS <"$INPUT"
  [[ "$ANS" =~ ^[yY]$ ]] || { echo "Не записано."; exit 1; }
fi

[ -n "$G" ]  && { set_env GOOGLE_MAPS_KEY "$G"; ok "GOOGLE_MAPS_KEY записан"; }
[ -n "$Y" ]  && { set_env YANDEX_MAPS_KEY "$Y"; ok "YANDEX_MAPS_KEY записан"; }
[ -n "$YG" ] && { set_env YANDEX_GEOCODER_KEY "$YG"; ok "YANDEX_GEOCODER_KEY записан"; }
chmod 600 .env

echo
echo "Применить: cd $(pwd) && docker compose up -d api   (или bash /opt/sky-src/scripts/deploy-local.sh)"
echo "Проверить: bash scripts/set-maps-key.sh --check — и откройте любую карту (Sky GO → Заправки)."
