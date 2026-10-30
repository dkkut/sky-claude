#!/usr/bin/env bash
# =====================================================================
#  Экстренное лечение Sky — работает на ХОСТЕ, не зависит ни от API, ни от панели, ни от почты.
#
#    bash scripts/sky-heal.sh              # только диагностика (то же, что --check)
#    bash scripts/sky-heal.sh --fix        # диагностика + лечение по лестнице, после каждой ступени — проверка
#    bash scripts/sky-heal.sh --fix --yes  # без вопроса (так зовёт watchdog)
#    bash scripts/sky-heal.sh --fix --rollback   # если не помогло — вернуть предыдущие образы web/api (только по этому флагу)
#    bash scripts/sky-heal.sh --fix --dry  # показать, что было бы сделано
#    bash scripts/sky-heal.sh --fix --unlock     # + снять блокировки адресов самозащитой и сбросить уровень файрвола («закрылись все соединения»)
#    bash scripts/sky-heal.sh --fix --fix-env    # + починить рассинхрон OPS_SECRET (агент Sky Ops ↔ .env ↔ контейнер api); правит ТОЛЬКО эту строку
#    bash scripts/sky-heal.sh --open-ssh 30      # открыть SSH-шлюз на 30 минут (когда API лежит и войти нельзя); потом сам закроется
#    bash scripts/sky-heal.sh --report           # собрать отчёт (диагностика + журналы без секретов) в /tmp/sky-heal-report-*.txt — прислать разработчику
#    флаги: --quiet (только итог), --json (итог одной строкой JSON)
#
#  Что проверяет: docker, файлы compose/.env и права, переменные compose без значения в .env, контейнеры (состояние, здоровье,
#  перезапуски, нехватка памяти), ответ API и сайта, базу (имя службы определяется само: postgres/db), Redis, nginx (-t),
#  МИГРАЦИИ, подключения к БД, место и inodes, память и swap, нагрузку, сертификат, часы, sshd, ШЛЮЗ SSH (файл хука, файл
#  отключения), УРОВЕНЬ ФАЙРВОЛА и БЛОКИРОВКИ самозащиты, агент SKY OPS (секрет), ПОЧТУ (режим, доступность SMTP), расхождение
#  исходников и развёрнутого образа, и ПРИЧИНЫ ПО ЖУРНАЛАМ (api/web/база за 20 минут: права, миграции, пароль БД, Redis, память,
#  порт, секреты, почта, nginx) — с названием причины и командой, а не просто «не отвечает».
#  Лечение по причинам (до лестницы): права, место, миграции одноразовым запуском, блокировки самозащиты (подбор путей; все — с --unlock),
#  пересоздание api при пустом OPS_SECRET, возврат рабочей копии хука SSH.
#  Лестница лечения (останавливается, как только всё зелёное): права файлов → место на диске → запуск docker →
#  `compose up -d` → перезапуск неисправных контейнеров по одному → перезапуск всего стека по порядку (db, redis, api, web)
#  → [--rollback] предыдущие образы.
#  Чего НЕ делает никогда: не удаляет тома и базу, не трогает .env и секреты (кроме одной строки OPS_SECRET по --fix-env), не правит
#  конфиги, не отключает SSH-шлюз (кроме явного --open-ssh), не откатывает образы без флага --rollback, не снимает файрвол без --unlock. Коды выхода: 0 — всё в порядке (или вылечено), 2 — лечение помогло не полностью, 1 — не вылечено.
#  Журнал: /var/log/sky-heal.log (секреты в выводе контейнеров маскируются).
# =====================================================================
set -uo pipefail

MODE=check; YES=0; DRY=0; QUIET=0; ROLLBACK=0; JSON=0; UNLOCK=0; FIXENV=0; REPORT=0; OPENSSH=""
while [ $# -gt 0 ]; do case "$1" in
  --check) MODE=check;; --fix) MODE=fix;; --yes|-y) YES=1;; --dry) DRY=1;; --quiet) QUIET=1;; --json) JSON=1;; --rollback) ROLLBACK=1;;
  --unlock) UNLOCK=1;; --fix-env) FIXENV=1;; --report) REPORT=1;;
  --open-ssh) shift; OPENSSH="${1:-}"; case "$OPENSSH" in ''|*[!0-9]*) echo "--open-ssh: число минут (1–240)" >&2; exit 64;; esac;;
  -h|--help) sed -n 2,40p "$0"; exit 0;; *) echo "Неизвестный параметр: $1" >&2; exit 64;; esac; shift; done

