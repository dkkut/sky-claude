#!/bin/bash
# =====================================================================
#  Защита входа по SSH (Sky) — крючок PAM для sshd.
#
#  Режим token (по умолчанию): при входе с терминала спрашивается @ник и личный токен администратора (SKA-…). Пускает только владельца и тех,
#  кому владелец выдал доступ к SSH в админке. Владельцу сразу приходит сообщение от Sky, и 25 минут он может отменить вход («Это не я») —
#  сессия на сервере обрывается. Соединения без терминала (scp/sftp) проходят только как параллельные к недавнему входу с терминала.
#  Режим owner: каждый вход ждёт, пока владелец откроет ссылку из письма и введёт код аутентификатора (как вход в панель администратора).
#
#  Установка (один раз, под root):  sudo bash scripts/ssh-gate.sh --install
#  Отключить:                       sudo bash scripts/ssh-gate.sh --uninstall
#  Аварийно (с консоли хостера):    sudo touch /etc/sky-ssh-gate.off
#                                   (пустой файл — бессрочно; число секунд Unix внутри — шлюз выключен до этого момента и затем включается сам:
#                                    echo $(( $(date +%s) + 1800 )) | sudo tee /etc/sky-ssh-gate.off)
#  Обновить рабочую копию хука:     sudo bash scripts/ssh-gate.sh --sync   (после проверки синтаксиса и самопроверки; деплой делает это сам)
#  Состояние / самопроверка:        sudo bash scripts/ssh-gate.sh --status | --selftest
#  Запасной вход без API и почты:   sudo bash scripts/ssh-gate.sh --totp-setup   (отдельный секрет на сервере, 6-значный код приложения)
#
#  Хук PAM запускается из /usr/local/sbin/sky-ssh-gate (копия), а не из папки репозитория: «git pull» больше не меняет живой хук
#  без проверки. Старые установки (PAM смотрит в репозиторий) переходят на копию повторным «--install».
#
#  Конфиг /etc/sky-ssh-gate.conf (root, 600):
#     SKY_API=https://web.skymessenger.online     # адрес API
#     SKY_SECRET=...                               # тот же, что SSH_GATE_SECRET в .env сервера (от 24 знаков)
#     SKY_TIMEOUT=300                              # сколько ждать подтверждения, сек
#     SKY_MODE=token                               # token (по умолчанию): @ник + личный токен администратора, владелец получает уведомление и 25 минут
#                                                  #   может отменить вход («Это не я»); owner: владелец подтверждает ссылкой из письма ДО входа;
#                                                  #   both: сначала токен администратора, потом ещё и подтверждение владельца (самый строгий)
#     SKY_FAILOPEN=0                               # 1 — пускать, если API недоступен (небезопасно)
#
#  Если API или почта недоступны, а SKY_FAILOPEN=0, вход закрыт, КРОМЕ запасного пути: если настроен /etc/sky-ssh-gate.totp
#  (--totp-setup), шлюз просит 6-значный код приложения-аутентификатора, проверяет его сам на сервере (без API и почты),
#  не принимает повтор кода, блокирует после 5 неверных на 15 минут и пишет вход в syslog. Явный отказ владельца и рубильник
#  («paused») запасным кодом НЕ обходятся. Иначе — только консоль хостера или «touch /etc/sky-ssh-gate.off».
# =====================================================================
set -u
CONF="${SKY_GATE_CONF:-/etc/sky-ssh-gate.conf}"
OFF="${SKY_GATE_OFF:-/etc/sky-ssh-gate.off}"
INST="${SKY_GATE_INSTALLED:-/usr/local/sbin/sky-ssh-gate}"
LTOTP="${SKY_GATE_TOTP:-/etc/sky-ssh-gate.totp}"
SELF="$(readlink -f "$0")"

# Файл отключения: пустой — бессрочно; число (секунды Unix) — до этого момента, потом шлюз включается сам.
gate_is_off() {
  [ -e "$OFF" ] || return 1
  local v; v="$(head -c 20 "$OFF" 2>/dev/null | tr -d '[:space:]')"
  case "$v" in ''|*[!0-9]*) return 0 ;; esac
  [ "$(date +%s)" -lt "$v" ] && return 0
  rm -f "$OFF" 2>/dev/null; logger -t sky-ssh-gate "срок временного отключения шлюза истёк — шлюз включён"
  return 1
}

