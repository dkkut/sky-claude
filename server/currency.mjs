/**
 * Курсы валют на стороне сервера.
 *
 * Виджет в Bloom раньше показывал три захардкоженных процента, одни и
 * те же для всех и всегда. Теперь это реальный курс ЦБ РФ (USD/EUR к
 * рублю — тот же рубль, что и в остальном Sky: кошелёк, маркет, Prime)
 * и юань. Источник бесплатен и не требует ключа. Курс биткоина убран:
 * бесплатный публичный API котировок допускает только некоммерческое использование.
 *
 * Реальное суточное изменение — не выдумано: у ЦБ в одном ответе лежит
 * и сегодняшний курс, и вчерашний (Previous), разница и есть изменение.
 */
import { query } from './db.mjs';

const CACHE_MIN = 15;
const CODES = ['USD', 'EUR', 'CNY'];

const round2 = (n) => Math.round(Number(n) * 100) / 100;

const fetchCbr = async () => {
  const res = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  const out = {};
  for (const code of ['USD', 'EUR', 'CNY']) {
    const v = data?.Valute?.[code];
    const nominal = Number(v?.Nominal) || 1;   // у части валют курс дан за 10/100 единиц
    const rate = Number(v?.Value) / nominal;
    const prev = Number(v?.Previous) / nominal;
    if (!Number.isFinite(rate) || !Number.isFinite(prev) || prev === 0) continue;
    out[code] = { rate: round2(rate), changePct: round2(((rate - prev) / prev) * 100) };
  }
  return out;
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
 * Курсы USD/EUR/CNY к рублю. Каждая валюта — реальная или отсутствует:
 * ни одна не подставляется выдуманным числом, если сторонний сервис не
 * ответил.
 */
export const getRates = async () => {
  const have = await cached();
  const haveByCode = new Map(have.map((r) => [r.code, r]));
  const missing = CODES.filter((c) => !haveByCode.has(c));

  if (missing.length) {
    const cbr = await fetchCbr().catch(() => null);
    for (const code of ['USD', 'EUR', 'CNY']) {
      const v = cbr?.[code];
      if (!v) continue;
      await remember(code, v.rate, v.changePct);
      haveByCode.set(code, { code, rate: v.rate, change_pct: v.changePct });
    }
  }

  return CODES
    .filter((c) => haveByCode.has(c))
    .map((c) => {
      const r = haveByCode.get(c);
      return { code: c, rate: Number(r.rate), changePct: Number(r.change_pct) };
    });
};
