/**
 * Проверка новых версий Sky (ноябрь-2026). Приложение (Android / iOS / Windows) спрашивает у сервера, есть ли версия новее установленной:
 *  • «последняя версия», минимальная поддерживаемая сборка, флаг обязательного обновления и тексты уведомлений задаёт администрация;
 *  • ссылки на магазины хранятся по закрытому списку STORES; показывается только магазин, который поддерживает платформу устройства
 *    (на ПК-браузере, macOS и Linux ссылок на магазины нет) — «неподдерживаемые» магазины не выдаются никогда;
 *  • минимальная сборка действует и как шлюз API (appversion.mjs): сборка ниже минимальной получает «обновите приложение».
 * Что установлено и какая платформа — сообщает сам клиент (заголовки/параметры); это политика интерфейса, а не граница безопасности:
 * запрещает старую сборку сервер (шлюз), а не окно на экране.
 */
import { query } from './db.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { setDbMinBuild, setOutdatedTexts } from './appversion.mjs';

export const PLATFORMS = ['android', 'ios', 'windows', 'macos', 'linux', 'web'];
/** Магазины и платформы, которые они обслуживают. Всё, чего здесь нет, — «неподдерживаемый магазин». */
export const STORES = {
  googleplay: { label: 'Google Play', platform: 'android', hosts: ['play.google.com'] },
  rustore: { label: 'RuStore', platform: 'android', hosts: ['rustore.ru', 'apps.rustore.ru'] },
  appgallery: { label: 'AppGallery', platform: 'android', hosts: ['appgallery.huawei.com', 'appgallery.cloud.huawei.com'] },
  appstore: { label: 'App Store', platform: 'ios', hosts: ['apps.apple.com', 'itunes.apple.com'] },
  microsoft: { label: 'Microsoft Store', platform: 'windows', hosts: ['apps.microsoft.com', 'www.microsoft.com', 'microsoft.com'] },
};

const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

export const validStoreUrl = (store, raw) => {
  const spec = STORES[store];
  if (!spec) return null;
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (!spec.hosts.includes(u.hostname.toLowerCase())) return null;
  return u.toString().slice(0, 300);
};

let cache = { at: 0, v: null };
export const settings = async (fresh = false) => {
  if (!fresh && cache.v && Date.now() - cache.at < 10_000) return cache.v;
  const r = (await query('SELECT * FROM app_update_settings WHERE id')).rows[0];
  const v = {
    latestVersion: r.latest_version, latestBuild: Number(r.latest_build), minBuild: Number(r.min_build), mandatory: r.mandatory,
    messageRu: r.message_ru, messageEn: r.message_en, forcedRu: r.forced_ru, forcedEn: r.forced_en,
    // Хранимые ссылки перепроверяются при чтении: запись в БД, не прошедшая проверку, наружу не выходит.
    stores: Object.fromEntries(Object.entries(r.stores ?? {}).map(([k, u]) => [k, validStoreUrl(k, u)]).filter(([, u]) => u)),
    updatedAt: r.updated_at?.toISOString?.(),
  };
  cache = { at: Date.now(), v };
  return v;
};

/** Согласовать шлюз API (appversion.mjs) с настройками: вызывается при запуске, раз в 15 секунд и после сохранения. */
export const syncGate = async () => {
  const s = await settings(true);
  setDbMinBuild(s.minBuild);
  setOutdatedTexts(s.forcedRu, s.forcedEn);
  return s;
};
export const startGateSync = () => { syncGate().catch(() => {}); setInterval(() => { syncGate().catch(() => {}); }, 15_000).unref?.(); };

export const storesFor = (s, platform) =>
  Object.entries(STORES).filter(([k, spec]) => spec.platform === platform && s.stores[k]).map(([k, spec]) => ({ id: k, label: spec.label, url: s.stores[k] }));

