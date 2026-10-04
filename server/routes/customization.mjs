/**
 * Маркет кастомизации — каталог цен, инвентарь, экипировка, покупка.
 * Внешний вид предметов клиент знает сам (src/customization/catalog/*);
 * сервер отдаёт только то, что раньше жило в localStorage и ничего не
 * значило: кто чем владеет, что надето, и списывает ли покупка баллы.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import {
  listCatalog, myInventory, myEquipped, equipItem, purchaseItem, CATEGORIES,
} from './../customization.mjs';

const READ_PER_MIN = 120;
const WRITE_PER_MIN = 30;

const errCode = (error) => (
  error === 'not_found' ? 404
    : error === 'not_owned' ? 403
      : error === 'already_owned' ? 409
        : error === 'insufficient_points' ? 402
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

  return json(res, 404, { error: 'not_found' });
};
