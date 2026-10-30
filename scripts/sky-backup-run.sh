#!/usr/bin/env bash
# ============================================================
#  Запускатель автокопий Sky (его вызывает /usr/local/sbin/sky-backup из systemd-таймера). Логика лежит в репозитории, поэтому
#  обновляется обычным `git pull` — раньше она была зашита в установленный файл и годами оставалась старой.
#
#      sky-backup            — сделать копию сейчас (то же, что делает таймер)
#      sky-backup --check    — «догонялка» (запускает часовой таймер): нет свежей удачной копии → оповещение и запуск копии
#      sky-backup --status   — когда была последняя удачная/неудачная, сколько длилась, что пошло не так
#
#  Что исправлено относительно прежней схемы («то ложится, то не работает»):
#   • один запуск за раз (flock) и общий таймаут — зависший запуск больше не блокирует таймер навсегда;
#   • тяжёлая работа с пониженным приоритетом, место проверяется ДО копии;
#   • сбой — оповещение, а неудачный ночной запуск повторяется «догонялкой», а не ждёт следующей ночи;
#   • состояние пишется в /var/lib/sky-backup/status (видно в --status и в sky-heal.sh);
#   • успех = все шаги: копия → загрузка в хранилище → rsync → прореживание; сбой любого — не «ок».
# ============================================================
set -uo pipefail
[ -f /etc/sky-backup.env ] && . /etc/sky-backup.env
[ -f /etc/sky-watchdog.env ] && . /etc/sky-watchdog.env
APP_DIR="${APP_DIR:-/opt/sky}"
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DEST="${DEST:-/var/backups/sky}"; KEEP="${KEEP:-14}"
MAX_AGE_H="${BACKUP_MAX_AGE_H:-30}"       # старше — «догонялка» считает, что копия не делалась
RUN_TIMEOUT="${BACKUP_RUN_TIMEOUT:-6h}"
STATE=/var/lib/sky-backup; LOG=/var/log/sky-backup.log
export APP_DIR DEST KEEP BACKUP_WHAT BACKUP_DATA_DIRS BACKUP_DATA_EXCLUDE
mkdir -p "$STATE"; chmod 700 "$STATE"
now() { date +%s; }
get() { [ -f "$STATE/status" ] && grep -E "^$1=" "$STATE/status" | tail -n1 | cut -d= -f2- || true; }
put() { local k="$1" v="$2" tmp; tmp="$(mktemp "$STATE/.s.XXXXXX")"; { [ -f "$STATE/status" ] && grep -vE "^$k=" "$STATE/status"; echo "$k=$v"; } > "$tmp" 2>/dev/null; mv -f "$tmp" "$STATE/status"; }
since() { if [ -n "$1" ]; then echo "$(date -d "@$1" '+%F %T') ($(human "$1"))"; else echo "нет"; fi; }
human() { local s=$(( $(now) - $1 )); if [ "$s" -ge 86400 ]; then echo "$((s/86400)) дн. назад"; elif [ "$s" -ge 3600 ]; then echo "$((s/3600)) ч назад"; else echo "$((s/60)) мин назад"; fi; }

alert() {   # $1 — тема, $2 — текст. Не чаще раза в 12 часов на одну тему, чтобы не заваливать почту.
  local topic="$1" last; last="$(get "alert_$topic")"
  [ -n "$last" ] && [ $(( $(now) - last )) -lt 43200 ] && return 0
  put "alert_$topic" "$(now)"
  [ -n "${WATCHDOG_EMAIL_TO:-}" ] || return 0
  ( cd "$APP_DIR" && timeout 90 docker compose run --rm --no-deps -T api node scripts/notify-mail.mjs "$WATCHDOG_EMAIL_TO" "Sky: $2 ($(hostname))" "$3" ) >/dev/null 2>&1 || true
}

mode="${1:-run}"

