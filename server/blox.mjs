/**
 * Sky Blox: разработчики, игры, плейсы, каталог, запуски, отзывы,
 * избранное, модерация, жалобы и апелляции.
 *
 * Что здесь НЕ происходит: код разработчика на нашем сервере не
 * исполняется. Игра — это адрес страницы на инфраструктуре разработчика,
 * которая открывается в изолированном окне браузера игрока; сервер игры
 * — внешняя служба, которая говорит с Sky подписанными запросами
 * (bloxshop.mjs). Адреса проверяются на SSRF (bloxnet.mjs).
 *
 * Видимость определяет moderation_status; публичным плейс не становится
 * без решения модератора, а сам разработчик свою игру не одобряет.
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { encryptContent } from './crypto.mjs';
import { config } from './config.mjs';
import { marketText as text } from './market.mjs';
import { limit, trustMultiplier, loadLimits } from './bloxlimits.mjs';
import { resolveSafeUrl, probeGame, autoCheck, HOSTING_TYPES, SUPPORTED_FORMATS, UNSUPPORTED_FORMATS, hostingAdvice } from './bloxnet.mjs';

export const GAME_ID_RE = /^bg-[0-9a-f-]{36}$/;
export const PLACE_ID_RE = /^bp-[0-9a-f-]{36}$/;
export const REVIEW_ID_RE = /^brv-[0-9a-f-]{36}$/;
export const REPORT_ID_RE = /^bpr-[0-9a-f-]{36}$/;
export const APPEAL_ID_RE = /^bpa-[0-9a-f-]{36}$/;
export const IMAGE_ID_RE = /^bgi-[0-9a-f-]{36}$/;

export const TERMS_VERSION = 'blox-dev-1';
export const CATEGORIES = ['action', 'adventure', 'puzzle', 'racing', 'strategy', 'simulation', 'sports', 'social', 'education', 'other'];
export const REPORT_REASONS = ['malware', 'scam', 'illegal', 'adult', 'copyright', 'hate', 'cheating', 'bug', 'other'];
const REASON_PRIORITY = { malware: 3, scam: 3, illegal: 3, adult: 2, copyright: 2, hate: 2, cheating: 1, bug: 1, other: 1 };
const STATUSES = ['draft', 'pending', 'needs_changes', 'approved', 'published', 'hidden', 'blocked', 'archived'];

const iso = (d) => d?.toISOString?.() ?? null;
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const isStaff = async (a) => (await can(a, 'blox_moderation')) || (await can(a, 'blox'));
const isBloxAdmin = (a) => can(a, 'blox');

const searchTextFor = (parts) => parts.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ').slice(0, 2000);

const modEvent = (c, type, id, actorId, role, action, from, to, reason = '') =>
  c.query(
    `INSERT INTO blox_mod_events (subject_type, subject_id, actor_id, actor_role, action, from_status, to_status, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [type, id, actorId ?? null, role, action, from ?? null, to ?? null, text(reason, 500)]);

/* ─── Справка о платформе ──────────────────────────────────────────── */

export const platformInfo = async () => {
  const l = await loadLimits();
  return {
    categories: CATEGORIES,
    hostingTypes: HOSTING_TYPES,
    supportedFormats: SUPPORTED_FORMATS,
    unsupportedFormats: UNSUPPORTED_FORMATS,
    reportReasons: REPORT_REASONS,
    termsVersion: TERMS_VERSION,
    commissionPercent: l.commissionPercent,
    holdDays: l.holdDays,
    minPayoutPoints: l.minPayoutPoints,
    payoutsEnabled: l.payoutsEnabled === 1,
    maxUploadBytes: l.maxUploadBytes,
    publicOrigin: config.publicOrigin || '',
  };
};

/* ─── Разработчик ──────────────────────────────────────────────────── */

export const myDeveloper = async (profileId) => {
  const { rows } = await query('SELECT * FROM blox_developers WHERE profile_id = $1', [profileId]);
  const d = rows[0];
  if (!d) return null;
  return { displayName: d.display_name, status: d.status, trustLevel: d.trust_level, termsVersion: d.terms_version, termsAt: iso(d.terms_at), suspendReason: d.suspend_reason, createdAt: iso(d.created_at) };
};

