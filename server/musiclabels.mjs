/**
 * Лейблы, альбомы и подтверждение прав правообладателя (Sky Music).
 * Управляют: владелец сервиса (isOwner) — всем; владелец карточки музыканта — своей карточкой и её альбомами;
 * владелец лейбла — лейблом и его альбомами; создатель альбома — своим альбомом.
 * Подтверждение прав — ручное решение сотрудника (право `content`) по заявке; реестры правообладателей не сверяются.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { norm } from './musicvoice.mjs';

const newId = (p) => `${p}-${crypto.randomUUID()}`;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const err = (e) => ({ error: e });
const sealed = (t) => (t ? encryptContent(t) : null);
const open = (t) => (t ? decryptContent(t) ?? '' : '');

/* ── Права ── */
const canLabel = async (me, l) => l.owner_id === me || (await isOwner(me));
const cardOf = async (id) => (id ? (await query('SELECT * FROM music_artist_cards WHERE id=$1 AND merged_into IS NULL AND NOT hidden', [id])).rows[0] : null);
const labelOf = async (id) => (id ? (await query('SELECT * FROM music_labels WHERE id=$1 AND NOT hidden', [id])).rows[0] : null);
const canCard = async (me, c) => c.owner_id === me || (await isOwner(me));
const canAlbum = async (me, a) => {
  if (a.owner_id === me || (await isOwner(me))) return true;
  const c = await cardOf(a.card_id); if (c && c.owner_id === me) return true;
  const l = await labelOf(a.label_id); return Boolean(l && l.owner_id === me);
};

const labelView = (l, me) => ({ id: l.id, name: l.name, description: open(l.description) || undefined, ownerId: l.owner_id ?? undefined, isMine: l.owner_id === me,
  rightsVerified: Boolean(l.rights_verified_at), rightsHolder: l.rights_holder ?? undefined, albums: Number(l.albums ?? 0) });
const albumView = (a, me) => ({ id: a.id, title: a.title, year: a.year ?? undefined, description: open(a.description) || undefined, cardId: a.card_id ?? undefined, cardName: a.card_name ?? undefined,
  labelId: a.label_id ?? undefined, labelName: a.label_name ?? undefined, tracks: Number(a.tracks ?? 0), mine: a.owner_id === me });

