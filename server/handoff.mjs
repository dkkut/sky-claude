/**
 * «Продолжить на другом устройстве».
 *
 * Это НЕ новая система воспроизведения и не новый прогресс. Слой стоит поверх готового:
 *  • устройства — реестр Sky Transfer (`transfer_devices`: подтверждённые устройства одного Sky ID, имя, вид, «был на связи»);
 *  • место остановки — прежние таблицы прогресса (music_progress, film_progress, podcast_progress, book_progress) и новая `sky_video_progress`
 *    (у Sky Video прогресса не было вовсе); записываются прежними функциями `setProgress`, поэтому ограничения доступа те же;
 *  • доставка — события по сокету (`handoff:*`) + опрос принимающего устройства как запас.
 * Передача идёт ТОЛЬКО между устройствами одного Sky ID и одного профиля, и только на подтверждённое устройство, которое было на связи.
 * Принимает её только само целевое устройство (заголовок X-Sky-Device) и только после нажатия «Продолжить»: сама собой ничего не запускается.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { logEvent as skyLog } from './skylog.mjs';
import { pushGoEvent } from './signal.mjs';
import * as T from './transfer.mjs';
import { visibleTrack, setProgress as setMusicProgress } from './music.mjs';
import { visibleMovie, setProgress as setFilmProgress } from './film.mjs';
import { visibleEpisode, setProgress as setPodcastProgress } from './podcasts.mjs';
import { visibleBook, setProgress as setBookProgress } from './books.mjs';
import { visibleVideo } from './skyvideo.mjs';

export const KINDS = ['music', 'film', 'video', 'podcast', 'book'];
export const TTL_SEC = 120;                 // сколько передача ждёт ответа
export const ONLINE_SEC = 90;               // «на связи»: сигнал устройства не старше
const MAX_POS = 86400 * 2;
const ID_RE = /^[\w.:-]{1,80}$/;
const err = (error, extra = {}) => ({ error, ...extra });
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, n);
const clamp = (v, max = MAX_POS) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n * 10) / 10)) : 0; };
const newId = () => `ho-${crypto.randomUUID()}`;
const tell = async (skyId, msg) => { try { pushGoEvent(await T.profilesOf(skyId), msg); } catch { /* сокет необязателен */ } };

/* ── Чистые функции (покрыты тестом без базы) ── */

/** Можно ли отправить на это устройство. Возвращает код отказа или null. */
export const targetProblem = (d, { fromId, profileId, now = Date.now() } = {}) => {
  if (!d) return 'unknown_device';
  if (d.id === fromId) return 'same_device';
  if (d.status !== 'approved') return 'recipient_not_trusted';
  if (d.last_profile && d.last_profile !== profileId) return 'other_profile';
  if (!d.last_seen || now - new Date(d.last_seen).getTime() > ONLINE_SEC * 1000) return 'device_offline';
  return null;
};

/** Итоговое место: если после снимка кто-то записал позицию на третьем устройстве — берём более свежую. */
export const resolvePosition = (snap, current, { skewMs = 3000 } = {}) => {
  if (!current || current.updatedAt == null) return { position: snap.position, newerElsewhere: false };
  const newer = new Date(current.updatedAt).getTime() > new Date(snap.createdAt).getTime() + skewMs;
  return newer ? { position: current.position, newerElsewhere: true } : { position: snap.position, newerElsewhere: false };
};

/* ── Контент: доступ и запись места ── */
const checkItem = async (kind, itemId, profileId) => {
  if (kind === 'music') return !!(await visibleTrack(itemId, profileId));
  if (kind === 'film') return !!(await visibleMovie(itemId, profileId));
  if (kind === 'podcast') return !!(await visibleEpisode(itemId, profileId));
  if (kind === 'book') return !!(await visibleBook(itemId, profileId));
  if (kind === 'video') return !!(await visibleVideo(itemId, profileId));
  return false;
};

export const setVideoProgress = async (userId, videoId, { position, duration } = {}) => {
  if (!ID_RE.test(String(videoId)) || !(await visibleVideo(videoId, userId))) return err('not_found');
  await query(
    `INSERT INTO sky_video_progress (user_id, video_id, position_sec, duration_sec) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, video_id) DO UPDATE SET position_sec = $3, duration_sec = GREATEST(sky_video_progress.duration_sec, $4), updated_at = now()`,
    [userId, videoId, Math.round(clamp(position)), Math.round(clamp(duration))]);
  return { ok: true };
};
export const getVideoProgress = async (userId, videoId) => {
  const { rows } = await query('SELECT position_sec, duration_sec, updated_at FROM sky_video_progress WHERE user_id = $1 AND video_id = $2', [userId, String(videoId)]);
  return rows[0] ? { position: rows[0].position_sec, duration: rows[0].duration_sec, updatedAt: rows[0].updated_at } : null;
};

