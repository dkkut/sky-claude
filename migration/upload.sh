#!/usr/bin/env bash
# ============================================================
#  ЗАГРУЗКА zip на ДРУГОЙ сервер (с докачкой и проверкой, что файл дошёл без искажений).
#  Запускать там, где лежит zip (старый сервер или ваш компьютер): нужны ssh и rsync (если rsync нет — scp без докачки).
#
#      bash upload.sh --to root@НОВЫЙ_IP [--zip sky-migration-….zip] [--dest /root/sky-migration] [--port 22] [--identity ~/.ssh/ключ]
#                     [--age-key backup.key] [--run [--yes]]
#
#   --zip       файл для загрузки (по умолчанию — самый свежий в /root/sky-migration)
#   --dest      каталог на новом сервере (по умолчанию /root/sky-migration)
#   --age-key   ЗАГРУЗИТЬ и секретный ключ age (права 600) — нужен для восстановления. Без этого флага ключ на сервер не попадает:
#               тогда положите его вручную. Ключ на новом сервере удалите сразу после переноса.
#   --run       после загрузки сразу запустить на новом сервере restore.sh (нужен --age-key или ключ, уже лежащий в $DEST/backup.key); --yes — без вопросов
#
#  Обрыв связи не страшен: повторный запуск докачивает с того места, где оборвалось (до 6 попыток подряд с паузами).
#  После загрузки sha256 файла на новом сервере сверяется с .sha256 — не совпало, загрузка считается неудачной.
# ============================================================
set -euo pipefail
TO=""; ZIP=""; DEST="/root/sky-migration"; PORT=22; ID=""; AGEKEY=""; RUN=0; YES=0
while [ $# -gt 0 ]; do case "$1" in
  --to) TO="$2"; shift 2;; --zip) ZIP="$2"; shift 2;; --dest) DEST="$2"; shift 2;; --port) PORT="$2"; shift 2;; --identity) ID="$2"; shift 2;;
  --age-key) AGEKEY="$2"; shift 2;; --run) RUN=1; shift;; --yes) YES=1; shift;; -h|--help) sed -n 2,19p "$0"; exit 0;;
  *) echo "Неизвестный параметр: $1"; exit 1;; esac; done
ok()  { printf '  \033[32m✔\033[0m %s\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ -n "$TO" ] || die "Укажите сервер: --to root@IP"
case "$DEST" in /*) ;; *) die "--dest: нужен абсолютный путь";; esac
case "$DEST" in *[!A-Za-z0-9_./-]*) die "--dest: только буквы, цифры и _ . / -";; esac
[ -n "$ZIP" ] || ZIP="$(ls -1t /root/sky-migration/sky-migration-*.zip 2>/dev/null | head -n1 || true)"
[ -f "$ZIP" ] || die "Не найден zip: укажите --zip"
[ -z "$AGEKEY" ] || { [ -r "$AGEKEY" ] && grep -q AGE-SECRET-KEY "$AGEKEY" || die "--age-key: это не секретный ключ age"; }
SSH=(ssh -p "$PORT" -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -o ConnectTimeout=20 ${ID:+-i "$ID"})
SCP_E="ssh -p $PORT -o ServerAliveInterval=30 -o ConnectTimeout=20 ${ID:+-i $ID}"
NAME="$(basename "$ZIP")"

echo "==> 1. Связь с $TO"
"${SSH[@]}" "$TO" 'echo ok' >/dev/null || die "Не удалось подключиться по ssh к $TO (порт $PORT). Проверьте адрес, ключ и что SSH-вход на новом сервере разрешён."
ok "ssh работает"
size_mb=$(( $(stat -c %s "$ZIP") / 1048576 + 1 ))
"${SSH[@]}" "$TO" "mkdir -p '$DEST' && chmod 700 '$DEST'" || die "Не удалось создать $DEST на новом сервере."
free_mb="$("${SSH[@]}" "$TO" "df -Pm '$DEST' | awk 'NR==2{print \$4}'" | tr -dc 0-9)"
# для восстановления на новом сервере нужен ещё запас под распаковку (restore.sh проверит сам); здесь — только чтобы файл поместился
[ "${free_mb:-0}" -gt "$size_mb" ] && ok "место на новом сервере: свободно ${free_mb} МБ, файл ${size_mb} МБ" || die "На новом сервере мало места: свободно ${free_mb:-?} МБ, нужно ${size_mb} МБ."
[ "${free_mb:-0}" -gt $(( size_mb * 3 )) ] || echo "    ! для распаковки и восстановления на новом сервере понадобится ещё ≈ ${size_mb}×2 МБ — проверьте диск заранее"

echo "==> 2. Загрузка $NAME (${size_mb} МБ)"
FILES=("$ZIP"); [ -f "$ZIP.sha256" ] && FILES+=("$ZIP.sha256")
try=0; until [ "$try" -ge 6 ]; do
  try=$((try+1))
  if command -v rsync >/dev/null 2>&1 && "${SSH[@]}" "$TO" 'command -v rsync >/dev/null' 2>/dev/null; then
    rsync -a --partial --inplace --progress -e "$SCP_E" "${FILES[@]}" "$TO:$DEST/" && break
  else
    echo "    rsync нет с одной из сторон — scp (без докачки)"; scp -P "$PORT" ${ID:+-i "$ID"} -o ConnectTimeout=20 "${FILES[@]}" "$TO:$DEST/" && break
  fi
  echo "    попытка $try не удалась — жду $((try*10)) с и продолжаю с того же места"; sleep $((try*10))
done
[ "$try" -lt 6 ] || [ -n "$("${SSH[@]}" "$TO" "ls '$DEST/$NAME' 2>/dev/null")" ] || die "Загрузка не удалась за 6 попыток."

echo "==> 3. Проверка, что файл дошёл без искажений"
local_sum="$(sha256sum "$ZIP" | cut -d' ' -f1)"
remote_sum="$("${SSH[@]}" "$TO" "sha256sum '$DEST/$NAME'" | cut -d' ' -f1)"
[ "$local_sum" = "$remote_sum" ] || die "sha256 НЕ совпал (у вас $local_sum, на сервере ${remote_sum:-?}). Запустите upload.sh ещё раз — докачает недостающее."
ok "sha256 совпал: $local_sum"
# restore.sh кладём рядом с zip, чтобы запускать его, не распаковывая ничего вручную
unzip -p "$ZIP" restore.sh | "${SSH[@]}" "$TO" "cat > '$DEST/restore.sh' && chmod 700 '$DEST/restore.sh'" && ok "restore.sh лежит в $DEST"

if [ -n "$AGEKEY" ]; then
  "${SSH[@]}" "$TO" "umask 077; cat > '$DEST/backup.key'" < "$AGEKEY" && ok "секретный ключ age загружен в $DEST/backup.key (права 600). После переноса удалите: rm $DEST/backup.key"
fi

if [ "$RUN" = 1 ]; then
  "${SSH[@]}" "$TO" "test -r '$DEST/backup.key'" || die "--run: на новом сервере нет $DEST/backup.key (укажите --age-key)."
  echo "==> 4. Восстановление на новом сервере"
  "${SSH[@]}" -t "$TO" "bash '$DEST/restore.sh' --zip '$DEST/$NAME' --key '$DEST/backup.key'$( [ "$YES" = 1 ] && echo ' --yes')"
else
  cat <<MSG

Загружено. Дальше на НОВОМ сервере:
  bash $DEST/restore.sh --zip $DEST/$NAME --key /путь/backup.key [--yes]
MSG
fi
