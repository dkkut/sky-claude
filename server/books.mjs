/**
 * Sky Books: данные и права.
 *
 * До этого файла книги были восемью карточками, зашитыми в экран, а
 * «слушать» и «читать» не делали ничего настоящего. Устройство здесь
 * такое же, как у Sky Podcasts, и по тем же причинам:
 *
 *   • книга видна всем, если опубликована; иначе — только автору;
 *   • глава следует за книгой: видна книга — видны её главы;
 *   • содержание главы (текст) отдаётся отдельной ручкой от списка
 *     глав — оглавление может быть большим, а тексты тяжёлыми, и незачем
 *     тащить все главы разом ради одного оглавления;
 *   • прогресс, полка — строго свои. Ключ этих таблиц включает
 *     профиль, и он берётся из сессии, а не из запроса.
 *
 * Единый плеер — это про то, что у главы бывает и текст, и озвучка
 * одновременно, и они делят один и тот же номер главы: переключение
 * «читать» / «слушать» остаётся на той же главе книги.
 */
import crypto from 'node:crypto';
import { notifyStaff } from './staffnotify.mjs';
import { query, pool } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { can } from './admin.mjs';

const newId = (p) => `${p}-${crypto.randomUUID()}`;

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 5000;
const MAX_SHORT = 60;
const MAX_REASON = 500;
const MAX_CHAPTER_TITLE = 200;
/** Пять миллионов знаков — с запасом на самую длинную книгу; больше похоже на ошибку загрузки. */
const MAX_CHAPTER_CONTENT = 5_000_000;
const MAX_CHAPTERS = 500;
/** Сутки на главу: длиннее — ошибка в метаданных, а не озвучка. */
const MAX_AUDIO_SECONDS = 86400;

const text = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

/** Содержание главы — тоже без управляющих символов, но перевод строки нужен. */
const content = (v, max) => Array.from(String(v ?? ''))
  .filter((ch) => ch === '\n' || ch.charCodeAt(0) > 31)
  .join('')
  .slice(0, max);

const num = (v, min, max) => {
  if (v === null || v === undefined || v === '' || typeof v === 'object') return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
};

const wordCount = (s) => {
  const t = String(s ?? '').trim();
  return t ? t.split(/\s+/).length : 0;
};

export const CATEGORIES = [
  'Художественная литература', 'Фантастика', 'Детектив', 'Бизнес',
  'Саморазвитие', 'История', 'Наука', 'Биография', 'Поэзия', 'Другое',
];

/* ─── Представление наружу ─────────────────────────────────────────── */

export const toBook = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description ? (decryptContent(row.description) ?? '') : undefined,
  category: row.category,
  genre: row.genre ?? undefined,
  language: row.language,
  accent: row.accent,
  hasCover: Boolean(row.has_cover),
  status: row.status,
  private: row.status !== 'published',
  explicit: (row.mod_explicit ?? row.explicit) === true || undefined,
  legacy: row.legacy_label === true || undefined,
  chapters: Number(row.chapters_count ?? 0),
  words: Number(row.words_count ?? 0),
  audioSeconds: Number(row.audio_seconds ?? 0),
  hasText: Number(row.words_count ?? 0) > 0,
  hasAudio: Number(row.audio_seconds ?? 0) > 0,
  reads: Number(row.reads_count ?? 0),
  listens: Number(row.listens_count ?? 0),
  authorName: row.author_name ?? undefined,
  own: row.own === true || undefined,
  onShelf: row.on_shelf === true || undefined,
  createdAt: row.created_at?.toISOString?.(),
  rejectReason: row.own === true && row.reject_reason
    ? (decryptContent(row.reject_reason) ?? undefined) : undefined,
});

export const toChapterMeta = (row) => ({
  id: row.id,
  bookId: row.book_id,
  number: row.number,
  title: row.title,
  wordCount: Number(row.word_count ?? 0),
  hasText: Number(row.word_count ?? 0) > 0,
  hasAudio: Boolean(row.has_audio),
  audioSeconds: Number(row.audio_seconds ?? 0),
  audioMime: row.audio_mime ?? undefined,
});

export const toChapterFull = (row) => ({
  ...toChapterMeta(row),
  content: row.content ? (decryptContent(row.content) ?? '') : '',
});

const SELECT_BOOK = `
  SELECT b.*,
         b.author_id = $1 AS own,
         a.name AS author_name,
         EXISTS (SELECT 1 FROM book_shelf s WHERE s.book_id = b.id AND s.user_id = $1) AS on_shelf
    FROM books b
    LEFT JOIN profiles a ON a.id = b.author_id
`;

