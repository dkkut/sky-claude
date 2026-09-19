/**
 * Sky ПВЗ: владение, сотрудники, ячейки, ключи, QR заказа,
 * безопасная выдача, комиссия — по HTTP.
 *
 * Здесь только вход: кто спрашивает, не слишком ли часто и той ли формы
 * идентификатор. Кому что можно решает pvzops.mjs — каждая ручка ниже
 * лишь передаёт туда actorId, который взят из токена, и параметры пути.
 * buyerId, роль «от себя» и прежнее состояние отсюда не читаются
 * никогда: цепочку сотрудник → точка → заказ → ячейка сервер строит сам.
 *
 * Поставки (несколько заказов одним разом) и приёмка по QR — в
 * pvzshipments.mjs / routes/pvzshipments.mjs, отдельно: там другой
 * род запросов и другая сущность.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  PVZ_ID_RE, CELL_ID_RE, KEY_ID_RE, STAFF_ID_RE, PERMISSIONS, ROLES,
  PVZ_SUBSCRIPTION_PRICE, PVZ_OWNER_COMMISSION_PERCENT,
  myPvzMemberships, pvzOverview, listStaff, addStaff, revokeStaff, setStaffClosed,
  createPvz, activatePvzSubscription,
  listCells, upsertCell, setCellStatus, reserveCell,
  receiveOrder, placeInCell, verifyPickup,
  listKeys, createKey, issueKeyToStaff, returnKeyFromStaff, reportKeyLost,
  auditFor, sellerOrderQr, commissionsForOwner, commissionsForSeller,
  declareCommissionPaid, disputeCommission,
} from './../pvzops.mjs';

const READ_PER_MIN = 120;
const WRITE_PER_MIN = 60;
/** Код/QR получения — без жёсткого предела их можно перебрать. */
const ISSUE_PER_HOUR = 20;

const CODES = {
  not_found: 404,
  not_allowed: 403,
  bad_profile: 400,
  bad_permissions: 400,
  bad_role: 400,
  bad_pvz: 400,
  bad_cell: 400,
  bad_holder: 400,
  bad_code: 401,
  bad_status: 400,
  cell_occupied: 409,
  cell_not_free: 409,
  cell_reserved_for_other: 409,
  cell_has_no_key: 409,
  key_already_exists: 409,
  key_not_available: 409,
  key_not_issued: 409,
  order_already_placed: 409,
  wrong_state: 409,
  last_owner: 409,
  insufficient_funds: 402,
};

const fail = (res, result) => json(res, CODES[result.error] ?? 400, { error: result.error });

