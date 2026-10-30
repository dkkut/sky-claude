#!/usr/bin/env bash
# =====================================================================
#  Экстренное лечение Sky — работает на ХОСТЕ, не зависит ни от API, ни от панели, ни от почты.
#
#    bash scripts/sky-heal.sh              # только диагностика (то же, что --check)
#    bash scripts/sky-heal.sh --fix        # диагностика + лечение по лестнице, после каждой ступени — проверка
#    bash scripts/sky-heal.sh --fix --yes  # без вопроса (так зовёт watchdog)
#    bash scripts/sky-heal.sh --fix --rollback   # если не помогло — вернуть предыдущие образы web/api (только по этому флагу)
#    bash scripts/sky-heal.sh --fix --dry  # показать, что было бы сделано
#    флаги: --quiet (только итог), --json (итог одной строкой JSON)
#
#  Что проверяет: docker, файлы compose/.env и права, контейнеры (состояние, здоровье, перезапуски, нехватка памяти),
#  ответ API и сайта, базу, Redis, nginx (-t), место и inodes, память и swap, нагрузку, сертификат, часы, sshd, файл
#  отключения SSH-шлюза, уровень файрвола Sky.
#  Лестница лечения (останавливается, как только всё зелёное): права файлов → место на диске → запуск docker →
#  `compose up -d` → перезапуск неисправных контейнеров по одному → перезапуск всего стека по порядку (db, redis, api, web)
#  → [--rollback] предыдущие образы.
#  Чего НЕ делает никогда: не удаляет тома и базу, не трогает .env и секреты, не правит конфиги, не отключает SSH-шлюз,
#  не откатывает образы без флага --rollback. Коды выхода: 0 — всё в порядке (или вылечено), 2 — лечение помогло не полностью, 1 — не вылечено.
#  Журнал: /var/log/sky-heal.log (секреты в выводе контейнеров маскируются).
# =====================================================================
set -uo pipefail

MODE=check; YES=0; DRY=0; QUIET=0; ROLLBACK=0; JSON=0
for a in "$@"; do case "$a" in
  --check) MODE=check;; --fix) MODE=fix;; --yes|-y) YES=1;; --dry) DRY=1;; --quiet) QUIET=1;; --json) JSON=1;; --rollback) ROLLBACK=1;;
  -h|--help) sed -n 2,24p "$0"; exit 0;; *) echo "Неизвестный параметр: $a" >&2; exit 64;; esac; done

SRC_DIR="${SRC_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_DIR="${APP_DIR:-/opt/sky}"
LOG="${SKY_HEAL_LOG:-/var/log/sky-heal.log}"; touch "$LOG" 2>/dev/null || LOG=/tmp/sky-heal.log
LOCK="${SKY_HEAL_LOCK:-/tmp/sky-heal.lock}"
DISK_WARN="${DISK_WARN:-85}"; DISK_CRIT="${DISK_CRIT:-95}"; WAIT_SEC="${WAIT_SEC:-90}"
have() { command -v "$1" >/dev/null 2>&1; }
exec 9>"$LOCK"; flock -n 9 || { echo "Лечение уже идёт (замок $LOCK)."; exit 0; }

