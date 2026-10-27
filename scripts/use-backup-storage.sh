#!/usr/bin/env bash
# ============================================================
#  Перевести резервные копии на ХРАНИЛИЩЕ КОПИЙ (S3) — чтобы они не оставались на сервере.
#
#      bash scripts/use-backup-storage.sh            # проверить/настроить, залить имеющиеся, включить автокопии «только в хранилище»
#      bash scripts/use-backup-storage.sh --status   # что и где лежит
#      bash scripts/use-backup-storage.sh --purge-local   # после проверки убрать с сервера копии, которые уже есть в хранилище
#
#  Что делает (от root, на боевом сервере):
#   1. Если отдельный бакет копий не настроен (STORAGE_BACKUP_S3_* в .env) — запускает scripts/setup-storage.sh --backup-bucket.
#   2. STORAGE_BACKUP_TARGET=s3 — собственные копии Sky Storage (расписания в админке) пишутся в хранилище копий, а не на диск сервера.
#   3. Проверяет хранилище (запись/чтение/удаление пробы) и заливает уже сделанные копии из /var/backups/sky (scripts/hostbackup-s3.mjs).
#   4. Включает автокопии «в хранилище»: scripts/install-backup.sh --install --storage — после каждой копии загрузка, сверка размера, удаление локальных файлов.
#   5. Напоминает перезапустить api (читает новые переменные): docker compose up -d api.
#  Ключи age (секретный) и KEK по-прежнему хранятся ВНЕ сервера: без них копии из хранилища не открыть.
# ============================================================
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/sky}"; SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"; DEST="${DEST:-/var/backups/sky}"
mode="${1:-}"
[ "$(id -u)" = 0 ] || { echo "Нужен root."; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo "Нет $APP_DIR/.env — задайте APP_DIR."; exit 1; }
get_env() { grep -E "^$1=" "$APP_DIR/.env" | tail -n1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//" || true; }
hb() { ( cd "$APP_DIR" && docker compose run --rm --no-deps -T --user root -v "$DEST:/backups" -v "$SRC_DIR/scripts/hostbackup-s3.mjs:/app/scripts/hostbackup-s3.mjs:ro" -v "$SRC_DIR/server/skystorages3.mjs:/app/server/skystorages3.mjs:ro" api node scripts/hostbackup-s3.mjs "$@" ); }

if [ "$mode" = --status ]; then
  echo "STORAGE_BACKUP_TARGET=$(get_env STORAGE_BACKUP_TARGET)  бакет копий: $(get_env STORAGE_BACKUP_S3_BUCKET)"
  echo "== В хранилище копий"; hb list || true
  echo "== На сервере ($DEST)"; ls -lh "$DEST" 2>/dev/null | tail -n 12 || echo "(пусто)"
  systemctl list-timers sky-backup.timer --no-pager 2>/dev/null | head -3
  grep -E '^(BACKUP_TO_STORAGE|KEEP_LOCAL|KEEP_REMOTE)=' /etc/sky-backup.env 2>/dev/null || echo "автокопии «в хранилище» не включены"
  exit 0
fi

echo "== 1. Хранилище копий"
if [ -z "$(get_env STORAGE_BACKUP_S3_BUCKET)" ] || [ -z "$(get_env STORAGE_BACKUP_S3_SECRET_KEY)" ]; then
  echo "Отдельный бакет копий не настроен — запускаю мастер (понадобятся адрес S3, бакет, ключи доступа)."
  APP_DIR="$APP_DIR" bash "$SRC_DIR/scripts/setup-storage.sh" --backup-bucket
else echo "  ✔ STORAGE_BACKUP_S3_* заданы"; fi
if [ "$(get_env STORAGE_BACKUP_TARGET)" != s3 ]; then
  if grep -q '^STORAGE_BACKUP_TARGET=' "$APP_DIR/.env"; then sed -i 's|^STORAGE_BACKUP_TARGET=.*|STORAGE_BACKUP_TARGET=s3|' "$APP_DIR/.env"; else echo 'STORAGE_BACKUP_TARGET=s3' >> "$APP_DIR/.env"; fi
  echo "  ✔ STORAGE_BACKUP_TARGET=s3 (копии Sky Storage — в хранилище копий; применится после перезапуска api)"
fi

echo "== 2. Проверка хранилища"
hb check

echo "== 3. Загрузка уже сделанных копий"
mkdir -p "$DEST"
hb push /backups

if [ "$mode" = --purge-local ]; then
  echo "== Очистка сервера от копий, уже лежащих в хранилище"
  have="$(hb list | awk -F'\t' 'NF==2{print $1}')"
  for f in "$DEST"/*.age; do [ -e "$f" ] || continue; n="$(basename "$f")"
    if echo "$have" | grep -qx "$n"; then rm -f -- "$f"; echo "  удалён с сервера: $n"; else echo "  оставлен (в хранилище не найден): $n"; fi
  done
fi

echo "== 4. Автокопии «только в хранилище»"
T="03:30"; K=14
if [ -f /etc/sky-backup.env ]; then K="$(grep -E '^KEEP=' /etc/sky-backup.env | cut -d= -f2 || echo 14)"; fi
T_CUR="$(systemctl cat sky-backup.timer 2>/dev/null | sed -n 's/^OnCalendar=\*-\*-\* \([0-9:]*\):00/\1/p' | head -n1)"; [ -n "$T_CUR" ] && T="${T_CUR%:00}"
REM=""; [ -f /etc/sky-backup.env ] && REM="$(grep -E '^BACKUP_REMOTE=' /etc/sky-backup.env | cut -d= -f2- || true)"
args=(--install --storage --time "$T" --keep "${K:-14}"); [ -n "$REM" ] && args+=(--remote "$REM")
APP_DIR="$APP_DIR" bash "$SRC_DIR/scripts/install-backup.sh" "${args[@]}"

cat <<MSG

Готово. Осталось:
  • cd $APP_DIR && docker compose up -d api     # api подхватит STORAGE_BACKUP_TARGET=s3
  • Пробная копия сейчас:  bash $SRC_DIR/scripts/install-backup.sh --run   (после неё на сервере копий остаться не должно)
  • Проверить:             bash $0 --status    и  админка → Sky Storage → «Хранилище копий»
  • Когда убедитесь, что в хранилище есть свежие db/files/config:  bash $0 --purge-local   (убрать старые копии с сервера)
  • Секретный ключ age и ключи KEK храните ВНЕ сервера — без них копии из хранилища не открыть.
MSG
