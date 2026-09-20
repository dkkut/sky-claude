/**
 * Курсы валют на стороне сервера.
 *
 * Виджет в Bloom раньше показывал три захардкоженных процента, одни и
 * те же для всех и всегда. Теперь это реальный курс ЦБ РФ (USD/EUR к
 * рублю — тот же рубль, что и в остальном Sky: кошелёк, маркет, Prime)
 * и реальная суточная цена биткоина в рублях. Оба источника бесплатны
 * и не требуют ключа.
 *
 * Реальное суточное изменение — не выдумано: у ЦБ в одном ответе лежит
 * и сегодняшний курс, и вчерашний (Previous), разница и есть изменение.
 */
import { query } from './db.mjs';

const CACHE_MIN = 15;
const CODES = ['USD', 'EUR', 'BTC'];

const round2 = (n) => Math.round(Number(n) * 100) / 100;

const fetchCbr = async () => {
  const res = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  const out = {};
  for (const code of ['USD', 'EUR']) {
    const v = data?.Valute?.[code];
    const rate = Number(v?.Value);
    const prev = Number(v?.Previous);
    if (!Number.isFinite(rate) || !Number.isFinite(prev) || prev === 0) continue;
    out[code] = { rate: round2(rate), changePct: round2(((rate - prev) / prev) * 100) };
  }
  return out;
};

const fetchBtc = async () => {
  const params = new URLSearchParams({ ids: 'bitcoin', vs_currencies: 'rub', include_24hr_change: 'true' });
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  const rate = Number(data?.bitcoin?.rub);
  const changePct = Number(data?.bitcoin?.rub_24h_change);
  if (!Number.isFinite(rate) || !Number.isFinite(changePct)) return null;
  return { rate: round2(rate), changePct: round2(changePct) };
};

const cached = async () => {
  const { rows } = await query(
    `SELECT code, rate, change_pct FROM currency_cache
      WHERE code = ANY($1::text[]) AND created_at > now() - ($2::int * interval '1 minute')`,
    [CODES, CACHE_MIN],
  );
  return rows;
};

const remember = async (code, rate, changePct) => {
  await query(
    `INSERT INTO currency_cache (code, rate, change_pct) VALUES ($1,$2,$3)
     ON CONFLICT (code) DO UPDATE SET rate = EXCLUDED.rate, change_pct = EXCLUDED.change_pct, created_at = now()`,
    [code, rate, changePct],
  );
};

/**
 * Курсы USD/EUR/BTC к рублю. Каждая валюта — реальная или отсутствует:
 * ни одна не подставляется выдуманным числом, если сторонний сервис не
 * ответил.
 */
export const getRates = async () => {
  const have = await cached();
  const haveByCode = new Map(have.map((r) => [r.code, r]));
  const missing = CODES.filter((c) => !haveByCode.has(c));

  if (missing.length) {
    const needsCbr = missing.includes('USD') || missing.includes('EUR');
    const needsBtc = missing.includes('BTC');
    const [cbr, btc] = await Promise.all([
      needsCbr ? fetchCbr().catch(() => null) : Promise.resolve(null),
      needsBtc ? fetchBtc().catch(() => null) : Promise.resolve(null),
    ]);
    if (cbr?.USD) { await remember('USD', cbr.USD.rate, cbr.USD.changePct); haveByCode.set('USD', { code: 'USD', rate: cbr.USD.rate, change_pct: cbr.USD.changePct }); }
    if (cbr?.EUR) { await remember('EUR', cbr.EUR.rate, cbr.EUR.changePct); haveByCode.set('EUR', { code: 'EUR', rate: cbr.EUR.rate, change_pct: cbr.EUR.changePct }); }
    if (btc) { await remember('BTC', btc.rate, btc.changePct); haveByCode.set('BTC', { code: 'BTC', rate: btc.rate, change_pct: btc.changePct }); }
  }

  return CODES
    .filter((c) => haveByCode.has(c))
    .map((c) => {
      const r = haveByCode.get(c);
      return { code: c, rate: Number(r.rate), changePct: Number(r.change_pct) };
    });
};