mask() { sed -E 's/((PASSWORD|SECRET|TOKEN|KEY|PASS)[A-Z_]*[=:] *)[^ "]+/\1***/Ig; s/(Bearer )[A-Za-z0-9._-]+/\1***/g'; }
say() { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG" 2>/dev/null; }
OKS=(); WARNS=(); FAILS=(); CRIT=()
ok()   { OKS+=("$1"); say "  ✔ $1"; }
warn() { WARNS+=("$1"); say "  ⚠ $1"; }
fail() { FAILS+=("$1"); CRIT+=("${2:-}"); say "  ✖ $1"; }     # второй параметр — код проблемы для лестницы
has_code() { local c; for c in "${CRIT[@]:-}"; do [ "$c" = "$1" ] && return 0; done; return 1; }

dc() { ( cd "$APP_DIR" && docker compose "$@" ); }
dom() { sed -n 's/^DOMAIN=//p' "$APP_DIR/.env" 2>/dev/null | tail -n1 | tr -d '"'; }

# ── проверки ────────────────────────────────────────────────────────
check_all() {
  OKS=(); WARNS=(); FAILS=(); CRIT=()
  say "── Диагностика $(date '+%F %T') · $(hostname)"
  # 1. файлы
  [ -f "$APP_DIR/docker-compose.yml" ] && ok "docker-compose.yml на месте" || fail "нет $APP_DIR/docker-compose.yml — задайте APP_DIR" nocompose
  if [ -f "$APP_DIR/.env" ]; then
    local m; m="$(stat -c %a "$APP_DIR/.env" 2>/dev/null)"
    [ "$m" = 600 ] || [ "$m" = 400 ] && ok ".env: права $m" || { warn ".env: права $m (нужно 600)"; CRIT+=(envperm); }
  else fail "нет $APP_DIR/.env (scripts/env-recover.sh, если файл потерян)" noenv; fi
  # нечитаемые для других файлы репозитория: образ API работает не от root и падает с EACCES
  if [ -d "$SRC_DIR/server" ]; then
    local bad; bad="$(find "$SRC_DIR/server" "$SRC_DIR/src" -maxdepth 2 -type f ! -perm -o=r 2>/dev/null | head -3 | tr '\n' ' ')"
    [ -z "$bad" ] && ok "права файлов репозитория" || { warn "файлы репозитория нечитаемы для других (umask 077?): $bad"; CRIT+=(repoperm); }
  fi
  # 2. docker
  if ! have docker; then fail "docker не установлен" nodocker
  elif ! docker info >/dev/null 2>&1; then fail "docker не отвечает" dockerdown
  else
    ok "docker отвечает"
    [ -f "$APP_DIR/docker-compose.yml" ] && check_containers
  fi
  # 3. ресурсы
  check_resources
  # 4. прочее
  check_misc
  say "── Итог: ✔ ${#OKS[@]}  ⚠ ${#WARNS[@]}  ✖ ${#FAILS[@]}"
}

check_containers() {
  local rows svc state health svcs="db redis api web"
  rows="$(dc ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null)"
  [ -z "$rows" ] && { fail "контейнеры не созданы" nocontainers; return; }
  for svc in $svcs; do
    local line; line="$(printf '%s\n' "$rows" | awk -v s="$svc" '$1==s{print; exit}')"
    if [ -z "$line" ]; then warn "служба $svc не найдена в compose"; continue; fi
    state="$(echo "$line" | awk '{print $2}')"; health="$(echo "$line" | awk '{print $3}')"
    if [ "$state" != running ]; then fail "$svc: состояние «$state»" "svc:$svc"
    elif [ -n "$health" ] && [ "$health" != healthy ]; then fail "$svc: здоровье «$health»" "svc:$svc"
    else ok "$svc: работает${health:+, $health}"; fi
    # перезапуски и нехватка памяти
    local cid; cid="$(dc ps -q "$svc" 2>/dev/null | head -1)"
    if [ -n "$cid" ]; then
      local rc oom; rc="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0)"; oom="$(docker inspect -f '{{.State.OOMKilled}}' "$cid" 2>/dev/null || echo false)"
      [ "${rc:-0}" -ge 5 ] 2>/dev/null && warn "$svc перезапускался $rc раз(а) — смотрите журнал: docker compose logs --tail 80 $svc"
      [ "$oom" = true ] && warn "$svc был остановлен из-за нехватки памяти (OOM) — поднимите лимит mem_limit или освободите память"
    fi
  done
  # ответ API и сайта
  local api; api="$(dc exec -T api sh -c 'wget -qO- http://127.0.0.1:8080/healthz 2>/dev/null || curl -fsS http://127.0.0.1:8080/healthz 2>/dev/null' 2>/dev/null)"
  [ -n "$api" ] && ok "API отвечает на /healthz" || { has_code svc:api || fail "API не отвечает на /healthz" apihealth; }
  local d; d="$(dom)"
  if [ -n "$d" ] && have curl; then
    local code; code="$(curl -sk -m 8 -o /dev/null -w '%{http_code}' --resolve "$d:443:127.0.0.1" "https://$d/api/platform/status" 2>/dev/null || echo 000)"
    case "$code" in 000|502|504|521|522) fail "сайт не отвечает (код $code)" web;; *) ok "сайт отвечает (код $code)";; esac
  fi
  # база и Redis
  dc exec -T db pg_isready -U "${POSTGRES_USER:-sky}" >/dev/null 2>&1 && ok "база принимает подключения" || { has_code svc:db || fail "база не принимает подключения" dbready; }
  local rp; rp="$(sed -n 's/^REDIS_PASSWORD=//p' "$APP_DIR/.env" 2>/dev/null | tail -n1 | tr -d '"')"
  if [ -n "$(dc exec -T redis sh -c "redis-cli ${rp:+-a '$rp' --no-auth-warning }ping" 2>/dev/null | grep -i pong)" ]; then ok "Redis отвечает"; else has_code svc:redis || fail "Redis не отвечает" redisping; fi
  # nginx
  dc exec -T web nginx -t >/dev/null 2>&1 && ok "конфигурация nginx проходит nginx -t" || { has_code svc:web || warn "nginx -t не проходит (конфиг сломан — лечится деплоем, не перезапуском)"; }
  # уровень файрвола Sky
  local lv; lv="$(dc exec -T db psql -U "${POSTGRES_USER:-sky}" -tAc 'SELECT level FROM firewall_state' 2>/dev/null | tr -d '[:space:]')"
  case "$lv" in 3|4) warn "файрвол Sky на уровне $lv — идёт атака или уровень не снят (админка → Файрвол)";; [0-2]) ok "файрвол Sky: уровень $lv";; esac
}

