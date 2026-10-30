#!/usr/bin/env bash
# ============================================================
#  Резервная копия Sky: база + загруженные файлы.
#
#      bash /opt/sky-src/scripts/backup.sh            # копия в /var/backups/sky
#      DEST=/mnt/disk/sky KEEP=14 bash scripts/backup.sh
#
#  Скрипт ТОЛЬКО ЧИТАЕТ рабочие данные: ничего не останавливает, не
#  удаляет и не меняет. Удаляются лишь собственные старые копии в DEST
#  (оставляется последних KEEP штук).
#
#  ШИФРОВАНИЕ КОПИЙ (ОБЯЗАТЕЛЬНО, без ключа копия не делается; BACKUP_ALLOW_PLAIN=1 — осознанное исключение): дамп базы содержит профили, заказы, адреса и
#  другие данные, зашифрованные только частично. Задайте публичный ключ age:
#
#      BACKUP_AGE_RECIPIENT=age1… bash scripts/backup.sh
#      (или BACKUP_AGE_RECIPIENTS_FILE=/путь/к/recipients.txt)
#
#  Тогда копии лежат как *.gz.age, а расшифровать их можно только секретным ключом
#  (age-keygen -o backup.key; секретный ключ хранить ВНЕ сервера). На сервере остаётся
#  один публичный ключ — захват сервера не открывает старые копии. Если ключ задан, а
#  `age` не установлен, скрипт останавливается, а не пишет копию открытым текстом.
#  Проверка восстановления на временной базе: scripts/backup-verify.sh.
#
#  ВАЖНО. Файлы (музыка, кино, видео, документы) и часть полей базы
#  лежат ЗАШИФРОВАННЫМИ. Копия без ключа — набор нечитаемых байтов.
#  Ключ ENCRYPTION_KEY из .env скрипт НЕ копирует (секрет не должен
#  лежать рядом с данными): сохраните его отдельно — например, в
#  менеджере паролей. Потеряли ключ — потеряли и копию, и оригинал.
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/sky}"
DEST="${DEST:-/var/backups/sky}"
KEEP="${KEEP:-7}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"

# Публичный ключ age можно держать в .env (BACKUP_AGE_RECIPIENT=age1…), чтобы он применялся и при запуске из cron.
if [ -z "${BACKUP_AGE_RECIPIENT:-}" ] && [ -z "${BACKUP_AGE_RECIPIENTS_FILE:-}" ] && [ -f "$APP_DIR/.env" ]; then
  BACKUP_AGE_RECIPIENT="$(grep -E '^BACKUP_AGE_RECIPIENT=' "$APP_DIR/.env" | tail -n1 | cut -d= -f2- | tr -d "\"' \r")"
fi
# Шифрование: через публичный ключ age (секретного ключа на сервере нет).
AGE_ARGS=()
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then AGE_ARGS=(-r "$BACKUP_AGE_RECIPIENT")
elif [ -n "${BACKUP_AGE_RECIPIENTS_FILE:-}" ]; then AGE_ARGS=(-R "$BACKUP_AGE_RECIPIENTS_FILE"); fi
EXT=gz
# Открытая копия — только по явному решению (BACKUP_ALLOW_PLAIN=1): по умолчанию без ключа копия не делается.
if [ "${#AGE_ARGS[@]}" -eq 0 ] && [ "${BACKUP_ALLOW_PLAIN:-}" != 1 ]; then
  echo "Не задан публичный ключ age (BACKUP_AGE_RECIPIENT=age1… в $APP_DIR/.env или в окружении). Копия не сделана: открытый дамп не пишем."
  echo "Если открытая копия нужна осознанно — BACKUP_ALLOW_PLAIN=1."; exit 1
fi
if [ "${#AGE_ARGS[@]}" -gt 0 ]; then
  command -v age >/dev/null 2>&1 || { echo "Задан ключ шифрования, но программа age не установлена (apt install age). Копия не сделана."; exit 1; }
  EXT=gz.age