const saveSnapshot = async (kind, profileId, itemId, position, duration, extra) => {
  if (kind === 'music') return setMusicProgress(profileId, itemId, position);
  if (kind === 'film') return setFilmProgress(profileId, itemId, { position, duration });
  if (kind === 'podcast') return setPodcastProgress(profileId, itemId, { position, duration });
  if (kind === 'video') return setVideoProgress(profileId, itemId, { position, duration });
  if (kind === 'book') {
    const mode = extra?.mode === 'audio' ? 'audio' : 'text';
    return setBookProgress(itemId, profileId, mode === 'audio'
      ? { mode, audioChapter: extra?.audioChapter ?? extra?.chapter ?? 1, audioPosition: position }
      : { mode, textChapter: extra?.textChapter ?? extra?.chapter ?? 1, textOffset: extra?.textOffset ?? 0 });
  }
  return err('bad_kind');
};

const readCurrent = async (kind, profileId, itemId, extra) => {
  const one = async (sql) => (await query(sql, [profileId, itemId])).rows[0];
  if (kind === 'music') { const r = await one('SELECT position_sec p, updated_at u FROM music_progress WHERE user_id = $1 AND track_id = $2'); return r && { position: r.p, updatedAt: r.u }; }
  if (kind === 'film') { const r = await one('SELECT position_sec p, updated_at u FROM film_progress WHERE user_id = $1 AND movie_id = $2'); return r && { position: r.p, updatedAt: r.u }; }
  if (kind === 'podcast') { const r = await one('SELECT position_sec p, updated_at u FROM podcast_progress WHERE user_id = $1 AND episode_id = $2'); return r && { position: r.p, updatedAt: r.u }; }
  if (kind === 'video') { const r = await one('SELECT position_sec p, updated_at u FROM sky_video_progress WHERE user_id = $1 AND video_id = $2'); return r && { position: r.p, updatedAt: r.u }; }
  if (kind === 'book') {
    const r = (await query('SELECT last_mode, text_chapter, text_offset, audio_chapter, audio_position, updated_at FROM book_progress WHERE user_id = $1 AND book_id = $2', [profileId, itemId])).rows[0];
    if (!r) return null;
    return { position: Number(extra?.mode === 'audio' ? r.audio_position : r.text_offset), updatedAt: r.updated_at,
      extra: { mode: r.last_mode, textChapter: r.text_chapter, textOffset: r.text_offset, audioChapter: r.audio_chapter, audioPosition: Number(r.audio_position) } };
  }
  return null;
};

/* ── Устройства ── */
export const registerThisDevice = async (skyId, profileId, req, b, trusted) => {
  const r = await T.registerDevice(skyId, req, { name: b?.name, kind: b?.kind, trusted });
  if (r.error) return r;
  await query('UPDATE transfer_devices SET last_profile = $2, last_seen = now() WHERE id = $1', [r.id, profileId]);
  return r;
};
export const beat = async (skyId, profileId, req) => {
  const r = await T.heartbeat(skyId, req);
  if (r.error) return r;
  const d = await T.myDevice(skyId, req);
  if (d) await query('UPDATE transfer_devices SET last_profile = $2 WHERE id = $1', [d.id, profileId]);
  return r;
};

const devView = (d, profileId, meId) => {
  const problem = targetProblem(d, { fromId: meId, profileId });
  return { id: d.id, name: d.name, kind: d.kind, current: d.id === meId, online: !['device_offline'].includes(problem) && d.status === 'approved' && !!d.last_seen && Date.now() - new Date(d.last_seen).getTime() <= ONLINE_SEC * 1000,
    sameProfile: !d.last_profile || d.last_profile === profileId, canReceive: problem === null, problem, lastSeen: d.last_seen };
};