# ── TOTP на сервере (запасной вход без API и почты) ──
secret_hex() {  # файл с секретом base32 → hex
  local s; s="$(tr -d ' \r\n\t-' < "$1" 2>/dev/null | tr 'a-z' 'A-Z' | tr -cd 'A-Z2-7')"
  [ "${#s}" -ge 16 ] || return 1
  while [ $(( ${#s} % 8 )) -ne 0 ]; do s="${s}="; done
  printf '%s' "$s" | base32 -d 2>/dev/null | od -An -v -tx1 | tr -d ' \n'
}
totp_at() {  # hex-ключ, шаг → 6 цифр (RFC 6238, SHA-1, 30 с)
  local fmt h off v
  fmt="$(printf '%016x' "$2" | sed 's/../\\x&/g')"
  h="$(printf "$fmt" | openssl dgst -sha1 -mac HMAC -macopt "hexkey:$1" -hex 2>/dev/null | awk '{print $NF}')"
  [ "${#h}" -eq 40 ] || return 1
  off=$(( 16#${h:39:1} ))
  v=$(( (16#${h:off*2:8}) & 0x7fffffff ))
  printf '%06d' $(( v % 1000000 ))
}

if [ "${1:-}" = "--selftest" ]; then
  bad=0
  for c in openssl base32 od curl logger; do command -v "$c" >/dev/null 2>&1 && echo "  ok   $c" || { echo "  FAIL нет $c"; bad=1; }; done
  bash -n "$SELF" && echo "  ok   синтаксис" || { echo "  FAIL синтаксис"; bad=1; }
  K="$(printf 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' > /tmp/.sky-gate-st.$$; secret_hex /tmp/.sky-gate-st.$$)"; rm -f /tmp/.sky-gate-st.$$
  [ "$(totp_at "$K" 1)" = "287082" ] && echo "  ok   TOTP (вектор RFC 6238)" || { echo "  FAIL TOTP не совпал с вектором RFC 6238"; bad=1; }
  exit $bad
fi

if [ "${1:-}" = "--totp-setup" ]; then
  [ "$(id -u)" = 0 ] || { echo "Нужен root" >&2; exit 1; }
  command -v base32 >/dev/null 2>&1 && command -v openssl >/dev/null 2>&1 || { echo "Нужны base32 и openssl" >&2; exit 1; }
  if [ -s "$LTOTP" ] && [ "${2:-}" != "--regen" ]; then echo "Секрет уже задан ($LTOTP). Новый: $0 --totp-setup --regen"; exit 0; fi
  SEC="$(openssl rand 20 | base32 | tr -d '=\n')"
  umask 077; printf '%s\n' "$SEC" > "$LTOTP"; chmod 600 "$LTOTP"
  echo "Запасной секрет входа по SSH создан: $LTOTP (root, 600)."
  echo "Добавьте в приложение-аутентификатор КАК ОТДЕЛЬНУЮ запись (не вместо кода Sky ID), покажется один раз:"
  echo "  секрет:  $SEC"
  echo "  адрес:   otpauth://totp/Sky-SSH-reserve?secret=$SEC&issuer=Sky"
  command -v qrencode >/dev/null 2>&1 && qrencode -t ANSIUTF8 "otpauth://totp/Sky-SSH-reserve?secret=$SEC&issuer=Sky"
  echo "Секрет на сервере лежит открыто для root (как и сам шлюз); не копируйте его в чаты и письма. Проверка: $0 --selftest"
  exit 0
fi

if [ "${1:-}" = "--status" ]; then
  [ -f /etc/pam.d/sshd ] && grep -q 'ssh-gate' /etc/pam.d/sshd && echo "PAM: $(grep 'ssh-gate' /etc/pam.d/sshd | head -1)" || echo "PAM: шлюз не подключён"
  if [ -f "$INST" ]; then cmp -s "$INST" "$SELF" && echo "копия хука: $INST — совпадает с этим файлом" || echo "копия хука: $INST — ОТЛИЧАЕТСЯ от этого файла (bash $SELF --sync)"; else echo "копия хука: нет ($INST) — bash $SELF --install"; fi
  if [ -e "$OFF" ]; then v="$(head -c 20 "$OFF" | tr -d '[:space:]')"; case "$v" in ''|*[!0-9]*) echo "файл отключения: ЕСТЬ, бессрочно ($OFF) — шлюз выключен";; *) echo "файл отключения: до $(date -d "@$v" '+%F %T')";; esac; else echo "файл отключения: нет (шлюз включён)"; fi
  [ -r "$LTOTP" ] && echo "запасной код на сервере: настроен" || echo "запасной код на сервере: НЕ настроен ($0 --totp-setup)"
  [ -r /etc/sky-rescue.user ] && echo "аварийный пользователь: $(head -n1 /etc/sky-rescue.user)" || echo "аварийный пользователь: не настроен (scripts/rescue-access.sh)"
  [ -r "$CONF" ] && { . "$CONF"; echo "режим: ${SKY_MODE:-token}, failopen: ${SKY_FAILOPEN:-0}"; curl -sS -m 6 -o /dev/null -w "API ${SKY_API:-?}: HTTP %{http_code}\n" "${SKY_API%/}/healthz" 2>&1 | tail -1; } || echo "конфиг: нет ($CONF)"
  exit 0
fi

# Рабочая копия хука: проверка синтаксиса и самопроверка ДО подмены; старая копия остаётся, если новая не прошла.
install_copy() {
  [ "$SELF" = "$(readlink -f "$INST" 2>/dev/null)" ] && return 0
  bash -n "$SELF" || { echo "ОШИБКА: в $SELF синтаксическая ошибка — рабочая копия не тронута." >&2; return 1; }
  bash "$SELF" --selftest >/dev/null 2>&1 || { echo "ОШИБКА: самопроверка нового хука не прошла (bash $SELF --selftest) — рабочая копия не тронута." >&2; return 1; }
  mkdir -p "$(dirname "$INST")" && install -m 755 -o root -g root "$SELF" "$INST.new" && mv -f "$INST.new" "$INST"
}

if [ "${1:-}" = "--sync" ]; then
  [ "$(id -u)" = 0 ] || { echo "Нужен root" >&2; exit 1; }
  grep -qs "$INST" /etc/pam.d/sshd || { echo "PAM смотрит не на $INST — выполните: sudo bash $SELF --install (держите второй терминал открытым)." >&2; exit 1; }
  install_copy && echo "Рабочая копия хука обновлена: $INST" || exit 1
  exit 0
fi

if [ "${1:-}" = "--install" ] || [ "${1:-}" = "--uninstall" ]; then
  [ "$(id -u)" = 0 ] || { echo "Нужен root" >&2; exit 1; }
  PAM=/etc/pam.d/sshd
  LINE="session requisite pam_exec.so quiet $INST"
  # прежние строки (репозиторный путь, копия) удаляем любые: .../ssh-gate.sh и .../sky-ssh-gate
  if [ "$1" = "--uninstall" ]; then
    sed -i '\#pam_exec.so quiet .*ssh-gate\(\.sh\)\?$#d' "$PAM"; echo "Шлюз SSH отключён (строка убрана из $PAM)."; exit 0
  fi
  [ -f "$CONF" ] || { echo "Нет $CONF — создайте его (см. шапку скрипта) и запустите ещё раз." >&2; exit 1; }
  chmod 600 "$CONF"
  install_copy || exit 1
  grep -qs "UsePAM yes" /etc/ssh/sshd_config /etc/ssh/sshd_config.d/* 2>/dev/null || echo "ВНИМАНИЕ: в sshd_config должно быть «UsePAM yes»." >&2
  # Шлюз ставим ПЕРВЫМ среди session-строк и как requisite: отказ шлюза сразу обрывает вход, и ssh-login-hook.sh
  # (письмо «подтвердите после входа») для отказанного входа не запускается. Прежняя строка required (если была) заменяется.
  sed -i '\#pam_exec.so quiet .*ssh-gate\(\.sh\)\?$#d' "$PAM"
  if grep -n '^session' "$PAM" >/dev/null 2>&1; then
    FIRST="$(grep -n '^session' "$PAM" | head -1 | cut -d: -f1)"; sed -i "${FIRST}i $LINE" "$PAM"
  else echo "$LINE" >> "$PAM"; fi
  echo "Готово. Откройте ВТОРОЙ терминал и проверьте вход ДО закрытия текущей сессии."
  echo "Если что-то не так: sudo touch $OFF (или с консоли хостера: bash $SELF --uninstall)."
  [ -r "$LTOTP" ] || echo "Совет: запасной вход без API и почты — sudo bash $SELF --totp-setup"
  exit 0
fi

# ── сторож сессии (запускается из крючка в фоне): 25 минут спрашивает API, не отменил ли владелец вход ──
if [ "${1:-}" = "--watch" ]; then
  W_ID="${2:-}"; W_POLL="${3:-}"; W_PID="${4:-}"; W_TTY="${5:-}"
  [ -r "$CONF" ] || exit 0
  # shellcheck disable=SC1090
  . "$CONF"
  [ -n "${SKY_API:-}" ] && [ -n "$W_ID" ] && [ -n "$W_POLL" ] || exit 0
  W_END=$(( $(date +%s) + 1560 ))   # 26 минут: окно владельца 25 + запас
  while [ "$(date +%s)" -lt "$W_END" ]; do
    sleep 5
    # сессия закончилась сама — следить больше не за кем
    [ -n "$W_PID" ] && ! kill -0 "$W_PID" 2>/dev/null && exit 0
    R="$(curl -sS -m 8 -H 'Content-Type: application/json' -X POST -d "{\"id\":\"$W_ID\",\"poll\":\"$W_POLL\"}" "${SKY_API%/}/api/ssh-gate/watch" 2>/dev/null)"
    ST="$(printf '%s' "$R" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
    case "$ST" in
      revoked)
        logger -t sky-ssh-gate "вход отменён владельцем («Это не я»): сессия обрывается"
        [ -n "$W_TTY" ] && printf '\r\n  ✖ Владелец отменил этот вход. Сессия закрыта.\r\n' >> "$W_TTY" 2>/dev/null
        TT="${W_TTY#/dev/}"
        [ -n "$TT" ] && pkill -KILL -t "$TT" 2>/dev/null
        if [ -n "$W_PID" ] && ps -o comm= -p "$W_PID" 2>/dev/null | grep -q sshd; then kill -TERM "$W_PID" 2>/dev/null; sleep 1; kill -KILL "$W_PID" 2>/dev/null; fi
        exit 0 ;;
      ended|unknown) exit 0 ;;
    esac
  done
  exit 0
fi

# ── крючок PAM ──────────────────────────────────────────────────────
[ "${PAM_TYPE:-}" = "open_session" ] || exit 0
[ "${PAM_SERVICE:-}" = "sshd" ] || exit 0
gate_is_off && exit 0
# Аварийный пользователь (scripts/rescue-access.sh): у него нет оболочки, только короткий список команд (ForceCommand).
# Исключение действует, ТОЛЬКО если sshd для него реально применяет ForceCommand — иначе обычный вход с подтверждением.
RESCUE_U="$(head -n1 /etc/sky-rescue.user 2>/dev/null)"
if [ -n "$RESCUE_U" ] && [ "${PAM_USER:-}" = "$RESCUE_U" ]; then
  # PATH внутри PAM урезан — ищем sshd по полным путям.
  SSHD="$(command -v sshd 2>/dev/null || true)"; [ -x "${SSHD:-}" ] || SSHD=/usr/sbin/sshd
  if [ "$(stat -c %U /etc/sky-rescue.user 2>/dev/null)" != root ]; then logger -t sky-ssh-gate "rescue: файл /etc/sky-rescue.user не принадлежит root — исключение не действует"
  elif ! "$SSHD" -T -C "user=$RESCUE_U,host=localhost,addr=127.0.0.1" 2>/dev/null | grep -qi '^forcecommand /usr/local/sbin/sky-rescue-shell$'; then logger -t sky-ssh-gate "rescue: ForceCommand для $RESCUE_U не применён — исключение не действует (обычное подтверждение)"
  else logger -t sky-ssh-gate "аварийный пользователь $RESCUE_U: вход без подтверждения (ForceCommand)"; exit 0; fi
fi
[ -r "$CONF" ] || exit 1      # конфига нет — закрыто, а не открыто
# shellcheck disable=SC1090
. "$CONF"
: "${SKY_TIMEOUT:=300}" "${SKY_FAILOPEN:=0}" "${SKY_REUSE_SEC:=120}"
[ -n "${SKY_API:-}" ] && [ "${#SKY_SECRET}" -ge 24 ] || exit 1

clean() { printf '%s' "$1" | tr -cd 'A-Za-z0-9._:@/-' | cut -c1-"$2"; }
U="$(clean "${PAM_USER:-}" 40)"; R="$(clean "${PAM_RHOST:-}" 60)"; T="$(clean "${PAM_TTY:-}" 40)"; H="$(clean "$(hostname)" 80)"
# Параллельные соединения одного клиента (Termius открывает терминал, SFTP, статистику отдельными подключениями) не должны
# спрашивать подтверждение заново: пока идёт первое — остальные ждут его, а после одобрения тот же пользователь с того же адреса
# проходит ещё SKY_REUSE_SEC секунд (0 — выключено, каждое соединение подтверждается отдельно).
REUSE="${SKY_GATE_REUSE:-/opt/sky/control/ssh-gate-reuse}"; LOCKF="${REUSE}.lock"; MARK="${SKY_GATE_MARK:-/opt/sky/control/ssh-gate-approved}"
if [ "$SKY_REUSE_SEC" -gt 0 ] 2>/dev/null && command -v flock >/dev/null 2>&1 && mkdir -p "$(dirname "$REUSE")" 2>/dev/null; then
  exec 9>"$LOCKF" 2>/dev/null && flock -w "$SKY_TIMEOUT" 9 2>/dev/null || true
  if [ -r "$REUSE" ]; then
    read -r R_TS R_USER R_RHOST < "$REUSE" 2>/dev/null || true
    if [ "${R_USER:-}" = "$U" ] && [ "${R_RHOST:-}" = "$R" ] && [ -n "$R" ] && [ "$(( $(date +%s) - ${R_TS:-0} ))" -le "$SKY_REUSE_SEC" ] 2>/dev/null; then
      logger -t sky-ssh-gate "вход $U@$R: подтверждение уже есть (параллельное соединение, ≤${SKY_REUSE_SEC} с)"; exit 0
    fi
  fi
fi
TS="$(date +%s)"
: "${SKY_MODE:=token}"
SIG="$(printf '%s\n%s\n%s\n%s\n%s' "$TS" "$U" "$H" "$R" "$T" | openssl dgst -sha256 -hmac "$SKY_SECRET" -hex | awk '{print $NF}')"
api() { curl -sS -m 10 -H 'Content-Type: application/json' -X POST -d "$2" "${SKY_API%/}$1" 2>/dev/null; }
field() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }

# Терминал человека (sshd кладёт его в PAM_TTY: /dev/pts/N или pts/N; у scp/sftp терминала нет).
TTYDEV="${SKY_GATE_TTY:-}"
if [ -z "$TTYDEV" ]; then
  case "${PAM_TTY:-}" in
    /dev/*) TTYDEV="$PAM_TTY" ;;
    pts/*|tty*) TTYDEV="/dev/$PAM_TTY" ;;
  esac
fi
# sshd кладёт в PAM_TTY не устройство, а слово «ssh», пока сессия открывается (так и было: хук считал, что терминала нет, и не спрашивал ничего).
# Тогда ищем терминал по заголовку процесса sshd этого соединения: «sshd: USER@pts/N» (у OpenSSH 9.8+ — «sshd-session: …»), он дочерний к нашему родителю.
find_tty() {
  [ -n "${PPID:-}" ] || return 1
  local pp up line pid ppid args pts best=""
  pp="$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')"
  while read -r pid ppid args; do
    case "$args" in "sshd: "*"@pts/"*|"sshd-session: "*"@pts/"*) ;; *) continue ;; esac
    case "$args" in *"$U@"*|*"${PAM_USER:-$U}@"*) ;; *) continue ;; esac
    [ "$ppid" = "$PPID" ] || [ "$pid" = "$PPID" ] || { [ -n "$pp" ] && { [ "$ppid" = "$pp" ] || [ "$pid" = "$pp" ]; }; } || continue
    pts="$(printf '%s' "$args" | sed -n 's/.*@\(pts\/[0-9][0-9]*\).*/\1/p')"
    [ -c "/dev/$pts" ] && best="/dev/$pts"
  done < <(ps -eo pid=,ppid=,args= 2>/dev/null | sort -n)
  [ -n "$best" ] && { printf '%s' "$best"; return 0; }
  return 1
}
if [ -z "$TTYDEV" ] && [ -z "${SKY_GATE_TTY:-}" ]; then
  TTYDEV="$(find_tty 2>/dev/null || true)"
  [ -n "$TTYDEV" ] && logger -t sky-ssh-gate "терминал найден по процессу sshd: $TTYDEV (PAM_TTY=${PAM_TTY:-пусто})"
fi
say() { [ -n "$TTYDEV" ] && { [ -c "$TTYDEV" ] || [ -n "${SKY_GATE_TTY:-}" ]; } && printf '%b' "$1" >> "$TTYDEV" 2>/dev/null; return 0; }

# ── запасной вход: код приложения-аутентификатора, проверяется на самом сервере (без API и почты) ──
# Предлагается, только когда проверка Sky недоступна (API не отвечает, почта не доходит, владелец не успел). Явный отказ владельца
# и рубильник («paused») им не обходятся. Повтор кода не принимается, 5 неверных за 15 минут — блок на 15 минут.
local_fallback() {  # причина
  [ -r "$LTOTP" ] || return 1
  [ -n "$TTYDEV" ] && { [ -c "$TTYDEV" ] || [ -n "${SKY_GATE_TTY:-}" ]; } || return 1
  command -v base32 >/dev/null 2>&1 && command -v openssl >/dev/null 2>&1 || return 1
  local KEYHEX; KEYHEX="$(secret_hex "$LTOTP")" || { logger -t sky-ssh-gate "запасной код: секрет в $LTOTP не разбирается"; return 1; }
  local DIR; DIR="$(dirname "$REUSE")"; mkdir -p "$DIR" 2>/dev/null
  local FAILF="${SKY_GATE_TOTP_FAIL:-$DIR/ssh-gate-totp-fail}" LASTF="${SKY_GATE_TOTP_LAST:-$DIR/ssh-gate-totp-last}"
  local now cnt first; now="$(date +%s)"
  read -r cnt first < "$FAILF" 2>/dev/null || { cnt=0; first=$now; }
  [ $(( now - ${first:-0} )) -gt 900 ] && { cnt=0; first=$now; }
  if [ "${cnt:-0}" -ge 5 ]; then say "\r\n  ✖ Слишком много неверных кодов. Запасной вход закрыт на 15 минут.\r\n"; logger -t sky-ssh-gate "запасной код: блок после неверных попыток ($U@$R)"; return 1; fi
  exec 7<>"$TTYDEV" 2>/dev/null || return 1
  say "\r\n  ⚠ $1.\r\n  Запасной вход: введите 6-значный код из приложения-аутентификатора (запись «Sky-SSH-reserve»).\r\n"
  local TRY v code step d last
  for TRY in 1 2 3; do
    say "  Код: "; stty -F "$TTYDEV" -echo 2>/dev/null
    v=""; IFS= read -r -t 120 -u 7 v || v=""
    stty -F "$TTYDEV" echo 2>/dev/null; say "\r\n"
    code="$(printf '%s' "$v" | tr -cd '0-9' | cut -c1-6)"
    if [ "${#code}" -eq 6 ]; then
      step=$(( $(date +%s) / 30 )); last="$(cat "$LASTF" 2>/dev/null || echo 0)"; case "$last" in ''|*[!0-9]*) last=0;; esac
      for d in 0 -1 1; do
        if [ "$(totp_at "$KEYHEX" $(( step + d )))" = "$code" ] && [ $(( step + d )) -gt "$last" ]; then
          printf '%s\n' $(( step + d )) > "$LASTF"; chmod 600 "$LASTF" 2>/dev/null; rm -f "$FAILF"
          logger -t sky-ssh-gate "вход $U@$R по запасному коду (причина: $1)"
          { mkdir -p "$(dirname "$MARK")" && printf '%s %s %s\n' "$(date +%s)" "${PAM_USER:-}" "${PAM_RHOST:-}" > "$MARK" && chmod 600 "$MARK"; } 2>/dev/null
          [ "$SKY_REUSE_SEC" -gt 0 ] 2>/dev/null && { printf '%s %s %s\n' "$(date +%s)" "$U" "$R" > "$REUSE" && chmod 600 "$REUSE"; } 2>/dev/null
          say "\r\n  ✔ Запасной код принят. Вход записан в журнал сервера (владелец не уведомлён — проверьте почту/API).\r\n\r\n"; exec 7>&-; return 0
        fi
      done
    fi
    cnt=$(( cnt + 1 )); printf '%s %s\n' "$cnt" "$first" > "$FAILF"; chmod 600 "$FAILF" 2>/dev/null
    say "  ✖ Не подошло. Попытка $TRY из 3.\r\n"
    [ "$cnt" -ge 5 ] && break
  done
  exec 7>&-; logger -t sky-ssh-gate "запасной код: вход $U@$R не подошёл"; return 1
}

# ── режим both: ОДНА страница. Терминал ничего не спрашивает (и не нужен): владельцу уходит письмо со ссылкой, на странице он вводит
#    личный токен администратора и код аутентификатора. Работает и для scp/sftp/команд без терминала. ──
if [ "$SKY_MODE" = "both" ]; then
  RES="$(api /api/ssh-gate/login "{\"ts\":\"$TS\",\"user\":\"$U\",\"host\":\"$H\",\"rhost\":\"$R\",\"tty\":\"$T\",\"sig\":\"$SIG\",\"page\":true}")"
  ID="$(field "$RES" id)"; POLL="$(field "$RES" poll)"
  if [ -z "$ID" ] || [ -z "$POLL" ]; then
    case "$RES" in
      *paused*) say "  ✖ Новые входы по SSH закрыты владельцем.\r\n"; logger -t sky-ssh-gate "вход $U@$R закрыт: рубильник"; exit 1 ;;
      ""|"<"*) if [ "$SKY_FAILOPEN" = "1" ]; then logger -t sky-ssh-gate "API недоступен, SKY_FAILOPEN=1: вход $U пропущен"; exit 0; fi
          local_fallback "Сервер проверки Sky недоступен" && exit 0
          say "  ✖ Сервер проверки недоступен. Вход закрыт.\r\n"; logger -t sky-ssh-gate "вход $U@$R закрыт: API недоступен"; exit 1 ;;
      *email_failed*|*email_required*|*two_factor_required*|*public_url_missing*|*owner_missing*) local_fallback "Письмо владельцу отправить не удалось" && exit 0 ;;
    esac
    say "  ✖ Вход закрыт.\r\n"; logger -t sky-ssh-gate "вход $U@$R закрыт: ${RES:-пустой ответ}"; exit 1
  fi
  logger -t sky-ssh-gate "вход $U@$R: ждём подтверждения владельца на странице (токен + код)"
  say "\r\n  Sky · защищённый вход\r\n  ────────────────────────────────────\r\n  Ничего вводить здесь не нужно. Владелец открывает ссылку из письма\r\n  и подтверждает вход токеном администратора и кодом аутентификатора.\r\n\r\n"
fi

# ── режим token: @ник и токен администратора на терминале ──
if [ "$SKY_MODE" = "token" ]; then
  if [ -z "$TTYDEV" ] || { [ ! -c "$TTYDEV" ] && [ -z "${SKY_GATE_TTY:-}" ]; }; then
    logger -t sky-ssh-gate "вход $U@$R закрыт: нет терминала для токена (PAM_TTY=${PAM_TTY:-пусто}; scp/sftp/команда без tty проходят только как параллельные к недавнему входу)"
    exit 1
  fi
  exec 8<>"$TTYDEV" || { logger -t sky-ssh-gate "вход $U@$R закрыт: терминал недоступен"; exit 1; }
  ask() {  # приглашение, секретность(0/1)
    say "$1"
    [ "$2" = 1 ] && stty -F "$TTYDEV" -echo 2>/dev/null
    local v=""; IFS= read -r -t 120 -u 8 v || v=""
    [ "$2" = 1 ] && { stty -F "$TTYDEV" echo 2>/dev/null; say "\r\n"; }
    printf '%s' "$v" | tr -d '\r'
  }
  if [ "$SKY_MODE" = "both" ]; then CONFIRM_JSON=',"confirm":true'; HINT="Вход по токену администратора и подтверждению владельца."; else CONFIRM_JSON=""; HINT="Вход по токену администратора. Владелец получит уведомление."; fi
  say "\r\n  Sky · защищённый вход\r\n  ────────────────────────────────────\r\n  $HINT\r\n\r\n"
  ID=""; POLL=""
  for TRY in 1 2 3; do
    NICK="$(ask "  Ваш @ник в Sky: " 0 | tr -cd 'A-Za-z0-9_@.-' | cut -c1-40)"
    TOK="$(ask "  Токен администратора: " 1 | tr -cd 'A-Za-z0-9-' | cut -c1-40)"
    [ -n "$NICK" ] && [ -n "$TOK" ] || { say "  ✖ Нужны @ник и токен.\r\n"; continue; }
    RES="$(api /api/ssh-gate/login "{\"ts\":\"$TS\",\"user\":\"$U\",\"host\":\"$H\",\"rhost\":\"$R\",\"tty\":\"$T\",\"sig\":\"$SIG\",\"nick\":\"$NICK\",\"token\":\"$TOK\"$CONFIRM_JSON}")"
    ID="$(field "$RES" id)"; POLL="$(field "$RES" poll)"
    TOK=""
    [ -n "$ID" ] && [ -n "$POLL" ] && break
    case "$RES" in
      *paused*) say "  ✖ Новые входы по SSH закрыты владельцем.\r\n"; logger -t sky-ssh-gate "вход $U@$R закрыт: рубильник"; exit 1 ;;
      *email_failed*|*email_required*|*two_factor_required*|*public_url_missing*|*owner_missing*) if [ "$SKY_MODE" = "both" ]; then exec 8>&-; local_fallback "Письмо владельцу отправить не удалось" && exit 0; say "  ✖ Письмо владельцу не отправлено. Вход закрыт.\r\n"; logger -t sky-ssh-gate "вход $U@$R закрыт: $RES"; exit 1; fi ;;
      ""|"<"*) if [ "$SKY_FAILOPEN" = "1" ]; then logger -t sky-ssh-gate "API недоступен, SKY_FAILOPEN=1: вход $U пропущен"; exit 0; fi
          exec 8>&-
          local_fallback "Сервер проверки Sky недоступен" && exit 0
          say "  ✖ Сервер проверки недоступен. Вход закрыт.\r\n"; logger -t sky-ssh-gate "вход $U@$R закрыт: API недоступен"; exit 1 ;;
    esac
    say "  ✖ Не подошло. Попытка $TRY из 3.\r\n"
    TS="$(date +%s)"; SIG="$(printf '%s\n%s\n%s\n%s\n%s' "$TS" "$U" "$H" "$R" "$T" | openssl dgst -sha256 -hmac "$SKY_SECRET" -hex | awk '{print $NF}')"
  done
  if [ -z "$ID" ] || [ -z "$POLL" ]; then logger -t sky-ssh-gate "вход $U@$R закрыт: токен не принят"; say "\r\n  ✖ Вход закрыт.\r\n"; exit 1; fi
  if [ "$SKY_MODE" = "both" ]; then
    # Токен принят — дальше ждём подтверждения владельца (общий цикл ниже), как в режиме owner.
    logger -t sky-ssh-gate "вход $U@$R: токен принят, ждём подтверждения владельца"
    exec 8>&-
  else
  logger -t sky-ssh-gate "вход $U@$R по токену принят; владельцу отправлено уведомление (окно отмены 25 минут)"
  MARK="${SKY_GATE_MARK:-/opt/sky/control/ssh-gate-approved}"
  { mkdir -p "$(dirname "$MARK")" && printf '%s %s %s\n' "$(date +%s)" "${PAM_USER:-}" "${PAM_RHOST:-}" > "$MARK" && chmod 600 "$MARK"; } 2>/dev/null
  [ "$SKY_REUSE_SEC" -gt 0 ] 2>/dev/null && { printf '%s %s %s\n' "$(date +%s)" "$U" "$R" > "$REUSE" && chmod 600 "$REUSE"; } 2>/dev/null
  # Сторож сессии: следит 25 минут, не отменит ли владелец вход (отдельный процесс, не держит PAM).
  nohup setsid "$SELF" --watch "$ID" "$POLL" "${PPID:-}" "${TTYDEV:-}" >/dev/null 2>&1 </dev/null &
  say "\r\n  ✔ Вход принят. Владельцу отправлено уведомление — 25 минут он может его отменить.\r\n\r\n"
  exec 8>&-
  exit 0
  fi
