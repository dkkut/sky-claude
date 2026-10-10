/**
 * Sky Blox по HTTP: игроки, кабинет разработчика, администрация и
 * подписанный API игровых серверов.
 *
 * Здесь только вход: кто спрашивает, не слишком ли часто, не слишком ли
 * велико тело и той ли формы идентификатор. Права и деньги решают
 * blox.mjs и bloxshop.mjs. Из запроса не читаются: кто спрашивает,
 * цена товара, доля разработчика, статус модерации, баланс.
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, readSession } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import { ticketFromCookies, readTicket } from './../marketticket.mjs';
import { saveStream, sizeOf, openStream, remove } from './../marketstore.mjs';
import { limit, loadLimits, setLimit, LIMITS, collectMetrics, warningsFor, loadLevel, optionalAllowed, recordRequest } from './../bloxlimits.mjs';
import { query } from './../db.mjs';
import { can } from './../admin.mjs';
import * as B from './../blox.mjs';
import * as S from './../bloxshop.mjs';

const STATUS = {
  not_found: 404, not_allowed: 403, own_project: 403, own_target: 409, own_game: 409, own_payout: 403, locked: 409,
  not_a_developer: 403, developer_suspended: 403, wrong_state: 409, not_ready: 422, not_approved: 409, connection_failed: 422,
  already_reported: 409, already_appealed: 409, already_closed: 409, not_appealable: 409, already_developer: 409,
  too_many_reports: 429, too_many_reviews: 429, too_many_launches: 429, too_many_projects: 409, too_many_servers: 409,
  too_many_places: 409, too_many_products: 409, too_many_images: 409, too_many_pending: 429, too_many_open: 409, cooldown: 429, busy: 503,
  play_first: 409, play_longer: 409, different_moderator_required: 409,
  insufficient_points: 402, insufficient_available: 409, insufficient_earnings: 409, price_changed: 409, already_owned: 409,
  already_paid: 409, expired: 410, shop_unavailable: 409, game_unavailable: 409, product_unavailable: 409, payouts_disabled: 403,
  step_up_required: 401, step_up_invalid: 401, step_up_exhausted: 429, no_second_factor: 409,
  bad_auth: 401, bad_signature: 401, stale_request: 401, replayed_request: 409, rate_limited: 429, game_disabled: 403,
  token_used: 409, already_fulfilled: 409, bad_amount: 400, bad_token: 401, unknown_player: 404, insufficient_quantity: 409, idempotency_conflict: 409, duplicate_request: 409,
};
const fail = (res, r) => json(res, STATUS[r.error] ?? 400, r);

const READ_PER_MIN = 240;
const MAX_JSON = 1_000_000;

const sig = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];
const sniff = (b) => { if (!b || b.length < 16) return null; for (const s of sig) { try { if (s.test(b)) return s.mime; } catch { /* коротко */ } } return null; };
const peek = (req, n) => new Promise((resolve) => {
  const ch = []; let size = 0;
  const on = (c) => { ch.push(c); size += c.length; if (size >= n) { req.pause(); req.off('data', on); resolve(Buffer.concat(ch)); } };
  req.on('data', on); req.once('end', () => { req.off('data', on); resolve(Buffer.concat(ch)); });
});
const withHead = (head, rest) => Readable.from((async function* () { yield head; for await (const c of rest) yield c; })());
const reject = (req, res, code, body) => {
  json(res, code, body);
  let n = 0; const on = (c) => { n += c.length; if (n > 30_000_000) { req.off('data', on); req.destroy(); } };
  const t = setTimeout(() => req.destroy(), 10_000); t.unref(); req.on('data', on); req.once('end', () => clearTimeout(t));
  return true;
};

const readRaw = (req, max) => new Promise((resolve) => {
  const ch = []; let n = 0; let over = false;
  req.on('data', (c) => { n += c.length; if (n > max) { over = true; return; } ch.push(c); });
  req.once('end', () => resolve(over ? null : Buffer.concat(ch).toString('utf8')));
  req.once('error', () => resolve(null));
});

const sendImage = async (res, id, mime) => {
  const size = await sizeOf(id);
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': size, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  openStream(id).pipe(res);
  return true;
};

/* ═══ Подписанный API игровых серверов ═════════════════════════════ */

