/**
 * Sky Media Home: настраиваемый главный экран. Хранится только раскладка (какие виджеты, размер, настройки) —
 * данные виджеты берут из своих сервисов. Всё проверяет сервер: типы из реестра, размеры из списка, настройки по схеме;
 * произвольный код и HTML сюда не попадают (пользовательские виджеты — только безопасные шаблоны).
 */
import { randomUUID } from 'node:crypto';
import { query } from './db.mjs';

export const SIZES = ['compact', 'standard', 'wide'];
export const DENSITIES = ['cozy', 'normal', 'dense'];
export const SURFACES = ['glass', 'solid', 'clear'];
export const MAX_WIDGETS = 24;
export const MAX_LAYOUTS = 8;
export const MAX_CUSTOM = 12;

/** Реестр (только виджеты, у которых есть настоящий источник данных; остальные добавляются вместе с источником): id, категория, допустимые размеры, схема настроек. Источник данных — на клиенте (по id), здесь только форма. */
export const WIDGETS = {
  clock:        { cat: 'time',     sizes: ['compact', 'standard', 'wide'], cfg: { format24: 'bool', seconds: 'bool' } },
  weather:      { cat: 'time',     sizes: ['compact', 'standard'],         cfg: {} },
  worldtime:    { cat: 'time',     sizes: ['standard', 'wide'],            cfg: { zones: 'zones' } },
  calendar:     { cat: 'time',     sizes: ['standard', 'wide'],            cfg: {} },
  nowplaying:   { cat: 'media',    sizes: ['compact', 'standard', 'wide'], cfg: {} },
  miniplayer:   { cat: 'media',    sizes: ['compact', 'standard'],         cfg: {} },
  wave:         { cat: 'media',    sizes: ['standard', 'wide'],            cfg: { shelf: 'shelf' } },
  continue:     { cat: 'media',    sizes: ['standard', 'wide'],            cfg: {} },
  recent:       { cat: 'personal', sizes: ['standard', 'wide'],            cfg: {} },
  favorites:    { cat: 'personal', sizes: ['standard', 'wide'],            cfg: {} },
  unread:       { cat: 'social',   sizes: ['compact', 'standard'],         cfg: { showText: 'bool' } },
  activity:     { cat: 'stats',    sizes: ['standard', 'wide'],            cfg: {} },
  tasks:        { cat: 'tasks',    sizes: ['standard', 'wide'],            cfg: {} },
  quick:        { cat: 'quick',    sizes: ['compact', 'standard', 'wide'], cfg: { actions: 'actions' } },
  ai:           { cat: 'eco',      sizes: ['standard', 'wide'],            cfg: {} },
  points:       { cat: 'eco',      sizes: ['compact', 'standard'],         cfg: {} },
  custom:       { cat: 'custom',    sizes: ['compact', 'standard', 'wide'], cfg: { template: 'template', title: 'text', value: 'text', url: 'link' } },
};

const SHELVES_ALLOWED = ['for_you', 'continue', 'new', 'trending', 'similar', 'discover', 'evening', 'short', 'collection', 'recent', 'return'];
const ACTIONS_ALLOWED = ['music', 'film', 'video', 'podcasts', 'books', 'messenger', 'wallet', 'go', 'market', 'ai', 'profile', 'storage'];
const TEMPLATES = ['counter', 'note', 'link', 'progress'];
const PERIODS = ['day', 'week', 'month'];
const ZONE_RE = /^[A-Za-z_]+\/[A-Za-z_\-+0-9/]+$/;

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

const cleanCfg = (type, cfg) => {
  const schema = WIDGETS[type].cfg; const src = cfg && typeof cfg === 'object' ? cfg : {}; const out = {};
  for (const [k, t] of Object.entries(schema)) {
    const v = src[k];
    if (t === 'bool') { if (typeof v === 'boolean') out[k] = v; }
    else if (t === 'text') { if (typeof v === 'string') out[k] = text(v, k === 'title' ? 40 : 80); }
    else if (t === 'shelf') { if (SHELVES_ALLOWED.includes(v)) out[k] = v; }
    else if (t === 'period') { if (PERIODS.includes(v)) out[k] = v; }
    else if (t === 'template') { if (TEMPLATES.includes(v)) out[k] = v; }
    else if (t === 'zones') { if (Array.isArray(v)) out[k] = v.map((z) => String(z)).filter((z) => ZONE_RE.test(z)).slice(0, 4); }
    else if (t === 'actions') { if (Array.isArray(v)) out[k] = [...new Set(v.filter((a) => ACTIONS_ALLOWED.includes(a)))].slice(0, 8); }
    else if (t === 'link') {   // только https без логина/пароля
      if (typeof v === 'string' && v) { try { const u = new URL(v); if (u.protocol === 'https:' && !u.username && !u.password) out[k] = u.toString().slice(0, 300); } catch { /* не ссылка */ } }
    }
  }
  return out;
};

