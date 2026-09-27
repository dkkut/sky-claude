/**
 * Sky Stories — истории на 24 часа, на сервере, а не в браузере вкладки.
 *
 * Раньше (см. src/stories/StoriesModule.tsx) всё жило в localStorage и
 * BroadcastChannel одной вкладки: другой человек на другом устройстве не
 * видел ни своих, ни чужих историй, ни настоящих лайков/просмотров/ответов
 * на опрос — «Близкие друзья» и вовсе никогда не работали, потому что
 * ключ, который должен был их сохранять, никто не писал.
 *
 * Автор истории/лайка/просмотра/ответа — всегда из серверной сессии
 * (profileId), никогда из тела запроса.
 */
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { remove as removeMedia, listStoredIds } from './storystore.mjs';
import { friendIds } from './friends.mjs';

export const STORY_ID_RE = /^sty-[0-9a-f-]{36}$/;
export const MEDIA_ID_RE = /^stt-[0-9a-f-]{36}$/;

export const MAX_BODY_CHARS = 500;
export const MAX_LOCATION_CHARS = 80;
export const MAX_POLL_OPTIONS = 4;
const MAX_POLL_OPTION_CHARS = 40;
const MAX_POLL_QUESTION_CHARS = 120;
const MAX_QUESTION_PROMPT_CHARS = 120;
const MAX_ANSWER_CHARS = 300;

const STORY_TTL_MS = 24 * 3_600_000;
const DURATION_BY_KIND = { text: 7, photo: 5, video: 15 };
const MIN_DURATION_SEC = 3;
const MAX_DURATION_SEC = 60;

/* ── Санитизация текста — как в bloom.mjs: управляющие символы вычищаем
   сами, экранирование HTML не наша забота (делает React на выводе). */
const clean = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
  .trim()
  .slice(0, max);

const newStoryId = () => `sty-${generateId()}`;
const newPollOptionId = () => `sop-${generateId()}`;
const newAnswerId = () => `sqa-${generateId()}`;

const ACTIVE_WHERE = 'deleted_at IS NULL AND expires_at > now()';

/* ── Блокировки: истории заблокированных (в обе стороны) не показываем ── */
const blockedSet = async (viewerId) => {
  const { rows } = await query(
    `SELECT blocked_id AS id FROM blocks WHERE blocker_id = $1
     UNION
     SELECT blocker_id AS id FROM blocks WHERE blocked_id = $1`,
    [viewerId],
  );
  return new Set(rows.map((r) => r.id));
};

/* «Близкие друзья»: правда о том, кто меня туда добавил — единственная
   проверка видимости для visibility='closeFriends'. */
const iAmCloseFriendOf = async (authorId, viewerId) => {
  if (authorId === viewerId) return true;
  const { rows } = await query(
    'SELECT 1 FROM story_close_friends WHERE author_id = $1 AND friend_id = $2',
    [authorId, viewerId],
  );
  return rows.length > 0;
};