export const becomeDeveloper = async (profileId, { displayName, acceptTerms } = {}) => {
  const name = text(displayName, 60);
  if (name.length < 2) return { error: 'bad_name' };
  if (acceptTerms !== true) return { error: 'terms_required' };
  const { rowCount } = await query(
    `INSERT INTO blox_developers (profile_id, display_name, terms_version) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [profileId, name, TERMS_VERSION]);
  if (!rowCount) return { error: 'already_developer' };
  return { developer: await myDeveloper(profileId) };
};

const devRow = async (profileId) => {
  const { rows } = await query('SELECT * FROM blox_developers WHERE profile_id = $1', [profileId]);
  return rows[0] ?? null;
};

/** Разработчик может действовать, пока он не приостановлен. */
const activeDev = async (profileId) => {
  const d = await devRow(profileId);
  if (!d) return { error: 'not_a_developer' };
  if (d.status !== 'active') return { error: 'developer_suspended' };
  return { dev: d };
};

/* ─── Игры: представление ──────────────────────────────────────────── */

const imageIds = async (ownerType, ownerId) => {
  const { rows } = await query(
    'SELECT id, kind FROM blox_images WHERE owner_type = $1 AND owner_id = $2 ORDER BY kind, sort_order, created_at', [ownerType, ownerId]);
  return { cover: rows.find((r) => r.kind === 'cover')?.id ?? null, shots: rows.filter((r) => r.kind === 'shot').map((r) => r.id) };
};

const gameView = async (g, { own = false } = {}) => {
  const imgs = await imageIds('game', g.id);
  const base = {
    id: g.id, slug: g.slug, title: g.title, description: g.description, category: g.category,
    tags: g.tags ?? [], developerId: g.developer_id, developerName: g.developer_name ?? undefined,
    rating: g.rating_avg == null ? null : Math.round(Number(g.rating_avg) * 10) / 10, ratingCount: g.rating_count,
    launches: g.launches, visitors: g.visitors, favorites: g.favorites, version: g.version,
    coverId: imgs.cover, shotIds: imgs.shots, publishedAt: iso(g.published_at), favorite: g.favorite === true || undefined,
  };
  if (!own) return base;
  return {
    ...base,
    hostingType: g.hosting_type, clientUrl: g.client_url, serverUrl: g.server_url, keyId: g.key_id,
    connStatus: g.conn_status, connCheckedAt: iso(g.conn_checked_at), connError: g.conn_error, connChecks: g.conn_details?.checks ?? [],
    moderationStatus: g.moderation_status, moderationReason: g.moderation_reason, autoFindings: g.auto_findings ?? [],
    createdAt: iso(g.created_at), submittedAt: iso(g.submitted_at),
    advice: hostingAdvice(g.hosting_type, { hasServer: Boolean(g.server_url) }),
  };
};

const placeView = async (p, { own = false } = {}) => {
  const imgs = await imageIds('place', p.id);
  const base = {
    id: p.id, gameId: p.game_id, title: p.title, description: p.description, category: p.category,
    maxPlayers: p.max_players, minAge: p.min_age, isMain: p.is_main, launches: p.launches,
    coverId: imgs.cover, shotIds: imgs.shots, publishedAt: iso(p.published_at),
  };
  if (!own) return base;
  return { ...base, entryPath: p.entry_path, moderationStatus: p.moderation_status, moderationReason: p.moderation_reason, autoFindings: p.auto_findings ?? [], submittedAt: iso(p.submitted_at) };
};

const SELECT_GAME = `
  SELECT g.*, d.display_name AS developer_name,
         EXISTS (SELECT 1 FROM blox_favorites f WHERE f.game_id = g.id AND f.user_id = $1) AS favorite
    FROM blox_games g JOIN blox_developers d ON d.profile_id = g.developer_id`;

/* ─── Каталог ──────────────────────────────────────────────────────── */

const PUBLIC = `g.moderation_status = 'published' AND d.status = 'active'
  AND EXISTS (SELECT 1 FROM blox_places pl WHERE pl.game_id = g.id AND pl.moderation_status = 'published')`;

/** Небольшой кэш выдачи: при нагрузке каталог не пересчитывается на каждый запрос. */
const catalogCache = new Map();
const bust = () => { catalogCache.clear(); setTimeout(() => catalogCache.clear(), 50).unref?.(); setTimeout(() => catalogCache.clear(), 600).unref?.(); };
const CACHE_MS = 5000;

export const listCatalog = async (viewerId, { q, category, sort, section, limit: lim, offset } = {}) => {
  const n = Math.min(Math.max(Number(lim) || 24, 1), 60);
  const off = Math.min(Math.max(Number(offset) || 0, 0), 5000);
  const args = [viewerId ?? ''];
  const where = [PUBLIC];
  const needle = text(q, 80).toLowerCase();
  if (needle) { args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`); where.push(`g.search_text LIKE $${args.length} ESCAPE '\\'`); }
  if (category && CATEGORIES.includes(String(category))) { args.push(String(category)); where.push(`g.category = $${args.length}`); }

  let order = 'g.published_at DESC NULLS LAST';
  const s = String(section ?? sort ?? 'new');
  if (s === 'popular') order = `(SELECT count(*) FROM blox_launches l WHERE l.game_id = g.id AND l.issued_at > now() - interval '7 days') DESC, g.launches DESC`;
  else if (s === 'rating') order = 'g.rating_avg DESC NULLS LAST, g.rating_count DESC';
  else if (s === 'recommended') {
    // Сначала то, что нравится людям (оценка и число оценок), затем близкое
    // к избранному и истории этого игрока; уже избранное не предлагаем.
    where.push(`NOT EXISTS (SELECT 1 FROM blox_favorites f2 WHERE f2.game_id = g.id AND f2.user_id = $1)`);
    order = `(CASE WHEN g.category IN (SELECT g2.category FROM blox_games g2 WHERE g2.id IN
               (SELECT game_id FROM blox_favorites WHERE user_id = $1 UNION SELECT game_id FROM blox_launches WHERE user_id = $1)) THEN 0 ELSE 1 END),
             g.rating_avg DESC NULLS LAST, g.rating_count DESC, g.launches DESC`;
  }

  const key = JSON.stringify([args, order, where, n, off]);
  const hit = catalogCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;

  args.push(n, off);
  const { rows } = await query(
    `${SELECT_GAME} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
  const items = await Promise.all(rows.map((r) => gameView(r)));
  catalogCache.set(key, { at: Date.now(), items });
  if (catalogCache.size > 200) catalogCache.delete(catalogCache.keys().next().value);
  return items;
};

export const homeSections = async (viewerId) => {
  const [popular, fresh, recommended] = await Promise.all([
    listCatalog(viewerId, { section: 'popular', limit: 8 }),
    listCatalog(viewerId, { section: 'new', limit: 8 }),
    listCatalog(viewerId, { section: 'recommended', limit: 8 }),
  ]);
  return { popular, new: fresh, recommended };
};

export const readGame = async (viewerId, gameId) => {
  if (!GAME_ID_RE.test(String(gameId ?? ''))) return null;
  const { rows } = await query(`${SELECT_GAME} WHERE g.id = $2`, [viewerId ?? '', gameId]);
  const g = rows[0];
  if (!g) return null;
  const mine = g.developer_id === viewerId;
  const staff = !mine && await isStaff(viewerId);
  const { rows: pub } = await query(`SELECT 1 FROM blox_games g JOIN blox_developers d ON d.profile_id = g.developer_id WHERE g.id = $1 AND ${PUBLIC}`, [gameId]);
  if (!mine && !staff && !pub[0]) return null;
  const { rows: places } = await query(
    `SELECT * FROM blox_places WHERE game_id = $1 ${mine || staff ? '' : "AND moderation_status = 'published'"} ORDER BY is_main DESC, created_at`, [gameId]);
  return { ...(await gameView(g, { own: mine || staff })), places: await Promise.all(places.map((p) => placeView(p, { own: mine || staff }))), own: mine || undefined };
};

/* ─── Мои игры (кабинет) ───────────────────────────────────────────── */

export const myGames = async (profileId) => {
  const { rows } = await query(`${SELECT_GAME} WHERE g.developer_id = $1 ORDER BY g.created_at DESC`, [profileId]);
  return Promise.all(rows.map((r) => gameView(r, { own: true })));
};

const validateGameInput = async (input, { partial = false } = {}) => {
  const out = {};
  if (!partial || input.title !== undefined) {
    const t = text(input.title, 80);
    if (t.length < 2) return { error: 'bad_title' };
    out.title = t;
  }
  if (input.description !== undefined) out.description = text(input.description, 4000);
  if (!partial || input.category !== undefined) {
    const c = String(input.category ?? 'other');
    if (!CATEGORIES.includes(c)) return { error: 'bad_category' };
    out.category = c;
  }
  if (input.tags !== undefined) {
    out.tags = JSON.stringify(Array.isArray(input.tags) ? input.tags.slice(0, 10).map((t) => text(t, 24)).filter(Boolean) : []);
  }
  if (input.hostingType !== undefined) {
    if (!HOSTING_TYPES[input.hostingType]) return { error: 'bad_hosting' };
    out.hosting_type = input.hostingType;
  }
  for (const [k, col, label] of [['clientUrl', 'client_url', 'Адрес игры'], ['serverUrl', 'server_url', 'Адрес сервера']]) {
    if (input[k] === undefined) continue;
    const raw = String(input[k] ?? '').trim();
    if (raw === '') { out[col] = ''; continue; }
    const r = await resolveSafeUrl(raw, { label });
    if (!r.ok) return { error: 'bad_url', field: k, message: r.message, fix: r.fix, code: r.code };
    // Храним нормализованный адрес без фрагмента.
    r.url.hash = '';
    out[col] = r.url.toString();
  }
  return { fields: out };
};

export const createGame = async (profileId, input = {}) => {
  const a = await activeDev(profileId);
  if (a.error) return a;
  const v = await validateGameInput(input);
  if (v.error) return v;
  const { rows: cnt } = await query(`SELECT count(*)::int AS n FROM blox_games WHERE developer_id = $1 AND moderation_status <> 'archived'`, [profileId]);
  if (cnt[0].n >= (await limit('maxProjectsPerDev')) * trustMultiplier(a.dev.trust_level)) return { error: 'too_many_projects' };
  const f = v.fields;
  if ((f.client_url || f.server_url)) {
    const { rows: srv } = await query(`SELECT count(*)::int AS n FROM blox_games WHERE developer_id = $1 AND (server_url <> '' OR client_url <> '') AND moderation_status <> 'archived'`, [profileId]);
    if (srv[0].n >= (await limit('maxServersPerDev')) * trustMultiplier(a.dev.trust_level)) return { error: 'too_many_servers' };
  }
  const id = `bg-${generateId()}`;
  const secret = crypto.randomBytes(32).toString('hex');
  const keyId = `bk_${crypto.randomBytes(9).toString('hex')}`;
  const slug = `${slugify(f.title) || 'game'}-${id.slice(3, 9)}`;
  await query(
    `INSERT INTO blox_games (id, developer_id, slug, title, description, category, tags, hosting_type, client_url, server_url,
                             key_id, secret_enc, search_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)`,
    [id, profileId, slug, f.title, f.description ?? '', f.category, f.tags ?? '[]', f.hosting_type ?? 'webhost',
      f.client_url ?? '', f.server_url ?? '', keyId, encryptContent(secret),
      searchTextFor([f.title, f.description, f.category])]);
  await query(`INSERT INTO blox_versions (game_id, label, notes, created_by) VALUES ($1,'1.0.0','Первая версия',$2)`, [id, profileId]);
  const c = await pool.connect();
  try { await modEvent(c, 'game', id, profileId, 'developer', 'created', null, 'draft'); } finally { c.release(); }
  const { rows } = await query(`${SELECT_GAME} WHERE g.id = $2`, [profileId, id]);
  /* Секрет показывается один раз — при создании; потом только ротация. */
  return { game: await gameView(rows[0], { own: true }), secret };
};

const loadOwnGame = async (profileId, gameId) => {
  if (!GAME_ID_RE.test(String(gameId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT * FROM blox_games WHERE id = $1', [gameId]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].developer_id !== profileId) return { error: 'not_found' };
  return { game: rows[0] };
};

/** Поля, изменение которых у опубликованной игры требует повторной проверки. */
const SENSITIVE_GAME = ['title', 'description', 'category', 'client_url', 'server_url', 'hosting_type'];

export const updateGame = async (profileId, gameId, patch = {}) => {
  bust();
  const a = await activeDev(profileId);
  if (a.error) return a;
  const o = await loadOwnGame(profileId, gameId);
  if (o.error) return o;
  const g = o.game;
  if (['blocked', 'archived'].includes(g.moderation_status)) return { error: 'locked' };
  const v = await validateGameInput(patch, { partial: true });
  if (v.error) return v;
  const f = v.fields;
  const sets = []; const args = [gameId];
  for (const [col, val] of Object.entries(f)) { args.push(val); sets.push(col === 'tags' ? `${col} = $${args.length}::jsonb` : `${col} = $${args.length}`); }
  if (!sets.length) return { game: await gameView({ ...g, developer_name: a.dev.display_name }, { own: true }) };
  const nextTitle = f.title ?? g.title; const nextDesc = f.description ?? g.description; const nextCat = f.category ?? g.category;
  args.push(searchTextFor([nextTitle, nextDesc, nextCat])); sets.push(`search_text = $${args.length}`);
  /* Адрес поменялся — прежняя проверка соединения недействительна. */
  if (f.client_url !== undefined || f.server_url !== undefined) sets.push(`conn_status = 'unconfigured'`, `conn_error = ''`);
  let toStatus = null;
  const touchesSensitive = Object.keys(f).some((k) => SENSITIVE_GAME.includes(k) && String(f[k]) !== String(g[k]));
  if (touchesSensitive && ['published', 'approved'].includes(g.moderation_status)) {
    toStatus = 'pending';
    args.push(toStatus); sets.push(`moderation_status = $${args.length}`, `submitted_at = now()`);
  }
  await query(`UPDATE blox_games SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  if (toStatus) {
    const c = await pool.connect();
    try { await modEvent(c, 'game', gameId, profileId, 'developer', 'edited_recheck', g.moderation_status, toStatus, 'Изменены данные, влияющие на безопасность или содержимое'); } finally { c.release(); }
    await refreshAuto('game', gameId);
  }
  const r = await readGame(profileId, gameId);
  return { game: r, recheck: toStatus === 'pending' || undefined };
};

