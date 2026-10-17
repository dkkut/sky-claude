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
#  ШИФРОВАНИЕ КОПИЙ (рекомендуется): дамп базы содержит профили, заказы, адреса и
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

# Шифрование: через публичный ключ age (секретного ключа на сервере нет).
AGE_ARGS=()
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then AGE_ARGS=(-r "$BACKUP_AGE_RECIPIENT")
elif [ -n "${BACKUP_AGE_RECIPIENTS_FILE:-}" ]; then AGE_ARGS=(-R "$BACKUP_AGE_RECIPIENTS_FILE"); fi
EXT=gz
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

[ -f "$APP_DIR/docker-compose.yml" ] || { echo "В $APP_DIR нет docker-compose.yml — задайте APP_DIR."; exit 1; }
mkdir -p "$DEST"
chmod 700 "$DEST"
cd "$APP_DIR"

echo "==> База данных"
docker compose exec -T postgres pg_dump -U sky sky | gzip | emit "$DEST/db-$STAMP.sql.$EXT"
verify_file "$DEST/db-$STAMP.sql.$EXT"
echo "    $(du -h "$DEST/db-$STAMP.sql.$EXT" | cut -f1)  db-$STAMP.sql.$EXT (целостность проверена)"

echo "==> Загруженные файлы (том /data сервиса api)"
# Читаем из контейнера api: имена томов зависят от имени проекта compose,
# а внутри контейнера путь всегда один — /data.
docker compose exec -T api tar czf - -C /data . | emit "$DEST/files-$STAMP.tar.$EXT"
verify_file "$DEST/files-$STAMP.tar.$EXT"
echo "    $(du -h "$DEST/files-$STAMP.tar.$EXT" | cut -f1)  files-$STAMP.tar.$EXT"

echo "==> Старые копии (оставляю последних $KEEP)"
for kind in db files; do
  ls -1t "$DEST"/$kind-*.gz "$DEST"/$kind-*.gz.age 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    echo "    удаляю $old"; rm -f -- "$old"
  done
done

cat <<MSG

Готово: $DEST
  • Копии лежат на ТОМ ЖЕ сервере. Скопируйте их на другой диск или в
    другое место (rsync/scp) — иначе при потере сервера они пропадут вместе с ним.
  • Сохраните ENCRYPTION_KEY из $APP_DIR/.env отдельно от копий.
  • Восстановление базы:  gunzip -c db-….sql.gz | docker compose exec -T postgres psql -U sky sky
  • Восстановление файлов: docker compose exec -T api tar xzf - -C /data < files-….tar.gz
  • Зашифрованные копии (*.age): сначала  age -d -i backup.key файл.age > файл  (ключ — не с сервера).
  • Проверить, что копия реально восстанавливается:  bash scripts/backup-verify.sh db-….sql.gz[.age] [backup.key]
MSG
