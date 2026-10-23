#!/usr/bin/env bash
# Аварийный доступ по ключу: отдельный пользователь БЕЗ оболочки, которому разрешён только короткий список команд.
# Нужен, чтобы поднять сервер, когда обычный вход по SSH закрыт (шлюз подтверждения владельцем ждёт API, а API лежит).
#   bash scripts/rescue-access.sh --install [--key "ssh-ed25519 AAAA… комментарий"] [--from 203.0.113.5]
#   bash scripts/rescue-access.sh --status | --uninstall
# Использование (с телефона/ноутбука, ключ — приватная часть пары):
#   ssh -i rescue_key skyrescue@СЕРВЕР status      # состояние
#   ssh -i rescue_key skyrescue@СЕРВЕР up          # docker compose up -d
#   ssh -i rescue_key skyrescue@СЕРВЕР help        # весь список
# Что НЕ даёт: оболочку, файлы, пересылку портов, правку конфигов, отключение SSH-шлюза. Только команды из списка (sky-rescue-run).
# Цена: владелец ключа может выполнять эти команды БЕЗ подтверждения владельцем (шлюз для этого пользователя не ждёт).
# Поэтому: ключ с паролем (passphrase), хранить отдельно, по возможности ограничить адресом (--from), каждое использование пишется
# в syslog (logger sky-rescue) и уходит письмом на WATCHDOG_EMAIL_TO (если задано в /etc/sky-watchdog.env).
set -euo pipefail
U=skyrescue; RUN=/usr/local/sbin/sky-rescue-run; SHELLW=/usr/local/sbin/sky-rescue-shell
DROP=/etc/ssh/sshd_config.d/90-sky-rescue.conf; SUDOERS=/etc/sudoers.d/90-sky-rescue; MARK=/etc/sky-rescue.user
[ "$(id -u)" = 0 ] || { echo "Нужен root" >&2; exit 1; }
ACTION="${1:---install}"; shift || true
KEY=""; FROM=""
while [ $# -gt 0 ]; do case "$1" in --key) KEY="${2:-}"; shift 2;; --from) FROM="${2:-}"; shift 2;; *) echo "Неизвестный параметр $1" >&2; exit 2;; esac; done

reload_ssh() { systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || service ssh reload; }

if [ "$ACTION" = "--status" ]; then
  id "$U" >/dev/null 2>&1 && echo "пользователь: $U есть" || echo "пользователь: нет"
  [ -f "$DROP" ] && echo "sshd: настройка есть" || echo "sshd: настройки нет"
  sshd -T -C "user=$U,host=localhost,addr=127.0.0.1" 2>/dev/null | grep -iE '^(forcecommand|passwordauthentication|authenticationmethods|permittty)' || true
  [ -f "/home/$U/.ssh/authorized_keys" ] && { echo "ключи:"; ssh-keygen -lf "/home/$U/.ssh/authorized_keys" 2>/dev/null; } || echo "ключей нет"
  PAMF="$(grep -h 'ssh-gate.sh' /etc/pam.d/sshd 2>/dev/null | awk '{print $NF}' | head -1)"
  [ -n "$PAMF" ] && { grep -q 'sky-rescue.user' "$PAMF" && echo "шлюз ($PAMF): исключение для $U есть" || echo "шлюз ($PAMF): НЕТ исключения — обновите ssh-gate.sh (git pull)"; } || echo "шлюз SSH в PAM не подключён"
  exit 0
fi

if [ "$ACTION" = "--uninstall" ]; then
  rm -f "$DROP" "$SUDOERS" "$MARK" "$RUN" "$SHELLW"
  id "$U" >/dev/null 2>&1 && userdel -r "$U" 2>/dev/null || true
  sshd -t && reload_ssh; echo "Аварийный доступ снят."; exit 0
fi
[ "$ACTION" = "--install" ] || { sed -n 2,14p "$0"; exit 2; }

# ── проверки до изменений ───────────────────────────────────────────
grep -qE '^\s*Include\s+/etc/ssh/sshd_config\.d/' /etc/ssh/sshd_config || { echo "В /etc/ssh/sshd_config нет «Include /etc/ssh/sshd_config.d/*.conf» — добавьте строку первой и повторите." >&2; exit 1; }
if grep -qiE '^\s*AllowUsers' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null; then echo "ВНИМАНИЕ: в sshd задан AllowUsers — добавьте в него $U, иначе вход не пройдёт." >&2; fi
if [ -z "$KEY" ]; then echo "Вставьте ПУБЛИЧНЫЙ ключ (одна строка, начинается с ssh-ed25519) и нажмите Enter:"; read -r KEY; fi
case "$KEY" in ssh-ed25519\ *|sk-ssh-ed25519@openssh.com\ *|ecdsa-sha2-nistp256\ *) ;; *) echo "Это не похоже на публичный ключ (нужна строка «ssh-ed25519 AAAA…»). Приватный ключ сюда НЕ вставляйте." >&2; exit 1;; esac
printf '%s\n' "$KEY" | ssh-keygen -lf /dev/stdin >/dev/null 2>&1 || { echo "Ключ не разбирается — проверьте, что скопирована вся строка." >&2; exit 1; }
[ -z "$FROM" ] || printf '%s' "$FROM" | grep -qE '^[0-9a-fA-F:.,*/]+$' || { echo "Неверный адрес в --from" >&2; exit 1; }