fi

if [ -z "${ID:-}" ]; then
RES="$(api /api/ssh-gate/request "{\"ts\":\"$TS\",\"user\":\"$U\",\"host\":\"$H\",\"rhost\":\"$R\",\"tty\":\"$T\",\"sig\":\"$SIG\"}")"
ID="$(field "$RES" id)"; POLL="$(field "$RES" poll)"
if [ -z "$ID" ] || [ -z "$POLL" ]; then
  # API ответил отказом (нет почты/аутентификатора, подпись) — закрыто. Не ответил вовсе — по настройке.
  case "$RES" in ""|"<"*) UNREACH=1 ;; *) UNREACH=0 ;; esac
  if [ "$UNREACH" = 1 ] && [ "$SKY_FAILOPEN" = "1" ]; then logger -t sky-ssh-gate "API недоступен, SKY_FAILOPEN=1: вход $U пропущен"; exit 0; fi
  # Запасной код — когда проверка Sky не работает (API лежит, почта/настройки владельца сломаны), но не при явном отказе или рубильнике.
  if [ "$UNREACH" = 1 ]; then local_fallback "Сервер проверки Sky недоступен" && exit 0
  else case "$RES" in *email_failed*|*email_required*|*two_factor_required*|*public_url_missing*|*owner_missing*|*disabled*) local_fallback "Письмо владельцу отправить не удалось" && exit 0 ;; esac; fi
  logger -t sky-ssh-gate "вход $U@$R закрыт: ${RES:-API недоступен}"
  exit 1
