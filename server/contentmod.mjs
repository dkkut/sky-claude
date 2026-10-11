/**
 * Модерация и удаление контента из админки: музыка, кино, книги.
 *
 * Одно место для сотрудников с правом `content`: очередь заявок на
 * публикацию, поиск по каталогу и снятие (удаление) любого материала —
 * в том числе по обращению правообладателя. Любое решение пишется в
 * журнал администрации (цепочка с хешами), а автор получает уведомление
 * с причиной. Файлы убираются вместе со строкой в базе.
 */
import { query } from './db.mjs';
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

/** Снять материал: удалить запись и файлы. Причина обязательна — её увидит автор. */
export const contentTakedown = async (adminId, kind, id, reason, meta = {}) => {
  if (!KINDS.includes(kind)) return { error: 'bad_kind' };
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const why = clean(reason, MAX_REASON);
  if (why.length < 3) return { error: 'reason_required' };
  const { rows } = await query(selectSql(kind, 'WHERE t.id = $1'), [String(id ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };

  let chapterIds = [];
  if (kind === 'book') {
    const { rows: ch } = await query('SELECT id FROM book_chapters WHERE book_id = $1', [id]);
    chapterIds = ch.map((c) => c.id);
  }
  // Сначала запись в базе: если уборка файла не удастся, файл останется сиротой, а не «живой» карточкой без файла.
  await query(`DELETE FROM ${TABLE[kind].table} WHERE id = $1`, [id]);
  if (kind === 'music') {
    await removeMusicFile(id).catch(() => {});
    await removeMusicFile(`cov-${String(id).slice(4)}`).catch(() => {});
  } else if (kind === 'movie') {
    await removeMovieFiles(id).catch(() => {});
  } else {
    await removeBookFiles(id).catch(() => {});
    for (const c of chapterIds) await removeChapterAudio(c).catch(() => {});
  }
  await logAdmin({
    actorId: adminId, targetId: id, targetType: kind, type: 'content_takedown',
    detail: `${kind}: ${row.title} — ${why}`.slice(0, 200), meta,
  });
  await notifyOwner(row.owner_id, `Ваш ${KIND_RU[kind]} удалён`, `«${row.title}» снят с платформы. Причина: ${why}. Если вы не согласны — напишите в Тех. поддержку (Профиль → Тех. поддержка).`, id);
  return { ok: true };
};
