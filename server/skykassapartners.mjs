/**
 * SkyKassa — платёжные партнёры.
 *
 * Архитектура: партнёр — запись в skykassa_partners + адаптер. Сейчас есть один
 * адаптер `hmac-v1` (протокол ниже); под конкретного провайдера (ЮKassa, CloudPayments
 * и т. п.) пишется отдельный адаптер по ЕГО официальной документации и по договору —
 * без договора и ключей партнёр остаётся «не подключён» и людям недоступен.
 *
 * Секреты (SKYKASSA_PARTNER_<ID>_SECRET, _MERCHANT) живут только в окружении сервера:
 * ни в базе, ни в ответах API, ни в браузере.
 *
 * Протокол hmac-v1 (все запросы и вебхуки подписаны):
 *   подпись = hex(HMAC-SHA256(secret, `${timestamp}.${тело}`)), заголовки X-Timestamp, X-Signature
 *   POST {base}/payments   {merchant, order_id, amount, currency, description, return_url, webhook_url}
 *                          → {payment_id, pay_url}
 *   GET  {base}/payments/{payment_id}  → {status: pending|paid|failed|cancelled|expired|refunded, amount, currency}
 *   GET  {base}/ping       → 200 (проверка связи)
 *   Вебхук к нам: POST /api/skykassa/webhook/{partnerId}, тело {event_id, payment_id, order_id, status}.
 * Переход на страницу «успех» и вебхук сами по себе платёж не подтверждают: статус всегда
 * перепроверяется прямым подписанным запросом к партнёру, сумма и валюта сверяются.
 */
import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { resolveSafeUrl } from './bloxnet.mjs';
import { confirmAndCredit, notifyCompleted } from './skykassareview.mjs';
import {
  CURRENCY, KErr, newId, clean, iso, seal, open, inTx, transition, lockPayment, notifyOnce, rub,
} from './skykassacore.mjs';

const TEST_PRIVATE = process.env.BLOX_ALLOW_PRIVATE === '1' && config.nodeEnv !== 'production';
const TIMEOUT_MS = 8000;
const MAX_BODY = 64 * 1024;
const SKEW_SEC = 300;
const ID_RE = /^[a-z][a-z0-9_-]{1,30}$/;

export const envKey = (id, suffix) => `SKYKASSA_PARTNER_${String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}_${suffix}`;
const secretOf = (id) => process.env[envKey(id, 'SECRET')] ?? '';
const merchantOf = (id) => process.env[envKey(id, 'MERCHANT')] ?? '';

/** Подключён ли партнёр по-настоящему: есть адрес и секреты на сервере. */
export const partnerConfigured = (p) => Boolean(p.base_url && secretOf(p.id).length >= 16 && merchantOf(p.id));

export const sign = (secret, ts, body) =>
  crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/* ─── Исходящий запрос по проверенному адресу ──────────────────────── */

const pinned = (target, { method, headers, body }) => new Promise((resolve) => {
  const lib = target.url.protocol === 'https:' ? https : http;
  const chunks = []; let size = 0; let done = false;
  const finish = (v) => { if (!done) { done = true; resolve(v); } };
  const req = lib.request({
    host: target.addresses[0], port: target.port, method,
    path: `${target.url.pathname}${target.url.search}`,
    servername: net.isIP(target.host) ? undefined : target.host,
    headers: { Host: target.url.host, 'User-Agent': 'SkyKassa/1', Accept: 'application/json', ...headers },
    timeout: TIMEOUT_MS, rejectUnauthorized: !TEST_PRIVATE,
  }, (res) => {
    res.on('data', (c) => { size += c.length; if (size > MAX_BODY) { res.destroy(); finish({ ok: false, error: 'too_big' }); } else chunks.push(c); });
    res.on('end', () => finish({ ok: true, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    res.on('error', () => finish({ ok: false, error: 'reset' }));
  });
  req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'timeout' }); });
  req.on('error', (e) => finish({ ok: false, error: e.code ?? 'connect' }));
  if (body) req.write(body);
  req.end();
});