/* ── Гидратация строк stories из нескольких таблиц ───────────────────── */
const hydrate = async (storyRows, viewerId) => {
  if (!storyRows.length) return [];
  const ids = storyRows.map((s) => s.id);

  const [mentions, likes, views, pollOpts, pollVotes, answers, authors] = await Promise.all([
    query('SELECT story_id, user_id FROM story_mentions WHERE story_id = ANY($1::text[])', [ids]),
    query('SELECT story_id, user_id FROM story_likes WHERE story_id = ANY($1::text[])', [ids]),
    query(
      `SELECT v.story_id, v.viewer_id, p.name AS viewer_name, p.avatar AS viewer_avatar
         FROM story_views v JOIN profiles p ON p.id = v.viewer_id
        WHERE v.story_id = ANY($1::text[])`,
      [ids],
    ),
    query('SELECT id, story_id, idx, label FROM story_poll_options WHERE story_id = ANY($1::text[]) ORDER BY idx', [ids]),
    query('SELECT story_id, option_id, user_id FROM story_poll_votes WHERE story_id = ANY($1::text[])', [ids]),
    query(
      `SELECT a.id, a.story_id, a.user_id, a.body, a.created_at, p.name AS user_name
         FROM story_question_answers a JOIN profiles p ON p.id = a.user_id
        WHERE a.story_id = ANY($1::text[]) ORDER BY a.created_at`,
      [ids],
    ),
    query('SELECT id, name, username, avatar FROM profiles WHERE id = ANY($1::text[])', [storyRows.map((s) => s.author_id)]),
  ]);

  const byStory = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.story_id)) m.set(r.story_id, []);
      m.get(r.story_id).push(r);
    }
    return m;
  };
  const authorById = new Map(authors.rows.map((a) => [a.id, a]));
  const mentionsByStory = byStory(mentions.rows);
  const likesByStory = byStory(likes.rows);
  const viewsByStory = byStory(views.rows);
  const pollOptByStory = byStory(pollOpts.rows);
  const pollVotesByStory = byStory(pollVotes.rows);
  const answersByStory = byStory(answers.rows);

  return storyRows.map((s) => {
    const author = authorById.get(s.author_id);
    const isOwner = s.author_id === viewerId;
    const storyViews = viewsByStory.get(s.id) ?? [];
    const opts = pollOptByStory.get(s.id) ?? [];
    const votes = pollVotesByStory.get(s.id) ?? [];
    const poll = opts.length ? {
      question: s.poll_question ?? '',
      options: opts.map((o) => ({
        id: o.id,
        label: o.label,
        votes: votes.filter((v) => v.option_id === o.id).map((v) => v.user_id),
      })),
    } : undefined;
    const question = s.question_prompt ? {
      prompt: s.question_prompt,
      answers: (answersByStory.get(s.id) ?? []).map((a) => ({
        id: a.id, userId: a.user_id, userName: a.user_name, text: a.body, createdAt: a.created_at.getTime(),
      })),
    } : undefined;

    return {
      id: s.id,
      authorId: s.author_id,
      authorName: author?.name ?? 'Пользователь',
      authorUsername: author?.username ?? '',
      authorAvatar: author?.avatar ?? undefined,
      kind: s.kind,
      mediaUrl: s.media_id ? `/api/stories/media/${s.media_id}` : undefined,
      text: s.body ?? undefined,
      bg: s.bg,
      duration: s.duration_sec,
      createdAt: s.created_at.getTime(),
      expiresAt: s.expires_at.getTime(),
      // «Просмотрено мной» — свою же историю считаем просмотренной всегда.
      viewed: isOwner || storyViews.some((v) => v.viewer_id === viewerId),
      likes: (likesByStory.get(s.id) ?? []).map((l) => l.user_id),
      views: storyViews.length,
      // Кто именно смотрел — видно только автору, как и в Bloom с regions.
      viewedBy: isOwner ? storyViews.map((v) => ({
        userId: v.viewer_id, userName: v.viewer_name, userAvatar: v.viewer_avatar ?? undefined,
      })) : undefined,
      visibility: s.visibility,
      mentions: (mentionsByStory.get(s.id) ?? []).map((m) => m.user_id),
      musicTrackId: s.music_track_id ?? undefined,
      location: s.location ?? undefined,
      poll,
      question,
    };
  });
};

/**
 * Лента: все активные (не истёкшие, не удалённые) истории, которые
 * вправе увидеть зритель — свои всегда, чужие «для всех» всегда (кроме
 * заблокированных в обе стороны), чужие «близкие друзья» — только если
 * автор сам добавил зрителя в свой список story_close_friends.
 */
export const feed = async (viewerId) => {
  const blocked = await blockedSet(viewerId);
  const { rows: closeOf } = await query(
    'SELECT author_id FROM story_close_friends WHERE friend_id = $1', [viewerId],
  );
  const closeAuthors = new Set(closeOf.map((r) => r.author_id));

  const { rows } = await query(
    `SELECT * FROM stories WHERE ${ACTIVE_WHERE} ORDER BY created_at DESC LIMIT 1000`,
  );
  const visible = rows.filter((r) => {
    if (r.author_id === viewerId) return true;
    if (blocked.has(r.author_id)) return false;
    if (r.visibility === 'closeFriends') return closeAuthors.has(r.author_id);
    return true;
  });
  return hydrate(visible, viewerId);
};

/** Активные истории одного конкретного автора — открыть его «кружок». */
export const authorStories = async (authorId, viewerId) => {
  if (authorId !== viewerId) {
    const blocked = await blockedSet(viewerId);
    if (blocked.has(authorId)) return [];
  }
  const { rows } = await query(
    `SELECT * FROM stories WHERE author_id = $1 AND ${ACTIVE_WHERE} ORDER BY created_at`,
    [authorId],
  );
  if (!rows.length || authorId === viewerId) return hydrate(rows, viewerId);
  const hasCloseOnly = rows.some((r) => r.visibility === 'closeFriends');
  const allowedClose = hasCloseOnly ? await iAmCloseFriendOf(authorId, viewerId) : false;
  const visible = rows.filter((r) => r.visibility !== 'closeFriends' || allowedClose);
  return hydrate(visible, viewerId);
};