export const pvzRoutes = async (req, res, path) => {
  if (!path.startsWith('/api/pvz')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  const readOk = () => rateLimit(`pvz:r:${me}`, READ_PER_MIN);
  const writeOk = () => rateLimit(`pvz:w:${me}`, WRITE_PER_MIN);
  const body = async () => parseBody(req);

  if (req.method === 'GET' && path === '/api/pvz/mine') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { pvzs: await myPvzMemberships(me) });
  }

  if (req.method === 'POST' && path === '/api/pvz') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await createPvz(me, b);
    return done.error ? fail(res, done) : json(res, 201, { ...done, price: PVZ_SUBSCRIPTION_PRICE });
  }

  if (req.method === 'GET' && path === '/api/pvz/config') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { subscriptionPrice: PVZ_SUBSCRIPTION_PRICE, commissionPercent: PVZ_OWNER_COMMISSION_PERCENT, roles: ROLES });
  }

  /* ── QR заказа — продавец, из карточки заказа ─────────────────────── */

  const orderQr = path.match(/^\/api\/pvz\/orders\/(mo-[0-9a-f-]{36})\/qr$/);
  if (orderQr) {
    if (req.method === 'GET') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await sellerOrderQr(orderQr[1], me);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await sellerOrderQr(orderQr[1], me, { regenerate: true });
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  /* ── Комиссия владельцу точки ─────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/pvz/commissions/owner') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { commissions: await commissionsForOwner(me) });
  }
  if (req.method === 'GET' && path === '/api/pvz/commissions/seller') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { commissions: await commissionsForSeller(me) });
  }
  const commissionPaid = path.match(/^\/api\/pvz\/commissions\/(mpc-[0-9a-f-]{36})\/paid$/);
  if (req.method === 'POST' && commissionPaid) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await declareCommissionPaid(commissionPaid[1], me);
    return done.error ? fail(res, done) : json(res, 200, done);
  }
  const commissionDispute = path.match(/^\/api\/pvz\/commissions\/(mpc-[0-9a-f-]{36})\/dispute$/);
  if (req.method === 'POST' && commissionDispute) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await disputeCommission(commissionDispute[1], me);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  const pvzMatch = path.match(/^\/api\/pvz\/(mpp-[0-9a-f-]{36})(\/.*)?$/);
  if (!pvzMatch) return false;
  const pvzId = pvzMatch[1];
  const rest = pvzMatch[2] ?? '';
  if (!PVZ_ID_RE.test(pvzId)) return false;

  if (req.method === 'GET' && rest === '') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const overview = await pvzOverview(pvzId, me);
    return overview ? json(res, 200, { pvz: overview }) : json(res, 404, { error: 'not_found' });
  }

  if (req.method === 'POST' && rest === '/activate') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await activatePvzSubscription(pvzId, me);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  if (req.method === 'POST' && rest === '/closed') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await setStaffClosed(pvzId, me, b.closed === true, b.reason);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ── Сотрудники ──────────────────────────────────────────────────── */

  if (req.method === 'GET' && rest === '/staff') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const list = await listStaff(pvzId, me);
    return list === null ? json(res, 403, { error: 'not_allowed' }) : json(res, 200, { staff: list });
  }
  if (req.method === 'POST' && rest === '/staff') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await addStaff(pvzId, me, b.profileId, b.role);
    return done.error ? fail(res, done) : json(res, 201, done);
  }
  const staffRevoke = rest.match(/^\/staff\/(pzs-[0-9a-f-]{36})\/revoke$/);
  if (req.method === 'POST' && staffRevoke) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    if (!STAFF_ID_RE.test(staffRevoke[1])) return json(res, 404, { error: 'not_found' });
    const done = await revokeStaff(pvzId, me, staffRevoke[1]);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ── Ячейки ──────────────────────────────────────────────────────── */

  if (req.method === 'GET' && rest === '/cells') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const list = await listCells(pvzId, me);
    return list === null ? json(res, 403, { error: 'not_allowed' }) : json(res, 200, { cells: list });
  }
  if (req.method === 'POST' && rest === '/cells') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await upsertCell(pvzId, me, b);
    return done.error ? fail(res, done) : json(res, 201, done);
  }
  const cellStatus = rest.match(/^\/cells\/(pzc-[0-9a-f-]{36})\/status$/);
  if (req.method === 'POST' && cellStatus) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await setCellStatus(pvzId, me, cellStatus[1], b.status, b.reason);
    return done.error ? fail(res, done) : json(res, 200, done);
  }
  const cellReserve = rest.match(/^\/cells\/(pzc-[0-9a-f-]{36})\/reserve$/);
  if (req.method === 'POST' && cellReserve) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await reserveCell(pvzId, me, b.orderId, cellReserve[1]);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ── Приём / размещение / выдача заказа ─────────────────────────── */

  const orderReceive = rest.match(/^\/orders\/(mo-[0-9a-f-]{36})\/receive$/);
  if (req.method === 'POST' && orderReceive) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await receiveOrder(pvzId, me, orderReceive[1]);
    return done.error ? fail(res, done) : json(res, 200, done);
  }
  const orderPlace = rest.match(/^\/orders\/(mo-[0-9a-f-]{36})\/place$/);
  if (req.method === 'POST' && orderPlace) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await placeInCell(pvzId, me, orderPlace[1], b.cellId);
    return done.error ? fail(res, done) : json(res, 200, done);
  }
  const orderIssue = rest.match(/^\/orders\/(mo-[0-9a-f-]{36})\/issue$/);
  if (req.method === 'POST' && orderIssue) {
    if (!rateLimitPerHour(`pvz:issue:${pvzId}:${orderIssue[1]}`, ISSUE_PER_HOUR)
      || !rateLimitPerHour(`pvz:issue:${me}`, ISSUE_PER_HOUR * 4)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    const b = await body();
    /* Покупатель показывает либо QR получения (b.qr — приоритетно),
       либо называет код вслух (b.code) — второй фактор на случай, если
       сканер недоступен. verifyPickup разбирает сама, что пришло. */
    const done = await verifyPickup(pvzId, me, orderIssue[1], b.qr || b.code);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ── Ключи ───────────────────────────────────────────────────────── */

  if (req.method === 'GET' && rest === '/keys') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const list = await listKeys(pvzId, me);
    return list === null ? json(res, 403, { error: 'not_allowed' }) : json(res, 200, { keys: list });
  }
  if (req.method === 'POST' && rest === '/keys') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await createKey(pvzId, me, b.cellId);
    return done.error ? fail(res, done) : json(res, 201, done);
  }
  const keyIssue = rest.match(/^\/keys\/(pzk-[0-9a-f-]{36})\/issue$/);
  if (req.method === 'POST' && keyIssue) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await issueKeyToStaff(pvzId, me, keyIssue[1], b.toProfileId);
    return done.error ? fail(res, done) : json(res, 200, done);
  }
  const keyReturn = rest.match(/^\/keys\/(pzk-[0-9a-f-]{36})\/return$/);
  if (req.method === 'POST' && keyReturn) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await returnKeyFromStaff(pvzId, me, keyReturn[1]);
    return done.error ? fail(res, done) : json(res, 200, done);
  }
  const keyLost = rest.match(/^\/keys\/(pzk-[0-9a-f-]{36})\/lost$/);
  if (req.method === 'POST' && keyLost) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await reportKeyLost(pvzId, me, keyLost[1]);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  /* ── Журнал ──────────────────────────────────────────────────────── */

  if (req.method === 'GET' && rest === '/audit') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const list = await auditFor(pvzId, me, { limit: new URL(req.url, 'http://x').searchParams.get('limit') });
    return list === null ? json(res, 403, { error: 'not_allowed' }) : json(res, 200, { entries: list });
  }

  return false;
};

export { PERMISSIONS as PVZ_PERMISSIONS, CELL_ID_RE, KEY_ID_RE };
