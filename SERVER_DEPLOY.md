# 🚀 SKY v4 — РУКОВОДСТВО ПО ДЕПЛОЮ НА СЕРВЕР

## Стек для продакшна
- **Frontend**: React/Vite → статика → Nginx
- **Backend**: Node.js + Fastify (или Express) + TypeScript
- **БД**: PostgreSQL + Redis (кэш/сессии)
- **Хранилище**: S3-совместимое (MinIO self-hosted или Yandex Object Storage)
- **CDN**: Cloudflare (обязателен — он же anti-DDoS)

---

## 🔐 Безопасность

### HTTPS / TLS
```nginx
# /etc/nginx/sites-available/sky.conf
server {
    listen 443 ssl http2;
    server_name skymessenger.online;
    
    ssl_certificate     /etc/letsencrypt/live/skymessenger.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/skymessenger.online/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;  # только TLS 1.2+
    ssl_ciphers         ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline';";
}
```

### Certbot (Let's Encrypt)
```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d skymessenger.online -d www.skymessenger.online
# Auto-renewal
echo "0 12 * * * root certbot renew --quiet" >> /etc/cron.d/certbot
```

---

## 🛡️ Anti-DDoS

### 1. Cloudflare (обязателен — бесплатный тариф покрывает DDoS L3/L4/L7)
- Добавить домен skymessenger.online в Cloudflare
- Включить **Under Attack Mode** при атаке
- Включить **Bot Fight Mode** (бесплатно)
- **Rate Limiting**: 100 запросов/10 сек с одного IP

### 2. Fail2Ban (защита от брутфорса)
```bash
apt install fail2ban
# /etc/fail2ban/jail.local
[nginx-http-auth]
enabled  = true
maxretry = 5
bantime  = 3600
findtime = 600

[nginx-limit-req]
enabled  = true
maxretry = 10
bantime  = 7200
```

### 3. Nginx rate limiting
```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

location /api/ {
    limit_req zone=api burst=10 nodelay;
}
location /api/auth/ {
    limit_req zone=login burst=3 nodelay;
}
```

### 4. UFW Firewall
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP (редирект на HTTPS)
ufw allow 443/tcp  # HTTPS
ufw enable
```

---

## 📱 SMS верификация

### Через SMS.ru (Россия) или Twilio (международный)
```typescript
// backend/src/sms/smsService.ts
import axios from 'axios';

export async function sendSmsCode(phone: string): Promise<string> {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Сохранить в Redis с TTL 5 минут
  await redis.set(`sms:${phone}`, code, 'EX', 300);
  
  // SMS.ru API
  await axios.get('https://sms.ru/sms/send', {
    params: {
      api_id: process.env.SMSRU_API_KEY,
      to: phone,
      msg: `Sky: ваш код подтверждения ${code}. Не сообщайте никому.`,
      json: 1
    }
  });
  
  return code;
}

export async function verifySmsCode(phone: string, code: string): Promise<boolean> {
  const stored = await redis.get(`sms:${phone}`);
  if (stored === code) {
    await redis.del(`sms:${phone}`);
    return true;
  }
  return false;
}
```

### В app (заглушки → реальные):
Файлы с заглушками для замены:
- `src/core/auth/store.ts` → `grantPrime`, `verifySms` — заменить на API calls
- `src/wallet/store.ts` → `spend`, `deposit` — заменить на транзакции через БД
- `src/garant/SkyGarant.tsx` → все операции через backend API
- `src/marketplace/store.ts` → заменить localStorage на REST API

---

## 🔑 Шифрование данных

### Пароли (bcrypt)
```typescript
import bcrypt from 'bcrypt';
const SALT_ROUNDS = 12;

export const hashPassword   = (p: string) => bcrypt.hash(p, SALT_ROUNDS);
export const verifyPassword = (p: string, hash: string) => bcrypt.compare(p, hash);
```

### JWT сессии
```typescript
import jwt from 'jsonwebtoken';
const SECRET = process.env.JWT_SECRET!; // min 64 символа, хранить в .env

export const signToken = (userId: string) =>
  jwt.sign({ sub: userId, iat: Date.now() }, SECRET, { expiresIn: '30d' });

export const verifyToken = (token: string) =>
  jwt.verify(token, SECRET) as { sub: string };
```

### Шифрование чувствительных данных (авторские документы артистов)
```typescript
import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const KEY  = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32 bytes

