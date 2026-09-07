#!/usr/bin/env bash
# ============================================================
#  Подключение отправки SMS через TextBee.
#
#      cd /opt/sky && bash scripts/set-sms-key.sh
#
#  Скрипт спрашивает ключ, отправляет с ним пробное сообщение на ваш
#  номер и только потом сохраняет настройку. Так неверный ключ виден
#  сразу, а не тогда, когда кто-то не сможет войти.
#
#  Ключ на экране не появляется: терминал часто фотографируют.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Здесь нет .env — запускайте из каталога приложения."; exit 1; }

set_env() {
  local key="$1" val="$2"
  if grep -q "^$key=" .env; then sed -i "s|^$key=.*|$key=$val|" .env
  else printf '%s=%s\n' "$key" "$val" >> .env; fi
}

echo "Подключение отправки SMS через TextBee."
echo

# ── Ключ ───────────────────────────────────────────────────
printf 'Вставьте ключ из кабинета TextBee и нажмите Enter.\n'
printf 'На экране он не появится — это нормально.\n\n'
printf 'Ключ: '
read -rs KEY </dev/tty
echo
[ -n "$KEY" ] || { echo "Ключ пустой — ничего не меняю."; exit 1; }
echo "Принял ключ длиной ${#KEY} символов."
echo

# ── Номер для проверки ─────────────────────────────────────
printf 'Ваш номер телефона для пробного сообщения (например +79001234567): '
read -r RAW </dev/tty
DIGITS="$(printf '%s' "$RAW" | tr -cd '0-9')"
# Российская восьмёрка → семёрка, как это делает и само приложение.
if [ "${#DIGITS}" = "11" ] && [ "${DIGITS:0:1}" = "8" ]; then DIGITS="7${DIGITS:1}"; fi
if [ "${#DIGITS}" -lt 10 ] || [ "${#DIGITS}" -gt 15 ]; then
  echo "Это не похоже на номер телефона — ничего не меняю."; exit 1
fi
PHONE="+$DIGITS"
echo "Отправляю пробное сообщение на $PHONE …"
echo

# ── Пробная отправка ───────────────────────────────────────
BODY="$(printf '{"recipients":["%s"],"message":"Sky: проверка отправки. Если сообщение пришло, настройка верна."}' "$PHONE")"
HTTP="$(curl -sS -o /tmp/textbee-answer.$$ -w '%{http_code}' \
        -X POST 'https://api.textbee.dev/api/v1/gateway/send-sms' \
        -H 'Content-Type: application/json' \
        -H "x-api-key: $KEY" \
        --data "$BODY" --max-time 20 || echo 000)"
ANSWER="$(head -c 400 /tmp/textbee-answer.$$ 2>/dev/null || true)"
rm -f /tmp/textbee-answer.$$

case "$HTTP" in
  2*)
    echo "TextBee принял сообщение (ответ $HTTP) — значит ключ рабочий."
    ;;
  000)
    echo "Не удалось достучаться до TextBee — похоже, нет связи."
    echo "Настройку не меняю."
    exit 1
    ;;
  401|403)
    echo "TextBee не принял ключ (ответ $HTTP): $ANSWER"
    echo "Проверьте, что ключ скопирован целиком. Настройку не меняю."
    exit 1
    ;;
  *)
    echo "TextBee ответил $HTTP: $ANSWER"
    echo "Настройку не меняю."
    exit 1
    ;;
esac

# ── Что на стороне телефона ────────────────────────────────
#  Принятое сообщение ещё не отправленное: отправляет его телефон с
#  приложением TextBee. Если он выключен, без сети или приложение
#  выгружено системой, сообщение так и останется в очереди. Поэтому
#  сразу показываем, что видит сама служба.
ask_textbee() {                     # ask_textbee <путь> <подпись>
  local out code
  out="$(curl -sS -w '\n%{http_code}' -H "x-api-key: $KEY" \
         "https://api.textbee.dev/api/v1$1" --max-time 20 2>/dev/null || true)"
  code="$(printf '%s' "$out" | tail -1)"
  echo "── $2 (ответ ${code:-нет}):"
  printf '%s' "$out" | head -c 600 | sed '$d'
  echo
}

echo
echo "Смотрю, что происходит на стороне TextBee."
echo
ask_textbee '/gateway/devices'  'подключённые телефоны'
ask_textbee '/gateway/messages' 'последние сообщения'

cat <<'HINT'
Если телефонов в списке нет или последний выход на связь давний —
дело не в ключе, а в телефоне-шлюзе. Проверьте на нём:
  • приложение TextBee запущено;
  • ему разрешена работа в фоне (отключите экономию батареи для него);
  • выдано разрешение на отправку SMS;
  • на SIM есть деньги и подключены SMS.

HINT

# ── Сохранение ─────────────────────────────────────────────
#  Спрашиваем про ключ, а не про доставку: доставку чинят на телефоне,
#  и держать из-за неё настройку несохранённой незачем — ключ верный.
echo
printf 'Сохранить ключ в настройках? [д/н]: '
read -r YES </dev/tty
case "$YES" in
  д|да|y|yes|Д|ДА|Y|YES) ;;
  *) echo "Не сохраняю."; exit 0 ;;
esac

set_env SMS_MODE   'textbee'
set_env SMS_API_ID "$KEY"
unset KEY
chmod 600 .env

echo
echo "==> Перезапускаю приложение"
docker compose up -d api

sleep 8
echo
echo "==> Что говорит сервер"
docker compose logs api --tail 20 | grep -E '\[доставка\]|\[api\]' || true
echo
if docker compose logs api --tail 20 | grep -q 'SMS_MODE'; then
  echo "Осталась жалоба на настройку SMS — посмотрите строку выше."
else
  echo "Готово: отправка SMS настроена."
fi
