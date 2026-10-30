#!/usr/bin/env bash
# ============================================================
#  Автокопии по расписанию (systemd-таймер на ХОСТЕ), с оповещением при сбое.
#
#      bash scripts/install-backup.sh --genkey            # ключ age: публичная часть в .env, секретная — показывается ОДИН раз
#      bash scripts/install-backup.sh --install [--time 03:30] [--keep 14] [--remote user@host:/путь] [--storage [--keep-local N] [--keep-remote N]]
#                                     [--what db,files,config,host,certs] [--dest /каталог] [--data-dirs music,film] [--exclude-dirs transfer]
#      bash scripts/install-backup.sh --configure [те же параметры | без параметров — вопросы по шагам]   # поменять «что копировать» и «куда направить», не переустанавливая
#      bash scripts/install-backup.sh --show                 # что и куда копируется сейчас
#      bash scripts/install-backup.sh --run | --status | --doctor | --sync | --uninstall
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
ENVF="${SKY_BACKUP_ENV:-/etc/sky-backup.env}"
mode="${1:---install}"; shift || true
TIME=""; KEEP=""; REMOTE=""; STORAGE=""; KEEP_LOCAL=""; KEEP_REMOTE=""; WHAT=""; DEST_NEW=""; DATA_DIRS="__unset__"; EXC_DIRS="__unset__"; NO_REMOTE=0
while [ $# -gt 0 ]; do case "$1" in
  --time) TIME="$2"; shift 2;; --keep) KEEP="$2"; shift 2;; --remote) REMOTE="$2"; shift 2;; --storage) STORAGE=1; shift;; --no-storage) STORAGE=0; shift;; --no-remote) NO_REMOTE=1; shift;; --keep-local) KEEP_LOCAL="$2"; shift 2;; --keep-remote) KEEP_REMOTE="$2"; shift 2;;
  --what) WHAT="$2"; shift 2;; --dest) DEST_NEW="$2"; shift 2;; --data-dirs) DATA_DIRS="$2"; shift 2;; --exclude-dirs) EXC_DIRS="$2"; shift 2;; *) echo "Неизвестный параметр: $1"; exit 1;; esac; done
[ "$(id -u)" = 0 ] || { echo "Нужен root."; exit 1; }

# ── настройки в /etc/sky-backup.env: читаем/меняем по одному ключу ──
envget() { [ -f "$ENVF" ] && grep -E "^$1=" "$ENVF" | tail -n1 | cut -d= -f2- || true; }
envset() {   # envset KEY VALUE — пустое значение удаляет ключ
  local k="$1" v="$2" tmp; tmp="$(mktemp)"; [ -f "$ENVF" ] && grep -vE "^$k=" "$ENVF" > "$tmp" || true
  [ -n "$v" ] && echo "$k=$v" >> "$tmp"; install -m 600 "$tmp" "$ENVF"; rm -f "$tmp"; }
