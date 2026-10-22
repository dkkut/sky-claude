/**
 * Модерация и удаление контента из админки: музыка, кино, книги.
 *
 * Одно место для сотрудников с правом `content`: очередь заявок на
 * публикацию, поиск по каталогу и снятие (удаление) любого материала —
 * в том числе по обращению правообладателя. Любое решение пишется в
 * журнал администрации (цепочка с хешами), а автор получает уведомление
 * с причиной. Файлы убираются вместе со строкой в базе.
 */
import { query, pool } from './db.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { moderateTrack } from './music.mjs';
import { moderateMovie } from './film.mjs';
import { moderateBook } from './books.mjs';
import { remove as removeMusicFile } from './musicstore.mjs';
import { removeMovieFiles } from './filmstore.mjs';
import { removeBookFiles, removeChapterAudio } from './bookstore.mjs';

export const KINDS = ['music', 'movie', 'book'];
const MAX_REASON = 500;
const STATUSES = new Set(['pending', 'published', 'private', 'rejected']);

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);

const TABLE = {
  music: { table: 'music_tracks', owner: 'owner_id', title: "t.title || ' — ' || t.artist", extra: 't.license AS license, t.plays AS views' },
  movie: { table: 'film_movies', owner: 'owner_id', title: 't.title', extra: "NULL::text AS license, 0::bigint AS views" },
  book:  { table: 'books', owner: 'author_id', title: 't.title', extra: "NULL::text AS license, t.reads_count::bigint AS views" },
};

const view = (kind, r) => ({
  kind, id: r.id, title: r.title, status: r.status,
  ownerId: r.owner_id ?? null, ownerName: r.owner_username ?? null,
  license: r.license ?? undefined, views: Number(r.views ?? 0),
  createdAt: r.created_at?.toISOString?.() ?? null,
});

const selectSql = (kind, where) => {
  const t = TABLE[kind];
  return `SELECT t.id, ${t.title} AS title, t.status, t.${t.owner} AS owner_id, p.username AS owner_username,
                 t.created_at, ${t.extra}
            FROM ${t.table} t LEFT JOIN profiles p ON p.id = t.${t.owner}
           ${where}`;
};

/** Заявки на публикацию по всем трём разделам разом. */
export const contentQueue = async (adminId) => {
  if (!(await can(adminId, 'content'))) return null;
  const out = [];
  for (const kind of KINDS) {
    const { rows } = await query(`${selectSql(kind, "WHERE t.status = 'pending'")} ORDER BY t.created_at ASC LIMIT 100`);
    out.push(...rows.map((r) => view(kind, r)));
  }
  return { items: out };
};

/** Поиск по названию/исполнителю/автору и по идентификатору. */
export const contentSearch = async (adminId, { kind, q, status, limit } = {}) => {
  if (!(await can(adminId, 'content'))) return null;
  const kinds = KINDS.includes(kind) ? [kind] : KINDS;
  const needle = clean(q, 80).toLowerCase();
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const st = STATUSES.has(status) ? status : null;
  const out = [];
  for (const k of kinds) {
    const t = TABLE[k];
    const args = [];
    const conds = [];
    if (needle) {
      args.push(`%${needle.replace(/[%_\\]/g, '\\$&')}%`);
      const like = args.length;
      args.push(needle);
      const titleExpr = k === 'music' ? "lower(t.title || ' ' || t.artist)" : 'lower(t.title)';
      conds.push(`(${titleExpr} LIKE $${like} OR lower(coalesce(p.username,'')) LIKE $${like} OR lower(t.id) = $${args.length})`);
    }
    if (st) { args.push(st); conds.push(`t.status = $${args.length}`); }
    args.push(lim);
    const { rows } = await query(
      `${selectSql(k, conds.length ? `WHERE ${conds.join(' AND ')}` : '')} ORDER BY t.created_at DESC LIMIT $${args.length}`, args);
    out.push(...rows.map((r) => view(k, r)));
  }
  return { items: out.slice(0, lim) };
};

const notifyOwner = async (ownerId, title, body, refId) => {
  if (!ownerId) return;
  try { await notifyGift(ownerId, 'content_moderation', title, body, refId); } catch { /* уведомление — не повод откатывать решение */ }
};

const KIND_RU = { music: 'трек', movie: 'фильм', book: 'книга' };

