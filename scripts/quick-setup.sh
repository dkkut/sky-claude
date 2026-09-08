#!/usr/bin/env bash
# ============================================================
#  Быстрая подготовка сервера под Sky. Ubuntu 24.04, от root.
#
#  Короткая версия bootstrap-server.sh — рассчитана на то, что её
#  вставляют в терминал целиком, когда кода на сервере ещё нет.
#  Ставит Docker, заводит пользователя для деплоя, включает файрвол
#  и автообновления, генерирует секреты.
#
#  Полная версия (sysctl, swap, закрытие SSH) лежит рядом и
#  запускается позже, когда код уже приехал на сервер.
# ============================================================
set -euo pipefail

DEPLOY_USER=sky
APP_DIR=/opt/sky

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Запускать от root"; exit 1; }

log "Обновляю систему"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg ufw fail2ban unattended-upgrades openssl

log "Ставлю Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

log "Пользователь для деплоя: $DEPLOY_USER"
id -u "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 750 "$APP_DIR"

log "Файрвол и защита от перебора"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
printf '[sshd]\nenabled = true\nmaxretry = 3\nbantime = 24h\n' > /etc/fail2ban/jail.local
systemctl enable --now fail2ban >/dev/null 2>&1 || true
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

log "Секреты"
ENV_FILE="$APP_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  echo "$ENV_FILE уже есть — не трогаю"
else
  umask 077
  cat > "$ENV_FILE" <<CONF
DOMAIN=skymessenger.online
CERTBOT_EMAIL=CHANGE_ME@example.com
CERTBOT_STAGING=0
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
REFRESH_TOKEN_SECRET=$(openssl rand -base64 48 | tr -d '\n')
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)
REDIS_PASSWORD=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)
# Шифрует переписку и секреты двухэтапной защиты. Без него сервер в бою
# не запускается: вывод ключа из JWT_SECRET означал бы, что смена подписи
# токенов делает нечитаемой всю переписку разом.
ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 44)
PAYMENTS_MODE=disabled
RATE_LIMIT_PER_MINUTE=120
ACCESS_TTL_SEC=900
REFRESH_TTL_SEC=2592000
CONF
  chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

log "Готово"
echo "  Docker      : $(docker --version)"
echo "  Пользователь: $DEPLOY_USER"
echo "  Каталог     : $APP_DIR"
echo "  Секреты     : $ENV_FILE"
echo
echo "  Дальше: добавьте ключ для деплоя и укажите почту в $ENV_FILE"