SRC_DIR="${SRC_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_DIR="${APP_DIR:-/opt/sky}"
LOG="${SKY_HEAL_LOG:-/var/log/sky-heal.log}"; touch "$LOG" 2>/dev/null || LOG=/tmp/sky-heal.log
LOCK="${SKY_HEAL_LOCK:-/tmp/sky-heal.lock}"
OPS_ENV="${SKY_OPS_ENV:-/etc/sky-ops.env}"
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
ops_to_env() {   # секрет агента → .env (значение нигде не печатается)
  local sa; sa="$(sed -n 's/^OPS_SECRET=//p' "$OPS_ENV" 2>/dev/null | tail -n1 | tr -d '"')"; [ "${#sa}" -ge 24 ] || return 1
  cp -p "$APP_DIR/.env" "$APP_DIR/.env.heal-backup"; sed -i '/^OPS_SECRET=/d' "$APP_DIR/.env"; printf 'OPS_SECRET=%s\n' "$sa" >> "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"
}
ops_to_agent() {  # секрет из .env → агенту, перезапуск агента
  local se; se="$(sed -n 's/^OPS_SECRET=//p' "$APP_DIR/.env" 2>/dev/null | tail -n1 | tr -d '"')"; [ "${#se}" -ge 24 ] || return 1
  sed -i '/^OPS_SECRET=/d' "$OPS_ENV"; printf 'OPS_SECRET=%s\n' "$se" >> "$OPS_ENV"; chmod 600 "$OPS_ENV"; systemctl restart sky-ops
}
dom() { sed -n 's/^DOMAIN=//p' "$APP_DIR/.env" 2>/dev/null | tail -n1 | tr -d '"'; }
envget() { sed -n "s/^$1=//p" "$APP_DIR/.env" 2>/dev/null | tail -n1 | tr -d '"'; }
hs() { printf %s "$1" | sha256sum | cut -c1-12; }
# Имя службы БД в compose бывает postgres или db — раньше скрипт знал только «db», и проверки базы/файрвола молча не работали.
DBSVC=""; PGUSER_=""; PGDB_=""
detect_db() {
  [ -n "$DBSVC" ] && return 0
  have docker && docker info >/dev/null 2>&1 || return 1
  local names; names="$( { dc ps -a --format '{{.Service}}' 2>/dev/null; dc config --services 2>/dev/null; } | sort -u)"
  local c; for c in postgres db postgresql; do printf '%s\n' "$names" | grep -qx "$c" && { DBSVC="$c"; break; }; done
  [ -n "$DBSVC" ] || DBSVC=postgres
  PGUSER_="$(envget POSTGRES_USER)"; PGUSER_="${PGUSER_:-sky}"; PGDB_="$(envget POSTGRES_DB)"; PGDB_="${PGDB_:-sky}"
}
sql() { detect_db; dc exec -T "$DBSVC" psql -U "$PGUSER_" -d "$PGDB_" -tAc "$1" 2>/dev/null | tr -d '\r'; }
num() { case "$1" in ''|*[!0-9]*) return 1;; *) return 0;; esac; }
last_err() { dc logs --no-color --since 20m --tail 60 "$1" 2>&1 | mask | grep -iE 'error|fatal|ошибк|EACCES|не удалось|failed' | tail -n 1 | cut -c1-200; }

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
  # 5. причины: переменные, миграции, самозащита/файрвол, SSH, Ops, почта, расхождение деплоя, журналы
  if have docker && docker info >/dev/null 2>&1 && [ -f "$APP_DIR/docker-compose.yml" ]; then
    detect_db; check_env; check_migrations; check_dbconns; check_defense; check_ops; check_mail; check_drift; check_ssh_gate; analyse_logs
  fi
  say "── Итог: ✔ ${#OKS[@]}  ⚠ ${#WARNS[@]}  ✖ ${#FAILS[@]}"
}

