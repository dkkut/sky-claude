/**
 * KutRent Market — HTTP-ручки сайта-партнёра (market.kutrent.online).
 *
 * Все пути под /api/kutrent-market/*. Nginx-вхост market.kutrent.online
 * проксирует их на этот же процесс api (см. nginx/market-template/market.conf.template)
 * — отдельного backend-сервиса для сайта нет, это тот же Sky API; тот
 * же общий location ^~ /api/ есть и на основном домене (sky.conf.template),
 * поэтому /sso/start ниже доступен оттуда тоже — это и нужно, именно
 * там есть настоящая Sky-сессия.
 *
 * Вход — только через Sky ID. Посетитель без Sky ID ничего не может
 * сделать на этом сайте, кроме как прочитать документы и попытаться
 * войти — ни анонимной кассы, ни произвольного получателя по нику
 * здесь больше нет (см. server/kutrentmarket.mjs).
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { can } from './../admin.mjs';
import { config } from './../config.mjs';
import { wallet } from './../wallet.mjs';
import {
  issueSsoToken, consumeSsoToken, createMarketSession, marketUserForSession,
  revokeMarketSession, createSkyTopupOrder, getOrder, listOrders,
  adminSearchUsers, adminGetUser, adminListOrders, setMarketUserStatus,
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

const clearCookie = () => [`${KRM_COOKIE}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'Secure', 'SameSite=Lax'].join('; ');

/** market.kutrent.online — и только он: редирект с SSO-токеном никогда
 *  не должен уйти куда-то ещё, что бы ни прислал клиент в query. */
const marketOriginAllowed = (origin) => Boolean(config.marketOrigin) && origin === config.marketOrigin;

