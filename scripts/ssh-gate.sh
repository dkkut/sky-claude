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
#
#  Конфиг /etc/sky-ssh-gate.conf (root, 600):
#     SKY_API=https://web.skymessenger.online     # адрес API
#     SKY_SECRET=...                               # тот же, что SSH_GATE_SECRET в .env сервера (от 24 знаков)
#     SKY_TIMEOUT=300                              # сколько ждать подтверждения, сек
#     SKY_MODE=token                               # token (по умолчанию): @ник + личный токен администратора, владелец получает уведомление и 25 минут
#                                                  #   может отменить вход («Это не я»); owner: владелец подтверждает ссылкой из письма ДО входа
#     SKY_FAILOPEN=0                               # 1 — пускать, если API недоступен (небезопасно)
#
#  Если API недоступен, а SKY_FAILOPEN=0, вход закрыт: зайти можно только с консоли
#  хостера (она sshd не использует) или после «touch /etc/sky-ssh-gate.off».
# =====================================================================
set -u
CONF="${SKY_GATE_CONF:-/etc/sky-ssh-gate.conf}"
OFF="${SKY_GATE_OFF:-/etc/sky-ssh-gate.off}"
SELF="$(readlink -f "$0")"

if [ "${1:-}" = "--install" ] || [ "${1:-}" = "--uninstall" ]; then
  [ "$(id -u)" = 0 ] || { echo "Нужен root" >&2; exit 1; }
  PAM=/etc/pam.d/sshd
  LINE="session requisite pam_exec.so quiet $SELF"
  if [ "$1" = "--uninstall" ]; then
    sed -i "\#$SELF#d" "$PAM"; echo "Шлюз SSH отключён (строка убрана из $PAM)."; exit 0
  fi
  [ -f "$CONF" ] || { echo "Нет $CONF — создайте его (см. шапку скрипта) и запустите ещё раз." >&2; exit 1; }
  chmod 600 "$CONF"
  grep -qs "UsePAM yes" /etc/ssh/sshd_config /etc/ssh/sshd_config.d/* 2>/dev/null || echo "ВНИМАНИЕ: в sshd_config должно быть «UsePAM yes»." >&2
  # Шлюз ставим ПЕРВЫМ среди session-строк и как requisite: отказ шлюза сразу обрывает вход, и ssh-login-hook.sh
  # (письмо «подтвердите после входа») для отказанного входа не запускается. Прежняя строка required (если была) заменяется.
  sed -i "\#$SELF#d" "$PAM"
  if grep -n '^session' "$PAM" >/dev/null 2>&1; then
    FIRST="$(grep -n '^session' "$PAM" | head -1 | cut -d: -f1)"; sed -i "${FIRST}i $LINE" "$PAM"
  else echo "$LINE" >> "$PAM"; fi
  echo "Готово. Откройте ВТОРОЙ терминал и проверьте вход ДО закрытия текущей сессии."
  echo "Если что-то не так: sudo touch $OFF (или с консоли хостера: bash $SELF --uninstall)."
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
[ -e "$OFF" ] && exit 0
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
REUSE="${SKY_GATE_REUSE:-/opt/sky/control/ssh-gate-reuse}"; LOCKF="${REUSE}.lock"
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
say() { [ -n "$TTYDEV" ] && { [ -c "$TTYDEV" ] || [ -n "${SKY_GATE_TTY:-}" ]; } && printf '%b' "$1" >> "$TTYDEV" 2>/dev/null; return 0; }

# ── режим token: @ник и токен администратора на терминале ──
if [ "$SKY_MODE" = "token" ]; then
  if [ -z "$TTYDEV" ] || { [ ! -c "$TTYDEV" ] && [ -z "${SKY_GATE_TTY:-}" ]; }; then
    logger -t sky-ssh-gate "вход $U@$R закрыт: нет терминала для токена (scp/sftp/команда без tty проходят только как параллельные к недавнему входу)"
    exit 1
  fi
  exec 8<>"$TTYDEV" || { logger -t sky-ssh-gate "вход $U@$R закрыт: терминал недоступен"; exit 1; }
  ask() {  # приглашение, секретность(0/1)
    printf '%b' "$1" >&8
    [ "$2" = 1 ] && stty -F "$TTYDEV" -echo 2>/dev/null
    local v=""; IFS= read -r -t 120 -u 8 v || v=""
    [ "$2" = 1 ] && { stty -F "$TTYDEV" echo 2>/dev/null; printf '\r\n' >&8; }
    printf '%s' "$v" | tr -d '\r'
  }
  say "\r\n  Sky · защищённый вход\r\n  ────────────────────────────────────\r\n  Вход по токену администратора. Владелец получит уведомление.\r\n\r\n"
  ID=""; POLL=""
  for TRY in 1 2 3; do
    NICK="$(ask "  Ваш @ник в Sky: " 0 | tr -cd 'A-Za-z0-9_@.-' | cut -c1-40)"
    TOK="$(ask "  Токен администратора: " 1 | tr -cd 'A-Za-z0-9-' | cut -c1-40)"
    [ -n "$NICK" ] && [ -n "$TOK" ] || { say "  ✖ Нужны @ник и токен.\r\n"; continue; }
    RES="$(api /api/ssh-gate/login "{\"ts\":\"$TS\",\"user\":\"$U\",\"host\":\"$H\",\"rhost\":\"$R\",\"tty\":\"$T\",\"sig\":\"$SIG\",\"nick\":\"$NICK\",\"token\":\"$TOK\"}")"
    ID="$(field "$RES" id)"; POLL="$(field "$RES" poll)"
    TOK=""
    [ -n "$ID" ] && [ -n "$POLL" ] && break
    case "$RES" in
      *paused*) say "  ✖ Новые входы по SSH закрыты владельцем.\r\n"; logger -t sky-ssh-gate "вход $U@$R закрыт: рубильник"; exit 1 ;;
      "") if [ "$SKY_FAILOPEN" = "1" ]; then logger -t sky-ssh-gate "API недоступен, SKY_FAILOPEN=1: вход $U пропущен"; exit 0; fi
          say "  ✖ Сервер проверки недоступен. Вход закрыт.\r\n"; logger -t sky-ssh-gate "вход $U@$R закрыт: API недоступен"; exit 1 ;;
    esac
    say "  ✖ Не подошло. Попытка $TRY из 3.\r\n"
    TS="$(date +%s)"; SIG="$(printf '%s\n%s\n%s\n%s\n%s' "$TS" "$U" "$H" "$R" "$T" | openssl dgst -sha256 -hmac "$SKY_SECRET" -hex | awk '{print $NF}')"
  done
  if [ -z "$ID" ] || [ -z "$POLL" ]; then logger -t sky-ssh-gate "вход $U@$R закрыт: токен не принят"; say "\r\n  ✖ Вход закрыт.\r\n"; exit 1; fi
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

RES="$(api /api/ssh-gate/request "{\"ts\":\"$TS\",\"user\":\"$U\",\"host\":\"$H\",\"rhost\":\"$R\",\"tty\":\"$T\",\"sig\":\"$SIG\"}")"
ID="$(field "$RES" id)"; POLL="$(field "$RES" poll)"
if [ -z "$ID" ] || [ -z "$POLL" ]; then
  # API ответил отказом (нет почты/аутентификатора, подпись) — закрыто. Не ответил вовсе — по настройке.
  if [ -z "$RES" ] && [ "$SKY_FAILOPEN" = "1" ]; then logger -t sky-ssh-gate "API недоступен, SKY_FAILOPEN=1: вход $U пропущен"; exit 0; fi
  logger -t sky-ssh-gate "вход $U@$R закрыт: ${RES:-API недоступен}"
  exit 1
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
exit 1