check_containers() {
  detect_db; local rows svc state health svcs="$DBSVC redis api web"
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
      if [ "${rc:-0}" -ge 5 ] 2>/dev/null; then
        local le; le="$(last_err "$svc")"; warn "$svc перезапускался $rc раз(а)${le:+; последняя ошибка: $le}"
      elif [ "${rc:-0}" -ge 2 ] 2>/dev/null; then local st0; st0="$(docker inspect -f '{{.State.StartedAt}}' "$cid" 2>/dev/null)"
        [ -n "$st0" ] && [ $(( $(date +%s) - $(date -d "$st0" +%s 2>/dev/null || echo 0) )) -lt 300 ] && warn "$svc недавно перезапускался ($rc раз) — возможно, падает при запуске: $(last_err "$svc")"
      fi
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
  dc exec -T "$DBSVC" pg_isready -U "$PGUSER_" >/dev/null 2>&1 && ok "база принимает подключения" || { has_code "svc:$DBSVC" || fail "база не принимает подключения" dbready; }
  local rp; rp="$(sed -n 's/^REDIS_PASSWORD=//p' "$APP_DIR/.env" 2>/dev/null | tail -n1 | tr -d '"')"
  if [ -n "$(dc exec -T redis sh -c "redis-cli ${rp:+-a '$rp' --no-auth-warning }ping" 2>/dev/null | grep -i pong)" ]; then ok "Redis отвечает"; else has_code svc:redis || fail "Redis не отвечает" redisping; fi
  # nginx
  dc exec -T web nginx -t >/dev/null 2>&1 && ok "конфигурация nginx проходит nginx -t" || { has_code svc:web || warn "nginx -t не проходит (конфиг сломан — лечится деплоем, не перезапуском)"; }
}

check_env() {   # переменные compose без значения и обязательные секреты
  local miss; miss="$(dc config -q 2>&1 >/dev/null | grep -i 'variable is not set' | sed -E 's/.*The ([A-Za-z0-9_]+) variable.*/\1/' | sort -u | tr '\n' ' ')"
  [ -n "$miss" ] && { warn "в .env не заданы переменные, которые compose требует: $miss"; CRIT+=(envmissing); } || ok "переменные compose заданы"
  local k v need=""
  for k in JWT_SECRET REFRESH_TOKEN_SECRET; do v="$(envget "$k")"
    [ "${#v}" -ge 16 ] || grep -q "^${k}_FILE=" "$APP_DIR/.env" 2>/dev/null || need="$need $k"; done
  [ -n "$need" ] && fail "нет обязательных секретов в .env:$need (scripts/env-check.sh, scripts/env-recover.sh)" secrets || ok "обязательные секреты на месте"
}

check_migrations() {
  local files applied; files="$(ls "$SRC_DIR"/server/migrations/*.sql 2>/dev/null | wc -l)"
  applied="$(sql 'SELECT count(*) FROM schema_migrations')"
  if num "$applied" && [ "$files" -gt 0 ]; then
    if [ "$applied" -lt "$files" ]; then warn "применено $applied миграций из $files в исходниках — возможно, деплой не довёл схему до актуальной"; CRIT+=(pendingmig)
    else ok "миграции: применено $applied из $files"; fi
  fi
}

check_dbconns() {
  local r a m; r="$(sql "SELECT (SELECT count(*) FROM pg_stat_activity)||'/'||(SELECT setting FROM pg_settings WHERE name='max_connections')")"
  a="${r%%/*}"; m="${r##*/}"
  if num "$a" && num "$m" && [ "$m" -gt 0 ]; then [ $(( a * 100 / m )) -ge 80 ] && warn "база: занято $a из $m подключений — нужно перезапустить api или поднять max_connections" || ok "подключения к базе: $a из $m"; fi
}

check_defense() {   # самозащита и файрвол Sky: частая причина «закрылись все соединения»
  local n lv pin by
  n="$(sql "SELECT count(*) FROM defense_ip_blocks WHERE expires_at > now()")"
  if num "$n"; then
    if [ "$n" -gt 0 ]; then warn "самозащита держит $n блокировок адресов (админка → Самозащита). Лечение: sky-heal --fix (подбор путей) или --fix --unlock (все)"; CRIT+=(defblock)
    else ok "самозащита: блокировок адресов нет"; fi
  fi
  lv="$(sql "SELECT level FROM firewall_state")"; pin="$(sql "SELECT coalesce(pinned_until::text,'') FROM firewall_state")"; by="$(sql "SELECT coalesce(set_by,'авто') FROM firewall_state")"
  case "$lv" in
    3|4) warn "файрвол Sky на уровне $lv (поставил: $by${pin:+, держится до $pin}) — гостям закрыта почти вся площадка; если атаки нет: sky-heal --fix --unlock"; CRIT+=(fwlevel);;
    [0-2]) ok "файрвол Sky: уровень $lv";;
  esac
}

