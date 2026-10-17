/**
 * Карточки музыкантов (модуль 10, ноябрь-2026).
 *
 * Карточка — страница исполнителя в каталоге Sky Music, которой не нужен профиль-артист. Откуда берётся:
 *  • автоматически: при отправке трека на публикацию сервер находит карточку по нормализованному имени или заводит новую (`auto_created`);
 *  • по предложению: форма загрузки спрашивает «У исполнителя нет карточки — создать?» (`suggest` → `createCard`); создать может тот,
 *    у кого есть собственный трек с таким исполнителем — выдуманные имена «про запас» не занять.
 * Создание карточки владения не даёт: владелец появляется только после заявки (`claim`) и решения сотрудника (право `content`).
 * Дубли («Zemfira» / «Земфира») находит `duplicates`, объединяет `merge` (всё переносится, перенос записан и обратим, а старое имя
 * становится псевдонимом для голосового поиска).
 */
import crypto from 'node:crypto';
import { notifyStaff } from './staffnotify.mjs';
import { query, pool } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { norm, translit, similarity } from './musicvoice.mjs';

const MAX_NAME = 120; const MAX_BIO = 2000; const MAX_NOTE = 1500; const MAX_REASON = 500;
const newId = (p) => `${p}-${crypto.randomUUID()}`;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const log = (cardId, event, actor, detail) => query('INSERT INTO music_artist_card_log (card_id, event, actor_id, detail) VALUES ($1,$2,$3,$4)', [cardId, event, actor ?? null, detail ? JSON.stringify(detail) : null]);

const view = (c, extra = {}) => ({
  id: c.id, name: c.name, bio: c.bio ? decryptContent(c.bio) ?? undefined : undefined, genres: c.genres ? c.genres.split(',').filter(Boolean) : [],
  autoCreated: c.auto_created === true, confirmedOwner: Boolean(c.owner_id), ownerId: c.owner_id ?? undefined, tracks: Number(c.tracks ?? 0), ...extra,
});

const COUNT = `(SELECT count(*) FROM music_tracks t WHERE t.artist_card_id = c.id AND t.status = 'published') AS tracks`;

/** Живая карточка по имени (точное совпадение нормализованного имени). */
export const findLive = async (name) => (await query('SELECT * FROM music_artist_cards WHERE name_norm = $1 AND merged_into IS NULL AND NOT hidden', [norm(name)])).rows[0] ?? null;

/** Следуем по цепочке объединений до живой карточки. */
const resolve = async (id) => {
  let cur = String(id ?? ''); 
  for (let i = 0; i < 6; i += 1) {
    const r = (await query(`SELECT *, ${COUNT} FROM music_artist_cards c WHERE c.id = $1`, [cur])).rows[0];
    if (!r) return null;
    if (!r.merged_into) return r.hidden ? null : r;
    cur = r.merged_into;
  }
  return null;
};

/* ─── Автопредложение и создание ───────────────────────────────────── */

export const suggest = async (name) => {
  const n = norm(name);
  if (!n) return { exact: null, similar: [], canCreate: false };
  const exact = await findLive(name);
  const { rows } = await query(`SELECT c.*, ${COUNT} FROM music_artist_cards c WHERE c.merged_into IS NULL AND NOT c.hidden LIMIT 5000`);
  const similar = rows.filter((c) => c.id !== exact?.id)
    .map((c) => ({ c, s: similarity(name, c.name) })).filter((x) => x.s >= 0.8).sort((a, b) => b.s - a.s).slice(0, 5)
    .map(({ c, s }) => ({ ...view(c), match: Math.round(s * 100) / 100 }));
  const exactRow = exact ? (await resolve(exact.id)) : null;
  return { exact: exactRow ? view(exactRow) : null, similar, canCreate: !exact };
};

const linkTracks = async (cardId, name, ownerId) => {
  // Привязываем только то, что можно привязать честно: свои треки владельца и опубликованные с тем же именем.
  const n = norm(name);
  const { rows } = await query(
    `SELECT id, artist FROM music_tracks WHERE artist_card_id IS NULL AND (owner_id = $1 OR status = 'published')`, [ownerId ?? '']);
  const ids = rows.filter((r) => norm(r.artist) === n).map((r) => r.id);
  if (ids.length) await query('UPDATE music_tracks SET artist_card_id = $1 WHERE id = ANY($2)', [cardId, ids]);
  return ids.length;
};

