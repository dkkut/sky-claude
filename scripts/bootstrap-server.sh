#!/usr/bin/env bash
# ============================================================
#  Первичная настройка сервера под Sky. Ubuntu 24.04, от root.
#
#  Что делает:
#    - обновляет систему и включает автоустановку обновлений безопасности;
#    - ставит Docker из официального репозитория;
#    - заводит непривилегированного пользователя для деплоя;
#    - закрывает SSH: только по ключу, без входа под root;
#    - поднимает UFW (22, 80, 443) и fail2ban;
#    - генерирует .env со свежими секретами.
#
#  Запуск:
#      sudo bash scripts/bootstrap-server.sh
#
#  Скрипт идемпотентен: повторный запуск ничего не ломает.
# ============================================================
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-sky}"
APP_DIR="${APP_DIR:-/opt/sky}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запускать от root: sudo bash $0"
[[ -f /etc/os-release ]] && . /etc/os-release
[[ "${VERSION_ID:-}" == "24.04" ]] || warn "Скрипт писался под Ubuntu 24.04, у вас ${PRETTY_NAME:-неизвестно}. Продолжаю."

# ------------------------------------------------------------
log "Обновляю систему"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  ca-certificates curl gnupg ufw fail2ban unattended-upgrades \
  apt-listchanges openssl git

# ------------------------------------------------------------
log "Включаю автоматические обновления безопасности"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
# Перезагрузку планируем ночью, чтобы обновления ядра применялись.
sed -i 's|^//\s*Unattended-Upgrade::Automatic-Reboot .*|Unattended-Upgrade::Automatic-Reboot "true";|' /etc/apt/apt.conf.d/50unattended-upgrades || true
sed -i 's|^//\s*Unattended-Upgrade::Automatic-Reboot-Time .*|Unattended-Upgrade::Automatic-Reboot-Time "04:30";|' /etc/apt/apt.conf.d/50unattended-upgrades || true

# ------------------------------------------------------------
log "Ставлю Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "Docker уже установлен: $(docker --version)"
fi
systemctl enable --now docker

# Ротация логов Docker на уровне демона — страховка на случай
# контейнеров без настроек логирования.
cat > /etc/docker/daemon.json <<'CONF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true
}
CONF
systemctl restart docker

# ------------------------------------------------------------
log "Создаю пользователя для деплоя: ${DEPLOY_USER}"
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"

# Переносим ключи root, если у пользователя своих ещё нет:
# иначе после закрытия root-логина попасть на сервер будет нечем.
USER_SSH="/home/${DEPLOY_USER}/.ssh"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$USER_SSH"
if [[ ! -s "${USER_SSH}/authorized_keys" && -s /root/.ssh/authorized_keys ]]; then
  cp /root/.ssh/authorized_keys "${USER_SSH}/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "${USER_SSH}/authorized_keys"
  chmod 600 "${USER_SSH}/authorized_keys"
  echo "Ключи скопированы из /root/.ssh/authorized_keys"
fi

# ------------------------------------------------------------
log "Настраиваю SSH"
if [[ ! -s "${USER_SSH}/authorized_keys" ]]; then
  warn "У пользователя ${DEPLOY_USER} нет authorized_keys."
  warn "Вход по паролю НЕ отключаю — иначе вы потеряете доступ к серверу."
  warn "Добавьте ключ и запустите скрипт повторно:"
  warn "    ssh-copy-id ${DEPLOY_USER}@<адрес сервера>"
else
  cat > /etc/ssh/sshd_config.d/99-sky.conf <<'CONF'
# Настройки Sky. Файл читается после основного sshd_config.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
CONF
  if sshd -t; then
    systemctl reload ssh
    echo "Вход по паролю и под root отключён."
  else
    rm -f /etc/ssh/sshd_config.d/99-sky.conf
    die "sshd отверг конфигурацию, изменения откачены"
  fi
fi

# ------------------------------------------------------------
log "Файрвол"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose | sed 's/^/    /'

# ------------------------------------------------------------
log "fail2ban"
cat > /etc/fail2ban/jail.local <<'CONF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true
maxretry = 3
bantime  = 24h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban

# ------------------------------------------------------------
log "Параметры ядра"
cat > /etc/sysctl.d/99-sky.conf <<'CONF'
# Сеть: не принимаем маршрутизацию от клиента, логируем подделку адресов.
net.ipv4.conf.all.accept_redirects   = 0
net.ipv4.conf.all.send_redirects     = 0
net.ipv4.conf.all.accept_source_route= 0
net.ipv4.conf.all.log_martians       = 1
net.ipv4.conf.all.rp_filter          = 1

# Защита от SYN-флуда.
net.ipv4.tcp_syncookies              = 1
net.ipv4.tcp_max_syn_backlog         = 4096

# Очередь входящих соединений под нагрузку от nginx.
net.core.somaxconn                   = 4096

# Не даём процессам читать чужие дампы.
kernel.kptr_restrict                 = 2
fs.protected_hardlinks               = 1
fs.protected_symlinks                = 1
CONF
sysctl --system >/dev/null

# ------------------------------------------------------------
log "Swap"
if ! swapon --show | grep -q .; then
  # 12 ГБ RAM: swap нужен не под нагрузку, а как страховка при сборке образов.
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
  echo "Создан swap 4 ГБ"
else
  echo "Swap уже есть"
fi

# ------------------------------------------------------------
log "Каталог приложения и секреты"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 "$APP_DIR"

ENV_FILE="${APP_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
  warn "${ENV_FILE} уже существует — не трогаю (секреты сохранены)."
else
  read -rp "Домен сайта (например sky.example.com): " DOMAIN_IN
  read -rp "E-mail для Let's Encrypt: " EMAIL_IN
  [[ -n "$DOMAIN_IN" && -n "$EMAIL_IN" ]] || die "Домен и e-mail обязательны"

  umask 077
  cat > "$ENV_FILE" <<CONF
# Секреты Sky. Сгенерированы $(date -Iseconds) скриптом bootstrap-server.sh.
# Файл не должен попадать в git и никуда пересылаться.

DOMAIN=${DOMAIN_IN}
CERTBOT_EMAIL=${EMAIL_IN}
# Поставьте 1, чтобы сначала проверить выпуск на тестовом сервере Let's Encrypt.
CERTBOT_STAGING=0

JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
REFRESH_TOKEN_SECRET=$(openssl rand -base64 48 | tr -d '\n')

POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)
REDIS_PASSWORD=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)

# Шифрует секреты двухэтапной защиты в базе.
ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')

# ВНИМАНИЕ: 'log' пишет код входа в журнал контейнера и никуда не шлёт.
# В бою он запрещён — войти не сможет никто, пока не задан провайдер.
# Для рабочего сайта: SMS_MODE=smsru и ключ SMS_API_ID.
SMS_MODE=log
SMS_API_ID=
SMS_FROM=
SMS_WEBHOOK_URL=
SMS_WEBHOOK_TOKEN=

# Почта: подтверждение адреса и код второго фактора.
# Рабочий вариант: EMAIL_MODE=smtp с ящиком вашего хостинга.
EMAIL_MODE=log
EMAIL_FROM=
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
RESEND_API_KEY=
EMAIL_WEBHOOK_URL=
EMAIL_WEBHOOK_TOKEN=

# Разрешает режим 'log' в бою. Оставьте пустым.
ALLOW_LOG_CODES=

RATE_LIMIT_PER_MINUTE=120
ACCESS_TTL_SEC=900
REFRESH_TTL_SEC=2592000
CONF
  chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Секреты сгенерированы в ${ENV_FILE} (права 600)."
fi

# ------------------------------------------------------------
log "Готово"
cat <<INFO

  Пользователь для деплоя : ${DEPLOY_USER}
  Каталог приложения      : ${APP_DIR}
  Секреты                 : ${ENV_FILE}

  Дальше:
    1. Направьте A-запись домена на этот сервер и дождитесь обновления DNS.
    2. Положите код в ${APP_DIR} (git clone или деплой через GitHub Actions).
    3. Выпустите сертификат:  cd ${APP_DIR} && bash scripts/init-letsencrypt.sh
    4. Подключите отправку кодов: в ${ENV_FILE} задайте SMS_MODE=smsru
       и SMS_API_ID, а для почты — EMAIL_MODE=smtp с данными ящика.
       Пока стоит SMS_MODE=log, войти не сможет никто: в бою этот режим
       запрещён. Подробности — в DEPLOY.md, раздел «Отправка кодов».

  Проверьте, что вход по ключу работает, ДО того как закроете текущую сессию.

INFO
