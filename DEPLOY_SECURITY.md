# SKY — РУКОВОДСТВО ПО БЕЗОПАСНОМУ ДЕПЛОЮ

## СТЕК
Node.js (Express/Fastify) + PostgreSQL + Redis + Nginx + Cloudflare

---

## 1. HTTPS / TLS
```nginx
server {
  listen 443 ssl http2;
  server_name skymessenger.online;
  ssl_certificate     /etc/letsencrypt/live/skymessenger.online/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/skymessenger.online/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;
  ssl_ciphers         'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
  ssl_session_cache   shared:SSL:10m;
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
  add_header X-Frame-Options DENY;
  add_header X-Content-Type-Options nosniff;
  add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;";
}
```

---

## 2. ANTI-DDOS (Cloudflare + Nginx)
```nginx
# Rate limit зоны
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=upload:10m rate=3r/m;

location /api/ {
  limit_req zone=api burst=20 nodelay;
  limit_req_status 429;
}
location /api/auth/ {
  limit_req zone=auth burst=3 nodelay;
}
location /api/upload/ {
  limit_req zone=upload burst=2 nodelay;
  client_max_body_size 100M;
}
```

**Cloudflare настройки:**
- WAF: включить OWASP rules
- Bot Fight Mode: ON
- Rate Limiting: 100 req/min per IP на `/api/*`
- Under Attack Mode: включать при DDoS

---

## 3. SMS ВЕРИФИКАЦИЯ (2FA / регистрация)
Сервис: **Twilio** или **СМСРУ** (для РФ)

```typescript
// backend/src/sms.ts
import twilio from 'twilio';
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

export const sendSMS = async (phone: string, code: string) => {
  await client.messages.create({
    body: `Sky: ваш код ${code}. Не сообщайте никому.`,
    from: process.env.TWILIO_FROM,
    to: phone,
  });
};

export const generateCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();
```

```typescript
// API endpoint
app.post('/api/auth/send-sms', rateLimiter(5), async (req, res) => {
  const { phone } = req.body;
  const code = generateCode();
  await redis.setex(`sms:${phone}`, 300, code); // 5 минут
  await sendSMS(phone, code);
  res.json({ ok: true });
});

app.post('/api/auth/verify-sms', async (req, res) => {
  const { phone, code } = req.body;
  const stored = await redis.get(`sms:${phone}`);
  if (stored !== code) return res.status(400).json({ error: 'Неверный код' });
  await redis.del(`sms:${phone}`);
  // создаём сессию...
});
```

---

## 4. ШИФРОВАНИЕ ДАННЫХ
```typescript
// backend/src/crypto.ts
import crypto from 'crypto';

const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32 bytes

export const encrypt = (text: string): string => {
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
};

export const decrypt = (data: string): string => {
  const [ivHex, tagHex, encHex] = data.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY,
    Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex,'hex')) + decipher.final('utf8');
};

// Использование для авторских документов, сообщений гаранта:
// Перед сохранением в БД: encrypt(sensitiveData)
// При чтении: decrypt(storedData)
```

---

## 5. JWT + СЕССИИ
```typescript
import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET!; // min 64 chars random

export const signToken = (userId: string) =>
  jwt.sign({ sub: userId, iat: Date.now() }, JWT_SECRET, {
    expiresIn: '7d', algorithm: 'HS256'
  });

export const verifyToken = (token: string) =>
  jwt.verify(token, JWT_SECRET) as { sub: string };

// Refresh tokens в Redis с возможностью отзыва:
app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  await redis.sadd(`revoked:${req.userId}`, req.jti);
  res.json({ ok: true });
});
```

---

## 6. ЗАЩИТА ФАЙЛОВ (медиа, документы)
```typescript
// Проверка типов при загрузке
import fileType from 'file-type';

app.post('/api/upload/track', upload.single('file'), async (req, res) => {
  const buf = req.file!.buffer;
  const type = await fileType.fromBuffer(buf);

  const ALLOWED = ['audio/mpeg','audio/wav','audio/flac','audio/aac'];
  if (!type || !ALLOWED.includes(type.mime)) {
    return res.status(400).json({ error: 'Недопустимый тип файла' });
  }
  if (buf.length > 100 * 1024 * 1024) { // 100MB max
    return res.status(400).json({ error: 'Файл слишком большой' });
  }
  // Сохраняем в S3/MinIO с рандомным именем (не оригинальным!)
  const key = `tracks/${randomUUID()}.${type.ext}`;
  await s3.putObject({ Bucket: 'sky-media', Key: key, Body: buf });
  res.json({ url: `https://cdn.skymessenger.online/${key}` });
});
```

---

## 7. SQL INJECTION / XSS ЗАЩИТА
```typescript
// Всегда prepared statements через Prisma или pg
const user = await prisma.user.findUnique({
  where: { username: req.body.username } // безопасно
});

// Никогда:
// db.query(`SELECT * FROM users WHERE username = '${req.body.username}'`)

// Helmet для HTTP заголовков:
import helmet from 'helmet';
app.use(helmet());

// Input валидация через Zod:
import { z } from 'zod';
const LoginSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-z0-9_]+$/),
  password: z.string().min(6).max(128),
});
app.post('/api/auth/login', (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  // ...
});
```

---

## 8. ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (.env)
```env
DATABASE_URL=postgresql://sky:STRONG_PASS@localhost:5432/skydb
REDIS_URL=redis://localhost:6379
JWT_SECRET=<64-char-random-hex>
ENCRYPTION_KEY=<32-byte-hex>
TWILIO_SID=ACxxxxxxxxxx
TWILIO_TOKEN=xxxxxxxxxx
TWILIO_FROM=+7xxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxx
S3_BUCKET=sky-media
S3_REGION=ru-central1
S3_ENDPOINT=https://storage.yandexcloud.net
```
Никогда не коммитить .env в git! Добавить в .gitignore.

---

## 9. ЗАГЛУШКИ → СЕРВЕРНЫЕ РЕАЛИЗАЦИИ

| Функция | Сейчас (локально) | На сервере |
|---|---|---|
| SMS верификация | заглушка | Twilio / СМСРУ |
| Push уведомления | browser Notification API | Firebase FCM / APNs |
| Аудио файлы треков | localStorage blob URL | S3/MinIO + CDN |
| Платежи | mock spend() | ЮKassa / Robokassa |
| WebSocket чат | localStorage polling | Socket.io / ws |
| E2E шифрование | открытый текст | Signal Protocol / libsodium |
| Авторские документы | имя файла | S3 encrypted + admin-only URLs |
| Прокси VLESS/Trojan | WS в браузере | Xray-core на VPS |
| Поиск | фильтр массива | Meilisearch / Elasticsearch |
| Аналитика | моки | ClickHouse / Plausible |

---

## 10. БЭКАП
```bash
# cron: каждые 6 часов
0 */6 * * * pg_dump $DATABASE_URL | gzip > /backups/sky-$(date +%Y%m%d-%H%M).sql.gz
# Хранить 30 дней, старые удалять
find /backups -mtime +30 -delete
```
