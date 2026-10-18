#!/usr/bin/env bash
# Проверка защиты инфраструктуры ИЗНУТРИ сервера (только чтение, ничего не меняет).
#   bash /opt/sky-src/scripts/check-infra.sh
# Снаружи порты проверяйте с другой машины: nmap -Pn -p 5432,6379,8080,8081 ВАШ_IP
set -uo pipefail
cd "${APP_DIR:-/opt/sky}" 2>/dev/null || true
bad=0; warn=0
fail() { echo "  ✖ $1"; bad=$((bad+1)); }
wr()   { echo "  ⚠ $1"; warn=$((warn+1)); }
okk()  { echo "  ✔ $1"; }

echo "Порты, слушающие все интерфейсы"
if command -v ss >/dev/null 2>&1; then
  listen="$(ss -H -ltn 2>/dev/null | awk '{print $4}')"
  for p in 5432:Postgres 6379:Redis 8080:API 8081:сокет-API 9000:S3-шлюз; do
    port="${p%%:*}"; name="${p#*:}"
    if echo "$listen" | grep -Eq "^(0\.0\.0\.0|\[::\]|\*):$port$"; then fail "$name ($port) доступен снаружи — закройте: в docker-compose у службы не должно быть ports: \"$port:$port\""
    else okk "$name ($port) не торчит наружу"; fi
  done
  echo "$listen" | grep -Eq "^(0\.0\.0\.0|\[::\]|\*):22$" && okk "SSH (22) слушает — убедитесь, что включён вход по ключам и шлюз (scripts/harden-ssh.sh, ssh-gate.sh)"
else wr "нет утилиты ss"; fi

echo "Redis и Postgres в compose"
if [ -f docker-compose.yml ]; then
  awk '/^  (redis|postgres):/{s=$1} /^  [a-z]/{if($1!=s)s=""} s && /ports:/{print s" имеет ports:"}' docker-compose.yml | grep -q . && fail "у redis/postgres есть ports: в docker-compose.yml" || okk "ports: у redis/postgres нет"
  grep -q "requirepass\|REDIS_PASSWORD" docker-compose.yml && okk "Redis с паролем" || fail "Redis без пароля"
fi

echo "Файрвол"
if command -v ufw >/dev/null 2>&1; then
  ufw status 2>/dev/null | grep -q "Status: active" && okk "ufw включён" || wr "ufw выключен (docker обходит ufw для опубликованных портов — главное, чтобы их не было)"
else wr "ufw не установлен — проверьте файрвол у хостера"; fi

echo "Диск"
if command -v lsblk >/dev/null 2>&1; then
  lsblk -rno TYPE 2>/dev/null | grep -q crypt && okk "есть шифрованные тома (crypt)" || wr "шифрования диска (LUKS) не видно — спросите у хостера, шифруются ли виртуальные диски"
fi

echo "Права на файлы"
for f in .env .env.gpg secrets; do
  [ -e "$f" ] || continue
  m="$(stat -c %a "$f")"; case "$m" in 600|400|700) okk "$f ($m)";; *) fail "$f имеет права $m — нужно 600/700";; esac
done
d="${DEST:-/var/backups/sky}"
[ -d "$d" ] && { m="$(stat -c %a "$d")"; [ "$m" = 700 ] && okk "каталог копий $d (700)" || wr "каталог копий $d имеет права $m — нужно 700"; \
  ls "$d"/*.sql.gz "$d"/*.tar.gz 2>/dev/null | grep -q . && fail "в $d лежат ОТКРЫТЫЕ копии (.gz без .age) — удалите их"; }
ls /root/backup.key ./backup.key /opt/sky/backup.key 2>/dev/null | grep -q . && fail "секретный ключ backup.key лежит на сервере — перенесите на свой компьютер и удалите"
ls sky-keys-*.gpg 2>/dev/null | grep -q . && wr "файл sky-keys-*.gpg на сервере — храните его только у себя"

echo; echo "Итог: критичных $bad, предупреждений $warn"
[ "$bad" -gt 0 ] && exit 1; [ "$warn" -gt 0 ] && exit 2; exit 0
