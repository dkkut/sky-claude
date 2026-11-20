/**
 * Sky Pets — «Конструктор питомцев» и модерация. Питомцы, скины, яйца и предметы создаются данными (без правки кода):
 *   черновик → на модерации → (на проверке) → одобрено → ОПУБЛИКОВАНО отдельным действием (или по расписанию / после события).
 * Права: pets_create (создатель: черновики, отправка), pets_moderate (решения), pets_publish (публикация, снятие, откат, события, экономика).
 * Автор не решает свой материал (кроме владельца сервиса); модератор не правит цены/экономику. Любое действие — в журнал.
 * Картинки: проверка по содержимому, перекодирование (spimg.mjs), хранение на диске (spstore.mjs) — файл не исполняется и не отдаётся как есть.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { inTx } from './gocore.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { scanBytes, humanReason } from './malware.mjs';
import { processImage } from './spimg.mjs';
import { savePetFile, openPetFile, petFileSize, removePetFile, validImageId } from './spstore.mjs';
import { CATEGORIES, RARITIES, SKILLS, ROOMS } from './spdata.mjs';
import { err, dropItemCache, names, ensureSeed } from './spcore.mjs';
import { tx } from './spfun.mjs';

const clean = (v, n) => Array.from(String(v ?? '')).filter((c) => c.charCodeAt(0) > 31 || c === '\n').join('').trim().slice(0, n);
const HEX = /^#[0-9a-fA-F]{6}$/;
const SHAPES = ['cat', 'dog', 'rabbit', 'bear', 'panda', 'fox', 'frog', 'bird', 'dragon', 'unicorn', 'blob', 'alien'];
const KINDS = ['food', 'toy', 'accessory', 'clothes', 'furniture', 'interior', 'decor', 'house', 'bed', 'bowl'];
const STATUSES = ['draft', 'pending', 'review', 'approved', 'rejected', 'needs_changes', 'published', 'archived'];
const TABLE = { species: 'sp_species', skin: 'sp_skins', egg: 'sp_eggs', item: 'sp_items' };
const EDITABLE_BY_AUTHOR = ['draft', 'needs_changes', 'rejected'];
const int = (v, a, b, d = 0) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };

export const rights = async (actor) => {
  const [create, moderate, publish, owner] = await Promise.all([can(actor, 'pets_create'), can(actor, 'pets_moderate'), can(actor, 'pets_publish'), isOwner(actor)]);
  return { create: create || owner, moderate: moderate || owner, publish: publish || owner, owner, any: create || moderate || publish || owner };
};

// ───────────────────────────── публикация по расписанию (лениво, без фоновых процессов) ─────────────────────────────
let lastDue = 0;
export const publishDue = async () => {
  if (Date.now() - lastDue < 30000) return; lastDue = Date.now();
  for (const t of Object.values(TABLE)) {
    const cond = t === 'sp_species' ? `(hold_event IS NULL OR EXISTS (SELECT 1 FROM sp_events e WHERE e.id = ${t}.hold_event AND e.starts_at <= now()))` : 'TRUE';
    await query(`UPDATE ${t} SET status='published', updated_at=now() WHERE status='approved' AND publish_at IS NOT NULL AND publish_at <= now() AND ${cond}`).catch(() => {});
  }
  dropItemCache();
};

// ───────────────────────────── картинки ─────────────────────────────
export const uploadImage = async (actor, buf, opts = {}) => {
  const r = await rights(actor); if (!r.create && !r.publish) return err('forbidden');
  const per = Number((await query(`SELECT count(*) AS n FROM sp_images WHERE author_id=$1 AND created_at > now() - interval '1 hour'`, [actor])).rows[0].n); if (per >= 40) return err('slow_down');
  const scan = await scanBytes(buf, { name: 'pet.png', service: 'pets' }); if (scan.verdict !== 'clean') return err(scan.unavailable ? 'scan_unavailable' : 'file_blocked', { message: humanReason(scan) });
  const p = processImage(buf, { opaqueOk: Boolean(opts.opaqueOk) }); if (p.error) return err(p.error, { hint: p.hint });
  const id = `pim-${crypto.randomUUID()}`; const sizes = [];
  for (const f of p.files) { const fid = f.name === 'thumb' ? `${id}-t` : id; const s = await savePetFile(fid, f.buf); if (s.error) { for (const x of sizes) await removePetFile(x.file); return err('storage_failed'); } sizes.push({ name: f.name, file: fid, w: f.w, h: f.h, bytes: f.buf.length }); }
  await query('INSERT INTO sp_images (id,author_id,mime,width,height,bytes,has_alpha,sizes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, actor, p.mime, p.width, p.height, p.files[0].buf.length, p.hasAlpha, JSON.stringify(sizes)]);
  return { ok: true, id, mime: p.mime, width: p.width, height: p.height, hasAlpha: p.hasAlpha, hasThumb: sizes.length > 1, warnings: p.warnings };
};
const imageVisible = async (viewer, img) => {
  if (img.author_id === viewer) return true; if ((await rights(viewer)).any) return true;
  const t = Object.values(TABLE).map((x) => `SELECT 1 FROM ${x} WHERE image_id = $1 AND status = 'published'`).join(' UNION ALL ');
  return (await query(t, [img.id])).rowCount > 0;
};
export const imageStream = async (viewer, id, thumb) => {
  const base = String(id).replace(/-t$/, ''); if (!validImageId(base)) return err('not_found');
  const img = (await query('SELECT * FROM sp_images WHERE id=$1', [base])).rows[0]; if (!img || !(await imageVisible(viewer, img))) return err('not_found');
  const fid = thumb && img.sizes.some((s) => s.name === 'thumb') ? `${base}-t` : base;
  try { const size = await petFileSize(fid); const stream = await openPetFile(fid); return { stream: stream.stream ?? stream, size, mime: img.mime }; } catch { return err('not_found'); }
};
const imageOk = async (actor, imageId, adminish) => { if (!imageId) return true; if (!validImageId(imageId)) return false; const r = (await query('SELECT author_id FROM sp_images WHERE id=$1', [imageId])).rows[0]; return Boolean(r) && (r.author_id === actor || adminish); };
const dropImageIfFree = async (imageId) => {
  if (!imageId) return; const used = (await query(Object.values(TABLE).map((x) => `SELECT 1 FROM ${x} WHERE image_id = $1`).join(' UNION ALL '), [imageId])).rowCount; if (used) return;
  const img = (await query('DELETE FROM sp_images WHERE id=$1 RETURNING sizes', [imageId])).rows[0]; for (const s of img?.sizes ?? []) await removePetFile(s.file);
};

// ───────────────────────────── проверка полей ─────────────────────────────
const cleanArt = (a) => { if (!a || typeof a !== 'object') return {}; const o = {}; if (SHAPES.includes(a.shape)) o.shape = a.shape; for (const k of ['c1', 'c2', 'c3']) if (HEX.test(a[k] ?? '')) o[k] = a[k]; if (typeof a.icon === 'string') o.icon = clean(a.icon, 20); if (Array.isArray(a.dots)) o.dots = a.dots.slice(0, 3).filter((x) => HEX.test(x)); return o; };
const cleanView = (v) => ({ scale: Math.max(0.5, Math.min(2, Number(v?.scale) || 1)), x: int(v?.x, -50, 50), y: int(v?.y, -50, 50), mask: v?.mask === 'round' ? 'round' : 'none' });
const cleanEffect = (e) => {
  if (!e || typeof e !== 'object') return {}; const o = {};
  for (const k of ['satiety', 'fun', 'health', 'xp']) if (e[k] != null) o[k] = int(e[k], 0, 100);
  if (SKILLS.includes(e.skill)) { o.skill = e.skill; if (e.skillXp != null) o.skillXp = int(e.skillXp, 0, 5); if (e.skillBonus != null) o.skillBonus = int(e.skillBonus, 0, 3); }
  for (const k of ['energyRegen', 'feedBonus']) if (e[k] != null) o[k] = Math.max(0, Math.min(k === 'energyRegen' ? 2 : 0.5, Number(e[k]) || 0));
  if (['head', 'neck', 'body'].includes(e.slot)) o.slot = e.slot; if (ROOMS.includes(e.room)) o.room = e.room; if (HEX.test(e.wall ?? '')) o.wall = e.wall; if (HEX.test(e.floor ?? '')) o.floor = e.floor; return o;
};
const common = (b) => ({ name: clean(b.name, 60), description: clean(b.description, 400) });
const fieldsFor = (subject, b, existing) => {
  const f = common(b); if (f.name.length < 2) return err('bad_name');
  if (b.rarity != null && !RARITIES.includes(b.rarity)) return err('bad_rarity');
  if (subject === 'species') {
    if (!CATEGORIES.includes(b.category ?? existing?.category)) return err('bad_category');
    return { ...f, category: b.category ?? existing.category, rarity: b.rarity ?? existing?.rarity ?? 'common', art: cleanArt(b.art), view: cleanView(b.view), max_level: int(b.maxLevel ?? existing?.max_level, 5, 100, 30), cost_coins: int(b.costCoins, 0, 1e6), season: b.season ? clean(b.season, 20) : null, exclusive: Boolean(b.exclusive), base_stats: { energy: int(b.startEnergy, 10, 100, 80), satiety: int(b.startSatiety, 10, 100, 80), health: int(b.startHealth, 30, 100, 100) } };
  }
  if (subject === 'skin') return { ...f, rarity: b.rarity ?? existing?.rarity ?? 'common', art: cleanArt(b.art), view: cleanView(b.view), price_coins: int(b.priceCoins, 0, 1e6), price_points: int(b.pricePoints, 0, 1e6), unlock_level: b.unlockLevel != null && b.unlockLevel !== '' ? int(b.unlockLevel, 1, 100) : null, season: b.season ? clean(b.season, 20) : null, limited_until: b.limitedUntil ? new Date(b.limitedUntil) : null, category: ['common', 'rare', 'epic', 'legendary', 'holiday', 'seasonal', 'exclusive'].includes(b.category) ? b.category : 'common' };
  if (subject === 'egg') return { ...f, kind: clean(b.kind, 20) || 'common', rarity: b.rarity ?? existing?.rarity ?? 'common', art: cleanArt(b.art), price_coins: int(b.priceCoins, 0, 1e6), price_points: int(b.pricePoints, 0, 1e6), hatch_seconds: int(b.hatchSeconds, 5, 604800, 600), interactions: int(b.interactions, 0, 20, 3), season: b.season ? clean(b.season, 20) : null, buyable: b.buyable !== false };
  if (!KINDS.includes(b.kind ?? existing?.kind)) return err('bad_kind');
  return { ...f, kind: b.kind ?? existing.kind, category: clean(b.category, 30), rarity: b.rarity ?? existing?.rarity ?? 'common', art: cleanArt(b.art), effect: cleanEffect(b.effect), price_coins: int(b.priceCoins, 0, 1e6), price_points: int(b.pricePoints, 0, 1e6), season: b.season ? clean(b.season, 20) : null, conditions: clean(b.conditions, 200), shop: b.shop !== false, giftable: b.giftable !== false };
};
const PREFIX = { species: 'spc', skin: 'skn', egg: 'egg', item: 'itm' };
const JSONF = ['art', 'view', 'base_stats', 'effect'];
const snapshotOf = async (c, subject, row) => { const drops = subject === 'egg' ? (await c.query('SELECT species_id, weight FROM sp_egg_drops WHERE egg_id=$1', [row.id])).rows : undefined; return { row, drops }; };
const saveVersion = async (c, subject, row) => c.query('INSERT INTO sp_versions (subject,subject_id,version,snapshot) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [subject, row.id, row.version, JSON.stringify(await snapshotOf(c, subject, row))]);
const slog = (c, subject, id, actor, action, reason = '') => c.query('INSERT INTO sp_mod_log (subject,subject_id,actor_id,action,reason) VALUES ($1,$2,$3,$4,$5)', [subject, id, actor, action, reason]);

// ───────────────────────────── создание и правка ─────────────────────────────
export const save = async (actor, subject, id, b) => {
  if (!TABLE[subject]) return err('bad_subject'); const r = await rights(actor); if (!r.create && !r.publish) return err('forbidden'); await ensureSeed();
  return tx(async (c) => {
    const t = TABLE[subject]; let row = null;
    if (id) { row = (await c.query(`SELECT * FROM ${t} WHERE id=$1 FOR UPDATE`, [id])).rows[0]; if (!row) return err('not_found'); }
    const mine = row && row.author_id === actor;
    if (row) {
      const draftEdit = mine && EDITABLE_BY_AUTHOR.includes(row.status); const adminEdit = r.publish;
      if (!draftEdit && !adminEdit) return err(mine ? 'not_editable' : 'forbidden', { status: row.status });
    }
    const f = fieldsFor(subject, b, row); if (f.error) return f;
    if (b.imageId !== undefined && !(await imageOk(actor, b.imageId || null, r.publish || r.moderate))) return err('bad_image');
    if (!r.publish && row && (f.price_coins !== undefined && f.price_coins !== row.price_coins)) { /* цену создатель правит только в своём черновике */ }
    const cols = { ...f, ...(b.imageId !== undefined ? { image_id: b.imageId || null } : {}) };
    for (const k of Object.keys(cols)) if (JSONF.includes(k)) cols[k] = JSON.stringify(cols[k]);
    if (subject === 'species' && b.evolvesTo !== undefined) { cols.evolves_to = b.evolvesTo || null; cols.evolve_level = b.evolveLevel ? int(b.evolveLevel, 2, 100) : null; }
    if (subject === 'skin') { const sp = (await c.query('SELECT 1 FROM sp_species WHERE id=$1', [row?.species_id ?? b.speciesId])).rowCount; if (!sp) return err('bad_species'); if (!row) cols.species_id = b.speciesId; }
    let out;
    if (!row) {
      const nid = `${PREFIX[subject]}-${crypto.randomUUID()}`; const keys = ['id', 'status', 'author_id', ...Object.keys(cols)]; const vals = [nid, 'draft', actor, ...Object.values(cols)];
      await c.query(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, vals); out = nid; await slog(c, subject, nid, actor, 'create');
    } else {
      if (row.status === 'published' || row.status === 'approved') await saveVersion(c, subject, row);
      const keys = Object.keys(cols); const bump = row.status === 'published' || row.status === 'approved';
      await c.query(`UPDATE ${t} SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')}${keys.length ? ',' : ''} version = version + ${bump ? 1 : 0}, updated_at = now() WHERE id=$1`, [id, ...Object.values(cols)]); out = id; await slog(c, subject, id, actor, 'edit');
      if (b.imageId !== undefined && row.image_id && row.image_id !== (b.imageId || null)) setImmediate(() => dropImageIfFree(row.image_id).catch(() => {}));
    }
    if (subject === 'egg' && Array.isArray(b.drops)) {
      const drops = b.drops.map((d) => ({ id: String(d.speciesId), w: int(d.weight, 1, 100000) })).filter((d) => d.id); if (drops.length > 40) return err('too_many_drops');
      const ok = (await c.query('SELECT id FROM sp_species WHERE id = ANY($1::text[])', [drops.map((d) => d.id)])).rows.map((x) => x.id); if (ok.length !== new Set(drops.map((d) => d.id)).size) return err('bad_species');
      await c.query('DELETE FROM sp_egg_drops WHERE egg_id=$1', [out]); for (const d of drops) await c.query('INSERT INTO sp_egg_drops (egg_id,species_id,weight) VALUES ($1,$2,$3) ON CONFLICT (egg_id,species_id) DO UPDATE SET weight=$3', [out, d.id, d.w]);
    }
    await logAdmin({ actorId: actor, targetId: out, targetType: 'pets', type: id ? 'pets_edit' : 'pets_create', detail: `${subject}` });
    return { ok: true, id: out };
  });
};

