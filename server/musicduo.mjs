/**
 * «Поток на двоих»: общая очередь из музыки, которая нравится обоим. Только друзья (friendships.accepted), только после принятия
 * приглашения вторым человеком; завершить может любой из двоих — после этого чужое избранное и история больше не используются.
 * Берутся только опубликованные треки (чужое приватное не попадает), отметка Explicit фильтруется настройкой запрашивающего.
 */
import { randomUUID } from 'node:crypto';
import { query } from './db.mjs';
import { toTrack } from './music.mjs';
import { notifyGift } from './giftnotify.mjs';
import { L } from './lang.mjs';

const MAX_Q = 60;
const pair = (x, y) => (x < y ? [x, y] : [y, x]);
const otherOf = (d, me) => (d.a_id === me ? d.b_id : d.a_id);

const person = async (id) => (await query('SELECT id, username, name FROM profiles WHERE id=$1', [id])).rows[0] ?? null;

export const duoFriends = async (me) => {
  const { rows } = await query(
    `SELECT p.id, p.username, p.name FROM friendships f
       JOIN profiles p ON p.id = CASE WHEN f.a_id = $1 THEN f.b_id ELSE f.a_id END
      WHERE (f.a_id = $1 OR f.b_id = $1) AND f.status = 'accepted' ORDER BY p.name LIMIT 300`, [me]);
  return rows.map((r) => ({ id: r.id, username: r.username, name: r.name }));
};

export const getDuo = async (me) => {
  const { rows } = await query(`SELECT * FROM music_duo WHERE (a_id=$1 OR b_id=$1) AND status IN ('pending','active') ORDER BY created_at DESC`, [me]);
  const out = [];
  for (const d of rows) {
    const o = await person(otherOf(d, me));
    out.push({ id: d.id, status: d.status, incoming: d.status === 'pending' && d.requested_by !== me, partner: o ? { id: o.id, username: o.username, name: o.name } : null, createdAt: d.created_at });
  }
  return { duos: out };
};

export const inviteDuo = async (me, friendId) => {
  const fid = String(friendId ?? '');
  if (!fid || fid === me) return { error: 'bad_request' };
  const [a, b] = pair(me, fid);
  const fr = (await query(`SELECT 1 FROM friendships WHERE a_id=$1 AND b_id=$2 AND status='accepted'`, [a, b])).rows[0];
  if (!fr) return { error: 'not_friends' };
  const mine = (await query(`SELECT count(*)::int AS n FROM music_duo WHERE (a_id=$1 OR b_id=$1) AND status IN ('pending','active')`, [me])).rows[0].n;
  if (mine >= 5) return { error: 'too_many' };
  const id = `duo-${randomUUID()}`;
  const r = await query(`INSERT INTO music_duo (id, a_id, b_id, requested_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`, [id, a, b, me]);
  if (!r.rows[0]) return { error: 'already_exists' };
  const meP = await person(me);
  void notifyGift(fid, 'music_duo', L('Поток на двоих', 'Duo flow'), L(`${meP?.name ?? 'Друг'} зовёт вас слушать музыку вместе`, `${meP?.name ?? 'A friend'} invites you to listen together`), id).catch(() => {});
  return { ok: true, id };
};

const mineRow = async (me, id) => (await query(`SELECT * FROM music_duo WHERE id=$1 AND (a_id=$2 OR b_id=$2)`, [String(id), me])).rows[0] ?? null;

/** accept — только приглашённый; decline/end — любой из двоих. Условные UPDATE: повтор безвреден. */
export const actDuo = async (me, id, action) => {
  const d = await mineRow(me, id); if (!d) return { error: 'not_found' };
  if (action === 'accept') {
    if (d.requested_by === me) return { error: 'forbidden' };
    const r = await query(`UPDATE music_duo SET status='active', updated_at=now() WHERE id=$1 AND status='pending'`, [d.id]);
    if (r.rowCount) { const m = await person(me); void notifyGift(d.requested_by, 'music_duo', L('Поток на двоих', 'Duo flow'), L(`${m?.name ?? 'Друг'} принял(а) приглашение`, `${m?.name ?? 'Your friend'} accepted`), d.id).catch(() => {}); }
    return { ok: true };
  }
  if (action === 'decline' || action === 'end') {
    await query(`UPDATE music_duo SET status='ended', updated_at=now() WHERE id=$1 AND status IN ('pending','active')`, [d.id]);
    return { ok: true };
  }
  return { error: 'bad_request' };
};

