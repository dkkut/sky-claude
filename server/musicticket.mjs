/**
 * Пропуск для медиа.
 *
 * Зачем он вообще нужен. Всё API просит заголовок Authorization, но
 * элемент <audio> и тег <img> его отправить не умеют — браузер тянет
 * такие адреса сам, и заголовок туда не подставить. Поэтому звук и
 * обложки нельзя защитить тем же способом, что и остальные ручки.
 *
 * Решение — короткий подписанный пропуск в httpOnly-куке, ограниченной
 * путём /api/music. Он не заменяет сессию: им нельзя ни войти, ни
 * что-либо изменить, он только говорит выдаче файлов, чей это запрос.
 * Подпись своя, с отдельной пометкой назначения, поэтому пропуск не
 * спутать с токеном доступа и наоборот.
 */
import crypto from 'node:crypto';
import { config } from './config.mjs';

const COOKIE = 'sky_media';
/** Пропуск живёт шесть часов: дольше одного сеанса прослушивания незачем. */
const TTL_SEC = 6 * 60 * 60;
const CONTEXT = 'sky:media-ticket:v1';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

const sign = (payload) => crypto
  .createHmac('sha256', `${config.jwtSecret}:${CONTEXT}`)
  .update(payload)
  .digest('base64url');

/** Пропуск для профиля: кто слушает и до какого времени. */
export const issueTicket = (profileId) => {
  const body = b64u(JSON.stringify({ p: profileId, e: Math.floor(Date.now() / 1000) + TTL_SEC }));
  return `${body}.${sign(body)}`;
};

/**
 * Профиль из пропуска — или null. Сравнение подписей идёт побайтово
 * постоянным временем: обычное равенство строк подсказывает длину
 * совпадения по времени ответа.
 */
export const readTicket = (raw) => {
  const value = String(raw ?? '');
  const dot = value.indexOf('.');
  if (dot <= 0) return null;

  const body = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const want = Buffer.from(sign(body));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data?.p || typeof data.e !== 'number') return null;
    if (data.e < Math.floor(Date.now() / 1000)) return null;
    return String(data.p);
  } catch {
    return null;
  }
};

export const ticketCookie = (profileId) => {
  const parts = [
    `${COOKIE}=${issueTicket(profileId)}`,
    'HttpOnly',
    'SameSite=Strict',
    // Путь узкий намеренно: кука уходит только к выдаче музыки.
    'Path=/api/music',
    `Max-Age=${TTL_SEC}`,
  ];
  if (config.nodeEnv === 'production') parts.push('Secure');
  return parts.join('; ');
};

export const ticketFromCookies = (cookieHeader) => {
  const raw = String(cookieHeader ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  return raw ? readTicket(raw.slice(COOKIE.length + 1)) : null;
};