if [ "$mode" = --status ]; then
  ok="$(get last_ok)"; fl="$(get last_fail)"
  echo "Последняя удачная копия: $(since "$ok")"
  echo "Длительность: $(get last_duration_s) с"
  [ -n "$fl" ] && echo "Последний сбой: $(date -d "@$fl" '+%F %T') ($(human "$fl")): $(get last_error)"
  systemctl list-timers 'sky-backup*' --no-pager 2>/dev/null | head -4
  tail -n 8 "$LOG" 2>/dev/null; exit 0
fi

if [ "$mode" = --check ]; then
  ok="$(get last_ok)"
  if [ -n "$ok" ] && [ $(( $(now) - ok )) -lt $(( MAX_AGE_H * 3600 )) ]; then exit 0; fi
  # уже идёт — не мешаем
  if command -v flock >/dev/null 2>&1 && ! ( flock -n 9 ) 9>"$STATE/run.lock"; then exit 0; fi
  echo "$(date '+%F %T') «догонялка»: свежей копии нет (последняя: $(since "$ok")) — запускаю" >> "$LOG"
  alert stale "копия давно не делалась" "Последняя удачная копия: $(since "$ok"). Запускаю копию сейчас. Подробности: sky-backup --status (журнал $LOG)."
  mode=run
fi

# ── сама копия ──
exec 7>"$STATE/run.lock"
command -v flock >/dev/null 2>&1 && ! flock -n 7 && { echo "$(date '+%F %T') другая копия уже идёт — пропускаю" >> "$LOG"; exit 0; }
# журнал не растёт бесконечно
[ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 5242880 ] && { tail -n 2000 "$LOG" > "$LOG.tmp" && mv -f "$LOG.tmp" "$LOG"; }

start="$(now)"
fail() {
  put last_fail "$(now)"; put last_error "$1"; put last_duration_s "$(( $(now) - start ))"
  echo "$(date '+%F %T') СБОЙ: $1" >> "$LOG"
  alert fail "копия не сделана" "$1
Подробности: $LOG. Следующая попытка — «догонялка» в течение часа."
  exit 1
}
echo "== $(date '+%F %T')" >> "$LOG"
timeout "$RUN_TIMEOUT" bash "$SRC_DIR/scripts/backup.sh" >> "$LOG" 2>&1 || fail "backup.sh завершился с ошибкой или не уложился в $RUN_TIMEOUT (последние строки журнала: $(tail -n 3 "$LOG" | tr '\n' ' ' | cut -c1-300))"

if [ "${BACKUP_TO_STORAGE:-0}" = 1 ]; then
  hb() { ( cd "$APP_DIR" && timeout 3h docker compose run --rm --no-deps -T --user root -v "$DEST:/backups" -v "$SRC_DIR/scripts/hostbackup-s3.mjs:/app/scripts/hostbackup-s3.mjs:ro" -v "$SRC_DIR/server/skystorages3.mjs:/app/server/skystorages3.mjs:ro" api node scripts/hostbackup-s3.mjs "$@" ); }
  hb push /backups >> "$LOG" 2>&1 || fail "копии сделаны, но НЕ загружены в хранилище копий (остались на сервере: $DEST)"
  hb prune "${KEEP_REMOTE:-30}" >> "$LOG" 2>&1 || true
  # Загрузка подтверждена (размер сверен внутри push) — с сервера убираем, оставляя KEEP_LOCAL последних наборов.
  for kind in db files config host-config certs; do
    { ls -1t "$DEST"/$kind-*.gz.age 2>/dev/null || true; } | tail -n +$(( ${KEEP_LOCAL:-0} + 1 )) | while read -r old; do rm -f -- "$old"; done
  done
fi
if [ -n "${BACKUP_REMOTE:-}" ]; then
  timeout 6h rsync -a --partial -e "ssh -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30" "$DEST/" "$BACKUP_REMOTE/" >> "$LOG" 2>&1 || fail "копии сделаны, но не скопированы на $BACKUP_REMOTE"
fi
put last_ok "$(now)"; put last_duration_s "$(( $(now) - start ))"; put last_error ""
echo "$(date '+%F %T') ok ($(( $(now) - start )) с)" >> "$LOG"