valid_what() { local w; for w in $(echo "$1" | tr ',' ' '); do case "$w" in db|files|config|host|certs) ;; *) echo "Неизвестный состав «$w»: допустимо db, files, config, host, certs."; return 1;; esac; done; [ -n "$1" ]; }
valid_dirs() { local n; for n in $(echo "$1" | tr ',' ' '); do case "$n" in *[!A-Za-z0-9_-]*) echo "Недопустимое имя папки «$n»."; return 1;; esac; done; }
# Применить параметры командной строки к файлу настроек (то, что не указано, остаётся как было).
apply_opts() {
  if [ -n "$WHAT" ]; then valid_what "$WHAT" || exit 1; envset BACKUP_WHAT "$WHAT"; fi
  if [ -n "$DEST_NEW" ]; then case "$DEST_NEW" in /*) ;; *) echo "--dest: нужен абсолютный путь."; exit 1;; esac; mkdir -p "$DEST_NEW" && chmod 700 "$DEST_NEW"; envset DEST "$DEST_NEW"; fi
  if [ "$DATA_DIRS" != __unset__ ]; then valid_dirs "$DATA_DIRS" || exit 1; envset BACKUP_DATA_DIRS "$DATA_DIRS"; fi
  if [ "$EXC_DIRS" != __unset__ ]; then valid_dirs "$EXC_DIRS" || exit 1; envset BACKUP_DATA_EXCLUDE "$EXC_DIRS"; fi
  [ -n "$KEEP" ] && envset KEEP "$KEEP"
  if [ "$NO_REMOTE" = 1 ]; then envset BACKUP_REMOTE ""; elif [ -n "$REMOTE" ]; then envset BACKUP_REMOTE "$REMOTE"; fi
  if [ "$STORAGE" = 1 ]; then envset BACKUP_TO_STORAGE 1; [ -n "$KEEP_LOCAL" ] || [ -n "$(envget KEEP_LOCAL)" ] || KEEP_LOCAL=0; [ -n "$KEEP_REMOTE" ] || [ -n "$(envget KEEP_REMOTE)" ] || KEEP_REMOTE=30
  elif [ "$STORAGE" = 0 ]; then envset BACKUP_TO_STORAGE ""; fi
  [ -n "$KEEP_LOCAL" ] && envset KEEP_LOCAL "$KEEP_LOCAL"; [ -n "$KEEP_REMOTE" ] && envset KEEP_REMOTE "$KEEP_REMOTE"
  return 0; }
show_cfg() {
  local w d x dest keep kl kr
  w="$(envget BACKUP_WHAT)"; d="$(envget BACKUP_DATA_DIRS)"; x="$(envget BACKUP_DATA_EXCLUDE)"; dest="$(envget DEST)"; keep="$(envget KEEP)"; kl="$(envget KEEP_LOCAL)"; kr="$(envget KEEP_REMOTE)"
  echo "== Что и куда копируется"
  echo "  Что:         ${w:-db,files,config (по умолчанию)}   [db — база; files — файлы /data; config — .env и secrets/; host — настройки хоста; certs — сертификаты]"
  echo "  Папки /data: ${d:-все}   исключить: ${x:-ничего}"
  echo "  Куда:"
  echo "    • на этом сервере:  ${dest:-/var/backups/sky}  (хранить последних наборов: ${keep:-14})"
  if [ -n "$(envget BACKUP_REMOTE)" ]; then echo "    • на другой сервер (rsync): задан"; else echo "    • на другой сервер (rsync): нет"; fi
  if [ "$(envget BACKUP_TO_STORAGE)" = 1 ]; then echo "    • в хранилище копий (S3):   да; на сервере оставлять наборов: ${kl:-0}, в хранилище: ${kr:-30}"; else echo "    • в хранилище копий (S3):   нет"; fi
  echo "  Время: $(grep -h '^OnCalendar=' /etc/systemd/system/sky-backup.timer 2>/dev/null | sed -E 's/.* ([0-9:]{5}):00$/\1/' | head -n1)"; }

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
--install|--sync)
  # --sync: только обновить заглушку и юниты (settings в /etc/sky-backup.env не трогаем) — его вызывает deploy-local.sh.
  # Заглушка ищет скрипты в репозитории во время ЗАПУСКА (путь не «зашит» навсегда): переезд/перекладка репозитория больше не ломает копии.
  cat > /usr/local/sbin/sky-backup <<WRAP
#!/usr/bin/env bash
for d in "$SRC_DIR" /opt/sky-src "$APP_DIR"; do
  [ -f "\$d/scripts/sky-backup-run.sh" ] && exec bash "\$d/scripts/sky-backup-run.sh" "\$@"
done
echo "sky-backup: не найден scripts/sky-backup-run.sh (искал в $SRC_DIR, /opt/sky-src, $APP_DIR)" >&2; exit 1
WRAP
  chmod 700 /usr/local/sbin/sky-backup
  if [ "$mode" = --install ]; then
    envset APP_DIR "$APP_DIR"; envset SRC_DIR "$SRC_DIR"; [ -n "$(envget DEST)" ] || envset DEST /var/backups/sky; [ -n "$(envget KEEP)" ] || [ -n "$KEEP" ] || envset KEEP 14
    apply_opts
    [ -z "$TIME" ] && TIME="$(grep -h '^OnCalendar=' /etc/systemd/system/sky-backup.timer 2>/dev/null | sed -E 's/.* ([0-9:]{5}):00$/\1/' | head -n1)"; TIME="${TIME:-03:30}"
  else
    [ -f "$ENVF" ] || { echo "Автокопии не установлены (нет $ENVF) — нечего обновлять."; exit 0; }
    grep -q '^SRC_DIR=' "$ENVF" || envset SRC_DIR "$SRC_DIR"
    TIME="$(grep -h '^OnCalendar=' /etc/systemd/system/sky-backup.timer 2>/dev/null | sed -E 's/.* ([0-9:]{5}):00$/\1/' | head -n1)"; TIME="${TIME:-03:30}"
  fi
  # Служба: низкий приоритет процессора и диска, жёсткий потолок времени (зависший запуск не блокирует таймер вечно), старт после Docker.
  cat > /etc/systemd/system/sky-backup.service <<UNIT
[Unit]
Description=Sky: резервная копия
After=docker.service network-online.target
Wants=docker.service
[Service]
Type=oneshot
Nice=15
IOSchedulingClass=idle
CPUWeight=20
IOWeight=20
TimeoutStartSec=8h
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
  # «Догонялка» раз в час: если свежей удачной копии нет (сервер был выключен, запуск упал, зависание) — оповещает и делает копию, а не ждёт следующей ночи.
  cat > /etc/systemd/system/sky-backup-watch.service <<UNIT
[Unit]
Description=Sky: проверка свежести копий
After=docker.service
[Service]
Type=oneshot
Nice=15
IOSchedulingClass=idle
TimeoutStartSec=8h
ExecStart=/usr/local/sbin/sky-backup --check
UNIT
  cat > /etc/systemd/system/sky-backup-watch.timer <<UNIT
[Unit]
Description=Sky: догонялка копий
[Timer]
OnBootSec=15min
OnUnitActiveSec=1h
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload; systemctl enable --now sky-backup.timer sky-backup-watch.timer
  if [ "$mode" = --install ]; then
    grep -q '^BACKUP_AGE_RECIPIENT=age1' "$APP_DIR/.env" 2>/dev/null || echo "ВНИМАНИЕ: ключ шифрования копий не задан — запустите: bash $0 --genkey (без него копии не делаются)."
    [ "$(envget BACKUP_TO_STORAGE)" = 1 ] && echo "Копии уходят в ХРАНИЛИЩЕ КОПИЙ и не остаются на сервере (локально: $(envget KEEP_LOCAL | sed "s/^$/0/") последних наборов; в хранилище: по $(envget KEEP_REMOTE | sed "s/^$/30/") каждого вида)."
    show_cfg
    echo "Готово: копия каждый день в $TIME, хранится $(envget KEEP) последних; раз в час «догонялка» проверяет свежесть. Проверка: $0 --status;  вручную: $0 --run"
  else echo "Автокопии обновлены (заглушка и юниты systemd)."; fi ;;
--show) show_cfg ;;
--configure)
  [ -f "$ENVF" ] || { echo "Автокопии не установлены: сначала bash $0 --install"; exit 1; }
  if [ -z "$WHAT$DEST_NEW$REMOTE$KEEP$KEEP_LOCAL$KEEP_REMOTE" ] && [ "$DATA_DIRS" = __unset__ ] && [ "$EXC_DIRS" = __unset__ ] && [ "$STORAGE" = "" ] && [ "$NO_REMOTE" = 0 ]; then
    # без параметров — по шагам; Enter оставляет текущее значение
    show_cfg; echo
    ask() { local cur="$2" a; read -r -p "$1 [${cur:-—}]: " a; echo "${a:-$cur}"; }
    WHAT="$(ask 'Что копировать (db,files,config,host,certs)' "$(envget BACKUP_WHAT || true)")"; [ -n "$WHAT" ] || WHAT="db,files,config"
    DATA_DIRS="$(ask 'Только эти папки /data (через запятую; пусто — все)' "$(envget BACKUP_DATA_DIRS || true)")"
    EXC_DIRS="$(ask 'Исключить папки /data (через запятую)' "$(envget BACKUP_DATA_EXCLUDE || true)")"
    DEST_NEW="$(ask 'Каталог копий на этом сервере' "$(envget DEST || true)")"
    r="$(ask 'Копировать на другой сервер, user@host:/путь (- убрать)' "$(envget BACKUP_REMOTE || true)")"; if [ "$r" = "-" ]; then NO_REMOTE=1; else REMOTE="$r"; fi
    st="$(ask 'Отправлять в хранилище копий S3? (да/нет)' "$([ "$(envget BACKUP_TO_STORAGE)" = 1 ] && echo да || echo нет)")"; case "$st" in да|yes|y|д|1) STORAGE=1;; *) STORAGE=0;; esac
    KEEP="$(ask 'Сколько последних наборов хранить на сервере' "$(envget KEEP || true)")"
  fi
  apply_opts
  bash "$0" --sync >/dev/null 2>&1 || true
  echo "Сохранено. Новые настройки действуют со следующей копии (проверить сейчас: $0 --run)."; show_cfg ;;
--doctor)
  echo "== Диагностика автокопий"
  okc() { printf '  \033[32m✔\033[0m %s\n' "$*"; }; badc() { printf '  \033[31m✖\033[0m %s\n' "$*"; BADC=1; }; BADC=0
  [ -f "$ENVF" ] && okc "настройки: $ENVF" || badc "автокопии не установлены: bash $0 --install"
  [ -x /usr/local/sbin/sky-backup ] && okc "запускатель /usr/local/sbin/sky-backup" || badc "нет /usr/local/sbin/sky-backup (bash $0 --sync)"
  systemctl is-active --quiet sky-backup.timer && okc "таймер копий активен" || badc "таймер копий НЕ активен: systemctl enable --now sky-backup.timer"
  systemctl is-active --quiet sky-backup-watch.timer && okc "догонялка активна" || badc "догонялка НЕ активна: bash $0 --sync"
  command -v age >/dev/null && okc "age установлен" || badc "нет age: apt install -y age"
  grep -q '^BACKUP_AGE_RECIPIENT=age1' "$APP_DIR/.env" 2>/dev/null && okc "публичный ключ в .env" || badc "нет BACKUP_AGE_RECIPIENT (bash $0 --genkey)"
  docker compose version >/dev/null 2>&1 && okc "docker compose" || badc "нет docker compose"
  free_mb=$(df -Pm /var/backups 2>/dev/null | awk 'NR==2{print $4}'); [ "${free_mb:-0}" -ge 2048 ] && okc "свободно ${free_mb} МБ в /var/backups" || badc "мало места: ${free_mb:-?} МБ в /var/backups"
  ls /var/backups/sky/*.partial >/dev/null 2>&1 && badc "остались недописанные *.partial (прошлый запуск оборвался) — удалятся сами через час"
  /usr/local/sbin/sky-backup --status 2>/dev/null | head -n 4
  [ "$BADC" = 0 ] && echo "Всё в порядке." || { echo "Есть проблемы — исправьте и повторите."; exit 1; } ;;
--run) systemctl start sky-backup.service; tail -n 25 /var/log/sky-backup.log ;;
--status)
  /usr/local/sbin/sky-backup --status 2>/dev/null || true
  [ -f "$ENVF" ] && sed 's/^\(BACKUP_REMOTE=\).*@.*/\1(задан)/' "$ENVF"
  grep -q '^BACKUP_TO_STORAGE=1' "$ENVF" 2>/dev/null && echo "копии уходят в хранилище копий и не остаются на сервере" || echo "копии остаются на сервере (включить хранилище: bash scripts/use-backup-storage.sh)"
  ls -lh /var/backups/sky 2>/dev/null | tail -n 8 ;;
--uninstall)
  systemctl disable --now sky-backup.timer sky-backup-watch.timer 2>/dev/null || true
  rm -f /etc/systemd/system/sky-backup.{service,timer} /etc/systemd/system/sky-backup-watch.{service,timer} /usr/local/sbin/sky-backup; systemctl daemon-reload
  echo "Таймер удалён. Сами копии в /var/backups/sky не тронуты." ;;
*) echo "Использование: $0 --genkey | --install [--time HH:MM] [--keep N] [--remote user@host:/путь] [--storage [--keep-local N] [--keep-remote N]] | --configure | --show | --sync | --doctor | --run | --status | --uninstall"; exit 1;;
esac
