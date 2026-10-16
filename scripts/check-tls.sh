#!/usr/bin/env bash
# Проверка защиты канала передачи боевого сайта (запускать с ЛЮБОГО компьютера, не обязательно с сервера):
#   bash scripts/check-tls.sh web.skymessenger.online
# Проверяет: старые версии TLS закрыты, TLS 1.2/1.3 работают, срок сертификата, редирект http→https, HSTS и заголовки безопасности,
# версия nginx не светится, куки с refresh-токеном (HttpOnly/Secure/SameSite), API по http не отвечает данными, wss доступен.
# Ничего не меняет и секретов не печатает. Честно: TLS скрывает СОДЕРЖИМОЕ, но не IP-адреса, время и объём соединений.
set -u
HOST="${1:-}"; [ -n "$HOST" ] || { echo "Использование: bash scripts/check-tls.sh домен"; exit 1; }
PASS=0; FAIL=0; WARN=0
ok()   { echo "  ✔ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ✖ $*"; FAIL=$((FAIL+1)); }
warn() { echo "  ! $*"; WARN=$((WARN+1)); }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Нужна утилита: $1"; exit 2; }; }
need openssl; need curl

echo "== 1. Версии TLS и шифры ($HOST:443) =="
for v in tls1 tls1_1; do
  if echo | openssl s_client -connect "$HOST:443" -servername "$HOST" "-$v" 2>&1 | grep -q "BEGIN CERTIFICATE"; then bad "принимается устаревший $v"; else ok "$v закрыт"; fi
done
for v in tls1_2 tls1_3; do
  if echo | openssl s_client -connect "$HOST:443" -servername "$HOST" "-$v" 2>&1 | grep -q "BEGIN CERTIFICATE"; then ok "$v работает"; else warn "$v не отвечает (TLS 1.3 желателен)"; fi
done
CIPHER="$(echo | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null | sed -n 's/^ *Cipher *: *//p;s/^New, .*Cipher is //p' | head -1)"
[ -n "$CIPHER" ] && echo "  · выбранный шифр: $CIPHER"

echo "== 2. Сертификат =="
CERT="$(echo | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null | openssl x509 -noout -enddate -subject -issuer 2>/dev/null)"
if [ -z "$CERT" ]; then bad "сертификат не получен"; else
  END="$(echo "$CERT" | sed -n 's/^notAfter=//p')"; echo "  · действует до: $END"
  if echo | openssl s_client -connect "$HOST:443" -servername "$HOST" -verify_hostname "$HOST" -verify_return_error 2>&1 | grep -q "Verify return code: 0"; then ok "цепочка и имя узла проверены"; else bad "сертификат не прошёл проверку цепочки/имени"; fi
  if echo | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null | openssl x509 -noout -checkend $((21*86400)) >/dev/null 2>&1; then ok "до истечения больше 21 дня"; else warn "сертификат истекает в ближайшие 21 день — проверьте автопродление"; fi
fi

echo "== 3. http → https =="
CODE="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 "http://$HOST/" || true)"
case "$CODE" in 301*|308*) ok "http перенаправляет: $CODE";; *) bad "http не перенаправляет на https: $CODE";; esac
API="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$HOST/api/platform/status" || true)"
case "$API" in 200) bad "API отвечает данными по открытому http";; *) ok "API по http данных не отдаёт (код $API)";; esac

echo "== 4. Заголовки безопасности =="
H="$(curl -sI --max-time 10 "https://$HOST/" || true)"
echo "$H" | grep -qi '^strict-transport-security:.*max-age=[0-9]\{7,\}' && ok "HSTS включён" || bad "нет HSTS (Strict-Transport-Security)"
echo "$H" | grep -qi '^x-content-type-options: *nosniff' && ok "X-Content-Type-Options: nosniff" || warn "нет X-Content-Type-Options"
echo "$H" | grep -qi '^x-frame-options\|frame-ancestors' && ok "защита от встраивания во фрейм" || warn "нет защиты от встраивания (X-Frame-Options/frame-ancestors)"
echo "$H" | grep -qi '^content-security-policy' && ok "есть Content-Security-Policy" || warn "нет Content-Security-Policy"
echo "$H" | grep -qi '^referrer-policy' && ok "есть Referrer-Policy" || warn "нет Referrer-Policy"
if echo "$H" | grep -i '^server:' | grep -qi 'nginx/[0-9]'; then bad "версия nginx видна в заголовке Server"; else ok "версия сервера не раскрывается"; fi

echo "== 5. Куки сессии =="
SC="$(curl -si --max-time 10 -X POST -H 'content-type: application/json' -d '{"email":"check@example.invalid"}' "https://$HOST/api/auth/email/start" | grep -i '^set-cookie:' || true)"
if [ -z "$SC" ]; then echo "  · кук без входа не выдаётся (это нормально)"; else
  echo "$SC" | grep -qi 'httponly' && ok "куки HttpOnly" || bad "кука без HttpOnly"
  echo "$SC" | grep -qi 'secure' && ok "куки Secure" || bad "кука без Secure"
  echo "$SC" | grep -qi 'samesite' && ok "куки SameSite" || warn "кука без SameSite"
fi

echo "== 6. WebSocket по защищённому каналу =="
WS="$(curl -si --max-time 10 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "https://$HOST/ws" | head -1 || true)"
case "$WS" in *101*) ok "wss отвечает (101 Switching Protocols)";; *) warn "путь /ws не ответил 101: ${WS:-нет ответа} (проверьте адрес сокета)";; esac

echo
echo "Итог: ✔ $PASS  ✖ $FAIL  ! $WARN"
echo "Помните: TLS защищает содержимое от чтения и подмены в пути, но оператор связи и владелец Wi-Fi видят IP-адреса, время и объём соединений."
[ "$FAIL" -eq 0 ]
