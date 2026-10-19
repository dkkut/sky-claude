#!/usr/bin/env bash
# Самолечение сервера Sky: раз в минуту (systemd-таймер, см. install-watchdog.sh) проверяет и чинит типовые поломки,
# чтобы не бегать к хостеру. Работает на хосте, НЕ внутри Docker — поэтому живёт, даже когда упали контейнеры.
#   sky-watchdog.sh            одна проверка с починкой
#   sky-watchdog.sh --dry      только показать, что было бы сделано
#   sky-watchdog.sh --status   последний статус и журнал
# Что чинит: упавший docker; контейнеры не в строю (compose up -d); сайт не отвечает (перезапуск web/api);
# закончилось место (кэш сборки, старые образы, журналы); не хватает памяти при сборке приложений (гасит сборку);
# sshd не запущен. Чего НЕ делает: не трогает SSH-шлюз владельца и правила доступа (иначе падением API можно было бы
# обойти подтверждение), не правит конфиги и не откатывает данные, не удаляет тома и базу.
# Предохранители: не чаще MAX_FIX починок за окно WINDOW_MIN минут, потом пауза и только оповещение.
# Настройки (необязательно): /etc/sky-watchdog.env — APP_DIR, DISK_WARN, DISK_CRIT, MAX_FIX, WINDOW_MIN,
# WATCHDOG_EMAIL_TO (оповещение письмом тем же отправщиком, что и коды входа), WATCHDOG_TG_TOKEN и WATCHDOG_TG_CHAT
# (Telegram), WATCHDOG_URL (куда слать POST с текстом). Проверка канала: sky-watchdog --test-notify.
set -uo pipefail
[ -f /etc/sky-watchdog.env ] && . /etc/sky-watchdog.env
APP_DIR="${APP_DIR:-/opt/sky}"; STATE="${STATE:-/var/lib/sky-watchdog}"; LOG="${LOG:-/var/log/sky-watchdog.log}"
DISK_WARN="${DISK_WARN:-88}"; DISK_CRIT="${DISK_CRIT:-95}"; MAX_FIX="${MAX_FIX:-4}"; WINDOW_MIN="${WINDOW_MIN:-30}"
MEM_LOW_KB="${MEM_LOW_KB:-300000}"
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
mkdir -p "$STATE" 2>/dev/null || { STATE=/tmp/sky-watchdog; mkdir -p "$STATE"; }
touch "$LOG" 2>/dev/null || LOG=/tmp/sky-watchdog.log

if [ "${1:-}" = "--test-notify" ]; then TEST=1; fi
if [ "${1:-}" = "--status" ]; then cat "$STATE/status" 2>/dev/null; echo "--- последние записи ---"; tail -n 25 "$LOG" 2>/dev/null; exit 0; fi
exec 9>"$STATE/lock"; flock -n 9 || exit 0   # одна копия за раз

now=$(date +%s); issues=(); fixes=()
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; [ -t 1 ] && echo "$*"; }
run() { if [ "$DRY" = 1 ]; then log "[dry] $*"; else eval "$@" >> "$LOG" 2>&1; fi; }
have() { command -v "$1" >/dev/null 2>&1; }
notify() {  # повтор одного и того же текста не чаще раза в час
  local msg="$1" key; key="$(printf '%s' "$msg" | cksum | cut -d' ' -f1)"
  local f="$STATE/notified.$key"; [ -f "$f" ] && [ $((now - $(cat "$f"))) -lt 3600 ] && return
  echo "$now" > "$f"; [ "$DRY" = 1 ] && return
  msg="Sky watchdog @ $(hostname): $msg"
  if [ -n "${WATCHDOG_TG_TOKEN:-}" ] && [ -n "${WATCHDOG_TG_CHAT:-}" ]; then
    curl -fsS -m 10 "https://api.telegram.org/bot${WATCHDOG_TG_TOKEN}/sendMessage" --data-urlencode "chat_id=${WATCHDOG_TG_CHAT}" --data-urlencode "text=${msg}" >/dev/null 2>&1 || true
  fi
  if [ -n "${WATCHDOG_EMAIL_TO:-}" ] && have docker && [ -f "$APP_DIR/docker-compose.yml" ]; then
    # Тем же отправщиком, что и коды входа; одноразовый контейнер, поэтому работает и при упавшем api.
    ( cd "$APP_DIR" && timeout 90 docker compose run --rm --no-deps -T api node scripts/notify-mail.mjs "$WATCHDOG_EMAIL_TO" "Sky: сервер $(hostname)" "$msg" ) >> "$LOG" 2>&1 || log "письмо не отправлено (см. выше)"
  fi
  [ -n "${WATCHDOG_URL:-}" ] && curl -fsS -m 10 -X POST --data-urlencode "text=${msg}" "$WATCHDOG_URL" >/dev/null 2>&1 || true
}
# Лимит починок: журнал меток времени, окно WINDOW_MIN.
fix_budget() {
  local f="$STATE/fixes" keep=() t; : > "$f.tmp"
  [ -f "$f" ] && while read -r t; do [ $((now - t)) -lt $((WINDOW_MIN * 60)) ] && echo "$t" >> "$f.tmp"; done < "$f"
  mv "$f.tmp" "$f"; [ "$(wc -l < "$f")" -lt "$MAX_FIX" ]
}
mark_fix() { echo "$now" >> "$STATE/fixes"; }
fixed() { fixes+=("$1"); log "ЧИНЮ: $1"; }
bad() { issues+=("$1"); log "ПРОБЛЕМА: $1"; }