const serverApi = async (req, res, path, url) => {
  const maxBody = await limit('maxBodyBytes');
  const raw = req.method === 'GET' ? '' : await readRaw(req, maxBody);
  if (raw === null) return json(res, 413, { error: 'too_large', limit: maxBody });
  const auth = await S.authenticateGame(req, raw, url);
  if (auth.error) return fail(res, auth);
  const game = auth.game;
  let body = {};
  if (raw) { try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'invalid_json' }); } if (typeof body !== 'object' || body === null || Array.isArray(body)) return json(res, 400, { error: 'invalid_json' }); }
  const done = (r) => (r.error ? fail(res, r) : json(res, 200, r));

  if (req.method === 'POST' && path === '/api/blox/server/session/verify') return done(await S.apiVerifyToken(game, body.token));
  if (req.method === 'GET' && path === '/api/blox/server/products') return done(await S.apiProducts(game));
  if (req.method === 'POST' && path === '/api/blox/server/purchases') return done(await S.apiCreatePurchase(game, body));
  const one = path.match(/^\/api\/blox\/server\/purchases\/(bpu-[0-9a-f-]{36})(\/(fulfill|fail))?$/);
  if (one) {
    if (req.method === 'GET' && !one[2]) return done(await S.apiGetPurchase(game, one[1]));
    if (req.method === 'POST' && one[3] === 'fulfill') return done(await S.apiFulfill(game, one[1]));
    if (req.method === 'POST' && one[3] === 'fail') return done(await S.apiFail(game, one[1], body.reason));
  }
  if (req.method === 'POST' && path === '/api/blox/server/entitlements/check') return done(await S.apiEntitlement(game, body.playerId, body.sku));
  if (req.method === 'POST' && path === '/api/blox/server/entitlements/consume') return done(await S.apiConsume(game, body));
  return json(res, 404, { error: 'not_found' });
};

/* ═══ Основные маршруты ════════════════════════════════════════════ */