check_resources() {
  local use inode mem swap load cores
  use="$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')"
  if [ "${use:-0}" -ge "$DISK_CRIT" ]; then fail "диск заполнен на ${use}%" disk; elif [ "${use:-0}" -ge "$DISK_WARN" ]; then warn "диск заполнен на ${use}%"; CRIT+=(disk); else ok "диск: ${use:-?}%"; fi
  inode="$(df -Pi / | awk 'NR==2{gsub("%","",$5); print $5}')"; [ "${inode:-0}" -ge 90 ] 2>/dev/null && warn "inodes заполнены на ${inode}%" || ok "inodes: ${inode:-?}%"
  mem="$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null)"; [ "${mem:-9999}" -lt 300 ] && warn "мало свободной памяти: ${mem} МБ" || ok "память доступно: ${mem:-?} МБ"
  swap="$(awk '/SwapTotal/{t=$2} /SwapFree/{f=$2} END{ if (t>0) print int((t-f)*100/t); else print -1 }' /proc/meminfo 2>/dev/null)"; [ "${swap:--1}" -ge 80 ] 2>/dev/null && warn "swap занят на ${swap}% — не хватает памяти"
  load="$(awk '{print int($1)}' /proc/loadavg 2>/dev/null)"; cores="$(nproc 2>/dev/null || echo 1)"
  [ "${load:-0}" -gt $(( cores * 3 )) ] 2>/dev/null && warn "высокая нагрузка: load ${load} на ${cores} ядер" || ok "нагрузка: load ${load:-?} / ${cores} ядер"
}

check_misc() {
  local d; d="$(dom)"
  if [ -n "$d" ] && have openssl; then
    local end days; end="$(echo | timeout 8 openssl s_client -servername "$d" -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
    if [ -n "$end" ]; then days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
      [ "$days" -lt 2 ] && fail "сертификат истекает через ${days} дн." cert || { [ "$days" -lt 14 ] && warn "сертификат истекает через ${days} дн. (certbot renew)" || ok "сертификат: ещё ${days} дн."; }
    fi
  fi
  have timedatectl && { [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = yes ] && ok "часы синхронизированы" || warn "часы не синхронизированы (коды аутентификатора и подписи могут не проходить)"; }
  if have systemctl; then local u=""; for x in ssh sshd; do systemctl cat "$x" >/dev/null 2>&1 && { u="$x"; break; }; done
    if [ -n "$u" ]; then systemctl is-active --quiet "$u" && ok "служба $u работает" || { fail "служба $u не запущена" sshd; }; fi; fi
  if [ -e /etc/sky-ssh-gate.off ]; then local v; v="$(head -c 20 /etc/sky-ssh-gate.off | tr -d '[:space:]')"
    case "$v" in ''|*[!0-9]*) warn "SSH-шлюз выключен бессрочно (/etc/sky-ssh-gate.off) — не забудьте убрать файл";; *) warn "SSH-шлюз временно выключен до $(date -d "@$v" '+%F %T' 2>/dev/null)";; esac; fi
}

