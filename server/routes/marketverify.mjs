/**
 * Sky Market: проверка продавцов, документы, публикация и модерация
 * карточек, жалобы, апелляции, правила допуска, заявки на ПВЗ — по HTTP.
 *
 * Как и в остальных маршрутах Market, здесь только вход: кто спрашивает,
 * не слишком ли часто, той ли формы идентификатор. Что можно — решают
 * sellerapps.mjs, marketmod.mjs и sellerrules.mjs. Из запроса НЕ читаются:
 * кто спрашивает, подтверждённый статус, состояние проверки, отметки
 * «отправка из-за рубежа» — всё это берётся из базы.
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import { saveStream, sizeOf, openStream, remove } from './../marketstore.mjs';
import {
  verificationConfig, myVerification, saveApplication, startChangeRequest, submitApplication,
  reserveDoc, finishDoc, dropDoc, removeMyDoc, docForReading, reviewDoc,
  listApplications, readApplicationAdmin, decideApplication, sellerAdminAction,
  myPvzApplication, savePvzApplication, submitPvzApplication,
  listPvzApplications, readPvzApplicationAdmin, decidePvzApplication,
} from './../sellerapps.mjs';
import {
  listingCheck, submitProduct, productHistory, moderationQueue, moderationDetail, moderateProduct,
  createReport, listReports, resolveReport, reportsAboutMe,
  createAppeal, myAppeals, listAppeals, decideAppeal,
  rulesOverview, setCategoryRule, setMarketSetting,
} from './../marketmod.mjs';

const READ_PER_MIN = 120;
const WRITE_PER_MIN = 40;
const SUBMIT_PER_HOUR = 20;
const UPLOAD_PER_HOUR = 40;
const MAX_DOC_BYTES = 10 * 1024 * 1024;

const STATUS = {
  not_found: 404, not_allowed: 403, own_application: 403, own_product: 403, own_target: 409,
  shop_required: 409, locked: 409, wrong_state: 409, already_submitted: 409, already_closed: 409,
  already_reported: 409, already_appealed: 409, not_appealable: 409, nothing_to_submit: 409,
  listing_blocked: 422, docs_missing: 422, docs_not_accepted: 422, bad_fields: 422,
  too_many_reports: 429, too_many_docs: 409,
  seller_pending: 403, seller_suspended: 403, seller_not_verified: 403, reverification_required: 403,
  subscription_required: 402, payment_details_required: 409,
  pvz_needs_ip_or_legal: 403,
};

const fail = (res, r) => json(res, STATUS[r.error] ?? 400, r);

/* — Загрузка документов: тип по первым байтам, а не по заголовку — */
const DOC_SIGNATURES = [
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
];
const sniff = (buf) => {
  if (!buf || buf.length < 8) return null;
  for (const s of DOC_SIGNATURES) { try { if (s.test(buf)) return s.mime; } catch { /* короткий буфер */ } }
  return null;
};
const peek = (req, bytes) => new Promise((resolve) => {
  const chunks = []; let size = 0;
  const onData = (c) => { chunks.push(c); size += c.length; if (size >= bytes) { req.pause(); req.off('data', onData); resolve(Buffer.concat(chunks)); } };
  req.on('data', onData);
  req.once('end', () => { req.off('data', onData); resolve(Buffer.concat(chunks)); });
});
const withHead = (head, rest) => Readable.from((async function* () { yield head; for await (const c of rest) yield c; })());
const rejectBody = (req, res, code, body) => {
  json(res, code, body);
  let drained = 0;
  const onData = (c) => { drained += c.length; if (drained > MAX_DOC_BYTES + 1_048_576) { req.off('data', onData); req.destroy(); } };
  const t = setTimeout(() => req.destroy(), 10_000); t.unref();
  req.on('data', onData);
  req.once('end', () => clearTimeout(t));
  return true;
};

