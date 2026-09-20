/**
 * Bloom — социальная лента внутри Sky Ecosystem.
 *
 * Личных сообщений здесь нет: «Написать» в профиле Bloom ведёт в уже
 * существующий Sky Messenger (chats.mjs) — см. server/routes/bloom.mjs,
 * который просто переиспользует createChat/directChatId оттуда.
 *
 * Автор поста/комментария, владелец лайка — всегда из серверной сессии
 * (profileId), никогда не из тела запроса: presenceId клиент прислать
 * не может, что бы он ни написал в JSON.
 */
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { wallet } from './wallet.mjs';
import { remove as removeMedia } from './bloomstore.mjs';

export const POST_ID_RE = /^blp-[0-9a-f-]{36}$/;
export const COMMENT_ID_RE = /^blc-[0-9a-f-]{36}$/;
export const MEDIA_ID_RE = /^blm-[0-9a-f-]{36}$/;

export const MAX_BODY_CHARS = 4000;
export const MAX_COMMENT_CHARS = 1000;
export const MAX_TAGS = 10;
export const MAX_TAG_LEN = 32;
export const MAX_POLL_OPTIONS = 6;

const REACTIONS = ['❤️', '🔥', '😂', '😮', '👏', '💯', '🎉', '🤔'];

export const GIFT_CATALOG = {
  heart:  { label: 'Сердце',   rarity: 'common',    cost: 10 },
  flower: { label: 'Цветок',   rarity: 'uncommon',  cost: 25 },
  party:  { label: 'Праздник', rarity: 'rare',       cost: 50 },
  star:   { label: 'Звезда',   rarity: 'epic',       cost: 100 },
  trophy: { label: 'Кубок',    rarity: 'legendary',  cost: 250 },
  crown:  { label: 'Корона',   rarity: 'mythic',     cost: 500 },
  gem:    { label: 'Кристалл', rarity: 'divine',     cost: 1000 },
  rocket: { label: 'Ракета',   rarity: 'limited',    cost: 750 },
};

/* ── Санитизация текста ──────────────────────────────────────────────
   Управляющие символы вычищаем сами; экранирование HTML — не наша
   забота, это делает React на выводе (никакого dangerouslySetInnerHTML
   в клиенте Bloom нет). */
const clean = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
  .trim()
  .slice(0, max);

const cleanTag = (t) => clean(t, MAX_TAG_LEN).toLowerCase().replace(/[^a-zа-я0-9_]/gi, '');

const newPostId = () => `blp-${generateId()}`;
const newCommentId = () => `blc-${generateId()}`;

/* ── Блокировки: посты заблокированных (в обе стороны) не показываем ── */
const blockedSet = async (viewerId) => {
  const { rows } = await query(
    `SELECT blocked_id AS id FROM blocks WHERE blocker_id = $1
     UNION
     SELECT blocker_id AS id FROM blocks WHERE blocked_id = $1`,
    [viewerId],
  );
  return new Set(rows.map((r) => r.id));
};

