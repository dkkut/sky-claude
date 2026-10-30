/**
 * Sky Tax: налоговые интеграции (реестр и адаптеры). Только официальные и разрешённые способы; имитации личного кабинета ФНС нет и не будет.
 *
 *  • manual_entry  — «Выдаю чек сам»: человек выдаёт чек в приложении «Мой налог» (НПД) или на своей онлайн-кассе и вносит номер (и ссылку) в Sky. Документ помечен «внесён вручную, Sky не проверял».
 *                    Это официальный запасной путь, когда API нет. Работает без ключей.
 *  • hmac_gateway  — шлюз партнёра по протоколу ниже: к нему подключаются официальные посредники (провайдер облачной кассы/ОФД, оператор с договором ФНС для «Мой налог»), у которых свой договор и ключи.
 *  • moy_nalog_partner, online_kassa — в списке как справочные: прямого подключения у Sky нет (нужен договор с ФНС/оператором и адаптер под их документацию). Не подключаются и не заявляются как работающие.
 *
 * Протокол hmac-v1 (все запросы подписаны: X-Timestamp = unix-секунды, X-Signature = HMAC-SHA256(секрет, `${timestamp}.${тело}`) в hex; ±5 минут):
 *   POST {адрес}/v1/receipts  { idempotencyKey, merchant, operation: 'income'|'refund', docKind, taxStatus, regime, vat, inn, amount, currency, paidAt, items:[{name,qty,price,amount,vat}], buyer:{email?}, refund:{number?,externalId?}? }
 *        → { id, status: 'issued'|'accepted'|'failed', number?, url?, fiscalSign?, error? }       (повтор с тем же idempotencyKey обязан вернуть тот же чек)
 *   GET  {адрес}/v1/receipts/{id}  → тот же ответ
 *   HTTP 4xx (кроме 408/429) — отказ по существу (ошибка данных), повторять бессмысленно; 5xx, 408, 429, обрыв, таймаут — временные, повторяем.
 * Адрес проверяется на SSRF (только https, публичные IP после собственного DNS-разбора, без редиректов). Тестовый шлюз — scripts/audit/fakes/tax-gateway.mjs (только для тестов).
 */
import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { config } from './config.mjs';
import { resolveSafeUrl } from './bloxnet.mjs';
import { encryptSecret, openSecret } from './crypto.mjs';

const TEST_PRIVATE = process.env.BLOX_ALLOW_PRIVATE === '1' && config.nodeEnv !== 'production';
const TIMEOUT_MS = 10_000; const MAX_BODY = 64 * 1024;

export const PROVIDERS = {
  manual_entry: { title: 'Выдаю чек сам («Мой налог» или своя касса)', automatic: false, available: true, statuses: ['npd', 'ip', 'ooo'],
    note: 'Sky готовит данные продажи; вы выдаёте чек у себя и вносите номер. Документ помечается как внесённый вручную — Sky его не проверяет.' },
  hmac_gateway: { title: 'Шлюз партнёра (облачная касса, ОФД, оператор «Мой налог»)', automatic: true, available: true, statuses: ['npd', 'ip', 'ooo'],
    note: 'Подключается официальный посредник с договором: адрес, идентификатор и секрет подписи даёт он. Протокол — в шапке server/taxproviders.mjs.' },
  moy_nalog_partner: { title: '«Мой налог»: партнёрский API ФНС', automatic: true, available: false, statuses: ['npd'],
    note: 'Прямого подключения у Sky нет: нужно соглашение с ФНС и адаптер под их документацию. Сейчас — через «Выдаю чек сам» или шлюз партнёра.' },
  online_kassa: { title: 'Онлайн-касса и оператор фискальных данных (54-ФЗ)', automatic: true, available: false, statuses: ['ip', 'ooo'],
    note: 'Прямого подключения нет: подключайте кассу через шлюз партнёра (провайдера облачной кассы) или выдавайте чеки сами.' },
};

const sign = (secret, ts, body) => crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
const fail = (code, temporary, detail = '') => Object.assign(new Error(code), { code, temporary, detail });

const pinned = (target, { method, headers, body }) => new Promise((resolve) => {
  const lib = target.url.protocol === 'https:' ? https : http;
  const chunks = []; let size = 0; let done = false; const finish = (v) => { if (!done) { done = true; resolve(v); } };
  const req = lib.request({ host: target.addresses[0], port: target.port, method, path: `${target.url.pathname}${target.url.search}`, servername: net.isIP(target.host) ? undefined : target.host,
    headers: { Host: target.url.host, 'User-Agent': 'SkyTax/1', Accept: 'application/json', ...headers }, timeout: TIMEOUT_MS, rejectUnauthorized: !TEST_PRIVATE }, (res) => {
    res.on('data', (c) => { size += c.length; if (size > MAX_BODY) { res.destroy(); finish({ ok: false, error: 'too_big' }); } else chunks.push(c); });
    res.on('end', () => finish({ ok: true, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    res.on('error', () => finish({ ok: false, error: 'reset' }));
  });
  req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'timeout' }); });
  req.on('error', (e) => finish({ ok: false, error: e.code ?? 'connect' }));
  if (body) req.write(body); req.end();
});

/** Данные интеграции из строки БД: { provider, url, merchant, secret }. Секрет расшифровывается только здесь и никуда не возвращается. */
export const openIntegration = (row, decryptConfig) => {
  const cfg = decryptConfig(row.config_enc) ?? {};
  return { provider: row.provider, url: cfg.url ?? '', merchant: cfg.merchant ?? '', secret: row.secret_enc ? openSecret(row.secret_enc) : '' };
};

