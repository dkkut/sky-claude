/**
 * SkyKassa Business, этап 4: платёжный партнёр бизнеса (сторонняя касса) через адаптер.
 *
 * Бизнес сам подключает своего провайдера: адрес API, идентификатор мерчанта и секрет подписи (хранится зашифрованным и наружу не отдаётся).
 * Протокол адаптера `hmac-v1` тот же, что у SkyKassa-партнёров (см. шапку skykassapartners.mjs): подпись HMAC-SHA256 по `${timestamp}.${тело}`.
 * Под конкретного провайдера (ЮKassa, CloudPayments…) пишется отдельный адаптер по его документации и договору — здесь реальных провайдеров НЕТ.
 * Тестовый провайдер для проверки — scripts/audit/fakes/kbiz-provider.mjs.
 *
 * Sky деньги не принимает: человек платит у провайдера бизнеса. Статус «подтверждено интеграцией» ставится ТОЛЬКО после прямого
 * подписанного запроса к провайдеру (вебхук — лишь повод проверить) и совпадения суммы и валюты. Любой сбой — платёж остаётся неподтверждённым.
 */
import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { resolveSafeUrl } from './bloxnet.mjs';
import { encryptSecret, openSecret } from './crypto.mjs';
import { verifySkyTwoFactor } from './skyid.mjs';
import { notifyGift } from './giftnotify.mjs';
import { newId, inTx, clean } from './gocore.mjs';
import { err, audit, ipHash, keyHash, loadPublic, pageState, subState, MAX_AMOUNT, STATUS_LABEL } from './kbiz.mjs';

const TEST_PRIVATE = process.env.BLOX_ALLOW_PRIVATE === '1' && config.nodeEnv !== 'production';
const TIMEOUT_MS = 8000; const MAX_BODY = 64 * 1024; const SKEW_SEC = 300;
export const sign = (secret, ts, body) => crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const pinned = (target, { method, headers, body }) => new Promise((resolve) => {
  const lib = target.url.protocol === 'https:' ? https : http;
  const chunks = []; let size = 0; let done = false; const finish = (v) => { if (!done) { done = true; resolve(v); } };
  const req = lib.request({ host: target.addresses[0], port: target.port, method, path: `${target.url.pathname}${target.url.search}`, servername: net.isIP(target.host) ? undefined : target.host,
    headers: { Host: target.url.host, 'User-Agent': 'SkyKassaBusiness/1', Accept: 'application/json', ...headers }, timeout: TIMEOUT_MS, rejectUnauthorized: !TEST_PRIVATE }, (res) => {
    res.on('data', (c) => { size += c.length; if (size > MAX_BODY) { res.destroy(); finish({ ok: false, error: 'too_big' }); } else chunks.push(c); });
    res.on('end', () => finish({ ok: true, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    res.on('error', () => finish({ ok: false, error: 'reset' }));
  });
  req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'timeout' }); });
  req.on('error', (e) => finish({ ok: false, error: e.code ?? 'connect' }));
  if (body) req.write(body); req.end();
});

/** Подписанный запрос к провайдеру: адрес проверяется на SSRF после собственного DNS-разбора (только https, публичные IP, без редиректов). */
const call = async (prov, method, path, payload) => {
  const t = await resolveSafeUrl(`${String(prov.base_url).replace(/\/+$/, '')}${path}`, { label: 'Адрес провайдера' });
  if (!t.ok) throw Object.assign(new Error('provider_bad_url'), { code: 'provider_bad_url', detail: t.message });
  const secret = openSecret(prov.secret_enc);
  const body = payload ? JSON.stringify(payload) : ''; const ts = String(Math.floor(Date.now() / 1000));
  const r = await pinned(t, { method, body, headers: { 'X-Timestamp': ts, 'X-Signature': sign(secret, ts, body), ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } });
  if (!r.ok) throw Object.assign(new Error('provider_unreachable'), { code: 'provider_unreachable', detail: r.error });
  if (r.status < 200 || r.status >= 300) throw Object.assign(new Error('provider_error'), { code: 'provider_error', detail: `HTTP ${r.status}` });
  if (!r.body) return {};
  try { return JSON.parse(r.body); } catch { throw Object.assign(new Error('provider_bad_answer'), { code: 'provider_bad_answer' }); }
};
const provOf = async (businessId) => (await query('SELECT * FROM kb_providers WHERE business_id = $1', [businessId])).rows[0] ?? null;
const errCode = (e) => err(e?.code && String(e.code).startsWith('provider_') ? e.code : 'provider_error', e?.detail ? { detail: String(e.detail).slice(0, 120) } : {});