# ── лечение ─────────────────────────────────────────────────────────
act() { local what="$1"; shift; say "  → $what"; [ "$DRY" = 1 ] && { say "    [dry] $*"; return 0; }; "$@" 2>&1 | mask | tail -n 8 | while IFS= read -r l; do say "    $l"; done; return 0; }
quick_ok() {   # главное: контейнеры в строю и API отвечает
  have docker && docker info >/dev/null 2>&1 || return 1
  local rows bad; rows="$(dc ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null)"; [ -n "$rows" ] || return 1
  bad="$(printf '%s\n' "$rows" | awk '$1!="certbot" && ($2!="running" || ($3!="" && $3!="healthy")) {print $1}')"; [ -z "$bad" ] || return 1
  [ -n "$(dc exec -T api sh -c 'wget -qO- http://127.0.0.1:8080/healthz 2>/dev/null || curl -fsS http://127.0.0.1:8080/healthz 2>/dev/null' 2>/dev/null)" ]
}
wait_ok() { [ "$DRY" = 1 ] && return 1; local i=0; while [ $i -lt "$WAIT_SEC" ]; do quick_ok && return 0; sleep 3; i=$((i+3)); done; return 1; }

heal() {
  local steps=0
  if has_code envperm; then act "права .env → 600" chmod 600 "$APP_DIR/.env"; steps=$((steps+1)); fi
  if has_code repoperm; then act "права файлов репозитория (go+rX, кроме .env и secrets)" bash -c "find '$SRC_DIR' -path '$SRC_DIR/.git' -prune -o -path '$SRC_DIR/secrets' -prune -o -path '*/node_modules' -prune -o -name '.env*' -prune -o -exec chmod go+rX {} +"; steps=$((steps+1)); fi
  if has_code disk; then
    act "очистка кэша сборки и старых образов" bash -c 'docker builder prune -af >/dev/null 2>&1; docker image prune -af --filter until=72h >/dev/null 2>&1; docker container prune -f --filter until=24h >/dev/null 2>&1; command -v journalctl >/dev/null 2>&1 && journalctl --vacuum-size=200M >/dev/null 2>&1; command -v apt-get >/dev/null 2>&1 && apt-get clean >/dev/null 2>&1; true'
    steps=$((steps+1)); fi
  if has_code dockerdown; then act "запуск docker" systemctl restart docker; sleep 8; steps=$((steps+1)); fi
  if has_code sshd; then local u=ssh; systemctl cat sshd >/dev/null 2>&1 && u=sshd; act "запуск службы $u (после проверки конфига)" bash -c "sshd -t && systemctl restart $u"; steps=$((steps+1)); fi
  have docker && docker info >/dev/null 2>&1 || { say "docker так и не ответил — дальше лечить нечем."; return 1; }
  quick_ok && { say "✔ после первых шагов всё в порядке"; return 0; }

  say "Ступень 1: docker compose up -d"; act "создать и запустить недостающие контейнеры" dc up -d
  wait_ok && { say "✔ помогло"; return 0; }

  say "Ступень 2: перезапуск неисправных контейнеров по одному"
  local bad svc; bad="$(dc ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null | awk '$1!="certbot" && ($2!="running" || ($3!="" && $3!="healthy")) {print $1}' | tr '\n' ' ')"
  for svc in db redis api web; do case " $bad " in *" $svc "*) act "перезапуск $svc" dc restart "$svc"; sleep 5;; esac; done
  wait_ok && { say "✔ помогло"; return 0; }

  say "Ступень 3: перезапуск всего стека по порядку (db → redis → api → web)"
  for svc in db redis; do act "перезапуск $svc" dc restart "$svc"; done; sleep 10
  act "перезапуск api" dc restart api; sleep 8
  act "перезапуск web" dc restart web
  wait_ok && { say "✔ помогло"; return 0; }

  if [ "$ROLLBACK" = 1 ]; then rollback_images && { wait_ok && { say "✔ помогло: возвращены прежние образы"; return 0; }; }
  else say "Не помогло. Если сломалось после обновления — повторите с --rollback (вернёт предыдущие образы web/api)."; fi
  return 1
}

