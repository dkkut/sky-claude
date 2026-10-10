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

[ -f "$APP_DIR/docker-compose.yml" ] || { echo "В $APP_DIR нет docker-compose.yml — задайте APP_DIR."; exit 1; }
mkdir -p "$DEST"
chmod 700 "$DEST"
cd "$APP_DIR"

echo "==> База данных"
docker compose exec -T postgres pg_dump -U sky sky | gzip > "$DEST/db-$STAMP.sql.gz"
gzip -t "$DEST/db-$STAMP.sql.gz"
echo "    $(du -h "$DEST/db-$STAMP.sql.gz" | cut -f1)  db-$STAMP.sql.gz (целостность архива проверена)"

echo "==> Загруженные файлы (том /data сервиса api)"
# Читаем из контейнера api: имена томов зависят от имени проекта compose,
# а внутри контейнера путь всегда один — /data.
docker compose exec -T api tar czf - -C /data . > "$DEST/files-$STAMP.tar.gz"
gzip -t "$DEST/files-$STAMP.tar.gz"
echo "    $(du -h "$DEST/files-$STAMP.tar.gz" | cut -f1)  files-$STAMP.tar.gz"

echo "==> Старые копии (оставляю последних $KEEP)"
for kind in db files; do
  ls -1t "$DEST"/$kind-*.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
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
MSG