/** Своя собственная лента-архив: истёкшие, но не удалённые свои истории. */
export const archive = async (authorId) => {
  const { rows } = await query(
    `SELECT * FROM stories WHERE author_id = $1 AND deleted_at IS NULL AND expires_at <= now()
      ORDER BY created_at DESC LIMIT 200`,
    [authorId],
  );
  return hydrate(rows, authorId);
};

/** Одна история по id — для прямого перехода (например, из уведомления). */
export const getStory = async (storyId, viewerId) => {
  const { rows } = await query('SELECT * FROM stories WHERE id = $1 AND deleted_at IS NULL', [storyId]);
  const row = rows[0];
  if (!row) return null;
  if (row.author_id !== viewerId) {
    const blocked = await blockedSet(viewerId);
    if (blocked.has(row.author_id)) return null;
    if (row.visibility === 'closeFriends' && !(await iAmCloseFriendOf(row.author_id, viewerId))) return null;
  }
  const [hydrated] = await hydrate([row], viewerId);
  return hydrated;
};

/* ── Публикация / удаление ───────────────────────────────────────────── */

export const createStory = async (authorId, body) => {
  const text = clean(body?.text, MAX_BODY_CHARS);
  const mediaId = body?.mediaId ? String(body.mediaId) : null;
  if (mediaId && !MEDIA_ID_RE.test(mediaId)) return { error: 'bad_media' };
  if (!text && !mediaId) return { error: 'empty_story' };

  // Тип определяется по присланному вместе с загрузкой mime, а не по
  // тому, что клиент подписал в поле kind — тот же принцип, что и в
  // bloom.mjs::createPost.
  let kind = 'text';
  let mediaMime = null;
  if (mediaId) {
    mediaMime = clean(body?.mediaMime, 100);
    kind = mediaMime.startsWith('video/') ? 'video' : 'photo';
  }

  const bg = clean(body?.bg, 200);
  const rawDuration = Number(body?.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration >= MIN_DURATION_SEC && rawDuration <= MAX_DURATION_SEC
    ? Math.round(rawDuration)
    : DURATION_BY_KIND[kind];

  const visibility = body?.visibility === 'closeFriends' ? 'closeFriends' : 'all';
  const location = body?.location ? clean(body.location, MAX_LOCATION_CHARS) : null;
  const musicTrackId = body?.musicTrackId ? clean(body.musicTrackId, 64) : null;

  // Упоминания — только реальные существующие профили, что бы клиент
  // ни прислал в этом массиве.
  let mentionIds = [];
  if (Array.isArray(body?.mentions) && body.mentions.length) {
    const candidates = [...new Set(body.mentions.map((v) => String(v)))].slice(0, 20);
    const { rows } = await query('SELECT id FROM profiles WHERE id = ANY($1::text[])', [candidates]);
    mentionIds = rows.map((r) => r.id);
  }

  const pollOptions = Array.isArray(body?.poll?.options)
    ? body.poll.options.map((o) => clean(o, MAX_POLL_OPTION_CHARS)).filter(Boolean).slice(0, MAX_POLL_OPTIONS)
    : [];
  const pollQuestion = pollOptions.length ? clean(body?.poll?.question, MAX_POLL_QUESTION_CHARS) : null;
  const questionPrompt = body?.question?.prompt ? clean(body.question.prompt, MAX_QUESTION_PROMPT_CHARS) : null;

  const id = newStoryId();
  const expiresAt = new Date(Date.now() + STORY_TTL_MS);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO stories (id, author_id, kind, media_id, media_mime, body, bg, duration_sec,
                             visibility, location, music_track_id, poll_question, question_prompt, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, authorId, kind, mediaId, mediaMime, text || null, bg, duration,
       visibility, location, musicTrackId, pollQuestion, questionPrompt, expiresAt],
    );
    for (const uid of mentionIds) {
      await client.query(
        'INSERT INTO story_mentions (story_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, uid],
      );
    }
    for (let i = 0; i < pollOptions.length; i += 1) {
      await client.query(
        'INSERT INTO story_poll_options (id, story_id, idx, label) VALUES ($1,$2,$3,$4)',
        [newPollOptionId(), id, i, pollOptions[i]],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { id };
};

export const deleteStory = async (storyId, actorId) => {
  const { rows } = await query('SELECT author_id, media_id FROM stories WHERE id = $1 AND deleted_at IS NULL', [storyId]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].author_id !== actorId) return { error: 'not_allowed' };
  await query('UPDATE stories SET deleted_at = now() WHERE id = $1', [storyId]);
  if (rows[0].media_id) await removeMedia(rows[0].media_id).catch(() => {});
  return { ok: true };
};

/* ── Лайк / просмотр ──────────────────────────────────────────────────── */

export const toggleLike = async (storyId, userId) => {
  const { rows } = await query(`SELECT 1 FROM stories WHERE id = $1 AND ${ACTIVE_WHERE}`, [storyId]);
  if (!rows.length) return { error: 'not_found' };
  const del = await query('DELETE FROM story_likes WHERE story_id = $1 AND user_id = $2', [storyId, userId]);
  if (del.rowCount > 0) return { liked: false };
  await query('INSERT INTO story_likes (story_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [storyId, userId]);
  return { liked: true };
};

export const recordView = async (storyId, userId) => {
  const { rows } = await query('SELECT author_id FROM stories WHERE id = $1 AND deleted_at IS NULL', [storyId]);
  if (!rows.length) return { error: 'not_found' };
  if (rows[0].author_id === userId) return { ok: true };
  await query(
    'INSERT INTO story_views (story_id, viewer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [storyId, userId],
  ).catch(() => {});
  return { ok: true };
};

/* ── Опрос / вопрос-ответы ────────────────────────────────────────────── */

export const votePoll = async (storyId, userId, optionId) => {
  const { rows } = await query(
    'SELECT 1 FROM story_poll_options WHERE id = $1 AND story_id = $2', [optionId, storyId],
  );
  if (!rows.length) return { error: 'not_found' };
  const already = await query('SELECT 1 FROM story_poll_votes WHERE story_id = $1 AND user_id = $2', [storyId, userId]);
  if (already.rows.length) return { error: 'already_voted' };
  await query('INSERT INTO story_poll_votes (story_id, user_id, option_id) VALUES ($1,$2,$3)', [storyId, userId, optionId]);
  return { ok: true };
};

export const answerQuestion = async (storyId, userId, text) => {
  const body = clean(text, MAX_ANSWER_CHARS);
  if (!body) return { error: 'empty_answer' };
  const { rows } = await query('SELECT question_prompt FROM stories WHERE id = $1 AND deleted_at IS NULL', [storyId]);
  if (!rows.length || !rows[0].question_prompt) return { error: 'not_found' };
  const id = newAnswerId();
  await query('INSERT INTO story_question_answers (id, story_id, user_id, body) VALUES ($1,$2,$3,$4)', [id, storyId, userId, body]);
  return { id };
};

/* ── «Близкие друзья» ─────────────────────────────────────────────────── */

export const getCloseFriends = async (authorId) => {
  const { rows } = await query('SELECT friend_id FROM story_close_friends WHERE author_id = $1', [authorId]);
  return rows.map((r) => r.friend_id);
};

/** Список полностью заменяется, но только реальными подтверждёнными
 * друзьями (friendships) — не произвольными id из тела запроса. */
export const setCloseFriends = async (authorId, ids) => {
  const wanted = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  const real = new Set(await friendIds(authorId));
  const valid = wanted.filter((id) => real.has(id));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM story_close_friends WHERE author_id = $1', [authorId]);
    for (const id of valid) {
      await client.query(
        'INSERT INTO story_close_friends (author_id, friend_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [authorId, id],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ok: true, friendIds: valid };
};

/** MIME по id уже сохранённого медиа — для раздачи файла (Content-Type). */
export const mediaMimeOf = async (mediaId) => {
  const { rows } = await query('SELECT media_mime FROM stories WHERE media_id = $1', [mediaId]);
  return rows[0]?.media_mime ?? null;
};

/** Файлы на диске без строки в stories (загрузка началась, публикация не
 * состоялась) — та же сверка диск/база, что и в bloom.mjs. */
export const sweepOrphanStoryMedia = async () => {
  const stored = await listStoredIds();
  if (!stored.length) return { removed: 0 };
  const { rows } = await query('SELECT media_id FROM stories WHERE media_id = ANY($1::text[])', [stored]);
  const used = new Set(rows.map((r) => r.media_id));
  const orphans = stored.filter((id) => !used.has(id));
  for (const id of orphans) await removeMedia(id);
  return { removed: orphans.length };
};