export const getPrefs = async (skyId) => {
  const p = (await query('SELECT * FROM handoff_prefs WHERE sky_id = $1', [skyId])).rows[0];
  return { accept: p?.accept ?? 'ask', historyDays: p?.history_days ?? 30 };
};
export const setPrefs = async (skyId, b) => {
  const cur = await getPrefs(skyId);
  const accept = b?.accept === 'off' ? 'off' : b?.accept === 'ask' ? 'ask' : cur.accept;
  const days = [7, 30, 90].includes(Number(b?.historyDays)) ? Number(b.historyDays) : cur.historyDays;
  await query(`INSERT INTO handoff_prefs (sky_id, accept, history_days) VALUES ($1,$2,$3) ON CONFLICT (sky_id) DO UPDATE SET accept = $2, history_days = $3, updated_at = now()`, [skyId, accept, days]);
  return { ok: true, accept, historyDays: days };
};

export const devices = async (skyId, profileId, req) => {
  const me = await T.myDevice(skyId, req);
  if (!me) return err('unknown_device');
  const { rows } = await query(`SELECT * FROM transfer_devices WHERE sky_id = $1 AND status <> 'revoked' ORDER BY last_seen DESC`, [skyId]);
  return { me: { id: me.id, status: me.status, name: me.name, kind: me.kind }, devices: rows.filter((d) => d.status === 'approved').map((d) => devView(d, profileId, me.id)), pendingApproval: rows.filter((d) => d.status === 'pending').length, prefs: await getPrefs(skyId) };
};

/* ── Передача ── */
const view = (h, devNames = {}) => ({
  id: h.id, kind: h.kind, itemId: h.item_id, title: h.title, position: Number(h.position_sec), duration: Number(h.duration_sec), extra: h.extra ?? {},
  state: h.state, reason: h.reason ?? null, fromDevice: h.from_device, toDevice: h.to_device, fromName: devNames[h.from_device] ?? '', toName: devNames[h.to_device] ?? '',
  keepPlaying: h.keep_playing, createdAt: h.created_at, expiresAt: h.expires_at,
});
const names = async (skyId) => Object.fromEntries((await query('SELECT id, name FROM transfer_devices WHERE sky_id = $1', [skyId])).rows.map((r) => [r.id, r.name]));

export const send = async (skyId, profileId, req, b) => {
  const me = await T.myDevice(skyId, req);
  if (!me) return err('unknown_device');
  if (me.status !== 'approved') return err('device_not_approved');
  const kind = String(b?.kind ?? '');
  if (!KINDS.includes(kind)) return err('bad_kind');
  const itemId = String(b?.itemId ?? '');
  if (!ID_RE.test(itemId)) return err('bad_item');
  const idem = String(b?.idemKey ?? '');
  if (!/^[\w-]{8,64}$/.test(idem)) return err('bad_idem');
  const prior = (await query('SELECT * FROM handoffs WHERE sky_id = $1 AND idem_key = $2', [skyId, idem])).rows[0];
  if (prior) return { ok: true, duplicate: true, handoff: view(prior, await names(skyId)) };
  if ((await getPrefs(skyId)).accept === 'off') return err('handoff_disabled');
  const to = (await query('SELECT * FROM transfer_devices WHERE id = $1 AND sky_id = $2', [String(b?.toDevice ?? ''), skyId])).rows[0];
  const problem = targetProblem(to, { fromId: me.id, profileId });
  if (problem) return err(problem, to ? { name: to.name } : {});
  if (!(await checkItem(kind, itemId, profileId))) return err('not_found');
  const position = clamp(b?.position); const duration = clamp(b?.duration);
  const extra = b?.extra && typeof b.extra === 'object' ? Object.fromEntries(Object.entries(b.extra).slice(0, 8).map(([k, v]) => [clip(k, 20), typeof v === 'number' ? v : typeof v === 'string' ? clip(v, 40) : null])) : {};
  /* Место фиксируем в настоящем прогрессе: так оно же пригодится любому устройству, даже если карточку не нажмут. */
  await saveSnapshot(kind, profileId, itemId, position, duration, extra);
  const id = newId();
  const ins = await query(`WITH lock AS (SELECT pg_advisory_xact_lock(hashtext($1)))
    , old AS (UPDATE handoffs SET state = 'superseded', resolved_at = now() WHERE to_device = $5 AND state = 'pending' RETURNING id)
    INSERT INTO handoffs (id, sky_id, profile_id, from_device, to_device, kind, item_id, title, position_sec, duration_sec, extra, keep_playing, idem_key, expires_at)
    SELECT $2, $1, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, now() + ($14 || ' seconds')::interval FROM lock RETURNING *`,
    [skyId, id, profileId, me.id, to.id, kind, itemId, clip(b?.title, 120), position, duration, JSON.stringify(extra), b?.keepPlaying === true, idem, String(TTL_SEC)]);
  const h = ins.rows[0];
  const nm = await names(skyId);
  skyLog({ category: 'user', service: 'handoff', type: 'handoff_sent', actorId: profileId, detail: { kind } });
  await tell(skyId, { type: 'handoff:incoming', payload: view(h, nm) });
  return { ok: true, handoff: view(h, nm) };
};

