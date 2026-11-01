#!/usr/bin/env bash
# Запоминает логин и пароль (токен GitHub): и для deploy-local.sh, и для обычных `git pull` / `git fetch` в каталогах Sky на сервере.
#   bash scripts/set-deploy-credentials.sh           — спросить и сохранить
#   bash scripts/set-deploy-credentials.sh --check   — показать, что сохранено (пароль не печатается) и где подключено
#   bash scripts/set-deploy-credentials.sh --remove  — удалить файл, помощник и настройки git
# Файл: /etc/sky-deploy.cred (или $DEPLOY_CRED), права 600. Пароль — токен GitHub (repo:read), НЕ пароль аккаунта (GitHub его не принимает).
# git получает данные через помощника /usr/local/sbin/sky-git-cred (или $GIT_CRED_HELPER): он читает тот же файл и отдаёт их только для github.com.
# Каталоги: $APP_DIR, /opt/sky, /opt/sky-src и репозиторий, в котором запущен скрипт (те, что есть и являются git-репозиториями).
set -euo pipefail
F="${DEPLOY_CRED:-/etc/sky-deploy.cred}"
H="${GIT_CRED_HELPER:-/usr/local/sbin/sky-git-cred}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
dirs() { for d in "${APP_DIR:-}" /opt/sky /opt/sky-src "$HERE"; do [ -n "$d" ] && [ -d "$d/.git" ] && echo "$d"; done | sort -u; }

case "${1:-}" in
  --check)
    if [ -f "$F" ]; then echo "Сохранено: $F (логин: $(grep '^GIT_USER=' "$F" | cut -d= -f2-), пароль скрыт)"; else echo "Не сохранено."; fi
    [ -x "$H" ] && echo "Помощник git: $H" || echo "Помощника git нет."
    for d in $(dirs); do echo "  $d: $(git -C "$d" config --get credential.helper 2>/dev/null || echo 'не подключено')"; done
    exit 0;;
  --remove)
    for d in $(dirs); do [ "$(git -C "$d" config --get credential.helper 2>/dev/null || true)" = "$H" ] && git -C "$d" config --unset credential.helper || true; done
    rm -f "$F" "$H"; echo "Удалено: файл, помощник и настройки git."; exit 0;;
esac

read -r -p "Логин GitHub: " U
read -r -s -p "Пароль / токен (ввод скрыт): " P; echo
[ -n "$U" ] && [ -n "$P" ] || { echo "Пусто — не сохранено."; exit 1; }
case "$U$P" in *$'\n'*|*\'*|*\"*|*' '*) echo "Недопустимые символы (пробелы и кавычки нельзя)."; exit 1;; esac
umask 077
printf 'GIT_USER=%s\nGIT_TOKEN=%s\n' "$U" "$P" > "$F"
chmod 600 "$F"

# Помощник git: отдаёт сохранённые данные только для github.com и только по запросу get.
mkdir -p "$(dirname "$H")"
cat > "$H" <<HELPER
#!/bin/sh
[ "\$1" = get ] || exit 0
host=""
while IFS='=' read -r k v; do [ -z "\$k" ] && break; [ "\$k" = host ] && host="\$v"; done
[ "\$host" = github.com ] || exit 0
u=\$(grep '^GIT_USER=' "$F" | cut -d= -f2-); t=\$(grep '^GIT_TOKEN=' "$F" | cut -d= -f2-)
[ -n "\$u" ] && [ -n "\$t" ] || exit 0
printf 'username=%s\npassword=%s\n' "\$u" "\$t"
HELPER
chmod 755 "$H"
n=0
for d in $(dirs); do git -C "$d" config credential.helper "$H" && n=$((n+1)); done
echo "Сохранено в $F (600). Git больше не спросит пароль в $n каталог(ах). Проверка: bash scripts/set-deploy-credentials.sh --check"
