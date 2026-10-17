import { json, parseBody, requireProfile, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { audit, myBusiness, createBusiness, updateBusiness, setLogo, logoOf, setRequisites, publish, subState, subHistory, buySub, listQr, createQr, setQrStatus,
  publicPage, reportPayment, buyerStatus, listPayments, paymentLog, actOnPayment, auditList, exportPaymentsCsv, overview, scan, SUB_PRICE_RUB, SUB_PERIOD_DAYS } from './../kbiz.mjs';
import { query } from './../db.mjs';
import * as cat from './../kbcatalog.mjs';
import { shopPackage } from './../kbpackage.mjs';
import * as ex from './../kbextra.mjs';
import * as st from './../kbstaff.mjs';
import * as pv from './../kbprovider.mjs';
import * as ad from './../kbadmin.mjs';

const MULT = Math.max(1, Number(process.env.KBIZ_RATE_MULT) || 1);        // для тестов
const STATUS = { not_found: 404, no_business: 404, already_exists: 409, bad_state: 409, suspended: 403, subscription_required: 402, insufficient_funds: 402, bad_field: 400, bad_action: 400,
  bad_status: 400, bad_logo: 400, logo_too_large: 413, secret_words: 400, requisites_required: 409, too_many_qr: 429, too_many_requests: 429, comment_required: 400, bad_amount: 400,
  page_unavailable: 410, origin_not_allowed: 403, shop_not_configured: 409, package_unavailable: 503, shop_unavailable: 410, empty_cart: 400, item_unavailable: 409, variant_required: 400, too_many_items: 429, too_many_media: 429, slug_taken: 409, provider_not_set: 409, provider_bad_url: 400, provider_unreachable: 502, provider_error: 502, provider_bad_answer: 502, forbidden: 403, user_not_found: 404, already_in_business: 409, too_many_staff: 429, too_many_promos: 429, code_taken: 409, promo_invalid: 400, promo_expired: 410, promo_exhausted: 409, promo_min_order: 400, order_not_done: 409, already_reviewed: 409, not_published: 409, not_skykassa_qr: 400, two_factor_required: 403, invalid_code: 403, archived: 409 };

/** SkyKassa Business: /api/kbiz/* — кабинет владельца (вход обязателен), /api/kbiz/public/* — страница оплаты для покупателя (без входа). */
export const kbizRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;
  if (!path.startsWith('/api/kbiz/')) return false;
  if (/^\/api\/kbiz\/webhook\/kbz-[0-9a-f-]{36}$/.test(path)) {            // вебхук провайдера бизнеса: без входа, с подписью
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (!rateLimit(`kbhook:${clientIp(req)}`, 120 * MULT)) return json(res, 429, { error: 'too_many_requests' });
    const raw = await new Promise((resolve, reject) => { const ch = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > 64 * 1024) { reject(new Error('too_big')); req.destroy(); } else ch.push(c); }); req.on('end', () => resolve(Buffer.concat(ch).toString('utf8'))); req.on('error', reject); }).catch(() => null);
    if (raw == null) return json(res, 413, { error: 'too_big' });
    const r = await pv.handleWebhook(path.split('/').pop(), raw, req.headers);
    return json(res, r.code, r.body);
  }
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  const ip = clientIp(req);

  /* ── Публичная часть: без регистрации в Sky ── */
  if (path.startsWith('/api/kbiz/public/')) {
    if (!rateLimit(`kbpub:${ip}`, 90 * MULT)) return json(res, 429, { error: 'too_many_requests' });
    let m = /^\/api\/kbiz\/public\/p\/([a-z0-9]{12,24})$/.exec(path);
    if (m && req.method === 'GET') return reply(await publicPage(m[1], ip));
    m = /^\/api\/kbiz\/public\/p\/([a-z0-9]{12,24})\/provider$/.exec(path);
    if (m && req.method === 'POST') {
      if (!rateLimit(`kbprv:${ip}`, 8 * MULT)) return json(res, 429, { error: 'too_many_requests' });
      const body = await parseBody(req);
      if (body?.website) return json(res, 200, { ok: true });
      return reply(await pv.providerPay(m[1], body ?? {}, ip));
    }
    m = /^\/api\/kbiz\/public\/p\/([a-z0-9]{12,24})\/report$/.exec(path);
    if (m && req.method === 'POST') {
      if (!rateLimit(`kbrep:${ip}`, 8 * MULT)) return json(res, 429, { error: 'too_many_requests' });
      const body = await parseBody(req);
      if (body?.website) return json(res, 200, { ok: true });          // ловушка для ботов
      return reply(await reportPayment(m[1], body ?? {}, ip));
    }
    m = /^\/api\/kbiz\/public\/status\/(kbp-[0-9a-f-]{36})$/.exec(path);
    if (m && req.method === 'GET') {
      if (!rateLimit(`kbst:${ip}`, 30 * MULT)) return json(res, 429, { error: 'too_many_requests' });
      return reply(await buyerStatus(m[1], u.searchParams.get('k') ?? ''));
    }
    m = /^\/api\/kbiz\/public\/logo\/(kbz-[0-9a-f-]{36})$/.exec(path);
    if (m && req.method === 'GET') {
      const logo = await logoOf(m[1]);
      if (!logo) return json(res, 404, { error: 'not_found' });
      res.writeHead(200, { 'Content-Type': logo.type, 'Content-Length': logo.data.length, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
      return res.end(logo.data);
    }
    m = /^\/api\/kbiz\/public\/shop\/([a-z0-9-]{3,40})$/.exec(path);
    if (m && req.method === 'GET') return reply(await cat.shopPublic(m[1], req.headers.origin));
    m = /^\/api\/kbiz\/public\/shop\/([a-z0-9-]{3,40})\/order$/.exec(path);
    if (m && req.method === 'POST') {
      if (!rateLimit(`kbord:${ip}`, 8 * MULT)) return json(res, 429, { error: 'too_many_requests' });
      const body = await parseBody(req);
      if (body?.website) return json(res, 200, { ok: true });
      return reply(await cat.createOrder(m[1], body ?? {}, ip, req.headers.origin));
    }
    m = /^\/api\/kbiz\/public\/shop\/([a-z0-9-]{3,40})\/promo$/.exec(path);
    if (m && req.method === 'POST') {
      if (!rateLimit(`kbpr:${ip}`, 20 * MULT)) return json(res, 429, { error: 'too_many_requests' });
      return reply(await cat.promoPreview(m[1], (await parseBody(req)) ?? {}, req.headers.origin));
    }
    m = /^\/api\/kbiz\/public\/shop-order\/(kbo-[0-9a-f-]{36})\/review$/.exec(path);
    if (m && req.method === 'POST') {
      if (!rateLimit(`kbrv:${ip}`, 6 * MULT)) return json(res, 429, { error: 'too_many_requests' });
      return reply(await ex.leaveReview(m[1], u.searchParams.get('k') ?? '', (await parseBody(req)) ?? {}));
    }
    m = /^\/api\/kbiz\/public\/shop-order\/(kbo-[0-9a-f-]{36})$/.exec(path);
    if (m && req.method === 'GET') {
      if (!rateLimit(`kbost:${ip}`, 30 * MULT)) return json(res, 429, { error: 'too_many_requests' });
      return reply(await cat.buyerOrder(m[1], u.searchParams.get('k') ?? ''));
    }
    m = /^\/api\/kbiz\/public\/media\/(kbm-[0-9a-f-]{36})$/.exec(path);
    if (m && req.method === 'GET') {
      const md = await cat.mediaOf(m[1]);
      if (!md) return json(res, 404, { error: 'not_found' });
      res.writeHead(200, { 'Content-Type': md.type, 'Content-Length': md.data.length, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Cross-Origin-Resource-Policy': 'cross-origin' });
      return res.end(md.data);
    }
    return json(res, 404, { error: 'not_found' });
  }

  /* ── Кабинет: владелец и сотрудники ── */
  const s = await requireProfile(req, res); if (!s) return true;
  const actor = s.profileId;
  const acc = await st.accessOf(actor);                    // owner | admin | manager | cashier | null
  const me = acc ? acc.ownerId : actor;                    // функции бизнеса работают «от имени владельца»; журнал ведёт настоящего автора
  if (!rateLimit(`kbiz:${actor}`, 240 * MULT)) return json(res, 429, { error: 'too_many_requests' });
  const body = req.method === 'GET' ? {} : ((await parseBody(req)) ?? {});
  const forbid = () => json(res, 403, { error: 'forbidden' });
  /** Право по группе (kbstaff.PERMS); действия сотрудника (не чтение) пишутся в журнал бизнеса с его именем. */
  const need = async (group) => {
    if (!st.can(acc, group)) return false;
    if (acc.role !== 'owner' && req.method !== 'GET') await audit(acc.businessId, actor, 'staff_action', `${acc.role}: ${req.method} ${path.replace(/(kb[a-z0-9]*-)[0-9a-f-]{36}/g, '$1:id')}`).catch(() => {});
    return true;
  };

  if (req.method === 'GET' && path === '/api/kbiz/me') {
    if (acc && acc.role !== 'owner') {
      const r = await myBusiness(acc.ownerId);
      return json(res, 200, { business: r.business, subscription: r.subscription, requisites: null, payOrigin: r.payOrigin, role: acc.role, roleLabel: st.ROLES[acc.role] });
    }
    return json(res, 200, { ...(await myBusiness(me)), role: acc ? 'owner' : null, invites: (await st.myInvites(actor)).invites });
  }
  if (req.method === 'POST' && path === '/api/kbiz/business') { if (acc) return reply({ error: 'already_exists' }); return reply(await createBusiness(actor, body)); }
  if (req.method === 'PUT' && path === '/api/kbiz/business') { if (!(await need('owner'))) return forbid(); return reply(await updateBusiness(me, body)); }
  if (req.method === 'PUT' && path === '/api/kbiz/business/logo') { if (!(await need('owner'))) return forbid(); return reply(await setLogo(me, body.dataUrl)); }
  if (req.method === 'PUT' && path === '/api/kbiz/requisites') {
    if (!(await need('owner'))) return forbid();
    if (!rateLimit(`kbreq:${me}`, 10)) return json(res, 429, { error: 'too_many_requests' });
    return reply(await setRequisites(me, s.skyId, body));
  }
  if (req.method === 'POST' && path === '/api/kbiz/publish') { if (!(await need('owner'))) return forbid(); return reply(await publish(me, body.on !== false)); }

  if (req.method === 'GET' && path === '/api/kbiz/subscription') {
    if (!(await need('owner'))) return forbid();
    const { rows } = await query('SELECT id FROM kb_businesses WHERE owner_id = $1', [me]);
    if (!rows[0]) return json(res, 200, { subscription: { status: 'inactive', active: false, priceRub: SUB_PRICE_RUB, periodDays: SUB_PERIOD_DAYS }, history: [] });
    return json(res, 200, { subscription: await subState(rows[0].id), history: await subHistory(rows[0].id) });
  }
  if (req.method === 'POST' && path === '/api/kbiz/subscription/buy') {
    if (!(await need('owner'))) return forbid();
    if (!rateLimit(`kbsub:${me}`, 6)) return json(res, 429, { error: 'too_many_requests' });
    return reply(await buySub(me, body.idemKey));
  }

  /* Сотрудники */
  let m = /^\/api\/kbiz\/staff\/(kbs2-[0-9a-f-]{36})(?:\/([a-z]+))?$/.exec(path);
  if (req.method === 'GET' && path === '/api/kbiz/staff') { if (!(await need('owner'))) return forbid(); return json(res, 200, await st.listStaff(me)); }
  if (req.method === 'POST' && path === '/api/kbiz/staff') { if (!(await need('owner'))) return forbid(); if (!rateLimit(`kbinv:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' }); return reply(await st.invite(me, body)); }
  if (m && m[2] === 'role' && req.method === 'POST') { if (!(await need('owner'))) return forbid(); return reply(await st.setRole(me, m[1], body.role)); }
  if (m && !m[2] && req.method === 'DELETE') return reply(await st.removeStaff(actor, acc?.ownerId ?? '', m[1]));    // владелец убирает, сотрудник выходит сам
  if (m && (m[2] === 'accept' || m[2] === 'decline') && req.method === 'POST') return reply(await st.answerInvite(actor, m[1], m[2] === 'accept'));

  /* Платёжный партнёр (только владелец) */
  if (path === '/api/kbiz/provider') {
    if (!(await need('owner'))) return forbid();
    if (req.method === 'GET') return json(res, 200, await pv.getProvider(me));
    if (req.method === 'PUT') { if (!rateLimit(`kbprov:${me}`, 10)) return json(res, 429, { error: 'too_many_requests' }); return reply(await pv.setProvider(me, s.skyId, body)); }
    if (req.method === 'DELETE') return reply(await pv.removeProvider(me, s.skyId, body.twoFactorCode));
  }
  if (req.method === 'POST' && path === '/api/kbiz/provider/ping') { if (!(await need('owner'))) return forbid(); if (!rateLimit(`kbprp:${me}`, 10)) return json(res, 429, { error: 'too_many_requests' }); return reply(await pv.pingProvider(me)); }

  /* QR и заявки на оплату */
  if (req.method === 'GET' && path === '/api/kbiz/qr') { if (!(await need('view'))) return forbid(); return json(res, 200, await listQr(me)); }
  if (req.method === 'POST' && path === '/api/kbiz/qr') { if (!(await need('qr'))) return forbid(); return reply(await createQr(me, body)); }
  if (req.method === 'POST' && path === '/api/kbiz/qr/permanent') { if (!(await need('qr'))) return forbid(); return reply(await createQr(me, body, { permanent: true })); }
  m = /^\/api\/kbiz\/qr\/(kbq-[0-9a-f-]{36})\/status$/.exec(path);
  if (req.method === 'POST' && m) { if (!(await need('qr'))) return forbid(); return reply(await setQrStatus(me, m[1], body.status)); }

  if (req.method === 'GET' && path === '/api/kbiz/payments') { if (!(await need('view'))) return forbid(); return json(res, 200, await listPayments(me, { status: u.searchParams.get('status') ?? '', qrId: u.searchParams.get('qr') ?? '' })); }
  m = /^\/api\/kbiz\/payments\/(kbp-[0-9a-f-]{36})\/log$/.exec(path);
  if (req.method === 'GET' && m) { if (!(await need('view'))) return forbid(); return json(res, 200, await paymentLog(me, m[1])); }
  m = /^\/api\/kbiz\/payments\/(kbp-[0-9a-f-]{36})\/([a-z_]+)$/.exec(path);
  if (req.method === 'POST' && m) { if (!(await need('confirm'))) return forbid(); return reply(await actOnPayment(me, m[1], m[2], body.comment, actor)); }

  /* Касса */
  if (req.method === 'POST' && path === '/api/kbiz/cash') { if (!(await need('cash'))) return forbid(); if (!rateLimit(`kbcash:${actor}`, 60 * MULT)) return json(res, 429, { error: 'too_many_requests' }); return reply(await ex.createCash(me, actor, body)); }
  if (req.method === 'GET' && path === '/api/kbiz/cash') { if (!(await need('cash'))) return forbid(); return json(res, 200, await ex.cashRecent(me, actor, acc.role === 'cashier')); }
  m = /^\/api\/kbiz\/cash\/(kbq-[0-9a-f-]{36})$/.exec(path);
  if (req.method === 'GET' && m) { if (!(await need('cash'))) return forbid(); return reply(await ex.cashStatus(me, m[1])); }

  /* Каталог, витрина, заказы, чаевые, счета */
  let mm = /^\/api\/kbiz\/items\/(kbi-[0-9a-f-]{36})(\/photo)?$/.exec(path);
  if (path.startsWith('/api/kbiz/items') || path.startsWith('/api/kbiz/orders') || path.startsWith('/api/kbiz/tips') || path.startsWith('/api/kbiz/invoices') || path.startsWith('/api/kbiz/promos') || path.startsWith('/api/kbiz/reviews')) {
    if (!(await need('catalog'))) return forbid();
  }
  if (req.method === 'GET' && path === '/api/kbiz/items') return json(res, 200, await cat.listItems(me));
  if (req.method === 'POST' && path === '/api/kbiz/items') return reply(await cat.saveItem(me, null, body));
  if (mm && !mm[2] && req.method === 'PUT') return reply(await cat.saveItem(me, mm[1], body));
  if (mm && !mm[2] && req.method === 'DELETE') return reply(await cat.archiveItem(me, mm[1]));
  if (mm && mm[2] && req.method === 'PUT') return reply(await cat.setItemPhoto(me, mm[1], body.dataUrl));
  if (path.startsWith('/api/kbiz/shop')) { if (!(await need('shop'))) return forbid(); }
  if (req.method === 'GET' && path === '/api/kbiz/shop') return json(res, 200, await cat.getShop(me));
  if (req.method === 'PUT' && path === '/api/kbiz/shop') return reply(await cat.setShop(me, body));
  if (req.method === 'GET' && path === '/api/kbiz/shop/package.tar.gz') {
    const pk = await shopPackage(me, u.searchParams.get('api') || '');
    if (pk.error) return reply(pk);
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="sky-shop.tar.gz"', 'Cache-Control': 'no-store', 'Content-Length': pk.data.length });
    return res.end(pk.data);
  }
  if (req.method === 'GET' && path === '/api/kbiz/orders') return json(res, 200, await cat.listOrders(me, { status: u.searchParams.get('status') ?? '' }));
  mm = /^\/api\/kbiz\/orders\/(kbo-[0-9a-f-]{36})\/([a-z-]+)$/.exec(path);
  if (req.method === 'POST' && mm) {
    if (mm[2] === 'renew-pay') return reply(await cat.renewOrderPay(me, mm[1]));
    if (mm[2] === 'invoice') return reply(await cat.invoiceFromOrder(me, mm[1]));
    return reply(await cat.actOnOrder(me, mm[1], mm[2], body.comment));
  }
  if (req.method === 'GET' && path === '/api/kbiz/tips') return json(res, 200, await cat.listTips(me));
  if (req.method === 'POST' && path === '/api/kbiz/tips') return reply(await cat.createTip(me, body));
  if (req.method === 'GET' && path === '/api/kbiz/invoices') return json(res, 200, await cat.listInvoices(me));
  if (req.method === 'POST' && path === '/api/kbiz/invoices') return reply(await cat.createInvoice(me, body));
  mm = /^\/api\/kbiz\/invoices\/(kbv-[0-9a-f-]{36})(?:\/([a-z]+))?$/.exec(path);
  if (mm && !mm[2] && req.method === 'PUT') return reply(await cat.updateInvoice(me, mm[1], body));
  if (mm && mm[2] === 'send' && req.method === 'POST') return reply(await cat.sendInvoice(me, mm[1]));
  if (mm && mm[2] === 'cancel' && req.method === 'POST') return reply(await cat.cancelInvoice(me, mm[1]));
  /* Промокоды и отзывы */
  if (req.method === 'GET' && path === '/api/kbiz/promos') return json(res, 200, await ex.listPromos(me));
  if (req.method === 'POST' && path === '/api/kbiz/promos') return reply(await ex.createPromo(me, actor, body));
  mm = /^\/api\/kbiz\/promos\/(kbc-[0-9a-f-]{36})\/status$/.exec(path);
  if (req.method === 'POST' && mm) return reply(await ex.setPromoStatus(me, actor, mm[1], body.status));
  if (req.method === 'GET' && path === '/api/kbiz/reviews') return json(res, 200, await ex.listReviews(me));
  mm = /^\/api\/kbiz\/reviews\/(kbr-[0-9a-f-]{36})$/.exec(path);
  if (req.method === 'POST' && mm) return reply(await ex.moderateReview(me, actor, mm[1], { status: body.status, reply: body.reply }));

  if (req.method === 'GET' && path === '/api/kbiz/overview') { if (!(await need('view'))) return forbid(); return json(res, 200, await overview(me)); }
  if (req.method === 'GET' && path === '/api/kbiz/analytics') { if (!(await need('analytics'))) return forbid(); return json(res, 200, await ex.analytics(me, u.searchParams.get('days'))); }
  if (req.method === 'GET' && path === '/api/kbiz/audit') { if (!(await need('audit'))) return forbid(); return json(res, 200, await auditList(me)); }
  if (req.method === 'GET' && path === '/api/kbiz/export.csv') {
    if (!(await need('confirm'))) return forbid();
    const csv = await exportPaymentsCsv(me);
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="skykassa-payments.csv"', 'Cache-Control': 'no-store' });
    return res.end(csv);
  }
  if (req.method === 'POST' && path === '/api/kbiz/scan') {
    if (!rateLimit(`kbscan:${actor}`, 20)) return json(res, 429, { error: 'too_many_requests' });
    return reply(await scan(actor, body.text));
  }
  return json(res, 404, { error: 'not_found' });
};