/** Принять или отклонить заявку на публикацию. */
export const contentDecide = async (adminId, kind, id, { approve, reason } = {}, meta = {}) => {
  if (!KINDS.includes(kind)) return { error: 'bad_kind' };
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const why = clean(reason, MAX_REASON);
  if (!approve && why.length < 3) return { error: 'reason_required' };
  const { rows } = await query(selectSql(kind, 'WHERE t.id = $1'), [String(id ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  const r = kind === 'music' ? await moderateTrack(id, adminId, { approve, reason: why })
    : kind === 'movie' ? await moderateMovie(id, adminId, { approve, reason: why })
      : await moderateBook(adminId, id, approve, why);
  if (r.error) return r;
  await logAdmin({
    actorId: adminId, targetId: id, targetType: kind, type: approve ? 'content_approve' : 'content_reject',
    detail: `${kind}: ${row.title}${approve ? '' : ` — ${why}`}`.slice(0, 200), meta,
  });
  await notifyOwner(row.owner_id,
    approve ? 'Материал опубликован' : 'Материал отклонён',
    approve ? `«${row.title}» прошёл проверку и доступен в каталоге.` : `«${row.title}» не прошёл проверку: ${why}`, id);
  return { ok: true };
};

const TRASH_DAYS = 7;

/**
 * Снять материал с резервом: он сразу пропадает из каталога (статус `rejected`),
 * но запись и файлы лежат ещё 7 дней — за это время его можно вернуть.
 * Окончательно стирает только `purgeTrashedContent`.
 */
export const contentTakedown = async (adminId, kind, id, reason, meta = {}) => {
  if (!KINDS.includes(kind)) return { error: 'bad_kind' };
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const why = clean(reason, MAX_REASON);
  if (why.length < 3) return { error: 'reason_required' };
  const { rows } = await query(selectSql(kind, 'WHERE t.id = $1'), [String(id ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  const held = await query(`SELECT 1 FROM content_trash WHERE kind = $1 AND item_id = $2 AND state = 'held'`, [kind, id]);
  if (held.rows.length) return { error: 'already_trashed' };
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO content_trash (kind, item_id, title, owner_id, prev_status, reason, deleted_by, purge_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' days')::interval)`,
      [kind, id, row.title, row.owner_id, row.status, why, adminId, String(TRASH_DAYS)]);
    await c.query(`UPDATE ${TABLE[kind].table} SET status = 'rejected' WHERE id = $1`, [id]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await logAdmin({
    actorId: adminId, targetId: id, targetType: kind, type: 'content_takedown',
    detail: `${kind}: ${row.title} — ${why} (резерв ${TRASH_DAYS} дн.)`.slice(0, 200), meta,
  });
  await notifyOwner(row.owner_id, `Ваш ${KIND_RU[kind]} снят`, `«${row.title}» снят с платформы. Причина: ${why}. Если вы не согласны — напишите в Тех. поддержку (Профиль → Тех. поддержка).`, id);
  return { ok: true, purgeInDays: TRASH_DAYS };
};

/** Корзина: что снято и когда будет стёрто. */
export const contentTrashList = async (adminId) => {
  if (!(await can(adminId, 'content'))) return null;
  const { rows } = await query(
    `SELECT c.id, c.kind, c.item_id, c.title, c.reason, c.prev_status, c.deleted_at, c.purge_at, c.owner_id,
            p.username AS owner_username, a.username AS by_username
       FROM content_trash c LEFT JOIN profiles p ON p.id = c.owner_id LEFT JOIN profiles a ON a.id = c.deleted_by
      WHERE c.state = 'held' ORDER BY c.deleted_at DESC LIMIT 200`);
  return { items: rows.map((r) => ({
    trashId: Number(r.id), kind: r.kind, id: r.item_id, title: r.title, reason: r.reason, prevStatus: r.prev_status,
    ownerName: r.owner_username ?? null, byName: r.by_username ?? null,
    deletedAt: r.deleted_at.toISOString(), purgeAt: r.purge_at.toISOString(),
  })) };
};

/** Вернуть снятый материал в прежний статус. */
export const contentRestore = async (adminId, trashId, meta = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query(`SELECT * FROM content_trash WHERE id = $1 AND state = 'held'`, [Number(trashId) || 0]);
  const t = rows[0];
  if (!t) return { error: 'not_found' };
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`UPDATE ${TABLE[t.kind].table} SET status = $2 WHERE id = $1`, [t.item_id, t.prev_status]);
    await c.query(`UPDATE content_trash SET state = 'restored' WHERE id = $1`, [t.id]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await logAdmin({ actorId: adminId, targetId: t.item_id, targetType: t.kind, type: 'content_restore', detail: `${t.kind}: ${t.title}`.slice(0, 200), meta });
  await notifyOwner(t.owner_id, 'Материал возвращён', `«${t.title}» восстановлен.`, t.item_id);
  return { ok: true };
};

/** Стереть то, чей резерв истёк. Вызывается уборкой; только то, что снял администратор. */
export const purgeTrashedContent = async () => {
  const { rows } = await query(`SELECT * FROM content_trash WHERE state = 'held' AND purge_at < now() LIMIT 50`);
  let n = 0;
  for (const t of rows) {
    const { rows: claimed } = await query(`UPDATE content_trash SET state = 'purged' WHERE id = $1 AND state = 'held' RETURNING id`, [t.id]);
    if (!claimed.length) continue;
    const id = t.item_id;
    let chapterIds = [];
    if (t.kind === 'book') {
      const { rows: ch } = await query('SELECT id FROM book_chapters WHERE book_id = $1', [id]);
      chapterIds = ch.map((c) => c.id);
    }
    await query(`DELETE FROM ${TABLE[t.kind].table} WHERE id = $1`, [id]);
    if (t.kind === 'music') {
      await removeMusicFile(id).catch(() => {});
      await removeMusicFile(`cov-${String(id).slice(4)}`).catch(() => {});
      await removeMusicFile(`vid-${String(id).slice(4)}`).catch(() => {});
    } else if (t.kind === 'movie') await removeMovieFiles(id).catch(() => {});
    else {
      await removeBookFiles(id).catch(() => {});
      for (const c of chapterIds) await removeChapterAudio(c).catch(() => {});
    }
    n += 1;
  }
  return n;
};