export const rotateSecret = async (profileId, gameId) => {
  const o = await loadOwnGame(profileId, gameId);
  if (o.error) return o;
  const secret = crypto.randomBytes(32).toString('hex');
  await query(`UPDATE blox_games SET secret_enc = $2, secret_rotated_at = now(), conn_status = CASE WHEN server_url <> '' THEN 'unconfigured' ELSE conn_status END, updated_at = now() WHERE id = $1`,
    [gameId, encryptContent(secret)]);
  return { secret, keyId: o.game.key_id };
};

export const addVersion = async (profileId, gameId, { label, notes } = {}) => {
  const o = await loadOwnGame(profileId, gameId);
  if (o.error) return o;
  const l = text(label, 24);
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,23}$/.test(l)) return { error: 'bad_version' };
  await query('INSERT INTO blox_versions (game_id, label, notes, created_by) VALUES ($1,$2,$3,$4)', [gameId, l, text(notes, 2000), profileId]);
  await query('UPDATE blox_games SET version = $2, updated_at = now() WHERE id = $1', [gameId, l]);
  return { ok: true, version: l };
};

export const listVersions = async (profileId, gameId) => {
  const o = await loadOwnGame(profileId, gameId);
  if (o.error) return o;
  const { rows } = await query('SELECT label, notes, created_at FROM blox_versions WHERE game_id = $1 ORDER BY id DESC LIMIT 50', [gameId]);
  return { items: rows.map((r) => ({ label: r.label, notes: r.notes, at: iso(r.created_at) })) };
};

/** Проверка соединения по просьбе разработчика, с паузой между проверками. */
export const checkConnection = async (profileId, gameId) => {
  const o = await loadOwnGame(profileId, gameId);
  if (o.error) return o;
  const g = o.game;
  const cool = await limit('manualProbeCooldownSec');
  if (g.conn_checked_at && Date.now() - new Date(g.conn_checked_at).getTime() < cool * 1000 && g.conn_status !== 'unconfigured') {
    return { error: 'cooldown', retryAfter: Math.ceil(cool - (Date.now() - new Date(g.conn_checked_at).getTime()) / 1000) };
  }
  return probeGame(g, { source: 'manual' });
};

export const disconnectServer = async (profileId, gameId) => {
  bust();
  const o = await loadOwnGame(profileId, gameId);
  if (o.error) return o;
  const g = o.game;
  await query(`UPDATE blox_games SET server_url = '', conn_status = 'unconfigured', conn_error = '', conn_details = '{}'::jsonb, updated_at = now() WHERE id = $1`, [gameId]);
  // Без серверной части покупки идти не могут; опубликованная игра остаётся, магазин приостанавливается проверкой в покупках.
  if (g.moderation_status === 'published') {
    await query(`UPDATE blox_games SET moderation_status = 'approved', updated_at = now() WHERE id = $1`, [gameId]);
    const c = await pool.connect();
    try { await modEvent(c, 'game', gameId, profileId, 'developer', 'server_disconnected', 'published', 'approved', 'Сервер отключён — игра снята с публикации до новой проверки соединения'); } finally { c.release(); }
  }
  return { ok: true };
};

/* ─── Плейсы ───────────────────────────────────────────────────────── */

const ENTRY_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,300}(\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]{0,200})?$/;

const validatePlace = (input, { partial = false } = {}) => {
  const out = {};
  if (!partial || input.title !== undefined) {
    const t = text(input.title, 80);
    if (t.length < 2) return { error: 'bad_title' };
    out.title = t;
  }
  if (input.description !== undefined) out.description = text(input.description, 3000);
  if (input.category !== undefined) { if (!CATEGORIES.includes(String(input.category))) return { error: 'bad_category' }; out.category = String(input.category); }
  if (input.entryPath !== undefined) {
    const p = String(input.entryPath || '/');
    // Только путь на том же сервере: никаких //host, схем и \.
    if (!ENTRY_RE.test(p) || p.startsWith('//') || p.includes('..')) return { error: 'bad_entry_path' };
    out.entry_path = p;
  }
  if (input.maxPlayers !== undefined) { const n = Number(input.maxPlayers); if (!Number.isInteger(n) || n < 1 || n > 1000) return { error: 'bad_max_players' }; out.max_players = n; }
  if (input.minAge !== undefined) { const n = Number(input.minAge); if (!Number.isInteger(n) || n < 0 || n > 21) return { error: 'bad_min_age' }; out.min_age = n; }
  return { fields: out };
};