fi
# Пишет stdin в файл, шифруя при заданном ключе; ошибку любого звена конвейера не глотает.
emit() { if [ "${#AGE_ARGS[@]}" -gt 0 ]; then age "${AGE_ARGS[@]}" > "$1"; else cat > "$1"; fi; }
# Проверка целостности: открытый архив — gzip -t; зашифрованный — заголовок age и ненулевой размер.
verify_file() {
  if [ "$EXT" = gz ]; then gzip -t "$1"; else head -c 22 "$1" | grep -q '^age-encryption.org' && [ -s "$1" ]; fi
}

# Что копировать (BACKUP_WHAT, через запятую): db — база; files — загруженные файлы (том /data); config — .env, secrets/ (зашифровано);
# host — настройки хоста /etc/sky-*; certs — сертификаты Let's Encrypt (закрытые ключи, только зашифрованно). По умолчанию: db,files,config.
# Папки внутри /data: BACKUP_DATA_DIRS=music,film (только они; пусто — всё) и BACKUP_DATA_EXCLUDE=transfer,storage-staging (исключить).
WHAT=",${BACKUP_WHAT:-db,files,config},"; WHAT="${WHAT// /}"
for w in $(echo "${BACKUP_WHAT:-db,files,config}" | tr ',' ' '); do
  case "$w" in db|files|config|host|certs) ;; *) echo "BACKUP_WHAT: неизвестный состав «$w» (допустимо: db, files, config, host, certs)."; exit 1;; esac
done
want() { case "$WHAT" in *",$1,"*) return 0;; esac; return 1; }
[ -f "$APP_DIR/docker-compose.yml" ] || { echo "В $APP_DIR нет docker-compose.yml — задайте APP_DIR."; exit 1; }
mkdir -p "$DEST"
chmod 700 "$DEST"
cd "$APP_DIR"

# Один запуск за раз: параллельные копии (таймер + ручной запуск + «догонялка») забивали диск и процессор.
LOCK="${BACKUP_LOCK:-/var/lock/sky-backup.lock}"
if command -v flock >/dev/null 2>&1; then exec 9>"$LOCK"; flock -n 9 || { echo "Другая копия уже идёт ($LOCK) — выхожу."; exit 0; }; fi

# Недописанные файлы никогда не попадают в набор: пишем в *.partial и переименовываем только после успешного завершения всего конвейера.
PARTIALS=()
cleanup() { for f in "${PARTIALS[@]:-}"; do [ -n "$f" ] && rm -f -- "$f"; done; }
trap cleanup EXIT
# Сначала убираем обрывки прошлых упавших запусков (старше часа: живой запуск держит lock, так что чужие тут уже мертвы).
find "$DEST" -maxdepth 1 -name '*.partial' -mmin +60 -delete 2>/dev/null || true

# Фоновая работа не должна отнимать у сайта процессор и диск: понижаем приоритет и на хосте, и (где есть утилиты) внутри контейнера.
LOW=""; command -v nice >/dev/null 2>&1 && LOW="nice -n 19"; command -v ionice >/dev/null 2>&1 && LOW="$LOW ionice -c3"
STEP_TIMEOUT="${STEP_TIMEOUT:-4h}"; TIMEOUT=""; command -v timeout >/dev/null 2>&1 && TIMEOUT="timeout $STEP_TIMEOUT"

# Контейнеры должны быть в строю (во время деплоя они на минуту-другую перезапускаются): ждём до 10 минут, а не падаем сразу.
wait_service() {
  for _ in $(seq 1 60); do docker compose exec -T "$1" true >/dev/null 2>&1 && return 0; sleep 10; done
  echo "Сервис $1 не отвечает 10 минут — копия не сделана."; return 1
}
want db && wait_service postgres
want files && wait_service api