export const list = async (actor, subject, f = {}) => {
  if (!TABLE[subject]) return err('bad_subject'); const r = await rights(actor); if (!r.any) return err('forbidden'); await publishDue();
  const where = []; const vals = [];
  if (f.status && STATUSES.includes(f.status)) { vals.push(f.status); where.push(`status = $${vals.length}`); }
  if (!r.moderate && !r.publish) { vals.push(actor); where.push(`author_id = $${vals.length}`); }
  if (f.q) { vals.push(`%${String(f.q).slice(0, 40).replace(/[%_\\]/g, '\\$&')}%`); where.push(`name ILIKE $${vals.length}`); }
  const { rows } = await query(`SELECT * FROM ${TABLE[subject]} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (status='pending') DESC, updated_at DESC LIMIT 200`, vals);
  const nm = await names(rows.map((x) => x.author_id).filter(Boolean));
  return { items: rows.map((x) => ({ ...x, author: x.author_id ? nm[x.author_id] ?? { id: x.author_id } : null })) };
};
export const detail = async (actor, subject, id) => {
  if (!TABLE[subject]) return err('bad_subject'); const r = await rights(actor); if (!r.any) return err('forbidden');
  const row = (await query(`SELECT * FROM ${TABLE[subject]} WHERE id=$1`, [id])).rows[0]; if (!row) return err('not_found'); if (!r.moderate && !r.publish && row.author_id !== actor) return err('not_found');
  const log = (await query('SELECT l.id, l.actor_id, l.action, l.reason, l.created_at FROM sp_mod_log l WHERE subject=$1 AND subject_id=$2 ORDER BY id DESC LIMIT 60', [subject, id])).rows; const nm = await names(log.map((l) => l.actor_id));
  const versions = (await query('SELECT version, created_at FROM sp_versions WHERE subject=$1 AND subject_id=$2 ORDER BY version DESC', [subject, id])).rows;
  const drops = subject === 'egg' ? (await query('SELECT d.species_id, d.weight, s.name, s.status FROM sp_egg_drops d JOIN sp_species s ON s.id=d.species_id WHERE d.egg_id=$1 ORDER BY d.weight DESC', [id])).rows : undefined;
  const species = subject === 'skin' ? (await query('SELECT id,name,art,image_id,view FROM sp_species WHERE id=$1', [row.species_id])).rows[0] : undefined;
  return { item: row, drops, species, versions, log: log.map((l) => ({ ...l, actor: nm[l.actor_id] ?? null })), rights: r };
};