export const createPlace = async (profileId, gameId, input = {}) => {
  bust();
  const a = await activeDev(profileId);
  if (a.error) return a;
  const o = await loadOwnGame(profileId, gameId);
  if (o.error) return o;
  if (['blocked', 'archived'].includes(o.game.moderation_status)) return { error: 'locked' };
  const v = validatePlace(input);
  if (v.error) return v;
  const { rows: cnt } = await query(`SELECT count(*)::int AS n FROM blox_places WHERE game_id = $1 AND moderation_status <> 'archived'`, [gameId]);
  if (cnt[0].n >= (await limit('maxPlacesPerGame'))) return { error: 'too_many_places' };
  const f = v.fields;
  const id = `bp-${generateId()}`;
  await query(
    `INSERT INTO blox_places (id, game_id, title, description, category, entry_path, max_players, min_age, is_main)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, gameId, f.title, f.description ?? '', f.category ?? o.game.category, f.entry_path ?? '/', f.max_players ?? 1, f.min_age ?? 0, cnt[0].n === 0]);
  const c = await pool.connect();
  try { await modEvent(c, 'place', id, profileId, 'developer', 'created', null, 'draft'); } finally { c.release(); }
  const { rows } = await query('SELECT * FROM blox_places WHERE id = $1', [id]);
  return { place: await placeView(rows[0], { own: true }) };
};

const loadOwnPlace = async (profileId, placeId) => {
  if (!PLACE_ID_RE.test(String(placeId ?? ''))) return { error: 'not_found' };
  const { rows } = await query(
    'SELECT p.*, g.developer_id, g.moderation_status AS game_status FROM blox_places p JOIN blox_games g ON g.id = p.game_id WHERE p.id = $1', [placeId]);
  if (!rows[0] || rows[0].developer_id !== profileId) return { error: 'not_found' };
  return { place: rows[0] };
};

const SENSITIVE_PLACE = ['title', 'description', 'category', 'entry_path', 'max_players', 'min_age'];

export const updatePlace = async (profileId, placeId, patch = {}) => {
  bust();
  const o = await loadOwnPlace(profileId, placeId);
  if (o.error) return o;
  const p = o.place;
  if (['blocked', 'archived'].includes(p.moderation_status)) return { error: 'locked' };
  const v = validatePlace(patch, { partial: true });
  if (v.error) return v;
  const f = v.fields;
  const sets = []; const args = [placeId];
  for (const [col, val] of Object.entries(f)) { args.push(val); sets.push(`${col} = $${args.length}`); }
  if (!sets.length) return { place: await placeView(p, { own: true }) };
  const sensitive = Object.keys(f).some((k) => SENSITIVE_PLACE.includes(k) && String(f[k]) !== String(p[k]));
  let to = null;
  if (sensitive && ['published', 'approved'].includes(p.moderation_status)) { to = 'pending'; args.push(to); sets.push(`moderation_status = $${args.length}`, 'submitted_at = now()'); }
  await query(`UPDATE blox_places SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  if (to) {
    const c = await pool.connect();
    try { await modEvent(c, 'place', placeId, profileId, 'developer', 'edited_recheck', p.moderation_status, to, 'Изменены данные, влияющие на запуск или содержимое'); } finally { c.release(); }
    await refreshAuto('place', placeId);
  }
  const { rows } = await query('SELECT * FROM blox_places WHERE id = $1', [placeId]);
  return { place: await placeView(rows[0], { own: true }), recheck: to ? true : undefined };
};

/** Архив вместо удаления: журналы решений сохраняются. */
export const archive = async (profileId, type, id) => {
  bust();
  const isGame = type === 'game';
  const o = isGame ? await loadOwnGame(profileId, id) : await loadOwnPlace(profileId, id);
  if (o.error) return o;
  const row = isGame ? o.game : o.place;
  if (row.moderation_status === 'blocked') return { error: 'locked' };
  const tbl = isGame ? 'blox_games' : 'blox_places';
  await query(`UPDATE ${tbl} SET moderation_status = 'archived', updated_at = now() WHERE id = $1`, [id]);
  const c = await pool.connect();
  try { await modEvent(c, type, id, profileId, 'developer', 'archived', row.moderation_status, 'archived'); } finally { c.release(); }
  return { ok: true };
};

/* ─── Автопроверки, отправка и публикация ──────────────────────────── */

export async function refreshAuto(type, id) {
  if (type === 'game') {
    const { rows } = await query('SELECT title, description, client_url, server_url FROM blox_games WHERE id = $1', [id]);
    if (!rows[0]) return [];
    const f = autoCheck({ title: rows[0].title, description: rows[0].description, urls: [rows[0].client_url, rows[0].server_url].filter(Boolean) });
    await query('UPDATE blox_games SET auto_findings = $2::jsonb WHERE id = $1', [id, JSON.stringify(f)]);
    return f;
  }
  const { rows } = await query('SELECT title, description, entry_path FROM blox_places WHERE id = $1', [id]);
  if (!rows[0]) return [];
  const f = autoCheck({ title: rows[0].title, description: rows[0].description });
  await query('UPDATE blox_places SET auto_findings = $2::jsonb WHERE id = $1', [id, JSON.stringify(f)]);
  return f;
}

const hasCover = async (ownerType, id) => (await imageIds(ownerType, id)).cover !== null;

/** Отправить игру или плейс на проверку. Состояние — только по правилам. */
export const submit = async (profileId, type, id) => {
  bust();
  const a = await activeDev(profileId);
  if (a.error) return a;
  const isGame = type === 'game';
  const o = isGame ? await loadOwnGame(profileId, id) : await loadOwnPlace(profileId, id);
  if (o.error) return o;
  const row = isGame ? o.game : o.place;
  if (!['draft', 'needs_changes', 'hidden', 'archived'].includes(row.moderation_status)) return { error: 'wrong_state' };
  const blockers = [];
  if (isGame) {
    if (String(row.title).length < 2) blockers.push('Укажите название.');
    if (String(row.description).trim().length < 30) blockers.push('Опишите игру (не короче 30 символов).');
    if (!row.client_url) blockers.push('Укажите адрес игры.');
    else if (row.conn_status !== 'ok') blockers.push('Проверка соединения не пройдена. Нажмите «Проверить соединение» и исправьте замечания.');
    if (!(await hasCover('game', id))) blockers.push('Загрузите обложку.');
  } else {
    if (String(row.description).trim().length < 10) blockers.push('Опишите плейс (не короче 10 символов).');
    if (!(await hasCover('place', id))) blockers.push('Загрузите обложку плейса.');
    const { rows: g } = await query('SELECT conn_status, client_url FROM blox_games WHERE id = $1', [row.game_id]);
    if (g[0]?.conn_status !== 'ok') blockers.push('Сначала настройте и проверьте соединение игры.');
  }
  if (blockers.length) return { error: 'not_ready', blockers };
  const findings = await refreshAuto(type, id);
  const tbl = isGame ? 'blox_games' : 'blox_places';
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rowCount } = await c.query(`UPDATE ${tbl} SET moderation_status = 'pending', moderation_reason = '', submitted_at = now(), updated_at = now() WHERE id = $1 AND moderation_status = $2`, [id, row.moderation_status]);
    if (!rowCount) { await c.query('ROLLBACK'); return { error: 'wrong_state' }; }
    await modEvent(c, type, id, profileId, 'developer', 'submitted', row.moderation_status, 'pending');
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return { ok: true, status: 'pending', autoFindings: findings };
};

/** Публикация разрешена только после одобрения модератором; разработчик не обходит. */
export const publish = async (profileId, type, id, on) => {
  bust();
  const isGame = type === 'game';
  const o = isGame ? await loadOwnGame(profileId, id) : await loadOwnPlace(profileId, id);
  if (o.error) return o;
  const row = isGame ? o.game : o.place;
  const tbl = isGame ? 'blox_games' : 'blox_places';
  const from = row.moderation_status;
  let to;
  if (on) {
    if (from !== 'approved') return { error: 'not_approved' };
    if (isGame) {
      if (row.conn_status !== 'ok') return { error: 'connection_failed' };
    }
    to = 'published';
  } else {
    if (from !== 'published') return { error: 'wrong_state' };
    to = 'approved';
  }
  await query(`UPDATE ${tbl} SET moderation_status = $2, ${to === 'published' ? 'published_at = COALESCE(published_at, now()),' : ''} updated_at = now() WHERE id = $1 AND moderation_status = $3`, [id, to, from]);
  const c = await pool.connect();
  try { await modEvent(c, type, id, profileId, 'developer', on ? 'published' : 'unpublished', from, to); } finally { c.release(); }
  return { ok: true, status: to };
};

/* ─── Модерация (сотрудники) ───────────────────────────────────────── */

const MOD_ACTIONS = {
  approve:         { to: 'approved',      needReason: false, from: ['pending', 'hidden'] },
  request_changes: { to: 'needs_changes', needReason: true,  from: ['pending', 'approved', 'published', 'hidden'] },
  hide:            { to: 'hidden',        needReason: true,  from: ['published', 'approved', 'pending'] },
  block:           { to: 'blocked',       needReason: true,  from: ['pending', 'approved', 'published', 'hidden', 'needs_changes'] },
  re_review:       { to: 'pending',       needReason: false, from: ['approved', 'published', 'hidden', 'blocked', 'needs_changes'] },
};