/* ── Гидратация поста из строк нескольких таблиц ─────────────────── */
const hydrate = async (postRows, viewerId) => {
  if (!postRows.length) return [];
  const ids = postRows.map((p) => p.id);

  const [tags, reactions, comments, saves, reposts, polls, votes, authors] = await Promise.all([
    query('SELECT post_id, tag FROM bloom_post_tags WHERE post_id = ANY($1::text[])', [ids]),
    query('SELECT post_id, user_id, emoji FROM bloom_reactions WHERE post_id = ANY($1::text[])', [ids]),
    query(
      `SELECT c.id, c.post_id, c.author_id, c.body, c.gift_model_key, c.gift_rarity, c.created_at,
              p.name AS author_name, p.avatar AS author_avatar,
              COALESCE(json_agg(cl.user_id) FILTER (WHERE cl.user_id IS NOT NULL), '[]') AS likes
         FROM bloom_comments c
         JOIN profiles p ON p.id = c.author_id
         LEFT JOIN bloom_comment_likes cl ON cl.comment_id = c.id
        WHERE c.post_id = ANY($1::text[]) AND c.deleted_at IS NULL
        GROUP BY c.id, p.name, p.avatar
        ORDER BY c.created_at`,
      [ids],
    ),
    query('SELECT post_id, user_id FROM bloom_saves WHERE post_id = ANY($1::text[])', [ids]),
    query('SELECT post_id, user_id FROM bloom_reposts WHERE post_id = ANY($1::text[])', [ids]),
    query('SELECT id, post_id, idx, label FROM bloom_poll_options WHERE post_id = ANY($1::text[]) ORDER BY idx', [ids]),
    query('SELECT post_id, option_id, user_id FROM bloom_poll_votes WHERE post_id = ANY($1::text[])', [ids]),
    query('SELECT id, name, username FROM profiles WHERE id = ANY($1::text[])', [postRows.map((p) => p.author_id)]),
  ]);

  const authorById = new Map(authors.rows.map((a) => [a.id, a]));
  const byPost = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.post_id)) m.set(r.post_id, []);
      m.get(r.post_id).push(r);
    }
    return m;
  };
  const tagsByPost = byPost(tags.rows);
  const reactionsByPost = byPost(reactions.rows);
  const commentsByPost = byPost(comments.rows);
  const savesByPost = byPost(saves.rows);
  const repostsByPost = byPost(reposts.rows);
  const pollOptByPost = byPost(polls.rows);
  const votesByPost = byPost(votes.rows);

  return postRows.map((p) => {
    const author = authorById.get(p.author_id);
    const reacts = reactionsByPost.get(p.id) ?? [];
    const reactionsGrouped = REACTIONS
      .map((emoji) => ({ emoji, userIds: reacts.filter((r) => r.emoji === emoji).map((r) => r.user_id) }))
      .filter((r) => r.userIds.length > 0);

    const pollOpts = pollOptByPost.get(p.id) ?? [];
    const pollVotes = votesByPost.get(p.id) ?? [];
    const poll = pollOpts.length ? {
      question: p.poll_question ?? '',
      options: pollOpts.map((o) => ({
        id: o.id,
        label: o.label,
        votes: pollVotes.filter((v) => v.option_id === o.id).map((v) => v.user_id),
      })),
    } : undefined;

    return {
      id: p.id,
      authorId: p.author_id,
      authorName: author?.name ?? 'Пользователь',
      authorUsername: author?.username ?? '',
      kind: p.kind,
      text: p.body,
      mediaUrl: p.media_id ? `/api/bloom/media/${p.media_id}` : undefined,
      mediaAspect: p.media_aspect ?? undefined,
      reactions: reactionsGrouped,
      comments: (commentsByPost.get(p.id) ?? []).map((c) => ({
        id: c.id, authorId: c.author_id, authorName: c.author_name, authorAvatar: c.author_avatar ?? undefined,
        text: c.body, likes: c.likes, createdAt: c.created_at.toISOString(),
        gift: c.gift_model_key ? { modelKey: c.gift_model_key, rarity: c.gift_rarity } : undefined,
      })),
      saved: (savesByPost.get(p.id) ?? []).map((s) => s.user_id),
      reposts: (repostsByPost.get(p.id) ?? []).length,
      repostedByMe: (repostsByPost.get(p.id) ?? []).some((r) => r.user_id === viewerId),
      views: Number(p.view_count ?? 0),
      createdAt: p.created_at.toISOString(),
      tags: (tagsByPost.get(p.id) ?? []).map((t) => t.tag),
      isPinned: p.is_pinned,
      location: p.location ?? undefined,
      poll,
    };
  });
};

/** Строки постов + счётчик просмотров одним запросом. */
const selectPosts = async (whereSql, params) => {
  const { rows } = await query(
    `SELECT bp.*, (SELECT count(*)::int FROM bloom_views v WHERE v.post_id = bp.id) AS view_count
       FROM bloom_posts bp
      WHERE bp.deleted_at IS NULL AND ${whereSql}
      ORDER BY bp.created_at DESC
      LIMIT 500`,
    params,
  );
  return rows;
};

/* ── Лента ──────────────────────────────────────────────────────────
   Скоринг — в памяти, тем же алгоритмом, что был в локальном сторе:
   тянуть весь скоринг в SQL ради 500 строк не стоит усложнения. */
