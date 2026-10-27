#!/usr/bin/env bash
# ============================================================
#  Автокопии по расписанию (systemd-таймер на ХОСТЕ), с оповещением при сбое.
#
#      bash scripts/install-backup.sh --genkey            # ключ age: публичная часть в .env, секретная — показывается ОДИН раз
#      bash scripts/install-backup.sh --install [--time 03:30] [--keep 14] [--remote user@host:/путь] [--storage [--keep-local N] [--keep-remote N]]
#      bash scripts/install-backup.sh --run | --status | --uninstall
#
#  Делает scripts/backup.sh (база + файлы + зашифрованные .env и secrets/), удаляет собственные копии старше --keep штук,
#  при заданном --remote копирует новые файлы rsync-ом на другую машину (по ключу ssh). Сбой — письмо на WATCHDOG_EMAIL_TO
#  (/etc/sky-watchdog.env), тем же путём, что у watchdog. Секретный ключ age на сервере не хранится.
#  --storage: копии уходят в ХРАНИЛИЩЕ КОПИЙ (S3, STORAGE_BACKUP_S3_*, scripts/hostbackup-s3.mjs) и НЕ остаются на сервере: после загрузки с проверкой размера
#  локальные файлы удаляются (--keep-local N оставляет N последних наборов, по умолчанию 0); в хранилище хранится --keep-remote последних каждого вида (по умолчанию 30).
#  Загрузка не удалась — локальная копия остаётся, приходит оповещение.
# ============================================================
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/sky}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENVF=/etc/sky-backup.env
mode="${1:---install}"; shift || true
TIME="03:30"; KEEP=""; REMOTE=""; STORAGE=0; KEEP_LOCAL=0; KEEP_REMOTE=30
while [ $# -gt 0 ]; do case "$1" in
  --time) TIME="$2"; shift 2;; --keep) KEEP="$2"; shift 2;; --remote) REMOTE="$2"; shift 2;; --storage) STORAGE=1; shift;; --keep-local) KEEP_LOCAL="$2"; shift 2;; --keep-remote) KEEP_REMOTE="$2"; shift 2;; *) echo "Неизвестный параметр: $1"; exit 1;; esac; done
[ "$(id -u)" = 0 ] || { echo "Нужен root."; exit 1; }

case "$mode" in
--genkey)
  command -v age-keygen >/dev/null || { echo "Нет age: apt install -y age"; exit 1; }
  if grep -q '^BACKUP_AGE_RECIPIENT=age1' "$APP_DIR/.env" 2>/dev/null; then echo "Ключ копий уже задан в .env — не трогаю (чтобы не потерять доступ к прежним копиям)."; exit 0; fi
  tmp="$(mktemp)"; trap 'shred -u "$tmp" 2>/dev/null || rm -f "$tmp"' EXIT
  age-keygen -o "$tmp" 2>/dev/null
  pub="$(grep -o 'age1[0-9a-z]*' "$tmp" | head -n1)"
  printf 'BACKUP_AGE_RECIPIENT=%s\n' "$pub" >> "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"
  echo "Публичный ключ записан в $APP_DIR/.env. СЕКРЕТНЫЙ ключ ниже показан один раз и на сервере НЕ сохраняется."
  echo "Скопируйте его в менеджер паролей прямо сейчас — без него копии не расшифровать:"; echo
  grep AGE-SECRET-KEY "$tmp"; echo ;;
--install)
  [ -n "$KEEP" ] || KEEP=14
  install -m 700 /dev/null /usr/local/sbin/sky-backup
  cat > /usr/local/sbin/sky-backup <<'WRAP'
