#!/usr/bin/env bash
# Сторож хоста Sky: следит за кодом и конфигурацией ВНЕ Docker, докладывает API (подпись HMAC GUARD_SECRET) и выполняет
# только закрытый список команд, поставленных самозащитой. Зависимости: bash, openssl, curl, sha256sum, tar, (docker).
#   --baseline   запомнить эталон (после деплоя)      --once    одна проверка        --status    состояние
#   --install    systemd-таймер раз в минуту            --uninstall  снять
# Лечит: возвращает файлы эталона, пересоздаёт api/web, chmod 600 .env. Только сообщает: authorized_keys, cron, uid 0, порты.
set -uo pipefail
APP_DIR="${APP_DIR:-/opt/sky}"; STATE="${GUARD_STATE:-/var/lib/sky-guard}"; LOG="${GUARD_LOG:-/var/log/sky-guard.log}"
WATCH=(docker-compose.yml nginx scripts)   # относительно APP_DIR
log(){ echo "$(date -u +%FT%TZ) $*" >>"$LOG" 2>/dev/null || true; }
envval(){ grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
SECRET="${GUARD_SECRET:-$(envval GUARD_SECRET)}"
# Адрес API. Порт 8080 контейнера api на хост НЕ проброшен, поэтому 127.0.0.1:8080 обычно не отвечает: пробуем по порядку
# заданный GUARD_API → localhost → внутренний адрес контейнера api → публичный https://$DOMAIN (nginx проксирует /api/guard/).
resolve_api(){
  local c ip d
  for c in "${GUARD_API:-}" "http://127.0.0.1:8080"; do
    [ -n "$c" ] && curl -fsS -m 4 -o /dev/null "$c/healthz" 2>/dev/null && { echo "$c"; return; }
  done
  ip=$( cd "$APP_DIR" 2>/dev/null && docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$(docker compose ps -q api 2>/dev/null | head -1)" 2>/dev/null | awk '{print $1}')
  [ -n "$ip" ] && curl -fsS -m 4 -o /dev/null "http://$ip:8080/healthz" 2>/dev/null && { echo "http://$ip:8080"; return; }
  d=$(envval DOMAIN); [ -n "$d" ] && { echo "https://$d"; return; }
  echo "http://127.0.0.1:8080"
}
API="$(resolve_api)"
need(){ [ ${#SECRET} -ge 24 ] || { echo "GUARD_SECRET (>=24 знаков) не задан в $APP_DIR/.env" >&2; exit 2; }; }
sign_curl(){ # метод путь [тело]
  local m="$1" p="$2" b="${3:-}" ts; ts=$(date +%s)
  local h; h=$(printf '%s' "$b" | sha256sum | cut -d' ' -f1)
  local sig; sig=$(printf '%s\n%s\n%s\n%s' "$ts" "$m" "$p" "$h" | openssl dgst -sha256 -hmac "$SECRET" -r | cut -d' ' -f1)
  if [ "$m" = GET ]; then curl -fsS -m 15 -H "X-Guard-Ts: $ts" -H "X-Guard-Sig: $sig" "$API$p"
  else curl -fsS -m 15 -X "$m" -H 'Content-Type: application/json' -H "X-Guard-Ts: $ts" -H "X-Guard-Sig: $sig" --data-binary "$b" "$API$p"; fi
}
manifest(){ ( cd "$APP_DIR" && for w in "${WATCH[@]}"; do [ -e "$w" ] && find "$w" -type f -not -name '*.log' -print0; done | sort -z | xargs -0 sha256sum 2>/dev/null ); }
images(){ ( cd "$APP_DIR" && docker compose images -q 2>/dev/null | sort -u | tr '\n' ' ' ); }
tag(){ envval API_IMAGE; }
snapshot(){ mkdir -p "$STATE"; chmod 700 "$STATE"; manifest >"$STATE/manifest.txt"; images >"$STATE/images.txt"; tag >"$STATE/tag.txt"
  ( cd "$APP_DIR" && tar czf "$STATE/code.tgz" "${WATCH[@]}" 2>/dev/null ); chmod 600 "$STATE"/*; }
persist_sys(){ for f in /root/.ssh/authorized_keys; do [ -f "$f" ] && sha256sum "$f"; done; ls -la /etc/cron.d /var/spool/cron 2>/dev/null | sha256sum; awk -F: '$3==0{print $1}' /etc/passwd | sort | tr '\n' ' '; ss -tlnH 2>/dev/null | awk '{print $4}' | sort -u | tr '\n' ' '; }

heal_code(){ [ -f "$STATE/code.tgz" ] || return 1; ( cd "$APP_DIR" && tar xzf "$STATE/code.tgz" ) && chmod 600 "$APP_DIR/.env" 2>/dev/null; log "heal: код восстановлен из эталона"; }
recreate(){ ( cd "$APP_DIR" && docker compose up -d --force-recreate api web >>"$LOG" 2>&1 ); }

check(){ # печатает JSON findings
  local f=() cur; cur=$(mktemp); manifest >"$cur"
  if [ -f "$STATE/manifest.txt" ]; then
    # новый образ после деплоя = законное изменение: эталон переснимается автоматически
    if [ "$(tag)" != "$(cat "$STATE/tag.txt" 2>/dev/null)" ]; then snapshot; log "эталон обновлён (новая версия образа)"; rm -f "$cur"; echo '[]'; return; fi
    local chg; chg=$(diff "$STATE/manifest.txt" "$cur" | grep -c '^[<>]' || true)
    [ "${chg:-0}" -gt 0 ] && f+=("{\"kind\":\"integrity\",\"code\":\"files\",\"severity\":\"critical\",\"detail\":\"изменено файлов конфигурации/скриптов: $((chg/2+chg%2))\"}")
    [ -f "$STATE/images.txt" ] && [ "$(images)" != "$(cat "$STATE/images.txt")" ] && f+=("{\"kind\":\"integrity\",\"code\":\"images\",\"severity\":\"high\",\"detail\":\"набор образов контейнеров изменился без деплоя\"}")
  fi
  rm -f "$cur"
  [ "$(stat -c %a "$APP_DIR/.env" 2>/dev/null)" = 600 ] || f+=("{\"kind\":\"guard\",\"code\":\"env_perm\",\"severity\":\"high\",\"detail\":\".env доступен не только владельцу\",\"heal\":false}")
  local ps; ps=$(persist_sys | sha256sum | cut -c1-16); local old; old=$(cat "$STATE/persist.txt" 2>/dev/null || true)
  if [ -z "$old" ]; then echo "$ps" >"$STATE/persist.txt"; elif [ "$ps" != "$old" ]; then
    f+=("{\"kind\":\"guard\",\"code\":\"persistence\",\"severity\":\"high\",\"detail\":\"изменились ключи SSH, cron, учётные записи uid 0 или слушающие порты\",\"heal\":false}"); echo "$ps" >"$STATE/persist.txt"; fi
  local IFS=,; echo "[${f[*]:-}]"
}

run_cmd(){ local id="$1" kind="$2" ok=false msg=""
  case "$kind" in
    restore_code) heal_code && ok=true || msg="нет эталона";;
    recreate_containers) recreate && ok=true || msg="compose up не удался";;
    rotate_jwt) cp -n "$APP_DIR/.env" "$STATE/env.before-rotate" 2>/dev/null; chmod 600 "$STATE/env.before-rotate" 2>/dev/null
      local n; n=$(openssl rand -base64 48 | tr -d '\n'); if grep -q '^JWT_SECRET=' "$APP_DIR/.env"; then sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$n|" "$APP_DIR/.env"; else echo "JWT_SECRET=$n" >>"$APP_DIR/.env"; fi
      recreate && ok=true || msg="не перезапустился";;
    restore_jwt) [ -f "$STATE/env.before-rotate" ] && { old=$(grep '^JWT_SECRET=' "$STATE/env.before-rotate" | cut -d= -f2-); [ -n "$old" ] && sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$old|" "$APP_DIR/.env" && recreate && ok=true; } || msg="нет прежнего ключа";;
    *) msg="неизвестная команда";;
  esac
  sign_curl POST "/api/guard/commands/$id/result" "{\"ok\":$ok,\"text\":\"${msg:-ok}\"}" >/dev/null 2>&1 || true; log "команда $kind: $ok $msg"
}

once(){ need; mkdir -p "$STATE"; [ -f "$STATE/manifest.txt" ] || { snapshot; log "эталон создан"; }
  local fs; fs=$(check); local ok=true; [ "$fs" != "[]" ] && ok=false
  sign_curl POST /api/guard/report "{\"version\":\"1\",\"host\":\"$(hostname | cut -c1-50)\",\"baseline\":true,\"ok\":$ok,\"findings\":$fs}" >/dev/null 2>&1 || log "API недоступен для отчёта"
  local cmds; cmds=$(sign_curl GET /api/guard/commands 2>/dev/null || echo '{"commands":[]}')
  # команды разбираем без jq: id и kind — строки из безопасного алфавита
  echo "$cmds" | { grep -oE '\{"id":"[A-Za-z0-9-]+","kind":"[a-z_]+"' | while IFS= read -r l; do
    id=$(echo "$l" | sed -E 's/.*"id":"([^"]+)".*/\1/'); kind=$(echo "$l" | sed -E 's/.*"kind":"([^"]+)".*/\1/'); run_cmd "$id" "$kind"; done; }
  return 0
}
case "${1:-}" in
  --baseline) need; snapshot; log "эталон создан вручную"; echo "эталон сохранён в $STATE";;
  --once|"") once;;
  --status) echo "эталон: $( [ -f "$STATE/manifest.txt" ] && stat -c %y "$STATE/manifest.txt" || echo нет )"; echo "последние записи:"; tail -5 "$LOG" 2>/dev/null;;
  --install) need; install -m 755 "$0" /usr/local/sbin/sky-guard
    cat >/etc/systemd/system/sky-guard.service <<U
[Unit]
Description=Sky host guard
[Service]
Type=oneshot
Environment=APP_DIR=$APP_DIR
ExecStart=/usr/local/sbin/sky-guard --once
U
    cat >/etc/systemd/system/sky-guard.timer <<U
[Unit]
Description=Sky host guard every minute
[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=5s
[Install]
WantedBy=timers.target
U
    systemctl daemon-reload && systemctl enable --now sky-guard.timer && /usr/local/sbin/sky-guard --baseline && echo "сторож установлен";;
  --uninstall) systemctl disable --now sky-guard.timer 2>/dev/null; rm -f /etc/systemd/system/sky-guard.* /usr/local/sbin/sky-guard; systemctl daemon-reload; echo "снят (эталон в $STATE оставлен)";;
  *) echo "использование: $0 [--baseline|--once|--status|--install|--uninstall]"; exit 1;;
esac
