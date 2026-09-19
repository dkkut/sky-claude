/**
 * Поставка в ПВЗ и приёмка по QR — по HTTP.
 *
 * Права и всю цепочку проверок решает pvzshipments.mjs; здесь только
 * вход. Смотри его собственный заголовок про три уровня QR.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import {
  SHIPMENT_ID_RE,
  createShipment, addOrderToShipment, removeOrderFromShipment,
  myShipments, shipmentDetail, shipmentQr, confirmDispatch,
  pendingShipmentsForPvz, openShipmentByQr, scanShipmentOrder,
  manualReceiveOrder, confirmReceipt, unmatchedScans, resolveUnmatchedScan,
} from './../pvzshipments.mjs';
import { PVZ_ID_RE } from './../pvzops.mjs';

const READ_PER_MIN = 120;
const WRITE_PER_MIN = 60;
const SCAN_PER_MIN = 120;

const CODES = {
  not_found: 404,
  not_allowed: 403,
  bad_pvz: 400,
  bad_order: 400,
  bad_qr: 400,
  wrong_state: 409,
  wrong_pvz: 409,
  wrong_order_state: 409,
  already_in_shipment: 409,
  already_received: 409,
  not_in_shipment: 409,
  order_closed: 409,
  empty_shipment: 409,
  incomplete: 409,
};

const fail = (res, result) => json(res, CODES[result.error] ?? 400, { error: result.error });

export const pvzShipmentRoutes = async (req, res, path) => {
  if (!path.startsWith('/api/pvz')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  const readOk = () => rateLimit(`pvzs:r:${me}`, READ_PER_MIN);
  const writeOk = () => rateLimit(`pvzs:w:${me}`, WRITE_PER_MIN);
  const scanOk = () => rateLimit(`pvzs:scan:${me}`, SCAN_PER_MIN);
  const body = async () => parseBody(req);

  /* ── Продавец: свои поставки ──────────────────────────────────────── */

  if (req.method === 'POST' && path === '/api/pvz/shipments') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await createShipment(me, await body());
    return done.error ? fail(res, done) : json(res, 201, done);
  }
  if (req.method === 'GET' && path === '/api/pvz/shipments/mine') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const status = new URL(req.url, 'http://x').searchParams.get('status') || undefined;
    return json(res, 200, { shipments: await myShipments(me, { status }) });
  }

  const shipMatch = path.match(/^\/api\/pvz\/shipments\/(mps-[0-9a-f-]{36})(\/.*)?$/);
  if (shipMatch) {
    const shipmentId = shipMatch[1];
    const rest = shipMatch[2] ?? '';
    if (!SHIPMENT_ID_RE.test(shipmentId)) return false;

    if (req.method === 'GET' && rest === '') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const found = await shipmentDetail(shipmentId, me);
      return found ? json(res, 200, { shipment: found }) : json(res, 404, { error: 'not_found' });
    }
    if (req.method === 'POST' && rest === '/items') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await addOrderToShipment(me, shipmentId, b.orderId);
      return done.error ? fail(res, done) : json(res, 201, done);
    }
    const removeItem = rest.match(/^\/items\/(mo-[0-9a-f-]{36})\/remove$/);
    if (req.method === 'POST' && removeItem) {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await removeOrderFromShipment(me, shipmentId, removeItem[1]);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'GET' && rest === '/qr') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await shipmentQr(shipmentId, me);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && rest === '/qr/regenerate') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await shipmentQr(shipmentId, me, { regenerate: true });
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && rest === '/dispatch') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await confirmDispatch(me, shipmentId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }

    /* ── ПВЗ: приёмка этой поставки ─────────────────────────────────── */

    const pvzScan = rest.match(/^\/pvz\/(mpp-[0-9a-f-]{36})\/scan$/);
    if (req.method === 'POST' && pvzScan) {
      if (!scanOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await scanShipmentOrder(pvzScan[1], me, shipmentId, b.qr);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    const pvzManual = rest.match(/^\/pvz\/(mpp-[0-9a-f-]{36})\/manual$/);
    if (req.method === 'POST' && pvzManual) {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await manualReceiveOrder(pvzManual[1], me, shipmentId, b.orderId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    const pvzConfirm = rest.match(/^\/pvz\/(mpp-[0-9a-f-]{36})\/confirm$/);
    if (req.method === 'POST' && pvzConfirm) {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await confirmReceipt(pvzConfirm[1], me, shipmentId, { partial: b.partial === true });
      return done.error ? fail(res, done) : json(res, 200, done);
    }

    return false;
  }

  /* ── ПВЗ: список ожидаемых поставок, открытие по QR, разбор ──────── */

  const pvzPending = path.match(/^\/api\/pvz\/(mpp-[0-9a-f-]{36})\/shipments\/pending$/);
  if (req.method === 'GET' && pvzPending) {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const list = await pendingShipmentsForPvz(pvzPending[1], me);
    return list === null ? json(res, 403, { error: 'not_allowed' }) : json(res, 200, { shipments: list });
  }
  const pvzOpen = path.match(/^\/api\/pvz\/(mpp-[0-9a-f-]{36})\/shipments\/open$/);
  if (req.method === 'POST' && pvzOpen) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const done = await openShipmentByQr(pvzOpen[1], me, b.qr);
    return done && !done.error ? json(res, 200, { shipment: done }) : fail(res, done ?? { error: 'not_found' });
  }
  const pvzUnmatched = path.match(/^\/api\/pvz\/(mpp-[0-9a-f-]{36})\/unmatched$/);
  if (req.method === 'GET' && pvzUnmatched) {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    if (!PVZ_ID_RE.test(pvzUnmatched[1])) return false;
    const list = await unmatchedScans(pvzUnmatched[1], me);
    return list === null ? json(res, 403, { error: 'not_allowed' }) : json(res, 200, { entries: list });
  }
  const pvzUnmatchedResolve = path.match(/^\/api\/pvz\/(mpp-[0-9a-f-]{36})\/unmatched\/(\d+)\/resolve$/);
  if (req.method === 'POST' && pvzUnmatchedResolve) {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await resolveUnmatchedScan(pvzUnmatchedResolve[1], me, pvzUnmatchedResolve[2]);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  return false;
};