const scorePost = (p, myId, interactions) => {
  const totalReacts = p.reactions.reduce((a, r) => a + r.userIds.length, 0);
  const eng = totalReacts * 3 + p.comments.length * 5 + p.reposts * 4;
  const hoursAgo = (Date.now() - new Date(p.createdAt).getTime()) / 3_600_000;
  const recency = Math.max(0, 100 - hoursAgo * 1.5);
  const boost = interactions.has(p.authorId) ? 30 : 0;
  const ownBoost = p.authorId === myId ? -50 : 0;
  const pinned = p.isPinned ? 200 : 0;
  return eng + recency + boost + ownBoost + pinned;
};

export const feed = async (viewerId, tab = 'algo', { tag = null } = {}) => {
  const [hidden, blocked] = await Promise.all([
    query('SELECT hidden_author_id FROM bloom_hidden WHERE user_id = $1', [viewerId]),
    blockedSet(viewerId),
  ]);
  const hiddenIds = new Set(hidden.rows.map((r) => r.hidden_author_id));

  let rows;
  if (tab === 'mine') {
    rows = await selectPosts('bp.author_id = $1', [viewerId]);
  } else if (tag) {
    rows = await selectPosts(
      `bp.id IN (SELECT post_id FROM bloom_post_tags WHERE tag = $1)`, [tag],
    );
  } else {
    rows = await selectPosts('TRUE', []);
  }

  let posts = await hydrate(rows, viewerId);
  posts = posts.filter((p) => p.authorId === viewerId || (!hiddenIds.has(p.authorId) && !blocked.has(p.authorId)));

  if (tab === 'saved') posts = posts.filter((p) => p.saved.includes(viewerId));
  if (tab === 'fresh' || tab === 'saved') return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (tab === 'mine') return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // 'algo' — интересы через реальные реакции/комментарии/репосты этого
  // зрителя за последние 30 дней (не выдуманный список).
  const { rows: inter } = await query(
    `SELECT DISTINCT bp.author_id FROM bloom_reactions r
       JOIN bloom_posts bp ON bp.id = r.post_id
      WHERE r.user_id = $1 AND r.created_at > now() - interval '30 days'
     UNION
     SELECT DISTINCT bp.author_id FROM bloom_comments c
       JOIN bloom_posts bp ON bp.id = c.post_id
      WHERE c.author_id = $1 AND c.created_at > now() - interval '30 days'`,
    [viewerId],
  );
  const interactions = new Set(inter.rows.map((r) => r.author_id));
  return posts.sort((a, b) => scorePost(b, viewerId, interactions) - scorePost(a, viewerId, interactions));
};

/** Посты конкретного автора — для карточки его профиля (вьюер профиля,
 * не только сама Bloom-лента). Блокировка проверяется здесь же: заблокированный
 * друг друга список постов не получает, даже зная его userId напрямую. */