export const moderate = async (actorId, type, id, action, reason, { meta = {} } = {}) => {
  bust();
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  const isGame = type === 'game';
  if (!(isGame ? GAME_ID_RE : PLACE_ID_RE).test(String(id ?? ''))) return { error: 'not_found' };
  const spec = MOD_ACTIONS[action];
  if (!spec) return { error: 'bad_action' };
  const why = text(reason, 500);
  if (spec.needReason && why.length < 3) return { error: 'reason_required' };
  const tbl = isGame ? 'blox_games' : 'blox_places';
  const { rows } = await query(isGame
    ? 'SELECT id, moderation_status, developer_id FROM blox_games WHERE id = $1'
    : 'SELECT p.id, p.moderation_status, g.developer_id FROM blox_places p JOIN blox_games g ON g.id = p.game_id WHERE p.id = $1', [id]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  /* Свои игры сотрудник не проверяет: решение принимает другой человек. */
  if (row.developer_id === actorId) return { error: 'own_project' };
  if (!spec.from.includes(row.moderation_status)) return { error: 'wrong_state' };
  if (action === 'approve') {
    const { rows: g } = await query(isGame ? 'SELECT conn_status FROM blox_games WHERE id = $1' : 'SELECT g.conn_status FROM blox_places p JOIN blox_games g ON g.id = p.game_id WHERE p.id = $1', [id]);
    if (g[0]?.conn_status !== 'ok') return { error: 'connection_failed' };
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rowCount } = await c.query(
      `UPDATE ${tbl} SET moderation_status = $2, moderation_reason = $3, moderated_by = $4, moderated_at = now(), updated_at = now()
        WHERE id = $1 AND moderation_status = $5`, [id, spec.to, why, actorId, row.moderation_status]);
    if (!rowCount) { await c.query('ROLLBACK'); return { error: 'wrong_state' }; }
    await modEvent(c, type, id, actorId, 'staff', action, row.moderation_status, spec.to, why);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await logAdmin({ actorId, targetId: id, targetType: `blox_${type}`, type: `blox_${type}_${action}`, detail: `${row.moderation_status} → ${spec.to}${why ? ` · ${why}` : ''}`, meta });
  return { ok: true, status: spec.to };
};

export const moderationQueue = async (actorId, { status = 'pending', type = 'game', q } = {}) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  const st = STATUSES.includes(status) || status === 'all' ? status : 'pending';
  const args = []; const where = [];
  if (st !== 'all') { args.push(st); where.push(`x.moderation_status = $${args.length}`); }
  const needle = text(q, 60).toLowerCase();
  if (needle) { args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`); where.push(`lower(x.title) LIKE $${args.length} ESCAPE '\\'`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  if (type === 'place') {
    const { rows } = await query(`SELECT x.*, g.title AS game_title, g.developer_id, g.conn_status, d.display_name FROM blox_places x JOIN blox_games g ON g.id = x.game_id JOIN blox_developers d ON d.profile_id = g.developer_id ${w} ORDER BY x.submitted_at NULLS LAST, x.created_at LIMIT 100`, args);
    return { items: rows.map((r) => ({ id: r.id, type: 'place', title: r.title, gameTitle: r.game_title, developerName: r.display_name, status: r.moderation_status, connStatus: r.conn_status, submittedAt: iso(r.submitted_at), findings: r.auto_findings })) };
  }
  const { rows } = await query(`SELECT x.*, d.display_name FROM blox_games x JOIN blox_developers d ON d.profile_id = x.developer_id ${w} ORDER BY x.submitted_at NULLS LAST, x.created_at LIMIT 100`, args);
  return { items: rows.map((r) => ({ id: r.id, type: 'game', title: r.title, developerName: r.display_name, status: r.moderation_status, connStatus: r.conn_status, submittedAt: iso(r.submitted_at), findings: r.auto_findings, hosting: r.hosting_type })) };
};

export const moderationDetail = async (actorId, type, id) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  const isGame = type === 'game';
  if (isGame) {
    const g = await readGame(actorId, id);
    if (!g) return { error: 'not_found' };
    const { rows: ev } = await query(`SELECT action, from_status, to_status, reason, actor_role, created_at FROM blox_mod_events WHERE subject_type = 'game' AND subject_id = $1 ORDER BY id DESC LIMIT 100`, [id]);
    const { rows: rep } = await query(`SELECT count(*)::int AS n FROM blox_reports WHERE game_id = $1 AND status IN ('open','in_review')`, [id]);
    return { game: g, history: ev.map((e) => ({ action: e.action, from: e.from_status, to: e.to_status, reason: e.reason, by: e.actor_role, at: iso(e.created_at) })), openReports: rep[0].n, note: 'Автоматические проверки — подсказка модератору; отсутствие замечаний не означает, что содержимое проверено.' };
  }
  const { rows } = await query('SELECT * FROM blox_places WHERE id = $1', [id]);
  if (!rows[0]) return { error: 'not_found' };
  const { rows: ev } = await query(`SELECT action, from_status, to_status, reason, actor_role, created_at FROM blox_mod_events WHERE subject_type = 'place' AND subject_id = $1 ORDER BY id DESC LIMIT 100`, [id]);
  return { place: await placeView(rows[0], { own: true }), game: await readGame(actorId, rows[0].game_id), history: ev.map((e) => ({ action: e.action, from: e.from_status, to: e.to_status, reason: e.reason, by: e.actor_role, at: iso(e.created_at) })) };
};

export const myHistory = async (profileId, type, id) => {
  const o = type === 'game' ? await loadOwnGame(profileId, id) : await loadOwnPlace(profileId, id);
  if (o.error) return o;
  const { rows } = await query(`SELECT action, from_status, to_status, reason, actor_role, created_at FROM blox_mod_events WHERE subject_type = $1 AND subject_id = $2 ORDER BY id DESC LIMIT 100`, [type, id]);
  return { items: rows.map((e) => ({ action: e.action, from: e.from_status, to: e.to_status, reason: e.reason, by: e.actor_role, at: iso(e.created_at) })) };
};

/* ─── Избранное, история, запуск ───────────────────────────────────── */

export const setFavorite = async (userId, gameId, on) => {
  bust();
  const g = await readGame(userId, gameId);
  if (!g) return { error: 'not_found' };
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (on) {
      const { rowCount } = await c.query('INSERT INTO blox_favorites (user_id, game_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, gameId]);
      if (rowCount) await c.query('UPDATE blox_games SET favorites = favorites + 1 WHERE id = $1', [gameId]);
    } else {
      const { rowCount } = await c.query('DELETE FROM blox_favorites WHERE user_id = $1 AND game_id = $2', [userId, gameId]);
      if (rowCount) await c.query('UPDATE blox_games SET favorites = GREATEST(0, favorites - 1) WHERE id = $1', [gameId]);
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return { ok: true };
};

export const listFavorites = async (userId) => {
  const { rows } = await query(`${SELECT_GAME} JOIN blox_favorites f2 ON f2.game_id = g.id AND f2.user_id = $1 WHERE ${PUBLIC} ORDER BY f2.created_at DESC LIMIT 100`, [userId]);
  return Promise.all(rows.map((r) => gameView(r)));
};

export const listHistory = async (userId) => {
  const { rows } = await query(
    `SELECT DISTINCT ON (g.id) g.*, d.display_name AS developer_name, l.issued_at AS last_played,
            EXISTS (SELECT 1 FROM blox_favorites f WHERE f.game_id = g.id AND f.user_id = $1) AS favorite
       FROM blox_launches l JOIN blox_games g ON g.id = l.game_id JOIN blox_developers d ON d.profile_id = g.developer_id
      WHERE l.user_id = $1 AND ${PUBLIC} ORDER BY g.id, l.issued_at DESC`, [userId]);
  rows.sort((a, b) => new Date(b.last_played) - new Date(a.last_played));
  return Promise.all(rows.slice(0, 50).map(async (r) => ({ ...(await gameView(r)), lastPlayedAt: iso(r.last_played) })));
};

const tokenKey = () => crypto.createHash('sha256').update(`${config.encryptionKey || config.jwtSecret}:blox-launch:v1`).digest();
const b64 = (b) => Buffer.from(b).toString('base64url');
export const signLaunchToken = (payload) => {
  const body = b64(JSON.stringify(payload));
  return `bxl.${body}.${crypto.createHmac('sha256', tokenKey()).update(body).digest('base64url')}`;
};
export const readLaunchToken = (token) => {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== 'bxl') return null;
  const want = crypto.createHmac('sha256', tokenKey()).update(parts[1]).digest();
  const got = Buffer.from(parts[2], 'base64url');
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try { const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
};

export const playerIdFor = (gameId, userId) => `pl_${crypto.createHmac('sha256', tokenKey()).update(`${gameId}:${userId}`).digest('hex').slice(0, 24)}`;

/** Запуск плейса: выдаём короткоживущий токен, а адрес берём из базы, не из запроса. */
export const launchPlace = async (userId, placeId) => {
  bust();
  if (!PLACE_ID_RE.test(String(placeId ?? ''))) return { error: 'not_found' };
  const { rows } = await query(
    `SELECT p.*, g.client_url, g.id AS gid, g.title AS game_title FROM blox_places p
       JOIN blox_games g ON g.id = p.game_id JOIN blox_developers d ON d.profile_id = g.developer_id
      WHERE p.id = $1 AND p.moderation_status = 'published' AND ${PUBLIC} AND d.status = 'active'`, [placeId]);
  const p = rows[0];
  if (!p) return { error: 'not_found' };
  const per = await limit('launchesPerMinute');
  const { rows: recent } = await query(`SELECT count(*)::int AS n FROM blox_launches WHERE user_id = $1 AND issued_at > now() - interval '1 minute'`, [userId]);
  if (recent[0].n >= per) return { error: 'too_many_launches' };
  const ttl = (await limit('launchTokenTtlSec')) * 1000;
  const jti = crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + ttl;
  const token = signLaunchToken({ jti, uid: userId, gid: p.gid, pid: p.id, exp });
  const { rows: prof } = await query('SELECT name FROM profiles WHERE id = $1', [userId]);
  const first = await query('SELECT 1 FROM blox_launches WHERE user_id = $1 AND game_id = $2 LIMIT 1', [userId, p.gid]);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO blox_launches (user_id, game_id, place_id, jti, expires_at) VALUES ($1,$2,$3,$4,$5)', [userId, p.gid, p.id, jti, new Date(exp)]);
    await c.query('UPDATE blox_games SET launches = launches + 1, visitors = visitors + $2 WHERE id = $1', [p.gid, first.rowCount ? 0 : 1]);
    await c.query('UPDATE blox_places SET launches = launches + 1 WHERE id = $1', [p.id]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  const target = new URL(p.entry_path, p.client_url);
  const origin = new URL(p.client_url).origin;
  if (target.origin !== origin) return { error: 'bad_entry_path' };
  return {
    url: target.toString(), origin, token, expiresAt: new Date(exp).toISOString(),
    user: { displayName: prof[0]?.name ?? '', playerId: playerIdFor(p.gid, userId) },
    gameId: p.gid, placeId: p.id, gameTitle: p.game_title,
  };
};

/* ─── Отзывы ───────────────────────────────────────────────────────── */

const recalcRating = async (gameId) => {
  await query(
    `UPDATE blox_games g SET rating_avg = s.avg, rating_count = s.n FROM
       (SELECT avg(rating)::numeric(3,2) AS avg, count(*)::int AS n FROM blox_reviews WHERE game_id = $1 AND status = 'visible') s
      WHERE g.id = $1`, [gameId]);
};

export const listReviews = async (gameId, { limit: lim } = {}) => {
  const { rows } = await query(
    `SELECT r.id, r.rating, r.body, r.created_at, p.name FROM blox_reviews r JOIN profiles p ON p.id = r.user_id
      WHERE r.game_id = $1 AND r.status = 'visible' ORDER BY r.created_at DESC LIMIT $2`, [gameId, Math.min(Number(lim) || 30, 100)]);
  return rows.map((r) => ({ id: r.id, rating: r.rating, body: r.body, author: r.name, at: iso(r.created_at) }));
};

export const leaveReview = async (userId, gameId, { rating, body } = {}) => {
  bust();
  const g = await readGame(userId, gameId);
  if (!g) return { error: 'not_found' };
  if (g.developerId === userId) return { error: 'own_game' };
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return { error: 'bad_rating' };
  const textBody = text(body, 1000);
  /* Оценивать может тот, кто действительно запускал игру и успел
     поиграть: иначе отзывы можно писать, не открывая её. */
  const minPlay = await limit('reviewMinPlaySec');
  const { rows: first } = await query('SELECT min(issued_at) AS t FROM blox_launches WHERE user_id = $1 AND game_id = $2', [userId, gameId]);
  if (!first[0]?.t) return { error: 'play_first' };
  if (Date.now() - new Date(first[0].t).getTime() < minPlay * 1000) return { error: 'play_longer', retryAfter: Math.ceil(minPlay - (Date.now() - new Date(first[0].t).getTime()) / 1000) };
  const per = await limit('reviewsPerDay');
  const { rows: day } = await query(`SELECT count(*)::int AS n FROM blox_reviews WHERE user_id = $1 AND updated_at > now() - interval '24 hours'`, [userId]);
  if (day[0].n >= per) return { error: 'too_many_reviews' };
  const id = `brv-${generateId()}`;
  await query(
    `INSERT INTO blox_reviews (id, game_id, user_id, rating, body) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (game_id, user_id) DO UPDATE SET rating = $4, body = $5, status = 'visible', updated_at = now()`,
    [id, gameId, userId, r, textBody]);
  await recalcRating(gameId);
  return { ok: true };
};

export const hideReview = async (actorId, reviewId, reason, { meta = {} } = {}) => {
  bust();
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  if (!REVIEW_ID_RE.test(String(reviewId ?? ''))) return { error: 'not_found' };
  const why = text(reason, 300);
  if (why.length < 3) return { error: 'reason_required' };
  const { rows } = await query(`UPDATE blox_reviews SET status = 'hidden' WHERE id = $1 RETURNING game_id`, [reviewId]);
  if (!rows[0]) return { error: 'not_found' };
  await recalcRating(rows[0].game_id);
  await logAdmin({ actorId, targetId: reviewId, targetType: 'blox_review', type: 'blox_review_hide', detail: why, meta });
  return { ok: true };
};

/* ─── Профиль игрока ───────────────────────────────────────────────── */

export const myProfile = async (userId) => {
  const [{ rows: s }, { rows: p }] = await Promise.all([
    query(`SELECT (SELECT count(DISTINCT game_id)::int FROM blox_launches WHERE user_id = $1) AS played,
                  (SELECT count(*)::int FROM blox_favorites WHERE user_id = $1) AS favorites,
                  (SELECT count(*)::int FROM blox_reviews WHERE user_id = $1) AS reviews,
                  (SELECT count(*)::int FROM blox_purchases WHERE user_id = $1 AND status IN ('paid','fulfilled')) AS purchases`, [userId]),
    query('SELECT name FROM profiles WHERE id = $1', [userId]),
  ]);
  return { name: p[0]?.name ?? '', ...s[0] };
};

/* ─── Жалобы ───────────────────────────────────────────────────────── */

export const createReport = async (reporterId, input = {}) => {
  const targetType = ['game', 'place', 'developer', 'review'].includes(input.targetType) ? input.targetType : null;
  if (!targetType) return { error: 'bad_target' };
  const reason = String(input.reason ?? '');
  if (!REPORT_REASONS.includes(reason)) return { error: 'bad_reason' };
  const details = text(input.details, 1500);
  if (reason === 'other' && details.length < 5) return { error: 'details_required' };
  const targetId = String(input.targetId ?? '');
  let gameId = null; let developerId = null;
  if (targetType === 'game') {
    const g = await readGame(reporterId, targetId);
    if (!g || g.own) return { error: g?.own ? 'own_target' : 'not_found' };
    gameId = targetId; developerId = g.developerId;
  } else if (targetType === 'place') {
    const { rows } = await query('SELECT p.game_id, g.developer_id FROM blox_places p JOIN blox_games g ON g.id = p.game_id WHERE p.id = $1 AND p.moderation_status = $2', [targetId, 'published']);
    if (!rows[0]) return { error: 'not_found' };
    gameId = rows[0].game_id; developerId = rows[0].developer_id;
  } else if (targetType === 'developer') {
    const d = await devRow(targetId);
    if (!d) return { error: 'not_found' };
    developerId = targetId;
  } else {
    const { rows } = await query('SELECT r.game_id, g.developer_id, r.user_id FROM blox_reviews r JOIN blox_games g ON g.id = r.game_id WHERE r.id = $1', [targetId]);
    if (!rows[0]) return { error: 'not_found' };
    gameId = rows[0].game_id; developerId = rows[0].developer_id;
    if (rows[0].user_id === reporterId) return { error: 'own_target' };
  }
  if (developerId === reporterId) return { error: 'own_target' };
  const per = await limit('reportsPerDay');
  const { rows: day } = await query(`SELECT count(*)::int AS n FROM blox_reports WHERE reporter_id = $1 AND created_at > now() - interval '24 hours'`, [reporterId]);
  if (day[0].n >= per) return { error: 'too_many_reports' };
  // Приоритет растёт с тяжестью причины и с числом других открытых жалоб на тот же объект.
  const { rows: same } = await query(`SELECT count(*)::int AS n FROM blox_reports WHERE target_type = $1 AND target_id = $2 AND status IN ('open','in_review')`, [targetType, targetId]);
  const priority = Math.min(3, Math.max(REASON_PRIORITY[reason] ?? 1, same[0].n >= 3 ? 3 : same[0].n >= 1 ? 2 : 1));
  const id = `bpr-${generateId()}`;
  try {
    await query(
      `INSERT INTO blox_reports (id, reporter_id, target_type, target_id, game_id, developer_id, reason, details, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, reporterId, targetType, targetId, gameId, developerId, reason, details, priority]);
  } catch (err) { if (err?.code === '23505') return { error: 'already_reported' }; throw err; }
  await query('INSERT INTO blox_report_events (report_id, actor_id, action) VALUES ($1,$2,$3)', [id, reporterId, 'created']);
  return { ok: true, id, priority };
};

