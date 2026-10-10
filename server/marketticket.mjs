/**
 * Пропуск для картинок маркета, карт, видеообзоров складов и
 * доказательств по нарушениям.
 *
 * Тот же приём, что в кино и в музыке, и по той же причине: всё API
 * просит заголовок Authorization, а теги <img> и <video> его отправить
 * не умеют — адрес в src браузер тянет сам, и заголовок туда не
 * подставить.
 *
 * Без этого пропуска картинок маркета в браузере не было вовсе: каждый
 * <img> получал в ответ 401, срабатывала подстановка «картинка не
 * загрузилась», и витрина стояла с серыми прямоугольниками вместо
 * товара. В проверках это не всплывало, потому что они читают текст, а
 * не смотрят на страницу.
 *
 * Пропуск — короткая подписанная строка в httpOnly-куке. Он не заменяет
 * сессию: им нельзя ни войти, ни что-либо изменить, он только говорит
 * выдаче файлов, чей это запрос. Права после этого всё равно
 * проверяются по базе, для каждой картинки: снятый с витрины товар не
 * открывается по пропуску так же, как не открывался по токену.
 *
 * Пропуск кино сюда не подойдёт и наоборот: в подпись входит своя
 * пометка назначения, и подделать одну из другой нельзя.
 */
import crypto from 'node:crypto';
import { config } from './config.mjs';

const COOKIE = 'sky_market';
/**
 * Шесть часов. Дольше одного захода в маркет незачем: украденная кука
 * должна протухать сама.
 */
const TTL_SEC = 6 * 60 * 60;
const CONTEXT = 'sky:market-ticket:v1';

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
    return String(data.p);
  } catch {
    return null;
  }
};

/**
 * Кука пропуска.
 *
 * Путь здесь шире, чем у кино, потому что картинки лежат в трёх местах:
 * товары и магазины в /api/market, фотографии складов и видеообзоры в
 * /api/logistics, карта в /api/maps. Сузить путь до одного из них
 * значит выдавать три куки на три тех же права — а права всё равно
 * проверяются по базе на каждой картинке.
 */
const PATHS = ['/api/market', '/api/logistics', '/api/maps', '/api/violations', '/api/blox'];

/** Тикет можно передать готовым — см. musicticket.mjs::ticketCookie. */
export const ticketCookies = (profileId, ticket = issueTicket(profileId)) => {
  const value = ticket;
  return PATHS.map((path) => {
    const parts = [
      `${COOKIE}=${value}`,
      'HttpOnly',
      'SameSite=Strict',
      `Path=${path}`,
      `Max-Age=${TTL_SEC}`,
    ];
    if (config.nodeEnv === 'production') parts.push('Secure');
    return parts.join('; ');
  });
};

export const ticketFromCookies = (cookieHeader) => {
  const raw = String(cookieHeader ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  return raw ? readTicket(raw.slice(COOKIE.length + 1)) : null;
};
