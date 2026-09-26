/**
 * KutRent Market — HTTP-ручки сайта-партнёра (market.kutrent.online).
 *
 * Все пути под /api/kutrent-market/*. Nginx-вхост market.kutrent.online
 * проксирует их на этот же процесс api (см. nginx/templates/market.conf.template) —
 * отдельного backend-сервиса для сайта нет, это тот же Sky API.
 *
 * Посетитель сайта не входит в Sky ID: у него простая анонимная кука
 * с ID сессии (см. kutrentmarket.mjs::ensureSession) — только для
 * «Профиля»/«Заказов» этого браузера. Требовать здесь Sky-сессию было
 * бы неверно: пополнять чужой Sky-баланс можно и не будучи сам
 * пользователем Sky.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { can } from './../admin.mjs';
import {
  ensureSession, findRecipient, createSkyTopupOrder, getOrder, listOrders, adminMarkPaid,
} from './../kutrentmarket.mjs';
import { rateLimit } from './../security.mjs';

const KRM_COOKIE = 'krm_sid';

const readSessionId = (req) => {
  const header = req.headers.cookie ?? '';
  const m = header.match(/(?:^|;\s*)krm_sid=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

const sessionCookie = (id) => [
  `${KRM_COOKIE}=${encodeURIComponent(id)}`,
  'Path=/', 'Max-Age=31536000', 'HttpOnly', 'Secure', 'SameSite=Lax',
].join('; ');

export const kutrentMarketRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/kutrent-market/')) return false;

  // Заводим/продлеваем анонимную сессию на любой запрос этого раздела —
  // проще, чем отдельная ручка «войти», и с той же кукой Lax-SameSite
  // (переход по ссылке с другого сайта её несёт, обычный fetch тоже).
  const sessionId = await ensureSession(readSessionId(req));
  const withCookie = (status, body) => {
    res.setHeader('Set-Cookie', sessionCookie(sessionId));
    return json(res, status, body);
  };

  if (req.method === 'GET' && url === '/api/kutrent-market/session') {
    const orders = await listOrders(sessionId);
    return withCookie(200, { sessionId, orders });
  }

  if (req.method === 'GET' && url === '/api/kutrent-market/recipient') {
    if (!rateLimit(`krm:recipient:${sessionId}`, 30)) return json(res, 429, { error: 'rate_limited' });
    const q = new URL(req.url || '/', 'http://sky.local').searchParams.get('username') ?? '';
    const r = await findRecipient(q);
    return withCookie(200, r?.found
      ? { found: true, username: r.username, name: r.name }
      : { found: false });
  }

  if (req.method === 'POST' && url === '/api/kutrent-market/sky-topup') {
    if (!rateLimit(`krm:topup:${sessionId}`, 10)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const result = await createSkyTopupOrder(sessionId, {
      amountRub: body.amount, recipientUsername: body.username,
    });
    return withCookie(result.error ? 400 : 201, result);
  }

  if (req.method === 'GET' && url.startsWith('/api/kutrent-market/orders/')) {
    const id = url.slice('/api/kutrent-market/orders/'.length);
    const order = await getOrder(sessionId, id);
    return withCookie(order ? 200 : 404, order ? { order } : { error: 'not_found' });
  }

  if (req.method === 'GET' && url === '/api/kutrent-market/orders') {
    return withCookie(200, { orders: await listOrders(sessionId) });
  }

  // Ручное подтверждение оплаты, пока не подключена ни одна касса —
  // только для администратора Sky (не для посетителя сайта), см.
  // kutrentmarket.mjs::adminMarkPaid.
  if (req.method === 'POST' && url.startsWith('/api/kutrent-market/admin/orders/') && url.endsWith('/mark-paid')) {
    const session = await requireProfile(req, res);
    if (!session) return true;
    if (!(await can(session.profileId, 'finance'))) return json(res, 403, { error: 'not_allowed' });
    const id = url.slice('/api/kutrent-market/admin/orders/'.length, -'/mark-paid'.length);
    const result = await adminMarkPaid(id);
    return json(res, result.error ? 400 : 200, result);
  }

  return json(res, 404, { error: 'not_found' });
};