export const listReports = async (actorId, { status = 'open' } = {}) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  const args = []; let where = '';
  if (status !== 'all') { args.push(['open', 'in_review', 'upheld', 'dismissed'].includes(status) ? status : 'open'); where = 'WHERE r.status = $1'; }
  const { rows } = await query(
    `SELECT r.*, g.title AS game_title, d.display_name FROM blox_reports r
       LEFT JOIN blox_games g ON g.id = r.game_id LEFT JOIN blox_developers d ON d.profile_id = r.developer_id
       ${where} ORDER BY r.priority DESC, r.created_at LIMIT 100`, args);
  return { items: rows.map((r) => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, gameId: r.game_id, gameTitle: r.game_title, developerName: r.display_name, reason: r.reason, details: r.details, priority: r.priority, status: r.status, resolution: r.resolution, createdAt: iso(r.created_at) })) };
};

export const resolveReport = async (actorId, reportId, outcome, resolution, apply, { meta = {} } = {}) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  if (!REPORT_ID_RE.test(String(reportId ?? ''))) return { error: 'not_found' };
  if (!['in_review', 'upheld', 'dismissed'].includes(outcome)) return { error: 'bad_action' };
  const why = text(resolution, 500);
  if (outcome !== 'in_review' && why.length < 3) return { error: 'reason_required' };
  const { rows } = await query('SELECT * FROM blox_reports WHERE id = $1', [reportId]);
  const rep = rows[0];
  if (!rep) return { error: 'not_found' };
  /* Разработчик не закрывает жалобы на себя, даже будучи сотрудником. */
  if (rep.developer_id === actorId) return { error: 'own_target' };
  if (['upheld', 'dismissed'].includes(rep.status)) return { error: 'already_closed' };
  await query(`UPDATE blox_reports SET status = $2, resolution = $3, resolved_by = $4, resolved_at = CASE WHEN $2 = 'in_review' THEN NULL ELSE now() END WHERE id = $1`, [reportId, outcome, why, actorId]);
  await query('INSERT INTO blox_report_events (report_id, actor_id, action, comment) VALUES ($1,$2,$3,$4)', [reportId, actorId, outcome, why]);
  let applied = null;
  if (outcome === 'upheld') {
    if (['hide', 'block'].includes(apply) && (rep.target_type === 'game' || rep.target_type === 'place')) {
      applied = await moderate(actorId, rep.target_type, rep.target_id, apply, `По жалобе: ${why}`, { meta });
    } else if (apply === 'hide' && rep.target_type === 'review') {
      applied = await hideReview(actorId, rep.target_id, `По жалобе: ${why}`, { meta });
    }
  }
  await logAdmin({ actorId, targetId: reportId, targetType: 'blox_report', type: `blox_report_${outcome}`, detail: `${rep.target_type}:${rep.target_id} · ${why}`, meta });
  return { ok: true, applied };
};