check_ops() {   # агент Sky Ops: секрет в .env, в контейнере api и у агента должен совпадать
  have systemctl && systemctl cat sky-ops >/dev/null 2>&1 || return 0
  systemctl is-active --quiet sky-ops || { warn "агент Sky Ops (sky-ops) не запущен — задания из вкладки «Сервер» не выполняются (systemctl restart sky-ops)"; return 0; }
  local se sa sc
  se="$(envget OPS_SECRET)"; sa="$(sed -n 's/^OPS_SECRET=//p' "$OPS_ENV" 2>/dev/null | tail -n1 | tr -d '"')"
  sc="$(dc exec -T api sh -c 'printf %s "$OPS_SECRET"' 2>/dev/null)"
  if [ "${#sc}" -ge 24 ] && [ "${#sa}" -ge 24 ] && [ "$(hs "$sc")" = "$(hs "$sa")" ]; then ok "Sky Ops: секрет агента и API совпадают"
  elif [ "${#sc}" -lt 24 ] && [ "${#se}" -ge 24 ]; then warn "Sky Ops: секрет есть в .env, но контейнер api его не получил (создан до записи секрета) — лечится пересозданием api (--fix)"; CRIT+=(opsrecreate)
  elif [ "${#sc}" -lt 24 ] && [ "${#se}" -lt 24 ] && [ "${#sa}" -ge 24 ]; then warn "Sky Ops: секрет только у агента (нет в .env) — API отвечает агенту 404 ops_disabled. Лечение: sky-heal --fix --fix-env (перенесёт секрет в .env и пересоздаст api)"; CRIT+=(opsenv)
  elif [ "${#sc}" -lt 24 ] && [ "${#sa}" -lt 24 ]; then warn "Sky Ops: секрет не создан нигде — bash scripts/install-ops.sh --genkey, затем deploy-local.sh и --install"
  elif [ "$(hs "$sc")" != "$(hs "$sa")" ]; then warn "Sky Ops: секрет API и агента РАЗНЫЕ — агент получает 403. Лечение: sky-heal --fix --fix-env (возьмёт значение из .env)"; CRIT+=(opsmismatch)
  fi
  return 0
}

check_mail() {
  local mode; mode="$(envget EMAIL_MODE)"; mode="${mode:-log}"
  case "$mode" in
    log) if [ "$(envget ALLOW_LOG_CODES)" = 1 ]; then warn "почта: EMAIL_MODE=log — письма не отправляются, коды пишутся в журнал"
         else warn "почта не настроена (EMAIL_MODE=log): коды входа и письма не уходят — bash scripts/set-email.sh"; CRIT+=(mailconf); fi;;
    smtp) local h pt; h="$(envget SMTP_HOST)"; pt="$(envget SMTP_PORT)"; pt="${pt:-465}"
      if [ -z "$h" ] || [ -z "$(envget EMAIL_FROM)" ]; then warn "почта (smtp): не заданы SMTP_HOST или EMAIL_FROM — bash scripts/set-email.sh"; CRIT+=(mailconf)
      elif have timeout && ! timeout 6 bash -c "exec 3<>/dev/tcp/$h/$pt" 2>/dev/null; then warn "почта (smtp): сервер $h:$pt недоступен с этого сервера (порт закрыт у хостера или неверный адрес)"; CRIT+=(mailnet)
      else ok "почта (smtp): $h:$pt доступен"; fi;;
    resend) local rk; rk="$(envget RESEND_API_KEY)"
      if [ "${#rk}" -lt 10 ] || [ -z "$(envget EMAIL_FROM)" ]; then warn "почта (resend): нет RESEND_API_KEY или EMAIL_FROM — bash scripts/set-email.sh"; CRIT+=(mailconf); else ok "почта (resend): ключ задан"; fi;;
    webhook) [ -n "$(envget EMAIL_WEBHOOK_URL)" ] && ok "почта (webhook): адрес задан" || { warn "почта (webhook): нет EMAIL_WEBHOOK_URL"; CRIT+=(mailconf); };;
    *) warn "почта: неизвестный EMAIL_MODE=$mode";;
  esac
}

