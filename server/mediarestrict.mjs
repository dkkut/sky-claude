/**
 * Ограничения доступа Sky Media: на ОДНО произведение (scope=work) или на ВСЁ направление автора
 * (scope=author_direction; film | music | books | podcasts — независимо друг от друга).
 * Автор музыки — правообладатель (владелец подтверждённой карточки), у остальных — владелец записи.
 * Ограничение ничего не удаляет: избранное, плейлисты, история и файлы остаются, пока ограничение не снято.
 * Закрывает воспроизведение на сервере (шлюз в server.mjs → `gateFor`), а клиенту отдаёт данные для баннера.
 */
import { pool, query } from './db.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { isOwner } from './admin.mjs';

export const DIRECTIONS = ['film', 'music', 'books', 'podcasts'];
const err = (e, x = {}) => ({ error: e, ...x });
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Работа → { workId, authorId } по направлению и id (для книг/подкастов допускается id главы/выпуска). */
export const resolveWork = async (direction, id, { kind = 'work' } = {}) => {
  const i = String(id ?? '');
  if (!i) return null;
  if (direction === 'music') {
    const r = (await query(`SELECT t.id, k.owner_id FROM music_tracks t LEFT JOIN music_artist_cards k ON k.id=t.artist_card_id WHERE t.id=$1`, [i])).rows[0];
    return r ? { workId: r.id, authorId: r.owner_id ?? null } : null;
  }
  if (direction === 'film') {
    const r = (await query(`SELECT id, owner_id FROM film_movies WHERE id=$1`, [i])).rows[0];
    return r ? { workId: r.id, authorId: r.owner_id ?? null } : null;
  }
  if (direction === 'books') {
    const r = (await query(kind === 'chapter'
      ? `SELECT b.id, b.author_id FROM book_chapters c JOIN books b ON b.id=c.book_id WHERE c.id=$1`
      : `SELECT id, author_id FROM books WHERE id=$1`, [i])).rows[0];
    return r ? { workId: r.id, authorId: r.author_id ?? null } : null;
  }
  if (direction === 'podcasts') {
    const r = (await query(kind === 'episode'
      ? `SELECT p.id, p.owner_id FROM podcast_episodes e JOIN podcasts p ON p.id=e.podcast_id WHERE e.id=$1`
      : `SELECT id, owner_id FROM podcasts WHERE id=$1`, [i])).rows[0];
    return r ? { workId: r.id, authorId: r.owner_id ?? null } : null;
  }
  return null;
};

const publicOf = (r) => r && ({ id: Number(r.id), scope: r.scope, direction: r.direction, note: r.public_note || null, since: r.created_at });

/** Действующее ограничение, закрывающее произведение (на него самого или на направление автора). null — доступно. */
export const activeFor = async (direction, workId, authorId) => {
  const r = (await query(
    `SELECT * FROM media_restrictions WHERE status='active' AND direction=$1
        AND ((scope='work' AND target_id=$2) OR (scope='author_direction' AND target_id=$3)) ORDER BY scope LIMIT 1`, [direction, workId, authorId ?? ''])).rows[0];
  return r ?? null;
};

/** Шлюз медиа: путь → ограничение (или null). Только запросы воспроизведения/файла. */
const MEDIA = [
  [/^\/api\/music\/track\/([^/]+)\/(?:audio|video)$/, 'music', 'work'],
  [/^\/api\/film\/movie\/([^/]+)\/video$/, 'film', 'work'],
  [/^\/api\/books\/chapter\/([^/]+)\/audio$/, 'books', 'chapter'],
  [/^\/api\/podcasts\/episode\/([^/]+)\/(?:audio|video)$/, 'podcasts', 'episode'],
];
const cache = new Map();
export const gateFor = async (path) => {
  for (const [re, dir, kind] of MEDIA) {
    const m = re.exec(path);
    if (!m) continue;
    const key = `${dir}:${m[1]}`; const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 3000) return hit.v;
    const w = await resolveWork(dir, m[1], { kind });
    const v = w ? publicOf(await activeFor(dir, w.workId, w.authorId)) : null;
    cache.set(key, { at: Date.now(), v }); if (cache.size > 2000) cache.clear();
    return v;
  }
  return null;
};
export const forgetGate = () => cache.clear();

/** Состояние для баннера: по произведению (любой человек) — без основания. */
export const statusOf = async (direction, id, kind = 'work') => {
  if (!DIRECTIONS.includes(direction)) return err('bad_direction');
  const w = await resolveWork(direction, id, { kind });
  if (!w) return err('not_found');
  return { blocked: !!(await activeFor(direction, w.workId, w.authorId)), restriction: publicOf(await activeFor(direction, w.workId, w.authorId)) };
};