export const kutrentMarketRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/kutrent-market/')) return false;

  /* Адрес основного сайта Sky — не секрет (это просто адрес сайта),
     нужен статическому market-site/app.js, чтобы собрать ссылку
     «Войти через Sky ID» без хардкода домена в самом HTML/JS. */
  if (req.method === 'GET' && url === '/api/kutrent-market/config') {
    return json(res, 200, { skyOrigin: config.publicOrigin });
  }

  /*
   * Передача личности с основного домена.
   *
   * Требует настоящей Sky-сессии (requireProfile) — её на
   * market.kutrent.online взять неоткуда, вызывается это только со
   * страницы на основном домене. Возвращает одноразовый токен, а не
   * сам готовый адрес редиректа: куда идти — решает клиент (он уже
   * знает return, здесь он только проверяется), сервер не собирает
   * чужую ссылку из query.
   */
  if (req.method === 'POST' && url === '/api/kutrent-market/sso/start') {
    const session = await requireProfile(req, res);
    if (!session) return true;
    if (!rateLimit(`krm:sso:${session.profileId}`, 10)) return json(res, 429, { error: 'rate_limited' });

    const body = await parseBody(req);
    const origin = String(body.returnOrigin ?? '');
    if (!marketOriginAllowed(origin)) return json(res, 400, { error: 'bad_return_origin' });

    const token = await issueSsoToken(session.profileId);
    return json(res, 200, { token });
  }

  /*
   * Погашение токена на market.kutrent.online: заводит (или находит)
   * пользователя Market и настоящую сессию сайта. Без Sky-сессии —
   * её здесь и не может быть, весь смысл токена в том, что он сам
   * доказывает личность.
   */
  if (req.method === 'POST' && url === '/api/kutrent-market/sso/consume') {
    if (!rateLimit(`krm:sso-consume:${req.socket.remoteAddress || 'unknown'}`, 20)) {
      return json(res, 429, { error: 'rate_limited' });
    }
    const body = await parseBody(req);
    const result = await consumeSsoToken(body.token);
    if (result.error) return json(res, 400, { error: result.error });

    const sessionId = await createMarketSession(result.marketUser.id);
    res.setHeader('Set-Cookie', sessionCookie(sessionId));
    return json(res, 200, {
      ok: true,
      authenticator: result.marketUser.authenticator,
      username: result.profile.username,
      name: result.profile.name,
    });
  }

  /* Всё, что ниже, требует настоящей сессии сайта — заведённой только
     через /sso/consume выше, никак иначе. */
  const sessionId = readSessionId(req);
  const isAdminPath = url.startsWith('/api/kutrent-market/admin/');

  if (!isAdminPath) {
    const me = sessionId ? await marketUserForSession(sessionId) : null;
    if (!me) return json(res, 401, { error: 'not_logged_in' });

    if (req.method === 'GET' && url === '/api/kutrent-market/me') {
      const state = await wallet.getState(me.profile_id, 0);
      return json(res, 200, {
        authenticator: me.authenticator, username: me.username, name: me.name,
        balance: state.balance, createdAt: me.created_at.toISOString(),
      });
    }

    if (req.method === 'POST' && url === '/api/kutrent-market/logout') {
      await revokeMarketSession(sessionId);
      res.setHeader('Set-Cookie', clearCookie());
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url === '/api/kutrent-market/sky-topup') {
      if (!rateLimit(`krm:topup:${me.id}`, 10)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const result = await createSkyTopupOrder(me, body.amount);
      return json(res, result.error ? 400 : 201, result);
    }

    if (req.method === 'GET' && url.startsWith('/api/kutrent-market/orders/')) {
      const id = url.slice('/api/kutrent-market/orders/'.length);
      const order = await getOrder(me.id, id);
      return json(res, order ? 200 : 404, order ? { order } : { error: 'not_found' });
    }

    if (req.method === 'GET' && url === '/api/kutrent-market/orders') {
      return json(res, 200, { orders: await listOrders(me.id) });
    }

    return json(res, 404, { error: 'not_found' });
  }

  /*
   * Админ-панель Sky, вкладка «KutRent Market» — просмотр только,
   * право 'kutrent_market'. Единственное действие, меняющее баланс
   * (подтвердить оплату вручную, пока не подключена касса), не живёт
   * здесь вовсе: это WS 'admin' action 'kutrent-mark-paid' в
   * server/signal.mjs → заявка в adminsec.mjs → второй ключ владельца,
   * тот же путь, что у любого другого начисления денег из ничего.
   */
  if (isAdminPath) {
    const session = await requireProfile(req, res);
    if (!session) return true;
    if (!(await can(session.profileId, 'kutrent_market'))) return json(res, 403, { error: 'not_allowed' });

    const qs = new URLSearchParams((req.url.split('?')[1] || ''));

    if (req.method === 'GET' && url === '/api/kutrent-market/admin/users') {
      const users = await adminSearchUsers(qs.get('q'), qs.get('limit'));
      return json(res, 200, { users });
    }

    if (req.method === 'GET' && url.startsWith('/api/kutrent-market/admin/users/')) {
      const id = url.slice('/api/kutrent-market/admin/users/'.length);
      const user = await adminGetUser(id);
      return json(res, user ? 200 : 404, user ? { user } : { error: 'not_found' });
    }

    /* Приостановка/восстановление требует права 'finance' — та же
       планка, что у остальных действий, задевающих деньги человека:
       приостановленный Market-аккаунт не может пополнить себя, пока
       его не вернут обратно. */
    if (req.method === 'POST' && url.startsWith('/api/kutrent-market/admin/users/') && url.endsWith('/status')) {
      if (!(await can(session.profileId, 'finance'))) return json(res, 403, { error: 'not_allowed' });
      const id = url.slice('/api/kutrent-market/admin/users/'.length, -'/status'.length);
      const body = await parseBody(req);
      const result = await setMarketUserStatus(id, body.status);
      return json(res, result.error ? 400 : 200, result);
    }

    if (req.method === 'GET' && url === '/api/kutrent-market/admin/orders') {
      const orders = await adminListOrders({ status: qs.get('status'), q: qs.get('q'), limit: qs.get('limit') });
      return json(res, 200, { orders });
    }

    return json(res, 404, { error: 'not_found' });
  }

  return json(res, 404, { error: 'not_found' });
};
