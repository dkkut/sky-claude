#!/usr/bin/env bash
# ============================================================
#  Проверка: куда ведут ссылки из писем (вход по SSH, вход в админку, разморозка аккаунта).
#
#      cd /opt/sky-src && bash scripts/check-links.sh
#
#  Ссылки строятся от DOMAIN (https://$DOMAIN/ssh-verify?t=…). DOMAIN обязан быть доменом ПРИЛОЖЕНИЯ (web.…),
#  а не лендинга (SITE_DOMAIN), иначе ссылка открывает главную лендинга — «Экосистему».
#  Скрипт ничего не меняет, только читает и делает запросы; секреты не печатает.
# ============================================================
set -uo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Нет .env — запускайте из каталога приложения (где docker-compose.yml)."; exit 1; }

get_env() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
FAIL=0
ok()   { echo "  ✔ $*"; }
bad()  { echo "  ✖ $*"; FAIL=1; }
warn() { echo "  ! $*"; }

APP="$(get_env DOMAIN)"; SITE="$(get_env SITE_DOMAIN)"
echo "Домены из .env:"
echo "  DOMAIN      = ${APP:-<не задан>}   (приложение; от него строятся ссылки в письмах)"
echo "  SITE_DOMAIN = ${SITE:-<не задан>}   (лендинг)"
echo

echo "1) Значения:"
[ -n "$APP" ] && ok "DOMAIN задан" || bad "DOMAIN не задан — ссылки в письмах будут пустыми"
if [ -n "$APP" ] && [ -n "$SITE" ] && [ "$APP" = "$SITE" ]; then
  bad "DOMAIN совпадает с SITE_DOMAIN ($APP): ссылки из писем ведут на лендинг. Поставьте в .env DOMAIN=web.… (домен приложения)"
elif [ -n "$APP" ] && [ -n "$SITE" ]; then
  ok "DOMAIN и SITE_DOMAIN — разные домены"
fi
if [ -n "$APP" ] && [ "${APP%%.*}" != "web" ]; then
  warn "DOMAIN не начинается с «web.» — убедитесь, что это именно домен приложения, а не корневой домен сайта"
fi

echo
echo "2) Что видит работающий сервер (контейнер api):"
if command -v docker >/dev/null 2>&1 && docker compose ps -q api >/dev/null 2>&1 && [ -n "$(docker compose ps -q api 2>/dev/null)" ]; then
  RUN="$(docker compose exec -T api printenv DOMAIN 2>/dev/null | tr -d '\r')"
  if [ -z "$RUN" ]; then bad "в контейнере api DOMAIN пуст"
  elif [ "$RUN" = "$APP" ]; then ok "контейнер api использует DOMAIN=$RUN"
  else bad "в контейнере api DOMAIN=$RUN, а в .env $APP — после правки .env нужен перезапуск: docker compose up -d api"; fi
else
  warn "контейнер api не запущен или docker недоступен — пропускаю"
fi

req() { curl -sS -m 10 -o "$1" -D "$1.h" -w '%{http_code}' "${@:2}" 2>/dev/null || true; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo
echo "3) Страница подтверждения на домене приложения (https://$APP/ssh-verify):"
if [ -n "$APP" ]; then
  C="$(req "$TMP/a" "https://$APP/ssh-verify?t=check")"; [ -n "$C" ] && [ "$C" != 000 ] || C=000
  if [ "$C" = "200" ] && grep -q "подтверждение" "$TMP/a"; then ok "открывается verify.html («Sky — подтверждение»)"
  elif [ "$C" = "200" ] && grep -q "Твоя экосистема" "$TMP/a"; then bad "открывается ГЛАВНАЯ («Твоя экосистема»), а не подтверждение — проверьте, что nginx пересоздан (bash scripts/deploy-local.sh)"
  else bad "ответ $C — адрес недоступен или DNS/сертификат не готов"; fi
fi

echo
echo "4) Та же ссылка на домене лендинга (https://$SITE/ssh-verify) должна перенаправлять на приложение:"
if [ -n "$SITE" ] && [ "$SITE" != "site.invalid.local" ]; then
  C="$(req "$TMP/b" "https://$SITE/ssh-verify?t=check")"; [ -n "$C" ] && [ "$C" != 000 ] || C=000
  LOC="$(grep -i '^location:' "$TMP/b.h" | tr -d '\r' | head -n1 | cut -d' ' -f2-)"
  if [ "$C" = "302" ] && [[ "$LOC" == "https://$APP/ssh-verify"* ]]; then ok "редирект на $APP (nginx лендинга)"
  elif [ "$C" = "200" ]; then warn "лендинг отдаёт страницу (редирект сработает в браузере через cms.js, но nginx не обновлён — нужен деплой)"
  elif [ "$C" = "000" ]; then warn "лендинг недоступен (DNS/сертификат?) — пропускаю"
  else bad "лендинг ответил $C ${LOC:+(Location: $LOC)}"; fi
else
  warn "SITE_DOMAIN не задан — лендинг не используется"
fi

echo
if [ "$FAIL" = 0 ]; then echo "Итог: ссылки из писем ведут на страницу подтверждения."; else echo "Итог: есть проблемы (✖ выше). Исправьте и запустите скрипт снова."; fi
exit "$FAIL"