export const authorPosts = async (authorId, viewerId) => {
  const blocked = await blockedSet(viewerId);
  if (blocked.has(authorId)) return [];
  const rows = await selectPosts('bp.author_id = $1', [authorId]);
  const posts = await hydrate(rows, viewerId);
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

/** Один пост по id — открыть карточку напрямую (например, из уведомления
 * или ссылки), не дожидаясь, пока он попадёт в закэшированную ленту. */
export const getPost = async (postId, viewerId) => {
  const rows = await selectPosts('bp.id = $1', [postId]);
  if (!rows.length) return null;
  const blocked = await blockedSet(viewerId);
  if (rows[0].author_id !== viewerId && blocked.has(rows[0].author_id)) return null;
  const [post] = await hydrate(rows, viewerId);
  return post ?? null;
};

export const trending = async () => {
  const { rows } = await query(
    `SELECT tag, count(*)::int AS n FROM bloom_post_tags t
       JOIN bloom_posts p ON p.id = t.post_id
      WHERE p.deleted_at IS NULL
      GROUP BY tag ORDER BY n DESC LIMIT 8`,
  );
  return rows.map((r) => [r.tag, String(r.n)]);
};

export const suggestedUsers = async (viewerId) => {
  const { rows } = await query(
    `SELECT DISTINCT author_id FROM bloom_posts
      WHERE deleted_at IS NULL AND author_id <> $1
        AND author_id NOT IN (SELECT following_id FROM follows WHERE follower_id = $1)
      ORDER BY author_id LIMIT 5`,
    [viewerId],
  );
  return rows.map((r) => r.author_id);
};

export const hotComments = async () => {
  const { rows } = await query(
    `SELECT c.id AS comment_id, c.post_id, c.author_id, c.body, c.created_at, c.author_id AS c_author,
            (SELECT count(*)::int FROM bloom_comment_likes cl WHERE cl.comment_id = c.id) AS likes
       FROM bloom_comments c
       JOIN bloom_posts p ON p.id = c.post_id AND p.deleted_at IS NULL
      WHERE c.deleted_at IS NULL
      ORDER BY likes DESC, c.created_at DESC LIMIT 12`,
  );
  const top = rows.filter((r) => r.likes > 0).slice(0, 4);
  if (!top.length) return [];
  const postIds = [...new Set(top.map((r) => r.post_id))];
  const posts = await hydrate(await selectPosts('bp.id = ANY($1::text[])', [postIds]), null);
  const postById = new Map(posts.map((p) => [p.id, p]));
  return top
    .map((r) => {
      const post = postById.get(r.post_id);
      const comment = post?.comments.find((c) => c.id === r.comment_id);
      return post && comment ? { post, comment } : null;
    })
    .filter(Boolean);
};

/** Реальный (не выдуманный) счётчик: реакции/комментарии от других на мои посты. */
export const notificationsCount = async (userId) => {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM bloom_reactions r JOIN bloom_posts p ON p.id = r.post_id
         WHERE p.author_id = $1 AND r.user_id <> $1) +
       (SELECT count(*)::int FROM bloom_comments c JOIN bloom_posts p ON p.id = c.post_id
         WHERE p.author_id = $1 AND c.author_id <> $1 AND c.deleted_at IS NULL) AS n`,
    [userId],
  );
  return rows[0].n;
};

/* ── Посты ──────────────────────────────────────────────────────── */

export const createPost = async (authorId, body) => {
  const text = clean(body?.text, MAX_BODY_CHARS);
  const mediaId = body?.mediaId ? String(body.mediaId) : null;
  if (mediaId && !MEDIA_ID_RE.test(mediaId)) return { error: 'bad_media' };
  if (!text && !mediaId) return { error: 'empty_post' };

  let kind = 'text';
  if (mediaId) {
    const mime = String(body?.mediaMime ?? '');
    kind = mime.startsWith('video/') ? 'video' : 'photo';
  }

  const tags = Array.isArray(body?.tags)
    ? [...new Set(body.tags.map(cleanTag).filter(Boolean))].slice(0, MAX_TAGS)
    : [];

  const id = newPostId();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO bloom_posts (id, author_id, kind, body, media_id, media_mime, media_aspect, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, authorId, kind, text, mediaId, mediaId ? String(body?.mediaMime ?? '').slice(0, 100) : null,
       mediaId && Number.isFinite(body?.mediaAspect) ? Number(body.mediaAspect) : null,
       body?.location ? clean(body.location, 120) : null],
    );
    for (const tag of tags) {
      await client.query('INSERT INTO bloom_post_tags (post_id, tag) VALUES ($1,$2)', [id, tag]);
    }
    if (body?.poll?.options && Array.isArray(body.poll.options)) {
      const question = clean(body.poll.question, 200);
      await client.query('UPDATE bloom_posts SET poll_question = $2 WHERE id = $1', [id, question]);
      const opts = body.poll.options.map((o) => clean(o, 80)).filter(Boolean).slice(0, MAX_POLL_OPTIONS);
      for (let i = 0; i < opts.length; i += 1) {
        await client.query(
          'INSERT INTO bloom_poll_options (id, post_id, idx, label) VALUES ($1,$2,$3,$4)',
          [`blo-${generateId()}`, id, i, opts[i]],
        );
      }
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

export const deletePost = async (postId, actorId) => {
  const { rows } = await query('SELECT author_id, media_id FROM bloom_posts WHERE id = $1 AND deleted_at IS NULL', [postId]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].author_id !== actorId) return { error: 'not_allowed' };
  await query('UPDATE bloom_posts SET deleted_at = now() WHERE id = $1', [postId]);
  if (rows[0].media_id) await removeMedia(rows[0].media_id).catch(() => {});
  return { ok: true };
};

/* ── Реакции ────────────────────────────────────────────────────── */

export const react = async (postId, userId, emoji) => {
  if (!REACTIONS.includes(emoji)) return { error: 'bad_emoji' };
  const { rows } = await query('SELECT 1 FROM bloom_posts WHERE id = $1 AND deleted_at IS NULL', [postId]);
  if (!rows.length) return { error: 'not_found' };

  const del = await query(
    'DELETE FROM bloom_reactions WHERE post_id = $1 AND user_id = $2 AND emoji = $3',
    [postId, userId, emoji],
  );
  if (del.rowCount > 0) return { reacted: false };
  await query(
    `INSERT INTO bloom_reactions (post_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [postId, userId, emoji],
  );
  return { reacted: true };
};

