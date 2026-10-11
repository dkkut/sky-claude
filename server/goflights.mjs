/**
 * Sky Авиабилеты — слой поставщика.
 *
 * Рейсов здесь нет и выдумывать их нельзя: поиск работает только через подключённого поставщика.
 * Поддержан поставщик Travelpayouts (Aviasales Data API): он отдаёт кэшированные предложения и ссылку на оформление у партнёра,
 * но НЕ бронирует внутри Sky. Поэтому заказ в Sky получает статус «redirected» (перешли к оформлению) и НИКОГДА «booked»,
 * пока поставщик не вернёт подтверждение. Адаптер, умеющий настоящее бронирование (book/status), подключается тем же интерфейсом.
 * Ключ — только на сервере (TRAVELPAYOUTS_TOKEN). Не подключён — экран честно говорит «поставщик не подключён».
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { newId, clean, sealJson, goLog } from './gocore.mjs';

const provider = () => String(process.env.FLIGHTS_PROVIDER || (process.env.TRAVELPAYOUTS_TOKEN ? 'travelpayouts' : 'none')).toLowerCase();
const tpBase = () => (process.env.TRAVELPAYOUTS_BASE_URL || 'https://api.travelpayouts.com').replace(/\/+$/, '');
const tpAuto = () => (process.env.TRAVELPAYOUTS_AUTOCOMPLETE_URL || 'https://autocomplete.travelpayouts.com').replace(/\/+$/, '');
const tpSite = () => (process.env.TRAVELPAYOUTS_SITE_URL || 'https://www.aviasales.ru').replace(/\/+$/, '');

export const flightsStatus = () => {
  const p = provider();
  return { provider: p, configured: p !== 'none' && (p !== 'travelpayouts' || Boolean(process.env.TRAVELPAYOUTS_TOKEN)),
    canBook: false, note: p === 'travelpayouts' ? 'Поставщик отдаёт предложения и ссылку на оформление; бронирование выполняется у партнёра.' : 'Поставщик не подключён.' };
};

const IATA = /^[A-Za-z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const suggest = async (term) => {
  if (!flightsStatus().configured) return { error: 'provider_not_configured' };
  const t = clean(term, 40);
  if (t.length < 2) return { places: [] };
  try {
    const url = `${tpAuto()}/places2?${new URLSearchParams({ term: t, locale: 'ru' })}&types[]=city&types[]=airport`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { error: 'provider_error' };
    const data = await res.json();
    return { places: (Array.isArray(data) ? data : []).slice(0, 8).map((p) => ({ code: p.code, name: p.name, country: p.country_name ?? '', type: p.type })) };
  } catch { return { error: 'provider_unreachable' }; }
};

export const search = async (input) => {
  const st = flightsStatus();
  if (!st.configured) return { error: 'provider_not_configured' };
  const origin = String(input?.from ?? '').toUpperCase();
  const destination = String(input?.to ?? '').toUpperCase();
  if (!IATA.test(origin) || !IATA.test(destination)) return { error: 'bad_iata' };
  if (origin === destination) return { error: 'same_city' };
  if (!DATE.test(String(input?.date ?? ''))) return { error: 'bad_date' };
  const today = new Date().toISOString().slice(0, 10);
  if (input.date < today) return { error: 'date_in_past' };
  const ret = input?.returnDate ? String(input.returnDate) : '';
  if (ret && (!DATE.test(ret) || ret < input.date)) return { error: 'bad_return_date' };
  const adults = Math.min(9, Math.max(1, Math.floor(Number(input?.adults) || 1)));
  const params = new URLSearchParams({ origin, destination, departure_at: input.date, currency: 'rub', limit: '20', sorting: 'price', one_way: ret ? 'false' : 'true', token: process.env.TRAVELPAYOUTS_TOKEN });
  if (ret) params.set('return_at', ret);
  let data;
  try {
    const res = await fetch(`${tpBase()}/aviasales/v3/prices_for_dates?${params}`, { signal: AbortSignal.timeout(12_000), headers: { 'Accept-Encoding': 'gzip' } });
    if (res.status === 401 || res.status === 403) return { error: 'provider_denied' };
    if (!res.ok) return { error: 'provider_error' };
    data = await res.json();
  } catch { return { error: 'provider_unreachable' }; }
  if (!data?.success && !Array.isArray(data?.data)) return { error: 'provider_error' };
  const offers = (data.data ?? []).map((o) => {
    const link = o.link ? `${tpSite()}${String(o.link).startsWith('/') ? '' : '/'}${o.link}` : null;
    return {
      id: crypto.createHash('sha1').update(`${o.origin_airport}${o.destination_airport}${o.departure_at}${o.flight_number}${o.price}`).digest('hex').slice(0, 20),
      airline: o.airline ?? '', flightNumber: o.flight_number ?? '', from: o.origin_airport ?? origin, to: o.destination_airport ?? destination,
      departAt: o.departure_at ?? null, returnAt: o.return_at ?? null, durationMin: Number(o.duration_to ?? o.duration) || null,
      transfers: Number(o.transfers ?? 0), priceRub: Math.round(Number(o.price) || 0) * adults, perPassengerRub: Math.round(Number(o.price) || 0),
      link, source: 'travelpayouts', fresh: false,   // цены из кэша поставщика: итог — на странице оформления
    };
  }).filter((o) => o.priceRub > 0);
  return { ok: true, offers, adults, provider: st.provider, cached: true, notice: 'Цены предоставлены поставщиком из его кэша и могут измениться при оформлении. Багаж и условия тарифа — на странице оформления.' };
};

/** Заказ: фиксируем выбранное предложение и пассажиров (шифр). Статус не выше «redirected», пока поставщик не подтвердит. */
export const createOrder = async (profileId, input) => {
  if (!flightsStatus().configured) return { error: 'provider_not_configured' };
  const o = input?.offer ?? {};
  if (!o.id || !o.link || !Number.isFinite(Number(o.priceRub))) return { error: 'bad_offer' };
  const pax = Array.isArray(input?.passengers) ? input.passengers.slice(0, 9) : [];
  if (!pax.length) return { error: 'passengers_required' };
  const clean_pax = [];
  for (const p of pax) {
    const name = clean(p?.name, 80);
    if (name.length < 3) return { error: 'passenger_name_required' };
    clean_pax.push({ name, birthDate: /^\d{4}-\d{2}-\d{2}$/.test(String(p?.birthDate ?? '')) ? p.birthDate : '', docNumber: clean(p?.docNumber, 30) });
  }
  const id = newId('gfl');
  const offer = { id: String(o.id), airline: clean(o.airline, 60), flightNumber: clean(o.flightNumber, 20), from: clean(o.from, 8), to: clean(o.to, 8), departAt: clean(o.departAt, 40),
    returnAt: clean(o.returnAt, 40) || null, priceRub: Math.round(Number(o.priceRub)), link: String(o.link).slice(0, 600), source: 'travelpayouts' };
  // Ссылка только на сайт поставщика: чужой адрес в карточку не попадает.
  if (!offer.link.startsWith(tpSite())) return { error: 'bad_offer' };
  await query(`INSERT INTO go_flight_orders (id, profile_id, provider, offer, passengers_enc, status) VALUES ($1,$2,$3,$4::jsonb,$5,'redirected')`,
    [id, profileId, provider(), JSON.stringify(offer), sealJson(clean_pax)]);
  await goLog(profileId, 'flight_redirect', id, { provider: provider() });
  return { ok: true, orderId: id, status: 'redirected', link: offer.link, note: 'Оформление и оплата — на странице поставщика. Sky не подтверждает бронь, пока поставщик не вернёт подтверждение.' };
};

export const listOrders = async (profileId) => {
  const { rows } = await query('SELECT id, provider, offer, status, external_id, external_status, created_at FROM go_flight_orders WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 50', [profileId]);
  return { orders: rows.map((r) => ({ id: r.id, provider: r.provider, offer: r.offer, status: r.status, externalId: r.external_id, externalStatus: r.external_status, createdAt: r.created_at.toISOString() })) };
};

export const cancelOrder = async (profileId, id) => {
  const { rowCount } = await query(`UPDATE go_flight_orders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND profile_id = $2 AND status IN ('created','redirected')`, [String(id ?? ''), profileId]);
  return rowCount ? { ok: true } : { error: 'bad_state' };
};
