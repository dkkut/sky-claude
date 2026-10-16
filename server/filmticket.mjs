/**
 * Пропуск для видео.
 *
 * Тот же приём, что и в музыке, и по той же причине: всё API просит
 * заголовок Authorization, а тег <video> и <img> его отправить не
 * умеют — адрес в src браузер тянет сам, и заголовок туда не
 * подставить. Значит, фильм и постер нельзя защитить тем же способом,
 * что и остальные ручки.
 *
 * Решение — короткий подписанный пропуск в httpOnly-куке, ограниченной
 * путём /api/film. Он не заменяет сессию: им нельзя ни войти, ни
 * что-либо изменить, он только говорит выдаче файлов, чей это запрос.
 * Права после этого всё равно проверяются по базе, для каждого куска
 * каждого фильма.
 *
 * Пропуск музыки сюда не подойдёт и наоборот: в подпись входит своя
 * пометка назначения, а кука музыки ограничена путём /api/music и до
 * кино просто не доедет.
 */
import crypto from 'node:crypto';
import { ticketAcceptable } from './skystoragestate.mjs';
import { config } from './config.mjs';

const COOKIE = 'sky_film';
/**
 * Шесть часов. Фильм длиннее одного пропуска не бывает, а держать
 * действующий пропуск дольше сеанса просмотра незачем: украденная кука
 * должна протухать сама.
 */
const TTL_SEC = 6 * 60 * 60;
const CONTEXT = 'sky:film-ticket:v1';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

const sign = (payload) => crypto
  .createHmac('sha256', `${config.jwtSecret}:${CONTEXT}`)
  .update(payload)
  .digest('base64url');

/** Пропуск для профиля: кто смотрит и до какого времени. */
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
    // Путь узкий намеренно: кука уходит только к выдаче кино.
    'Path=/api/film',
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