export const createCard = async (profileId, { name, bio, genres } = {}) => {
  const nm = clean(name, MAX_NAME);
  if (nm.length < 2) return { error: 'invalid_name' };
  const own = (await query('SELECT artist FROM music_tracks WHERE owner_id = $1', [profileId])).rows.some((r) => norm(r.artist) === norm(nm));
  if (!own) return { error: 'no_own_track' };
  if (await findLive(nm)) return { error: 'exists' };
  const id = newId('acd');
  const b = clean(bio, MAX_BIO);
  try {
    await query(`INSERT INTO music_artist_cards (id, name, name_norm, bio, genres, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, nm, norm(nm), b ? encryptContent(b) : null, (Array.isArray(genres) ? genres : []).map((g) => clean(g, 40)).filter(Boolean).slice(0, 5).join(','), profileId]);
  } catch (e) { if (e.code === '23505') return { error: 'exists' }; throw e; }
  await log(id, 'created', profileId);
  const linked = await linkTracks(id, nm, profileId);
  return { ok: true, id, linked };
};

/** При отправке трека на публикацию: гарантируем карточку и связь. Сбой не должен ломать публикацию. */
export const ensureCardForTrack = async (trackId) => {
  try {
    const t = (await query('SELECT id, artist, owner_id, artist_card_id FROM music_tracks WHERE id = $1', [trackId])).rows[0];
    if (!t || t.artist_card_id) return;
    let card = await findLive(t.artist);
    if (!card) {
      const id = newId('acd');
      try { await query(`INSERT INTO music_artist_cards (id, name, name_norm, auto_created, created_by) VALUES ($1,$2,$3,TRUE,$4)`, [id, clean(t.artist, MAX_NAME), norm(t.artist), t.owner_id]); await log(id, 'auto_created', t.owner_id); card = { id }; }
      catch (e) { if (e.code === '23505') card = await findLive(t.artist); else throw e; }
    }
    if (card) await query('UPDATE music_tracks SET artist_card_id = $1 WHERE id = $2', [card.id, trackId]);
  } catch { /* карточка — украшение каталога, а не условие публикации */ }
};

/* ─── Чтение ───────────────────────────────────────────────────────── */

export const readCard = async (id, viewerId) => {
  const c = await resolve(id);
  if (!c) return null;
  const tracks = (await query(`SELECT id, title, album, duration_sec, plays FROM music_tracks WHERE artist_card_id = $1 AND status = 'published' ORDER BY plays DESC, created_at DESC LIMIT 100`, [c.id])).rows
    .map((t) => ({ id: t.id, title: t.title, album: t.album || undefined, duration: t.duration_sec, plays: Number(t.plays) }));
  const claim = viewerId ? (await query(`SELECT status FROM music_artist_claims WHERE card_id=$1 AND claimant_id=$2 ORDER BY created_at DESC LIMIT 1`, [c.id, viewerId])).rows[0] : null;
  const mineTracks = viewerId ? Number((await query(`SELECT count(*) AS n FROM music_tracks WHERE artist_card_id=$1 AND owner_id=$2`, [c.id, viewerId])).rows[0].n) : 0;
  return view(c, { trackList: tracks, isOwner: c.owner_id === viewerId, myClaim: claim?.status, canClaim: !c.owner_id && mineTracks > 0 && claim?.status !== 'pending', redirectedFrom: String(id) !== c.id ? String(id) : undefined });
};

/** Карточка по имени (для страницы исполнителя, открытой из строки трека). */
export const readCardByName = async (name, viewerId) => {
  const c = await findLive(name);
  return c ? readCard(c.id, viewerId) : null;
};

export const listCards = async ({ q, limit } = {}) => {
  const args = [Math.min(100, Math.max(1, Number(limit) || 40))]; let where = 'c.merged_into IS NULL AND NOT c.hidden';
  const needle = norm(q);
  if (needle) { args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`); where += ` AND c.name_norm LIKE $2 ESCAPE '\\'`; }
  const { rows } = await query(`SELECT c.*, ${COUNT} FROM music_artist_cards c WHERE ${where} ORDER BY 1 = 1, (SELECT count(*) FROM music_tracks t WHERE t.artist_card_id = c.id AND t.status='published') DESC, c.name LIMIT $1`, args);
  return rows.filter((r) => Number(r.tracks) > 0 || needle).map((r) => view(r));
};

