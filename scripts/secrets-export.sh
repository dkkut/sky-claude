#!/usr/bin/env bash
# Все секреты Sky в ОДИН зашифрованный файл — с описанием, где какой используется и что будет, если потерять.
#   cd /opt/sky
#   bash /opt/sky-src/scripts/secrets-export.sh export          # создать sky-secrets-….txt.gpg (спросит пароль дважды)
#   bash /opt/sky-src/scripts/secrets-export.sh list  файл.gpg  # показать ТОЛЬКО имена и описания (значения скрыты)
#   bash /opt/sky-src/scripts/secrets-export.sh show  файл.gpg  # показать всё, включая значения (на вашем компьютере!)
#   bash /opt/sky-src/scripts/secrets-export.sh compare файл.gpg # совпадает ли файл с текущими секретами сервера
#
# Файл защищён паролем (gpg, AES-256). Скачайте его (SFTP), проверьте на своём компьютере и УДАЛИТЕ с сервера: shred -u sky-secrets-*.gpg
# Пароль храните отдельно от файла (менеджер паролей). Потеряете пароль — файл не открыть, и восстановить его нельзя.
# На компьютере открыть можно и вручную:  gpg -d sky-secrets-….txt.gpg
set -euo pipefail
cd "${APP_DIR:-/opt/sky}"
command -v gpg >/dev/null 2>&1 || { echo "Нужен gpg: apt-get install -y gnupg"; exit 1; }
ENVF="${ENV_FILE:-.env}"
export GPG_TTY="$(tty 2>/dev/null || true)"
ask() { local p; if [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; then read -rsp "$1" p </dev/tty; else read -rsp "$1" p; fi; echo >&2; printf '%s' "$p"; }
G=(gpg --batch --yes --pinentry-mode loopback --quiet)

# ИМЯ | файл в secrets/ | важность | где используется и что будет при потере
CATALOG='JWT_SECRET|jwt_secret|КРИТИЧНО|Подпись токенов входа (server/config.mjs). Потеря/смена: все пользователи будут разлогинены; данные целы. Если ENCRYPTION_KEY не задан — ключ шифрования выводится из него (тогда потеря = потеря данных).
REFRESH_TOKEN_SECRET|refresh_token_secret|КРИТИЧНО|Подпись refresh-токенов. Потеря/смена: все сессии завершатся; данные целы.
ENCRYPTION_KEY|encryption_key|КРИТИЧНО|Главный ключ шифрования данных в базе (секреты 2FA, переписка, адреса, реквизиты) и файлов (SKE1). ПОТЕРЯ = ДАННЫЕ НЕ ВОССТАНОВИТЬ. Хранить отдельно от копий.
STORAGE_KEK_ACTIVE||КРИТИЧНО|Какой из ключей STORAGE_KEK_K* сейчас шифрует резервные копии Sky Storage.
STORAGE_KEK_K1||КРИТИЧНО|Ключ шифрования резервных копий Sky Storage (слот K1). Без него копии, созданные этим ключом, не открыть.
STORAGE_KEK_K2||КРИТИЧНО|Ключ шифрования резервных копий Sky Storage (слот K2).
STORAGE_KEK_K3||КРИТИЧНО|Ключ шифрования резервных копий Sky Storage (слот K3).
STORAGE_KEK_K4||КРИТИЧНО|Ключ шифрования резервных копий Sky Storage (слот K4).
POSTGRES_PASSWORD||КРИТИЧНО|Пароль владельца базы Postgres (миграции, backup.sh). Потеря: сброс через docker exec в контейнере postgres.
APP_DB_PASSWORD||ВАЖНО|Пароль роли sky_app (приложение без прав DDL; scripts/db-harden.sh).
APP_DATABASE_URL||ВАЖНО|Строка подключения приложения к базе (содержит пароль sky_app).
REDIS_PASSWORD||ВАЖНО|Пароль Redis (сессии, лимиты). Потеря: можно сменить, сессии сбросятся.
STORAGE_S3_ACCESS_KEY|s3_access_key|ВАЖНО|Ключ доступа к S3 хостера (медиа и копии). Выпускается у хостера; хранить только на сервере Sky.
STORAGE_S3_SECRET_KEY|s3_secret_key|ВАЖНО|Секретный ключ S3 хостера (пара к STORAGE_S3_ACCESS_KEY). Потеря: выпустить новую пару у хостера (scripts/setup-storage.sh --rotate-keys).
STORAGE_BACKUP_S3_ACCESS_KEY||ВАЖНО|Ключ доступа к ОТДЕЛЬНОМУ бакету резервных копий.
STORAGE_BACKUP_S3_SECRET_KEY||ВАЖНО|Секретный ключ отдельного бакета резервных копий.
BACKUP_AGE_RECIPIENT||ИНФО|Публичный ключ age для шифрования копий (backup.sh). Не секрет. Секретная часть (backup.key) у вас на компьютере, на сервере её быть не должно.
SSH_GATE_SECRET||ВАЖНО|Подпись запросов крючка SSH-подтверждения (scripts/ssh-gate.sh). Потеря: сгенерировать новый и переустановить крючок.
OWNER_CLAIM_TOKEN||ВАЖНО|Одноразовый ключ, которым владелец занимает свой ник при первом входе.
AI_API_KEY|ai_api_key|ВАЖНО|Ключ поставщика ИИ для Sky AI (платный). Потеря: выпустить новый у поставщика.
STT_API_KEY||ИНФО|Ключ распознавания речи.
TTS_API_KEY||ИНФО|Ключ озвучки ответов Sky AI.
VAPID_PRIVATE_KEY||ВАЖНО|Секретный ключ Web Push (уведомления в браузере). Потеря/смена: пользователям придётся заново разрешить уведомления.
VAPID_PUBLIC_KEY||ИНФО|Публичный ключ Web Push (пара к приватному, не секрет).
FCM_SERVICE_ACCOUNT_JSON||ВАЖНО|Сервисный аккаунт Firebase (push на Android).
SMTP_PASS||ВАЖНО|Пароль почты для писем с кодами и ссылками.
RESEND_API_KEY||ВАЖНО|Ключ Resend для писем (если используется вместо SMTP).
EMAIL_WEBHOOK_TOKEN||ИНФО|Токен вебхука почтового шлюза.
SMS_WEBHOOK_TOKEN||ИНФО|Токен вебхука SMS-шлюза.
SMS_API_ID||ИНФО|Ключ SMS-провайдера.
GOOGLE_MAPS_KEY||ИНФО|Ключ Google Maps (карты, маршруты, геокодер) — серверный.
YANDEX_MAPS_KEY||ИНФО|Ключ Яндекс Карт (Static API).
YANDEX_GEOCODER_KEY||ИНФО|Ключ Яндекс Геокодера.
TRAVELPAYOUTS_TOKEN||ИНФО|Токен Travelpayouts (авиабилеты Sky GO).
TRACK17_API_KEY||ИНФО|Ключ 17track (отслеживание посылок).
CDEK_CLIENT_SECRET||ИНФО|Секрет API СДЭК.
RUSSIANPOST_API_PASSWORD||ИНФО|Пароль API Почты России.
SKYKASSA_PARTNERS_JSON||ВАЖНО|Секреты платёжных партнёров SkyKassa (JSON). Отдельные: SKYKASSA_PARTNER_<ID>_SECRET.
BETA_KEYS||ИНФО|Ключи закрытой беты.'

# значения: .env, а если там пусто — файл secrets/<имя>
getv() {
  local v; v="$(grep -E "^$1=" "$ENVF" 2>/dev/null | tail -n1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//" || true)"
  [ -z "$v" ] && [ -n "${2:-}" ] && [ -f "secrets/$2" ] && v="$(cat "secrets/$2")"
  printf '%s' "$v"
}
build() {
  [ -f "$ENVF" ] || [ -d secrets ] || { echo "Нет $ENVF и secrets/ в $PWD" >&2; exit 1; }
  echo "# Секреты Sky — выгрузка $(date '+%Y-%m-%d %H:%M:%S'), сервер $(hostname)"
  echo "# Формат: [ИМЯ] важность — где используется; следом строка ИМЯ=значение. Хранить как пароль от банка."
  echo
  local seen=" " name f imp desc v n=0
  while IFS='|' read -r name f imp desc; do
    [ -n "$name" ] || continue; seen+="$name "
    v="$(getv "$name" "$f")"; [ -n "$v" ] || continue
    printf '[%s] %s — %s\n%s=%s\n\n' "$name" "$imp" "$desc" "$name" "$v"; n=$((n+1))
  done <<<"$CATALOG"
  # Всё остальное секретное, чего нет в каталоге: имя похоже на секрет — выгружаем с пометкой.
  if [ -f "$ENVF" ]; then
    while IFS= read -r name; do
      case "$seen" in *" $name "*) continue;; esac
      v="$(getv "$name")"; [ -n "$v" ] || continue
      printf '[%s] ПРОЧЕЕ — в каталоге скрипта не описан; проверьте по docker-compose.yml и CLAUDE.md, где используется.\n%s=%s\n\n' "$name" "$name" "$v"; n=$((n+1))
    done < <(grep -oE '^[A-Z0-9_]*(SECRET|PASSWORD|PASS|TOKEN|PRIVATE|_KEY|_JSON|KEK)[A-Z0-9_]*=' "$ENVF" | tr -d '=' | grep -v '_FILE$' | sort -u)
  fi
  echo "# Итого записей: $n"
  echo "# Не входит сюда: пароль от этого файла, секретный ключ age (backup.key, у вас на компьютере), пароль от .env.gpg, доступ к хостеру/домену/GitHub."
}
decrypt() { local pw; pw="$(ask 'Пароль от файла: ')"; "${G[@]}" --decrypt --passphrase-fd 3 "$1" 3<<<"$pw" 2>/dev/null || { echo "✖ Не открылся (неверный пароль или файл повреждён)." >&2; return 1; }; }