/** Направления автора, закрытые целиком (для профиля автора). */
export const authorBlocks = async (authorId) => {
  const rows = (await query(`SELECT * FROM media_restrictions WHERE status='active' AND scope='author_direction' AND target_id=$1`, [authorId])).rows;
  return Object.fromEntries(rows.map((r) => [r.direction, publicOf(r)]));
};

const logRow = (c, id, actor, action, detail) => c.query(`INSERT INTO media_restriction_log (restriction_id, actor_id, action, detail) VALUES ($1,$2,$3,$4)`, [id, actor, action, clean(detail, 300)]);

export const create = async (actorId, { scope, direction, targetId, basis, ref = '', publicNote = '' } = {}) => {
  if (!['work', 'author_direction'].includes(scope)) return err('bad_scope');
  if (!DIRECTIONS.includes(direction)) return err('bad_direction');
  const b = clean(basis, 600); if (b.length < 10) return err('basis_required');
  let authorId; let target = clean(targetId, 80);
  if (scope === 'work') {
    const w = await resolveWork(direction, target); if (!w) return err('not_found');
    authorId = w.authorId; target = w.workId;
  } else {
    if (!(await query('SELECT 1 FROM profiles WHERE id=$1', [target])).rowCount) return err('not_found');
    authorId = target;
  }
  if (authorId && authorId === actorId) return err('self_review');
  if (authorId && (await isOwner(authorId))) return err('owner_protected');
  const c = await pool.connect();
  let id;
  try {
    await c.query('BEGIN');
    const r = await c.query(
      `INSERT INTO media_restrictions (scope, direction, target_id, author_id, basis, ref, public_note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [scope, direction, target, authorId, b, clean(ref, 80) || null, clean(publicNote, 200) || null, actorId]);
    id = Number(r.rows[0].id);
    await logRow(c, id, actorId, 'create', `${scope}:${direction}:${target}`);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); if (e.code === '23505') return err('already_active'); throw e; } finally { c.release(); }
  forgetGate();
  await logAdmin({ actorId, targetType: 'media', targetId: String(id), type: 'media_restrict', detail: `${scope}:${direction}:${target}` }).catch(() => {});
  if (authorId) notifyGift(authorId, 'media_restriction', 'Доступ к материалам ограничен', scope === 'work' ? 'Доступ к вашему произведению ограничен. Основание и порядок обжалования — в разделе «Студия».' : `Доступ к направлению «${direction}» ограничен. Основание и порядок обжалования — в разделе «Студия».`, `mr:${id}:create`).catch(() => {});
  return { ok: true, id };
};

export const lift = async (actorId, id, reason, { viaAppeal = false } = {}) => {
  const why = clean(reason, 300); if (why.length < 5) return err('reason_required');
  const c = await pool.connect(); let row;
  try {
    await c.query('BEGIN');
    row = (await c.query(`UPDATE media_restrictions SET status='lifted', lifted_by=$2, lifted_at=now(), lift_reason=$3 WHERE id=$1 AND status='active' RETURNING *`, [Number(id), actorId, why])).rows[0];
    if (!row) { await c.query('ROLLBACK'); return err('not_found'); }
    await logRow(c, row.id, actorId, viaAppeal ? 'lift_appeal' : 'lift', why);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  forgetGate();
  await logAdmin({ actorId, targetType: 'media', targetId: String(row.id), type: 'media_restrict_lift', detail: why }).catch(() => {});
  if (row.author_id) notifyGift(row.author_id, 'media_restriction', 'Ограничение снято', 'Доступ к материалам восстановлен.', `mr:${row.id}:lift`).catch(() => {});
  return { ok: true };
};

export const adminList = async ({ status = 'active', direction = '', q = '' } = {}) => {
  const rows = (await query(
    `SELECT r.*, p.username, p.name FROM media_restrictions r LEFT JOIN profiles p ON p.id=r.author_id
      WHERE ($1='' OR r.status=$1) AND ($2='' OR r.direction=$2) AND ($3='' OR r.target_id=$3 OR r.author_id=$3 OR lower(p.username)=lower($3))
      ORDER BY r.created_at DESC LIMIT 200`, [clean(status, 10), clean(direction, 10), clean(q, 80).replace(/^@/, '')])).rows;
  const open = new Set((await query(`SELECT restriction_id FROM media_restriction_appeals WHERE status='open'`)).rows.map((r) => String(r.restriction_id)));
  return rows.map((r) => ({ id: Number(r.id), scope: r.scope, direction: r.direction, targetId: r.target_id, authorId: r.author_id, author: r.username ? `@${r.username}` : r.name ?? null,
    basis: r.basis, ref: r.ref, publicNote: r.public_note, status: r.status, createdBy: r.created_by, createdAt: r.created_at, liftedAt: r.lifted_at, liftReason: r.lift_reason, openAppeal: open.has(String(r.id)) }));
};

export const history = async (id) => (await query(`SELECT actor_id, action, detail, at FROM media_restriction_log WHERE restriction_id=$1 ORDER BY id`, [Number(id)])).rows;

/* ─── Автор: свои ограничения и апелляции ─── */
export const mine = async (me) => {
  const rows = (await query(`SELECT * FROM media_restrictions WHERE author_id=$1 ORDER BY created_at DESC LIMIT 100`, [me])).rows;
  const ap = (await query(`SELECT * FROM media_restriction_appeals WHERE author_id=$1 ORDER BY created_at DESC`, [me])).rows;
  return rows.map((r) => ({ id: Number(r.id), scope: r.scope, direction: r.direction, targetId: r.target_id, basis: r.basis, ref: r.ref, note: r.public_note, status: r.status, since: r.created_at, liftedAt: r.lifted_at,
    appeals: ap.filter((a) => String(a.restriction_id) === String(r.id)).map((a) => ({ id: Number(a.id), status: a.status, body: a.body, note: a.decision_note, at: a.created_at })) }));
};

export const appeal = async (me, restrictionId, body) => {
  const text = clean(body, 2000); if (text.length < 20) return err('too_short');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = (await c.query(`SELECT * FROM media_restrictions WHERE id=$1 FOR UPDATE`, [Number(restrictionId)])).rows[0];
    if (!r || r.author_id !== me) { await c.query('ROLLBACK'); return err('not_found'); }
    if (r.status !== 'active') { await c.query('ROLLBACK'); return err('not_active'); }
    const n = (await c.query(`SELECT count(*)::int AS n FROM media_restriction_appeals WHERE restriction_id=$1`, [r.id])).rows[0].n;
    if (n >= 3) { await c.query('ROLLBACK'); return err('appeal_limit'); }
    const a = await c.query(`INSERT INTO media_restriction_appeals (restriction_id, author_id, body) VALUES ($1,$2,$3) RETURNING id`, [r.id, me, text]);
    await logRow(c, r.id, me, 'appeal', `#${a.rows[0].id}`);
    await c.query('COMMIT');
    return { ok: true, id: Number(a.rows[0].id) };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); if (e.code === '23505') return err('appeal_open'); throw e; } finally { c.release(); }
};

