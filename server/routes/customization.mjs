/**
 * Маркет кастомизации — каталог цен, инвентарь, экипировка, покупка.
 * Внешний вид предметов клиент знает сам (src/customization/catalog/*);
 * сервер отдаёт только то, что раньше жило в localStorage и ничего не
 * значило: кто чем владеет, что надето, и списывает ли покупка баллы.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import {
  listCatalog, myInventory, myEquipped, equipItem, equippedOf, purchaseItem, CATEGORIES,
  adminListCatalog, adminSetPrice, adminSetActive, adminGrantItem,
} from './../customization.mjs';

const READ_PER_MIN = 120;
const WRITE_PER_MIN = 30;

const errCode = (error) => (
  error === 'not_found' ? 404
    : error === 'not_owned' ? 403
      : error === 'already_owned' || error === 'already_sold' ? 409
        : error === 'insufficient_points' ? 402
          : error === 'not_allowed' ? 403
            : 400
);

export const customizationRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/customization')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  if (req.method === 'GET' && url === '/api/customization/catalog') {
    if (!rateLimit(`cust:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { catalog: await listCatalog() });
  }

  if (req.method === 'GET' && url === '/api/customization/mine') {
    if (!rateLimit(`cust:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const [inventory, equipped] = await Promise.all([myInventory(me), myEquipped(me)]);
    return json(res, 200, { inventory, equipped });
  }

  if (req.method === 'GET' && url.startsWith('/api/customization/of')) {
    if (!rateLimit(`cust:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const ids = String(new URL(req.url, 'http://x').searchParams.get('ids') ?? '').split(',')
      .map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{3,80}$/.test(x));
    return json(res, 200, { equipped: await equippedOf(ids) });
  }

  if (req.method === 'POST' && url === '/api/customization/equip') {
    if (!rateLimit(`cust:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const b = await parseBody(req);
    const category = String(b.category ?? '');
    if (!CATEGORIES.includes(category)) return json(res, 400, { error: 'bad_category' });
    const itemId = b.itemId === null ? null : String(b.itemId ?? '');
    const r = await equipItem(me, category, itemId);
    return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
  }

  if (req.method === 'POST' && url === '/api/customization/buy') {
    if (!rateLimit(`cust:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const b = await parseBody(req);
    const r = await purchaseItem(me, String(b.itemId ?? ''), { idempotencyKey: b.idempotencyKey });
    return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
  }

  /* ─── Админка: тот же каталог, что на витрине, только с ценой и
     признаком, уже продавался ли предмет (меняет can(me,'content'),
     как и Sky Skin Market). ─── */

  if (req.method === 'GET' && url === '/api/customization/admin/catalog') {
    if (!rateLimit(`cust:admin:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await adminListCatalog(me);
    return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
  }

  const priceMatch = /^\/api\/customization\/admin\/catalog\/([a-z0-9-]{3,60})\/price$/.exec(url);
  if (priceMatch && req.method === 'POST') {
    if (!rateLimit(`cust:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const b = await parseBody(req);
    const r = await adminSetPrice(me, priceMatch[1], b.pricePoints);
    return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
  }

  const activeMatch = /^\/api\/customization\/admin\/catalog\/([a-z0-9-]{3,60})\/active$/.exec(url);
  if (activeMatch && req.method === 'POST') {
    if (!rateLimit(`cust:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const b = await parseBody(req);
    const r = await adminSetActive(me, activeMatch[1], Boolean(b.active));
    return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
  }

  if (req.method === 'POST' && url === '/api/customization/admin/grant') {
    if (!rateLimit(`cust:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const b = await parseBody(req);
    const r = await adminGrantItem(me, String(b.profileId ?? ''), String(b.itemId ?? ''));
    return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
  }

  return json(res, 404, { error: 'not_found' });
};