/* ─── Доступ ───────────────────────────────────────────────────────── */

export const visibleBook = async (bookId, viewerId) => {
  const { rows } = await query('SELECT * FROM books WHERE id = $1', [String(bookId ?? '')]);
  const row = rows[0];
  if (!row) return null;
  if (row.author_id && row.author_id === viewerId) return { ...row, own: true };
  if (row.status === 'published') return row;
  if (row.status === 'pending' && await can(viewerId, 'content')) return row;
  return null;
};

/* ─── Каталог ──────────────────────────────────────────────────────── */

// Ограничения Sky Media: ограниченное произведение и направление автора из каталога скрыты.
const PUBLIC_ONLY = `b.status = 'published' AND NOT EXISTS (SELECT 1 FROM media_restrictions r WHERE r.status = 'active' AND r.direction = 'books' AND ((r.scope = 'work' AND r.target_id = b.id) OR (r.scope = 'author_direction' AND r.target_id = b.author_id)))`;

const searchClause = (q, args, columns) => {
  const needle = text(q, 100).toLowerCase();
  if (!needle) return null;
  args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`);
  const n = args.length;
  return `(${columns.map((c) => `lower(${c}) LIKE $${n} ESCAPE '\\'`).join(' OR ')})`;
};

export const listBooks = async (viewerId, { q, category, limit, offset, sort, hideExplicit } = {}) => {
  const lim = num(limit, 1, 100) ?? 40;
  const off = num(offset, 0, 100000) ?? 0;
  const args = [viewerId ?? '', lim, off];
  const where = [PUBLIC_ONLY];
  if (hideExplicit) where.push('NOT coalesce(b.mod_explicit, b.explicit)');

  const cat = text(category, MAX_SHORT);
  if (cat && cat !== 'Все') { args.push(cat); where.push(`b.category = $${args.length}`); }

  const s = searchClause(q, args, ['b.title', 'b.genre', 'a.name']);
  if (s) where.push(s);

  const order = sort === 'popular' ? '(b.reads_count + b.listens_count) DESC, b.created_at DESC'
    : sort === 'new' ? 'b.created_at DESC'
      : 'b.created_at DESC';

  const { rows } = await query(
    `${SELECT_BOOK} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $2 OFFSET $3`, args);
  return rows.map(toBook);
};

export const listCategories = async () => {
  const { rows } = await query(
    `SELECT category, count(*)::int AS n FROM books
      WHERE status = 'published' GROUP BY category ORDER BY n DESC, category`);
  return rows.map((r) => ({ name: r.category, count: r.n }));
};

export const listMine = async (authorId) => {
  const { rows } = await query(
    `${SELECT_BOOK} WHERE b.author_id = $1 ORDER BY b.created_at DESC LIMIT 200`, [authorId]);
  return rows.map(toBook);
};

export const readBook = async (bookId, viewerId) => {
  if (!(await visibleBook(bookId, viewerId))) return null;
  const { rows } = await query(`${SELECT_BOOK} WHERE b.id = $2`, [viewerId ?? '', String(bookId ?? '')]);
  return rows[0] ? toBook(rows[0]) : null;
};

/* ─── Создание и правка книги ──────────────────────────────────────── */

export const createBook = async (authorId, meta = {}) => {
  const title = text(meta.title, MAX_TITLE);
  if (!title) return { error: 'invalid_meta' };
  const { rows: cnt } = await query('SELECT count(*)::int AS n FROM books WHERE author_id = $1', [authorId]);
  if ((cnt[0]?.n ?? 0) >= 200) return { error: 'too_many' };

  const description = text(meta.description, MAX_DESCRIPTION);
  const id = newId('bok');
  await query(
    `INSERT INTO books (id, author_id, title, description, category, genre, language, accent, explicit, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'private')`,
    [id, authorId, title,
      description ? encryptContent(description) : null,
      CATEGORIES.includes(text(meta.category, MAX_SHORT)) ? text(meta.category, MAX_SHORT) : 'Другое',
      text(meta.genre, MAX_SHORT) || null,
      text(meta.language, 8) || 'ru',
      /^#[0-9a-f]{6}$/i.test(String(meta.accent ?? '')) ? String(meta.accent) : '#f59e0b',
      meta.explicit === true]);
  return { id };
};

export const updateBook = async (bookId, authorId, patch = {}) => {
  const { rows } = await query('SELECT author_id, status FROM books WHERE id = $1', [String(bookId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].author_id !== authorId) return { error: 'not_allowed' };

  const sets = [];
  const args = [bookId];
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
  if (patch.genre !== undefined) put('genre', text(patch.genre, MAX_SHORT) || null);
  if (patch.accent !== undefined && /^#[0-9a-f]{6}$/i.test(String(patch.accent))) {
    put('accent', String(patch.accent));
  }
  if (patch.explicit !== undefined) put('explicit', patch.explicit === true);
  if (patch.status !== undefined) {
    if (String(patch.status) === 'private') { put('status', 'private'); put('submitted_at', null); }
    else return { error: 'invalid_status' };
  }
  if (sets.length === 0) return { ok: true };
  await query(`UPDATE books SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  return { ok: true };
};