export const appealsQueue = async () => (await query(
  `SELECT a.id, a.restriction_id, a.author_id, a.body, a.created_at, r.scope, r.direction, r.target_id, r.basis, r.created_by
     FROM media_restriction_appeals a JOIN media_restrictions r ON r.id=a.restriction_id WHERE a.status='open' ORDER BY a.created_at`)).rows
  .map((a) => ({ id: Number(a.id), restrictionId: Number(a.restriction_id), authorId: a.author_id, body: a.body, at: a.created_at, scope: a.scope, direction: a.direction, targetId: a.target_id, basis: a.basis, createdBy: a.created_by }));

/** Решение по апелляции: не тот, кто ограничивал (кроме владельца сервиса). Принять = снять ограничение. */
export const decideAppeal = async (actorId, appealId, accept, note) => {
  const n = clean(note, 300); if (n.length < 5) return err('reason_required');
  const c = await pool.connect(); let a; let r;
  try {
    await c.query('BEGIN');
    a = (await c.query(`SELECT * FROM media_restriction_appeals WHERE id=$1 FOR UPDATE`, [Number(appealId)])).rows[0];
    if (!a || a.status !== 'open') { await c.query('ROLLBACK'); return err('not_found'); }
    r = (await c.query(`SELECT * FROM media_restrictions WHERE id=$1 FOR UPDATE`, [a.restriction_id])).rows[0];
    if (r.created_by === actorId && !(await isOwner(actorId))) { await c.query('ROLLBACK'); return err('self_review'); }
    await c.query(`UPDATE media_restriction_appeals SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1`, [a.id, accept ? 'accepted' : 'rejected', actorId, n]);
    await logRow(c, r.id, actorId, accept ? 'appeal_accept' : 'appeal_reject', n);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  if (accept) await lift(actorId, r.id, `Апелляция принята: ${n}`, { viaAppeal: true });
  else notifyGift(a.author_id, 'media_restriction', 'Апелляция отклонена', n, `mr:${r.id}:appeal:${a.id}`).catch(() => {});
  return { ok: true };
};