case "${1:-}" in
  export)
    umask 077
    pw1="$(ask 'Придумайте пароль для файла (не короче 12 знаков): ')"; pw2="$(ask 'Повторите пароль: ')"
    [ "$pw1" = "$pw2" ] || { echo "Пароли не совпали."; exit 1; }
    [ "${#pw1}" -ge 12 ] || { echo "Пароль короче 12 знаков."; exit 1; }
    out="sky-secrets-$(date +%Y%m%d-%H%M%S).txt.gpg"
    body="$(build)"; n="$(printf '%s\n' "$body" | grep -c '^\[')"
    [ "$n" -gt 0 ] || { echo "Секретов не найдено."; exit 1; }
    printf '%s\n' "$body" | "${G[@]}" --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-count 65011712 --s2k-digest-algo SHA512 --passphrase-fd 3 -o "$out" 3<<<"$pw1"
    unset body pw1 pw2
    # Проверка: открывается и записей столько же
    pw="$(ask 'Введите пароль ещё раз для проверки файла: ')"
    m="$("${G[@]}" --decrypt --passphrase-fd 3 "$out" 3<<<"$pw" 2>/dev/null | grep -c '^\[' || true)"; unset pw
    [ "$m" = "$n" ] || { rm -f "$out"; echo "✖ Проверка не прошла, файл удалён."; exit 1; }
    chmod 600 "$out"
    echo "✔ Готово: $PWD/$out ($n секретов, файл открывается вашим паролем)."
    echo "Дальше: 1) скачайте файл через SFTP; 2) на компьютере: gpg -d файл (проверьте); 3) удалите с сервера: shred -u $out"
    ;;
  list)  [ -f "${2:-}" ] || { echo "Укажите файл"; exit 1; }; decrypt "$2" | grep -E '^(\[|#)' ;;
  show)  [ -f "${2:-}" ] || { echo "Укажите файл"; exit 1; }; decrypt "$2" ;;
  compare)
    [ -f "${2:-}" ] || { echo "Укажите файл"; exit 1; }
    a="$(decrypt "$2" | grep -vE '^(#|\[|$)' | sort)"; b="$(build | grep -vE '^(#|\[|$)' | sort)"
    if [ "$a" = "$b" ]; then echo "✔ Файл совпадает с текущими секретами сервера."; else echo "⚠ Отличается (после смены ключей сделайте новую выгрузку). Расходятся имена:"; diff <(printf '%s\n' "$a" | sed 's/=.*//') <(printf '%s\n' "$b" | sed 's/=.*//') || true; exit 2; fi ;;
  *) sed -n 2,11p "$0"; exit 1;;
esac