const tasteOf = async (uid) => {
  const favs = (await query(`SELECT track_id FROM music_favorites WHERE user_id=$1`, [uid])).rows.map((r) => r.track_id);
  const { rows } = await query(
    `SELECT lower(t.genre) AS g, lower(t.artist) AS a FROM (
        SELECT track_id FROM music_favorites WHERE user_id=$1
        UNION ALL SELECT track_id FROM (SELECT track_id FROM music_history WHERE user_id=$1 ORDER BY played_at DESC LIMIT 150) h
     ) s JOIN music_tracks t ON t.id = s.track_id WHERE t.status='published'`, [uid]);
  const genres = new Map(); const artists = new Map();
  for (const r of rows) { if (r.g) genres.set(r.g, (genres.get(r.g) ?? 0) + 1); if (r.a) artists.set(r.a, (artists.get(r.a) ?? 0) + 1); }
  return { favs: new Set(favs), genres, artists };
};

/** Очередь потока: что нравится обоим — первым; затем общие жанры/исполнители; затем избранное каждого. */
export const duoQueue = async (me, id, { hideExplicit = false } = {}) => {
  const d = await mineRow(me, id); if (!d) return { error: 'not_found' };
  if (d.status !== 'active') return { error: 'not_active' };
  const other = otherOf(d, me);
  const [ta, tb, partner] = await Promise.all([tasteOf(me), tasteOf(other), person(other)]);
  const topG = (m) => new Set([...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map((e) => e[0]));
  const ga = topG(ta.genres); const gb = topG(tb.genres);
  const sharedG = [...ga].filter((g) => gb.has(g));
  const ids = [...new Set([...ta.favs, ...tb.favs])];
  const { rows } = await query(
    `SELECT *, owner_id = $1 AS own, FALSE AS has_cutout FROM music_tracks
      WHERE status='published' AND (id = ANY($2) OR lower(genre) = ANY($3))
        ${hideExplicit ? 'AND NOT coalesce(mod_explicit, explicit)' : ''}
      ORDER BY plays DESC LIMIT 400`, [me, ids, sharedG.length ? sharedG : ['\u0000']]);
  const scored = rows.map((r) => {
    const fa = ta.favs.has(r.id); const fb = tb.favs.has(r.id); const art = String(r.artist).toLowerCase(); const g = String(r.genre ?? '').toLowerCase();
    let s = 0; let reason = '';
    if (fa && fb) { s += 10; reason = L('Нравится вам обоим', 'You both like it'); }
    else if (fa || fb) { s += 3; reason = fa ? L('Из вашего избранного', 'From your favorites') : L(`Из избранного: ${partner?.name ?? 'друга'}`, `From ${partner?.name ?? 'your friend'}'s favorites`); }
    if (ta.artists.has(art) && tb.artists.has(art)) { s += 4; reason = reason || L('Исполнитель, которого слушаете оба', 'An artist you both listen to'); }
    if (sharedG.includes(g)) { s += 3; reason = reason || L(`Общий жанр: ${r.genre}`, `Shared genre: ${r.genre}`); }
    return { r, s, reason };
  }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s || Number(y.r.plays) - Number(x.r.plays)).slice(0, MAX_Q);
  const enough = scored.length > 0;
  return {
    partner: partner ? { id: partner.id, username: partner.username, name: partner.name } : null,
    tracks: scored.map((x) => ({ ...toTrack(x.r), reason: x.reason })),
    note: enough ? undefined : L('Пока мало общих вкусов — добавляйте треки в избранное, и поток подстроится.', 'Not much in common yet — add tracks to favorites and the flow will adapt.'),
  };
};