/** Проверка и подготовка настроек перед сохранением. Возвращает { error } или { configPlain, secretEnc }. */
export const prepareConfig = async (provider, input, old) => {
  const def = PROVIDERS[provider];
  if (!def) return { error: 'bad_provider' };
  if (!def.available) return { error: 'provider_not_available' };
  if (provider === 'manual_entry') return { configPlain: {}, secretEnc: null };
  let url; try { url = new URL(String(input?.url ?? '').trim()); } catch { return { error: 'bad_url' }; }
  if ((url.protocol !== 'https:' && !(TEST_PRIVATE && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) return { error: 'bad_url' };
  const safe = await resolveSafeUrl(url.toString(), { label: 'Адрес шлюза' });
  if (!safe.ok) return { error: 'bad_url', message: safe.message };
  const merchant = String(input?.merchant ?? '').trim().slice(0, 120); if (merchant.length < 2) return { error: 'bad_merchant' };
  const secret = String(input?.secret ?? '').trim();
  if (!old && secret.length < 16) return { error: 'bad_secret' };
  if (secret && (secret.length < 16 || secret.length > 200)) return { error: 'bad_secret' };
  return { configPlain: { url: url.origin + url.pathname.replace(/\/+$/, ''), merchant }, secretEnc: secret ? encryptSecret(secret) : null };
};

const call = async (ig, method, path, payload) => {
  const t = await resolveSafeUrl(`${String(ig.url).replace(/\/+$/, '')}${path}`, { label: 'Адрес шлюза' });
  if (!t.ok) throw fail('gateway_bad_url', false, t.message);
  const body = payload ? JSON.stringify(payload) : ''; const ts = String(Math.floor(Date.now() / 1000));
  const r = await pinned(t, { method, body, headers: { 'X-Timestamp': ts, 'X-Signature': sign(ig.secret, ts, body), 'X-Merchant': ig.merchant, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) } });
  if (!r.ok) throw fail('gateway_unreachable', true, r.error);
  if (r.status >= 500 || r.status === 408 || r.status === 429) throw fail('gateway_temporary', true, `HTTP ${r.status}`);
  let j = {}; try { j = r.body ? JSON.parse(r.body) : {}; } catch { throw fail('gateway_bad_answer', true, 'не JSON'); }
  if (r.status < 200 || r.status >= 300) throw fail('gateway_rejected', false, String(j.error ?? `HTTP ${r.status}`).slice(0, 200));
  return j;
};

/** Нормализация ответа шлюза. 'issued' требует номер документа — без него это не подтверждение. */
const answer = (j) => {
  const st = String(j.status ?? '');
  if (st === 'issued') {
    if (!j.number || !j.id) throw fail('gateway_bad_answer', true, 'issued без номера или id');
    return { state: 'issued', externalId: String(j.id).slice(0, 120), number: String(j.number).slice(0, 120), url: /^https:\/\//.test(String(j.url ?? '')) ? String(j.url).slice(0, 500) : '', fiscalSign: String(j.fiscalSign ?? '').slice(0, 60) };
  }
  if (st === 'accepted') { if (!j.id) throw fail('gateway_bad_answer', true, 'accepted без id'); return { state: 'accepted', externalId: String(j.id).slice(0, 120) }; }
  if (st === 'failed') throw fail('gateway_rejected', false, String(j.error ?? 'отказ шлюза').slice(0, 200));
  throw fail('gateway_bad_answer', true, `статус «${st.slice(0, 30)}»`);
};

/** Создать документ у партнёра. op — строка tax_ops, subject — tax_subjects (inn расшифрован вызывающим), refundDoc — документ продажи для возврата. */
export const createReceipt = async (ig, { op, subject, inn, refundDoc }) => {
  if (ig.provider !== 'hmac_gateway') throw fail('provider_not_automatic', false);
  const items = (Array.isArray(op.items) && op.items.length ? op.items : [{ name: op.descr || 'Услуга', qty: 1, price: Number(op.amount_rub) }])
    .map((i) => ({ name: String(i.name ?? '').slice(0, 128), qty: Number(i.qty ?? 1), price: Number(i.price ?? 0), amount: Math.round(Number(i.qty ?? 1) * Number(i.price ?? 0) * 100) / 100, vat: subject.vat }));
  const j = await call(ig, 'POST', '/v1/receipts', {
    idempotencyKey: `sky-tax:${op.id}`, merchant: ig.merchant, operation: op.kind === 'refund' ? 'refund' : 'income', docKind: op.doc_kind,
    taxStatus: subject.tax_status, regime: subject.regime, vat: subject.vat, inn, amount: Number(op.amount_rub), currency: op.currency, paidAt: new Date(op.paid_at).toISOString(), items,
    buyer: op.buyerEmail ? { email: op.buyerEmail } : {}, ...(refundDoc ? { refund: { number: refundDoc.number, externalId: refundDoc.external_id } } : {}),
  });
  return answer(j);
};
export const getReceiptStatus = async (ig, externalId) => answer(await call(ig, 'GET', `/v1/receipts/${encodeURIComponent(externalId)}`));
export const pingGateway = async (ig) => { await call(ig, 'GET', '/v1/ping'); return { ok: true }; };
export const isTemporary = (e) => Boolean(e?.temporary);