# ── исполнитель команд (root): ТОЛЬКО перечисленные слова ───────────
cat > "$RUN" <<'R'
#!/bin/bash
# Список разрешённых аварийных команд. Вызывается через sudo из sky-rescue-shell: sky-rescue-run <слово> <адрес-клиента>.
set -u
[ -f /etc/sky-watchdog.env ] && . /etc/sky-watchdog.env
APP="${APP_DIR:-/opt/sky}"; V="${1:-help}"; FROM="$(printf '%s' "${2:-?}" | tr -cd '0-9a-fA-F:.' | cut -c1-45)"
say() { printf '%s\n' "$*"; }
note() {  # письмо владельцу (фоном, не задерживает команду)
  [ -n "${WATCHDOG_EMAIL_TO:-}" ] && command -v docker >/dev/null 2>&1 && ( cd "$APP" && timeout 60 docker compose run --rm --no-deps -T api node scripts/notify-mail.mjs "$WATCHDOG_EMAIL_TO" "Sky: аварийный вход" "$1" ) >/dev/null 2>&1 &
}
logger -t sky-rescue "команда '$V' с адреса $FROM"
case "$V" in
  help|"") say "Команды: status ps up restart-web restart-api restart-all logs-web logs-api watchdog disk reboot help | defense-off defense-on unlock gate-pause gate-resume ssh-start control-token control-restart"; exit 0;;
  status) uptime; df -h / | tail -1; free -m | sed -n 2p; ( cd "$APP" && docker compose ps ); command -v sky-watchdog >/dev/null && sky-watchdog --status;;
  ps) docker ps -a --format 'table {{.Names}}\t{{.Status}}';;
  up) note "Аварийный вход ($FROM): up"; cd "$APP" && docker compose up -d && docker compose ps;;
  restart-web) note "Аварийный вход ($FROM): restart-web"; cd "$APP" && docker compose restart web && docker compose ps;;
  restart-api) note "Аварийный вход ($FROM): restart-api"; cd "$APP" && docker compose restart api && docker compose ps;;
  restart-all) note "Аварийный вход ($FROM): restart-all"; cd "$APP" && docker compose restart && docker compose ps;;
  logs-web) cd "$APP" && docker compose logs --tail 60 web;;
  logs-api) cd "$APP" && docker compose logs --tail 60 api;;
  watchdog) command -v sky-watchdog >/dev/null && { sky-watchdog; sky-watchdog --status; };;
  disk) df -h; docker system df;;
  # Управление защитой через sky-control (CLI на хосте). Без причины от человека пишется «аварийный вход <адрес>».
  defense-off|defense-on|unlock|gate-pause|gate-resume|ssh-start) note "Аварийный вход ($FROM): $V"; CTL=/usr/local/sbin/sky-control; [ -x "$CTL" ] || { say "sky-control не установлен (scripts/install-control.sh)"; exit 1; }; "$CTL" --cli "$V" "rescue:$FROM";;
  control-token) note "Аварийный вход ($FROM): выдача нового токена Sky Control"; CTL=/usr/local/sbin/sky-control; [ -x "$CTL" ] || { say "sky-control не установлен"; exit 1; }; "$CTL" --cli new-token "rescue:$FROM";;
  control-restart) note "Аварийный вход ($FROM): control-restart"; systemctl restart sky-control && systemctl is-active sky-control;;
  reboot) note "Аварийный вход ($FROM): reboot"; say "Перезагрузка через 3 секунды…"; sleep 3; systemctl reboot;;
  *) say "Неизвестная команда: $V. Список: help"; exit 2;;