const expireSweep = (deviceId = null) => query(`UPDATE handoffs SET state = 'expired', resolved_at = now() WHERE state = 'pending' AND expires_at <= now() AND ($1::text IS NULL OR to_device = $1) RETURNING *`, [deviceId]);

export const pendingFor = async (skyId, profileId, req) => {
  const me = await T.myDevice(skyId, req);
  if (!me || me.status !== 'approved') return { handoffs: [] };
  const expired = (await expireSweep(me.id)).rows;
  const nm = await names(skyId);
  for (const h of expired) await tell(skyId, { type: 'handoff:update', payload: view(h, nm) });
  const { rows } = await query(`SELECT * FROM handoffs WHERE to_device = $1 AND profile_id = $2 AND state = 'pending' AND expires_at > now() ORDER BY created_at DESC LIMIT 3`, [me.id, profileId]);
  return { handoffs: rows.map((h) => view(h, nm)) };
};

const own = async (skyId, profileId, id) => (await query('SELECT * FROM handoffs WHERE id = $1 AND sky_id = $2 AND profile_id = $3', [String(id), skyId, profileId])).rows[0];

export const status = async (skyId, profileId, req, id) => {
  const me = await T.myDevice(skyId, req);
  const h = await own(skyId, profileId, id);
  if (!h || !me || (h.from_device !== me.id && h.to_device !== me.id)) return err('not_found');
  if (h.state === 'pending' && new Date(h.expires_at).getTime() <= Date.now()) {
    const up = (await query(`UPDATE handoffs SET state = 'expired', resolved_at = now() WHERE id = $1 AND state = 'pending' RETURNING *`, [h.id])).rows[0];
    return { handoff: view(up ?? { ...h, state: 'expired' }, await names(skyId)) };
  }
  return { handoff: view(h, await names(skyId)) };
};

const resolve = async (skyId, profileId, req, id, next, reason = null) => {
  const me = await T.myDevice(skyId, req);
  if (!me || me.status !== 'approved') return err('unknown_device');
  const h = await own(skyId, profileId, id);
  if (!h) return err('not_found');
  const isTo = h.to_device === me.id, isFrom = h.from_device === me.id;
  if (next === 'cancelled' ? !isFrom : !isTo) return err('not_found');
  if (h.state === next) return { ok: true, duplicate: true, handoff: view(h, await names(skyId)) };
  if (h.state !== 'pending') return err(h.state === 'expired' ? 'expired' : 'bad_state', { state: h.state });
  const up = (await query(`UPDATE handoffs SET state = $2, reason = $3, resolved_at = now() WHERE id = $1 AND state = 'pending' AND expires_at > now() RETURNING *`, [h.id, next, reason])).rows[0];
  if (!up) { const fresh = await own(skyId, profileId, id); return err(fresh?.state === 'pending' ? 'expired' : 'bad_state', { state: fresh?.state }); }
  return { up, h };
};

export const accept = async (skyId, profileId, req, id) => {
  const r = await resolve(skyId, profileId, req, id, 'accepted');
  if (r.error || r.duplicate) {
    if (r.duplicate) return { ...r, current: null };
    return r;
  }
  const { up } = r;
  /* Доступ перепроверяем в момент принятия: материал могли снять, а подписка — истечь. */
  if (!(await checkItem(up.kind, up.item_id, profileId))) {
    await query(`UPDATE handoffs SET state = 'failed', reason = 'unavailable' WHERE id = $1`, [up.id]);
    return err('not_found');
  }
  const cur = await readCurrent(up.kind, profileId, up.item_id, up.extra);
  const pos = resolvePosition({ position: Number(up.position_sec), createdAt: up.created_at }, cur);
  const nm = await names(skyId);
  skyLog({ category: 'user', service: 'handoff', type: 'handoff_accepted', actorId: profileId, detail: { kind: up.kind } });
  await tell(skyId, { type: 'handoff:update', payload: view(up, nm) });
  return { ok: true, handoff: { ...view(up, nm), position: pos.position }, newerElsewhere: pos.newerElsewhere, bookExtra: pos.newerElsewhere ? cur?.extra ?? null : null };
};
export const decline = async (skyId, profileId, req, id) => {
  const r = await resolve(skyId, profileId, req, id, 'declined', 'user');
  if (r.error || r.duplicate) return r;
  await tell(skyId, { type: 'handoff:update', payload: view(r.up, await names(skyId)) });
  return { ok: true };
};
export const cancel = async (skyId, profileId, req, id) => {
  const r = await resolve(skyId, profileId, req, id, 'cancelled', 'sender');
  if (r.error || r.duplicate) return r;
  await tell(skyId, { type: 'handoff:update', payload: view(r.up, await names(skyId)) });
  return { ok: true };
};