# Место: данные + база + запас. Раньше копия молча забивала диск, и «ложился» весь сервер (Postgres без места падает первым).
need_mb=500; want files && need_mb=$(( $(docker compose exec -T api du -sm /data 2>/dev/null | cut -f1 | tr -dc 0-9 | head -c 9 || echo 0) + 500 ))
free_mb=$(df -Pm "$DEST" | awk 'NR==2{print $4}' | tr -dc 0-9)
if [ "${need_mb:-0}" -gt "${free_mb:-0}" ] && [ "${BACKUP_SKIP_SPACE_CHECK:-0}" != 1 ]; then
  echo "Мало места в $DEST: нужно примерно ${need_mb} МБ, свободно ${free_mb} МБ. Копия не сделана (чтобы не забить диск сервера)."
  echo "Освободите место, задайте DEST на другой диск или включите хранилище копий: bash scripts/use-backup-storage.sh"; exit 1
fi

# Конвейер → *.partial → проверка → переименование. $1 — итоговое имя; остальное — команда, пишущая данные в stdout.
publish() {
  local final="$1"; shift
  local part="$final.partial"; PARTIALS+=("$part")
  { "$@" | emit "$part"; } || { echo "ОШИБКА: не удалось записать $(basename "$final")"; rm -f -- "$part"; return 1; }
  verify_file "$part" || { echo "ОШИБКА: проверка $(basename "$final") не прошла"; rm -f -- "$part"; return 1; }
  mv -f -- "$part" "$final"
}

if want db; then
echo "==> База данных"
publish "$DEST/db-$STAMP.sql.$EXT" bash -o pipefail -c "$TIMEOUT $LOW docker compose exec -T postgres pg_dump -U sky sky | gzip -3"
echo "    $(du -h "$DEST/db-$STAMP.sql.$EXT" | cut -f1)  db-$STAMP.sql.$EXT (целостность проверена)"
fi

if want files; then
echo "==> Загруженные файлы (том /data сервиса api)${BACKUP_DATA_DIRS:+ — только: $BACKUP_DATA_DIRS}${BACKUP_DATA_EXCLUDE:+, кроме: $BACKUP_DATA_EXCLUDE}"
# Читаем из контейнера api: имена томов зависят от имени проекта compose, а внутри контейнера путь всегда один — /data.
# Файлы сервисов уже зашифрованы и сжаты — сильное сжатие только жжёт процессор (gzip -1); утилиты приоритета — если есть в образе.
# Имена папок — только буквы/цифры/«-_», иначе в команду контейнера попало бы постороннее.
for n in $(echo "${BACKUP_DATA_DIRS:-} ${BACKUP_DATA_EXCLUDE:-}" | tr ',' ' '); do case "$n" in *[!A-Za-z0-9_-]*) echo "Имя папки «$n» недопустимо (BACKUP_DATA_DIRS / BACKUP_DATA_EXCLUDE)."; exit 1;; esac; done
TAR_SRC="."; for n in $(echo "${BACKUP_DATA_DIRS:-}" | tr ',' ' '); do [ "$TAR_SRC" = . ] && TAR_SRC=""; TAR_SRC="$TAR_SRC ./$n"; done
TAR_EXC=""; for n in $(echo "${BACKUP_DATA_EXCLUDE:-}" | tr ',' ' '); do TAR_EXC="$TAR_EXC --exclude=./$n"; done
publish "$DEST/files-$STAMP.tar.$EXT" bash -o pipefail -c "$TIMEOUT docker compose exec -T api sh -c 'N=\"\"; command -v nice >/dev/null 2>&1 && N=\"nice -n 19\"; cd /data; S=\"\"; for d in $TAR_SRC; do [ \"\$d\" = . ] || [ -e \"\$d\" ] && S=\"\$S \$d\"; done; \$N tar cf - $TAR_EXC \$S' | $LOW gzip -1"
echo "    $(du -h "$DEST/files-$STAMP.tar.$EXT" | cut -f1)  files-$STAMP.tar.$EXT"
fi