check_drift() {   # что лежит в исходниках и что реально запущено
  have git && [ -d "$SRC_DIR/.git" ] || return 0
  local head img tag; head="$(git -C "$SRC_DIR" rev-parse --short=7 HEAD 2>/dev/null)"; img="$(envget API_IMAGE)"; tag="${img##*:}"
  [ -n "$head" ] && [ -n "$tag" ] || return 0
  if [ "${tag:0:7}" = "$head" ]; then ok "развёрнут код $head"
  else warn "в $SRC_DIR код $head, а запущен образ «$tag» — деплой не запускался или не дошёл до конца (bash scripts/deploy-local.sh)"; fi
  [ -n "$(git -C "$SRC_DIR" status --porcelain 2>/dev/null | head -1)" ] && warn "в $SRC_DIR есть локальные правки файлов — deploy-local.sh откажется собирать (git status)"
  return 0
}

check_ssh_gate() {   # шлюз SSH закрыт по умолчанию: при лежащем API войти нельзя
  [ -f /etc/pam.d/sshd ] && grep -q 'ssh-gate' /etc/pam.d/sshd 2>/dev/null || return 0
  ok "шлюз SSH установлен в PAM"
  if [ ! -x /usr/local/sbin/sky-ssh-gate ]; then
    fail "в PAM есть шлюз SSH, но рабочей копии /usr/local/sbin/sky-ssh-gate нет — вход закрыт для ВСЕХ (heal вернёт копию: ssh-gate.sh --sync)" sshgatemissing
  fi
  [ ! -e /etc/sky-ssh-gate.totp ] && warn "нет запасного кода входа SSH на случай падения API (sudo bash scripts/ssh-gate.sh --totp-setup)"
  quick_ok >/dev/null 2>&1 || warn "API недоступен, а шлюз SSH закрыт: новые входы по SSH не пройдут. Откройте на время: sky-heal --open-ssh 30 (с консоли хостера)"
  return 0
}