const call = async (partner, method, path, payload) => {
  const secret = secretOf(partner.id);
  if (!partnerConfigured(partner)) throw new KErr('partner_not_connected');
  const t = await resolveSafeUrl(`${String(partner.base_url).replace(/\/+$/, '')}${path}`, { label: 'Адрес партнёра' });
  if (!t.ok) throw new KErr('partner_bad_url', { message: t.message });
  const body = payload ? JSON.stringify(payload) : '';
  const ts = String(Math.floor(Date.now() / 1000));
  const r = await pinned(t, {
    method, body,
    headers: {
      'X-Timestamp': ts, 'X-Signature': sign(secret, ts, body),
      ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
    },
  });
  if (!r.ok) throw new KErr('partner_unreachable', { detail: r.error });
  if (r.status < 200 || r.status >= 300) throw new KErr('partner_error', { detail: `HTTP ${r.status}` });
  if (!r.body) return {};
  try { return JSON.parse(r.body); } catch { throw new KErr('partner_bad_answer'); }
};

/* ─── Стоимость и доступность ──────────────────────────────────────── */

export const feeFor = (p, amount) => Math.ceil((amount * Number(p.fee_percent)) / 100) + Number(p.fee_fixed);

const inList = (list, v) => !Array.isArray(list) || list.length === 0 || list.includes(v);

export const partnerOptions = async ({ amount, destination, app }) => {
  const { rows } = await query('SELECT * FROM skykassa_partners WHERE enabled AND deleted_at IS NULL ORDER BY sort, created_at');
  const out = [];
  for (const p of rows) {
    if (!inList(p.destinations, destination) || !inList(p.apps, app) || !inList(p.currencies, CURRENCY)) continue;
    if (amount < Number(p.min_amount) || amount > Number(p.max_amount)) continue;
    const fee = feeFor(p, amount);
    const ok = partnerConfigured(p) && p.last_check_ok !== false;
    out.push({
      id: p.id, title: p.title, logo: p.logo_url, methods: p.methods, feePercent: Number(p.fee_percent), feeFixed: Number(p.fee_fixed),
      fee, total: amount + fee, min: Number(p.min_amount), max: Number(p.max_amount), note: p.note,
      available: ok, status: !partnerConfigured(p) ? 'not_connected' : (p.last_check_ok === false ? 'unavailable' : 'ok'),
    });
  }
  return out;
};

/* ─── Создание платежа у партнёра (внутри транзакции платежа) ──────── */

export const partnerCreate = async (c, pay, partnerId, settings) => {
  if (!settings.partnersEnabled) throw new KErr('partner_unavailable');
  const { rows } = await c.query('SELECT * FROM skykassa_partners WHERE id = $1 AND enabled AND deleted_at IS NULL', [String(partnerId).slice(0, 40)]);
  const p = rows[0];
  const amount = Number(pay.amount);
  if (!p || !inList(p.destinations, pay.destination) || !inList(p.apps, pay.app) || !inList(p.currencies, CURRENCY)
    || amount < Number(p.min_amount) || amount > Number(p.max_amount)) throw new KErr('partner_unavailable');
  if (!partnerConfigured(p)) throw new KErr('partner_not_connected');
  const fee = feeFor(p, amount);
  const origin = config.publicOrigin || '';
  const r = await call(p, 'POST', '/payments', {
    merchant: merchantOf(p.id), order_id: pay.id, amount: amount + fee, currency: CURRENCY,
    description: `Пополнение Sky, заявка ${pay.number}`,
    return_url: `${origin}/?skykassa=${encodeURIComponent(pay.id)}`,
    webhook_url: `${origin}/api/skykassa/webhook/${p.id}`,
  });
  const ref = clean(r.payment_id, 120);
  let url = String(r.pay_url ?? '');
  try { const u = new URL(url); if (u.protocol !== 'https:' && !TEST_PRIVATE) throw new Error('scheme'); if (u.username || u.password) throw new Error('creds'); } catch { throw new KErr('partner_bad_answer'); }
  if (!ref) throw new KErr('partner_bad_answer');
  await transition(c, pay, 'awaiting_payment', {
    actorId: pay.user_id, actorKind: 'user', reason: `Партнёр: ${p.title}`,
    set: { kind: 'partner', partner_id: p.id, partner_title: p.title, partner_ref: ref, partner_url_sealed: seal({ url }), fee, total: amount + fee },
  });
  return { fee, total: amount + fee };
};