/* ── Комментарии ────────────────────────────────────────────────── */

export const addComment = async (postId, authorId, text) => {
  const body = clean(text, MAX_COMMENT_CHARS);
  if (!body) return { error: 'empty_comment' };
  const { rows } = await query('SELECT 1 FROM bloom_posts WHERE id = $1 AND deleted_at IS NULL', [postId]);
  if (!rows.length) return { error: 'not_found' };
  const id = newCommentId();
  await query(
    'INSERT INTO bloom_comments (id, post_id, author_id, body) VALUES ($1,$2,$3,$4)',
    [id, postId, authorId, body],
  );
  return { id };
};

export const deleteComment = async (commentId, actorId) => {
  const { rows } = await query(
    `SELECT c.author_id, p.author_id AS post_author_id FROM bloom_comments c
       JOIN bloom_posts p ON p.id = c.post_id
      WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [commentId],
  );
  if (!rows[0]) return { error: 'not_found' };
  // Автор комментария или автор поста — тот же принцип, что в остальных
  // разделах Sky: хозяин площадки может убрать чужое у себя.
  if (rows[0].author_id !== actorId && rows[0].post_author_id !== actorId) return { error: 'not_allowed' };
  await query('UPDATE bloom_comments SET deleted_at = now() WHERE id = $1', [commentId]);
  return { ok: true };
};

export const likeComment = async (commentId, userId) => {
  const { rows } = await query('SELECT 1 FROM bloom_comments WHERE id = $1 AND deleted_at IS NULL', [commentId]);
  if (!rows.length) return { error: 'not_found' };
  const del = await query('DELETE FROM bloom_comment_likes WHERE comment_id = $1 AND user_id = $2', [commentId, userId]);
  if (del.rowCount > 0) return { liked: false };
  await query('INSERT INTO bloom_comment_likes (comment_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [commentId, userId]);
  return { liked: true };
};

/* ── Сохранённое / репост / просмотр ───────────────────────────── */

export const toggleSave = async (postId, userId) => {
  const del = await query('DELETE FROM bloom_saves WHERE post_id = $1 AND user_id = $2', [postId, userId]);
  if (del.rowCount > 0) return { saved: false };
  const { rows } = await query('SELECT 1 FROM bloom_posts WHERE id = $1 AND deleted_at IS NULL', [postId]);
  if (!rows.length) return { error: 'not_found' };
  await query('INSERT INTO bloom_saves (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [postId, userId]);
  return { saved: true };
};

export const toggleRepost = async (postId, userId) => {
  const del = await query('DELETE FROM bloom_reposts WHERE post_id = $1 AND user_id = $2', [postId, userId]);
  if (del.rowCount > 0) return { reposted: false };
  const { rows } = await query('SELECT 1 FROM bloom_posts WHERE id = $1 AND deleted_at IS NULL', [postId]);
  if (!rows.length) return { error: 'not_found' };
  await query('INSERT INTO bloom_reposts (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [postId, userId]);
  return { reposted: true };
};

export const recordView = async (postId, userId) => {
  await query(
    'INSERT INTO bloom_views (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [postId, userId],
  ).catch(() => {});
  return { ok: true };
};

/* ── Опросы ─────────────────────────────────────────────────────── */

export const votePoll = async (postId, userId, optionId) => {
  const { rows } = await query(
    'SELECT 1 FROM bloom_poll_options WHERE id = $1 AND post_id = $2', [optionId, postId],
  );
  if (!rows.length) return { error: 'not_found' };
  const already = await query('SELECT 1 FROM bloom_poll_votes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
  if (already.rows.length) return { error: 'already_voted' };
  await query(
    'INSERT INTO bloom_poll_votes (post_id, user_id, option_id) VALUES ($1,$2,$3)',
    [postId, userId, optionId],
  );
  return { ok: true };
};

/* ── Скрыть автора ──────────────────────────────────────────────── */

export const hiddenAuthors = async (userId) => {
  const { rows } = await query('SELECT hidden_author_id FROM bloom_hidden WHERE user_id = $1', [userId]);
  return rows.map((r) => r.hidden_author_id);
};

export const toggleHide = async (userId, authorId) => {
  const del = await query('DELETE FROM bloom_hidden WHERE user_id = $1 AND hidden_author_id = $2', [userId, authorId]);
  if (del.rowCount > 0) return { hidden: false };
  await query('INSERT INTO bloom_hidden (user_id, hidden_author_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, authorId]);
  return { hidden: true };
};

/* ── Подарки ────────────────────────────────────────────────────── */

export const sendGift = async (fromId, postId, modelKey) => {
  const opt = GIFT_CATALOG[modelKey];
  if (!opt) return { error: 'bad_gift' };
  const { rows } = await query('SELECT author_id FROM bloom_posts WHERE id = $1 AND deleted_at IS NULL', [postId]);
  if (!rows[0]) return { error: 'not_found' };
  const toId = rows[0].author_id;

  const paid = await wallet.spendPoints(fromId, opt.cost, `Подарок в Bloom: ${opt.label}`, postId);
  if (paid.error) return { error: paid.error };

  const giftId = `blg-${generateId()}`;
  const commentId = newCommentId();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Комментарий сперва — bloom_gifts.comment_id на него ссылается,
    // а внешний ключ проверяется сразу же, не в конце транзакции.
    await client.query(
      `INSERT INTO bloom_comments (id, post_id, author_id, body, gift_model_key, gift_rarity)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [commentId, postId, fromId, `подарил(а) «${opt.label}»`, modelKey, opt.rarity],
    );
    await client.query(
      `INSERT INTO bloom_gifts (id, from_id, to_id, post_id, comment_id, model_key, rarity, cost_points)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [giftId, fromId, toId, postId, commentId, modelKey, opt.rarity, opt.cost],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // Списание уже ушло — без комментария подарок всё равно можно
    // найти по bloom_gifts, а деньги не удвоить: транзакция кошелька
    // отдельная и уже закоммичена, повторного списания здесь нет.
    throw err;
  } finally {
    client.release();
  }
  return { ok: true, giftId, commentId };
};

/** MIME по id уже сохранённого медиа — для раздачи файла (Content-Type). */
export const mediaMimeOf = async (mediaId) => {
  const { rows } = await query('SELECT media_mime FROM bloom_posts WHERE media_id = $1', [mediaId]);
  return rows[0]?.media_mime ?? null;
};

/* ── Уборка ─────────────────────────────────────────────────────── */

export const sweepOrphanBloomMedia = async () => {
  const { listStoredIds, remove } = await import('./bloomstore.mjs');
  const stored = await listStoredIds();
  if (!stored.length) return { removed: 0 };
  const { rows } = await query('SELECT media_id FROM bloom_posts WHERE media_id = ANY($1::text[])', [stored]);
  const used = new Set(rows.map((r) => r.media_id));
  const orphans = stored.filter((id) => !used.has(id));
  for (const id of orphans) await remove(id);
  return { removed: orphans.length };
};
