/**
 * Sky Podcasts: данные и права.
 *
 * Каждая функция сама решает, можно ли этому человеку то, что он
 * просит. Клиент присылает только идентификаторы, а кому что видно —
 * знает сервер.
 *
 * Правила:
 *   • передача видна всем, если опубликована; иначе — только автору;
 *   • выпуск виден, если видна его передача и сам выпуск выложен;
 *     черновик в опубликованной передаче — дело автора;
 *   • транскрипт и пересказ следуют за выпуском: доступен выпуск —
 *     доступны и они, недоступен — нет;
 *   • позиция, подписки, избранное и история — строго свои. Ключ этих
 *     таблиц включает профиль, и он берётся из сессии, а не из запроса.
 */
import crypto from 'node:crypto';
import { notifyStaff } from './staffnotify.mjs';
import { query, pool } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { can } from './admin.mjs';
import {
  removeEpisodeFiles, removeShowFiles, listStoredIds, remove as removeStoredFile,
} from './podcaststore.mjs';

const newId = (p) => `${p}-${crypto.randomUUID()}`;

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 5000;
const MAX_SHORT = 60;
const MAX_REASON = 500;
const MAX_CUE = 1000;
/** Сутки: всё, что длиннее, — ошибка в метаданных, а не выпуск. */
const MAX_DURATION = 86400;
const MAX_EPISODES = 2000;
const MAX_CUES = 20000;

const text = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

const num = (v, min, max) => {
  if (v === null || v === undefined || v === '' || typeof v === 'object') return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
};

export const CATEGORIES = [
  'Технологии', 'Бизнес', 'Наука', 'Культура', 'Общество',
  'Игры', 'Дизайн', 'Здоровье', 'История', 'Спорт', 'Другое',
];

/* ─── Представление наружу ─────────────────────────────────────────── */

/**
 * Передача в том виде, в каком её ждёт клиент. Служебных полей нет:
 * ни путей, ни внутренних отметок — только то, что нужно показать.
 */
export const toPodcast = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description ? (decryptContent(row.description) ?? '') : undefined,
  category: row.category,
  language: row.language,
  accent: row.accent,
  hasCover: Boolean(row.has_cover),
  status: row.status,
  private: row.status !== 'published',
  explicit: row.explicit === true || undefined,
  episodes: Number(row.episode_count ?? 0),
  subscribers: Number(row.subscriber_count ?? 0),
  hosts: row.hosts ?? undefined,
  own: row.own === true || undefined,
  subscribed: row.subscribed === true || undefined,
  favorite: row.favorite === true || undefined,
  createdAt: row.created_at?.toISOString?.(),
  // Причину отказа видит только автор: это разговор с ним.
  rejectReason: row.own === true && row.reject_reason
    ? (decryptContent(row.reject_reason) ?? undefined) : undefined,
});

export const toEpisode = (row) => ({
  id: row.id,
  podcastId: row.podcast_id,
  podcastTitle: row.podcast_title ?? undefined,
  number: row.number ?? undefined,
  title: row.title,
  description: row.description ? (decryptContent(row.description) ?? '') : undefined,
  duration: Number(row.duration_sec ?? 0),
  /** Что вообще есть у выпуска — по этому экран решает, что предложить. */
  hasAudio: Number(row.audio_bytes ?? 0) > 0,
  hasVideo: Number(row.video_bytes ?? 0) > 0,
  videoWidth: Number(row.video_width ?? 0) || undefined,
  videoHeight: Number(row.video_height ?? 0) || undefined,
  hasCover: Boolean(row.has_cover),
  hasTranscript: Number(row.cue_count ?? 0) > 0,
  hasSummary: row.has_summary === true || undefined,
  explicit: row.explicit === true || undefined,
  published: row.published === true,
  plays: Number(row.plays ?? 0),
  accent: row.accent ?? undefined,
  own: row.own === true || undefined,
  favorite: row.favorite === true || undefined,
  position: row.position_sec == null ? undefined : Number(row.position_sec),
  completed: row.completed === true || undefined,
  createdAt: row.created_at?.toISOString?.(),
});

/**
 * Общая выборка передачи. Первым параметром всегда идёт тот, кто
 * спрашивает: от него зависят «своё», «подписан», «в избранном».
 * Порядок держим одинаковым во всех запросах — разъехавшаяся
 * нумерация $-параметров однажды уже давала чужой идентификатор в
 * чужой выборке.
 */
const SELECT_PODCAST = `
  SELECT p.*,
         p.owner_id = $1 AS own,
         (SELECT count(*) FROM podcast_episodes e
           WHERE e.podcast_id = p.id AND (e.published OR p.owner_id = $1)) AS episode_count,
         (SELECT count(*) FROM podcast_subscriptions s WHERE s.podcast_id = p.id) AS subscriber_count,
         EXISTS (SELECT 1 FROM podcast_subscriptions s
                  WHERE s.podcast_id = p.id AND s.user_id = $1) AS subscribed,
         EXISTS (SELECT 1 FROM podcast_favorites f
                  WHERE f.podcast_id = p.id AND f.user_id = $1) AS favorite,
         (SELECT coalesce(json_agg(json_build_object('name', h.name, 'role', h.role)
                                   ORDER BY h.position, h.name), '[]'::json)
            FROM podcast_hosts h WHERE h.podcast_id = p.id) AS hosts
    FROM podcasts p
`;