export const deleteBook = async (bookId, authorId) => {
  const { rows } = await query('SELECT author_id FROM books WHERE id = $1', [String(bookId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].author_id !== authorId) return { error: 'not_allowed' };
  // Идентификаторы глав нужны потом, чтобы убрать их файлы с диска —
  // после DELETE строк в базе уже не останется, откуда их взять.
  const { rows: chapters } = await query('SELECT id FROM book_chapters WHERE book_id = $1', [bookId]);
  await query('DELETE FROM books WHERE id = $1', [bookId]);
  return { ok: true, chapterIds: chapters.map((c) => c.id) };
};

export const setCoverFlag = async (bookId, hasCover, mime) => {
  await query('UPDATE books SET has_cover = $2, cover_mime = $3, updated_at = now() WHERE id = $1',
    [bookId, hasCover, mime ?? null]);
};

/** Право на обложку сначала, запись на диск — только после него. */
export const setBookCover = async (bookId, authorId, mime) => {
  const { rows } = await query('SELECT author_id FROM books WHERE id = $1', [String(bookId ?? '')]);
  if (!rows[0] || rows[0].author_id !== authorId) return false;
  await setCoverFlag(bookId, true, mime);
  return true;
};

/* ─── Главы ────────────────────────────────────────────────────────── */

export const listChapters = async (bookId, viewerId) => {
  const book = await visibleBook(bookId, viewerId);
  if (!book) return null;
  const { rows } = await query(
    'SELECT * FROM book_chapters WHERE book_id = $1 ORDER BY number', [String(bookId ?? '')]);
  return rows.map(toChapterMeta);
};

/** Полная глава с текстом — доступ ровно такой же, как у книги. */
export const readChapter = async (chapterId, viewerId) => {
  const { rows } = await query('SELECT * FROM book_chapters WHERE id = $1', [String(chapterId ?? '')]);
  const row = rows[0];
  if (!row) return null;
  const book = await visibleBook(row.book_id, viewerId);
  if (!book) return null;
  return toChapterFull(row);
};

/** Строка главы напрямую, без проверки права — для внутренних нужд (загрузка, удаление). */
const chapterRow = async (chapterId) => {
  const { rows } = await query('SELECT * FROM book_chapters WHERE id = $1', [String(chapterId ?? '')]);
  return rows[0] ?? null;
};

/** Глава, если ею владеет именно этот автор — перед загрузкой файла на диск. */
export const ownedChapterRow = async (chapterId, authorId) => {
  const row = await chapterRow(chapterId);
  if (!row) return null;
  const { rows: br } = await query('SELECT author_id FROM books WHERE id = $1', [row.book_id]);
  if (!br[0] || br[0].author_id !== authorId) return null;
  return row;
};

/** Глава для выдачи озвучки — видна, если видна сама книга. */
export const visibleChapterRow = async (chapterId, viewerId) => {
  const row = await chapterRow(chapterId);
  if (!row) return null;
  if (!(await visibleBook(row.book_id, viewerId))) return null;
  return row;
};

const recomputeBookTotals = async (bookId) => {
  await query(
    `UPDATE books SET
       chapters_count = (SELECT count(*) FROM book_chapters WHERE book_id = $1),
       words_count = (SELECT coalesce(sum(word_count),0) FROM book_chapters WHERE book_id = $1),
       audio_seconds = (SELECT coalesce(sum(audio_seconds),0) FROM book_chapters WHERE book_id = $1),
       updated_at = now()
     WHERE id = $1`,
    [bookId],
  );
};

export const createChapter = async (bookId, authorId, meta = {}) => {
  const { rows } = await query('SELECT author_id FROM books WHERE id = $1', [String(bookId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].author_id !== authorId) return { error: 'not_allowed' };

  const { rows: cnt } = await query('SELECT count(*)::int AS n FROM book_chapters WHERE book_id = $1', [bookId]);
  if ((cnt[0]?.n ?? 0) >= MAX_CHAPTERS) return { error: 'too_many' };

  const title = text(meta.title, MAX_CHAPTER_TITLE) || `Глава ${(cnt[0]?.n ?? 0) + 1}`;
  const body = content(meta.content, MAX_CHAPTER_CONTENT);
  const wc = wordCount(body);
  const id = newId('bch');
  const nextNumber = (cnt[0]?.n ?? 0) + 1;
  await query(
    `INSERT INTO book_chapters (id, book_id, number, title, content, word_count)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, bookId, nextNumber, title, body ? encryptContent(body) : null, wc]);
  await recomputeBookTotals(bookId);
  return { id, number: nextNumber };
};

export const updateChapter = async (chapterId, authorId, patch = {}) => {
  const row = await chapterRow(chapterId);
  if (!row) return { error: 'not_found' };
  const { rows: br } = await query('SELECT author_id FROM books WHERE id = $1', [row.book_id]);
  if (!br[0] || br[0].author_id !== authorId) return { error: 'not_allowed' };

  const sets = [];
  const args = [chapterId];
  const put = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };

  if (patch.title !== undefined) {
    const t = text(patch.title, MAX_CHAPTER_TITLE);
    put('title', t || row.title);
  }
  if (patch.content !== undefined) {
    const body = content(patch.content, MAX_CHAPTER_CONTENT);
    const wc = wordCount(body);
    put('content', body ? encryptContent(body) : null);
    put('word_count', wc);
  }
  if (sets.length === 0) return { ok: true };
  await query(`UPDATE book_chapters SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  await recomputeBookTotals(row.book_id);
  return { ok: true };
};

export const deleteChapter = async (chapterId, authorId) => {
  const row = await chapterRow(chapterId);
  if (!row) return { error: 'not_found' };
  const { rows: br } = await query('SELECT author_id FROM books WHERE id = $1', [row.book_id]);
  if (!br[0] || br[0].author_id !== authorId) return { error: 'not_allowed' };
  await query('DELETE FROM book_chapters WHERE id = $1', [chapterId]);
  await recomputeBookTotals(row.book_id);
  return { ok: true, bookId: row.book_id };
};

/** После сохранения файла озвучки на диск — отметить длительность и тип в базе. */
export const finishChapterAudio = async (chapterId, authorId, durationSec, mime) => {
  const row = await chapterRow(chapterId);
  if (!row) return { error: 'not_found' };
  const { rows: br } = await query('SELECT author_id FROM books WHERE id = $1', [row.book_id]);
  if (!br[0] || br[0].author_id !== authorId) return { error: 'not_allowed' };
  const secs = num(durationSec, 0, MAX_AUDIO_SECONDS) ?? 0;
  await query(
    'UPDATE book_chapters SET has_audio = TRUE, audio_seconds = $2, audio_mime = $3, updated_at = now() WHERE id = $1',
    [chapterId, secs, mime ?? null]);
  await recomputeBookTotals(row.book_id);
  return { ok: true };
};

export const dropChapterAudio = async (chapterId, authorId) => {
  const row = await chapterRow(chapterId);
  if (!row) return { error: 'not_found' };
  const { rows: br } = await query('SELECT author_id FROM books WHERE id = $1', [row.book_id]);
  if (!br[0] || br[0].author_id !== authorId) return { error: 'not_allowed' };
  await query('UPDATE book_chapters SET has_audio = FALSE, audio_seconds = 0, updated_at = now() WHERE id = $1', [chapterId]);
  await recomputeBookTotals(row.book_id);
  return { ok: true };
};

/* ─── Публикация ───────────────────────────────────────────────────── */

export const submitBook = async (bookId, authorId) => {
  const { rows } = await query('SELECT * FROM books WHERE id = $1', [String(bookId ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.author_id !== authorId) return { error: 'not_allowed' };
  if (row.status === 'pending') return { error: 'already_pending' };
  if (row.status === 'published') return { error: 'already_published' };
  if (Number(row.chapters_count) === 0) return { error: 'no_chapters' };
  await query(
    `UPDATE books SET status = 'pending', submitted_at = now(), reject_reason = NULL, updated_at = now()
     WHERE id = $1`, [bookId]);
  void notifyStaff('content', { title: 'Новая книга на проверке', body: 'Книга ждёт решения в разделе «Контент».', dedupe: `book:${bookId}` });
  return { ok: true };
};

export const moderationQueue = async (adminId) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query(`${SELECT_BOOK} WHERE b.status = 'pending' ORDER BY b.submitted_at`, ['']);
  return rows.map(toBook);
};

export const moderateBook = async (adminId, bookId, approve, reason) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT status FROM books WHERE id = $1', [String(bookId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].status !== 'pending') return { error: 'not_pending' };
  if (approve) {
    await query(
      `UPDATE books SET status = 'published', published_at = now(), reject_reason = NULL, updated_at = now()
       WHERE id = $1`, [bookId]);
  } else {
    const r = text(reason, MAX_REASON) || 'Отклонено без указания причины';
    await query(
      `UPDATE books SET status = 'rejected', reject_reason = $2, updated_at = now() WHERE id = $1`,
      [bookId, encryptContent(r)]);
  }
  return { ok: true };
};

/* ─── Прогресс ─────────────────────────────────────────────────────── */

export const getProgress = async (bookId, userId) => {
  const { rows } = await query('SELECT * FROM book_progress WHERE book_id = $1 AND user_id = $2',
    [String(bookId ?? ''), userId]);
  const row = rows[0];
  if (!row) return null;
  return {
    lastMode: row.last_mode,
    textChapter: row.text_chapter,
    textOffset: row.text_offset,
    audioChapter: row.audio_chapter,
    audioPosition: Number(row.audio_position),
    completed: row.completed,
  };
};

/**
 * Единый плеер хранит оба вида прогресса в одной строке, и сохраняет
 * их порознь: включив звук, человек не должен терять место, на
 * котором остановилось чтение, и наоборот. Поэтому здесь не полная
 * перезапись, а обновление только той пары полей, что пришла в этот
 * раз — вторая пара остаётся прежней (через COALESCE от уже
 * существующей строки, а для новой строки — от значений по умолчанию).
 */
export const setProgress = async (bookId, userId, patch = {}) => {
  if (!(await visibleBook(bookId, userId))) return { error: 'not_found' };
  const mode = patch.mode === 'audio' ? 'audio' : 'text';
  const completed = patch.completed === true;

  const textChapter = patch.textChapter !== undefined ? num(patch.textChapter, 1, MAX_CHAPTERS) ?? 1 : null;
  const textOffset = patch.textOffset !== undefined ? num(patch.textOffset, 0, MAX_CHAPTER_CONTENT) ?? 0 : null;
  const audioChapter = patch.audioChapter !== undefined ? num(patch.audioChapter, 1, MAX_CHAPTERS) ?? 1 : null;
  const audioPosition = patch.audioPosition !== undefined && Number.isFinite(Number(patch.audioPosition))
    ? Math.max(0, Number(patch.audioPosition)) : null;

  await query(
    `INSERT INTO book_progress (book_id, user_id, last_mode, text_chapter, text_offset, audio_chapter, audio_position, completed)
     VALUES ($1,$2,$3, coalesce($4,1), coalesce($5,0), coalesce($6,1), coalesce($7,0::numeric), $8)
     ON CONFLICT (book_id, user_id) DO UPDATE SET
       last_mode = $3,
       text_chapter = coalesce($4, book_progress.text_chapter),
       text_offset = coalesce($5, book_progress.text_offset),
       audio_chapter = coalesce($6, book_progress.audio_chapter),
       audio_position = coalesce($7, book_progress.audio_position),
       completed = $8, updated_at = now()`,
    [bookId, userId, mode, textChapter, textOffset, audioChapter, audioPosition, completed],
  );
  return { ok: true };
};

/** Открытие книги в том или ином виде — простой счётчик популярности. */
export const notePlayed = async (bookId, kind) => {
  const col = kind === 'audio' ? 'listens_count' : 'reads_count';
  await query(`UPDATE books SET ${col} = ${col} + 1 WHERE id = $1`, [String(bookId ?? '')]);
};

/* ─── Полка ────────────────────────────────────────────────────────── */

export const listShelf = async (userId) => {
  const { rows } = await query(
    `${SELECT_BOOK} JOIN book_shelf s ON s.book_id = b.id
      WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT 300`, [userId]);
  return rows.map(toBook);
};

export const setShelf = async (bookId, userId, on) => {
  if (!(await visibleBook(bookId, userId))) return { error: 'not_found' };
  if (on) {
    await query('INSERT INTO book_shelf (book_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [bookId, userId]);
  } else {
    await query('DELETE FROM book_shelf WHERE book_id = $1 AND user_id = $2', [bookId, userId]);
  }
  return { ok: true };
};