// ───────────────────────────── отправка, модерация, публикация ─────────────────────────────
const notifyAuthor = async (row, title, body, ref) => { if (row.author_id) await notifyGift(row.author_id, 'pets_moderation', title, body, ref).catch(() => {}); };
const readiness = async (c, subject, row) => {
  if (subject === 'egg') { const n = Number((await c.query('SELECT count(*) AS n FROM sp_egg_drops WHERE egg_id=$1', [row.id])).rows[0].n); if (!n) return 'no_drops'; return null; }
  const hasArt = row.image_id || (row.art && row.art.shape) || (row.art && Object.keys(row.art).length); return hasArt ? null : 'no_image';
};
export const submit = async (actor, subject, id) => {
  if (!TABLE[subject]) return err('bad_subject'); const r = await rights(actor); if (!r.create && !r.publish) return err('forbidden');
  const res = await tx(async (c) => {
    const row = (await c.query(`SELECT * FROM ${TABLE[subject]} WHERE id=$1 FOR UPDATE`, [id])).rows[0]; if (!row) return err('not_found');
    if (row.author_id !== actor && !r.publish) return err('forbidden'); if (!EDITABLE_BY_AUTHOR.includes(row.status)) return err('bad_state', { status: row.status });
    const bad = await readiness(c, subject, row); if (bad) return err(bad);
    await c.query(`UPDATE ${TABLE[subject]} SET status='pending', updated_at=now() WHERE id=$1`, [id]); await slog(c, subject, id, actor, 'submit');
    await logAdmin({ actorId: actor, targetId: id, targetType: 'pets', type: 'pets_submit', detail: subject }); return { ok: true, status: 'pending', name: row.name };
  });
  if (res.ok) void notifyStaff('pets_review', { title: 'Sky Pets: новый материал на модерации', body: `${{ species: 'Питомец', skin: 'Скин', egg: 'Яйцо', item: 'Предмет' }[subject]}: «${res.name}»`, dedupe: `${subject}:${id}`, except: actor });
  return res;
};
export const moderate = async (actor, subject, id, action, reason = '') => {
  if (!TABLE[subject]) return err('bad_subject'); const r = await rights(actor); if (!r.moderate) return err('forbidden'); const why = clean(reason, 500);
  if (['reject', 'return', 'request_info'].includes(action) && why.length < 5) return err('reason_required'); if (action === 'comment' && why.length < 2) return err('reason_required');
  const res = await tx(async (c) => {
    const row = (await c.query(`SELECT * FROM ${TABLE[subject]} WHERE id=$1 FOR UPDATE`, [id])).rows[0]; if (!row) return err('not_found');
    if (row.author_id === actor && !r.owner && action !== 'comment') return err('self_review');
    const t = TABLE[subject]; const st = row.status; const set = async (s) => c.query(`UPDATE ${t} SET status=$2, updated_at=now() WHERE id=$1`, [id, s]);
    if (action === 'take') { if (st !== 'pending') return err('bad_state', { status: st }); await set('review'); }
    else if (action === 'approve') { if (!['pending', 'review'].includes(st)) return err('bad_state', { status: st }); await set('approved'); }
    else if (action === 'reject') { if (!['pending', 'review'].includes(st)) return err('bad_state', { status: st }); await set('rejected'); }
    else if (action === 'return') { if (!['pending', 'review'].includes(st)) return err('bad_state', { status: st }); await set('needs_changes'); }
    else if (action === 'request_info' || action === 'comment') { if (!['pending', 'review', 'needs_changes'].includes(st)) return err('bad_state', { status: st }); }
    else return err('bad_action');
    await slog(c, subject, id, actor, action, why); await logAdmin({ actorId: actor, targetId: id, targetType: 'pets', type: `pets_${action}`, detail: `${subject}: ${why}`.slice(0, 300) });
    return { ok: true, row };
  });
  if (!res.ok) return res;
  const T = { approve: ['Материал одобрен', 'Он ждёт публикации администратором.'], reject: ['Материал отклонён', why], return: ['Нужны исправления', why], request_info: ['Вопрос модератора', why], comment: ['Комментарий модератора', why] }[action];
  if (T && action !== 'take') await notifyAuthor(res.row, `Sky Pets: ${T[0]} — «${res.row.name}»`, T[1], id);
  return { ok: true };
};
export const publish = async (actor, subject, id, b = {}) => {
  if (!TABLE[subject]) return err('bad_subject'); const r = await rights(actor); if (!r.publish) return err('forbidden');
  const at = b.at ? new Date(b.at) : null; if (at && (Number.isNaN(at.getTime()) || at.getTime() < Date.now() - 60000)) return err('bad_time');
  const hold = b.holdEvent ? String(b.holdEvent) : null; if (hold && subject === 'species' && !(await query('SELECT 1 FROM sp_events WHERE id=$1', [hold])).rowCount) return err('bad_event');
  const res = await tx(async (c) => {
    const t = TABLE[subject]; const row = (await c.query(`SELECT * FROM ${t} WHERE id=$1 FOR UPDATE`, [id])).rows[0]; if (!row) return err('not_found');
    if (!['approved', 'archived'].includes(row.status)) return err('not_approved', { status: row.status });
    const later = (at && at.getTime() > Date.now() + 1000) || hold;
    if (later) { await c.query(`UPDATE ${t} SET publish_at=$2, ${t === 'sp_species' ? 'hold_event=$3,' : ''} status='approved', updated_at=now() WHERE id=$1`, t === 'sp_species' ? [id, at ?? new Date(), hold] : [id, at]); await slog(c, subject, id, actor, 'schedule', `${at?.toISOString() ?? ''} ${hold ?? ''}`.trim()); }
    else { await saveVersion(c, subject, row); await c.query(`UPDATE ${t} SET status='published', publish_at=NULL, ${t === 'sp_species' ? 'hold_event=NULL,' : ''} updated_at=now() WHERE id=$1`, [id]); await slog(c, subject, id, actor, 'publish'); }
    await logAdmin({ actorId: actor, targetId: id, targetType: 'pets', type: later ? 'pets_schedule' : 'pets_publish', detail: subject }); return { ok: true, scheduled: Boolean(later), row };
  });
  if (res.ok && !res.scheduled) { dropItemCache(); await notifyAuthor(res.row, `Sky Pets: «${res.row.name}» опубликован`, 'Материал стал доступен всем.', id); }
  return res.ok ? { ok: true, scheduled: res.scheduled } : res;
};
export const unpublish = async (actor, subject, id, reason) => {
  if (!TABLE[subject]) return err('bad_subject'); const r = await rights(actor); if (!r.publish) return err('forbidden'); const why = clean(reason, 300); if (why.length < 5) return err('reason_required');
  const res = await tx(async (c) => { const t = TABLE[subject]; const row = (await c.query(`UPDATE ${t} SET status='archived', updated_at=now() WHERE id=$1 AND status IN ('published','approved') RETURNING *`, [id])).rows[0]; if (!row) return err('bad_state'); await slog(c, subject, id, actor, 'unpublish', why); await logAdmin({ actorId: actor, targetId: id, targetType: 'pets', type: 'pets_unpublish', detail: `${subject}: ${why}` }); return { ok: true, row }; });
  if (res.ok) { dropItemCache(); await notifyAuthor(res.row, `Sky Pets: «${res.row.name}» снят с публикации`, why, id); } return res.ok ? { ok: true } : res;
};
export const restoreVersion = async (actor, subject, id, version) => {
  if (!TABLE[subject]) return err('bad_subject'); const r = await rights(actor); if (!r.publish) return err('forbidden');
  return tx(async (c) => {
    const t = TABLE[subject]; const row = (await c.query(`SELECT * FROM ${t} WHERE id=$1 FOR UPDATE`, [id])).rows[0]; if (!row) return err('not_found');
    const v = (await c.query('SELECT snapshot FROM sp_versions WHERE subject=$1 AND subject_id=$2 AND version=$3', [subject, id, int(version, 1, 1e6)])).rows[0]; if (!v) return err('version_not_found');
    await saveVersion(c, subject, row); const snap = v.snapshot.row; const skip = new Set(['id', 'status', 'author_id', 'version', 'created_at', 'updated_at', 'builtin', 'publish_at', 'hold_event']); const keys = Object.keys(snap).filter((k) => !skip.has(k));
    await c.query(`UPDATE ${t} SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')}, version = version + 1, updated_at = now() WHERE id=$1`, [id, ...keys.map((k) => (JSONF.includes(k) ? JSON.stringify(snap[k]) : snap[k]))]);
    if (subject === 'egg' && v.snapshot.drops) { await c.query('DELETE FROM sp_egg_drops WHERE egg_id=$1', [id]); for (const d of v.snapshot.drops) await c.query('INSERT INTO sp_egg_drops (egg_id,species_id,weight) VALUES ($1,$2,$3)', [id, d.species_id, d.weight]); }
    await slog(c, subject, id, actor, 'restore', `v${version}`); await logAdmin({ actorId: actor, targetId: id, targetType: 'pets', type: 'pets_restore', detail: `${subject} v${version}` }); dropItemCache(); return { ok: true };
  });
};

