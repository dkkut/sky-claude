#!/usr/bin/env bash
# ============================================================
#  Настройка лендинга (сайт на корневом домене) — одной командой.
#
#      cd /opt/sky-src && bash scripts/setup-landing.sh skymessenger.online
#      bash scripts/setup-landing.sh --check            # только проверить, что работает
#      bash scripts/setup-landing.sh --no-cert домен    # без выпуска сертификата
#
#  Что делает:
#   1. Записывает SITE_DOMAIN в .env (и проверяет, что есть CERTBOT_EMAIL).
#   2. Сверяет DNS: домен должен смотреть на этот сервер. Нет — подскажет, какую A-запись создать.
#   3. Поднимает стек (nginx подхватывает второй вхост на самоподписанной заглушке).
#   4. Выпускает настоящий сертификат (scripts/add-site-cert.sh) — если не отключено --no-cert.
#   5. Проверяет сайт и API лендинга (/api/site/public) и напоминает про права в админке.
#
#  Лендинг — это НЕ приложение: приложение остаётся на DOMAIN (web.…), лендинг — на SITE_DOMAIN.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Здесь нет .env — запускайте из каталога приложения (где docker-compose.yml)."; exit 1; }

CHECK=0; CERT=1; DOMAIN_ARG=""
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    --no-cert) CERT=0 ;;
    -h|--help) sed -n 2,19p "$0"; exit 0 ;;
    -*) echo "Неизвестный параметр: $a (см. --help)"; exit 1 ;;
    *) DOMAIN_ARG="$a" ;;
  esac
done

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
ok() { echo "  ✔ $*"; }
bad() { echo "  ✖ $*"; }

SITE="${DOMAIN_ARG:-$(get_env SITE_DOMAIN)}"
if [ -z "$SITE" ] || [ "$SITE" = "site.invalid.local" ]; then
  echo "Укажите домен лендинга: bash scripts/setup-landing.sh skymessenger.online" >&2; exit 1
fi
if ! [[ "$SITE" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$ ]]; then
  echo "Не похоже на домен: $SITE" >&2; exit 1
fi
APP="$(get_env DOMAIN)"
if [ -n "$APP" ] && [ "$SITE" = "$APP" ]; then
  echo "Лендинг не может быть на том же домене, что приложение ($APP)." >&2; exit 1
fi

# DNS: сравниваем адрес домена с внешним адресом этого сервера.
dns_check() {
  local want got
  want="$(curl -4 -fsS -m 6 https://api.ipify.org 2>/dev/null || true)"
  got="$(getent ahostsv4 "$SITE" 2>/dev/null | awk '{print $1; exit}' || true)"
  if [ -z "$got" ]; then bad "DNS: у $SITE нет A-записи → создайте A-запись на ${want:-адрес этого сервера}"; return 1; fi
  if [ -n "$want" ] && [ "$got" != "$want" ]; then
    bad "DNS: $SITE → $got, а этот сервер — $want. Поправьте A-запись (если домен за прокси/CDN — это нормально)"; return 1
  fi
  ok "DNS: $SITE → $got"
}

checks() {
  echo "Проверка лендинга ($SITE):"
  dns_check || true
  if curl -fsS -m 8 -o /dev/null -H "Host: $SITE" http://127.0.0.1/healthz 2>/dev/null; then ok "nginx отвечает на $SITE (HTTP)"
  else bad "nginx не отвечает на $SITE — стек поднят? (docker compose up -d)"; fi
  local body
  body="$(curl -k -fsS -m 8 --resolve "$SITE:443:127.0.0.1" "https://$SITE/api/site/public" 2>/dev/null || true)"
  if printf '%s' "$body" | grep -q '"links"'; then ok "API лендинга отвечает (/api/site/public)"
  else bad "API лендинга не отвечает — применена ли миграция 123? (bash scripts/deploy-local.sh)"; fi
  if curl -fsS -m 8 -o /dev/null --resolve "$SITE:443:127.0.0.1" "https://$SITE/" 2>/dev/null; then ok "сертификат валиден (настоящий)"
  else bad "сертификат не настоящий (самоподписанная заглушка) — bash scripts/add-site-cert.sh"; fi
}

if [ "$CHECK" = 1 ]; then checks; exit 0; fi

echo "============================================"
echo " Лендинг — настройка: $SITE"
echo "============================================"

set_env SITE_DOMAIN "$SITE"; ok "SITE_DOMAIN=$SITE записан в .env"
if [ -z "$(get_env CERTBOT_EMAIL)" ]; then
  bad "CERTBOT_EMAIL не задан в .env — на него придут письма об истечении сертификата (нужен для выпуска)"
  [ "$CERT" = 1 ] && { echo "Добавьте CERTBOT_EMAIL=вы@пример.ру в .env и запустите скрипт снова." >&2; exit 1; }
fi
dns_check || echo "    (продолжаю: сертификат выпустится, только когда DNS заработает)"

echo "==> Поднимаю стек (nginx подхватит второй вхост)"
docker compose up -d
for _ in $(seq 1 30); do
  curl -fsS -m 3 -o /dev/null -H "Host: $SITE" http://127.0.0.1/healthz 2>/dev/null && break; sleep 2
done

if [ "$CERT" = 1 ]; then
  echo "==> Выпускаю сертификат"
  bash scripts/add-site-cert.sh || echo "    Сертификат не выпущен — чаще всего DNS ещё не обновился. Повторите: bash scripts/add-site-cert.sh"
fi

echo
checks
echo
echo "Дальше (в админке Sky):"
echo "  • вкладка «Сайт»: ссылки, файлы для скачивания, статус сервисов, технические работы сайта;"
echo "  • сотруднику нужно право «site» (роль «Сайт»); обращения с сайта приходят в «Сайт» → Поддержка и в основной тикет-центр."
chmod 600 .env