#!/usr/bin/env bash
set -uo pipefail
[ -f /etc/sky-backup.env ] && . /etc/sky-backup.env
[ -f /etc/sky-watchdog.env ] && . /etc/sky-watchdog.env
APP_DIR="${APP_DIR:-/opt/sky}"; export APP_DIR DEST KEEP
LOG=/var/log/sky-backup.log
fail() {
  echo "$(date '+%F %T') СБОЙ: $1" >> "$LOG"
  if [ -n "${WATCHDOG_EMAIL_TO:-}" ]; then
    ( cd "$APP_DIR" && timeout 90 docker compose run --rm --no-deps -T api node scripts/notify-mail.mjs "$WATCHDOG_EMAIL_TO" "Sky: копия не сделана ($(hostname))" "$1" ) >/dev/null 2>&1 || true
  fi
  exit 1
}
{ echo "== $(date '+%F %T')"; bash "$SRC_DIR/scripts/backup.sh"; } >> "$LOG" 2>&1 || fail "backup.sh завершился с ошибкой, см. $LOG"
if [ "${BACKUP_TO_STORAGE:-0}" = 1 ]; then
  DESTD="${DEST:-/var/backups/sky}"
  hb() { ( cd "$APP_DIR" && docker compose run --rm --no-deps -T --user root -v "$DESTD:/backups" -v "$SRC_DIR/scripts/hostbackup-s3.mjs:/app/scripts/hostbackup-s3.mjs:ro" -v "$SRC_DIR/server/skystorages3.mjs:/app/server/skystorages3.mjs:ro" api node scripts/hostbackup-s3.mjs "$@" ); }
  hb push /backups >> "$LOG" 2>&1 || fail "копии сделаны, но НЕ загружены в хранилище копий (остались на сервере: $DESTD), см. $LOG"
  hb prune "${KEEP_REMOTE:-30}" >> "$LOG" 2>&1 || true
  # Загрузка подтверждена (размер сверен внутри push) — с сервера копии убираем, оставляя KEEP_LOCAL последних наборов.
  for kind in db files config; do
    ls -1t "$DESTD"/$kind-*.gz.age 2>/dev/null | tail -n +$(( ${KEEP_LOCAL:-0} + 1 )) | while read -r old; do rm -f -- "$old"; done
  done
fi
if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a --partial -e "ssh -o BatchMode=yes -o ConnectTimeout=20" "${DEST:-/var/backups/sky}/" "$BACKUP_REMOTE/" >> "$LOG" 2>&1 || fail "копии сделаны, но не скопированы на $BACKUP_REMOTE"
fi
echo "$(date '+%F %T') ok" >> "$LOG"
WRAP
  sed -i "s|\$SRC_DIR|$SRC_DIR|g" /usr/local/sbin/sky-backup; chmod 700 /usr/local/sbin/sky-backup
  { echo "APP_DIR=$APP_DIR"; echo "DEST=/var/backups/sky"; echo "KEEP=$KEEP"; [ -n "$REMOTE" ] && echo "BACKUP_REMOTE=$REMOTE"
    [ "$STORAGE" = 1 ] && { echo "BACKUP_TO_STORAGE=1"; echo "KEEP_LOCAL=$KEEP_LOCAL"; echo "KEEP_REMOTE=$KEEP_REMOTE"; }; true; } > "$ENVF"; chmod 600 "$ENVF"
  cat > /etc/systemd/system/sky-backup.service <<UNIT
[Unit]
Description=Sky: резервная копия
[Service]
Type=oneshot
Nice=15
IOSchedulingClass=idle
ExecStart=/usr/local/sbin/sky-backup
UNIT
  cat > /etc/systemd/system/sky-backup.timer <<UNIT
[Unit]
Description=Sky: копии по расписанию
[Timer]
OnCalendar=*-*-* $TIME:00
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload; systemctl enable --now sky-backup.timer
  grep -q '^BACKUP_AGE_RECIPIENT=age1' "$APP_DIR/.env" 2>/dev/null || echo "ВНИМАНИЕ: ключ шифрования копий не задан — запустите: bash $0 --genkey (без него копии не делаются)."
  [ "$STORAGE" = 1 ] && echo "Копии уходят в ХРАНИЛИЩЕ КОПИЙ и не остаются на сервере (локально: $KEEP_LOCAL последних наборов; в хранилище: по $KEEP_REMOTE каждого вида)."
  echo "Готово: копия каждый день в $TIME, хранится $KEEP последних. Проверка: $0 --status;  вручную: $0 --run" ;;
--run) systemctl start sky-backup.service; tail -n 25 /var/log/sky-backup.log ;;
--status)
  systemctl list-timers sky-backup.timer --no-pager 2>/dev/null | head -3
  [ -f "$ENVF" ] && sed 's/^\(BACKUP_REMOTE=\).*@.*/\1(задан)/' "$ENVF"
  grep -q '^BACKUP_TO_STORAGE=1' "$ENVF" 2>/dev/null && echo "копии уходят в хранилище копий и не остаются на сервере" || echo "копии остаются на сервере (включить хранилище: bash scripts/use-backup-storage.sh)"
  ls -lh /var/backups/sky 2>/dev/null | tail -n 8; tail -n 5 /var/log/sky-backup.log 2>/dev/null ;;
--uninstall)
  systemctl disable --now sky-backup.timer 2>/dev/null || true
  rm -f /etc/systemd/system/sky-backup.{service,timer} /usr/local/sbin/sky-backup; systemctl daemon-reload
  echo "Таймер удалён. Сами копии в /var/backups/sky не тронуты." ;;
*) echo "Использование: $0 --genkey | --install [--time HH:MM] [--keep N] [--remote user@host:/путь] [--storage [--keep-local N] [--keep-remote N]] | --run | --status | --uninstall"; exit 1;;
esac
