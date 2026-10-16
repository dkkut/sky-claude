/**
 * Пропуск для медиа рекламных материалов Sky Ads.
 *
 * Тот же приём, что у кино (filmticket.mjs) и Sky Video
 * (skyvideoticket.mjs), и по той же причине: тег <img>/<video> не умеет
 * отправлять заголовок Authorization, а адрес в src браузер тянет сам.
 * Пропуск другого раздела сюда не подойдёт и наоборот: в подпись
 * входит своя пометка назначения, а кука ограничена своим путём.
 */
import crypto from 'node:crypto';
import { ticketAcceptable } from './skystoragestate.mjs';
import { config } from './config.mjs';

const COOKIE = 'sky_ads';
const TTL_SEC = 6 * 60 * 60;
const CONTEXT = 'sky:ads-ticket:v1';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

const sign = (payload) => crypto
  .createHmac('sha256', `${config.jwtSecret}:${CONTEXT}`)
  .update(payload)
  .digest('base64url');

export const issueTicket = (profileId) => {
  const body = b64u(JSON.stringify({ p: profileId, e: Math.floor(Date.now() / 1000) + TTL_SEC }));
  return `${body}.${sign(body)}`;
};

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
    // Sky Storage: пропуска, выданные до отметки «не раньше», и слишком старые в режиме строгой авторизации — недействительны.
    if (!ticketAcceptable(data.e, TTL_SEC)) return null;
    return String(data.p);
  } catch {
    return null;
  }
};

/** Тикет можно передать готовым — см. musicticket.mjs::ticketCookie. */
export const ticketCookie = (profileId, ticket = issueTicket(profileId)) => {
  const parts = [
    `${COOKIE}=${ticket}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api/ads',
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
