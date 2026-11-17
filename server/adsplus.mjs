/**
 * Sky Ads, дополнение (ноябрь-2026): собственные объявления Sky, защита ссылок, статистика.
 *  • «Свои» объявления Sky (ad_house) показываются, когда подходящей внешней кампании нет: Messenger, Prime, Music, TV, Studio, Business и др.
 *    Они ведут ТОЛЬКО внутрь Sky (раздел из закрытого списка MODULES) — внешней ссылки у них нет, подменить нечем. Prime-подписчикам реклама не показывается вообще.
 *  • Ссылка кампании подписана (HMAC от id и адреса): запись в базе, изменённая в обход админки/кабинета, не пройдёт проверку — кампания не показывается,
 *    случай пишется в ad_link_tamper. Клиент ссылку не присылает: после клика он получает адрес от сервера. Ссылки — только https без логина.
 *  • Любое объявление размечается: «Реклама» (внешние) или «Реклама Sky» (свои).
 */
import { query } from './db.mjs';
import { macOf } from './crypto.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { hasPrime as hasPrimeOf } from './skyid.mjs';

export const MODULES = { messages: 'Чаты', extras: 'Sky Media', studio: 'Студия', business: 'Бизнес', bloom: 'Bloom', gaming: 'Игры', video: 'Видео' };
export const EXTRAS_TABS = ['prime', 'music', 'tv', 'film', 'podcasts', 'books', 'ai', 'market', 'go'];
export const HOUSE_PLACEMENTS = ['video_preroll', 'film_preroll', 'video_banner', 'bloom_feed', 'channel_post'];

