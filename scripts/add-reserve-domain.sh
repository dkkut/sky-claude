#!/usr/bin/env bash
# ============================================================
#  Резервный адрес API (RESERVE_DOMAIN, например reserve.skymessenger.online).
#  Приложения Android/Windows уходят на него, когда основной адрес не отвечает
#  (VITE_API_FALLBACKS в .env.native, см. src/core/nativeApp.ts).
#
#  Это ТОТ ЖЕ вхост, что и DOMAIN: имя добавляется в server_name (nginx/templates/sky.conf.template)
#  и в сертификат основного домена как дополнительное имя (SAN) — отдельных путей к
#  сертификату нет. Скрипт: пишет RESERVE_DOMAIN в .env, проверяет DNS, расширяет
#  сертификат (webroot, nginx не останавливается), пересоздаёт web.
#
#  Запуск на сервере из каталога с docker-compose.yml:
#      bash scripts/add-reserve-domain.sh reserve.skymessenger.online
#      bash scripts/add-reserve-domain.sh --check
#  Перед этим DNS-запись A/AAAA резервного домена должна указывать на этот сервер.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -f .env ]] || { echo "Нет файла .env — сначала scripts/bootstrap-server.sh" >&2; exit 1; }

setenv() {   # setenv KEY VALUE — идемпотентно, права .env не меняются
  if grep -q "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
  chmod 600 .env
}

# shellcheck disable=SC1091
set -a; source .env; set +a
: "${DOMAIN:?в .env не задан DOMAIN}"

if [[ "${1:-}" == "--check" ]]; then
  R="${RESERVE_DOMAIN:-}"
  [[ -n "$R" ]] || { echo "RESERVE_DOMAIN в .env не задан" >&2; exit 1; }
  echo "==> $R: проверка по HTTPS"
  curl -fsS -o /dev/null -w 'healthz: HTTP %{http_code}\n' "https://${R}/healthz" || { echo "НЕ отвечает" >&2; exit 1; }
  echo "==> имена в сертификате:"
  echo | openssl s_client -servername "$R" -connect "${R}:443" 2>/dev/null | openssl x509 -noout -ext subjectAltName 2>/dev/null || true
  exit 0
fi

R="${1:-${RESERVE_DOMAIN:-}}"
[[ "$R" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || { echo "Укажите домен: bash scripts/add-reserve-domain.sh reserve.example.com" >&2; exit 1; }
[[ "$R" != "$DOMAIN" ]] || { echo "Резервный домен должен отличаться от DOMAIN" >&2; exit 1; }
: "${CERTBOT_EMAIL:?в .env не задан CERTBOT_EMAIL}"

echo "==> Резервный домен: $R (основной: $DOMAIN)"

# DNS: домен должен вести сюда, иначе проверка Let's Encrypt не пройдёт
MY_IP="$(curl -fsS -4 https://ifconfig.me 2>/dev/null || true)"
DNS_IP="$(getent ahostsv4 "$R" 2>/dev/null | awk 'NR==1{print $1}')"
echo "    IP сервера: ${MY_IP:-не определён}; DNS ${R}: ${DNS_IP:-нет записи}"
if [[ -z "$DNS_IP" ]]; then echo "У домена нет DNS-записи — добавьте A-запись на этот сервер и повторите." >&2; exit 1; fi
if [[ -n "$MY_IP" && "$DNS_IP" != "$MY_IP" ]]; then
  echo "ВНИМАНИЕ: DNS указывает на $DNS_IP, а это сервер $MY_IP. Если домен за Cloudflare-прокси — выключите оранжевое облако на время выпуска." >&2
  [[ "${FORCE:-0}" == "1" ]] || { echo "Продолжить можно с FORCE=1." >&2; exit 1; }
fi

setenv RESERVE_DOMAIN "$R"

COMPOSE="docker compose"
echo "==> Перезапускаю web, чтобы $R попал в server_name (на HTTP проверка Let's Encrypt)"
$COMPOSE up -d --force-recreate web
sleep 3
curl -fsS -o /dev/null -H "Host: $R" "http://127.0.0.1/healthz" || { echo "web не отвечает на HTTP для $R" >&2; exit 1; }

# Имена существующего сертификата + новое: --expand не теряет прежние (www и т. п.)
DOMS="$($COMPOSE run --rm --entrypoint certbot certbot certificates --cert-name "$DOMAIN" 2>/dev/null | sed -n 's/^ *Domains: *//p' | head -1)"
[[ -n "$DOMS" ]] || DOMS="$DOMAIN"
ARGS=()
for d in $DOMS "$R"; do ARGS+=(-d "$d"); done
echo "==> Имена в сертификате: ${DOMS} ${R}"

STAGING_ARG=""
if [[ "${CERTBOT_STAGING:-0}" != "0" ]]; then echo "==> Тестовый режим Let's Encrypt (сертификат невалиден)"; STAGING_ARG="--staging"; fi

$COMPOSE run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot ${STAGING_ARG} \
  --cert-name "$DOMAIN" --expand \
  --email "$CERTBOT_EMAIL" --agree-tos --no-eff-email --non-interactive \
  "${ARGS[@]}"

echo "==> Сертификат расширен. Перезапускаю web"
$COMPOSE up -d --force-recreate web
sleep 3
echo "==> Проверка:"
bash "$0" --check
echo
echo "Готово. Продление идёт автоматически вместе с основным сертификатом."
echo "Не забудьте: VITE_API_FALLBACKS=https://$R в .env.native (уже стоит) и пересборка .apk/.exe."