/* ─── Применить результат, проверенный у партнёра ──────────────────── */

const applyStatus = async (pay0, remote, source) => {
  let credited = false;
  let note = null;
  const result = await inTx(async (c) => {
    const pay = await lockPayment(c, pay0.id);
    if (!pay) return 'gone';
    const st = String(remote.status ?? '');
    if (st === 'paid') {
      if (pay.status !== 'awaiting_payment') return 'noop';
      if (Number(remote.amount) !== Number(pay.total) || String(remote.currency ?? CURRENCY) !== pay.currency) {
        await transition(c, pay, 'confirmed', { actorKind: 'partner', reason: 'Сумма у партнёра не совпала с заявкой' });
        await transition(c, pay, 'error', { actorKind: 'system', reason: 'Несовпадение суммы', set: { error_text: 'partner_amount_mismatch' } });
        return 'mismatch';
      }
      await confirmAndCredit(c, pay, { actorKind: 'partner', reason: `Оплата подтверждена партнёром (${source})` });
      credited = true; note = pay;
      return 'paid';
    }
    if (['failed', 'cancelled', 'expired'].includes(st)) {
      if (!['created', 'awaiting_payment'].includes(pay.status)) return 'noop';
      const to = st === 'expired' ? 'expired' : 'cancelled_system';
      await transition(c, pay, to, { actorKind: 'partner', reason: `Партнёр: ${st}`, set: { cancel_reason: `Партнёр сообщил: ${st}` } });
      note = pay;
      return st;
    }
    if (st === 'refunded' && ['completed', 'refunded_partial'].includes(pay.status)) {
      const rid = newId('skf');
      try {
        await c.query("INSERT INTO skykassa_refunds (id, payment_id, amount, reason) VALUES ($1,$2,$3,'Партнёр сообщил о возврате')", [rid, pay.id, Number(pay.amount)]);
      } catch (e) { if (e.code === '23505') return 'noop'; throw e; }
      await transition(c, pay, 'refund_requested', { actorKind: 'partner', reason: 'Партнёр сообщил о возврате' });
      return 'refund';
    }
    return 'noop';
  });
  if (credited && note) await notifyCompleted(note);
  else if (note && (result === 'failed' || result === 'cancelled' || result === 'expired')) {
    await notifyOnce(note.user_id, `${note.id}:${note.status}`, 'SkyKassa', `Платёж ${note.number} не завершён: партнёр отклонил или отменил оплату.`);
  }
  return result;
};

const fetchRemote = async (pay) => {
  const { rows } = await query('SELECT * FROM skykassa_partners WHERE id = $1', [pay.partner_id]);
  if (!rows[0]) throw new KErr('partner_unavailable');
  return call(rows[0], 'GET', `/payments/${encodeURIComponent(pay.partner_ref)}`);
};

/** Серверная проверка статуса у партнёра (вызывается при возврате человека и по расписанию). */
export const partnerRefresh = async (paymentId) => {
  const { rows } = await query('SELECT * FROM skykassa_payments WHERE id = $1', [paymentId]);
  const pay = rows[0];
  if (!pay || pay.kind !== 'partner' || !pay.partner_ref || !['awaiting_payment'].includes(pay.status)) return 'noop';
  const remote = await fetchRemote(pay);
  return applyStatus(pay, remote, 'проверка');
};

/* ─── Вебхук ───────────────────────────────────────────────────────── */

