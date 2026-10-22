#!/usr/bin/env bash
# ============================================================
#  Восстановление пропавшего .env из РАБОТАЮЩИХ контейнеров.
#
#      bash /opt/sky-src/scripts/env-recover.sh [каталог]     (по умолчанию /opt/sky)
#
#  Пока контейнеры не пересозданы, все значения (JWT_SECRET, ENCRYPTION_KEY, пароли…) лежат в их окружении.
#  Скрипт читает их через docker inspect и пишет <каталог>/.env.recovered (права 600). Секреты на экран НЕ печатает.
#  Ничего не перезапускает и не трогает существующий .env. После проверки: mv .env.recovered .env
#  НЕ запускайте `docker compose up` / deploy-local.sh, пока .env не восстановлен: пересоздание без него
#  стартует с пустыми секретами (сессии и зашифрованные данные станут нечитаемыми).
# ============================================================
set -euo pipefail
APP_DIR="${1:-/opt/sky}"
OUT="$APP_DIR/.env.recovered"
command -v docker >/dev/null || { echo "docker не найден"; exit 1; }
umask 077
: > "$OUT"
NOISE='^(PATH|HOME|HOSTNAME|TERM|NODE_VERSION|YARN_VERSION|PWD|SHLVL|_|LANG|GPG_KEY|PGDATA|PG_MAJOR|PG_VERSION|POSTGRES_INITDB_ARGS|NGINX_VERSION|NJS_VERSION|PKG_RELEASE|DYNPKG_RELEASE|NJS_RELEASE)$'
found=0
declare -A SEEN
for svc in api web postgres redis; do
  id="$(docker ps -q --filter "label=com.docker.compose.service=$svc" | head -n1)"
  [ -n "$id" ] || { echo "• $svc: контейнер не запущен — пропускаю"; continue; }
  found=1
  while IFS= read -r line; do
    k="${line%%=*}"; v="${line#*=}"
    [[ "$k" =~ $NOISE ]] && continue
    [ -n "${SEEN[$k]:-}" ] && continue
    SEEN[$k]=1
    printf '%s=%s\n' "$k" "$v" >> "$OUT"
  done < <(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$id")
  img="$(docker inspect --format '{{.Config.Image}}' "$id")"
  case "$svc" in
    api) [ -z "${SEEN[API_IMAGE]:-}" ] && { echo "API_IMAGE=$img" >> "$OUT"; SEEN[API_IMAGE]=1; } ;;
    web) [ -z "${SEEN[WEB_IMAGE]:-}" ] && { echo "WEB_IMAGE=$img" >> "$OUT"; SEEN[WEB_IMAGE]=1; } ;;
  esac
  echo "• $svc: прочитано"
done
[ "$found" = 1 ] || { rm -f "$OUT"; echo "Ни один контейнер не запущен — взять значения неоткуда. См. DEPLOY.md / секреты: secrets/, sky-secrets-*.txt.gpg"; exit 1; }
chmod 600 "$OUT"
echo
echo "Записано: $OUT  ($(wc -l < "$OUT") строк, значения не показаны)"
echo "Ключи, без которых нельзя запускаться:"
for k in JWT_SECRET REFRESH_TOKEN_SECRET ENCRYPTION_KEY DATABASE_URL POSTGRES_PASSWORD DOMAIN; do
  if [ -n "${SEEN[$k]:-}" ]; then echo "  ✓ $k"; else echo "  ✗ $k — НЕТ (искать в secrets/, выгрузке секретов, у хостера)"; fi
done
echo
echo "Дальше:  cp $OUT $APP_DIR/.env && chmod 600 $APP_DIR/.env && bash /opt/sky-src/scripts/env-check.sh"
