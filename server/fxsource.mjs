/**
 * Источник курсов для валютных счетов — курс ЦБ РФ (тот же, что в виджете Bloom: server/currency.mjs).
 * По умолчанию берётся JSON-зеркало ЦБ `cbr-xml-daily.ru` (неофициальное зеркало; адрес меняется переменной `FX_CBR_URL`, только https).
 * Курс ЦБ — официальный курс на день, а не биржевая котировка: он обновляется раз в рабочий день и не подходит для сделок «по рынку» —
 * поэтому к нему всё равно добавляется спред. Источник и ограничение указаны в docs/СТОРОННИЕ_СЕРВИСЫ_И_ЛИЦЕНЗИИ.md.
 */
export const FX_CODES = ['USD', 'EUR', 'GBP', 'CNY', 'KZT', 'TRY'];
const DEFAULT_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';

/** Разбор ответа: рублей за 1 единицу (в ответе курс дан за Nominal единиц) и вчерашний курс. */
export const parseCbr = (data) => {
  const out = {};
  for (const code of FX_CODES) {
    const v = data?.Valute?.[code];
    const nominal = Number(v?.Nominal) || 1;
    const rate = Number(v?.Value) / nominal;
    const prev = Number(v?.Previous) / nominal;
    if (!Number.isFinite(rate) || rate <= 0) continue;
    out[code] = { rate: +rate.toFixed(6), prev: Number.isFinite(prev) && prev > 0 ? +prev.toFixed(6) : null };
  }
  return out;
};

export const fetchCbrRates = async () => {
  const url = process.env.FX_CBR_URL || DEFAULT_URL;
  if (!/^https:\/\//.test(url)) throw new Error('fx_source_not_https');
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`fx_source_${res.status}`);
  const rates = parseCbr(await res.json());
  if (!Object.keys(rates).length) throw new Error('fx_source_empty');
  return rates;
};