export function encrypt(text: string): string {
  const iv        = crypto.randomBytes(16);
  const cipher    = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag       = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(data: string): string {
  const [ivHex, tagHex, encHex] = data.split(':');
  const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8');
}
```

### E2E шифрование сообщений (Signal Protocol)
```bash
npm install @signalapp/libsignal-client
```
```typescript
// Использовать libsignal для ключей Curve25519 + AES-256-CBC
// Ключи хранятся только у пользователей — сервер не имеет доступа к сообщениям
```

---

## 🗄️ База данных PostgreSQL

### Основные таблицы
```sql
-- Пользователи
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username    VARCHAR(32) UNIQUE NOT NULL,
  phone       VARCHAR(20) UNIQUE,
  password    TEXT NOT NULL,  -- bcrypt hash
  is_prime    BOOLEAN DEFAULT FALSE,
  is_admin    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Сделки Гаранта
CREATE TABLE garant_deals (
  id                  UUID PRIMARY KEY,
  seller_id           UUID REFERENCES users(id),
  buyer_id            UUID REFERENCES users(id),
  item_name           TEXT NOT NULL,
  price               INTEGER NOT NULL,
  pay_type            VARCHAR(10),
  status              VARCHAR(30) NOT NULL,
  seller_deposited    BOOLEAN DEFAULT FALSE,
  buyer_deposited     BOOLEAN DEFAULT FALSE,
  seller_confirmed    BOOLEAN DEFAULT FALSE,
  buyer_confirmed     BOOLEAN DEFAULT FALSE,
  dispute_reason      TEXT,
  dispute_result      VARCHAR(20),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Правообладание треков (зашифровано)
CREATE TABLE track_copyright (
  track_id        UUID REFERENCES tracks(id),
  copyright_type  VARCHAR(20),
  copyright_doc   TEXT,  -- зашифровано AES-256
  copyright_note  TEXT,
  verified_by     UUID REFERENCES users(id),
  verified_at     TIMESTAMPTZ
);
```

---

## 📦 Переменные окружения (.env)
```env
# Обязательно в продакшне
DATABASE_URL=postgresql://sky:PASSWORD@localhost:5432/sky_prod
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-very-long-random-secret-min-64-chars-here-generate-with-openssl
ENCRYPTION_KEY=your-32-byte-hex-key-generated-with-openssl-rand-hex-32

# SMS
SMSRU_API_KEY=your-sms-ru-api-key
# или Twilio:
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=your-token
TWILIO_PHONE=+1234567890

# S3 Storage
S3_ENDPOINT=https://storage.yandexcloud.net
S3_BUCKET=sky-media
S3_ACCESS_KEY=your-key
S3_SECRET_KEY=your-secret

# Cloudflare (для очистки кэша)
CF_ZONE_ID=your-zone-id
CF_API_TOKEN=your-api-token

# App
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://skymessenger.online
```

---

## 🚦 Что НЕ работает в локальной версии (нужен сервер)

| Функция | Статус | Что нужно |
|---------|--------|-----------|
| SMS верификация | ⏳ Заглушка | SMS.ru API key + backend |
| Push-уведомления | ⏳ Частично | Firebase FCM или web-push |
| E2E шифрование | ⏳ Заглушка | libsignal-client на сервере |
| Загрузка файлов (аудио, фото) | ⏳ Blob (локально) | S3 bucket |
| Реальные платежи | ⏳ Имитация | Тинькофф/ЮKassa API |
| WebSocket чат | ⏳ In-memory | Socket.io + Redis pub/sub |
| Синхронизация между устройствами | ❌ Нет | PostgreSQL + WebSocket |
| Авторские документы (шифрование) | ⏳ Файл в памяти | AES-256-GCM + S3 |
| Anti-DDoS | ❌ Нет | Cloudflare + Nginx |
| 2FA (TOTP) | ⏳ Заглушка | speakeasy + QR-код |

---

## 🛠 Checklist деплоя
- [ ] Купить VPS (минимум 4 CPU / 8 ГБ RAM для 1000 пользователей)
- [ ] Установить Docker + Docker Compose
- [ ] Настроить Nginx + Certbot (HTTPS)
- [ ] Подключить домен через Cloudflare (ОБЯЗАТЕЛЬНО для DDoS)
- [ ] Настроить PostgreSQL с бэкапами
- [ ] Настроить Redis
- [ ] Получить API-ключ SMS.ru
- [ ] Настроить S3 хранилище (Yandex Cloud минимум)
- [ ] Сгенерировать JWT_SECRET и ENCRYPTION_KEY
- [ ] Настроить Fail2Ban
- [ ] Настроить UFW
- [ ] Написать Dockerfile для backend
- [ ] Настроить GitHub Actions CI/CD
- [ ] Включить мониторинг (Grafana + Prometheus)
- [ ] Настроить алерты на аномальный трафик
