/**
 * Sky Market: способы получения заказа и плата за доставку.
 *  • store_pickup — самовывоз из магазина продавца (адрес и часы публикует продавец);
 *  • courier — продавец привозит сам (платно, цена и бесплатный порог задаёт продавец);
 *  • pvz — пункт выдачи Sky Market; post — отправка перевозчиком/почтой на адрес.
 * Стоимость доставки считает ТОЛЬКО сервер по настройкам продавца; присланная клиентом сумма не читается.
 * Доставка относится к физическим товарам (`standard`); у игровых лотов и услуг доставки нет.
 * Если продавец ничего не настраивал, работают прежние пути (пункт выдачи и адрес) без платы.
 * Sky не проверяет, что продавец реально держит магазин по этому адресу или привезёт товар в срок.
 */
import { query } from './db.mjs';

export const METHODS = ['store_pickup', 'courier', 'pvz', 'post', 'intl'];
const CC = /^[A-Z]{2}$/;
const line = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const kop = (v, max = 100000000) => { if (v === '' || v == null) return null; const n = Math.round(Number(v) * 100); return Number.isFinite(n) && n >= 0 && n <= max ? n : NaN; };
const days = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 60 ? n : NaN; };

const view = (r) => ({
  method: r.method, enabled: r.enabled, price: Number(r.price_kop) / 100, priceKop: Number(r.price_kop),
  freeFrom: r.free_from_kop == null ? null : Number(r.free_from_kop) / 100, freeFromKop: r.free_from_kop == null ? null : Number(r.free_from_kop),
  minDays: r.min_days, maxDays: r.max_days, countries: r.countries ?? [], countryPrices: Object.fromEntries(Object.entries(r.country_prices ?? {}).map(([k, v]) => [k, Number(v) / 100])), city: r.city ?? '', address: r.address ?? '', hours: r.hours ?? '', note: r.note ?? '',
});

/** Настройки продавца (для него самого и для покупателя — только включённые). */
export const listOptions = async (sellerId, { onlyEnabled = false } = {}) => {
  const { rows } = await query(`SELECT * FROM market_delivery_options WHERE seller_id = $1 ${onlyEnabled ? 'AND enabled' : ''} ORDER BY method`, [sellerId]);
  return rows.map(view);
};

export const saveOptions = async (sellerId, input) => {
  const list = Array.isArray(input?.options) ? input.options : [];
  if (list.length > METHODS.length) return { error: 'bad_options' };
  const seen = new Set(); const clean = [];
  for (const o of list) {
    const method = String(o?.method ?? '');
    if (!METHODS.includes(method) || seen.has(method)) return { error: 'bad_method' };
    seen.add(method);
    const price = kop(o.price ?? 0); const free = kop(o.freeFrom); const minD = days(o.minDays); const maxD = days(o.maxDays);
    if (Number.isNaN(price) || price == null || Number.isNaN(free) || (free === 0) || Number.isNaN(minD) || Number.isNaN(maxD)) return { error: 'bad_price' };
    if (minD != null && maxD != null && minD > maxD) return { error: 'bad_days' };
    const countries = method === 'intl' ? [...new Set((Array.isArray(o.countries) ? o.countries : []).map((c) => String(c).toUpperCase()))] : [];
    if (countries.some((c) => !CC.test(c) || c === 'RU') || countries.length > 80) return { error: 'bad_countries' };
    if (method === 'intl' && o.enabled !== false && countries.length === 0) return { error: 'countries_required' };
    const cp = {};
    if (method === 'intl' && o.countryPrices && typeof o.countryPrices === 'object') {
      for (const [k, v] of Object.entries(o.countryPrices)) {
        const code = k.toUpperCase(); const n = kop(v);
        if (!countries.includes(code) || n == null || Number.isNaN(n)) return { error: 'bad_price' };
        cp[code] = n;
      }
    }
    const address = line(o.address, 200); const hours = line(o.hours, 120);
    if (method === 'store_pickup' && o.enabled !== false && address.length < 5) return { error: 'pickup_address_required' };
    if (method === 'store_pickup' && price > 0) return { error: 'pickup_must_be_free' };
    clean.push({ method, countries, cp, enabled: o.enabled !== false, price, free, minD, maxD, city: line(o.city, 80), address, hours, note: line(o.note, 300) });
  }
  if (!(await query('SELECT 1 FROM market_sellers WHERE profile_id = $1', [sellerId])).rows[0]) return { error: 'not_found' };
  await query('DELETE FROM market_delivery_options WHERE seller_id = $1', [sellerId]);
  for (const c of clean) await query(`INSERT INTO market_delivery_options (seller_id, method, enabled, price_kop, free_from_kop, min_days, max_days, city, address, hours, note, countries, country_prices)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`, [sellerId, c.method, c.enabled, c.price, c.free, c.minD, c.maxD, c.city, c.address, c.hours, c.note, c.countries, JSON.stringify(c.cp)]);
  return { ok: true, options: await listOptions(sellerId) };
};

/** Плата за доставку для суммы товаров; null — способ недоступен. */
export const feeFor = (opt, subtotalKop, country = null) => {
  if (!opt || !opt.enabled) return null;
  const own = country && opt.country_prices?.[country];
  const price = own != null ? Number(own) : Number(opt.price_kop ?? opt.priceKop ?? 0);
  const free = opt.free_from_kop ?? opt.freeFromKop;
  return free != null && Number(subtotalKop) >= Number(free) ? 0 : price;
};

/**
 * Выбор способа при заказе (внутри транзакции заказа). Возвращает {method, feeKop, snap} или {error}.
 * Без явного способа и без настроек продавца — прежнее поведение (по адресу/пункту, бесплатно).
 */
export const resolveForOrder = async (client, { sellerId, subtotalKop, method, address, pickupPointId, country }) => {
  const { rows } = await client.query('SELECT * FROM market_delivery_options WHERE seller_id = $1', [sellerId]);
  const m = String(method ?? '');
  if (!m) {
    if (rows.some((r) => r.enabled)) return { error: 'delivery_method_required' };
    return { method: pickupPointId ? 'pvz' : 'post', feeKop: 0, snap: null, legacy: true };
  }
  if (!METHODS.includes(m)) return { error: 'bad_delivery_method' };
  const opt = rows.find((r) => r.method === m);
  if (rows.length === 0 && (m === 'pvz' || m === 'post')) return { method: m, feeKop: 0, snap: null, legacy: true };
  if (!opt || !opt.enabled) return { error: 'delivery_method_unavailable' };
  if ((m === 'courier' || m === 'post') && !address) return { error: 'address_required' };
  if (m === 'pvz' && !pickupPointId) return { error: 'address_required' };
  const cc = m === 'intl' ? String(country ?? '').toUpperCase() : null;
  if (m === 'intl') {
    if (!address) return { error: 'address_required' };
    if (!cc || !(opt.countries ?? []).includes(cc)) return { error: 'country_not_served' };
  }
  const feeKop = feeFor(opt, subtotalKop, cc);
  return { method: m, feeKop, country: cc, snap: { method: m, feeKop, country: cc || undefined, address: m === 'store_pickup' ? opt.address : undefined, hours: m === 'store_pickup' ? opt.hours : undefined, city: opt.city || undefined, note: opt.note || undefined, minDays: opt.min_days, maxDays: opt.max_days } };
};