// ───────────────────────────── события и задания (экономика — только pets_publish) ─────────────────────────────
export const saveEvent = async (actor, id, b) => {
  const r = await rights(actor); if (!r.publish) return err('forbidden'); const title = clean(b.title, 80); if (title.length < 3) return err('bad_title');
  const s = new Date(b.startsAt), e = new Date(b.endsAt); if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return err('bad_time');
  const kind = ['collection', 'tournament', 'contest', 'holiday', 'season'].includes(b.kind) ? b.kind : 'contest'; const metric = ['actions', 'xp'].includes(b.metric) ? b.metric : 'actions';
  const rw = (x) => ({ coins: int(x?.coins, 0, 1e6), items: x?.items && typeof x.items === 'object' ? Object.fromEntries(Object.entries(x.items).slice(0, 10).map(([k, v]) => [String(k), int(v, 1, 99)])) : {}, eggs: x?.eggs && typeof x.eggs === 'object' ? Object.fromEntries(Object.entries(x.eggs).slice(0, 5).map(([k, v]) => [String(k), int(v, 1, 9)])) : {} });
  const reward = { participation: rw(b.reward?.participation), top: Array.isArray(b.reward?.top) ? b.reward.top.slice(0, 3).map(rw) : [] };
  const nid = id || `pev-${crypto.randomUUID()}`;
  await query(`INSERT INTO sp_events (id,title,description,kind,starts_at,ends_at,reward,metric,active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (id) DO UPDATE SET title=$2, description=$3, kind=$4, starts_at=$5, ends_at=$6, reward=$7, metric=$8, active=$9`, [nid, title, clean(b.description, 400), kind, s, e, JSON.stringify(reward), metric, b.active !== false, actor]);
  await logAdmin({ actorId: actor, targetId: nid, targetType: 'pets', type: 'pets_event', detail: title }); return { ok: true, id: nid };
};
export const listEvents = async (actor) => { const r = await rights(actor); if (!r.any) return err('forbidden'); return { events: (await query('SELECT * FROM sp_events ORDER BY starts_at DESC LIMIT 100')).rows }; };
export const saveTask = async (actor, id, b) => {
  const r = await rights(actor); if (!r.publish) return err('forbidden'); const title = clean(b.title, 100); if (title.length < 3) return err('bad_title');
  const kind = ['daily', 'weekly', 'joint', 'seasonal', 'holiday', 'event'].includes(b.kind) ? b.kind : 'daily'; const action = ['feed', 'play', 'bathe', 'walk', 'teach', 'sleep', 'heal', 'photo', 'any', 'joint'].includes(b.action) ? b.action : 'any';
  const reward = { coins: int(b.reward?.coins, 0, 1e5), items: b.reward?.items ?? {}, eggs: b.reward?.eggs ?? {} }; const nid = id || `ptk-${crypto.randomUUID()}`;
  await query(`INSERT INTO sp_tasks (id,title,kind,action,target,reward,event_id,active,starts_at,ends_at,sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,50)
    ON CONFLICT (id) DO UPDATE SET title=$2, kind=$3, action=$4, target=$5, reward=$6, event_id=$7, active=$8, starts_at=$9, ends_at=$10`, [nid, title, kind, action, int(b.target, 1, 1000, 1), JSON.stringify(reward), b.eventId || null, b.active !== false, b.startsAt ? new Date(b.startsAt) : null, b.endsAt ? new Date(b.endsAt) : null]);
  await logAdmin({ actorId: actor, targetId: nid, targetType: 'pets', type: 'pets_task', detail: title }); return { ok: true, id: nid };
};
export const listTasks = async (actor) => { const r = await rights(actor); if (!r.any) return err('forbidden'); return { tasks: (await query('SELECT * FROM sp_tasks ORDER BY sort, id')).rows }; };
export const overviewAdmin = async (actor) => {
  const r = await rights(actor); if (!r.any) return err('forbidden'); const out = { rights: r, pending: {} };
  for (const [k, t] of Object.entries(TABLE)) out.pending[k] = Number((await query(`SELECT count(*) AS n FROM ${t} WHERE status IN ('pending','review')`)).rows[0].n);
  out.players = Number((await query('SELECT count(*) AS n FROM sp_players')).rows[0].n); out.pets = Number((await query('SELECT count(*) AS n FROM sp_pets WHERE deleted_at IS NULL')).rows[0].n); return out;
};
export const meta = { CATEGORIES, RARITIES, SKILLS, ROOMS, SHAPES, KINDS, STATUSES };