export const reportsAboutMe = async (devId) => {
  const { rows } = await query(
    `SELECT id, target_type, target_id, reason, status, resolution, created_at FROM blox_reports WHERE developer_id = $1 ORDER BY created_at DESC LIMIT 50`, [devId]);
  return rows.map((r) => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, status: r.status, resolution: ['upheld', 'dismissed'].includes(r.status) ? r.resolution : '', at: iso(r.created_at) }));
};

/* ─── Апелляции ────────────────────────────────────────────────────── */

export const createAppeal = async (authorId, input = {}) => {
  const subjectType = ['game', 'place', 'developer'].includes(input.subjectType) ? input.subjectType : null;
  if (!subjectType) return { error: 'bad_target' };
  const subjectId = String(input.subjectId ?? '');
  const body = text(input.text, 2000);
  if (body.length < 10) return { error: 'text_required' };
  let decider = null;
  if (subjectType === 'developer') {
    if (subjectId !== authorId) return { error: 'not_found' };
    const d = await devRow(authorId);
    if (!d || d.status !== 'suspended') return { error: 'not_appealable' };
  } else {
    const o = subjectType === 'game' ? await loadOwnGame(authorId, subjectId) : await loadOwnPlace(authorId, subjectId);
    if (o.error) return o;
    const row = subjectType === 'game' ? o.game : o.place;
    if (!['blocked', 'hidden', 'needs_changes'].includes(row.moderation_status)) return { error: 'not_appealable' };
    decider = row.moderated_by ?? null;
  }
  const id = `bpa-${generateId()}`;
  try { await query(`INSERT INTO blox_appeals (id, author_id, subject_type, subject_id, text, original_decider) VALUES ($1,$2,$3,$4,$5,$6)`, [id, authorId, subjectType, subjectId, body, decider]); }
  catch (err) { if (err?.code === '23505') return { error: 'already_appealed' }; throw err; }
  return { ok: true, id };
};

export const myAppeals = async (authorId) => {
  const { rows } = await query(`SELECT id, subject_type, subject_id, text, status, decision, created_at FROM blox_appeals WHERE author_id = $1 ORDER BY created_at DESC LIMIT 50`, [authorId]);
  return rows.map((r) => ({ id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, text: r.text, status: r.status, decision: r.decision, at: iso(r.created_at) }));
};

export const listAppeals = async (actorId, { status = 'open' } = {}) => {
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  const args = []; let where = '';
  if (status !== 'all') { args.push(['open', 'accepted', 'rejected'].includes(status) ? status : 'open'); where = 'WHERE a.status = $1'; }
  const { rows } = await query(`SELECT a.*, d.display_name FROM blox_appeals a JOIN blox_developers d ON d.profile_id = a.author_id ${where} ORDER BY a.created_at LIMIT 100`, args);
  return { items: rows.map((r) => ({ id: r.id, authorId: r.author_id, developerName: r.display_name, subjectType: r.subject_type, subjectId: r.subject_id, text: r.text, status: r.status, decision: r.decision, originalDecider: r.original_decider, at: iso(r.created_at) })) };
};

export const decideAppeal = async (actorId, appealId, accept, decision, { meta = {} } = {}) => {
  bust();
  if (!(await isStaff(actorId))) return { error: 'not_allowed' };
  if (!APPEAL_ID_RE.test(String(appealId ?? ''))) return { error: 'not_found' };
  const why = text(decision, 500);
  if (why.length < 3) return { error: 'reason_required' };
  const { rows } = await query('SELECT * FROM blox_appeals WHERE id = $1', [appealId]);
  const ap = rows[0];
  if (!ap) return { error: 'not_found' };
  if (ap.author_id === actorId) return { error: 'own_target' };
  /* Повторно решение смотрит другой сотрудник — если он есть. Владелец
     системы (право blox) может решить сам, чтобы апелляция не зависла. */
  if (ap.original_decider && ap.original_decider === actorId && !(await isBloxAdmin(actorId))) return { error: 'different_moderator_required' };
  if (ap.status !== 'open') return { error: 'already_closed' };
  const { rowCount } = await query(`UPDATE blox_appeals SET status = $2, decision = $3, decided_by = $4, decided_at = now() WHERE id = $1 AND status = 'open'`, [appealId, accept ? 'accepted' : 'rejected', why, actorId]);
  if (!rowCount) return { error: 'already_closed' };
  if (accept) {
    if (ap.subject_type === 'developer') await query(`UPDATE blox_developers SET status = 'active', suspend_reason = '' WHERE profile_id = $1`, [ap.subject_id]);
    else {
      /* Принятая апелляция возвращает на повторную проверку, а не сразу в каталог. */
      const r = await moderate(actorId, ap.subject_type, ap.subject_id, 're_review', `Апелляция принята: ${why}`, { meta });
      if (r.error && r.error !== 'wrong_state') return r;
    }
  }
  await logAdmin({ actorId, targetId: appealId, targetType: 'blox_appeal', type: accept ? 'blox_appeal_accept' : 'blox_appeal_reject', detail: `${ap.subject_type}:${ap.subject_id} · ${why}`, meta });
  return { ok: true };
};