export const signLink = (campaignId, url) => macOf('adlink', `${campaignId}|${url}`).slice(0, 40);
export const linkOk = (campaignId, url, sig) => Boolean(url && sig && signLink(campaignId, url) === sig);
export const safeHttps = (raw) => {
  let u; try { u = new URL(String(raw ?? '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.hostname.length < 3 || !u.hostname.includes('.')) return null;
  return u.toString().slice(0, 500);
};
export const noteTamper = (campaignId) => query('INSERT INTO ad_link_tamper (campaign_id) VALUES ($1)', [campaignId]).catch(() => {});

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const lastShown = new Map(); // viewer|placement → ms: пауза между своими объявлениями
const prune = () => { if (lastShown.size > 20000) { const cut = Date.now() - 3600_000; for (const [k, v] of lastShown) if (v < cut) lastShown.delete(k); } };

/** Своё объявление Sky под площадку (когда внешней кампании нет). Prime — без рекламы. */
export const houseAd = async (viewerId, placement, cooldownSec = 60) => {
  if (!HOUSE_PLACEMENTS.includes(placement)) return null;
  if (await hasPrimeOf(viewerId)) return null;
  const key = `${viewerId}|${placement}`; const now = Date.now();
  if (now - (lastShown.get(key) ?? 0) < Math.max(20, cooldownSec) * 1000) return null;
  const { rows } = await query(`SELECT h.*, COALESCE((SELECT sum(impressions) FROM ad_house_daily d WHERE d.house_id = h.id AND d.day = CURRENT_DATE), 0) AS today
      FROM ad_house h WHERE h.status = 'active' AND $1 = ANY(h.placements) ORDER BY h.priority DESC, today ASC, h.id LIMIT 1`, [placement]);
  const h = rows[0]; if (!h) return null;
  lastShown.set(key, now); prune();
  return { campaignId: `house:${h.id}`, house: true, title: h.title, description: h.body, format: 'text', label: 'Реклама Sky', cta: h.cta, target: { module: h.module, tab: h.tab ?? undefined } };
};

const bump = (houseId, placement, field) => query(`INSERT INTO ad_house_daily (day, house_id, placement, ${field}) VALUES (CURRENT_DATE,$1,$2,1)
  ON CONFLICT (day, house_id, placement) DO UPDATE SET ${field} = ad_house_daily.${field} + 1`, [houseId, placement]);

const seen = new Map();
export const houseImpression = async (viewerId, houseId, placement) => {
  if (!HOUSE_PLACEMENTS.includes(placement)) return { error: 'not_eligible' };
  const h = (await query(`SELECT 1 FROM ad_house WHERE id = $1 AND status = 'active' AND $2 = ANY(placements)`, [houseId, placement])).rowCount;
  if (!h || (await hasPrimeOf(viewerId))) return { error: 'not_eligible' };
  const k = `${viewerId}|${houseId}|${placement}`; if (Date.now() - (seen.get(k) ?? 0) < 10_000) return { error: 'not_eligible' };
  seen.set(k, Date.now()); if (seen.size > 20000) seen.clear();
  await bump(houseId, placement, 'impressions');
  return { impressionId: `hsi-${houseId}-${Date.now().toString(36)}` };
};
const clicked = new Set();
export const houseClick = async (viewerId, houseId, impressionId, placement) => {
  if (!String(impressionId).startsWith(`hsi-${houseId}-`)) return { error: 'bad_impression' };
  const h = (await query('SELECT module, tab FROM ad_house WHERE id = $1', [houseId])).rows[0]; if (!h) return { error: 'not_found' };
  const k = `${viewerId}|${impressionId}`;
  if (!clicked.has(k)) { clicked.add(k); if (clicked.size > 20000) clicked.clear(); await bump(houseId, placement, 'clicks'); }
  return { ok: true, target: { module: h.module, tab: h.tab ?? undefined } };
};

/* ─── Админка: свои объявления и статистика ─── */
const canAds = async (id) => (await can(id, 'ads_manage')) || (await can(id, 'content'));
export const adminHouseList = async (actorId, { days = 30 } = {}) => {
  if (!(await canAds(actorId))) return { error: 'not_allowed' };
  const d = Math.min(365, Math.max(1, Number(days) || 30));
  const { rows } = await query(`SELECT h.*, COALESCE(s.imp,0)::int AS imp, COALESCE(s.clk,0)::int AS clk FROM ad_house h
    LEFT JOIN (SELECT house_id, sum(impressions) imp, sum(clicks) clk FROM ad_house_daily WHERE day > CURRENT_DATE - $1::int GROUP BY house_id) s ON s.house_id = h.id ORDER BY h.priority DESC, h.id`, [d]);
  return { days: d, modules: MODULES, extrasTabs: EXTRAS_TABS, placements: HOUSE_PLACEMENTS, items: rows.map((h) => ({ id: h.id, service: h.service, title: h.title, body: h.body, cta: h.cta, module: h.module, tab: h.tab ?? undefined, priority: h.priority, status: h.status, placements: h.placements, impressions: h.imp, clicks: h.clk, ctr: h.imp ? Math.round((h.clk / h.imp) * 1000) / 10 : 0 })) };
};
export const adminHouseSave = async (actorId, id, b = {}) => {
  if (!(await can(actorId, 'ads_manage'))) return { error: 'not_allowed' };
  const cur = (await query('SELECT * FROM ad_house WHERE id = $1', [String(id)])).rows[0]; if (!cur) return { error: 'not_found' };
  const title = b.title === undefined ? cur.title : clean(b.title, 80), body = b.body === undefined ? cur.body : clean(b.body, 200), cta = b.cta === undefined ? cur.cta : clean(b.cta, 30);
  if (title.length < 2 || body.length < 5 || cta.length < 2) return { error: 'bad_text' };
  const module = b.module === undefined ? cur.module : String(b.module); if (!Object.hasOwn(MODULES, module)) return { error: 'bad_module' };
  let tab = b.tab === undefined ? cur.tab : (b.tab ? String(b.tab) : null);
  if (tab && !(module === 'extras' && EXTRAS_TABS.includes(tab))) return { error: 'bad_tab' };
  if (module !== 'extras') tab = null;
  const status = b.status === undefined ? cur.status : String(b.status); if (!['active', 'paused'].includes(status)) return { error: 'bad_status' };
  const placements = b.placements === undefined ? cur.placements : [...new Set((Array.isArray(b.placements) ? b.placements : []).map(String).filter((p) => HOUSE_PLACEMENTS.includes(p)))];
  const priority = b.priority === undefined ? cur.priority : Math.max(0, Math.min(100, Math.trunc(Number(b.priority)) || 0));
  await query('UPDATE ad_house SET title=$2, body=$3, cta=$4, module=$5, tab=$6, status=$7, placements=$8, priority=$9, updated_by=$10, updated_at=now() WHERE id=$1', [cur.id, title, body, cta, module, tab, status, placements, priority, actorId]);
  await logAdmin({ actorId, targetType: 'system', type: 'ad_house_save', detail: `${cur.id}: ${status}, приоритет ${priority}` });
  return { ok: true };
};
export const adminHouseCreate = async (actorId, b = {}) => {
  if (!(await can(actorId, 'ads_manage'))) return { error: 'not_allowed' };
  const service = clean(b.service, 40); if (service.length < 2) return { error: 'bad_text' };
  const id = `house-${service.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || Date.now().toString(36)}`;
  if ((await query('SELECT 1 FROM ad_house WHERE id = $1', [id])).rowCount) return { error: 'exists' };
  await query(`INSERT INTO ad_house (id, service, title, body, cta, module, placements, status, updated_by) VALUES ($1,$2,$3,$4,'Открыть','extras','{}','paused',$5)`, [id, service, service, 'Описание объявления', actorId]);
  return adminHouseSave(actorId, id, { title: b.title ?? service, body: b.body ?? 'Узнайте больше о сервисе Sky', cta: b.cta ?? 'Открыть', module: b.module ?? 'extras', tab: b.tab, placements: b.placements ?? [], status: 'paused' }).then((r) => (r.ok ? { ok: true, id } : r));
};
export const adminStats = async (actorId, { days = 30 } = {}) => {
  if (!(await canAds(actorId))) return { error: 'not_allowed' };
  const d = Math.min(365, Math.max(1, Number(days) || 30));
  const byPlacement = (await query(`SELECT placement, count(*)::int AS imp FROM ad_impressions WHERE created_at > now() - ($1 || ' days')::interval GROUP BY placement`, [String(d)])).rows;
  const clicks = (await query(`SELECT placement, count(*)::int AS clk FROM ad_clicks WHERE created_at > now() - ($1 || ' days')::interval GROUP BY placement`, [String(d)])).rows;
  const house = (await query(`SELECT placement, sum(impressions)::int AS imp, sum(clicks)::int AS clk FROM ad_house_daily WHERE day > CURRENT_DATE - $1::int GROUP BY placement`, [d])).rows;
  const merge = new Map();
  for (const r of byPlacement) merge.set(r.placement, { placement: r.placement, impressions: r.imp, clicks: 0, houseImpressions: 0, houseClicks: 0 });
  for (const r of clicks) (merge.get(r.placement) ?? merge.set(r.placement, { placement: r.placement, impressions: 0, clicks: 0, houseImpressions: 0, houseClicks: 0 }).get(r.placement)).clicks = r.clk;
  for (const r of house) { const m = merge.get(r.placement) ?? merge.set(r.placement, { placement: r.placement, impressions: 0, clicks: 0, houseImpressions: 0, houseClicks: 0 }).get(r.placement); m.houseImpressions = r.imp; m.houseClicks = r.clk; }
  const tamper = Number((await query(`SELECT count(*)::int AS n FROM ad_link_tamper WHERE at > now() - ($1 || ' days')::interval`, [String(d)])).rows[0].n);
  return { days: d, byPlacement: [...merge.values()].map((m) => ({ ...m, ctr: m.impressions ? Math.round((m.clicks / m.impressions) * 1000) / 10 : 0, houseCtr: m.houseImpressions ? Math.round((m.houseClicks / m.houseImpressions) * 1000) / 10 : 0 })), linkTamperEvents: tamper };
};