const SELECT_EPISODE = `
  SELECT e.*, p.title AS podcast_title, p.accent, p.owner_id,
         p.owner_id = $1 AS own,
         (SELECT count(*) FROM podcast_cues c WHERE c.episode_id = e.id) AS cue_count,
         EXISTS (SELECT 1 FROM podcast_summaries s WHERE s.episode_id = e.id) AS has_summary,
         EXISTS (SELECT 1 FROM podcast_favorites f
                  WHERE f.episode_id = e.id AND f.user_id = $1) AS favorite,
         g.position_sec, g.completed
    FROM podcast_episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    LEFT JOIN podcast_progress g ON g.episode_id = e.id AND g.user_id = $1
`;

/* ─── Доступ ───────────────────────────────────────────────────────── */

/**
 * Строка передачи, если этот человек имеет право её видеть.
 *
 * Через неё проходит всё. Администратор видит отправленное на проверку
 * — иначе разбирать заявки некому, — но не чужие черновики: передача,
 * которую автор не показывал никому, не его дело.
 */
export const visiblePodcast = async (podcastId, viewerId) => {
  const { rows } = await query('SELECT * FROM podcasts WHERE id = $1', [String(podcastId ?? '')]);
  const row = rows[0];
  if (!row) return null;
  if (row.owner_id && row.owner_id === viewerId) return { ...row, own: true };
  if (row.status === 'published') return row;
  if (row.status === 'pending' && await can(viewerId, 'content')) return row;
  // Чужая закрытая передача неотличима от несуществующей: разница в
  // ответах сама по себе выдаёт, что она есть.
  return null;
};

/**
 * Строка выпуска, если его можно видеть. Два условия сразу: видна
 * передача и выложен сам выпуск.
 */
export const visibleEpisode = async (episodeId, viewerId) => {
  const { rows } = await query(
    `SELECT e.*, p.owner_id, p.status AS podcast_status
       FROM podcast_episodes e JOIN podcasts p ON p.id = e.podcast_id
      WHERE e.id = $1`,
    [String(episodeId ?? '')]);
  const row = rows[0];
  if (!row) return null;
  if (row.owner_id && row.owner_id === viewerId) return { ...row, own: true };
  if (row.podcast_status === 'published' && row.published) return row;
  if (row.podcast_status === 'pending' && await can(viewerId, 'content')) return row;
  return null;
};

/* ─── Каталог ──────────────────────────────────────────────────────── */

const PUBLIC_ONLY = "p.status = 'published'";