# Настройки и секреты (.env, secrets/, docker-compose.secrets.local): без них копия базы и файлов не поднимается
# (так и вышло при потере .env). Только в ЗАШИФРОВАННОМ виде: открытой копией секреты не пишем.
if want config; then
echo "==> Настройки и секреты (.env, secrets/)"
if [ "$EXT" = gz.age ]; then
  CFG=()
  for f in .env docker-compose.secrets.local secrets; do [ -e "$APP_DIR/$f" ] && CFG+=("$f"); done
  if [ "${#CFG[@]}" -gt 0 ]; then
    publish "$DEST/config-$STAMP.tar.$EXT" tar czf - -C "$APP_DIR" "${CFG[@]}"
    echo "    $(du -h "$DEST/config-$STAMP.tar.$EXT" | cut -f1)  config-$STAMP.tar.$EXT (зашифровано)"
  fi
else
  echo "    пропущено: без шифрования (age) секреты в копию не кладём"
fi
fi

# Настройки хоста (таймеры, SSH-шлюз, Sky Control…) и сертификаты — тоже только зашифрованно.
if want host && [ "$EXT" = gz.age ]; then
  echo "==> Настройки хоста (/etc/sky-*)"
  HC=(); for f in /etc/sky-backup.env /etc/sky-watchdog.env /etc/sky-ssh-gate.conf /etc/sky-ssh-gate.totp /etc/sky-rescue.user /etc/sky-control /etc/sky-guard.env /etc/sky-sandbox.env /etc/sky-ssh-gate.off; do [ -e "$f" ] && HC+=("${f#/}"); done
  if [ "${#HC[@]}" -gt 0 ]; then publish "$DEST/host-config-$STAMP.tar.$EXT" tar czf - -C / "${HC[@]}"; echo "    host-config-$STAMP.tar.$EXT (${#HC[@]} путей, зашифровано)"; else echo "    настроек хоста не найдено"; fi
elif want host; then echo "==> Настройки хоста: пропущено — без шифрования (age) не кладём"; fi
if want certs && [ "$EXT" = gz.age ]; then
  echo "==> Сертификаты (закрытые ключи!)"
  publish "$DEST/certs-$STAMP.tar.$EXT" bash -o pipefail -c "docker compose run --rm --no-deps -T --entrypoint sh certbot -c 'tar czf - -C /etc/letsencrypt .'"
  echo "    certs-$STAMP.tar.$EXT (зашифровано)"
elif want certs; then echo "==> Сертификаты: пропущено — без шифрования (age) не кладём"; fi

# Прореживание — только когда НОВЫЙ набор целиком записан (сюда доходим лишь при успехе всех шагов выше).
echo "==> Старые копии (оставляю последних $KEEP)"
for kind in db files config host-config certs; do
  # ls возвращает 2, если одного из шаблонов (*.gz при шифрованных копиях) нет — под pipefail это раньше валило ВЕСЬ скрипт после успешной копии
  # (обёртка считала запуск сбойным: слала письмо и не загружала копии в хранилище/на другой сервер).
  { ls -1t "$DEST"/$kind-*.gz "$DEST"/$kind-*.gz.age 2>/dev/null || true; } | tail -n +$((KEEP + 1)) | while read -r old; do
    echo "    удаляю $old"; rm -f -- "$old"
  done || true
done

cat <<MSG

Готово: $DEST
  • Копии лежат на ТОМ ЖЕ сервере. Скопируйте их на другой диск или в
    другое место (rsync/scp) — иначе при потере сервера они пропадут вместе с ним.
  • config-….tar.gz.age — .env и secrets/: после потери .env распаковать (age -d, tar xzf) в $APP_DIR.
  • Сохраните ENCRYPTION_KEY из $APP_DIR/.env отдельно от копий.
  • Восстановление базы:  gunzip -c db-….sql.gz | docker compose exec -T postgres psql -U sky sky
  • Восстановление файлов: docker compose exec -T api tar xzf - -C /data < files-….tar.gz
  • Зашифрованные копии (*.age): сначала  age -d -i backup.key файл.age > файл  (ключ — не с сервера).
  • Проверить, что копия реально восстанавливается:  bash scripts/backup-verify.sh db-….sql.gz[.age] [backup.key]
MSG
