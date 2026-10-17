/**
 * Sky GO Pricing — котировки. Цену по-прежнему считают тарифы из настроек (gotaxi.priceOf, godelivery.deliveryPrice/cargoPrice);
 * этот модуль делает расчёт ПРОВЕРЯЕМЫМ: каждый расчёт записывается (версия тарифа, входные условия, суммы, срок), а заказ,
 * созданный по котировке, не может «молча» стоить иначе, чем человек подтвердил.
 *
 * Поток: POST …/quote → котировка (quoteId, срок) → POST …/orders с quoteId →
 *   • тот же тариф и условия → цена берётся из котировки, котировка гасится (одноразова);
 *   • тариф изменился или срок вышел → `price_changed` / `quote_expired` и свежая котировка: человек подтверждает заново.
 * Без quoteId (старые клиенты) заказ создаётся как раньше по текущей цене сервера, но снимок расчёта всё равно сохраняется.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { getSetting, newId } from './gocore.mjs';

export const QUOTE_TTL_DEFAULT_SEC = 600;
export const quoteTtlSec = async () => {
  const v = Number(await getSetting('quote_ttl_sec', QUOTE_TTL_DEFAULT_SEC));
  return Number.isFinite(v) ? Math.min(3600, Math.max(60, Math.round(v))) : QUOTE_TTL_DEFAULT_SEC;
};

const stable = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  : Array.isArray(v) ? `[${v.map(stable).join(',')}]` : JSON.stringify(v));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Версия тарифа = короткий хеш его значений: любое изменение цифр в админке даёт новую версию. */
export const tariffVersion = (tariffObj) => sha(stable(tariffObj ?? {})).slice(0, 12);

const r5 = (n) => Math.round(Number(n) * 1e5) / 1e5;
/** Отпечаток условий: город, точки (с точностью ~1 м), вид и параметры. Поменялся адрес — котировка не подходит. */
export const fingerprint = (kind, city, from, to, extra = {}) =>
  sha(stable({ kind, city, from: [r5(from.lat), r5(from.lng)], to: [r5(to.lat), r5(to.lng)], extra })).slice(0, 32);

/** Состав цены такси: чтобы человек видел, из чего сумма, а администрация могла проверить расчёт. */
export const taxiBreakdown = (t, km, min) => {
  const base = Number(t.base) || 0; const distance = Math.round(km * (Number(t.perKm) || 0)); const time = Math.round(min * (Number(t.perMin) || 0));
  const subtotal = Math.round(base + km * (Number(t.perKm) || 0) + min * (Number(t.perMin) || 0));
  const minRub = Number(t.min) || 0;
  return { baseRub: base, distanceRub: distance, timeRub: time, subtotalRub: subtotal, minimumRub: minRub, minimumApplied: subtotal < minRub, totalRub: Math.max(minRub, subtotal) };
};

export const issueQuote = async (profileId, kind, fp, version, offers, params = {}) => {
  const ttl = await quoteTtlSec();
  const id = newId('gq');
  const { rows } = await query(
    `INSERT INTO go_quotes (id, profile_id, kind, fingerprint, tariff_version, offers, params, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb, now() + ($8 || ' seconds')::interval) RETURNING expires_at`,
    [id, profileId, kind, fp, version, JSON.stringify(offers), JSON.stringify(params), String(ttl)]);
  return { quoteId: id, expiresAt: rows[0].expires_at.toISOString(), tariffVersion: version, currency: 'RUB' };
};

/**
 * Проверить и погасить котировку внутри транзакции создания заказа.
 * Возвращает { ok, priceRub, breakdown } либо { error: quote_not_found | quote_expired | quote_mismatch | quote_used | price_changed }.
 * Гасится только при успехе — при отказе человек получает свежую котировку и может подтвердить снова.
 */
export const redeemQuote = async (client, profileId, quoteId, kind, fp, version, offerCode, expectedPriceRub) => {
  const { rows } = await client.query(`SELECT * FROM go_quotes WHERE id = $1 AND profile_id = $2 AND kind = $3 FOR UPDATE`, [String(quoteId ?? ''), profileId, kind]);
  const q = rows[0];
  if (!q) return { error: 'quote_not_found' };
  if (q.used_order_id) return { error: 'quote_used' };
  if (q.expires_at < new Date()) return { error: 'quote_expired' };
  if (q.fingerprint !== fp) return { error: 'quote_mismatch' };
  const offer = q.offers?.[offerCode];
  if (!offer) return { error: 'quote_mismatch' };
  if (q.tariff_version !== version || Number(offer.priceRub) !== Number(expectedPriceRub)) return { error: 'price_changed', was: Number(offer.priceRub), now: Number(expectedPriceRub) };
  return { ok: true, priceRub: Number(offer.priceRub), breakdown: offer.breakdown ?? null, tariffVersion: q.tariff_version, quotedAt: q.created_at.toISOString(), expiresAt: q.expires_at.toISOString() };
};
export const markQuoteUsed = (client, quoteId, orderId) => client.query(`UPDATE go_quotes SET used_order_id = $2 WHERE id = $1`, [quoteId, orderId]);

export const sweepQuotes = () => query(`DELETE FROM go_quotes WHERE expires_at < now() - interval '1 day'`).catch(() => {});

/** Снимок расчёта для заказа (сохраняется всегда — и при создании без котировки). */
export const snapshot = ({ version, breakdown, priceRub, quoteId = null, quotedAt = null, expiresAt = null, estimated = false }) =>
  ({ tariffVersion: version, breakdown: breakdown ?? null, priceRub, currency: 'RUB', quoteId, quotedAt: quotedAt ?? new Date().toISOString(), expiresAt, estimatedRoute: Boolean(estimated) });