fi
fi

# Терминал человека: пока ждём, на нём виден экран «Ожидание подтверждения владельца», и только потом — командная строка.
say "\r\n  Sky · защищённый вход\r\n  ────────────────────────────────────\r\n  Ожидание подтверждения владельца…\r\n  Владельцу отправлено письмо со ссылкой; сервер откроется после подтверждения.\r\n\r\n"

START=$(date +%s); END=$(( START + SKY_TIMEOUT )); N=0
while [ "$(date +%s)" -lt "$END" ]; do
  ST="$(field "$(api /api/ssh-gate/poll "{\"id\":\"$ID\",\"poll\":\"$POLL\"}")" status)"
  case "$ST" in
    approved) logger -t sky-ssh-gate "вход $U@$R подтверждён владельцем"
      # Отметка для ssh-login-hook.sh: этот вход уже подтверждён до сессии, второе письмо («подтвердите за 10 минут») не нужно.
      MARK="${SKY_GATE_MARK:-/opt/sky/control/ssh-gate-approved}"
      { mkdir -p "$(dirname "$MARK")" && printf '%s %s %s\n' "$(date +%s)" "${PAM_USER:-}" "${PAM_RHOST:-}" > "$MARK" && chmod 600 "$MARK"; } 2>/dev/null
      [ "$SKY_REUSE_SEC" -gt 0 ] 2>/dev/null && { printf '%s %s %s\n' "$(date +%s)" "$U" "$R" > "$REUSE" && chmod 600 "$REUSE"; } 2>/dev/null
      say "\r\033[K  ✔ Подтверждено владельцем. Добро пожаловать.\r\n\r\n"; exit 0 ;;
    denied|expired|unknown) logger -t sky-ssh-gate "вход $U@$R отклонён ($ST)"; say "\r\033[K  ✖ Вход не подтверждён (отклонён или истёк срок).\r\n"; exit 1 ;;
  esac
  N=$((N + 1)); say "\r\033[K  ⏳ Ждём… осталось $(( END - $(date +%s) )) с"
  sleep 2
done
logger -t sky-ssh-gate "вход $U@$R: подтверждения не дождались"
say "\r\033[K  ✖ Владелец не подтвердил вход вовремя.\r\n"
local_fallback "Подтверждение владельца не пришло (проверьте, доходит ли почта)" && exit 0
exit 1