/* ─── Настройка (владелец) ─── */
export const getProvider = async (ownerId) => {
  const { rows } = await query('SELECT b.id, p.* FROM kb_businesses b LEFT JOIN kb_providers p ON p.business_id = b.id WHERE b.id = kb_cur_biz($1)', [ownerId]);
  if (!rows[0]) return { provider: null };
  const p = rows[0]; if (!p.base_url) return { provider: null };
  let host = ''; try { host = new URL(p.base_url).host; } catch { /* ok */ }
  return { provider: { kind: p.kind, title: p.title, host, merchant: p.merchant, enabled: p.enabled, hasSecret: true, lastOkAt: p.last_ok_at?.toISOString?.() ?? null, lastError: p.last_error || null, updatedAt: p.updated_at.toISOString(), webhookPath: `/api/kbiz/webhook/${p.business_id}` } };
};

/** Подключение или смена провайдера — только владелец и только с кодом аутентификатора (если он включён): секрет решает, чьи деньги «подтверждены». */
export const setProvider = async (ownerId, skyId, body) => {
  const { rows: b } = await query('SELECT id, status FROM kb_businesses WHERE id = kb_cur_biz($1)', [ownerId]); if (!b[0]) return err('no_business');
  if (b[0].status === 'suspended') return err('suspended');
  const tf = await verifySkyTwoFactor(skyId, body?.twoFactorCode); if (tf?.error) return err(tf.error === 'invalid_code' ? 'two_factor_required' : tf.error);
  let url; try { url = new URL(clean(body?.baseUrl, 300)); } catch { return err('bad_field', { field: 'baseUrl' }); }
  if ((url.protocol !== 'https:' && !(TEST_PRIVATE && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) return err('bad_field', { field: 'baseUrl' });
  const safe = await resolveSafeUrl(url.toString(), { label: 'Адрес провайдера' }); if (!safe.ok) return err('bad_field', { field: 'baseUrl', message: safe.message });
  const merchant = clean(body?.merchant, 120); if (merchant.length < 2) return err('bad_field', { field: 'merchant' });
  const old = await provOf(b[0].id);
  const secret = String(body?.secret ?? '').trim();
  if (!old && secret.length < 16) return err('bad_field', { field: 'secret' });
  if (secret && (secret.length < 16 || secret.length > 200)) return err('bad_field', { field: 'secret' });
  const enc = secret ? encryptSecret(secret) : old.secret_enc;
  await query(`INSERT INTO kb_providers (business_id, kind, title, base_url, merchant, secret_enc, enabled, updated_by, last_error) VALUES ($1,'hmac-v1',$2,$3,$4,$5,$6,$7,'')
     ON CONFLICT (business_id) DO UPDATE SET title = $2, base_url = $3, merchant = $4, secret_enc = $5, enabled = $6, updated_by = $7, updated_at = now(), last_error = ''`,
    [b[0].id, clean(body?.title, 60), url.origin + url.pathname.replace(/\/+$/, ''), merchant, enc, body?.enabled !== false, ownerId]);
  await audit(b[0].id, ownerId, old ? 'provider_changed' : 'provider_set', `${url.host}${secret ? ' · секрет обновлён' : ''}`);
  return { ok: true };
};
export const removeProvider = async (ownerId, skyId, twoFactorCode) => {
  const { rows: b } = await query('SELECT id FROM kb_businesses WHERE id = kb_cur_biz($1)', [ownerId]); if (!b[0]) return err('no_business');
  const tf = await verifySkyTwoFactor(skyId, twoFactorCode); if (tf?.error) return err(tf.error === 'invalid_code' ? 'two_factor_required' : tf.error);
  await query('DELETE FROM kb_providers WHERE business_id = $1', [b[0].id]); await audit(b[0].id, ownerId, 'provider_removed', '');
  return { ok: true };
};
export const pingProvider = async (ownerId) => {
  const { rows: b } = await query('SELECT id FROM kb_businesses WHERE id = kb_cur_biz($1)', [ownerId]); if (!b[0]) return err('no_business');
  const p = await provOf(b[0].id); if (!p) return err('provider_not_set');
  try { await call(p, 'GET', '/ping'); await query('UPDATE kb_providers SET last_ok_at = now(), last_error = \'\' WHERE business_id = $1', [b[0].id]); return { ok: true }; }
  catch (e) { await query('UPDATE kb_providers SET last_error = $2 WHERE business_id = $1', [b[0].id, `${e.code ?? 'error'}${e.detail ? `: ${e.detail}` : ''}`.slice(0, 200)]); return errCode(e); }
};
/** Есть ли у бизнеса включённый провайдер — для публичной страницы (без подробностей). */
export const providerAvailable = async (businessId) => { const p = await provOf(businessId); return Boolean(p && p.enabled); };

/* ─── Платёж у провайдера (покупатель) ─── */
export const providerPay = async (pid, body, ip) => {
  const q = await loadPublic(pid); if (!q) return err('not_found');
  if ((await pageState(q)) !== 'open') return err('page_unavailable');
  if (q.currency !== 'RUB' || (body?.currency && String(body.currency).toUpperCase() !== 'RUB')) return err('provider_rub_only');   // протокол партнёра рублёвый
  const prov = await provOf(q.biz_id); if (!prov || !prov.enabled) return err('provider_not_set');
  let amount = q.amount_rub;
  if (amount == null) { amount = Number(body?.amountRub); const lo = q.kind === 'tip' ? Number(q.config?.min) || 1 : 1; const hi = q.kind === 'tip' ? Number(q.config?.max) || MAX_AMOUNT : MAX_AMOUNT; if (!Number.isInteger(amount) || amount < lo || amount > hi) return err('bad_amount'); }
  const h = ipHash(ip);
  const { rows: lim } = await query(`SELECT count(*) FILTER (WHERE ip_hash = $1 AND created_at > now() - interval '1 hour')::int AS ip_n, count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS biz_n FROM kb_payments WHERE business_id = $2`, [h, q.biz_id]);
  if (lim[0].ip_n >= 5 || lim[0].biz_n >= 1000) return err('too_many_requests');
  const id = newId('kbp'); const key = crypto.randomBytes(18).toString('base64url');
  const origin = (process.env.KBIZ_PUBLIC_ORIGIN || config.publicOrigin || '').replace(/\/+$/, '');
  let remote;
  try {
    remote = await call(prov, 'POST', '/payments', { merchant: prov.merchant, order_id: id, amount, currency: 'RUB', description: clean(`${q.biz_name}: ${q.title}`, 120),
      return_url: `${origin}/p/${pid}`, webhook_url: `${origin}/api/kbiz/webhook/${q.biz_id}` });
  } catch (e) { await query('UPDATE kb_providers SET last_error = $2 WHERE business_id = $1', [q.biz_id, `${e.code ?? 'error'}`.slice(0, 100)]); return errCode(e); }
  const ref = clean(remote.payment_id, 120); let url = '';
  try { const u = new URL(String(remote.pay_url ?? '')); if (!(u.protocol === 'https:' || (TEST_PRIVATE && u.protocol === 'http:')) || u.username || u.password) throw new Error('bad'); url = u.toString(); } catch { return err('provider_bad_answer'); }
  if (!ref) return err('provider_bad_answer');
  await query(`INSERT INTO kb_payments (id, business_id, qr_id, amount_rub, currency, order_no, status, source, buyer_note, buyer_key_hash, ip_hash, provider_ref, provider_url_enc) VALUES ($1,$2,$3,$4,'RUB',$5,'created','provider',$6,$7,$8,$9,$10)`,
    [id, q.biz_id, q.id, amount, q.order_no || clean(body?.orderNo, 40), clean(body?.note, 300), keyHash(key), h, ref, encryptSecret(url)]);
  await query(`INSERT INTO kb_payment_log (payment_id, actor, from_status, to_status, note) VALUES ($1,'buyer',NULL,'created','Покупатель перешёл к оплате у партнёра')`, [id]);
  return { ok: true, id, statusKey: key, url };
};

/* ─── Применить статус, ПРОВЕРЕННЫЙ у провайдера ─── */
const applyRemote = async (payId, remote, source) => {
  let note = null;
  const result = await inTx(async (c) => {
    const { rows } = await c.query('SELECT p.*, b.owner_id FROM kb_payments p JOIN kb_businesses b ON b.id = p.business_id WHERE p.id = $1 AND p.source = \'provider\' FOR UPDATE OF p', [payId]);
    const p = rows[0]; if (!p) return 'gone';
    const st = String(remote?.status ?? '');
    const log = (to, why) => c.query('INSERT INTO kb_payment_log (payment_id, actor, from_status, to_status, note) VALUES ($1,\'provider\',$2,$3,$4)', [p.id, p.status, to, why]);
    if (st === 'paid') {
      if (p.status === 'confirmed') return 'noop';
      if (!['created', 'reported', 'pending_check', 'expired'].includes(p.status)) return 'noop';
      if (Number(remote.amount) !== p.amount_rub || String(remote.currency ?? 'RUB') !== p.currency) { await c.query(`UPDATE kb_payments SET status = 'not_found', owner_comment = 'Сумма у провайдера не совпала с заявкой', updated_at = now() WHERE id = $1`, [p.id]); await log('not_found', 'Несовпадение суммы у провайдера'); note = { owner: p.owner_id, text: `Провайдер сообщил об оплате ${p.id}, но сумма не совпала — проверьте вручную.` }; return 'mismatch'; }
      await c.query(`UPDATE kb_payments SET status = 'confirmed', confirmed_by = 'provider', confirmed_at = now(), updated_at = now() WHERE id = $1`, [p.id]);
      await (await import('./parkingpay.mjs')).kassaPaymentConfirmedIn(c, p.id);   // Sky Parking: включить оплаченную сессию
      import('./goplaces.mjs').then((m) => m.paymentChanged(p.id, 'confirmed')).catch(() => {});   // Sky GO: уведомить покупателя
      await log('confirmed', `Оплата подтверждена провайдером (${source})`); await c.query('INSERT INTO kb_audit (business_id, actor, action, detail) VALUES ($1,\'provider\',$2,$3)', [p.business_id, 'payment_provider_confirm', `${p.id}: ${p.amount_rub} ₽`]);
      note = { owner: p.owner_id, text: `Оплата ${p.amount_rub} ₽ подтверждена платёжным партнёром.` }; return 'paid';
    }
    if (['failed', 'cancelled', 'expired'].includes(st) && ['created', 'reported'].includes(p.status)) { const to = st === 'expired' ? 'expired' : 'cancelled'; await c.query('UPDATE kb_payments SET status = $2, updated_at = now() WHERE id = $1', [p.id, to]); await log(to, `Провайдер: ${st}`); return st; }
    if (st === 'refunded' && p.status === 'confirmed') { await c.query(`UPDATE kb_payments SET status = 'refunded', owner_comment = 'Возврат выполнен у провайдера', updated_at = now() WHERE id = $1`, [p.id]); await log('refunded', 'Провайдер сообщил о возврате'); note = { owner: p.owner_id, text: `Провайдер сообщил о возврате ${p.amount_rub} ₽.` }; return 'refunded'; }
    return 'noop';
  });
  if (note) await notifyGift(note.owner, 'kassa_biz', 'SkyKassa Business: платёж', note.text, `kbpv:${payId}:${result}`).catch(() => {});
  return result;
};
export const refreshProviderPayment = async (payId) => {
  const { rows } = await query('SELECT p.id, p.provider_ref, p.business_id FROM kb_payments p WHERE p.id = $1 AND p.source = \'provider\' AND p.status IN (\'created\',\'reported\',\'pending_check\')', [payId]);
  if (!rows[0] || !rows[0].provider_ref) return 'noop';
  const prov = await provOf(rows[0].business_id); if (!prov) return 'noop';
  await query('UPDATE kb_payments SET provider_checked_at = now() WHERE id = $1', [payId]);
  const remote = await call(prov, 'GET', `/payments/${encodeURIComponent(rows[0].provider_ref)}`);
  return applyRemote(payId, remote, 'проверка');
};

/* ─── Вебхук: /api/kbiz/webhook/<id бизнеса> ─── */
export const handleWebhook = async (businessId, raw, headers) => {
  if (!/^kbz-[0-9a-f-]{36}$/.test(String(businessId))) return { code: 404, body: { error: 'not_found' } };
  const prov = await provOf(businessId); if (!prov || !prov.enabled) return { code: 404, body: { error: 'not_found' } };
  const ts = String(headers['x-timestamp'] ?? ''); const sig = String(headers['x-signature'] ?? '');
  if (!/^\d{9,12}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > SKEW_SEC) return { code: 401, body: { error: 'bad_timestamp' } };
  let secret; try { secret = openSecret(prov.secret_enc); } catch { return { code: 503, body: { error: 'not_connected' } }; }
  if (!safeEq(sig, sign(secret, ts, raw))) { await audit(businessId, 'provider', 'webhook_bad_signature', '').catch(() => {}); return { code: 401, body: { error: 'bad_signature' } }; }
  let ev; try { ev = JSON.parse(raw); } catch { return { code: 400, body: { error: 'bad_json' } }; }
  const eventId = clean(ev?.event_id, 120); if (!eventId) return { code: 400, body: { error: 'no_event_id' } };
  const ins = await query('INSERT INTO kb_provider_events (business_id, event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [businessId, eventId]);
  if (!ins.rowCount) return { code: 200, body: { ok: true, duplicate: true } };
  const { rows } = await query('SELECT id FROM kb_payments WHERE id = $1 AND business_id = $2 AND provider_ref = $3 AND source = \'provider\'', [clean(ev?.order_id, 80), businessId, clean(ev?.payment_id, 120)]);
  if (!rows[0]) { await query('UPDATE kb_provider_events SET result = \'unknown_payment\' WHERE business_id = $1 AND event_id = $2', [businessId, eventId]); return { code: 404, body: { error: 'unknown_payment' } }; }
  let result;
  try { const remote = await call(prov, 'GET', `/payments/${encodeURIComponent(clean(ev.payment_id, 120))}`); result = await applyRemote(rows[0].id, remote, 'вебхук'); }
  catch (e) { await query('DELETE FROM kb_provider_events WHERE business_id = $1 AND event_id = $2', [businessId, eventId]); return { code: 502, body: { error: 'verify_failed' } }; }
  await query('UPDATE kb_provider_events SET result = $3 WHERE business_id = $1 AND event_id = $2', [businessId, eventId, result]);
  return { code: 200, body: { ok: true } };
};

/** Раз в час: платежи у провайдера, о которых давно нет вестей, перепроверяются; события старше 30 суток забываются. */
export const sweepProviders = async () => {
  const { rows } = await query(`SELECT id FROM kb_payments WHERE source = 'provider' AND status IN ('created','reported') AND created_at > now() - interval '3 days' AND COALESCE(provider_checked_at, created_at) < now() - interval '10 minutes' LIMIT 50`);
  for (const r of rows) await refreshProviderPayment(r.id).catch(() => {});
  await query(`DELETE FROM kb_provider_events WHERE at < now() - interval '30 days'`);
};
export { STATUS_LABEL, subState };
