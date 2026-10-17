#!/usr/bin/env bash
# ============================================================
#  Настройка сайта восстановления доступа (Sky Recovery) — одной командой.
#
#      cd /opt/sky && bash scripts/setup-recovery.sh recovery.skymessenger.online
#      bash scripts/setup-recovery.sh --check             # только проверить, что работает
#      bash scripts/setup-recovery.sh --no-cert домен     # без выпуска сертификата
#
#  Что делает:
#   1. Записывает RECOVERY_DOMAIN в .env (и проверяет CERTBOT_EMAIL, DOMAIN).
#   2. Сверяет DNS: домен должен смотреть на этот сервер.
#   3. Поднимает стек (nginx подхватывает вхост восстановления на самоподписанной заглушке).
#   4. Выпускает настоящий сертификат (scripts/add-recovery-cert.sh), если не --no-cert.
#   5. Проверяет сайт, /api/recovery/info и что чужие /api/* через этот домен закрыты.
#
#  Сайт восстановления — отдельный вхост: приложение остаётся на DOMAIN (web.…), лендинг — на SITE_DOMAIN.
#  Миграции и новые шаблоны nginx ставит scripts/deploy-local.sh — запускайте его ДО этого скрипта.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Здесь нет .env — запускайте из каталога приложения (где docker-compose.yml)."; exit 1; }

CHECK=0; CERT=1; DOMAIN_ARG=""
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    --no-cert) CERT=0 ;;
    -h|--help) sed -n 2,17p "$0"; exit 0 ;;
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

REC="${DOMAIN_ARG:-$(get_env RECOVERY_DOMAIN)}"
if [ -z "$REC" ]; then
  echo "Укажите домен восстановления: bash scripts/setup-recovery.sh recovery.skymessenger.online" >&2; exit 1
fi
if ! [[ "$REC" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$ ]]; then
  echo "Не похоже на домен: $REC" >&2; exit 1
fi
APP="$(get_env DOMAIN)"; SITE="$(get_env SITE_DOMAIN)"
if [ "$REC" = "$APP" ] || [ "$REC" = "$SITE" ]; then
  echo "Сайт восстановления должен быть на отдельном домене (не $APP и не $SITE)." >&2; exit 1
fi

dns_check() {
  local want got
  want="$(curl -4 -fsS -m 6 https://api.ipify.org 2>/dev/null || true)"
  got="$(getent ahostsv4 "$REC" 2>/dev/null | awk '{print $1; exit}' || true)"
  if [ -z "$got" ]; then bad "DNS: у $REC нет A-записи → создайте A-запись на ${want:-адрес этого сервера}"; return 1; fi
  if [ -n "$want" ] && [ "$got" != "$want" ]; then
    bad "DNS: $REC → $got, а этот сервер — $want. Поправьте A-запись (если домен за прокси/CDN — это нормально)"; return 1
  fi
  ok "DNS: $REC → $got"
}

checks() {
  echo "Проверка сайта восстановления ($REC):"
  dns_check || true
  if curl -fsS -m 8 -o /dev/null -H "Host: $REC" http://127.0.0.1/healthz 2>/dev/null; then ok "nginx отвечает на $REC (HTTP)"
  else bad "nginx не отвечает на $REC — стек поднят? (bash scripts/deploy-local.sh)"; fi
  if curl -k -fsS -m 8 --resolve "$REC:443:127.0.0.1" "https://$REC/api/recovery/info" 2>/dev/null | grep -q '"ok"'; then ok "API восстановления отвечает (/api/recovery/info)"
  else bad "API восстановления не отвечает — применена ли миграция 159? (bash scripts/deploy-local.sh)"; fi
  local code
  code="$(curl -k -sS -m 8 -o /dev/null -w '%{http_code}' --resolve "$REC:443:127.0.0.1" "https://$REC/api/platform/status" 2>/dev/null || true)"
  if [ "$code" = "404" ]; then ok "чужие /api/* через этот домен закрыты (404)"
  else bad "через $REC открыт не только /api/recovery/ (код $code) — пересоздайте nginx: bash scripts/deploy-local.sh"; fi
  if curl -fsS -m 8 -o /dev/null --resolve "$REC:443:127.0.0.1" "https://$REC/" 2>/dev/null; then ok "сертификат валиден (настоящий)"
  else bad "сертификат не настоящий (самоподписанная заглушка) — bash scripts/add-recovery-cert.sh"; fi
}

if [ "$CHECK" = 1 ]; then checks; exit 0; fi

echo "============================================"
echo " Sky Recovery — настройка: $REC"
echo "============================================"

set_env RECOVERY_DOMAIN "$REC"; ok "RECOVERY_DOMAIN=$REC записан в .env"
[ -n "$APP" ] || bad "DOMAIN (адрес приложения) не задан в .env — ссылки в письмах восстановления строятся от него"
if [ -z "$(get_env CERTBOT_EMAIL)" ]; then
  bad "CERTBOT_EMAIL не задан в .env — на него придут письма об истечении сертификата (нужен для выпуска)"
  [ "$CERT" = 1 ] && { echo "Добавьте CERTBOT_EMAIL=вы@пример.ру в .env и запустите скрипт снова." >&2; exit 1; }
fi
dns_check || echo "    (продолжаю: сертификат выпустится, только когда DNS заработает)"

echo "==> Поднимаю стек (nginx подхватит вхост восстановления)"
docker compose up -d
for _ in $(seq 1 30); do
  curl -fsS -m 3 -o /dev/null -H "Host: $REC" http://127.0.0.1/healthz 2>/dev/null && break; sleep 2
done

if [ "$CERT" = 1 ]; then
  echo "==> Выпускаю сертификат"
  bash scripts/add-recovery-cert.sh || echo "    Сертификат не выпущен — чаще всего DNS ещё не обновился. Повторите: bash scripts/add-recovery-cert.sh"
fi

echo
checks
echo
echo "Дальше:"
echo "  • у домена почты Sky должны быть SPF, DKIM и DMARC — иначе письма восстановления уйдут в спам;"
echo "  • почта должна быть настроена: bash scripts/set-email.sh;"
echo "  • если .env менялся — пересоздайте api: docker compose up -d api."
chmod 600 .env