export const bloxRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/blox')) return false;
  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  /* Игровые серверы: не человек и без сессии — вместо неё подпись. */
  if (path.startsWith('/api/blox/server/')) return serverApi(req, res, path, url);

  const isPicture = req.method === 'GET' && /^\/api\/blox\/images\/bgi-[0-9a-f-]{36}$/.test(path);
  let me;
  if (isPicture) {
    const session = await readSession(req);
    me = session?.profileId ?? ticketFromCookies(req.headers.cookie) ?? readTicket(params.get('t'));
    if (!me) return json(res, 401, { error: 'unauthorized' });
  } else {
    const session = await requireProfile(req, res);
    if (!session) return true;
    me = session.profileId;
  }

  if (/%00|\u0000/i.test(req.url ?? '')) return json(res, 400, { error: 'bad_request' });
  const userRpm = await limit('userRpm');
  if (!rateLimit(`blox:u:${me}`, Math.max(userRpm, READ_PER_MIN))) return json(res, 429, { error: 'too_many_requests' });
  if (!isPicture && req.method !== 'GET') {
    const maxBody = await limit('maxBodyBytes');
    const declared = Number(req.headers['content-length'] ?? 0);
    const upload = /\/images$/.test(path);
    if (!upload && declared > maxBody) return reject(req, res, 413, { error: 'too_large', limit: maxBody });
  }
  const meta = requestMeta(req);
  const body = async () => { const b = await parseBody(req); if (!b || typeof b !== 'object' || Array.isArray(b)) return {}; return JSON.stringify(b).includes('\\u0000') ? {} : b; };
  const done = (r, code = 200) => (r.error ? fail(res, r) : json(res, code, r));

  if (isPicture) {
    const id = path.split('/').pop();
    const found = await B.readImage(me, id);
    if (!found) return json(res, 404, { error: 'not_found' });
    return sendImage(res, id, found.mime);
  }

  /* — Справка и каталог — */
  if (req.method === 'GET' && path === '/api/blox/info') return json(res, 200, await B.platformInfo());
  if (req.method === 'GET' && path === '/api/blox/home') return json(res, 200, await B.homeSections(me));
  if (req.method === 'GET' && path === '/api/blox/catalog') {
    return json(res, 200, { items: await B.listCatalog(me, { q: params.get('q'), category: params.get('category'), sort: params.get('sort'), section: params.get('section'), limit: params.get('limit'), offset: params.get('offset') }) });
  }
  if (req.method === 'GET' && path === '/api/blox/me') return json(res, 200, await B.myProfile(me));
  if (req.method === 'GET' && path === '/api/blox/favorites') return json(res, 200, { items: await B.listFavorites(me) });
  if (req.method === 'GET' && path === '/api/blox/history') return json(res, 200, { items: await B.listHistory(me) });

  const game = path.match(/^\/api\/blox\/games\/(bg-[0-9a-f-]{36})(\/[a-z/]+)?$/);
  if (game) {
    const id = game[1]; const tail = game[2] ?? '';
    if (req.method === 'GET' && tail === '') { const g = await B.readGame(me, id); return g ? json(res, 200, { game: g }) : json(res, 404, { error: 'not_found' }); }
    if (req.method === 'GET' && tail === '/reviews') return json(res, 200, { items: await B.listReviews(id) });
    if (req.method === 'POST' && tail === '/review') { const b = await body(); return done(await B.leaveReview(me, id, b)); }
    if (tail === '/favorite' && (req.method === 'POST' || req.method === 'DELETE')) return done(await B.setFavorite(me, id, req.method === 'POST'));
    if (req.method === 'GET' && tail === '/shop') return done(await S.listShop(me, id));
    if (req.method === 'POST' && tail === '/shop/buy') { if (!rateLimit(`blox:buy:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' }); const b = await body(); return done(await S.createIntentForUser(me, id, b.sku, b.idempotencyKey), 201); }
  }

  const place = path.match(/^\/api\/blox\/places\/(bp-[0-9a-f-]{36})\/launch$/);
  if (req.method === 'POST' && place) return done(await B.launchPlace(me, place[1]));

  /* — Жалобы и апелляции — */
  if (req.method === 'POST' && path === '/api/blox/reports') return done(await B.createReport(me, await body()), 201);
  if (req.method === 'GET' && path === '/api/blox/appeals') return json(res, 200, { items: await B.myAppeals(me) });
  if (req.method === 'POST' && path === '/api/blox/appeals') return done(await B.createAppeal(me, await body()), 201);

  /* — Покупки игрока — */
  if (req.method === 'GET' && path === '/api/blox/purchases/pending') return json(res, 200, { items: await S.pendingIntents(me) });
  if (req.method === 'GET' && path === '/api/blox/purchases') return json(res, 200, { items: await S.myPurchases(me) });
  if (req.method === 'GET' && path === '/api/blox/entitlements') return json(res, 200, { items: await S.myEntitlements(me) });
  const pu = path.match(/^\/api\/blox\/purchases\/(bpu-[0-9a-f-]{36})\/(confirm|cancel)$/);
  if (req.method === 'POST' && pu) {
    if (pu[2] === 'confirm') { if (!rateLimit(`blox:confirm:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' }); const b = await body(); return done(await S.confirmPurchase(me, pu[1], b.price)); }
    return done(await S.cancelIntent(me, pu[1]));
  }

  /* ══ Кабинет разработчика ═════════════════════════════════════════ */

  if (path === '/api/blox/developer') {
    if (req.method === 'GET') return json(res, 200, { developer: await B.myDeveloper(me) });
    if (req.method === 'POST') return done(await B.becomeDeveloper(me, await body()), 201);
  }
  if (path.startsWith('/api/blox/dev/')) {
    if (req.method === 'GET' && path === '/api/blox/dev/games') return json(res, 200, { items: await B.myGames(me) });
    if (req.method === 'POST' && path === '/api/blox/dev/games') { if (!rateLimitPerHour(`blox:mkgame:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' }); return done(await B.createGame(me, await body()), 201); }
    if (req.method === 'GET' && path === '/api/blox/dev/stats') return json(res, 200, await B.devStats(me));
    if (req.method === 'GET' && path === '/api/blox/dev/reports') return json(res, 200, { items: await B.reportsAboutMe(me) });
    if (req.method === 'GET' && path === '/api/blox/dev/finance') return json(res, 200, await S.financeOverview(me));

    const dg = path.match(/^\/api\/blox\/dev\/games\/(bg-[0-9a-f-]{36})(\/[a-z/]+)?$/);
    if (dg) {
      const id = dg[1]; const tail = dg[2] ?? '';
      if (req.method === 'GET' && tail === '') { const g = await B.readGame(me, id); return g && g.own ? json(res, 200, { game: g }) : json(res, 404, { error: 'not_found' }); }
      if (req.method === 'PATCH' && tail === '') return done(await B.updateGame(me, id, await body()));
      if (req.method === 'DELETE' && tail === '') return done(await B.archive(me, 'game', id));
      if (req.method === 'POST' && tail === '/secret/rotate') { if (!rateLimitPerHour(`blox:rot:${me}`, 10)) return json(res, 429, { error: 'too_many_requests' }); return done(await B.rotateSecret(me, id)); }
      if (req.method === 'POST' && tail === '/check') {
        if (!optionalAllowed()) return json(res, 503, { error: 'busy', message: 'Сервер сейчас сильно загружен — проверка отложена. Повторите позже.' });
        const r = await B.checkConnection(me, id);
        if (r.busy) return json(res, 503, { error: 'busy', message: r.message });
        return done(r);
      }
      if (req.method === 'POST' && tail === '/disconnect') return done(await B.disconnectServer(me, id));
      if (req.method === 'POST' && tail === '/submit') { if (!rateLimitPerHour(`blox:submit:${me}`, 40)) return json(res, 429, { error: 'too_many_requests' }); return done(await B.submit(me, 'game', id)); }
      if (req.method === 'POST' && tail === '/publish') { const b = await body(); return done(await B.publish(me, 'game', id, b.on !== false)); }
      if (req.method === 'GET' && tail === '/history') return done(await B.myHistory(me, 'game', id));
      if (req.method === 'GET' && tail === '/versions') return done(await B.listVersions(me, id));
      if (req.method === 'POST' && tail === '/versions') return done(await B.addVersion(me, id, await body()));
      if (req.method === 'POST' && tail === '/places') return done(await B.createPlace(me, id, await body()), 201);
      if (req.method === 'GET' && tail === '/products') return done(await S.listMyProducts(me, id));
      if (req.method === 'POST' && tail === '/products') return done(await S.createProduct(me, id, await body()), 201);
      if (req.method === 'POST' && tail === '/images') return uploadImage(req, res, me, 'game', id, params.get('kind'));
    }
    const dp = path.match(/^\/api\/blox\/dev\/places\/(bp-[0-9a-f-]{36})(\/[a-z/]+)?$/);
    if (dp) {
      const id = dp[1]; const tail = dp[2] ?? '';
      if (req.method === 'PATCH' && tail === '') return done(await B.updatePlace(me, id, await body()));
      if (req.method === 'DELETE' && tail === '') return done(await B.archive(me, 'place', id));
      if (req.method === 'POST' && tail === '/submit') return done(await B.submit(me, 'place', id));
      if (req.method === 'POST' && tail === '/publish') { const b = await body(); return done(await B.publish(me, 'place', id, b.on !== false)); }
      if (req.method === 'GET' && tail === '/history') return done(await B.myHistory(me, 'place', id));
      if (req.method === 'POST' && tail === '/images') return uploadImage(req, res, me, 'place', id, params.get('kind'));
    }
    const di = path.match(/^\/api\/blox\/dev\/images\/(bgi-[0-9a-f-]{36})$/);
    if (req.method === 'DELETE' && di) { const r = await B.deleteImage(me, di[1]); if (!r.error) await remove(di[1]).catch(() => {}); return done(r); }
    const prod = path.match(/^\/api\/blox\/dev\/products\/(bpr-[0-9a-f-]{36})$/);
    if (req.method === 'PATCH' && prod) return done(await S.updateProduct(me, prod[1], await body()));

    /* Финансы разработчика */
    if (req.method === 'POST' && path === '/api/blox/dev/payouts') { if (!rateLimitPerHour(`blox:pay:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' }); return done(await S.payoutDraft(me, await body()), 201); }
    const po = path.match(/^\/api\/blox\/dev\/payouts\/(bpo-[0-9a-f-]{36})(\/[a-z]+)?$/);
    if (po) {
      const id = po[1]; const tail = po[2] ?? '';
      if (req.method === 'PATCH' && tail === '') { const b = await body(); return done(await S.payoutDraft(me, { ...b, payoutId: id })); }
      if (req.method === 'POST' && tail === '/submit') { if (!rateLimitPerHour(`blox:paysub:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' }); return done(await S.payoutSubmit(me, id, await body())); }
      if (req.method === 'POST' && tail === '/info') return done(await S.payoutUpdateInfo(me, id, await body()));
      if (req.method === 'POST' && tail === '/cancel') return done(await S.payoutCancel(me, id));
      if (req.method === 'GET' && tail === '/events') return done(await S.payoutEvents(me, id));
    }
  }

  /* ══ Администрация ════════════════════════════════════════════════ */

  if (path.startsWith('/api/blox/admin/')) {
    if (req.method !== 'GET' && !rateLimit(`blox:adm:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
    if (req.method === 'GET' && path === '/api/blox/admin/games') return done(await B.listAllGames(me, { q: params.get('q') }));
    const probe = path.match(/^\/api\/blox\/admin\/games\/(bg-[0-9a-f-]{36})\/probe$/);
    if (req.method === 'POST' && probe) { if (!optionalAllowed()) return json(res, 503, { error: 'busy' }); return done(await B.adminProbe(me, probe[1])); }
    if (req.method === 'GET' && path === '/api/blox/admin/developers') return done(await B.listDevelopers(me));
    const dv = path.match(/^\/api\/blox\/admin\/developers\/(acc-[0-9a-f-]{36})$/);
    if (req.method === 'POST' && dv) { const b = await body(); return done(await B.setDeveloperState(me, dv[1], b, { meta })); }
    const dvf = path.match(/^\/api\/blox\/admin\/developers\/(acc-[0-9a-f-]{36})\/finance$/);
    if (req.method === 'GET' && dvf) return done(await S.adminDeveloperFinance(me, dvf[1]));

    if (req.method === 'GET' && path === '/api/blox/admin/moderation') return done(await B.moderationQueue(me, { status: params.get('status') ?? 'pending', type: params.get('type') === 'place' ? 'place' : 'game', q: params.get('q') }));
    const md = path.match(/^\/api\/blox\/admin\/moderation\/(game|place)\/(bg-[0-9a-f-]{36}|bp-[0-9a-f-]{36})(\/([a-z_]+))?$/);
    if (md) {
      if (req.method === 'GET' && !md[3]) return done(await B.moderationDetail(me, md[1], md[2]));
      if (req.method === 'POST' && md[4]) { const b = await body(); return done(await B.moderate(me, md[1], md[2], md[4], b.reason, { meta })); }
    }
    if (req.method === 'GET' && path === '/api/blox/admin/reports') return done(await B.listReports(me, { status: params.get('status') ?? 'open' }));
    const rp = path.match(/^\/api\/blox\/admin\/reports\/(bpr-[0-9a-f-]{36})\/resolve$/);
    if (req.method === 'POST' && rp) { const b = await body(); return done(await B.resolveReport(me, rp[1], b.outcome, b.resolution, b.apply, { meta })); }
    if (req.method === 'GET' && path === '/api/blox/admin/appeals') return done(await B.listAppeals(me, { status: params.get('status') ?? 'open' }));
    const ap = path.match(/^\/api\/blox\/admin\/appeals\/(bpa-[0-9a-f-]{36})\/decide$/);
    if (req.method === 'POST' && ap) { const b = await body(); return done(await B.decideAppeal(me, ap[1], b.accept === true, b.decision, { meta })); }
    const rv = path.match(/^\/api\/blox\/admin\/reviews\/(brv-[0-9a-f-]{36})\/hide$/);
    if (req.method === 'POST' && rv) { const b = await body(); return done(await B.hideReview(me, rv[1], b.reason, { meta })); }

    if (req.method === 'GET' && path === '/api/blox/admin/purchases') return done(await S.adminPurchases(me, { status: params.get('status') }));
    const rf = path.match(/^\/api\/blox\/admin\/purchases\/(bpu-[0-9a-f-]{36})\/refund$/);
    if (req.method === 'POST' && rf) { const b = await body(); return done(await S.adminRefund(me, rf[1], b.reason, { meta })); }
    if (req.method === 'GET' && path === '/api/blox/admin/earnings') return done(await S.adminEarningsSummary(me));
    if (req.method === 'POST' && path === '/api/blox/admin/step-up') return done(await S.financeStepUp(me, meta));
    const adj = path.match(/^\/api\/blox\/admin\/developers\/(acc-[0-9a-f-]{36})\/adjust$/);
    if (req.method === 'POST' && adj) { const b = await body(); return done(await S.adminAdjust(me, adj[1], b.amount, b.reason, b.stepUpCode, { meta })); }
    if (req.method === 'GET' && path === '/api/blox/admin/payouts') return done(await S.adminPayouts(me, { status: params.get('status') ?? 'review' }));
    const pd = path.match(/^\/api\/blox\/admin\/payouts\/(bpo-[0-9a-f-]{36})(\/([a-z_]+))?$/);
    if (pd) {
      if (req.method === 'GET' && !pd[3]) return done(await S.adminPayoutDetail(me, pd[1], { meta }));
      if (req.method === 'POST' && pd[3]) return done(await S.adminPayoutAction(me, pd[1], pd[3], await body(), { meta }));
    }

    if (req.method === 'GET' && path === '/api/blox/admin/limits') {
      if (!(await can(me, 'blox'))) return json(res, 403, { error: 'not_allowed' });
      const values = await loadLimits(true);
      return json(res, 200, { items: Object.entries(LIMITS).map(([key, [def, min, max, label]]) => ({ key, label, value: values[key], default: def, min, max })) });
    }
    if (req.method === 'PUT' && path === '/api/blox/admin/limits') {
      const b = await body();
      const isFin = ['commissionPercent', 'holdDays', 'minPayoutPoints', 'payoutsEnabled'].includes(b.key);
      if (!(await can(me, isFin ? 'blox_finance' : 'blox'))) return json(res, 403, { error: 'not_allowed' });
      /* Финансовые параметры — только с подтверждением личности и в журнал. */
      const finance = ['commissionPercent', 'holdDays', 'minPayoutPoints', 'payoutsEnabled'].includes(b.key);
      if (finance) {
        if (!(await can(me, 'blox_finance'))) return json(res, 403, { error: 'not_allowed' });
        const { consumeStepUp } = await import('./../adminsec.mjs');
        const st = await consumeStepUp(me, S.STEP_UP_PURPOSE, b.stepUpCode, { meta });
        if (st.error) return fail(res, st);
      }
      const r = await setLimit(me, b.key, b.value);
      if (r.error) return fail(res, r);
      const { logAdmin } = await import('./../adminsec.mjs');
      await logAdmin({ actorId: me, targetId: b.key, targetType: 'blox_limit', type: 'blox_limit_set', detail: `${b.key} = ${b.value}`, meta });
      return json(res, 200, r);
    }
    if (req.method === 'GET' && path === '/api/blox/admin/metrics') {
      if (!(await can(me, 'blox'))) return json(res, 403, { error: 'not_allowed' });
      const m = await collectMetrics();
      return json(res, 200, { metrics: m, warnings: warningsFor(m) });
    }
    if (req.method === 'GET' && path === '/api/blox/admin/audit') {
      if (!(await can(me, 'blox')) && !(await can(me, 'blox_moderation')) && !(await can(me, 'blox_finance'))) return json(res, 403, { error: 'not_allowed' });
      const { rows } = await query(
        `SELECT a.id, a.type, a.result, a.target_id, a.created_at, p.name, p.username FROM admin_log a LEFT JOIN profiles p ON p.id = a.actor_id
          WHERE a.type LIKE 'blox\\_%' ESCAPE '\\' ORDER BY a.created_at DESC LIMIT 200`);
      return json(res, 200, { items: rows.map((r) => ({ id: r.id, type: r.type, result: r.result, target: r.target_id, actor: r.name, username: r.username, at: r.created_at.toISOString() })) });
    }
  }

  return json(res, 404, { error: 'not_found' });
};

/** Загрузка картинки: тип по первым байтам, размер по настройке «Ограничения». */
const uploadImage = async (req, res, me, ownerType, ownerId, kind) => {
  if (!rateLimitPerHour(`blox:img:${me}`, 120)) return reject(req, res, 429, { error: 'too_many_requests' });
  const max = await limit('maxUploadBytes');
  if (Number(req.headers['content-length'] ?? 0) > max) return reject(req, res, 413, { error: 'too_large', limit: max });
  const head = await peek(req, 32);
  const mime = sniff(head);
  if (!mime) return reject(req, res, 415, { error: 'unsupported_image' });
  const slot = await B.addImage(me, ownerType, ownerId, kind);
  if (slot.error) return reject(req, res, STATUS[slot.error] ?? 400, slot);
  req.resume();
  const saved = await saveStream(slot.imageId, withHead(head, req), max);
  if (saved.error) return json(res, saved.error === 'too_large' ? 413 : 500, { error: saved.error });
  await slot.mimeSet(mime);
  if (slot.oldId) await remove(slot.oldId).catch(() => {});
  return json(res, 200, { ok: true, imageId: slot.imageId, bytes: saved.bytes });
};

export { recordRequest, loadLevel };
