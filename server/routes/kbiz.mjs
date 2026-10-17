import { json, parseBody, requireProfile, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { myBusiness, createBusiness, updateBusiness, setLogo, logoOf, setRequisites, publish, subState, subHistory, buySub, listQr, createQr, setQrStatus,
  publicPage, reportPayment, buyerStatus, listPayments, paymentLog, actOnPayment, auditList, exportPaymentsCsv, overview, scan, SUB_PRICE_RUB, SUB_PERIOD_DAYS } from './../kbiz.mjs';
import { query } from './../db.mjs';
import * as cat from './../kbcatalog.mjs';
import { shopPackage } from './../kbpackage.mjs';

const MULT = Math.max(1, Number(process.env.KBIZ_RATE_MULT) || 1);        // для тестов
const STATUS = { not_found: 404, no_business: 404, already_exists: 409, bad_state: 409, suspended: 403, subscription_required: 402, insufficient_funds: 402, bad_field: 400, bad_action: 400,
  bad_status: 400, bad_logo: 400, logo_too_large: 413, secret_words: 400, requisites_required: 409, too_many_qr: 429, too_many_requests: 429, comment_required: 400, bad_amount: 400,
  page_unavailable: 410, origin_not_allowed: 403, shop_not_configured: 409, package_unavailable: 503, shop_unavailable: 410, empty_cart: 400, item_unavailable: 409, variant_required: 400, too_many_items: 429, too_many_media: 429, slug_taken: 409, not_skykassa_qr: 400, two_factor_required: 403, invalid_code: 403, archived: 409 };

/** SkyKassa Business: /api/kbiz/* — кабинет владельца (вход обязателен), /api/kbiz/public/* — страница оплаты для покупателя (без входа). */
export const kbizRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;
  if (!path.startsWith('/api/kbiz/')) return false;
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  const ip = clientIp(req);

  /* ── Публичная часть: без регистрации в Sky ── */
  if (path.startsWith('/api/kbiz/public/')) {
    if (!rateLimit(`kbpub:${ip}`, 90 * MULT)) return json(res, 429, { error: 'too_many_requests' });
    let m = /^\/api\/kbiz\/public\/p\/([a-z0-9]{12,24})$/.exec(path);
    if (m && req.method === 'GET') return reply(await publicPage(m[1], ip));
    m = /^\/api\/kbiz\/public\/p\/([a-z0-9]{12,24})\/report$/.exec(path);
    if (m && req.method === 'POST') {
      if (!rateLimit(`kbrep:${ip}`, 8)) return json(res, 429, { error: 'too_many_requests' });
      const body = await parseBody(req);
      if (body?.website) return json(res, 200, { ok: true });          // ловушка для ботов
      return reply(await reportPayment(m[1], body ?? {}, ip));
    }
    m = /^\/api\/kbiz\/public\/status\/(kbp-[0-9a-f-]{36})$/.exec(path);
    if (m && req.method === 'GET') {
      if (!rateLimit(`kbst:${ip}`, 30)) return json(res, 429, { error: 'too_many_requests' });
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
    m = /^\/api\/kbiz\/public\/shop-order\/(kbo-[0-9a-f-]{36})$/.exec(path);
    if (m && req.method === 'GET') {
      if (!rateLimit(`kbost:${ip}`, 30)) return json(res, 429, { error: 'too_many_requests' });
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

  /* ── Кабинет ── */
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;
  if (!rateLimit(`kbiz:${me}`, 240)) return json(res, 429, { error: 'too_many_requests' });
  const body = req.method === 'GET' ? {} : ((await parseBody(req)) ?? {});

  if (req.method === 'GET' && path === '/api/kbiz/me') return json(res, 200, await myBusiness(me));
  if (req.method === 'POST' && path === '/api/kbiz/business') return reply(await createBusiness(me, body));
  if (req.method === 'PUT' && path === '/api/kbiz/business') return reply(await updateBusiness(me, body));
  if (req.method === 'PUT' && path === '/api/kbiz/business/logo') return reply(await setLogo(me, body.dataUrl));
  if (req.method === 'PUT' && path === '/api/kbiz/requisites') {
    if (!rateLimit(`kbreq:${me}`, 10)) return json(res, 429, { error: 'too_many_requests' });
    return reply(await setRequisites(me, s.skyId, body));
  }
  if (req.method === 'POST' && path === '/api/kbiz/publish') return reply(await publish(me, body.on !== false));

  if (req.method === 'GET' && path === '/api/kbiz/subscription') {
    const { rows } = await query('SELECT id FROM kb_businesses WHERE owner_id = $1', [me]);
    if (!rows[0]) return json(res, 200, { subscription: { status: 'inactive', active: false, priceRub: SUB_PRICE_RUB, periodDays: SUB_PERIOD_DAYS }, history: [] });
    return json(res, 200, { subscription: await subState(rows[0].id), history: await subHistory(rows[0].id) });
  }
  if (req.method === 'POST' && path === '/api/kbiz/subscription/buy') {
    if (!rateLimit(`kbsub:${me}`, 6)) return json(res, 429, { error: 'too_many_requests' });
    return reply(await buySub(me, body.idemKey));
  }

  if (req.method === 'GET' && path === '/api/kbiz/qr') return json(res, 200, await listQr(me));
  if (req.method === 'POST' && path === '/api/kbiz/qr') return reply(await createQr(me, body));
  if (req.method === 'POST' && path === '/api/kbiz/qr/permanent') return reply(await createQr(me, body, { permanent: true }));
  let m = /^\/api\/kbiz\/qr\/(kbq-[0-9a-f-]{36})\/status$/.exec(path);
  if (req.method === 'POST' && m) return reply(await setQrStatus(me, m[1], body.status));

  if (req.method === 'GET' && path === '/api/kbiz/payments') return json(res, 200, await listPayments(me, { status: u.searchParams.get('status') ?? '', qrId: u.searchParams.get('qr') ?? '' }));
  m = /^\/api\/kbiz\/payments\/(kbp-[0-9a-f-]{36})\/log$/.exec(path);
  if (req.method === 'GET' && m) return json(res, 200, await paymentLog(me, m[1]));
  m = /^\/api\/kbiz\/payments\/(kbp-[0-9a-f-]{36})\/([a-z_]+)$/.exec(path);
  if (req.method === 'POST' && m) return reply(await actOnPayment(me, m[1], m[2], body.comment));

  let mm = /^\/api\/kbiz\/items\/(kbi-[0-9a-f-]{36})(\/photo)?$/.exec(path);
  if (req.method === 'GET' && path === '/api/kbiz/items') return json(res, 200, await cat.listItems(me));
  if (req.method === 'POST' && path === '/api/kbiz/items') return reply(await cat.saveItem(me, null, body));
  if (mm && !mm[2] && req.method === 'PUT') return reply(await cat.saveItem(me, mm[1], body));
  if (mm && !mm[2] && req.method === 'DELETE') return reply(await cat.archiveItem(me, mm[1]));
  if (mm && mm[2] && req.method === 'PUT') return reply(await cat.setItemPhoto(me, mm[1], body.dataUrl));
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

  if (req.method === 'GET' && path === '/api/kbiz/overview') return json(res, 200, await overview(me));
  if (req.method === 'GET' && path === '/api/kbiz/audit') return json(res, 200, await auditList(me));
  if (req.method === 'GET' && path === '/api/kbiz/export.csv') {
    const csv = await exportPaymentsCsv(me);
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="skykassa-payments.csv"', 'Cache-Control': 'no-store' });
    return res.end(csv);
  }
  if (req.method === 'POST' && path === '/api/kbiz/scan') {
    if (!rateLimit(`kbscan:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' });
    return reply(await scan(me, body.text));
  }
  return json(res, 404, { error: 'not_found' });
};