# Причины по журналам за последние 20 минут: название причины и что делать.
SIGS=(
  'EACCES|permission denied.*(/app|server)|repoperm|нет прав на файлы приложения (umask 077 при git pull)|heal выдаст права go+rX'
  'не применены миграции|pending migrations|pendingmig|схема базы отстаёт от кода|heal применит миграции одноразовым запуском'
  'relation ".*" does not exist|column ".*" does not exist|schemaerr|в базе нет таблицы или колонки, которой ждёт код (миграция не применена)|heal применит миграции одноразовым запуском'
  'password authentication failed|dbauth|пароль БД в .env не совпадает с паролем в томе postgres|вручную: сверьте POSTGRES_PASSWORD (том хранит пароль первого запуска)'
  'NOAUTH|WRONGPASS|redisauth|неверный пароль Redis|сверьте REDIS_PASSWORD в .env и в службе redis'
  'EADDRINUSE|portbusy|порт уже занят другим процессом|найдите процесс командой ss -ltnp на порту 8080'
  'heap out of memory|FATAL ERROR.*(heap|allocation)|oomnode|у Node закончилась память|поднимите mem_limit api в compose или снизьте нагрузку'
  'ENOSPC|No space left|diskfull|нет места на диске|heal очистит кэш сборки и старые образы'
  'too many clients|remaining connection slots|dbconnfull|исчерпаны подключения к базе|перезапустите api, при повторе поднимите max_connections'
  '(JWT_SECRET|ENCRYPTION_KEY|REFRESH_TOKEN_SECRET).*(не задан|required|empty|пуст|too short|короч)|secretmissing|не задан обязательный секрет|bash scripts/env-check.sh'
  '\[email[^]]*\].*(fail|ошибк|timeout|timed out|ETIMEDOUT|EHOSTUNREACH|ECONN|535|Invalid login|Unauthorized|ENOTFOUND|certificate)|email_delivery_failed|mailfail|почтовый сервер отказывает или недоступен|причина в этой строке; настройка: bash scripts/set-email.sh'
)
analyse_logs() {
  local la lw ld; la="$(dc logs --no-color --since 20m --tail 400 api 2>&1 | mask)"
  lw="$(dc logs --no-color --since 20m --tail 200 web 2>&1 | mask)"; ld="$(dc logs --no-color --since 20m --tail 200 "$DBSVC" 2>&1 | mask)"
  local sig re code what hint line n=0
  for sig in "${SIGS[@]}"; do
    # формат: regex|…|код|причина|что делать  (regex может содержать |, поэтому режем с конца)
    hint="${sig##*|}"; local r1="${sig%|*}"; what="${r1##*|}"; r1="${r1%|*}"; code="${r1##*|}"; re="${r1%|*}"
    line="$(printf '%s\n%s\n%s\n' "$la" "$ld" "$lw" | grep -Eim1 "$re" | cut -c1-170)"
    if [ -n "$line" ]; then n=$((n+1)); warn "причина по журналу: $what → $hint  [строка: $line]"; CRIT+=("sig:$code"); fi
  done
  printf '%s\n' "$lw" | grep -qiE 'host not found in upstream' && { warn "причина по журналу: nginx не видит api (api не запущен) → heal поднимет api и перезапустит web"; CRIT+=(sig:webupstream); n=$((n+1)); }
  printf '%s\n' "$lw" | grep -qiE '\[emerg\]' && { warn "причина по журналу: ошибка конфигурации nginx ([emerg]) → перезапуск не поможет, нужен деплой (deploy-local.sh проверит nginx -t)"; n=$((n+1)); }
  [ "$n" = 0 ] && ok "в журналах за 20 минут известных причин сбоя нет"
  return 0
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

check_backup() {   # автокопии: свежая удачная копия есть? (состояние пишет scripts/sky-backup-run.sh)
  local st=/var/lib/sky-backup/status
  [ -f /etc/sky-backup.env ] || { warn "автокопии не установлены (bash scripts/install-backup.sh --install)"; return 0; }
  local ok; ok="$(sed -n 's/^last_ok=//p' "$st" 2>/dev/null | tail -n1)"
  if [ -z "$ok" ]; then warn "автокопии установлены, но удачной копии ещё не было (bash scripts/install-backup.sh --doctor)"
  elif [ $(( $(date +%s) - ok )) -gt 129600 ]; then warn "последняя удачная копия была $(( ( $(date +%s) - ok ) / 3600 )) ч назад — см. sky-backup --status"
  else ok "автокопии: последняя удачная $(( ( $(date +%s) - ok ) / 3600 )) ч назад"; fi
}
check_misc() {
  check_backup
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
  if has_code repoperm || has_code sig:repoperm; then act "права файлов репозитория (go+rX, кроме .env и secrets)" bash -c "find '$SRC_DIR' -path '$SRC_DIR/.git' -prune -o -path '$SRC_DIR/secrets' -prune -o -path '*/node_modules' -prune -o -name '.env*' -prune -o -exec chmod go+rX {} +"; steps=$((steps+1)); fi
  if has_code disk || has_code sig:diskfull; then
    act "очистка кэша сборки и старых образов" bash -c 'docker builder prune -af >/dev/null 2>&1; docker image prune -af --filter until=72h >/dev/null 2>&1; docker container prune -f --filter until=24h >/dev/null 2>&1; command -v journalctl >/dev/null 2>&1 && journalctl --vacuum-size=200M >/dev/null 2>&1; command -v apt-get >/dev/null 2>&1 && apt-get clean >/dev/null 2>&1; true'
    steps=$((steps+1)); fi
  if has_code dockerdown; then act "запуск docker" systemctl restart docker; sleep 8; steps=$((steps+1)); fi
  # ── лечение по причинам (то, что нашла диагностика) ──
  if has_code pendingmig || has_code sig:pendingmig || has_code sig:schemaerr; then
    local pgp; pgp="$(envget POSTGRES_PASSWORD)"; detect_db
    if grep -q '^SKIP_MIGRATE_ON_START=1' "$APP_DIR/.env" 2>/dev/null; then
      act "миграции под владельцем БД (роль приложения схему менять не может)" dc run --rm --no-deps -e SKIP_MIGRATE_ON_START=0 -e "DATABASE_URL=postgres://${PGUSER_}:${pgp}@${DBSVC}:5432/${PGDB_}" api node scripts/migrate.mjs
    else act "применить недостающие миграции (одноразовый запуск образа api; только добавляют)" dc run --rm --no-deps api node scripts/migrate.mjs; fi
    steps=$((steps+1)); fi
  if has_code defblock; then
    if [ "$UNLOCK" = 1 ]; then act "снять ВСЕ блокировки адресов самозащитой" sql "DELETE FROM defense_ip_blocks"
    else act "снять блокировки «подбор путей» (остальные — по --unlock)" sql "DELETE FROM defense_ip_blocks WHERE reason ILIKE '%probing%' OR reason ILIKE '%подбор%'"; fi
    steps=$((steps+1)); fi
  if has_code fwlevel; then
    if [ "$UNLOCK" = 1 ]; then act "сбросить уровень файрвола на 0 (пока идёт атака — поднимется снова сам)" sql "UPDATE firewall_state SET level=0, pinned_until=NULL, reason='снято sky-heal --unlock', set_by=NULL, set_at=now()"; steps=$((steps+1))
    else say "  ⚠ файрвол на уровне 3–4 не трогаю без --unlock (если это не атака — повторите с --fix --unlock)"; fi; fi
  if has_code opsenv || has_code opsmismatch; then
    if [ "$FIXENV" = 1 ]; then
      if has_code opsenv; then act "перенести секрет агента в .env (значение не печатается)" ops_to_env
      elif has_code opsmismatch; then act "записать агенту секрет из .env (значение не печатается)" ops_to_agent; fi
      act "пересоздать api, чтобы он получил OPS_SECRET" dc up -d --force-recreate api; steps=$((steps+1))
    else say "  ⚠ рассинхрон OPS_SECRET: править .env можно только явно — повторите с --fix --fix-env"; fi; fi
  if has_code opsrecreate; then act "пересоздать api: контейнер создан до записи OPS_SECRET" dc up -d --force-recreate api; steps=$((steps+1)); fi
  if has_code sshgatemissing; then act "вернуть рабочую копию хука SSH-шлюза (ssh-gate.sh --sync)" bash "$SRC_DIR/scripts/ssh-gate.sh" --sync; steps=$((steps+1)); fi
  if has_code sshd; then local u=ssh; systemctl cat sshd >/dev/null 2>&1 && u=sshd; act "запуск службы $u (после проверки конфига)" bash -c "sshd -t && systemctl restart $u"; steps=$((steps+1)); fi
  have docker && docker info >/dev/null 2>&1 || { say "docker так и не ответил — дальше лечить нечем."; return 1; }
  quick_ok && { say "✔ после первых шагов всё в порядке"; return 0; }

  say "Ступень 1: docker compose up -d"; act "создать и запустить недостающие контейнеры" dc up -d
  wait_ok && { say "✔ помогло"; return 0; }

  say "Ступень 2: перезапуск неисправных контейнеров по одному"
  local bad svc; bad="$(dc ps -a --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null | awk '$1!="certbot" && ($2!="running" || ($3!="" && $3!="healthy")) {print $1}' | tr '\n' ' ')"
  for svc in "$DBSVC" redis api web; do case " $bad " in *" $svc "*) act "перезапуск $svc" dc restart "$svc"; sleep 5;; esac; done
  wait_ok && { say "✔ помогло"; return 0; }

  say "Ступень 3: перезапуск всего стека по порядку ($DBSVC → redis → api → web)"
  for svc in "$DBSVC" redis; do act "перезапуск $svc" dc restart "$svc"; done; sleep 10
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
  have docker && docker info >/dev/null 2>&1 && for svc in api web "$DBSVC"; do
    case " ${CRIT[*]:-} " in *"svc:$svc"*|*apihealth*|*web*|*sig:*) say "  Последние строки журнала $svc:"; dc logs --tail 12 "$svc" 2>&1 | mask | while IFS= read -r l; do say "    $l"; done;; esac
  done
}

