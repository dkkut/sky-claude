/**
 * Sky Maps Core: учёт и контроль обращений к поставщикам карт.
 *
 * Каждое платное обращение (геокодер, картинка карты, маршрут) проходит через `track()`:
 *  — проверяется переключатель функции и суточный предел «поставщик:функция» (настраиваются в админке);
 *  — результат (успех / сбой / отказ по пределу) записывается в счётчик за день;
 *  — сбои — в короткий журнал ошибок (код, без адресов и координат людей).
 * Счётчики копятся в памяти и сбрасываются в базу пачкой раз в 15 с: карта не ждёт запись, а база не получает запрос на каждый кадр.
 * Любой сбой самого учёта поведение карт не меняет.
 */
import { query } from './db.mjs';

export const FEATURES = ['geocode', 'static', 'route', 'friends', 'safety'];
export const PROVIDERS = ['google', 'yandex'];

let settings = { features: {}, limits: {}, at: 0 };
const loadSettings = async () => {
  if (Date.now() - settings.at < 15_000) return settings;
  try {
    const { rows } = await query('SELECT features, limits FROM maps_settings WHERE id = 1');
    settings = { features: rows[0]?.features ?? {}, limits: rows[0]?.limits ?? {}, at: Date.now() };
  } catch { settings.at = Date.now(); }
  return settings;
};
export const forgetMapsSettings = () => { settings.at = 0; };

/** Включена ли функция (по умолчанию да). */
export const featureOn = async (feature) => (await loadSettings()).features[feature] !== false;

/* Счётчики за сегодня в памяти + то, что уже в базе на момент последнего сброса. */
const pending = new Map();                       // "day|provider|feature" → {ok,failed,limited}
const today = () => new Date().toISOString().slice(0, 10);
const bump = (provider, feature, field) => {
  const k = `${today()}|${provider}|${feature}`;
  const v = pending.get(k) ?? { ok: 0, failed: 0, limited: 0 };
  v[field] += 1; pending.set(k, v);
};
let dayBase = { day: '', map: new Map(), at: 0 };
const usedToday = async (provider, feature) => {
  const day = today();
  if (dayBase.day !== day || Date.now() - dayBase.at > 60_000) {
    try {
      const { rows } = await query('SELECT provider, feature, ok + failed AS n FROM maps_usage WHERE day = $1', [day]);
      dayBase = { day, map: new Map(rows.map((r) => [`${r.provider}:${r.feature}`, Number(r.n)])), at: Date.now() };
      pending.forEach((_, k) => { if (!k.startsWith(day)) pending.delete(k); });
    } catch { dayBase.at = Date.now(); }
  }
  return dayBase.map.get(`${provider}:${feature}`) ?? 0;   // уже сброшенное в базу; несброшенное добавляет unflushed()
};
const unflushed = (provider, feature) => {
  const p = pending.get(`${today()}|${provider}|${feature}`);
  return p ? p.ok + p.failed : 0;
};

const errBuf = [];
const flush = async () => {
  if (pending.size) {
    const batch = [...pending.entries()]; pending.clear();
    for (const [k, v] of batch) {
      const [day, provider, feature] = k.split('|');
      await query(
        `INSERT INTO maps_usage (day, provider, feature, ok, failed, limited) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (day, provider, feature) DO UPDATE SET ok = maps_usage.ok + $4, failed = maps_usage.failed + $5, limited = maps_usage.limited + $6`,
        [day, provider, feature, v.ok, v.failed, v.limited]).catch(() => {});
    }
    dayBase.at = 0;
  }
  if (errBuf.length) {
    const e = errBuf.splice(0, 50);
    for (const r of e) await query('INSERT INTO maps_errors (provider, feature, code) VALUES ($1,$2,$3)', r).catch(() => {});
    await query(`DELETE FROM maps_errors WHERE created_at < now() - interval '14 days'`).catch(() => {});
  }
};
setInterval(() => { flush().catch(() => {}); }, 15_000).unref?.();
export const flushMapsUsage = flush;

/**
 * Выполняет обращение к поставщику с учётом.
 * fn() возвращает { ok, code? } вместе со своим значением: { ok:boolean, code?:string, value }.
 * При выключенной функции или исчерпанном пределе fn не вызывается — результат { ok:false, code:'feature_off' | 'limit' }.
 */
export const track = async (provider, feature, fn) => {
  try {
    if (!(await featureOn(feature))) { bump(provider, feature, 'limited'); return { ok: false, code: 'feature_off' }; }
    const lim = Number((await loadSettings()).limits[`${provider}:${feature}`] ?? 0);
    if (lim > 0 && (await usedToday(provider, feature)) + unflushed(provider, feature) >= lim) {
      bump(provider, feature, 'limited'); return { ok: false, code: 'limit' };
    }
  } catch { /* учёт не должен ломать карты */ }
  let out;
  try { out = await fn(); } catch (e) { out = { ok: false, code: 'exception' }; }
  try {
    if (out?.ok) bump(provider, feature, 'ok');
    else { bump(provider, feature, 'failed'); if (errBuf.length < 200) errBuf.push([provider, feature, String(out?.code ?? 'failed').slice(0, 60)]); }
  } catch { /* ignore */ }
  return out;
};

/* ── Для админки ──────────────────────────────────────────────────── */

export const usageReport = async (days = 7) => {
  await flush();
  const d = Math.max(1, Math.min(60, Number(days) || 7));
  const { rows } = await query(
    `SELECT day::text, provider, feature, ok, failed, limited FROM maps_usage WHERE day > CURRENT_DATE - $1::int ORDER BY day DESC, provider, feature`, [d]);
  const { rows: errs } = await query('SELECT provider, feature, code, created_at FROM maps_errors ORDER BY created_at DESC LIMIT 50');
  const { rows: top } = await query(
    `SELECT provider, feature, code, count(*)::int AS n FROM maps_errors WHERE created_at > now() - interval '24 hours' GROUP BY 1,2,3 ORDER BY n DESC LIMIT 10`);
  return { days: d, usage: rows, errors: errs, topErrors: top };
};

export const getMapsSettings = async () => {
  const s = await loadSettings();
  return { features: Object.fromEntries(FEATURES.map((f) => [f, s.features[f] !== false])), limits: s.limits };
};

export const saveMapsSettings = async (actorId, input = {}) => {
  const features = {};
  for (const f of FEATURES) if (typeof input.features?.[f] === 'boolean') features[f] = input.features[f];
  const limits = {};
  for (const [k, v] of Object.entries(input.limits ?? {})) {
    const [p, f] = k.split(':');
    if (!PROVIDERS.includes(p) || !FEATURES.includes(f)) return { error: 'bad_limit_key' };
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return { error: 'bad_limit' };
    if (n > 0) limits[k] = n;
  }
  await query(`UPDATE maps_settings SET features = $1, limits = $2, updated_by = $3, updated_at = now() WHERE id = 1`,
    [JSON.stringify(features), JSON.stringify(limits), actorId]);
  forgetMapsSettings();
  return { ok: true, ...(await getMapsSettings()) };
};