const searchClause = (q, args, columns) => {
  const needle = text(q, 100).toLowerCase();
  if (!needle) return null;
  args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`);
  const n = args.length;
  return `(${columns.map((c) => `lower(${c}) LIKE $${n} ESCAPE '\\'`).join(' OR ')})`;
};

export const listPodcasts = async (viewerId, { q, category, limit, offset, sort } = {}) => {
  const lim = num(limit, 1, 100) ?? 40;
  const off = num(offset, 0, 100000) ?? 0;
  const args = [viewerId ?? '', lim, off];
  const where = [PUBLIC_ONLY];

  const cat = text(category, MAX_SHORT);
  if (cat && cat !== 'Все') { args.push(cat); where.push(`p.category = $${args.length}`); }

  // Ведущие ищутся вместе с названием: человек помнит «подкаст Луны»,
  // а не его название.
  const s = searchClause(q, args, ['p.title', 'p.category',
    "(SELECT string_agg(h.name, ' ') FROM podcast_hosts h WHERE h.podcast_id = p.id)"]);
  if (s) where.push(s);

  // Порядок задаётся набором, а не строкой из запроса.
  const order = sort === 'popular' ? 'subscriber_count DESC, p.created_at DESC'
    : sort === 'episodes' ? 'episode_count DESC, p.created_at DESC'
      : 'p.created_at DESC';

  const { rows } = await query(
    `${SELECT_PODCAST} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $2 OFFSET $3`, args);
  return rows.map(toPodcast);
};

export const readPodcast = async (podcastId, viewerId) => {
  if (!(await visiblePodcast(podcastId, viewerId))) return null;
  const { rows } = await query(`${SELECT_PODCAST} WHERE p.id = $2`,
    [viewerId ?? '', String(podcastId ?? '')]);
  return rows[0] ? toPodcast(rows[0]) : null;
};

export const listCategories = async () => {
  const { rows } = await query(
    `SELECT category, count(*)::int AS n FROM podcasts
      WHERE status = 'published' GROUP BY category ORDER BY n DESC, category`);
  return rows.map((r) => ({ name: r.category, count: r.n }));
};

/** Свои передачи: всё своё, в любом состоянии. */
export const listMine = async (ownerId) => {
  const { rows } = await query(
    `${SELECT_PODCAST} WHERE p.owner_id = $1 ORDER BY p.created_at DESC LIMIT 200`, [ownerId]);
  return rows.map(toPodcast);
};

/* ─── Выпуски ──────────────────────────────────────────────────────── */

export const listEpisodes = async (podcastId, viewerId, { q, limit, offset } = {}) => {
  const show = await visiblePodcast(podcastId, viewerId);
  if (!show) return null;
  const lim = num(limit, 1, 200) ?? 100;
  const off = num(offset, 0, 100000) ?? 0;
  const args = [viewerId ?? '', String(podcastId ?? ''), lim, off];

  /*
   * Черновики видит только автор — условие в самом запросе, а не отсев
   * после: так его нельзя забыть.
   *
   * И одно исключение: передача, отправленная на проверку. Все её
   * выпуски ещё черновики, поэтому администратор видел пустую заявку и
   * судил о передаче по названию. Это не проверка, а штамп. Право
   * смотреть отправленное на проверку у него уже есть — оно записано в
   * visiblePodcast и в visibleEpisode, — здесь оно просто не было
   * доведено до списка.
   */
  const forReview = show.status === 'pending' && await can(viewerId, 'content');
  const where = ['e.podcast_id = $2',
    forReview ? 'TRUE' : '(e.published OR p.owner_id = $1)'];
  const s = searchClause(q, args, ['e.title']);
  if (s) where.push(s);

  const { rows } = await query(
    `${SELECT_EPISODE} WHERE ${where.join(' AND ')}
      ORDER BY e.number DESC NULLS LAST, e.created_at DESC LIMIT $3 OFFSET $4`, args);
  return rows.map(toEpisode);
};

export const readEpisode = async (episodeId, viewerId) => {
  if (!(await visibleEpisode(episodeId, viewerId))) return null;
  const { rows } = await query(`${SELECT_EPISODE} WHERE e.id = $2`,
    [viewerId ?? '', String(episodeId ?? '')]);
  return rows[0] ? toEpisode(rows[0]) : null;
};

/**
 * Похожие выпуски: сначала из той же передачи, потом из той же
 * категории. Выдумывать сходство мы не умеем и не делаем вид.
 */
export const similarEpisodes = async (episodeId, viewerId, { limit } = {}) => {
  const row = await visibleEpisode(episodeId, viewerId);
  if (!row) return [];
  const lim = num(limit, 1, 20) ?? 6;
  const { rows } = await query(
    `${SELECT_EPISODE}
      WHERE e.id <> $2 AND e.published AND p.status = 'published'
        AND (e.podcast_id = $3 OR p.category = (SELECT category FROM podcasts WHERE id = $3))
      ORDER BY (e.podcast_id = $3) DESC, e.created_at DESC LIMIT $4`,
    [viewerId ?? '', String(episodeId), row.podcast_id, lim]);
  return rows.map(toEpisode);
};

/** Поиск по выпускам всего каталога — для общего поиска на главной. */
export const searchEpisodes = async (viewerId, { q, limit } = {}) => {
  const needle = text(q, 100);
  if (!needle) return [];
  const lim = num(limit, 1, 50) ?? 20;
  const args = [viewerId ?? '', `%${needle.toLowerCase().replace(/([\\%_])/g, '\\$1')}%`, lim];
  const { rows } = await query(
    `${SELECT_EPISODE}
      WHERE e.published AND p.status = 'published'
        AND (lower(e.title) LIKE $2 ESCAPE '\\' OR lower(p.title) LIKE $2 ESCAPE '\\')
      ORDER BY e.created_at DESC LIMIT $3`, args);
  return rows.map(toEpisode);
};

/* ─── Создание и правка ────────────────────────────────────────────── */

export const createPodcast = async (ownerId, meta) => {
  const title = text(meta.title, MAX_TITLE);
  if (!title) return { error: 'invalid_meta' };
  const { rows: cnt } = await query(
    'SELECT count(*)::int AS n FROM podcasts WHERE owner_id = $1', [ownerId]);
  if ((cnt[0]?.n ?? 0) >= 100) return { error: 'too_many' };

  const description = text(meta.description, MAX_DESCRIPTION);
  const id = newId('pod');
  await query(
    `INSERT INTO podcasts (id, owner_id, title, description, category, language, accent, explicit, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'private')`,
    [id, ownerId, title,
      description ? encryptContent(description) : null,
      CATEGORIES.includes(text(meta.category, MAX_SHORT)) ? text(meta.category, MAX_SHORT) : 'Другое',
      text(meta.language, 8) || 'ru',
      /^#[0-9a-f]{6}$/i.test(String(meta.accent ?? '')) ? String(meta.accent) : '#a855f7',
      meta.explicit === true]);

  // Автор — первый ведущий: передача без единого имени выглядит
  // брошенной, а имя автора у нас уже есть.
  const { rows: who } = await query('SELECT name FROM profiles WHERE id = $1', [ownerId]);
  if (who[0]?.name) {
    await query(
      `INSERT INTO podcast_hosts (podcast_id, profile_id, name, role, position)
       VALUES ($1,$2,$3,'Ведущий',0) ON CONFLICT DO NOTHING`,
      [id, ownerId, text(who[0].name, MAX_TITLE)]);
  }
  return { id };
};

export const updatePodcast = async (podcastId, ownerId, patch) => {
  const { rows } = await query('SELECT owner_id, status FROM podcasts WHERE id = $1',
    [String(podcastId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== ownerId) return { error: 'not_allowed' };

  const sets = [];
  const args = [podcastId];
  const put = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };

  if (patch.title !== undefined) {
    const t = text(patch.title, MAX_TITLE);
    if (!t) return { error: 'invalid_meta' };
    put('title', t);
  }
  if (patch.description !== undefined) {
    const d = text(patch.description, MAX_DESCRIPTION);
    put('description', d ? encryptContent(d) : null);
  }
  if (patch.category !== undefined) {
    const c = text(patch.category, MAX_SHORT);
    put('category', CATEGORIES.includes(c) ? c : 'Другое');
  }
  if (patch.accent !== undefined && /^#[0-9a-f]{6}$/i.test(String(patch.accent))) {
    put('accent', String(patch.accent));
  }
  if (patch.explicit !== undefined) put('explicit', patch.explicit === true);
  if (patch.status !== undefined) {
    // Снять с публикации автор может сам. Выложить — нет: туда передача
    // попадает только через проверку.
    if (String(patch.status) === 'private') { put('status', 'private'); put('submitted_at', null); }
    else return { error: 'invalid_status' };
  }
  if (sets.length === 0) return { ok: true };
  await query(`UPDATE podcasts SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  return { ok: true };
};