json_out() { printf '{"time":"%s","host":"%s","ok":%d,"warn":%d,"fail":%d,"healed":%s}\n' "$(date -Is)" "$(hostname)" "${#OKS[@]}" "${#WARNS[@]}" "${#FAILS[@]}" "$1"; }

# ── запуск ──────────────────────────────────────────────────────────
actionable() { local c; for c in envperm repoperm disk defblock pendingmig opsrecreate opsenv opsmismatch sshgatemissing fwlevel sig:pendingmig sig:schemaerr sig:repoperm sig:diskfull; do has_code "$c" && return 0; done; return 1; }

if [ -n "$OPENSSH" ]; then   # открыть SSH-шлюз на время — для случая, когда API лежит и войти нельзя
  [ "$OPENSSH" -ge 1 ] && [ "$OPENSSH" -le 240 ] || { echo "--open-ssh: от 1 до 240 минут" >&2; exit 64; }
  [ "$(id -u)" = 0 ] || { echo "--open-ssh нужно запускать от root (консоль хостера)." >&2; exit 77; }
  if [ "$DRY" = 1 ]; then say "[dry] открыл бы SSH-шлюз на $OPENSSH мин"; else
    echo $(( $(date +%s) + OPENSSH * 60 )) > /etc/sky-ssh-gate.off && chmod 644 /etc/sky-ssh-gate.off
    say "SSH-шлюз открыт на $OPENSSH мин (до $(date -d "+$OPENSSH min" '+%F %T')), затем закроется сам. Войдите и чините: sky-heal --fix"; fi
  exit 0
