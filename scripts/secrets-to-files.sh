#!/usr/bin/env bash
# Перенос секретов API из .env в файлы secrets/ (Docker secrets): в окружении контейнера значений больше нет —
# `docker inspect` и /proc/<pid>/environ их не покажут. Сервер читает их через <ИМЯ>_FILE (server/envfile.mjs).
#
#   cd /opt/sky
#   bash /opt/sky-src/scripts/secrets-to-files.sh            # создать secrets/*, docker-compose.secrets.local и COMPOSE_FILE в .env (значения в .env пока остаются)
#   bash /opt/sky-src/scripts/deploy-local.sh                # применить (контейнеры перезапустятся)
#   bash /opt/sky-src/scripts/secrets-to-files.sh --strip    # после проверки, что всё работает: убрать значения из .env
#   bash /opt/sky-src/scripts/secrets-to-files.sh --revert   # вернуть как было (значения в .env, без файлов)
#
# Секреты в файлах: каталог 700, файлы 400. ВАЖНО: сначала сделайте общую копию (bash scripts/secrets-export.sh) — по ней можно всё восстановить.
set -euo pipefail
cd "${APP_DIR:-/opt/sky}"
[ -f .env ] || { echo "Нет .env в $PWD"; exit 1; }
# имя в .env : имя файла : переменная в контейнере
MAP=( "JWT_SECRET:jwt_secret" "REFRESH_TOKEN_SECRET:refresh_token_secret" "ENCRYPTION_KEY:encryption_key" "AI_API_KEY:ai_api_key" "STORAGE_S3_ACCESS_KEY:s3_access_key" "STORAGE_S3_SECRET_KEY:s3_secret_key" )
OV=docker-compose.secrets.local
get_env() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//" || true; }
set_env() { local k="$1" v="$2" tmp; tmp="$(mktemp .env.XXXXXX)"; grep -vE "^$k=" .env > "$tmp" || true; printf '%s=%s\n' "$k" "$v" >> "$tmp"; chmod 600 "$tmp"; mv "$tmp" .env; }
del_env() { local tmp; tmp="$(mktemp .env.XXXXXX)"; grep -vE "^$1=" .env > "$tmp" || true; chmod 600 "$tmp"; mv "$tmp" .env; }

case "${1:-}" in
  "")
    umask 077; mkdir -p secrets; chmod 700 secrets
    { echo "# Создано scripts/secrets-to-files.sh — не коммитить."; echo "services:"; echo "  api:"; echo "    environment:"; } > "$OV.tmp"
    list=(); defs=(); n=0
    for m in "${MAP[@]}"; do
      name="${m%%:*}"; f="${m#*:}"; v="$(get_env "$name")"
      if [ -z "$v" ] && [ -f "secrets/$f" ]; then echo "  = $name уже в secrets/$f"; v="$(cat "secrets/$f")"; fi
      [ -n "$v" ] || { echo "  – $name не задан, пропускаю"; continue; }
      if [ -f "secrets/$f" ] && [ "$(cat "secrets/$f")" != "$v" ]; then echo "  ✖ secrets/$f отличается от значения в .env — разберитесь вручную (не перезаписываю)"; exit 1; fi
      [ -f "secrets/$f" ] || { printf '%s' "$v" > "secrets/$f"; chmod 400 "secrets/$f"; }
      # API в контейнере работает от пользователя node (uid 1000): файл с владельцем root и правами 400 он бы не прочитал.
      [ "$(id -u)" = 0 ] && chown 1000:1000 "secrets/$f" 2>/dev/null || true
      echo "  ✔ $name → secrets/$f"
      echo "      $name: \"\"" >> "$OV.tmp"; echo "      ${name}_FILE: /run/secrets/$f" >> "$OV.tmp"
      list+=("$f"); defs+=("  $f: { file: ./secrets/$f }"); n=$((n+1))
    done
    [ "$n" -gt 0 ] || { rm -f "$OV.tmp"; echo "Нечего переносить."; exit 1; }
    { echo "    secrets: [$(IFS=,; echo "${list[*]}" | sed 's/,/, /g')]"; echo "secrets:"; printf '%s\n' "${defs[@]}"; } >> "$OV.tmp"
    mv "$OV.tmp" "$OV"; chmod 600 "$OV"
    set_env COMPOSE_FILE "docker-compose.yml:$OV"
    echo; echo "Готово: $n секретов в secrets/, COMPOSE_FILE в .env. Значения в .env пока остаются."
    echo "Применить: bash /opt/sky-src/scripts/deploy-local.sh. Проверить, что сервер поднялся и вход работает; потом: $0 --strip"
    ;;
  --strip)
    [ -f "$OV" ] || { echo "Сначала запустите без параметров."; exit 1; }
    for m in "${MAP[@]}"; do
      name="${m%%:*}"; f="${m#*:}"; [ -f "secrets/$f" ] || continue
      v="$(get_env "$name")"; [ -z "$v" ] && continue
      [ "$(cat "secrets/$f")" = "$v" ] || { echo "✖ secrets/$f не совпадает с .env — ничего не убираю"; exit 1; }
    done
    docker compose config >/dev/null 2>&1 || { echo "✖ docker compose config не проходит — не убираю секреты из .env"; exit 1; }
    read -r -p "Убрать значения секретов из .env? Они останутся только в secrets/ и в вашей копии. [да/нет] " a; [ "$a" = да ] || { echo "Отменено."; exit 0; }
    for m in "${MAP[@]}"; do name="${m%%:*}"; [ -f "secrets/${m#*:}" ] && del_env "$name"; done
    echo "✔ Значения убраны из .env. Применить: bash /opt/sky-src/scripts/deploy-local.sh"
    ;;
  --revert)
    for m in "${MAP[@]}"; do name="${m%%:*}"; f="${m#*:}"; [ -f "secrets/$f" ] && [ -z "$(get_env "$name")" ] && set_env "$name" "$(cat "secrets/$f")"; done
    del_env COMPOSE_FILE; rm -f "$OV"
    echo "✔ Значения возвращены в .env, надстройка убрана. Каталог secrets/ оставлен — удалите (shred -u secrets/*) после проверки. Применить: deploy-local.sh"
    ;;
  *) sed -n 2,12p "$0"; exit 1;;
esac