/** Ведущие передачи. Меняет только автор, и только целым списком. */
export const setHosts = async (podcastId, ownerId, hosts) => {
  const { rows } = await query('SELECT owner_id FROM podcasts WHERE id = $1', [String(podcastId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== ownerId) return { error: 'not_allowed' };
  if (!Array.isArray(hosts)) return { error: 'invalid_hosts' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM podcast_hosts WHERE podcast_id = $1', [podcastId]);
    let pos = 0;
    for (const h of hosts.slice(0, 12)) {
      const name = text(h?.name ?? h, MAX_TITLE);
      if (!name) continue;
      await client.query(
        `INSERT INTO podcast_hosts (podcast_id, name, role, position)
         VALUES ($1,$2,$3,$4) ON CONFLICT (podcast_id, name) DO NOTHING`,
        [podcastId, name, text(h?.role, MAX_SHORT) || 'Ведущий', pos]);
      pos += 1;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
};

export const createEpisode = async (podcastId, ownerId, meta) => {
  const { rows } = await query('SELECT owner_id FROM podcasts WHERE id = $1', [String(podcastId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== ownerId) return { error: 'not_allowed' };

  const title = text(meta.title, MAX_TITLE);
  if (!title) return { error: 'invalid_meta' };
  const { rows: cnt } = await query(
    'SELECT count(*)::int AS n FROM podcast_episodes WHERE podcast_id = $1', [podcastId]);
  if ((cnt[0]?.n ?? 0) >= MAX_EPISODES) return { error: 'too_many' };

  const description = text(meta.description, MAX_DESCRIPTION);
  const id = newId('pep');
  await query(
    `INSERT INTO podcast_episodes (id, podcast_id, number, title, description, duration_sec, explicit, published)
     VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE)`,
    [id, podcastId, num(meta.number, 0, 100000), title,
      description ? encryptContent(description) : null,
      num(meta.duration, 0, MAX_DURATION) ?? 0,
      meta.explicit === true]);
  return { id };
};

export const updateEpisode = async (episodeId, ownerId, patch) => {
  const { rows } = await query(
    `SELECT e.id, p.owner_id FROM podcast_episodes e JOIN podcasts p ON p.id = e.podcast_id
      WHERE e.id = $1`, [String(episodeId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== ownerId) return { error: 'not_allowed' };

  const sets = [];
  const args = [episodeId];
  const put = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };

  if (patch.title !== undefined) {
    const t = text(patch.title, MAX_TITLE);
    if (!t) return { error: 'invalid_meta' };
    put('title', t);
  }
  if (patch.description !== undefined) {
    const d = text(patch.description, MAX_DESCRIPTION);
    put('description', d ? encryptContent(d) : null);
  }
  if (patch.number !== undefined) put('number', num(patch.number, 0, 100000));
  if (patch.duration !== undefined) put('duration_sec', num(patch.duration, 0, MAX_DURATION) ?? 0);
  if (patch.explicit !== undefined) put('explicit', patch.explicit === true);
  if (patch.published !== undefined) put('published', patch.published === true);
  if (sets.length === 0) return { ok: true };
  await query(`UPDATE podcast_episodes SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  return { ok: true };
};

/** Размер и тип проставляются по факту записи, а не по словам клиента. */
export const finishMedia = async (episodeId, ownerId, kind, { bytes, mime, width, height }) => {
  const col = kind === 'video' ? 'video' : 'audio';
  const args = [episodeId, ownerId, Math.max(0, Number(bytes) || 0), String(mime)];
  // Ширина и кадр дописываются только у видео, и номера параметров
  // считаются от длины списка, а не проставляются руками: разъехавшаяся
  // нумерация — это молча записанное не в ту колонку.
  let extra = '';
  if (kind === 'video') {
    args.push(num(width, 0, 16384) ?? 0, num(height, 0, 16384) ?? 0);
    extra = `, video_width = $${args.length - 1}, video_height = $${args.length}`;
  }
  const { rowCount } = await query(
    `UPDATE podcast_episodes e SET ${col}_bytes = $3, ${col}_mime = $4${extra}, updated_at = now()
      FROM podcasts p WHERE e.podcast_id = p.id AND e.id = $1 AND p.owner_id = $2`,
    args);
  return rowCount > 0;
};

export const setPodcastCover = async (podcastId, ownerId, mime) => {
  const { rowCount } = await query(
    'UPDATE podcasts SET has_cover = TRUE, cover_mime = $3, updated_at = now() WHERE id = $1 AND owner_id = $2',
    [podcastId, ownerId, String(mime)]);
  return rowCount > 0;
};

export const setEpisodeCover = async (episodeId, ownerId, mime) => {
  const { rowCount } = await query(
    `UPDATE podcast_episodes e SET has_cover = TRUE, cover_mime = $3, updated_at = now()
      FROM podcasts p WHERE e.podcast_id = p.id AND e.id = $1 AND p.owner_id = $2`,
    [episodeId, ownerId, String(mime)]);
  return rowCount > 0;
};

export const deleteEpisode = async (episodeId, actorId) => {
  const { rows } = await query(
    `SELECT e.id, p.owner_id, p.status FROM podcast_episodes e JOIN podcasts p ON p.id = e.podcast_id
      WHERE e.id = $1`, [String(episodeId ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.owner_id !== actorId) {
    // Администратор убирает только опубликованное — то, что сам же и
    // пропустил. Чужой черновик не его дело.
    if (row.status !== 'published') return { error: 'not_found' };
    if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  }
  await query('DELETE FROM podcast_episodes WHERE id = $1', [episodeId]);
  await removeEpisodeFiles(episodeId).catch(() => {});
  return { ok: true };
};

export const deletePodcast = async (podcastId, actorId) => {
  const { rows } = await query('SELECT owner_id, status FROM podcasts WHERE id = $1',
    [String(podcastId ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.owner_id !== actorId) {
    if (row.status !== 'published') return { error: 'not_found' };
    if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  }
  const { rows: eps } = await query('SELECT id FROM podcast_episodes WHERE podcast_id = $1', [podcastId]);
  await query('DELETE FROM podcasts WHERE id = $1', [podcastId]);
  for (const e of eps) await removeEpisodeFiles(e.id).catch(() => {});
  await removeShowFiles(podcastId).catch(() => {});
  return { ok: true };
};

/* ─── Проверка перед публикацией ───────────────────────────────────── */

export const submitPodcast = async (podcastId, ownerId) => {
  const { rows } = await query(
    `SELECT p.owner_id, p.status,
            (SELECT count(*) FROM podcast_episodes e
              WHERE e.podcast_id = p.id AND (e.audio_bytes > 0 OR e.video_bytes > 0)) AS ready
       FROM podcasts p WHERE p.id = $1`, [String(podcastId ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.owner_id !== ownerId) return { error: 'not_allowed' };
  if (row.status === 'pending') return { error: 'already_pending' };
  if (row.status === 'published') return { error: 'already_published' };
  // Передача без единого выпуска с файлом в каталоге бесполезна: её
  // откроют и увидят пустоту.
  if (Number(row.ready) === 0) return { error: 'no_episodes' };

  const { rowCount } = await query(
    `UPDATE podcasts SET status = 'pending', submitted_at = now(), reject_reason = NULL,
            updated_at = now()
      WHERE id = $1 AND status IN ('private','rejected')`, [podcastId]);
  // Условие стоит в самом UPDATE: из нескольких одновременных нажатий
  // срабатывает ровно одно.
  if (rowCount === 0) return { error: 'already_pending' };
  void notifyStaff('content', { title: 'Новый подкаст на проверке', body: 'Передача ждёт решения в разделе «Контент».', dedupe: `podcast:${podcastId}` });
  return { ok: true };
};

export const moderationQueue = async (adminId, { limit } = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const lim = num(limit, 1, 200) ?? 100;
  const { rows } = await query(
    `${SELECT_PODCAST} WHERE p.status = 'pending'
      ORDER BY p.submitted_at ASC NULLS LAST LIMIT $2`, [adminId, lim]);

  /*
   * Сколько в заявке выпусков — считаем отдельно и по всем.
   *
   * Обычный счёт берёт только выложенные да свои, а у передачи на
   * проверке выложенных нет ни одного: в очереди стояло «0 вып.» у
   * передачи с выпусками. Число, которое всегда ноль, хуже, чем
   * отсутствие числа, — по нему принимают решение.
   */
  const counts = new Map();
  if (rows.length > 0) {
    const { rows: c } = await query(
      `SELECT podcast_id, count(*)::int AS n FROM podcast_episodes
        WHERE podcast_id = ANY($1) GROUP BY podcast_id`,
      [rows.map((r) => r.id)]);
    for (const row of c) counts.set(row.podcast_id, row.n);
  }
  return {
    podcasts: rows.map((r) => ({ ...toPodcast(r), episodes: counts.get(r.id) ?? 0 })),
  };
};

export const moderatePodcast = async (podcastId, adminId, { approve, reason } = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT status FROM podcasts WHERE id = $1', [String(podcastId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].status !== 'pending') return { error: 'not_pending' };

  if (approve) {
    const { rowCount } = await query(
      `UPDATE podcasts SET status = 'published', reject_reason = NULL, updated_at = now()
        WHERE id = $1 AND status = 'pending'`, [podcastId]);
    if (rowCount === 0) return { error: 'not_pending' };
    // Выпуски с файлом выкладываем вместе с передачей: держать их
    // черновиками после одобрения — значит показать пустую страницу.
    await query(
      `UPDATE podcast_episodes SET published = TRUE, updated_at = now()
        WHERE podcast_id = $1 AND (audio_bytes > 0 OR video_bytes > 0)`, [podcastId]);
    return { ok: true, status: 'published' };
  }

  const why = text(reason, MAX_REASON);
  const { rowCount } = await query(
    `UPDATE podcasts SET status = 'rejected', reject_reason = $2, updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [podcastId, why ? encryptContent(why) : null]);
  if (rowCount === 0) return { error: 'not_pending' };
  return { ok: true, status: 'rejected' };
};

/* ─── Транскрипт и главы ───────────────────────────────────────────── */

/**
 * Транскрипт выпуска. Доступен ровно тем, кому доступен сам выпуск:
 * приватный транскрипт чужой передачи не отдаётся.
 */
export const readTranscript = async (episodeId, viewerId) => {
  if (!(await visibleEpisode(episodeId, viewerId))) return null;
  const { rows } = await query(
    'SELECT idx, starts_sec, ends_sec, text_enc, speaker FROM podcast_cues WHERE episode_id = $1 ORDER BY idx',
    [String(episodeId ?? '')]);
  return rows.map((r) => ({
    idx: r.idx,
    start: Number(r.starts_sec),
    end: Number(r.ends_sec),
    text: decryptContent(r.text_enc) ?? '',
    speaker: r.speaker || undefined,
  }));
};

/** Записать транскрипт целиком. Заменяет прежний: правки по строке нет. */
export const saveTranscript = async (episodeId, ownerId, cues) => {
  const { rows } = await query(
    `SELECT e.id, p.owner_id FROM podcast_episodes e JOIN podcasts p ON p.id = e.podcast_id
      WHERE e.id = $1`, [String(episodeId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== ownerId) return { error: 'not_allowed' };
  if (!Array.isArray(cues)) return { error: 'invalid_transcript' };

  const client = await pool.connect();
  let saved = 0;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM podcast_cues WHERE episode_id = $1', [episodeId]);
    let idx = 0;
    for (const c of cues.slice(0, MAX_CUES)) {
      const body = text(c?.text, MAX_CUE);
      const start = Number(c?.start);
      const end = Number(c?.end);
      if (!body || !Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (start < 0 || end <= start || start > MAX_DURATION) continue;
      await client.query(
        `INSERT INTO podcast_cues (episode_id, idx, starts_sec, ends_sec, text_enc, speaker)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [episodeId, idx, start.toFixed(3), Math.min(end, MAX_DURATION).toFixed(3),
          encryptContent(body), text(c?.speaker, MAX_SHORT)]);
      idx += 1;
      saved += 1;
    }
    // Транскрипт заменился — прежний пересказ сделан по другому тексту
    // и больше не соответствует выпуску.
    await client.query('DELETE FROM podcast_summaries WHERE episode_id = $1', [episodeId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ok: true, saved };
};

export const readChapters = async (episodeId, viewerId) => {
  if (!(await visibleEpisode(episodeId, viewerId))) return null;
  const { rows } = await query(
    'SELECT starts_sec, title FROM podcast_chapters WHERE episode_id = $1 ORDER BY starts_sec',
    [String(episodeId ?? '')]);
  return rows.map((r) => ({ start: Number(r.starts_sec), title: r.title }));
};

export const saveChapters = async (episodeId, ownerId, chapters) => {
  const { rows } = await query(
    `SELECT e.id, p.owner_id FROM podcast_episodes e JOIN podcasts p ON p.id = e.podcast_id
      WHERE e.id = $1`, [String(episodeId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== ownerId) return { error: 'not_allowed' };
  if (!Array.isArray(chapters)) return { error: 'invalid_chapters' };

  await query('DELETE FROM podcast_chapters WHERE episode_id = $1', [episodeId]);
  for (const c of chapters.slice(0, 500)) {
    const title = text(c?.title, MAX_TITLE);
    const start = num(c?.start, 0, MAX_DURATION);
    if (!title || start === null) continue;
    await query(
      `INSERT INTO podcast_chapters (episode_id, starts_sec, title) VALUES ($1,$2,$3)
       ON CONFLICT (episode_id, starts_sec) DO UPDATE SET title = EXCLUDED.title`,
      [episodeId, start, title]);
  }
  return { ok: true };
};

/* ─── Прогресс ─────────────────────────────────────────────────────── */

/**
 * На чём человек остановился.
 *
 * Это и есть синхронизация устройств: позиция лежит на сервере, а не в
 * браузере. Записать её в чужой выпуск нельзя, потому что чужой выпуск
 * для этого человека не существует; переписать чужую строку — тоже:
 * ключ таблицы включает профиль, и он берётся из сессии.
 *
 * Одновременные записи с двух устройств не мешают друг другу: строка
 * одна, и последняя запись побеждает. Но только если она свежее —
 * иначе отставшее устройство откатывало бы позицию назад.
 */
export const setProgress = async (userId, episodeId, { position, duration, completed } = {}) => {
  if (!(await visibleEpisode(episodeId, userId))) return { error: 'not_found' };
  const pos = num(position, 0, MAX_DURATION) ?? 0;
  const dur = num(duration, 0, MAX_DURATION) ?? 0;
  const done = completed === true || (dur > 0 && pos >= dur - 15);
  await query(
    `INSERT INTO podcast_progress (user_id, episode_id, position_sec, duration_sec, completed)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, episode_id) DO UPDATE
       SET position_sec = EXCLUDED.position_sec,
           duration_sec = GREATEST(podcast_progress.duration_sec, EXCLUDED.duration_sec),
           completed = podcast_progress.completed OR EXCLUDED.completed,
           updated_at = now()`,
    [userId, episodeId, pos, dur, done]);
  return { ok: true };
};

export const listProgress = async (userId) => {
  const { rows } = await query(
    `SELECT episode_id, position_sec, duration_sec, completed FROM podcast_progress
      WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200`, [userId]);
  return rows.map((r) => ({
    episodeId: r.episode_id,
    position: Number(r.position_sec),
    duration: Number(r.duration_sec),
    completed: r.completed,
  }));
};

/** «Продолжить слушать»: начатое и не досмотренное. */
export const listContinue = async (userId, { limit } = {}) => {
  const lim = num(limit, 1, 30) ?? 12;
  const { rows } = await query(
    `${SELECT_EPISODE}
      JOIN podcast_progress g2 ON g2.episode_id = e.id AND g2.user_id = $1
      WHERE ((e.published AND p.status = 'published') OR p.owner_id = $1)
        AND NOT g2.completed AND g2.position_sec > 20
      ORDER BY g2.updated_at DESC LIMIT $2`, [userId, lim]);
  return rows.map(toEpisode);
};

export const addHistory = async (userId, episodeId) => {
  if (!(await visibleEpisode(episodeId, userId))) return { error: 'not_found' };

  // Счётчик прослушиваний прибавляется не чаще раза в полчаса на
  // человека. Иначе его накручивают повторным нажатием: клиент шлёт
  // отметку сам, и верить ему, что это новое прослушивание, нельзя.
  const { rows: last } = await query(
    `SELECT played_at FROM podcast_history
      WHERE user_id = $1 AND episode_id = $2
      ORDER BY played_at DESC LIMIT 1`, [userId, episodeId]);
  const fresh = !last[0] || (Date.now() - new Date(last[0].played_at).getTime()) > 30 * 60 * 1000;

  await query('INSERT INTO podcast_history (id, user_id, episode_id) VALUES ($1,$2,$3)',
    [newId('phs'), userId, episodeId]);
  await query(
    `DELETE FROM podcast_history WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM podcast_history WHERE user_id = $1 ORDER BY played_at DESC LIMIT 200)`,
    [userId]);
  if (fresh) await query('UPDATE podcast_episodes SET plays = plays + 1 WHERE id = $1', [episodeId]);
  return { ok: true, counted: fresh };
};

export const listHistory = async (userId, { limit } = {}) => {
  const lim = num(limit, 1, 100) ?? 30;
  const { rows } = await query(
    `${SELECT_EPISODE}
      JOIN (SELECT episode_id, max(played_at) AS last FROM podcast_history
             WHERE user_id = $1 GROUP BY episode_id) h ON h.episode_id = e.id
      WHERE (e.published AND p.status = 'published') OR p.owner_id = $1
      ORDER BY h.last DESC LIMIT $2`, [userId, lim]);
  return rows.map(toEpisode);
};

/* ─── Подписки и избранное ─────────────────────────────────────────── */

export const setSubscribed = async (userId, podcastId, on) => {
  if (!(await visiblePodcast(podcastId, userId))) return { error: 'not_found' };
  if (on) {
    await query(
      'INSERT INTO podcast_subscriptions (user_id, podcast_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [userId, podcastId]);
  } else {
    await query('DELETE FROM podcast_subscriptions WHERE user_id = $1 AND podcast_id = $2',
      [userId, podcastId]);
  }
  return { ok: true };
};

export const listSubscriptions = async (userId) => {
  const { rows } = await query(
    `${SELECT_PODCAST}
      JOIN podcast_subscriptions s2 ON s2.podcast_id = p.id AND s2.user_id = $1
      WHERE p.status = 'published' OR p.owner_id = $1
      ORDER BY s2.created_at DESC LIMIT 300`, [userId]);
  return rows.map(toPodcast);
};

export const setFavorite = async (userId, { podcastId, episodeId }, on) => {
  if (podcastId) {
    if (!(await visiblePodcast(podcastId, userId))) return { error: 'not_found' };
    if (on) {
      await query(
        'INSERT INTO podcast_favorites (user_id, podcast_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [userId, podcastId]);
    } else {
      await query('DELETE FROM podcast_favorites WHERE user_id = $1 AND podcast_id = $2',
        [userId, podcastId]);
    }
    return { ok: true };
  }
  if (episodeId) {
    if (!(await visibleEpisode(episodeId, userId))) return { error: 'not_found' };
    if (on) {
      await query(
        'INSERT INTO podcast_favorites (user_id, episode_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [userId, episodeId]);
    } else {
      await query('DELETE FROM podcast_favorites WHERE user_id = $1 AND episode_id = $2',
        [userId, episodeId]);
    }
    return { ok: true };
  }
  return { error: 'not_found' };
};

export const listFavorites = async (userId) => {
  const { rows: shows } = await query(
    `${SELECT_PODCAST}
      JOIN podcast_favorites f2 ON f2.podcast_id = p.id AND f2.user_id = $1
      WHERE p.status = 'published' OR p.owner_id = $1
      ORDER BY f2.created_at DESC LIMIT 200`, [userId]);
  const { rows: eps } = await query(
    `${SELECT_EPISODE}
      JOIN podcast_favorites f3 ON f3.episode_id = e.id AND f3.user_id = $1
      WHERE (e.published AND p.status = 'published') OR p.owner_id = $1
      ORDER BY f3.created_at DESC LIMIT 200`, [userId]);
  return { podcasts: shows.map(toPodcast), episodes: eps.map(toEpisode) };
};

/**
 * Новые выпуски у тех, на кого подписан. Только выложенные и только от
 * этих передач — чужое закрытое сюда не попадёт по построению.
 */
export const listNewFromSubscriptions = async (userId, { limit } = {}) => {
  const lim = num(limit, 1, 50) ?? 20;
  const { rows } = await query(
    `${SELECT_EPISODE}
      JOIN podcast_subscriptions s2 ON s2.podcast_id = e.podcast_id AND s2.user_id = $1
      WHERE e.published AND p.status = 'published'
      ORDER BY e.created_at DESC LIMIT $2`, [userId, lim]);
  return rows.map(toEpisode);
};

/* ─── Уборка ───────────────────────────────────────────────────────── */

/**
 * Осиротевшее: файл на диске без строки в базе. Загрузка могла
 * оборваться так, что запись не доделалась, а место занято.
 */
export const sweepOrphanPodcastFiles = async () => {
  const stored = await listStoredIds();
  if (stored.length === 0) return 0;
  const { rows: eps } = await query('SELECT id FROM podcast_episodes');
  const { rows: shows } = await query('SELECT id FROM podcasts');
  // Имя файла — это приставка и хвост идентификатора: pau-<хвост>.
  // Хвост у выпуска и у передачи считается одинаково, потому что
  // приставки у обоих по четыре знака вместе с дефисом.
  const live = new Set([
    ...eps.map((r) => r.id.slice(4)),
    ...shows.map((r) => r.id.slice(4)),
  ]);
  let removed = 0;
  for (const name of stored) {
    if (live.has(name.slice(4))) continue;
    await removeStoredFile(name).catch(() => {});
    removed += 1;
  }
  return removed;
};