/* ─── Администрирование разработчиков ──────────────────────────────── */

export const listDevelopers = async (actorId) => {
  if (!(await isBloxAdmin(actorId))) return { error: 'not_allowed' };
  const { rows } = await query(
    `SELECT d.*, p.username, (SELECT count(*)::int FROM blox_games g WHERE g.developer_id = d.profile_id AND g.moderation_status <> 'archived') AS games,
            (SELECT count(*)::int FROM blox_reports r WHERE r.developer_id = d.profile_id AND r.status IN ('open','in_review')) AS open_reports
       FROM blox_developers d JOIN profiles p ON p.id = d.profile_id ORDER BY d.created_at DESC LIMIT 200`);
  return { items: rows.map((r) => ({ id: r.profile_id, username: r.username, displayName: r.display_name, status: r.status, trustLevel: r.trust_level, games: r.games, openReports: r.open_reports, suspendReason: r.suspend_reason, at: iso(r.created_at) })) };
};

export const setDeveloperState = async (actorId, devId, { status, trustLevel, reason } = {}, { meta = {} } = {}) => {
  bust();
  if (!(await isBloxAdmin(actorId))) return { error: 'not_allowed' };
  if (devId === actorId) return { error: 'own_target' };
  const d = await devRow(devId);
  if (!d) return { error: 'not_found' };
  const why = text(reason, 300);
  if (why.length < 3) return { error: 'reason_required' };
  if (status !== undefined) {
    if (!['active', 'suspended'].includes(status)) return { error: 'bad_value' };
    await query('UPDATE blox_developers SET status = $2, suspend_reason = $3 WHERE profile_id = $1', [devId, status, status === 'suspended' ? why : '']);
    if (status === 'suspended') {
      // Игры приостановленного разработчика уходят из каталога: каталог смотрит на статус разработчика.
      catalogCache.clear();
    }
  }
  if (trustLevel !== undefined) {
    if (!Number.isInteger(trustLevel) || trustLevel < 0 || trustLevel > 2) return { error: 'bad_value' };
    await query('UPDATE blox_developers SET trust_level = $2 WHERE profile_id = $1', [devId, trustLevel]);
  }
  await logAdmin({ actorId, targetId: devId, targetType: 'blox_developer', type: 'blox_developer_set', detail: `${JSON.stringify({ status, trustLevel })} · ${why}`, meta });
  return { ok: true };
};

export const listAllGames = async (actorId, { q } = {}) => {
  if (!(await isBloxAdmin(actorId))) return { error: 'not_allowed' };
  const args = []; let where = '';
  const needle = text(q, 60).toLowerCase();
  if (needle) { args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`); where = `WHERE g.search_text LIKE $1 ESCAPE '\\'`; }
  const { rows } = await query(
    `SELECT g.id, g.title, g.moderation_status, g.conn_status, g.conn_checked_at, g.conn_error, g.hosting_type, g.client_url, g.server_url, g.launches, g.created_at, d.display_name
       FROM blox_games g JOIN blox_developers d ON d.profile_id = g.developer_id ${where} ORDER BY g.created_at DESC LIMIT 200`, args);
  return { items: rows.map((r) => ({ id: r.id, title: r.title, status: r.moderation_status, connStatus: r.conn_status, checkedAt: iso(r.conn_checked_at), connError: r.conn_error, hosting: r.hosting_type, clientUrl: r.client_url, serverUrl: r.server_url, launches: r.launches, developerName: r.display_name, at: iso(r.created_at) })) };
};

/** Администратор запускает проверку чужого сервера (та же защита, что и у разработчика). */
export const adminProbe = async (actorId, gameId) => {
  if (!(await isBloxAdmin(actorId))) return { error: 'not_allowed' };
  if (!GAME_ID_RE.test(String(gameId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT * FROM blox_games WHERE id = $1', [gameId]);
  if (!rows[0]) return { error: 'not_found' };
  return probeGame(rows[0], { source: 'admin' });
};

/** Статистика для кабинета: только по своим играм. */
export const devStats = async (profileId) => {
  const { rows } = await query(
    `SELECT g.id, g.title, g.launches, g.visitors, g.favorites, g.rating_avg, g.rating_count,
            (SELECT count(*)::int FROM blox_launches l WHERE l.game_id = g.id AND l.issued_at > now() - interval '7 days') AS launches7,
            (SELECT count(*)::int FROM blox_purchases p WHERE p.game_id = g.id AND p.status IN ('paid','fulfilled')) AS purchases,
            (SELECT coalesce(sum(p.price_points),0)::int FROM blox_purchases p WHERE p.game_id = g.id AND p.status IN ('paid','fulfilled')) AS points,
            (SELECT count(*)::int FROM blox_reports r WHERE r.game_id = g.id) AS reports,
            (SELECT count(*)::int FROM blox_reports r WHERE r.game_id = g.id AND r.status = 'upheld') AS reports_upheld
       FROM blox_games g WHERE g.developer_id = $1 ORDER BY g.created_at DESC`, [profileId]);
  return { items: rows.map((r) => ({ id: r.id, title: r.title, launches: r.launches, launches7: r.launches7, visitors: r.visitors, favorites: r.favorites, rating: r.rating_avg == null ? null : Number(r.rating_avg), ratingCount: r.rating_count, purchases: r.purchases, points: r.points, reports: r.reports, reportsUpheld: r.reports_upheld })) };
};

/** Файлы: метаданные картинки (запись до файла, как у Market). */
export const addImage = async (profileId, ownerType, ownerId, kind) => {
  bust();
  const o = ownerType === 'game' ? await loadOwnGame(profileId, ownerId) : await loadOwnPlace(profileId, ownerId);
  if (o.error) return o;
  if (!['cover', 'shot'].includes(kind)) return { error: 'bad_kind' };
  const id = `bgi-${generateId()}`;
  const gameStatus = ownerType === 'game' ? o.game.moderation_status : o.place.moderation_status;
  if (['blocked', 'archived'].includes(gameStatus)) return { error: 'locked' };
  const { rows: cnt } = await query('SELECT count(*)::int AS n FROM blox_images WHERE owner_type = $1 AND owner_id = $2 AND kind = $3', [ownerType, ownerId, kind]);
  if (kind === 'shot' && cnt[0].n >= 8) return { error: 'too_many_images' };
  // Обложка одна: прежнюю заменяем, файл уберёт уборка сирот.
  let oldId = null;
  if (kind === 'cover') { const { rows: old } = await query('SELECT id FROM blox_images WHERE owner_type = $1 AND owner_id = $2 AND kind = $3', [ownerType, ownerId, kind]); oldId = old[0]?.id ?? null; }
  return { imageId: id, oldId, mimeSet: async (mime) => {
    await query('INSERT INTO blox_images (id, owner_type, owner_id, kind, mime, sort_order) VALUES ($1,$2,$3,$4,$5,$6)', [id, ownerType, ownerId, kind, mime, cnt[0].n]);
    if (oldId) await query('DELETE FROM blox_images WHERE id = $1', [oldId]);
  } };
};

export const readImage = async (viewerId, imageId) => {
  if (!IMAGE_ID_RE.test(String(imageId ?? ''))) return null;
  const { rows } = await query('SELECT * FROM blox_images WHERE id = $1', [imageId]);
  const im = rows[0];
  if (!im) return null;
  const gameId = im.owner_type === 'game' ? im.owner_id : (await query('SELECT game_id FROM blox_places WHERE id = $1', [im.owner_id])).rows[0]?.game_id;
  if (!gameId) return null;
  const g = await readGame(viewerId, gameId);
  return g ? { mime: im.mime } : null;
};

export const deleteImage = async (profileId, imageId) => {
  bust();
  if (!IMAGE_ID_RE.test(String(imageId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT * FROM blox_images WHERE id = $1', [imageId]);
  const im = rows[0];
  if (!im) return { error: 'not_found' };
  const o = im.owner_type === 'game' ? await loadOwnGame(profileId, im.owner_id) : await loadOwnPlace(profileId, im.owner_id);
  if (o.error) return o;
  await query('DELETE FROM blox_images WHERE id = $1', [imageId]);
  return { ok: true };
};

export const clearCatalogCache = () => catalogCache.clear();