export const marketVerifyRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  const mine = path.startsWith('/api/market/verification') || path.startsWith('/api/market/docs')
    || path.startsWith('/api/market/reports') || path.startsWith('/api/market/appeals')
    || path.startsWith('/api/market/moderation') || path.startsWith('/api/market/verify')
    || path.startsWith('/api/market/rules') || path.startsWith('/api/market/pvz-applications')
    || path.startsWith('/api/pvz/application')
    || /^\/api\/market\/products\/mp-[0-9a-f-]{36}\/(check|submit|history)$/.test(path);
  if (!mine) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const meta = requestMeta(req);
  const params = new URL(req.url, 'http://x').searchParams;
  const readOk = () => rateLimit(`mv:r:${me}`, READ_PER_MIN);
  const writeOk = () => rateLimit(`mv:w:${me}`, WRITE_PER_MIN);
  const tooMany = () => json(res, 429, { error: 'too_many_requests' });
  const body = () => parseBody(req);

  /* ══ Продавец: проверка статуса ═══════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/market/verification/config') {
    return json(res, 200, verificationConfig());
  }
  if (req.method === 'GET' && path === '/api/market/verification') {
    if (!readOk()) return tooMany();
    return json(res, 200, await myVerification(me));
  }
  if (req.method === 'PUT' && path === '/api/market/verification/application') {
    if (!writeOk()) return tooMany();
    const r = await saveApplication(me, await body());
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  if (req.method === 'POST' && path === '/api/market/verification/application/submit') {
    if (!rateLimitPerHour(`mv:submit:${me}`, SUBMIT_PER_HOUR)) return tooMany();
    const r = await submitApplication(me);
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  if (req.method === 'POST' && path === '/api/market/verification/change') {
    if (!writeOk()) return tooMany();
    const r = await startChangeRequest(me);
    return r.error ? fail(res, r) : json(res, 200, r);
  }

  /* ══ Документы ═══════════════════════════════════════════════════ */

  if (req.method === 'POST' && path === '/api/market/docs') {
    if (!rateLimitPerHour(`mv:upload:${me}`, UPLOAD_PER_HOUR)) return rejectBody(req, res, 429, { error: 'too_many_requests' });
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_DOC_BYTES) return rejectBody(req, res, 413, { error: 'too_large', limit: MAX_DOC_BYTES });
    const head = await peek(req, 16);
    const mime = sniff(head);
    if (!mime) return rejectBody(req, res, 415, { error: 'unsupported_document', message: 'Допустимы PDF, JPEG и PNG.' });
    const slot = await reserveDoc(me, {
      scope: params.get('scope'), refId: params.get('refId'), docType: params.get('type'),
      label: params.get('label'), mime,
    });
    if (slot.error) return rejectBody(req, res, STATUS[slot.error] ?? 400, slot);
    req.resume();
    const saved = await saveStream(slot.fileId, withHead(head, req), MAX_DOC_BYTES);
    if (saved.error) {
      await query_drop(slot.id);
      return json(res, saved.error === 'too_large' ? 413 : 500, { error: saved.error });
    }
    await finishDoc(slot.id, saved.bytes);
    return json(res, 200, { ok: true, id: slot.id, bytes: saved.bytes, mime });
  }

  const docPath = path.match(/^\/api\/market\/docs\/(mdc-[0-9a-f-]{36})(\/file)?$/);
  if (docPath) {
    if (req.method === 'DELETE' && !docPath[2]) {
      if (!writeOk()) return tooMany();
      const r = await removeMyDoc(me, docPath[1]);
      if (r.error) return fail(res, r);
      await remove(r.fileId).catch(() => {});
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && docPath[2]) {
      if (!readOk()) return tooMany();
      const doc = await docForReading(me, docPath[1]);
      if (!doc) return json(res, 404, { error: 'not_found' });
      const size = await sizeOf(doc.fileId);
      res.writeHead(200, {
        'Content-Type': doc.mime, 'Content-Length': size,
        'Content-Disposition': 'inline; filename="document"',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      openStream(doc.fileId).pipe(res);
      return true;
    }
  }

  /* ══ Карточка: проверка перед публикацией ════════════════════════ */

  const prod = path.match(/^\/api\/market\/products\/(mp-[0-9a-f-]{36})\/(check|submit|history)$/);
  if (prod) {
    if (prod[2] === 'check' && req.method === 'GET') {
      if (!readOk()) return tooMany();
      const r = await listingCheck(prod[1], me);
      return r.error ? fail(res, r) : json(res, 200, r);
    }
    if (prod[2] === 'history' && req.method === 'GET') {
      if (!readOk()) return tooMany();
      const r = await productHistory(me, prod[1]);
      return r.error ? fail(res, r) : json(res, 200, r);
    }
    if (prod[2] === 'submit' && req.method === 'POST') {
      if (!rateLimitPerHour(`mv:psubmit:${me}`, 200)) return tooMany();
      const r = await submitProduct(prod[1], me);
      return r.error ? fail(res, r) : json(res, 200, r);
    }
  }

  /* ══ Жалобы и апелляции ══════════════════════════════════════════ */

  if (req.method === 'POST' && path === '/api/market/reports') {
    if (!writeOk()) return tooMany();
    const r = await createReport(me, await body());
    return r.error ? fail(res, r) : json(res, 201, r);
  }
  if (req.method === 'GET' && path === '/api/market/reports/about-me') {
    if (!readOk()) return tooMany();
    return json(res, 200, { items: await reportsAboutMe(me) });
  }
  if (req.method === 'POST' && path === '/api/market/appeals') {
    if (!writeOk()) return tooMany();
    const r = await createAppeal(me, await body());
    return r.error ? fail(res, r) : json(res, 201, r);
  }
  if (req.method === 'GET' && path === '/api/market/appeals') {
    if (!readOk()) return tooMany();
    return json(res, 200, { items: await myAppeals(me) });
  }

  /* ══ Заявка на ПВЗ ═══════════════════════════════════════════════ */

  if (path === '/api/pvz/application') {
    if (req.method === 'GET') {
      if (!readOk()) return tooMany();
      return json(res, 200, await myPvzApplication(me));
    }
    if (req.method === 'PUT') {
      if (!writeOk()) return tooMany();
      const r = await savePvzApplication(me, await body());
      return r.error ? fail(res, r) : json(res, 200, r);
    }
  }
  if (req.method === 'POST' && path === '/api/pvz/application/submit') {
    if (!rateLimitPerHour(`mv:pvzsubmit:${me}`, SUBMIT_PER_HOUR)) return tooMany();
    const r = await submitPvzApplication(me);
    return r.error ? fail(res, r) : json(res, 200, r);
  }

  /* ══ Администрация ═══════════════════════════════════════════════
     Право проверяется внутри функций, а не здесь.                  */

  if (!writeOk() && req.method !== 'GET') return tooMany();
  if (req.method === 'GET' && !readOk()) return tooMany();

  if (req.method === 'GET' && path === '/api/market/verify/applications') {
    const r = await listApplications(me, {
      status: params.get('status') ?? 'submitted', kind: params.get('kind'), requestType: params.get('requestType'),
    });
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  const appOne = path.match(/^\/api\/market\/verify\/applications\/(sap-[0-9a-f-]{36})$/);
  if (req.method === 'GET' && appOne) {
    const r = await readApplicationAdmin(me, appOne[1], { meta });
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  const appAct = path.match(/^\/api\/market\/verify\/applications\/(sap-[0-9a-f-]{36})\/([a-z_]+)$/);
  if (req.method === 'POST' && appAct) {
    const r = await decideApplication(me, appAct[1], appAct[2], await body(), { meta });
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  const docReview = path.match(/^\/api\/market\/verify\/docs\/(mdc-[0-9a-f-]{36})\/review$/);
  if (req.method === 'POST' && docReview) {
    const b = await body();
    const r = await reviewDoc(me, docReview[1], b.accept === true, b.comment, { meta });
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  const sellerAct = path.match(/^\/api\/market\/verify\/sellers\/(acc-[0-9a-f-]{36})\/(suspend|reinstate|reverify)$/);
  if (req.method === 'POST' && sellerAct) {
    const b = await body();
    const r = await sellerAdminAction(me, sellerAct[1], sellerAct[2], b.reason, { meta });
    return r.error ? fail(res, r) : json(res, 200, r);
  }

  if (req.method === 'GET' && path === '/api/market/moderation/products') {
    const r = await moderationQueue(me, {
      status: params.get('status') ?? 'pending', foreign: params.get('foreign'), q: params.get('q'),
    });
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  const modOne = path.match(/^\/api\/market\/moderation\/products\/(mp-[0-9a-f-]{36})$/);
  if (req.method === 'GET' && modOne) {
    const r = await moderationDetail(me, modOne[1]);
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  const modAct = path.match(/^\/api\/market\/moderation\/products\/(mp-[0-9a-f-]{36})\/([a-z_]+)$/);
  if (req.method === 'POST' && modAct) {
    const b = await body();
    const r = await moderateProduct(me, modAct[1], modAct[2], b.reason, { meta });
    return r.error ? fail(res, r) : json(res, 200, r);
  }

  if (req.method === 'GET' && path === '/api/market/moderation/reports') {
    const r = await listReports(me, { status: params.get('status') ?? 'open' });
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  const repAct = path.match(/^\/api\/market\/moderation\/reports\/(mrp-[0-9a-f-]{36})\/resolve$/);
  if (req.method === 'POST' && repAct) {
    const b = await body();
    const r = await resolveReport(me, repAct[1], b.outcome, b.resolution, b.apply, { meta });
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  if (req.method === 'GET' && path === '/api/market/moderation/appeals') {
    const r = await listAppeals(me, { status: params.get('status') ?? 'open' });
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  const apAct = path.match(/^\/api\/market\/moderation\/appeals\/(map-[0-9a-f-]{36})\/decide$/);
  if (req.method === 'POST' && apAct) {
    const b = await body();
    const r = await decideAppeal(me, apAct[1], b.accept === true, b.decision, { meta });
    return r.error ? fail(res, r) : json(res, 200, r);
  }

  if (req.method === 'GET' && path === '/api/market/rules') {
    const r = await rulesOverview(me);
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  const ruleCat = path.match(/^\/api\/market\/rules\/category\/([a-z]+)$/);
  if (req.method === 'PUT' && ruleCat) {
    const r = await setCategoryRule(me, ruleCat[1], await body(), { meta });
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  if (req.method === 'PUT' && path === '/api/market/rules/settings') {
    const b = await body();
    const r = await setMarketSetting(me, b.key, b.value, { meta });
    return r.error ? fail(res, r) : json(res, 200, r);
  }

  if (req.method === 'GET' && path === '/api/market/pvz-applications') {
    const r = await listPvzApplications(me, { status: params.get('status') ?? 'submitted' });
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  const pvzOne = path.match(/^\/api\/market\/pvz-applications\/(mpa-[0-9a-f-]{36})$/);
  if (req.method === 'GET' && pvzOne) {
    const r = await readPvzApplicationAdmin(me, pvzOne[1]);
    return r.error ? fail(res, r) : json(res, 200, r);
  }
  const pvzAct = path.match(/^\/api\/market\/pvz-applications\/(mpa-[0-9a-f-]{36})\/([a-z_]+)$/);
  if (req.method === 'POST' && pvzAct) {
    const r = await decidePvzApplication(me, pvzAct[1], pvzAct[2], await body(), { meta });
    return r.error ? fail(res, r) : json(res, 200, r);
  }

  return json(res, 404, { error: 'not_found' });
};

const query_drop = (id) => dropDoc(id);