export const handleWebhook = async (partnerId, raw, headers) => {
  if (!ID_RE.test(String(partnerId))) return { code: 404, body: { error: 'not_found' } };
  const { rows } = await query('SELECT * FROM skykassa_partners WHERE id = $1 AND deleted_at IS NULL', [partnerId]);
  const p = rows[0];
  if (!p || !p.enabled) return { code: 404, body: { error: 'not_found' } };
  if (!partnerConfigured(p)) return { code: 503, body: { error: 'not_connected' } };
  const ts = String(headers['x-timestamp'] ?? '');
  const sig = String(headers['x-signature'] ?? '');
  if (!/^\d{9,12}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > SKEW_SEC) return { code: 401, body: { error: 'bad_timestamp' } };
  if (!safeEq(sig, sign(secretOf(p.id), ts, raw))) return { code: 401, body: { error: 'bad_signature' } };
  let ev;
  try { ev = JSON.parse(raw); } catch { return { code: 400, body: { error: 'bad_json' } }; }
  const eventId = clean(ev?.event_id, 120);
  if (!eventId) return { code: 400, body: { error: 'no_event_id' } };

  const ins = await query(
    'INSERT INTO skykassa_webhooks (partner_id, event_id, payment_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [p.id, eventId, clean(ev?.order_id, 80) || null]);
  if (!ins.rowCount) return { code: 200, body: { ok: true, duplicate: true } };

  const { rows: pr } = await query(
    'SELECT * FROM skykassa_payments WHERE id = $1 AND partner_id = $2 AND partner_ref = $3',
    [clean(ev?.order_id, 80), p.id, clean(ev?.payment_id, 120)]);
  if (!pr[0]) { await query('UPDATE skykassa_webhooks SET result = $3 WHERE partner_id = $1 AND event_id = $2', [p.id, eventId, 'unknown_payment']); return { code: 404, body: { error: 'unknown_payment' } }; }
  let result;
  try {
    const remote = await fetchRemote(pr[0]);                // содержимое вебхука — только повод проверить
    result = await applyStatus(pr[0], remote, 'вебхук');
  } catch (err) {
    /* Не смогли проверить: забываем событие, чтобы повтор партнёра был обработан. */
    await query('DELETE FROM skykassa_webhooks WHERE partner_id = $1 AND event_id = $2', [p.id, eventId]);
    console.error('[skykassa] вебхук не проверен:', err.message);
    return { code: 502, body: { error: 'verify_failed' } };
  }
  await query('UPDATE skykassa_webhooks SET result = $3 WHERE partner_id = $1 AND event_id = $2', [p.id, eventId, result]);
  return { code: 200, body: { ok: true } };
};

/* ─── Для админки ──────────────────────────────────────────────────── */

export const partnerStatusView = (p) => ({
  id: p.id, title: p.title, logo: p.logo_url, adapter: p.adapter, baseUrl: p.base_url, enabled: p.enabled,
  sort: p.sort, currencies: p.currencies, methods: p.methods, min: Number(p.min_amount), max: Number(p.max_amount),
  feePercent: Number(p.fee_percent), feeFixed: Number(p.fee_fixed), destinations: p.destinations, apps: p.apps, note: p.note,
  connected: partnerConfigured(p),
  secretsMissing: [
    ...(secretOf(p.id).length >= 16 ? [] : [envKey(p.id, 'SECRET')]),
    ...(merchantOf(p.id) ? [] : [envKey(p.id, 'MERCHANT')]),
  ],
  lastCheckAt: iso(p.last_check_at), lastCheckOk: p.last_check_ok, lastCheckMsg: p.last_check_msg,
  webhookPath: `/api/skykassa/webhook/${p.id}`,
});

export const partnerPing = async (p) => {
  let ok = false; let msg = '';
  if (!partnerConfigured(p)) msg = 'Не заданы адрес или секреты на сервере.';
  else {
    try { await call(p, 'GET', '/ping'); ok = true; msg = 'Связь есть.'; } catch (e) { msg = e.extra?.message || e.extra?.detail || e.kcode || e.message; }
  }
  await query('UPDATE skykassa_partners SET last_check_at = now(), last_check_ok = $2, last_check_msg = $3 WHERE id = $1', [p.id, partnerConfigured(p) ? ok : null, clean(msg, 200)]);
  return { ok, message: msg };
};

/** Раз в час: платежи у партнёров, по которым вебхук мог не дойти. */
export const sweepPartners = async () => {
  const { rows } = await query(
    "SELECT id FROM skykassa_payments WHERE kind = 'partner' AND status = 'awaiting_payment' AND partner_ref IS NOT NULL ORDER BY created_at LIMIT 100");
  for (const r of rows) await partnerRefresh(r.id).catch(() => {});
};

export { rub };