fi

make_report() {
  local f="/tmp/sky-heal-report-$(date +%Y%m%d-%H%M%S).txt"
  { echo "# sky-heal report $(date -Is) $(hostname)"; echo "## git"; git -C "$SRC_DIR" log --oneline -3 2>/dev/null; echo "API_IMAGE=$(envget API_IMAGE)"
    echo "## compose ps"; dc ps -a 2>&1 | mask
    echo "## .env: заданы ли ключевые переменные (без значений)"; local k; for k in DOMAIN EMAIL_MODE SMTP_HOST EMAIL_FROM RESEND_API_KEY OPS_SECRET JWT_SECRET ENCRYPTION_KEY POSTGRES_PASSWORD REDIS_PASSWORD API_IMAGE SKIP_MIGRATE_ON_START; do printf '%s=%s\n' "$k" "$( [ -n "$(envget $k)" ] && echo задано || echo ПУСТО )"; done
    echo "## ресурсы"; df -h / 2>&1; free -m 2>&1; uptime 2>&1
    echo "## файрвол/самозащита"; sql "SELECT level, set_by, pinned_until FROM firewall_state"; sql "SELECT count(*) FROM defense_ip_blocks WHERE expires_at > now()"
    echo "## sky-ops"; systemctl is-active sky-ops 2>&1; journalctl -u sky-ops -n 15 --no-pager 2>&1 | mask
    for sv in api web "$DBSVC" redis; do echo "## logs $sv (60 строк)"; dc logs --no-color --tail 60 "$sv" 2>&1 | mask; done
    echo "## итог диагностики"; printf '%s\n' "${FAILS[@]:-}" | sed 's/^/FAIL: /'; printf '%s\n' "${WARNS[@]:-}" | sed 's/^/WARN: /'
  } > "$f" 2>&1; chmod 600 "$f"; echo "Отчёт: $f (без паролей и ключей; пришлите его целиком)"
}

check_all
if [ "$REPORT" = 1 ]; then make_report; fi
if [ "$MODE" = check ]; then
  [ "$JSON" = 1 ] && json_out false
  [ "${#FAILS[@]}" -eq 0 ] && exit 0; report_failures; exit 1
fi
if [ "${#FAILS[@]}" -eq 0 ] && ! actionable; then say "Лечить нечего."; [ "$JSON" = 1 ] && json_out true; exit 0; fi
if [ "$YES" != 1 ] && [ "$DRY" != 1 ]; then
  [ -t 0 ] || { echo "Нужно подтверждение: добавьте --yes (запуск без терминала)."; exit 64; }
  printf 'Начать лечение (перезапуски контейнеров, очистка кэша, миграции)? Базу и тома оно не удаляет. [y/N] '; read -r r; [ "$r" = y ] || [ "$r" = Y ] || { echo "Отменено."; exit 0; }
fi
say "── Лечение"
if heal; then rc=0; else rc=1; fi
say "── Повторная проверка"
check_all
if [ "${#FAILS[@]}" -eq 0 ]; then say "ГОТОВО: все критичные проверки зелёные."; [ "$JSON" = 1 ] && json_out true; exit 0; fi
report_failures
[ "$JSON" = 1 ] && json_out false
[ "$rc" = 0 ] && exit 2; exit 1
