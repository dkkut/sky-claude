/**
 * Сериалы Sky Film: сериал → сезоны → серии.
 *
 * Серия — обычная запись film_movies (тот же файл, плеер, прогресс просмотра, оценки, модерация), у которой
 * заполнены series_id / season_id / ep_no. Поэтому «продолжить с места», синхронизация устройств, история и
 * Prime-доступ работают для серий без отдельного кода: прогресс уже лежит на сервере (`film_progress`).
 * Серии не попадают в общий список фильмов и ленту коротких — вместо них там карточка сериала.
 *
 * Права: создаёт, правит, загружает серии и отправляет на проверку только владелец. Видимость серии другим
 * определяет её собственный статус (`published`) и статус сериала; администрация (право `content`) проверяет
 * через те же `moderateMovie` / `moderateSeries`.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { can } from './admin.mjs';
import { toMovie, submitMovie, moderateMovie, visibleMovie } from './film.mjs';

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;
const MAX_SHORT = 60;
const MAX_REASON = 500;
const MAX_SERIES_PER_OWNER = 100;
const MAX_SEASONS = 40;
const MAX_EPISODES_PER_SEASON = 300;
const MAX_VTT_BYTES = 300 * 1024;

const newId = (p) => `${p}-${crypto.randomUUID()}`;
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const num = (v, min, max) => {
  if (v === null || v === undefined || v === '' || typeof v === 'object') return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
};
const SERIES_ID = /^ser-[0-9a-f-]{36}$/;
const SEASON_ID = /^sea-[0-9a-f-]{36}$/;
export const isSeriesId = (s) => SERIES_ID.test(String(s ?? ''));

/* ─── Представление ────────────────────────────────────────────────── */

const toSeries = (r, viewerId) => {
  const own = Boolean(viewerId) && r.owner_id === viewerId;
  return {
    id: r.id,
    title: r.title,
    description: r.description ? (decryptContent(r.description) ?? '') : undefined,
    category: r.category,
    genre: r.genre || undefined,
    year: r.year ?? undefined,
    country: r.country || undefined,
    ageRating: r.age_rating || undefined,
    status: r.status,
    private: r.status !== 'published',
    own: own || undefined,
    uploaderName: r.uploader_name ?? undefined,
    seasons: Number(r.seasons ?? 0),
    episodes: Number(r.episodes ?? 0),
    /** Постер сериала — постер его первой серии с картинкой (отдельного файла нет). */
    posterMovieId: r.poster_movie_id ?? undefined,
    rejectReason: own && r.reject_reason ? (decryptContent(r.reject_reason) ?? undefined) : undefined,
    addedAt: r.created_at?.toISOString?.() ?? undefined,
  };
};

const SELECT_SERIES = `
  SELECT s.*, p.name AS uploader_name,
         (SELECT count(*) FROM film_seasons x WHERE x.series_id = s.id) AS seasons,
         (SELECT count(*) FROM film_movies e WHERE e.series_id = s.id
            AND (e.status = 'published' OR e.owner_id = $1)) AS episodes,
         (SELECT e.id FROM film_movies e LEFT JOIN film_seasons z ON z.id = e.season_id
           WHERE e.series_id = s.id AND e.has_poster AND (e.status = 'published' OR e.owner_id = $1)
           ORDER BY z.number, e.ep_no LIMIT 1) AS poster_movie_id
    FROM film_series s LEFT JOIN profiles p ON p.id = s.owner_id`;

/* ─── Права ────────────────────────────────────────────────────────── */