/** Владелец (подтверждённый) правит описание и жанры. */
export const updateCard = async (profileId, id, { bio, genres } = {}) => {
  const c = await resolve(id);
  if (!c) return { error: 'not_found' };
  if (c.owner_id !== profileId) return { error: 'not_allowed' };
  const sets = []; const args = [c.id];
  if (bio !== undefined) { const b = clean(bio, MAX_BIO); args.push(b ? encryptContent(b) : null); sets.push(`bio = $${args.length}`); }
  if (genres !== undefined) { args.push((Array.isArray(genres) ? genres : []).map((g) => clean(g, 40)).filter(Boolean).slice(0, 5).join(',')); sets.push(`genres = $${args.length}`); }
  if (!sets.length) return { ok: true };
  await query(`UPDATE music_artist_cards SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  await log(c.id, 'edited', profileId);
  return { ok: true };
};

/* ─── Подтверждение владения ───────────────────────────────────────── */

export const claim = async (profileId, cardId, { note, links } = {}) => {
  const c = await resolve(cardId);
  if (!c) return { error: 'not_found' };
  if (c.owner_id) return { error: c.owner_id === profileId ? 'already_owner' : 'already_owned' };
  const mine = Number((await query(`SELECT count(*) AS n FROM music_tracks WHERE artist_card_id=$1 AND owner_id=$2`, [c.id, profileId])).rows[0].n);
  if (!mine) return { error: 'no_own_track' };
  const text = clean(note, MAX_NOTE);
  if (text.length < 10) return { error: 'note_required' };
  const urls = (Array.isArray(links) ? links : []).map((l) => String(l).trim()).filter((l) => /^https:\/\/[^\s]{3,300}$/i.test(l)).slice(0, 5);
  const id = newId('clm');
  try { await query(`INSERT INTO music_artist_claims (id, card_id, claimant_id, note, links, status) VALUES ($1,$2,$3,$4,$5,'pending')`, [id, c.id, profileId, encryptContent(text), encryptContent(JSON.stringify(urls))]); }
  catch (e) { if (e.code === '23505') return { error: 'already_pending' }; throw e; }
  await log(c.id, 'claim_requested', profileId);
  void notifyStaff('artist_claim', { title: 'Заявка на карточку музыканта', body: 'Подтверждение владения ждёт решения.', dedupe: id, except: profileId });
  return { ok: true, id };
};

export const withdrawClaim = async (profileId, claimId) => {
  const { rowCount } = await query(`UPDATE music_artist_claims SET status='withdrawn' WHERE id=$1 AND claimant_id=$2 AND status='pending'`, [String(claimId ?? ''), profileId]);
  return rowCount ? { ok: true } : { error: 'not_found' };
};

/* ─── Сотрудники (право `content`) ─────────────────────────────────── */

export const adminClaims = async (adminId, { status = 'pending' } = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query(
    `SELECT m.*, c.name AS card_name, p.name AS claimant_name, p.username,
            (SELECT count(*) FROM music_tracks t WHERE t.artist_card_id = m.card_id AND t.owner_id = m.claimant_id)::int AS own_tracks
       FROM music_artist_claims m JOIN music_artist_cards c ON c.id = m.card_id JOIN profiles p ON p.id = m.claimant_id
      ${status === 'all' ? '' : 'WHERE m.status = $1'} ORDER BY m.created_at DESC LIMIT 100`, status === 'all' ? [] : [status]);
  return { items: rows.map((r) => ({
    id: r.id, cardId: r.card_id, cardName: r.card_name, claimant: `@${r.username}`, claimantName: r.claimant_name, claimantId: r.claimant_id, status: r.status, ownTracks: r.own_tracks,
    note: r.note ? decryptContent(r.note) ?? '' : '', links: r.links ? JSON.parse(decryptContent(r.links) ?? '[]') : [], reason: r.reason ? decryptContent(r.reason) ?? undefined : undefined,
    createdAt: r.created_at.toISOString() })) };
};

export const decideClaim = async (adminId, claimId, { approve, reason } = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const m = (await query('SELECT * FROM music_artist_claims WHERE id = $1', [String(claimId ?? '')])).rows[0];
  if (!m) return { error: 'not_found' };
  if (m.status !== 'pending') return { error: 'not_pending' };
  if (m.claimant_id === adminId) return { error: 'self_review' };
  const why = clean(reason, MAX_REASON);
  if (!approve && why.length < 5) return { error: 'reason_required' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (approve) {
      const upd = await client.query(`UPDATE music_artist_cards SET owner_id = $2, updated_at = now() WHERE id = $1 AND owner_id IS NULL`, [m.card_id, m.claimant_id]);
      if (!upd.rowCount) { await client.query('ROLLBACK'); return { error: 'already_owned' }; }
      await client.query(`UPDATE music_artist_claims SET status='rejected', decided_by=$2, decided_at=now(), reason=$3 WHERE card_id=$1 AND status='pending' AND id<>$4`, [m.card_id, adminId, encryptContent('Карточка передана другому заявителю'), claimId]);
    }
    await client.query(`UPDATE music_artist_claims SET status=$2, decided_by=$3, decided_at=now(), reason=$4 WHERE id=$1`, [claimId, approve ? 'approved' : 'rejected', adminId, why ? encryptContent(why) : null]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  await log(m.card_id, approve ? 'claim_approved' : 'claim_rejected', adminId, { claim: claimId, reason: why || undefined });
  await logAdmin({ actorId: adminId, targetId: m.claimant_id, type: approve ? 'artist_claim_approve' : 'artist_claim_reject', detail: `${m.card_id}${why ? ` — ${why}` : ''}` });
  await notifyGift(m.claimant_id, 'artist_card', approve ? 'Карточка музыканта подтверждена' : 'Заявка на карточку музыканта отклонена', approve ? 'Вы подтверждены как владелец карточки.' : why, m.card_id).catch(() => {});
  return { ok: true };
};

export const revokeOwner = async (adminId, cardId, reason) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const why = clean(reason, MAX_REASON);
  if (why.length < 5) return { error: 'reason_required' };
  const c = (await query('SELECT * FROM music_artist_cards WHERE id=$1', [String(cardId ?? '')])).rows[0];
  if (!c) return { error: 'not_found' };
  if (!c.owner_id) return { error: 'no_owner' };
  await query('UPDATE music_artist_cards SET owner_id = NULL, updated_at = now() WHERE id = $1', [cardId]);
  await query(`UPDATE music_artist_claims SET status='revoked', decided_by=$2, decided_at=now(), reason=$3 WHERE card_id=$1 AND status='approved'`, [cardId, adminId, encryptContent(why)]);
  await log(cardId, 'owner_revoked', adminId, { reason: why });
  await logAdmin({ actorId: adminId, targetId: c.owner_id, type: 'artist_owner_revoke', detail: `${cardId} — ${why}` });
  return { ok: true };
};

/** Похожие живые карточки: кандидаты в дубли для объединения. */
export const duplicates = async (adminId) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query(`SELECT c.*, ${COUNT} FROM music_artist_cards c WHERE c.merged_into IS NULL AND NOT c.hidden ORDER BY c.name LIMIT 3000`);
  const pairs = [];
  for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) {
    const a = rows[i]; const b = rows[j];
    const same = translit(a.name) === translit(b.name);
    const s = same ? 1 : similarity(a.name, b.name);
    if (s >= 0.86) pairs.push({ a: view(a), b: view(b), match: Math.round(s * 100) / 100, sameAfterTranslit: same });
    if (pairs.length >= 200) break;
  }
  return { pairs: pairs.sort((x, y) => y.match - x.match) };
};

/** Объединить дубль `from` в `into`: треки, псевдоним для поиска, запись для отката. */
export const merge = async (adminId, fromId, intoId, reason) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const why = clean(reason, MAX_REASON);
  if (why.length < 5) return { error: 'reason_required' };
  if (fromId === intoId) return { error: 'same_card' };
  const from = (await query('SELECT * FROM music_artist_cards WHERE id=$1', [String(fromId ?? '')])).rows[0];
  const into = (await query('SELECT * FROM music_artist_cards WHERE id=$1', [String(intoId ?? '')])).rows[0];
  if (!from || !into) return { error: 'not_found' };
  if (from.merged_into || into.merged_into) return { error: 'already_merged' };
  if (from.owner_id && into.owner_id && from.owner_id !== into.owner_id) return { error: 'owners_differ' };
  const client = await pool.connect(); let moved = [];
  try {
    await client.query('BEGIN');
    moved = (await client.query('SELECT id FROM music_tracks WHERE artist_card_id = $1', [fromId])).rows.map((r) => r.id);
    await client.query('UPDATE music_tracks SET artist_card_id = $1 WHERE artist_card_id = $2', [intoId, fromId]);
    // Освобождаем уникальное имя и закрываем старую карточку; владение переходит, если у принимающей его нет.
    await client.query('UPDATE music_artist_cards SET merged_into = $2, updated_at = now() WHERE id = $1', [fromId, intoId]);
    if (from.owner_id && !into.owner_id) await client.query('UPDATE music_artist_cards SET owner_id = $2 WHERE id = $1', [intoId, from.owner_id]);
    await client.query(`UPDATE music_artist_claims SET card_id = $2 WHERE card_id = $1 AND status = 'pending'`, [fromId, intoId]);
    await client.query(`INSERT INTO music_artist_aliases (alias_norm, artist_norm, created_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [from.name_norm, into.name_norm, adminId]);
    await client.query('INSERT INTO music_artist_card_log (card_id, event, actor_id, detail) VALUES ($1,$2,$3,$4)', [fromId, 'merged', adminId, JSON.stringify({ into: intoId, moved, ownerMoved: Boolean(from.owner_id && !into.owner_id), reason: why })]);
    await client.query('INSERT INTO music_artist_card_log (card_id, event, actor_id, detail) VALUES ($1,$2,$3,$4)', [intoId, 'merge_received', adminId, JSON.stringify({ from: fromId, moved })]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  await logAdmin({ actorId: adminId, targetType: 'content', type: 'artist_merge', detail: `${fromId} → ${intoId}, треков ${moved.length} — ${why}` });
  return { ok: true, moved: moved.length };
};

/** Откат объединения: возвращаем карточку и её треки. */
export const unmerge = async (adminId, cardId, reason) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const why = clean(reason, MAX_REASON);
  if (why.length < 5) return { error: 'reason_required' };
  const c = (await query('SELECT * FROM music_artist_cards WHERE id=$1', [String(cardId ?? '')])).rows[0];
  if (!c || !c.merged_into) return { error: 'not_merged' };
  const entry = (await query(`SELECT detail FROM music_artist_card_log WHERE card_id=$1 AND event='merged' ORDER BY id DESC LIMIT 1`, [cardId])).rows[0];
  const info = entry?.detail ? JSON.parse(entry.detail) : { moved: [] };
  if (await findLive(c.name)) return { error: 'name_taken' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE music_artist_cards SET merged_into = NULL, updated_at = now() WHERE id = $1', [cardId]);
    if (info.moved?.length) await client.query('UPDATE music_tracks SET artist_card_id = $1 WHERE id = ANY($2) AND artist_card_id = $3', [cardId, info.moved, c.merged_into]);
    await client.query('DELETE FROM music_artist_aliases WHERE alias_norm = $1', [c.name_norm]);
    await client.query('INSERT INTO music_artist_card_log (card_id, event, actor_id, detail) VALUES ($1,$2,$3,$4)', [cardId, 'unmerged', adminId, JSON.stringify({ reason: why })]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  await logAdmin({ actorId: adminId, targetType: 'content', type: 'artist_unmerge', detail: `${cardId} — ${why}` });
  return { ok: true };
};