rollback_images() {
  say "Ступень 4: возврат на предыдущие образы web/api"
  local cur_api cur_web prev_api prev_web
  cur_api="$(sed -n 's/^API_IMAGE=//p' "$APP_DIR/.env" | tail -n1)"; cur_web="$(sed -n 's/^WEB_IMAGE=//p' "$APP_DIR/.env" | tail -n1)"
  prev_api="$(docker image ls --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' | awk '$1 ~ /^sky-api:/ && $1 !~ /:local$/' | sort -k2 -r | awk '{print $1}' | grep -vxF "$cur_api" | head -1)"
  prev_web="$(docker image ls --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' | awk '$1 ~ /^sky-web:/ && $1 !~ /:local$/' | sort -k2 -r | awk '{print $1}' | grep -vxF "$cur_web" | head -1)"
  [ -n "$prev_api" ] && [ -n "$prev_web" ] || { say "  предыдущих образов на диске нет — откатывать не на что."; return 1; }
  say "  было: $cur_api / $cur_web → станет: $prev_api / $prev_web"
  [ "$DRY" = 1 ] && return 1
  cp -p "$APP_DIR/.env" "$APP_DIR/.env.heal-backup" 2>/dev/null
  sed -i "s|^API_IMAGE=.*|API_IMAGE=$prev_api|; s|^WEB_IMAGE=.*|WEB_IMAGE=$prev_web|" "$APP_DIR/.env"
  act "docker compose up -d на прежних образах" dc up -d --remove-orphans
  say "  .env до отката сохранён: $APP_DIR/.env.heal-backup"
  return 0
}

report_failures() {
  [ "${#FAILS[@]}" -eq 0 ] && return
  say "── Что осталось (ручные шаги):"
  local f; for f in "${FAILS[@]}"; do say "  • $f"; done
  have docker && docker info >/dev/null 2>&1 && for svc in api web db; do
    case " ${CRIT[*]:-} " in *"svc:$svc"*|*apihealth*|*web*) say "  Последние строки журнала $svc:"; dc logs --tail 12 "$svc" 2>&1 | mask | while IFS= read -r l; do say "    $l"; done;; esac
  done
}

json_out() { printf '{"time":"%s","host":"%s","ok":%d,"warn":%d,"fail":%d,"healed":%s}\n' "$(date -Is)" "$(hostname)" "${#OKS[@]}" "${#WARNS[@]}" "${#FAILS[@]}" "$1"; }

# ── запуск ──────────────────────────────────────────────────────────
check_all
if [ "$MODE" = check ]; then
  [ "$JSON" = 1 ] && json_out false
  [ "${#FAILS[@]}" -eq 0 ] && exit 0; report_failures; exit 1
fi
if [ "${#FAILS[@]}" -eq 0 ] && ! has_code envperm && ! has_code repoperm && ! has_code disk; then say "Лечить нечего."; [ "$JSON" = 1 ] && json_out true; exit 0; fi
if [ "$YES" != 1 ] && [ "$DRY" != 1 ]; then
  [ -t 0 ] || { echo "Нужно подтверждение: добавьте --yes (запуск без терминала)."; exit 64; }
  printf 'Начать лечение (перезапуски контейнеров, очистка кэша)? Базу и тома оно не трогает. [y/N] '; read -r r; [ "$r" = y ] || [ "$r" = Y ] || { echo "Отменено."; exit 0; }
fi
say "── Лечение"
if heal; then rc=0; else rc=1; fi
say "── Повторная проверка"
check_all
if [ "${#FAILS[@]}" -eq 0 ]; then say "ГОТОВО: все критичные проверки зелёные."; [ "$JSON" = 1 ] && json_out true; exit 0; fi
report_failures
[ "$JSON" = 1 ] && json_out false
[ "$rc" = 0 ] && exit 2; exit 1