const ownSeries = async (id, owner) => {
  const { rows } = await query('SELECT * FROM film_series WHERE id = $1', [String(id ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== owner) return { error: 'not_allowed' };
  return { row: rows[0] };
};

/** Сериал виден: свой, либо опубликованный (серию не-владелец видит только опубликованную). */
const canSeeSeries = (row, viewerId) => row.owner_id === viewerId || row.status === 'published';

/* ─── Сериал ───────────────────────────────────────────────────────── */

export const createSeries = async (owner, meta) => {
  const title = text(meta?.title, MAX_TITLE);
  if (!title) return { error: 'invalid_meta' };
  const { rows } = await query('SELECT count(*)::int AS n FROM film_series WHERE owner_id = $1', [owner]);
  if ((rows[0]?.n ?? 0) >= MAX_SERIES_PER_OWNER) return { error: 'too_many' };
  const id = newId('ser');
  const desc = text(meta?.description, MAX_DESCRIPTION);
  await query(
    `INSERT INTO film_series (id, owner_id, title, description, category, genre, year, country, age_rating)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, owner, title, desc ? encryptContent(desc) : null, text(meta?.category, MAX_SHORT) || 'Сериалы',
      text(meta?.genre, MAX_SHORT), num(meta?.year, 1870, 2200), text(meta?.country, MAX_SHORT), text(meta?.ageRating, 10)]);
  // Первый сезон заводится сразу: у сериала без сезонов некуда класть серии.
  await query('INSERT INTO film_seasons (id, series_id, number, title) VALUES ($1,$2,1,$3)', [newId('sea'), id, '']);
  return { id };
};

export const updateSeries = async (id, owner, patch) => {
  const o = await ownSeries(id, owner);
  if (o.error) return o;
  const sets = []; const args = [id];
  const put = (c, v) => { args.push(v); sets.push(`${c} = $${args.length}`); };
  if (patch.title !== undefined) { const t = text(patch.title, MAX_TITLE); if (!t) return { error: 'invalid_meta' }; put('title', t); }
  if (patch.description !== undefined) { const d = text(patch.description, MAX_DESCRIPTION); put('description', d ? encryptContent(d) : null); }
  if (patch.category !== undefined) put('category', text(patch.category, MAX_SHORT) || 'Сериалы');
  if (patch.genre !== undefined) put('genre', text(patch.genre, MAX_SHORT));
  if (patch.year !== undefined) put('year', num(patch.year, 1870, 2200));
  if (patch.country !== undefined) put('country', text(patch.country, MAX_SHORT));
  if (patch.ageRating !== undefined) put('age_rating', text(patch.ageRating, 10));
  if (patch.status !== undefined) {
    if (String(patch.status) !== 'private') return { error: 'invalid_status' };
    // Убрать из общего доступа можно сразу: сериал и все его серии возвращаются владельцу.
    put('status', 'private'); put('submitted_at', null);
    await query(`UPDATE film_movies SET status='private', submitted_at=NULL, updated_at=now()
                  WHERE series_id=$1 AND status IN ('published','pending')`, [id]);
  }
  if (!sets.length) return { ok: true };
  await query(`UPDATE film_series SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  return { ok: true };
};

export const deleteSeries = async (id, actor) => {
  const { rows } = await query('SELECT owner_id, status FROM film_series WHERE id = $1', [String(id ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== actor) {
    if (rows[0].status !== 'published') return { error: 'not_found' };
    if (!(await can(actor, 'content'))) return { error: 'not_allowed' };
  }
  const eps = await query('SELECT id, owner_id FROM film_movies WHERE series_id = $1', [id]);
  // Файлы серий убирает штатное удаление фильма; «чужие» серии (снятие администрацией) — от имени владельца.
  const { removeMovieFiles } = await import('./filmstore.mjs');
  for (const e of eps.rows) await removeMovieFiles(e.id).catch(() => {});
  await query('DELETE FROM film_series WHERE id = $1', [id]);   // серии и сезоны уходят каскадом
  return { ok: true };
};

/* ─── Сезоны ───────────────────────────────────────────────────────── */

export const addSeason = async (seriesId, owner, { number, title } = {}) => {
  const o = await ownSeries(seriesId, owner);
  if (o.error) return o;
  const { rows } = await query('SELECT number FROM film_seasons WHERE series_id = $1 ORDER BY number', [seriesId]);
  if (rows.length >= MAX_SEASONS) return { error: 'too_many' };
  const n = num(number, 0, 99) ?? ((rows.at(-1)?.number ?? 0) + 1);
  if (rows.some((r) => r.number === n)) return { error: 'season_exists' };
  const id = newId('sea');
  await query('INSERT INTO film_seasons (id, series_id, number, title) VALUES ($1,$2,$3,$4)', [id, seriesId, n, text(title, 120)]);
  return { id, number: n };
};

export const updateSeason = async (seasonId, owner, { title, number } = {}) => {
  const { rows } = await query('SELECT s.*, x.owner_id FROM film_seasons s JOIN film_series x ON x.id = s.series_id WHERE s.id = $1', [String(seasonId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== owner) return { error: 'not_allowed' };
  const sets = []; const args = [seasonId];
  if (title !== undefined) { args.push(text(title, 120)); sets.push(`title = $${args.length}`); }
  if (number !== undefined) {
    const n = num(number, 0, 99);
    if (n === null) return { error: 'invalid_meta' };
    const dup = await query('SELECT 1 FROM film_seasons WHERE series_id=$1 AND number=$2 AND id<>$3', [rows[0].series_id, n, seasonId]);
    if (dup.rowCount) return { error: 'season_exists' };
    args.push(n); sets.push(`number = $${args.length}`);
  }
  if (sets.length) await query(`UPDATE film_seasons SET ${sets.join(', ')} WHERE id = $1`, args);
  return { ok: true };
};

export const deleteSeason = async (seasonId, owner) => {
  const { rows } = await query('SELECT s.id, x.owner_id FROM film_seasons s JOIN film_series x ON x.id = s.series_id WHERE s.id = $1', [String(seasonId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== owner) return { error: 'not_allowed' };
  const eps = await query('SELECT id FROM film_movies WHERE season_id = $1', [seasonId]);
  const { removeMovieFiles } = await import('./filmstore.mjs');
  for (const e of eps.rows) await removeMovieFiles(e.id).catch(() => {});
  await query('DELETE FROM film_seasons WHERE id = $1', [seasonId]);  // серии — каскадом
  return { ok: true };
};

/* ─── Серия ────────────────────────────────────────────────────────── */

/**
 * Привязать только что созданный фильм к сезону как серию. Вызывается сразу после createMovie.
 * Номер серии, не указанный явно, — следующий по порядку; занятый — отказ (`episode_exists`).
 */
export const assignEpisode = async (movieId, owner, { seasonId, epNo, introStart, introEnd } = {}) => {
  if (!SEASON_ID.test(String(seasonId ?? ''))) return { error: 'bad_season' };
  const { rows } = await query(
    `SELECT s.id, s.series_id, x.owner_id FROM film_seasons s JOIN film_series x ON x.id = s.series_id WHERE s.id = $1`, [seasonId]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== owner) return { error: 'not_allowed' };
  const cnt = await query('SELECT coalesce(max(ep_no),0)::int AS m, count(*)::int AS n FROM film_movies WHERE season_id = $1', [seasonId]);
  if (cnt.rows[0].n >= MAX_EPISODES_PER_SEASON) return { error: 'too_many' };
  const n = num(epNo, 1, 9999) ?? (cnt.rows[0].m + 1);
  const dup = await query('SELECT 1 FROM film_movies WHERE season_id=$1 AND ep_no=$2 AND id<>$3', [seasonId, n, movieId]);
  if (dup.rowCount) return { error: 'episode_exists' };
  const a = num(introStart, 0, 86400); const b = num(introEnd, 0, 86400);
  const intro = a !== null && b !== null && b > a ? [a, b] : [null, null];
  const r = await query(
    `UPDATE film_movies SET series_id=$3, season_id=$4, ep_no=$5, intro_start_sec=$6, intro_end_sec=$7, updated_at=now()
      WHERE id=$1 AND owner_id=$2`, [movieId, owner, rows[0].series_id, seasonId, n, intro[0], intro[1]]);
  return r.rowCount ? { ok: true, epNo: n, seriesId: rows[0].series_id } : { error: 'not_found' };
};

/** Правка серии: номер, сезон (в пределах того же сериала), заставка. */
export const updateEpisode = async (movieId, owner, patch = {}) => {
  const { rows } = await query('SELECT id, owner_id, series_id, season_id, ep_no FROM film_movies WHERE id = $1', [String(movieId ?? '')]);
  const m = rows[0];
  if (!m || !m.series_id) return { error: 'not_found' };
  if (m.owner_id !== owner) return { error: 'not_allowed' };
  let seasonId = m.season_id; let epNo = m.ep_no;
  if (patch.seasonId !== undefined) {
    const s = await query('SELECT 1 FROM film_seasons WHERE id=$1 AND series_id=$2', [String(patch.seasonId), m.series_id]);
    if (!s.rowCount) return { error: 'bad_season' };
    seasonId = patch.seasonId;
  }
  if (patch.epNo !== undefined) { epNo = num(patch.epNo, 1, 9999); if (epNo === null) return { error: 'invalid_meta' }; }
  const dup = await query('SELECT 1 FROM film_movies WHERE season_id=$1 AND ep_no=$2 AND id<>$3', [seasonId, epNo, movieId]);
  if (dup.rowCount) return { error: 'episode_exists' };
  const sets = ['season_id=$2', 'ep_no=$3']; const args = [movieId, seasonId, epNo];
  if (patch.introStart !== undefined || patch.introEnd !== undefined) {
    const a = patch.introStart === null ? null : num(patch.introStart, 0, 86400);
    const b = patch.introEnd === null ? null : num(patch.introEnd, 0, 86400);
    if ((a === null) !== (b === null) || (a !== null && b <= a)) return { error: 'bad_intro' };
    args.push(a, b); sets.push(`intro_start_sec=$${args.length - 1}`, `intro_end_sec=$${args.length}`);
  }
  await query(`UPDATE film_movies SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, args);
  return { ok: true };
};

/* ─── Чтение ───────────────────────────────────────────────────────── */

export const listSeriesCatalog = async (viewerId, { q, limit, offset } = {}) => {
  const lim = num(limit, 1, 100) ?? 50; const off = num(offset, 0, 100000) ?? 0;
  const args = [viewerId ?? '', lim, off];
  const where = [`s.status = 'published'`, `EXISTS (SELECT 1 FROM film_movies e WHERE e.series_id = s.id AND e.status = 'published')`];
  const needle = text(q, 100).toLowerCase();
  if (needle) { args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`); where.push(`(lower(s.title) LIKE $${args.length} ESCAPE '\\' OR lower(s.genre) LIKE $${args.length} ESCAPE '\\')`); }
  const { rows } = await query(`${SELECT_SERIES} WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC LIMIT $2 OFFSET $3`, args);
  return rows.map((r) => toSeries(r, viewerId));
};

export const listMySeries = async (owner) => {
  const { rows } = await query(`${SELECT_SERIES} WHERE s.owner_id = $1 ORDER BY s.created_at DESC LIMIT 200`, [owner]);
  return rows.map((r) => toSeries(r, owner));
};

const EP_SELECT = `
  SELECT m.*, m.owner_id = $1 AS own,
         (SELECT g.position_sec FROM film_progress g WHERE g.movie_id = m.id AND g.user_id = $1) AS position_sec,
         (SELECT g.updated_at FROM film_progress g WHERE g.movie_id = m.id AND g.user_id = $1) AS watched_at,
         (SELECT g.duration_sec FROM film_progress g WHERE g.movie_id = m.id AND g.user_id = $1) AS progress_duration,
         (SELECT count(*) FROM film_subtitles t WHERE t.movie_id = m.id) AS subs
    FROM film_movies m`;

const toEpisode = (r) => ({
  ...toMovie(r),
  seriesId: r.series_id, seasonId: r.season_id, epNo: r.ep_no,
  introStart: r.intro_start_sec ?? undefined, introEnd: r.intro_end_sec ?? undefined,
  subtitles: Number(r.subs ?? 0) || undefined,
  watchedAt: r.watched_at?.toISOString?.() ?? undefined,
  progressDuration: r.progress_duration == null ? undefined : Number(r.progress_duration),
});

/** Сериал целиком: сезоны, серии, на чём остановились и что смотреть дальше. */
export const readSeries = async (id, viewerId) => {
  if (!isSeriesId(id)) return null;
  const { rows } = await query(`${SELECT_SERIES} WHERE s.id = $2`, [viewerId ?? '', id]);
  if (!rows[0] || !canSeeSeries(rows[0], viewerId)) return null;
  const series = toSeries(rows[0], viewerId);
  const seasons = (await query('SELECT * FROM film_seasons WHERE series_id = $1 ORDER BY number', [id])).rows;
  const eps = (await query(
    `${EP_SELECT} WHERE m.series_id = $2 AND (m.status = 'published' OR m.owner_id = $1) ORDER BY m.ep_no`,
    [viewerId ?? '', id])).rows.map(toEpisode);
  const bySeason = new Map(seasons.map((s) => [s.id, { id: s.id, number: s.number, title: s.title, episodes: [] }]));
  for (const e of eps) bySeason.get(e.seasonId)?.episodes.push(e);
  const list = [...bySeason.values()];
  const flat = list.flatMap((s) => s.episodes);
  return { series, seasons: list, resume: resumePoint(flat) };
};

/**
 * Что смотреть дальше: последняя начатая серия; если досмотрена (≥ 92 % или ≤ 20 с до конца) —
 * следующая; если ничего не начато — первая. Прогресс общий для всех устройств человека.
 */
const resumePoint = (flat) => {
  if (!flat.length) return null;
  const started = flat.filter((e) => e.watchedAt).sort((a, b) => (b.watchedAt > a.watchedAt ? 1 : -1))[0];
  if (!started) return { episodeId: flat[0].id, position: 0, fresh: true };
  const dur = started.progressDuration || started.duration || 0; const pos = started.position ?? 0;
  const done = dur > 0 && (pos >= dur * 0.92 || dur - pos <= 20);
  if (!done) return { episodeId: started.id, position: pos };
  const i = flat.findIndex((e) => e.id === started.id);
  const next = flat[i + 1];
  return next ? { episodeId: next.id, position: 0, next: true } : { episodeId: started.id, position: 0, finished: true };
};

/** Следующая серия после данной — для автоперехода. Переходит из сезона в сезон. */
export const nextEpisode = async (movieId, viewerId) => {
  const cur = await visibleMovie(movieId, viewerId);
  if (!cur || !cur.series_id) return null;
  const { rows } = await query(
    `${EP_SELECT} JOIN film_seasons z ON z.id = m.season_id
      WHERE m.series_id = $2 AND (m.status='published' OR m.owner_id=$1)
        AND (z.number, m.ep_no) > (SELECT z2.number, m2.ep_no FROM film_movies m2 JOIN film_seasons z2 ON z2.id=m2.season_id WHERE m2.id=$3)
      ORDER BY z.number, m.ep_no LIMIT 1`, [viewerId ?? '', cur.series_id, movieId]);
  return rows[0] ? toEpisode(rows[0]) : null;
};

/* ─── Публикация и проверка ────────────────────────────────────────── */

export const submitSeries = async (id, owner, opts = {}) => {
  const o = await ownSeries(id, owner);
  if (o.error) return o;
  if (o.row.status === 'pending') return { error: 'already_pending' };
  const eps = (await query(`SELECT id, status FROM film_movies WHERE series_id=$1 AND bytes > 0`, [id])).rows;
  const toSend = eps.filter((e) => e.status === 'private' || e.status === 'rejected');
  if (!eps.length) return { error: 'no_episodes' };
  if (!toSend.length && o.row.status === 'published') return { error: 'already_published' };
  let sent = 0;
  for (const e of toSend) { const r = await submitMovie(e.id, owner, opts); if (r.ok) sent++; }
  if (!sent && o.row.status !== 'published') return { error: 'no_episodes' };
  await query(`UPDATE film_series SET status = CASE WHEN status='published' THEN status ELSE 'pending' END,
                 submitted_at=now(), reject_reason=NULL, updated_at=now() WHERE id=$1`, [id]);
  return { ok: true, sent };
};

/** Решение по сериалу целиком: одобрить — опубликовать сериал и все ждущие серии; отклонить — вернуть владельцу. */
export const moderateSeries = async (id, adminId, { approve, reason } = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT status FROM film_series WHERE id=$1', [String(id ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].status !== 'pending') return { error: 'not_pending' };
  const pend = (await query(`SELECT id FROM film_movies WHERE series_id=$1 AND status='pending'`, [id])).rows;
  for (const e of pend) await moderateMovie(e.id, adminId, { approve: approve === true, reason });
  const why = text(reason, MAX_REASON);
  if (approve === true) {
    await query(`UPDATE film_series SET status='published', moderated_at=now(), moderated_by=$2, reject_reason=NULL, updated_at=now() WHERE id=$1 AND status='pending'`, [id, adminId]);
    return { ok: true, status: 'published' };
  }
  await query(`UPDATE film_series SET status='rejected', moderated_at=now(), moderated_by=$2, reject_reason=$3, updated_at=now() WHERE id=$1 AND status='pending'`,
    [id, adminId, why ? encryptContent(why) : null]);
  return { ok: true, status: 'rejected' };
};

export const seriesQueue = async (adminId) => {
  if (!(await can(adminId, 'content'))) return [];
  const { rows } = await query(`${SELECT_SERIES} WHERE s.status = 'pending' ORDER BY s.submitted_at LIMIT 100`, [adminId]);
  return rows.map((r) => toSeries(r, adminId));
};

/* ─── Субтитры (WebVTT / SRT) ──────────────────────────────────────── */

const LANGS = { ru: 'Русский', en: 'English', uk: 'Українська', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', pt: 'Português', tr: 'Türkçe', zh: '中文', ja: '日本語', ko: '한국어', ar: 'العربية' };

/** SRT → WebVTT: запятая в метках времени, заголовок. Уже готовый WebVTT проходит как есть. */
export const toVtt = (raw) => {
  let s = String(raw ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!s) return null;
  if (!s.startsWith('WEBVTT')) s = 'WEBVTT\n\n' + s.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return /-->/.test(s) ? s + '\n' : null;
};

export const setSubtitle = async (movieId, owner, { lang, label, content } = {}) => {
  const l = String(lang ?? '').toLowerCase();
  if (!LANGS[l]) return { error: 'bad_lang' };
  if (Buffer.byteLength(String(content ?? '')) > MAX_VTT_BYTES) return { error: 'file_too_large' };
  const vtt = toVtt(content);
  if (!vtt) return { error: 'bad_subtitles' };
  const m = await query('SELECT owner_id FROM film_movies WHERE id=$1', [String(movieId ?? '')]);
  if (!m.rows[0]) return { error: 'not_found' };
  if (m.rows[0].owner_id !== owner) return { error: 'not_allowed' };
  const cnt = await query('SELECT count(*)::int AS n FROM film_subtitles WHERE movie_id=$1 AND lang<>$2', [movieId, l]);
  if (cnt.rows[0].n >= 10) return { error: 'too_many' };
  await query(`INSERT INTO film_subtitles (movie_id, lang, label, vtt) VALUES ($1,$2,$3,$4)
               ON CONFLICT (movie_id, lang) DO UPDATE SET label=EXCLUDED.label, vtt=EXCLUDED.vtt`,
    [movieId, l, text(label, 40) || LANGS[l], vtt]);
  return { ok: true };
};

export const deleteSubtitle = async (movieId, owner, lang) => {
  const m = await query('SELECT owner_id FROM film_movies WHERE id=$1', [String(movieId ?? '')]);
  if (!m.rows[0]) return { error: 'not_found' };
  if (m.rows[0].owner_id !== owner) return { error: 'not_allowed' };
  await query('DELETE FROM film_subtitles WHERE movie_id=$1 AND lang=$2', [movieId, String(lang ?? '').toLowerCase()]);
  return { ok: true };
};

export const listSubtitles = async (movieId, viewerId) => {
  if (!(await visibleMovie(movieId, viewerId))) return null;
  const { rows } = await query('SELECT lang, label FROM film_subtitles WHERE movie_id=$1 ORDER BY lang', [movieId]);
  return rows;
};

export const readSubtitle = async (movieId, lang, viewerId) => {
  if (!(await visibleMovie(movieId, viewerId))) return null;
  const { rows } = await query('SELECT vtt FROM film_subtitles WHERE movie_id=$1 AND lang=$2', [movieId, String(lang ?? '').toLowerCase()]);
  return rows[0]?.vtt ?? null;
};