esac
R
chmod 755 "$RUN"; chown root:root "$RUN"

# ── оболочка пользователя: принимает ОДНО слово из списка ───────────
cat > "$SHELLW" <<'S'
#!/bin/bash
# ForceCommand для skyrescue: берём первое слово из SSH_ORIGINAL_COMMAND, лишнее отбрасываем; ничего не интерпретируем.
# Без команды и с терминалом (Termius и т. п.) — меню: по одному слову из списка за раз, «exit» — выход.
RUN="${SKY_RESCUE_RUN:-/usr/local/sbin/sky-rescue-run}"; SUDO="${SKY_RESCUE_SUDO:-sudo}"
from="${SSH_CONNECTION%% *}"
one() {  # одно слово: только a-z и дефис, ничего не интерпретируется
  local verb="${1%% *}"
  case "$verb" in *[!a-z-]*|"") echo "Допустимы только слова из списка (help)."; return 2;; esac
  $SUDO "$RUN" "$verb" "${from:-?}"
}
if [ -z "${SSH_ORIGINAL_COMMAND:-}" ] && [ -t 0 ]; then
  echo "Sky rescue. Введите команду из списка (help — список, exit — выход)."
  one help
  while printf 'sky-rescue> ' && IFS= read -r line; do
    w="${line%% *}"
    case "$w" in exit|quit|q) exit 0;; "") continue;; esac
    one "$w"
  done
  exit 0
fi
cmd="${SSH_ORIGINAL_COMMAND:-help}"
case "${cmd%% *}" in *[!a-z-]*|"") echo "Допустимы только слова из списка (help)."; exit 2;; esac
exec $SUDO "$RUN" "${cmd%% *}" "${from:-?}"
S
chmod 755 "$SHELLW"; chown root:root "$SHELLW"

# ── пользователь: без пароля, только ключ ───────────────────────────
id "$U" >/dev/null 2>&1 || useradd -m -s /bin/bash -c "Sky rescue (ограниченный)" "$U"
passwd -l "$U" >/dev/null 2>&1 || true
install -d -m 700 -o "$U" -g "$U" "/home/$U/.ssh"
OPTS='restrict,pty,command="'"$SHELLW"'"'; [ -z "$FROM" ] || OPTS="$OPTS"',from="'"$FROM"'"'
printf '%s %s\n' "$OPTS" "$KEY" > "/home/$U/.ssh/authorized_keys"
chown "$U:$U" "/home/$U/.ssh/authorized_keys"; chmod 600 "/home/$U/.ssh/authorized_keys"
printf '%s\n' "$U" > "$MARK"; chown root:root "$MARK"; chmod 644 "$MARK"

# ── sudo: только исполнитель ────────────────────────────────────────
printf 'Defaults:%s !requiretty\n%s ALL=(root) NOPASSWD: %s *\n' "$U" "$U" "$RUN" > "$SUDOERS"; chmod 440 "$SUDOERS"
visudo -cf "$SUDOERS" >/dev/null || { rm -f "$SUDOERS"; echo "sudoers не прошёл проверку — отменено." >&2; exit 1; }

# ── sshd: ключ, ForceCommand, без пересылок (терминал нужен только для меню) ─────────────
cat > "$DROP" <<D
# Sky rescue: ограниченный аварийный вход (scripts/rescue-access.sh)
Match User $U
    PubkeyAuthentication yes
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY yes
    PermitUserRC no
    ForceCommand $SHELLW
D
if ! sshd -t 2>/tmp/sky-rescue-sshd.err; then rm -f "$DROP"; echo "sshd отклонил настройку (см. /tmp/sky-rescue-sshd.err) — откат." >&2; exit 1; fi
sshd -T -C "user=$U,host=localhost,addr=127.0.0.1" 2>/dev/null | grep -qi "^forcecommand $SHELLW\$" || { rm -f "$DROP"; echo "ForceCommand не применился — откат (без него исключение шлюза опасно)." >&2; exit 1; }
reload_ssh

echo "Готово. Проверьте с ДРУГОГО устройства/терминала, не закрывая текущий:"
echo "  ssh -i <приватный_ключ> $U@<адрес_сервера> status"
echo "Исключение для шлюза должно быть в ssh-gate.sh (проверка: bash $0 --status). Если пишет «НЕТ исключения» — git pull в /opt/sky-src."
