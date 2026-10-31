/**
 * Музыка в профиле (избранные песни и плейлисты) и исключения из приватности по людям.
 * Видимость: настройка профиля `showMusic` + исключение 'music' для конкретного человека (deny скрывает, allow показывает).
 * Чужим людям отдаются только опубликованные треки и публичные плейлисты; свои — все, помеченные для профиля.
 */
import { query } from './db.mjs';
import { getPrivacy, exceptionOf, validScope } from './privacy.mjs';

const err = (e) => ({ error: e });

export const getProfileMusic = async (viewerId, targetId) => {
  const own = viewerId === targetId;
  if (!own) {
    const exc = await exceptionOf(targetId, viewerId, 'music');
    if (exc === 'deny') return { hidden: true, tracks: [], playlists: [] };
    const priv = await getPrivacy(targetId);
    if (exc !== 'allow' && priv.profileVisibility?.showMusic === false) return { hidden: true, tracks: [], playlists: [] };
  }
  const tracks = (await query(
    `SELECT t.id, t.title, t.artist, t.duration_sec, t.status, m.note FROM profile_music m JOIN music_tracks t ON t.id = m.item_id
      WHERE m.owner_id=$1 AND m.kind='track' ${own ? '' : "AND t.status='published'"} ORDER BY m.position, m.added_at LIMIT 50`, [targetId])).rows
    .map((t) => ({ id: t.id, title: t.title, artist: t.artist, duration: t.duration_sec, status: t.status, note: t.note || '' }));
  const playlists = (await query(
    `SELECT p.id, p.name, p.is_public, (SELECT count(*) FROM music_playlist_items i WHERE i.playlist_id=p.id)::int AS count
       FROM profile_music m JOIN music_playlists p ON p.id = m.item_id
      WHERE m.owner_id=$1 AND m.kind='playlist' ${own ? '' : 'AND p.is_public'} ORDER BY m.position, m.added_at LIMIT 20`, [targetId])).rows
    .map((p) => ({ id: p.id, name: p.name, isPublic: p.is_public, count: p.count }));
  return { hidden: false, tracks, playlists };
};

/** Свой список: до 30 треков и 10 плейлистов; чужой трек можно добавить, только если он опубликован. */
export const setProfileMusic = async (me, { tracks, playlists } = {}) => {
  const tr = [...new Set((Array.isArray(tracks) ? tracks : []).map(String))].slice(0, 30);
  const pl = [...new Set((Array.isArray(playlists) ? playlists : []).map(String))].slice(0, 10);
  if (tr.length) {
    const ok = (await query(`SELECT id FROM music_tracks WHERE id = ANY($1::text[]) AND (status='published' OR owner_id=$2)`, [tr, me])).rows.map((r) => r.id);
    if (ok.length !== tr.length) return err('bad_track');
  }
  if (pl.length) {
    const ok = (await query(`SELECT id FROM music_playlists WHERE id = ANY($1::text[]) AND owner_id=$2`, [pl, me])).rows;
    if (ok.length !== pl.length) return err('bad_playlist');
  }
  // Тексты под оставшимися песнями сохраняются.
  const notes = new Map((await query(`SELECT item_id, note FROM profile_music WHERE owner_id=$1 AND kind='track' AND note IS NOT NULL`, [me])).rows.map((r) => [r.item_id, r.note]));
  await query(`DELETE FROM profile_music WHERE owner_id=$1`, [me]);
  for (const [i, id] of tr.entries()) await query(`INSERT INTO profile_music (owner_id, kind, item_id, position, note) VALUES ($1,'track',$2,$3,$4)`, [me, id, i, notes.get(id) ?? null]);
  for (const [i, id] of pl.entries()) await query(`INSERT INTO profile_music (owner_id, kind, item_id, position) VALUES ($1,'playlist',$2,$3)`, [me, id, i]);
  return { ok: true };
};

/** Текст под песней в своём профиле. Длина практически не ограничена (до 20 000 знаков, чтобы не хранить мегабайты); пустой текст убирает заметку. */
export const NOTE_MAX = 20000;
export const setTrackNote = async (me, trackId, text) => {
  const t = String(text ?? '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
  if (t.length > NOTE_MAX) return err('note_too_long');
  const r = await query(`UPDATE profile_music SET note=$3 WHERE owner_id=$1 AND kind='track' AND item_id=$2`, [me, String(trackId), t || null]);
  if (!r.rowCount) return err('not_found');
  return { ok: true, note: t };
};

/* ── Исключения ── */
export const listExceptions = async (me) => {
  const { rows } = await query(
    `SELECT e.other_id, e.scope, e.mode, p.username, p.name FROM privacy_exceptions e JOIN profiles p ON p.id = e.other_id WHERE e.owner_id=$1 ORDER BY e.created_at DESC LIMIT 300`, [me]);
  return { items: rows.map((r) => ({ otherId: r.other_id, username: r.username, name: r.name, scope: r.scope, mode: r.mode })) };
};
export const setException = async (me, { otherId, username, scope, mode } = {}) => {
  if (!validScope(scope)) return err('bad_scope');
  let id = String(otherId ?? '');
  if (!id && username) id = (await query('SELECT id FROM profiles WHERE lower(username)=$1', [String(username).replace(/^@/, '').toLowerCase()])).rows[0]?.id ?? '';
  if (!id) return err('user_not_found');
  if (id === me) return err('self');
  if (mode === 'none' || mode === null) { await query('DELETE FROM privacy_exceptions WHERE owner_id=$1 AND other_id=$2 AND scope=$3', [me, id, scope]); return { ok: true }; }
  if (mode !== 'allow' && mode !== 'deny') return err('bad_mode');
  const cnt = Number((await query('SELECT count(*) AS n FROM privacy_exceptions WHERE owner_id=$1', [me])).rows[0].n);
  if (cnt >= 300) return err('too_many');
  if (!(await query('SELECT 1 FROM profiles WHERE id=$1', [id])).rows[0]) return err('user_not_found');
  await query(`INSERT INTO privacy_exceptions (owner_id, other_id, scope, mode) VALUES ($1,$2,$3,$4)
    ON CONFLICT (owner_id, other_id, scope) DO UPDATE SET mode = EXCLUDED.mode, created_at = now()`, [me, id, scope, mode]);
  return { ok: true };
};