/** Публичная проверка: что установлено (platform, build) → есть ли обновление, обязательное ли оно, какой текст и какие ссылки. */
export const check = async ({ platform, build, lang } = {}) => {
  const p = PLATFORMS.includes(String(platform)) ? String(platform) : 'web';
  const b = Math.max(0, Math.trunc(Number(build)) || 0);
  const s = await settings();
  const native = p !== 'web';
  const updateAvailable = native && b > 0 && s.latestBuild > 0 && b < s.latestBuild;
  const supported = !native || s.minBuild === 0 || b >= s.minBuild;
  const mandatory = native && (!supported || (s.mandatory && updateAvailable));
  const en = String(lang) === 'en';
  const file = native ? (await query(`SELECT version, file_id IS NOT NULL AS has_file FROM app_updates WHERE platform = $1`, [p])).rows[0] : null;
  return {
    platform: p, installedBuild: b, latestVersion: s.latestVersion || undefined, latestBuild: s.latestBuild || undefined,
    updateAvailable, supported, mandatory,
    message: mandatory ? (en ? s.forcedEn : s.forcedRu) : (en ? s.messageEn : s.messageRu),
    stores: updateAvailable || !supported ? storesFor(s, p) : [],
    updatesPage: native, fileAvailable: Boolean(file?.has_file),
  };
};

export const adminGet = async (actorId) => {
  if (!(await can(actorId, 'site'))) return { error: 'not_allowed' };
  const s = await settings(true);
  return { settings: s, storeCatalog: Object.entries(STORES).map(([id, v]) => ({ id, label: v.label, platform: v.platform, hosts: v.hosts })), canForce: await isOwner(actorId) };
};

/** Правка текстов, версии и магазинов — право `site`. Обязательность и минимальная сборка (способны закрыть приложение всем) — владелец после проверки кода. */
export const adminSave = async (actorId, b = {}, { codeOk = false } = {}) => {
  if (!(await can(actorId, 'site'))) return { error: 'not_allowed' };
  const cur = await settings(true);
  const num = (v, d) => (v === undefined ? d : Math.max(0, Math.min(2_000_000_000, Math.trunc(Number(v)) || 0)));
  const next = {
    latestVersion: b.latestVersion === undefined ? cur.latestVersion : cleanText(b.latestVersion, 40),
    latestBuild: num(b.latestBuild, cur.latestBuild),
    minBuild: num(b.minBuild, cur.minBuild),
    mandatory: typeof b.mandatory === 'boolean' ? b.mandatory : cur.mandatory,
    messageRu: b.messageRu === undefined ? cur.messageRu : cleanText(b.messageRu, 300),
    messageEn: b.messageEn === undefined ? cur.messageEn : cleanText(b.messageEn, 300),
    forcedRu: b.forcedRu === undefined ? cur.forcedRu : cleanText(b.forcedRu, 300),
    forcedEn: b.forcedEn === undefined ? cur.forcedEn : cleanText(b.forcedEn, 300),
  };
  for (const k of ['messageRu', 'messageEn', 'forcedRu', 'forcedEn']) if (next[k].length < 5) return { error: 'text_required', field: k };
  let stores = cur.stores;
  if (b.stores !== undefined) {
    stores = {};
    for (const [k, u] of Object.entries(b.stores ?? {})) {
      if (!STORES[k]) return { error: 'unsupported_store', store: k };
      if (u === '' || u == null) continue;
      const ok = validStoreUrl(k, u); if (!ok) return { error: 'bad_store_url', store: k };
      stores[k] = ok;
    }
  }
  const forcing = next.minBuild !== cur.minBuild || next.mandatory !== cur.mandatory;
  if (forcing) {
    if (!(await isOwner(actorId))) return { error: 'owner_only' };
    if (!codeOk) return { error: 'code_required' };
    if (next.minBuild > 0 && next.latestBuild > 0 && next.minBuild > next.latestBuild) return { error: 'min_above_latest' };
    if (next.minBuild > 0 && next.latestBuild === 0) return { error: 'latest_required' };
  }
  if (next.minBuild > 0 && next.latestBuild > 0 && next.minBuild > next.latestBuild) return { error: 'min_above_latest' };
  await query(`UPDATE app_update_settings SET latest_version=$1, latest_build=$2, min_build=$3, mandatory=$4, message_ru=$5, message_en=$6, forced_ru=$7, forced_en=$8, stores=$9::jsonb, updated_by=$10, updated_at=now() WHERE id`,
    [next.latestVersion, next.latestBuild, next.minBuild, next.mandatory, next.messageRu, next.messageEn, next.forcedRu, next.forcedEn, JSON.stringify(stores), actorId]);
  await logAdmin({ actorId, targetType: 'system', type: forcing ? 'app_update_force' : 'app_update_settings', detail: `версия ${next.latestVersion || '—'} (${next.latestBuild}); минимум ${next.minBuild}; обязательное ${next.mandatory ? 'да' : 'нет'}; магазинов ${Object.keys(stores).length}` });
  return { ok: true, settings: await syncGate() };
};