export const history = async (skyId, profileId) => {
  await expireSweep();
  const nm = await names(skyId);
  const { rows } = await query(`SELECT * FROM handoffs WHERE sky_id = $1 AND profile_id = $2 ORDER BY created_at DESC LIMIT 30`, [skyId, profileId]);
  return { history: rows.map((h) => view(h, nm)) };
};
export const clearHistory = async (skyId, profileId) => {
  await query(`DELETE FROM handoffs WHERE sky_id = $1 AND profile_id = $2 AND state <> 'pending'`, [skyId, profileId]);
  return { ok: true };
};

/** «Где вы остановились»: последние незавершённые места по всем видам — то же, что видно на любом устройстве. */
export const continueList = async (profileId) => {
  const q = async (sql) => (await query(sql, [profileId])).rows;
  const [mus, fil, pod, boo, vid] = await Promise.all([
    q(`SELECT 'music' kind, t.id, t.title, t.artist subtitle, p.position_sec pos, 0 dur, p.updated_at at FROM music_progress p JOIN music_tracks t ON t.id = p.track_id WHERE p.user_id = $1 AND p.position_sec > 5 AND t.status IN ('published','private') ORDER BY p.updated_at DESC LIMIT 4`),
    q(`SELECT 'film' kind, m.id, m.title, '' subtitle, p.position_sec pos, p.duration_sec dur, p.updated_at at FROM film_progress p JOIN film_movies m ON m.id = p.movie_id WHERE p.user_id = $1 AND p.position_sec > 5 AND (p.duration_sec = 0 OR p.position_sec < p.duration_sec - 20) ORDER BY p.updated_at DESC LIMIT 4`),
    q(`SELECT 'podcast' kind, e.id, e.title, '' subtitle, p.position_sec pos, p.duration_sec dur, p.updated_at at FROM podcast_progress p JOIN podcast_episodes e ON e.id = p.episode_id WHERE p.user_id = $1 AND NOT p.completed AND p.position_sec > 5 ORDER BY p.updated_at DESC LIMIT 4`),
    q(`SELECT 'book' kind, b.id, b.title, '' subtitle, CASE WHEN p.last_mode = 'audio' THEN p.audio_position ELSE p.text_offset END pos, 0 dur, p.updated_at at FROM book_progress p JOIN books b ON b.id = p.book_id WHERE p.user_id = $1 AND NOT p.completed ORDER BY p.updated_at DESC LIMIT 4`),
    q(`SELECT 'video' kind, v.id, v.title, '' subtitle, p.position_sec pos, p.duration_sec dur, p.updated_at at FROM sky_video_progress p JOIN sky_videos v ON v.id = p.video_id WHERE p.user_id = $1 AND p.position_sec > 5 AND v.status = 'published' AND (p.duration_sec = 0 OR p.position_sec < p.duration_sec - 20) ORDER BY p.updated_at DESC LIMIT 4`),
  ]);
  const all = [...mus, ...fil, ...pod, ...boo, ...vid].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 10);
  return { items: all.map((r) => ({ kind: r.kind, itemId: r.id, title: r.title, subtitle: r.subtitle || '', position: Number(r.pos), duration: Number(r.dur), at: r.at })) };
};

export const sweepHandoff = async () => {
  await expireSweep();
  await query(`DELETE FROM handoffs h USING handoff_prefs p WHERE p.sky_id = h.sky_id AND h.state <> 'pending' AND h.created_at < now() - (p.history_days || ' days')::interval`);
  await query(`DELETE FROM handoffs WHERE state <> 'pending' AND created_at < now() - interval '30 days'`);
};
