#!/usr/bin/env bash
# Усиление sshd для сервера Sky. По умолчанию ТОЛЬКО проверяет и показывает, что изменится; ничего не применяет.
#   sudo bash scripts/harden-ssh.sh              # отчёт: что сейчас и что рекомендуется
#   sudo bash scripts/harden-ssh.sh --apply      # применить (с проверкой sshd -t, резервной копией и защитой от самоблокировки)
#   sudo bash scripts/harden-ssh.sh --rollback   # убрать наш файл настроек и перечитать sshd
#
# Что делает (файл /etc/ssh/sshd_config.d/99-sky-hardening.conf, основной конфиг не правится):
#   PasswordAuthentication no, KbdInteractiveAuthentication no   — только ключи
#   PermitRootLogin prohibit-password                            — root только по ключу, не по паролю (запретить совсем: --no-root)
#   PubkeyAuthentication yes, MaxAuthTries 3, LoginGraceTime 30, X11Forwarding no, PermitEmptyPasswords no
#   ClientAliveInterval 300 / ClientAliveCountMax 2              — зависшие сессии закрываются сами (~10 минут)
#   UsePAM yes                                                   — нужен для ssh-gate.sh (подтверждение владельцем)
# Защита от самоблокировки: --apply откажется работать, если у текущего пользователя нет ни одного ключа в authorized_keys.
# Чего скрипт НЕ делает: не трогает межсетевой экран (смена правил по ошибке закрывает доступ насовсем) — подсказки ниже в отчёте.
# Аварийный вход при любой проблеме — консоль хостера (она sshd не использует).
set -euo pipefail
DROP=/etc/ssh/sshd_config.d/99-sky-hardening.conf
MODE="${1:-report}"; NOROOT=0; [ "${2:-}" = "--no-root" ] || [ "${1:-}" = "--no-root" ] && NOROOT=1
[ "$(id -u)" = 0 ] || { echo "Нужен root (sudo)."; exit 1; }
command -v sshd >/dev/null 2>&1 || { echo "sshd не найден"; exit 1; }

eff() { sshd -T 2>/dev/null | awk -v k="$1" 'tolower($1)==k {print $2; exit}'; }
want() { # ключ рекомендуемое
  local cur; cur="$(eff "$1")"
  if [ "$cur" = "$2" ]; then echo "  ✔ $1 = $cur"; else echo "  ! $1 = ${cur:-?}  → рекомендуется $2"; fi
}
report() {
  echo "== Текущие настройки sshd (эффективные) =="
  want passwordauthentication no; want kbdinteractiveauthentication no
  local pr; pr="$(eff permitrootlogin)"; [ "$pr" = "no" ] || [ "$pr" = "prohibit-password" ] && echo "  ✔ permitrootlogin = $pr" || echo "  ! permitrootlogin = $pr → рекомендуется prohibit-password"
  want pubkeyauthentication yes; want maxauthtries 3; want x11forwarding no; want permitemptypasswords no; want usepam yes
  echo "  · logingracetime = $(eff logingracetime) (рекомендуется 30)"
  echo "== Ключи =="
  local n=0; for h in /root /home/*; do [ -s "$h/.ssh/authorized_keys" ] && { echo "  ✔ $h/.ssh/authorized_keys: $(grep -cv '^\s*\(#\|$\)' "$h/.ssh/authorized_keys") ключ(а)"; n=$((n+1)); }; done
  [ "$n" -gt 0 ] || echo "  ✖ нигде нет authorized_keys — отключать пароли НЕЛЬЗЯ"
  echo "== Подтверждение владельцем (ssh-gate) =="
  grep -qs "ssh-gate" /etc/pam.d/sshd && echo "  ✔ подключено в /etc/pam.d/sshd" || echo "  ! не подключено: sudo bash scripts/ssh-gate.sh --install"
  [ -e /etc/sky-ssh-gate.off ] && echo "  ! ВНИМАНИЕ: существует /etc/sky-ssh-gate.off — шлюз выключен аварийным файлом"
  echo "== Сеть (подсказка, скрипт её не меняет) =="
  if command -v ufw >/dev/null 2>&1; then echo "  ufw: $(ufw status | head -1)"; fi
  echo "  Чтобы не держать SSH открытым всему интернету, разрешите порт 22 только с ваших адресов, например:"
  echo "    ufw allow from ВАШ_IP to any port 22 proto tcp  &&  ufw delete allow 22/tcp   # СНАЧАЛА проверьте вход с этого адреса"
  echo "  Либо смените порт и закройте старый — только имея доступ к консоли хостера."
}
apply() {
  # защита от самоблокировки
  local keys=0; for h in /root /home/*; do [ -s "$h/.ssh/authorized_keys" ] && keys=$((keys+1)); done
  [ "$keys" -gt 0 ] || { echo "✖ Не найдено ни одного authorized_keys. Сначала добавьте свой публичный ключ, иначе после отключения паролей вы не войдёте."; exit 1; }
  local root="prohibit-password"; [ "$NOROOT" = 1 ] && root="no"
  [ "$root" = "no" ] && echo "! Режим --no-root: убедитесь, что у вас есть обычный пользователь с ключом и sudo."
  mkdir -p /etc/ssh/sshd_config.d
  [ -f "$DROP" ] && cp -a "$DROP" "$DROP.bak.$(date +%s)"
  cat > "$DROP" <<EOF
# Создано scripts/harden-ssh.sh (Sky). Откат: bash scripts/harden-ssh.sh --rollback
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin $root
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
UsePAM yes
EOF
  chmod 644 "$DROP"
  if ! sshd -t; then echo "✖ sshd -t нашёл ошибку — откатываю"; rm -f "$DROP"; exit 1; fi
  (systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || service ssh reload 2>/dev/null || service sshd reload) 
  echo "✔ Применено. ВАЖНО: не закрывая эту сессию, откройте ВТОРОЙ терминал и проверьте вход по ключу. Если не входит: bash scripts/harden-ssh.sh --rollback (или консоль хостера)."
}
rollback() {
  rm -f "$DROP"; sshd -t && (systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || service ssh reload 2>/dev/null || service sshd reload) && echo "✔ Откат выполнен: наш файл настроек удалён."
}
case "$MODE" in
  report|--report|--no-root) report ;;
  --apply) report; echo; apply ;;
  --rollback) rollback ;;
  *) sed -n 2,19p "$0"; exit 1 ;;
esac
