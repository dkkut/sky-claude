/**
 * Архив удалённых материалов: 20 дней на возврат, за 2 дня — уведомление.
 *
 * Материал не стирается. У него снимается владелец и ставится скрытый статус —
 * ни один каталог, поиск или лента его не видят, а строка и файлы живы.
 * Здесь запоминается чей он был и каким. Через PURGE_DAYS уборка возвращает
 * владельца и вызывает прежние функции окончательного удаления (они же убирают
 * файлы), поэтому «после очищаются везде» — это обычное удаление, только позже.
 * Охват: музыка, кино и серии, книги, Sky Video. Подкасты и посты Bloom сюда
 * не входят (у Bloom своё мягкое удаление, у подкастов — прежнее).
 */
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { notifyGift } from './giftnotify.mjs';
import { deleteTrack } from './music.mjs';
import { remove as removeAudio } from './musicstore.mjs';
import { deleteMovie } from './film.mjs';
import { deleteBook } from './books.mjs';
import { removeBookFiles, removeChapterAudio } from './bookstore.mjs';
import { deleteVideo } from './skyvideo.mjs';

export const PURGE_DAYS = Math.max(1, Number(process.env.ARCHIVE_DAYS) || 20);
export const WARN_DAYS = 2;

const KINDS = {
  track: { table: 'music_tracks', owner: 'owner_id', hidden: 'rejected', title: 'title' },
  movie: { table: 'film_movies', owner: 'owner_id', hidden: 'rejected', title: 'title' },
  book:  { table: 'books', owner: 'author_id', hidden: 'rejected', title: 'title' },
  video: { table: 'sky_videos', owner: 'owner_id', hidden: 'hidden', title: 'title' },
};

export const archiveKinds = () => Object.keys(KINDS);

/** Убрать материал в архив. Только владелец; чужое/служебное — прежним удалением. */
export const archiveByOwner = async (kind, itemId, actorId) => {
  const k = KINDS[kind];
  if (!k) return { error: 'bad_kind' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT ${k.owner} AS owner, status, ${k.title} AS title FROM ${k.table} WHERE id = $1 FOR UPDATE`, [String(itemId ?? '')]);
    const row = rows[0];
    if (!row) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (row.owner !== actorId) { await client.query('ROLLBACK'); return { error: 'not_owner' }; }
    const ins = await client.query(
      `INSERT INTO content_archive (id, kind, item_id, owner_id, title, prev_status, purge_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' days')::interval)
       ON CONFLICT DO NOTHING RETURNING id, purge_at`,
      [`arc-${generateId()}`, kind, itemId, actorId, String(row.title ?? '').slice(0, 200), row.status, String(PURGE_DAYS)]);
    if (!ins.rows[0]) { await client.query('ROLLBACK'); return { ok: true, duplicate: true }; }
    await client.query(`UPDATE ${k.table} SET ${k.owner} = NULL, status = $2, updated_at = now() WHERE id = $1`, [itemId, k.hidden]);
    await client.query('COMMIT');
    return { ok: true, archiveId: ins.rows[0].id, purgeAt: ins.rows[0].purge_at };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
};

export const listArchive = async (ownerId) => {
  const { rows } = await query(
    `SELECT id, kind, item_id, title, archived_at, purge_at FROM content_archive
      WHERE owner_id = $1 AND state = 'archived' ORDER BY archived_at DESC LIMIT 500`, [ownerId]);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, itemId: r.item_id, title: r.title,
    archivedAt: r.archived_at, purgeAt: r.purge_at,
    daysLeft: Math.max(0, Math.ceil((new Date(r.purge_at).getTime() - Date.now()) / 86400000)),
  }));
};

const restoreRow = async (client, a) => {
  const k = KINDS[a.kind];
  // Публичный статус обратно не возвращаем: опубликованное вернётся личным и уйдёт на проверку заново.
  const status = a.prev_status === 'published' ? (a.kind === 'video' ? 'draft' : 'private') : a.prev_status === 'rejected' ? 'private' : a.prev_status;
  const safe = a.kind === 'video' && !['draft', 'published', 'hidden', 'removed'].includes(status) ? 'draft' : status;
  await client.query(`UPDATE ${k.table} SET ${k.owner} = $2, status = $3, updated_at = now() WHERE id = $1 AND ${k.owner} IS NULL`, [a.item_id, a.owner_id, safe]);
};

export const restoreArchived = async (archiveId, ownerId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM content_archive WHERE id = $1 AND owner_id = $2 AND state = 'archived' FOR UPDATE`, [String(archiveId ?? ''), ownerId]);
    if (!rows[0]) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    await restoreRow(client, rows[0]);
    await client.query(`UPDATE content_archive SET state = 'restored' WHERE id = $1`, [rows[0].id]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};

/** Окончательно: вернуть владельца и вызвать прежнее удаление (оно же убирает файлы). */
const hardDelete = async (a) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await restoreRow(client, a);
    await client.query('COMMIT');
  } finally { client.release(); }
  const owner = a.owner_id;
  if (a.kind === 'track') {
    const r = await deleteTrack(a.item_id, owner);
    if (r.ok) { await removeAudio(a.item_id).catch(() => {}); await removeAudio(`cov-${String(a.item_id).slice(4)}`).catch(() => {}); }
    return r;
  }
  if (a.kind === 'movie') return deleteMovie(a.item_id, owner);
  if (a.kind === 'book') {
    const r = await deleteBook(a.item_id, owner);
    if (r.ok) { await removeBookFiles(a.item_id).catch(() => {}); for (const c of r.chapterIds ?? []) await removeChapterAudio(c).catch(() => {}); }
    return r;
  }
  return deleteVideo(a.item_id, owner);
};

export const purgeNow = async (archiveId, ownerId) => {
  const { rows } = await query(
    `UPDATE content_archive SET state = 'purged' WHERE id = $1 AND owner_id = $2 AND state = 'archived' RETURNING *`, [String(archiveId ?? ''), ownerId]);
  if (!rows[0]) return { error: 'not_found' };
  await hardDelete(rows[0]);
  return { ok: true };
};

/** Почасовая уборка: напомнить за 2 дня, стереть просроченное. */
export const sweepArchive = async () => {
  const warn = await query(
    `UPDATE content_archive SET warned_at = now()
      WHERE state = 'archived' AND warned_at IS NULL AND purge_at <= now() + ($1 || ' days')::interval AND purge_at > now()
      RETURNING owner_id, title, purge_at, id`, [String(WARN_DAYS)]);
  const byOwner = new Map();
  for (const r of warn.rows) byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r]);
  for (const [owner, items] of byOwner) {
    const names = items.slice(0, 3).map((i) => i.title || 'Без названия').join(', ');
    const more = items.length > 3 ? ` и ещё ${items.length - 3}` : '';
    await notifyGift(owner, 'archive_warning', 'Архив материалов: осталось 2 дня',
      `Через 2 дня окончательно удалятся: ${names}${more}. Верните их в архиве, если они ещё нужны.`, items[0].id).catch(() => {});
  }
  const due = await query(
    `UPDATE content_archive SET state = 'purged' WHERE state = 'archived' AND purge_at <= now() RETURNING *`);
  let purged = 0;
  for (const a of due.rows) {
    try { await hardDelete(a); purged += 1; } catch (e) { console.error('[archive]', a.kind, a.item_id, e.message); }
  }
  return { warned: warn.rows.length, purged };
};