if [ "${TEST:-0}" = 1 ]; then rm -f "$STATE"/notified.*; notify "проверка связи: оповещения работают"; echo "Отправлено (смотрите почту/Telegram; ошибки — в $LOG)."; tail -n 5 "$LOG"; exit 0; fi

# 1) Место на диске.
use=$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')
if [ "${use:-0}" -ge "$DISK_WARN" ]; then
  bad "диск заполнен на ${use}%"
  if have docker; then run "docker builder prune -af"; run "docker image prune -af --filter until=72h"; run "docker container prune -f --filter until=24h"; fi
  have journalctl && run "journalctl --vacuum-size=200M"; have apt-get && run "apt-get clean"
  if [ "${use}" -ge "$DISK_CRIT" ]; then run "rm -rf /root/.gradle/caches /root/.cache/electron /root/.cache/electron-builder /root/.wine /root/.npm/_cacache /tmp/sky-*"; fi
  fixed "очистка диска (было ${use}%)"
fi

# 2) Память: если не хватает, а идёт сборка приложений — гасим сборку (она не нужна для работы сайта).
avail=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
if [ "${avail:-999999999}" -lt "$MEM_LOW_KB" ]; then
  bad "мало свободной памяти (${avail} КБ)"
  if pgrep -f 'build-apps.sh|gradle|electron-builder|wine' >/dev/null 2>&1; then
    run "pkill -f build-apps.sh; pkill -f gradle; pkill -f electron-builder; pkill -f wineserver"; fixed "остановлена сборка приложений (не хватало памяти)"
  fi
fi

# 3) Docker и контейнеры.
if have docker && have systemctl && systemctl cat docker >/dev/null 2>&1 && ! systemctl is-active --quiet docker; then
  bad "docker не запущен"
  if fix_budget; then mark_fix; run "systemctl restart docker"; fixed "перезапущен docker"; sleep 8; fi
fi
if have docker && [ -f "$APP_DIR/docker-compose.yml" ]; then
  cd "$APP_DIR" || true
  down=$(docker compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null | awk '$1!="certbot" && ($2!="running" || ($3!="" && $3!="healthy")) {print $1}' | tr '\n' ' ')
  [ -z "$(docker compose ps -q 2>/dev/null)" ] && down="все"
  if [ -n "$down" ]; then
    bad "контейнеры не в строю: $down"
    if fix_budget; then mark_fix; run "docker compose up -d"; fixed "docker compose up -d ($down)"
    else notify "контейнеры не в строю ($down), лимит починок исчерпан — нужно вмешательство"; fi
  fi
  # 4) Сайт отвечает? Любой ответ nginx/API (в том числе 503 «техработы») — это «жив»; нет ответа / 502 / 504 — нет.
  dom=$(grep -E '^DOMAIN=' .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"')
  if [ -n "$dom" ]; then
    code=$(curl -sk -m 8 -o /dev/null -w '%{http_code}' --resolve "$dom:443:127.0.0.1" "https://$dom/api/platform/status" 2>/dev/null || echo 000)
    cnt="$STATE/site_fail"
    case "$code" in 000|502|504|521|522) n=$(( $(cat "$cnt" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$cnt"
      bad "сайт не отвечает (код $code, подряд $n)"
      if [ "$n" -ge 3 ]; then
        if fix_budget; then mark_fix; run "docker compose restart web api"; fixed "перезапущены web и api"; echo 0 > "$cnt"
        else notify "сайт не отвечает $n мин подряд, лимит починок исчерпан"; fi
      fi;;
      *) echo 0 > "$cnt";;
    esac
  fi
fi

# 5) SSH-служба (только сама служба; шлюз подтверждения владельцем не трогаем).
if have systemctl; then
  unit=""; for u in ssh sshd; do systemctl cat "$u" >/dev/null 2>&1 && { unit="$u"; break; }; done
  if [ -n "$unit" ] && ! systemctl is-active --quiet "$unit"; then
    bad "служба $unit не запущена"
    if fix_budget; then mark_fix; run "sshd -t && systemctl restart $unit"; fixed "перезапущена служба $unit"; fi
  fi
fi

state="ok"; [ ${#issues[@]} -gt 0 ] && state="проблемы"
{ echo "время: $(date '+%F %T')"; echo "состояние: $state"; echo "диск: ${use}%  память доступно: $((${avail:-0}/1024)) МБ"
  [ ${#issues[@]} -gt 0 ] && printf 'найдено: %s\n' "${issues[*]}"; [ ${#fixes[@]} -gt 0 ] && printf 'сделано: %s\n' "${fixes[*]}"; } > "$STATE/status"
[ ${#fixes[@]} -gt 0 ] && notify "починено: ${fixes[*]}"
[ -n "${issues[*]:-}" ] && [ ${#fixes[@]} -eq 0 ] && [ "${use:-0}" -ge "$DISK_CRIT" ] && notify "диск ${use}% — нужно вмешательство"
exit 0