/** Приводит присланную раскладку к допустимой. Неизвестные типы отбрасываются, лишнее обрезается. */
export const cleanLayout = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set(); const widgets = []; let custom = 0;
  for (const w of Array.isArray(src.widgets) ? src.widgets : []) {
    if (widgets.length >= MAX_WIDGETS) break;
    const type = String(w?.type ?? ''); if (!WIDGETS[type]) continue;
    if (type === 'custom' && ++custom > MAX_CUSTOM) continue;
    let id = text(w?.id, 40).replace(/[^A-Za-z0-9_-]/g, ''); if (!id || seen.has(id)) id = `${type}-${randomUUID().slice(0, 8)}`;
    seen.add(id);
    const size = WIDGETS[type].sizes.includes(w?.size) ? w.size : WIDGETS[type].sizes.includes('standard') ? 'standard' : WIDGETS[type].sizes[0];
    widgets.push({ id, type, size, cfg: cleanCfg(type, w?.cfg) });
  }
  return {
    v: 1,
    widgets,
    density: DENSITIES.includes(src.density) ? src.density : 'normal',
    surface: SURFACES.includes(src.surface) ? src.surface : 'glass',
    accent: /^#[0-9a-fA-F]{6}$/.test(String(src.accent ?? '')) ? src.accent : null,
  };
};

const mk = (type, size) => ({ id: `${type}-${randomUUID().slice(0, 8)}`, type, size, cfg: {} });
/** Раскладка по умолчанию: только то, что у человека реально есть (кошелёк, чаты, медиа). */
export const defaultLayout = () => cleanLayout({
  widgets: [mk('clock', 'standard'), mk('weather', 'compact'), mk('nowplaying', 'standard'), mk('wave', 'wide'), mk('continue', 'wide'), mk('unread', 'compact'), mk('points', 'compact'), mk('quick', 'wide')],
});

const view = (r) => ({ id: r.id, name: r.name, active: r.active, layout: r.layout, updatedAt: r.updated_at });

export const listLayouts = async (profileId) => {
  const { rows } = await query('SELECT id, name, active, layout, updated_at FROM media_home_layouts WHERE profile_id=$1 ORDER BY created_at', [profileId]);
  return rows.map(view);
};

export const registryView = () => Object.entries(WIDGETS).map(([type, w]) => ({ type, cat: w.cat, sizes: w.sizes }));

/** Состояние для клиента: варианты (если нет ни одного — создаётся «Основной» по умолчанию), реестр, лимиты. */
export const getHome = async (profileId) => {
  let layouts = await listLayouts(profileId);
  if (!layouts.length) {
    await query(`INSERT INTO media_home_layouts (id, profile_id, name, layout, active) VALUES ($1,$2,$3,$4,TRUE) ON CONFLICT DO NOTHING`,
      [`mhl-${randomUUID()}`, profileId, 'Основной', JSON.stringify(defaultLayout())]);
    layouts = await listLayouts(profileId);
  }
  return { layouts, registry: registryView(), limits: { widgets: MAX_WIDGETS, layouts: MAX_LAYOUTS, custom: MAX_CUSTOM } };
};

const own = async (profileId, id) => (await query('SELECT id, name, active, layout, updated_at FROM media_home_layouts WHERE id=$1 AND profile_id=$2', [String(id), profileId])).rows[0] ?? null;

export const createLayout = async (profileId, { name, layout, copyOf } = {}) => {
  const n = (await query('SELECT count(*)::int AS n FROM media_home_layouts WHERE profile_id=$1', [profileId])).rows[0].n;
  if (n >= MAX_LAYOUTS) return { error: 'too_many_layouts' };
  let base = layout;
  if (copyOf) { const src = await own(profileId, copyOf); if (!src) return { error: 'not_found' }; base = src.layout; }
  const nm = text(name, 40) || 'Новый экран';
  const id = `mhl-${randomUUID()}`;
  const clean = base ? cleanLayout(base) : defaultLayout();
  await query('INSERT INTO media_home_layouts (id, profile_id, name, layout) VALUES ($1,$2,$3,$4)', [id, profileId, nm, JSON.stringify(clean)]);
  return { layout: view((await own(profileId, id))) };
};

export const saveLayout = async (profileId, id, { name, layout } = {}) => {
  const cur = await own(profileId, id); if (!cur) return { error: 'not_found' };
  const nm = name === undefined ? cur.name : (text(name, 40) || cur.name);
  const lay = layout === undefined ? cur.layout : cleanLayout(layout);
  await query('UPDATE media_home_layouts SET name=$3, layout=$4, updated_at=now() WHERE id=$1 AND profile_id=$2', [cur.id, profileId, nm, JSON.stringify(lay)]);
  return { layout: view(await own(profileId, id)) };
};

export const activateLayout = async (profileId, id) => {
  if (!(await own(profileId, id))) return { error: 'not_found' };
  // два условных UPDATE подряд: частичный UNIQUE не даёт двум вариантам стать активными одновременно
  await query('UPDATE media_home_layouts SET active=FALSE WHERE profile_id=$1 AND active AND id<>$2', [profileId, String(id)]);
  await query('UPDATE media_home_layouts SET active=TRUE WHERE profile_id=$1 AND id=$2', [profileId, String(id)]);
  return { ok: true };
};

export const deleteLayout = async (profileId, id) => {
  const cur = await own(profileId, id); if (!cur) return { error: 'not_found' };
  const n = (await query('SELECT count(*)::int AS n FROM media_home_layouts WHERE profile_id=$1', [profileId])).rows[0].n;
  if (n <= 1) return { error: 'last_layout' };
  await query('DELETE FROM media_home_layouts WHERE id=$1 AND profile_id=$2', [cur.id, profileId]);
  if (cur.active) {
    const next = (await query('SELECT id FROM media_home_layouts WHERE profile_id=$1 ORDER BY created_at LIMIT 1', [profileId])).rows[0];
    if (next) await query('UPDATE media_home_layouts SET active=TRUE WHERE id=$1', [next.id]);
  }
  return { ok: true };
};
