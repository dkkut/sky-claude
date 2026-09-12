#!/usr/bin/env bash
# ============================================================
#  Ключ языковой модели — для пересказа выпусков подкастов.
#
#      cd /opt/sky && bash scripts/set-ai-key.sh
#
#  Скрипт спрашивает ключ, проверяет его пробным обращением и только
#  потом сохраняет. Так неверный ключ виден сразу, а не тогда, когда
#  человек нажмёт «Пересказ» и получит отказ.
#
#  Ключ на экране не появляется и в репозиторий не попадает: он живёт
#  только в .env на сервере. Пересказ считается на сервере, в браузер
#  уходит уже готовый текст — ключ клиенту не отдаётся никогда.
#
#  Без этого ключа подкасты работают полностью; нет только пересказа,
#  и экран честно пишет, что он не настроен.
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Здесь нет .env — запускайте из каталога приложения."; exit 1; }

# Читаем ввод с терминала: так работает и при запуске через «bash -s»,
# когда стандартный ввод занят самим скриптом.
if { : </dev/tty; } 2>/dev/null; then INPUT=/dev/tty; else INPUT=/dev/stdin; fi

ask() { read -r "$1" <"$INPUT"; }
ask_secret() { read -rs "$1" <"$INPUT"; echo; }

set_env() {
  local key="$1" val="$2"
  if grep -q "^$key=" .env; then
    # Значение подставляем через awk, а не sed: в ключе бывают символы,
    # которые sed принял бы за часть выражения замены.
    awk -v k="$key" -v v="$val" \
      'BEGIN{FS=OFS="="} $1==k {print k "=" v; done=1; next} {print} END{if(!done) print k "=" v}' \
      .env > .env.tmp && mv .env.tmp .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
  chmod 600 .env
}

echo "Ключ языковой модели для пересказа выпусков подкастов."
echo

printf 'Вставьте ключ и нажмите Enter. На экране он не появится.\n\n'
printf 'Ключ: '
ask_secret KEY
[ -n "$KEY" ] || { echo "Ключ пустой — ничего не меняю."; exit 1; }
echo "Принял ключ длиной ${#KEY} символов."
echo

MODEL_DEFAULT='claude-sonnet-4-5-20250929'
printf 'Модель [%s]: ' "$MODEL_DEFAULT"
ask MODEL
MODEL="${MODEL:-$MODEL_DEFAULT}"
echo

# ── Проба ──────────────────────────────────────────────────
#  Короткий запрос: он стоит копейки и сразу отвечает, принят ли ключ.
echo "Проверяю ключ пробным обращением …"
BODY="$(printf '{"model":"%s","max_tokens":16,"messages":[{"role":"user","content":"ответь словом: готово"}]}' "$MODEL")"
HTTP="$(curl -sS -o /tmp/ai-answer.$$ -w '%{http_code}' \
        -X POST 'https://api.anthropic.com/v1/messages' \
        -H 'content-type: application/json' \
        -H "x-api-key: $KEY" \
        -H 'anthropic-version: 2023-06-01' \
        --data "$BODY" --max-time 30 || echo 000)"
ANSWER="$(head -c 300 /tmp/ai-answer.$$ 2>/dev/null || true)"
rm -f /tmp/ai-answer.$$

case "$HTTP" in
  2*) echo "Ключ принят (ответ $HTTP)." ;;
  000)
    echo "Не удалось достучаться до поставщика — похоже, нет связи."
    echo "Настройку не меняю."; exit 1 ;;
  401|403)
    echo "Ключ не принят (ответ $HTTP): $ANSWER"
    echo "Проверьте, что он скопирован целиком. Настройку не меняю."; exit 1 ;;
  404)
    echo "Такой модели нет (ответ $HTTP): $ANSWER"
    echo "Проверьте название модели. Настройку не меняю."; exit 1 ;;
  *)
    echo "Поставщик ответил $HTTP: $ANSWER"
    echo "Настройку не меняю."; exit 1 ;;
esac

echo
printf 'Сохранить ключ в настройках? [д/н]: '
ask YES
case "$YES" in
  д|да|y|yes|Д|ДА|Y|YES) ;;
  *) echo "Не сохраняю."; exit 0 ;;
esac

set_env AI_API_KEY "$KEY"
set_env AI_MODEL   "$MODEL"
unset KEY

echo
echo "==> Перезапускаю приложение"
docker compose up -d api
sleep 6
echo
echo "Готово: пересказ выпусков включён."
echo "Ключ лежит только в .env на этом сервере, права 600."