/* ── Лейблы ── */
export const createLabel = async (me, { name, description } = {}) => {
  const nm = clean(name, 120); if (nm.length < 2) return err('name_required');
  const id = newId('lbl');
  try { await query('INSERT INTO music_labels (id, name, name_norm, description, owner_id) VALUES ($1,$2,$3,$4,$5)', [id, nm, norm(nm), sealed(clean(description, 2000)), me]); }
  catch (e) { if (e.code === '23505') return err('exists'); throw e; }
  return { ok: true, id };
};
export const updateLabel = async (me, id, { name, description } = {}) => {
  const l = await labelOf(id); if (!l) return err('not_found');
  if (!(await canLabel(me, l))) return err('not_allowed');
  const sets = []; const args = [l.id];
  if (name !== undefined) { const nm = clean(name, 120); if (nm.length < 2) return err('name_required'); args.push(nm, norm(nm)); sets.push(`name=$${args.length - 1}`, `name_norm=$${args.length}`); }
  if (description !== undefined) { args.push(sealed(clean(description, 2000))); sets.push(`description=$${args.length}`); }
  if (!sets.length) return { ok: true };
  try { await query(`UPDATE music_labels SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, args); } catch (e) { if (e.code === '23505') return err('exists'); throw e; }
  if (l.owner_id !== me) await logAdmin({ actorId: me, targetId: l.owner_id ?? me, type: 'music_label_edit', detail: l.id });
  return { ok: true };
};
export const listLabels = async (me, { q, mine } = {}) => {
  const args = [me]; let where = 'NOT l.hidden';
  where += mine ? ' AND l.owner_id = $1' : ' AND $1::text IS NOT NULL';
  const nq = norm(q); if (nq) { args.push(`%${nq.replace(/([\\%_])/g, '\\$1')}%`); where += ` AND l.name_norm LIKE $${args.length} ESCAPE '\\'`; }
  const { rows } = await query(`SELECT l.*, (SELECT count(*) FROM music_albums a WHERE a.label_id=l.id AND NOT a.hidden) AS albums FROM music_labels l WHERE ${where} ORDER BY l.name LIMIT 100`, args);
  return { labels: rows.map((r) => labelView(r, me)) };
};
export const deleteLabel = async (me, id) => {
  const l = await labelOf(id); if (!l) return err('not_found');
  if (!(await canLabel(me, l))) return err('not_allowed');
  await query('UPDATE music_labels SET hidden = TRUE, updated_at = now() WHERE id=$1', [l.id]);
  await query('UPDATE music_albums SET label_id = NULL WHERE label_id=$1', [l.id]);
  if (l.owner_id !== me) await logAdmin({ actorId: me, targetId: l.owner_id ?? me, type: 'music_label_delete', detail: l.id });
  return { ok: true };
};

/* ── Альбомы ── */
const ALB = `SELECT a.*, c.name AS card_name, l.name AS label_name, (SELECT count(*) FROM music_tracks t WHERE t.album_id=a.id) AS tracks
  FROM music_albums a LEFT JOIN music_artist_cards c ON c.id=a.card_id LEFT JOIN music_labels l ON l.id=a.label_id`;
export const listAlbums = async (me, { cardId, labelId, mine } = {}) => {
  const args = [me]; let where = 'NOT a.hidden AND $1::text IS NOT NULL';
  if (cardId) { args.push(cardId); where += ` AND a.card_id=$${args.length}`; }
  if (labelId) { args.push(labelId); where += ` AND a.label_id=$${args.length}`; }
  if (mine) where += ` AND (a.owner_id=$1 OR c.owner_id=$1 OR l.owner_id=$1)`;
  const { rows } = await query(`${ALB} WHERE ${where} ORDER BY a.year DESC NULLS LAST, a.title LIMIT 200`, args);
  return { albums: rows.map((r) => albumView(r, me)) };
};
export const readAlbum = async (me, id) => {
  const a = (await query(`${ALB} WHERE a.id=$1 AND NOT a.hidden`, [String(id ?? '')])).rows[0]; if (!a) return err('not_found');
  const tracks = (await query(`SELECT id, title, artist, duration_sec, status FROM music_tracks WHERE album_id=$1 AND (status='published' OR owner_id=$2) ORDER BY created_at`, [a.id, me])).rows
    .map((t) => ({ id: t.id, title: t.title, artist: t.artist, duration: t.duration_sec, status: t.status }));
  return { album: albumView(a, me), tracks, canEdit: await canAlbum(me, a) };
};
const checkLinks = async (me, cardId, labelId) => {
  if (cardId) { const c = await cardOf(cardId); if (!c) return err('card_not_found'); if (!(await canCard(me, c))) return err('card_not_yours'); }
  if (labelId) { const l = await labelOf(labelId); if (!l) return err('label_not_found'); if (!(await canLabel(me, l))) return err('label_not_yours'); }
  return null;
};
export const createAlbum = async (me, { title, year, description, cardId, labelId } = {}) => {
  const t = clean(title, 200); if (!t) return err('title_required');
  const y = year ? Number(year) : null; if (y !== null && !(y >= 1900 && y <= 2100)) return err('bad_year');
  const bad = await checkLinks(me, cardId || null, labelId || null); if (bad) return bad;
  const id = newId('alb');
  await query('INSERT INTO music_albums (id, title, year, description, card_id, label_id, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, t, y, sealed(clean(description, 2000)), cardId || null, labelId || null, me]);
  return { ok: true, id };
};
export const updateAlbum = async (me, id, p = {}) => {
  const a = (await query('SELECT * FROM music_albums WHERE id=$1 AND NOT hidden', [String(id ?? '')])).rows[0]; if (!a) return err('not_found');
  if (!(await canAlbum(me, a))) return err('not_allowed');
  const sets = []; const args = [a.id]; const put = (c, v) => { args.push(v); sets.push(`${c}=$${args.length}`); };
  if (p.title !== undefined) { const t = clean(p.title, 200); if (!t) return err('title_required'); put('title', t); }
  if (p.year !== undefined) { const y = p.year ? Number(p.year) : null; if (y !== null && !(y >= 1900 && y <= 2100)) return err('bad_year'); put('year', y); }
  if (p.description !== undefined) put('description', sealed(clean(p.description, 2000)));
  if (p.cardId !== undefined || p.labelId !== undefined) {
    const bad = await checkLinks(me, p.cardId !== undefined && p.cardId !== a.card_id ? p.cardId || null : null, p.labelId !== undefined && p.labelId !== a.label_id ? p.labelId || null : null); if (bad) return bad;
    if (p.cardId !== undefined) put('card_id', p.cardId || null);
    if (p.labelId !== undefined) put('label_id', p.labelId || null);
  }
  if (!sets.length) return { ok: true };
  await query(`UPDATE music_albums SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, args);
  if (p.title !== undefined) await query('UPDATE music_tracks SET album = $2 WHERE album_id = $1', [a.id, clean(p.title, 200)]);
  if (a.owner_id !== me) await logAdmin({ actorId: me, targetId: a.owner_id ?? me, type: 'music_album_edit', detail: a.id });
  return { ok: true };
};
export const deleteAlbum = async (me, id) => {
  const a = (await query('SELECT * FROM music_albums WHERE id=$1 AND NOT hidden', [String(id ?? '')])).rows[0]; if (!a) return err('not_found');
  if (!(await canAlbum(me, a))) return err('not_allowed');
  await query('UPDATE music_albums SET hidden = TRUE, updated_at = now() WHERE id=$1', [a.id]);
  await query('UPDATE music_tracks SET album_id = NULL WHERE album_id=$1', [a.id]);
  if (a.owner_id !== me) await logAdmin({ actorId: me, targetId: a.owner_id ?? me, type: 'music_album_delete', detail: a.id });
  return { ok: true };
};
/** Положить треки в альбом (или убрать, albumId = null). Трек — свой, либо с карточки, которой управляет человек; владелец сервиса — любой. */
export const setTracks = async (me, albumId, trackIds, { remove } = {}) => {
  const a = (await query('SELECT * FROM music_albums WHERE id=$1 AND NOT hidden', [String(albumId ?? '')])).rows[0]; if (!a) return err('not_found');
  if (!(await canAlbum(me, a))) return err('not_allowed');
  const ids = (Array.isArray(trackIds) ? trackIds : []).map(String).slice(0, 200); if (!ids.length) return err('no_tracks');
  const owner = await isOwner(me);
  const { rowCount } = await query(
    `UPDATE music_tracks t SET album_id = $2, album = $3
      WHERE t.id = ANY($1) AND ($4 OR t.owner_id = $5 OR t.artist_card_id IN (SELECT id FROM music_artist_cards WHERE owner_id = $5))
        ${remove ? 'AND t.album_id = $6' : ''}`,
    remove ? [ids, null, null, owner, me, a.id] : [ids, a.id, a.title, owner, me]);
  return { ok: true, changed: rowCount };
};

/* ── Подтверждение прав правообладателя ── */
const subject = async (kind, id) => (kind === 'card' ? cardOf(id) : kind === 'label' ? labelOf(id) : null);
const canSubject = async (me, kind, s) => (kind === 'card' ? canCard(me, s) : canLabel(me, s));
export const submitRights = async (me, { kind, subjectId, holder, note, links } = {}) => {
  if (kind !== 'card' && kind !== 'label') return err('bad_kind');
  const s = await subject(kind, subjectId); if (!s) return err('not_found');
  if (!(await canSubject(me, kind, s))) return err('not_allowed');
  if (s.rights_verified_at) return err('already_verified');
  const h = clean(holder, 160); if (h.length < 2) return err('holder_required');
  const n = clean(note, 1500); if (n.length < 10) return err('note_required');
  const urls = (Array.isArray(links) ? links : []).map((l) => String(l).trim()).filter((l) => /^https:\/\/[^\s]{3,300}$/i.test(l)).slice(0, 5);
  const id = newId('rcl');
  try { await query(`INSERT INTO music_rights_claims (id, kind, subject_id, claimant_id, holder, note, links, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`, [id, kind, s.id, me, h, encryptContent(n), encryptContent(JSON.stringify(urls))]); }
  catch (e) { if (e.code === '23505') return err('already_pending'); throw e; }
  void notifyStaff('artist_claim', { title: 'Подтверждение прав правообладателя', body: 'Заявка ждёт решения в разделе «Музыканты».', dedupe: id, except: me });
  return { ok: true, id };
};
export const myRights = async (me, { kind, subjectId } = {}) => {
  const { rows } = await query(`SELECT id, status, holder, created_at, decided_at FROM music_rights_claims WHERE claimant_id=$1 AND kind=$2 AND subject_id=$3 ORDER BY created_at DESC LIMIT 5`, [me, kind, String(subjectId ?? '')]);
  return { claims: rows.map((r) => ({ id: r.id, status: r.status, holder: r.holder, at: r.created_at, decidedAt: r.decided_at })) };
};
export const withdrawRights = async (me, id) => {
  const r = await query(`UPDATE music_rights_claims SET status='withdrawn', decided_at=now() WHERE id=$1 AND claimant_id=$2 AND status='pending' RETURNING id`, [String(id ?? ''), me]);
  return r.rows[0] ? { ok: true } : err('not_found');
};
export const adminRightsList = async (adminId, { status = 'pending' } = {}) => {
  if (!(await can(adminId, 'content'))) return err('not_allowed');
  const st = ['pending', 'approved', 'rejected', 'revoked', 'withdrawn'].includes(status) ? status : 'pending';
  const { rows } = await query(`SELECT r.*, p.username, COALESCE(c.name, l.name) AS subject_name FROM music_rights_claims r JOIN profiles p ON p.id=r.claimant_id
      LEFT JOIN music_artist_cards c ON r.kind='card' AND c.id=r.subject_id LEFT JOIN music_labels l ON r.kind='label' AND l.id=r.subject_id
      WHERE r.status=$1 ORDER BY r.created_at DESC LIMIT 100`, [st]);
  return { items: rows.map((r) => ({ id: r.id, kind: r.kind, subjectId: r.subject_id, subjectName: r.subject_name, claimant: r.claimant_id, username: r.username, holder: r.holder, note: open(r.note), links: (() => { try { return JSON.parse(open(r.links) || '[]'); } catch { return []; } })(), status: r.status, at: r.created_at })) };
};
export const decideRights = async (adminId, id, { approve, reason } = {}) => {
  if (!(await can(adminId, 'content'))) return err('not_allowed');
  const why = clean(reason, 500); if (!approve && why.length < 5) return err('reason_required');
  const client = await pool.connect(); let r;
  try {
    await client.query('BEGIN');
    r = (await client.query(`SELECT * FROM music_rights_claims WHERE id=$1 FOR UPDATE`, [String(id ?? '')])).rows[0];
    if (!r) { await client.query('ROLLBACK'); return err('not_found'); }
    if (r.status !== 'pending') { await client.query('ROLLBACK'); return err('not_pending'); }
    if (r.claimant_id === adminId && !(await isOwner(adminId))) { await client.query('ROLLBACK'); return err('self_review'); }
    await client.query(`UPDATE music_rights_claims SET status=$2, decided_by=$3, decided_at=now(), reason=$4 WHERE id=$1`, [r.id, approve ? 'approved' : 'rejected', adminId, sealed(why)]);
    if (approve) {
      const tbl = r.kind === 'card' ? 'music_artist_cards' : 'music_labels';
      await client.query(`UPDATE ${tbl} SET rights_verified_at=now(), rights_verified_by=$2, rights_holder=$3 WHERE id=$1`, [r.subject_id, adminId, r.holder]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  await logAdmin({ actorId: adminId, targetId: r.claimant_id, type: approve ? 'music_rights_approve' : 'music_rights_reject', detail: `${r.kind}:${r.subject_id}${why ? ` — ${why}` : ''}` });
  await notifyGift(r.claimant_id, 'music_rights', approve ? 'Права подтверждены' : 'Заявка на подтверждение прав отклонена', approve ? 'Правообладатель подтверждён — отметка видна в карточке.' : `Причина: ${why}`);
  return { ok: true };
};
export const revokeRights = async (adminId, kind, subjectId, reason) => {
  if (!(await can(adminId, 'content'))) return err('not_allowed');
  const why = clean(reason, 500); if (why.length < 5) return err('reason_required');
  if (kind !== 'card' && kind !== 'label') return err('bad_kind');
  const tbl = kind === 'card' ? 'music_artist_cards' : 'music_labels';
  const u = await query(`UPDATE ${tbl} SET rights_verified_at=NULL, rights_verified_by=NULL, rights_holder=NULL WHERE id=$1 AND rights_verified_at IS NOT NULL RETURNING id`, [String(subjectId ?? '')]);
  if (!u.rows[0]) return err('not_found');
  await query(`UPDATE music_rights_claims SET status='revoked', decided_by=$3, decided_at=now(), reason=$4 WHERE kind=$1 AND subject_id=$2 AND status='approved'`, [kind, subjectId, adminId, sealed(why)]);
  await logAdmin({ actorId: adminId, targetId: adminId, type: 'music_rights_revoke', detail: `${kind}:${subjectId} — ${why}` });
  return { ok: true };
};

/** Админ-обзор: все лейблы и альбомы (владелец сервиса и сотрудники с правом content). */
export const adminOverview = async (adminId, { q } = {}) => {
  if (!(await can(adminId, 'content')) && !(await isOwner(adminId))) return err('not_allowed');
  const labels = await listLabels(adminId, { q });
  const nq = norm(q);
  const args = []; let where = 'NOT a.hidden';
  if (nq) { args.push(`%${nq.replace(/([\\%_])/g, '\\$1')}%`); where += ` AND lower(a.title) LIKE $1 ESCAPE '\\'`; }
  const { rows } = await query(`${ALB} WHERE ${where} ORDER BY a.created_at DESC LIMIT 100`, args);
  return { labels: labels.labels, albums: rows.map((r) => albumView(r, adminId)) };
};
