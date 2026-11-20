/**
 * Bloom: мероприятия. Организатор публикует встречу (место или https-ссылка, время, число мест),
 * люди отмечают «пойду» / «интересно». Sky ничего не продаёт и не проверяет — это объявление и список желающих.
 *  • мероприятие сообщества видно по правилам сообщества (закрытое — только участникам); создавать в нём может модерация;
 *  • «пойду» занимает место атомарно (под блокировкой строки мероприятия), сверх числа мест — отказ;
 *  • текст проходит фильтр контента: block — отказ, moderate — скрыто до решения сотрудника;
 *  • отмена и перенос уведомляют идущих; список имён видит только организатор, остальные — числа.
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { checkContent, blockedReply, createHold } from './contentfilterstore.mjs';

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max);
const line = (v, max) => clean(v, max).replace(/\s+/g, ' ');
const MAX_PER_DAY = 10; const MAX_UPCOMING = 20; const MAX_AHEAD_MS = 2 * 365 * 86400_000; const MAX_LEN_MS = 14 * 86400_000;

const httpsUrl = (v) => { const s = String(v ?? '').trim(); if (!s) return ''; try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u.toString().slice(0, 300) : null; } catch { return null; } };
const note = (to, kind, title, body, ref) => notifyGift(to, kind, title, body, ref).catch(() => {});

/** Видимость: не удалено, не скрыто фильтром (кроме своего), сообщество — по его правилам. */
const visibleSql = (v) => `(e.removed_at IS NULL AND (e.held_at IS NULL OR e.organizer_id = ${v}::text)
  AND (e.community_id IS NULL OR EXISTS (SELECT 1 FROM bloom_communities bc WHERE bc.id = e.community_id AND NOT bc.blocked AND bc.deleted_at IS NULL
    AND (bc.privacy = 'public' OR EXISTS (SELECT 1 FROM bloom_community_members bm WHERE bm.community_id = bc.id AND bm.profile_id = ${v}::text AND bm.status = 'active')))))`;

const SELECT = (v) => `SELECT e.*, p.name AS org_name, p.username AS org_username,
  (SELECT count(*)::int FROM bloom_event_rsvp r WHERE r.event_id = e.id AND r.status = 'going') AS going,
  (SELECT count(*)::int FROM bloom_event_rsvp r WHERE r.event_id = e.id AND r.status = 'interested') AS interested,
  (SELECT status FROM bloom_event_rsvp r WHERE r.event_id = e.id AND r.profile_id = ${v}::text) AS mine,
  (SELECT name FROM bloom_communities c WHERE c.id = e.community_id) AS community_name,
  (SELECT slug FROM bloom_communities c WHERE c.id = e.community_id) AS community_slug
  FROM bloom_events e LEFT JOIN profiles p ON p.id = e.organizer_id`;

const view = (e, me) => {
  const past = new Date(e.ends_at ?? e.starts_at).getTime() < Date.now();
  return {
    id: e.id, title: e.title, description: e.description, startsAt: e.starts_at, endsAt: e.ends_at,
    place: e.place || undefined, onlineUrl: e.online_url || undefined, capacity: e.capacity ?? undefined,
    going: e.going, interested: e.interested, full: e.capacity != null && e.going >= e.capacity,
    mine: e.mine ?? null, cancelled: Boolean(e.cancelled_at), cancelReason: e.cancelled_at ? e.cancel_reason ?? undefined : undefined,
    past, held: Boolean(e.held_at) || undefined, isOrganizer: e.organizer_id === me,
    organizer: { id: e.organizer_id, name: e.org_name, username: e.org_username },
    community: e.community_id ? { id: e.community_id, name: e.community_name, slug: e.community_slug } : undefined,
  };
};

const parseWhen = (b, cur) => {
  const s = new Date(b.startsAt ?? cur?.starts_at); if (Number.isNaN(+s)) return { error: 'bad_start' };
  if (!cur || b.startsAt !== undefined) { if (+s < Date.now() - 5 * 60_000) return { error: 'start_in_past' }; if (+s > Date.now() + MAX_AHEAD_MS) return { error: 'start_too_far' }; }
  let e = null; const rawEnd = b.endsAt !== undefined ? b.endsAt : cur?.ends_at;
  if (rawEnd) { e = new Date(rawEnd); if (Number.isNaN(+e) || +e < +s || +e - +s > MAX_LEN_MS) return { error: 'bad_end' }; }
  return { s, e };
};

const fields = (b, cur) => {
  const title = line(b.title ?? cur?.title, 100); if (title.length < 3) return { error: 'bad_title' };
  const description = clean(b.description ?? cur?.description ?? '', 2000);
  const place = line(b.place !== undefined ? b.place : cur?.place, 200);
  const url = b.onlineUrl !== undefined ? httpsUrl(b.onlineUrl) : (cur?.online_url ?? '');
  if (url === null) return { error: 'bad_link' };
  if (!place && !url) return { error: 'place_required' };
  let capacity = b.capacity !== undefined ? b.capacity : cur?.capacity;
  if (capacity === '' || capacity === null || capacity === undefined) capacity = null;
  else { capacity = Number(capacity); if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) return { error: 'bad_capacity' }; }
  return { title, description, place: place || null, url: url || null, capacity };
};

const memberOf = async (me, cid) => (await query('SELECT role, status FROM bloom_community_members WHERE community_id = $1 AND profile_id = $2', [cid, me])).rows[0];

export const create = async (me, b) => {
  const f = fields(b); if (f.error) return f;
  const w = parseWhen(b); if (w.error) return w;
  let cid = null;
  if (b.communityId) {
    cid = String(b.communityId);
    const c = (await query('SELECT id FROM bloom_communities WHERE id = $1 AND NOT blocked AND deleted_at IS NULL', [cid])).rows[0];
    if (!c) return { error: 'not_found' };
    const m = await memberOf(me, cid);
    if (!m || m.status !== 'active' || !['owner', 'mod'].includes(m.role)) return { error: 'forbidden' };
  }
  if ((await query(`SELECT count(*)::int AS c FROM bloom_events WHERE organizer_id = $1 AND created_at > now() - interval '24 hours'`, [me])).rows[0].c >= MAX_PER_DAY) return { error: 'daily_limit' };
  if ((await query(`SELECT count(*)::int AS c FROM bloom_events WHERE organizer_id = $1 AND removed_at IS NULL AND cancelled_at IS NULL AND starts_at > now()`, [me])).rows[0].c >= MAX_UPCOMING) return { error: 'too_many_events' };
  const v = await checkContent('bloom_event', me, [f.title, f.description, f.place ?? '']);
  if (v.action === 'block') return blockedReply(v);
  const hold = v.action === 'moderate'; const [title, description, place] = v.maskFields ? v.maskFields : [f.title, f.description, f.place ?? ''];
  const id = `bev-${crypto.randomUUID()}`;
  await query(`INSERT INTO bloom_events (id, organizer_id, community_id, title, description, starts_at, ends_at, place, online_url, capacity, held_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, me, cid, title, description, w.s, w.e, place || null, f.url, f.capacity, hold ? new Date() : null]);
  if (hold) { await createHold(query, { kind: 'bloom_event', targetId: id, authorId: me, categories: v.categories, text: [title, description].join('\n') }); return { ok: true, id, held: true }; }
  return { ok: true, id };
};

export const get = async (me, id) => {
  const e = (await query(`${SELECT('$1')} WHERE e.id = $2 AND ${visibleSql('$1')}`, [me, id])).rows[0];
  return e ? { event: view(e, me) } : { error: 'not_found' };
};

export const list = async (me, { scope, communityId, limit } = {}) => {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 40, 1), 100);
  const where = [visibleSql('$1')];
  const args = [me]; let order = 'e.starts_at ASC';
  if (scope === 'mine') where.push('e.organizer_id = $1');
  else if (scope === 'going') where.push(`EXISTS (SELECT 1 FROM bloom_event_rsvp r WHERE r.event_id = e.id AND r.profile_id = $1)`);
  if (scope === 'past') { where.push(`COALESCE(e.ends_at, e.starts_at) < now()`); order = 'e.starts_at DESC'; }
  else if (scope !== 'mine') where.push(`COALESCE(e.ends_at, e.starts_at) >= now()`, 'e.cancelled_at IS NULL');
  if (communityId) { args.push(String(communityId)); where.push(`e.community_id = $${args.length}`); }
  args.push(lim);
  const { rows } = await query(`${SELECT('$1')} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${args.length}`, args);
  return { events: rows.map((e) => view(e, me)) };
};

const own = async (me, id) => (await query('SELECT * FROM bloom_events WHERE id = $1 AND organizer_id = $2 AND removed_at IS NULL', [id, me])).rows[0];

export const update = async (me, id, b) => {
  const cur = await own(me, id); if (!cur) return { error: 'not_found' };
  if (cur.cancelled_at) return { error: 'bad_state' };
  const f = fields(b, cur); if (f.error) return f;
  const w = parseWhen(b, cur); if (w.error) return w;
  const going = (await query(`SELECT count(*)::int AS c FROM bloom_event_rsvp WHERE event_id = $1 AND status = 'going'`, [id])).rows[0].c;
  if (f.capacity != null && f.capacity < going) return { error: 'capacity_below_going' };
  const v = await checkContent('bloom_event', me, [f.title, f.description, f.place ?? '']);
  if (v.action === 'block') return blockedReply(v);
  if (v.action === 'moderate') return blockedReply({ ...v, action: 'block' });  // правку удержать нельзя — спорное в ней отклоняется
  const [title, description, place] = v.maskFields ? v.maskFields : [f.title, f.description, f.place ?? ''];
  const moved = +new Date(cur.starts_at) !== +w.s || (cur.place ?? '') !== (place ?? '') || (cur.online_url ?? '') !== (f.url ?? '');
  await query(`UPDATE bloom_events SET title=$2, description=$3, starts_at=$4, ends_at=$5, place=$6, online_url=$7, capacity=$8, updated_at=now(), reminded_at = CASE WHEN $9 THEN NULL ELSE reminded_at END WHERE id=$1`,
    [id, title, description, w.s, w.e, place || null, f.url, f.capacity, moved]);
  if (moved) for (const r of (await query(`SELECT profile_id FROM bloom_event_rsvp WHERE event_id = $1`, [id])).rows)
    await note(r.profile_id, 'bloom_event', 'Мероприятие изменилось', `Время или место события «${title}» изменились — проверьте детали.`, id);
  return { ok: true };
};

export const cancel = async (me, id, reason) => {
  const cur = await own(me, id); if (!cur) return { error: 'not_found' };
  const why = line(reason, 300);
  const r = await query(`UPDATE bloom_events SET cancelled_at = now(), cancel_reason = $2 WHERE id = $1 AND cancelled_at IS NULL RETURNING 1`, [id, why || null]);
  if (!r.rows[0]) return { error: 'bad_state' };
  for (const x of (await query(`SELECT profile_id FROM bloom_event_rsvp WHERE event_id = $1 AND profile_id <> $2`, [id, me])).rows)
    await note(x.profile_id, 'bloom_event', 'Мероприятие отменено', why ? `Организатор отменил «${cur.title}». Причина: ${why}` : `Организатор отменил «${cur.title}».`, id);
  return { ok: true };
};

export const rsvp = async (me, id, status) => {
  const st = String(status ?? '');
  if (!['going', 'interested', 'none'].includes(st)) return { error: 'bad_status' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const e = (await client.query(`SELECT * FROM bloom_events WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!e || e.removed_at || (e.held_at && e.organizer_id !== me)) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    const vis = (await client.query(`SELECT 1 FROM bloom_events e WHERE e.id = $2 AND ${visibleSql('$1')}`, [me, id])).rows[0];
    if (!vis) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (e.community_id) { const m = await memberOf(me, e.community_id); if (m?.status === 'banned') { await client.query('ROLLBACK'); return { error: 'banned' }; } }
    if (st === 'none') { await client.query('DELETE FROM bloom_event_rsvp WHERE event_id = $1 AND profile_id = $2', [id, me]); await client.query('COMMIT'); return { ok: true }; }
    if (e.cancelled_at) { await client.query('ROLLBACK'); return { error: 'cancelled' }; }
    if (new Date(e.ends_at ?? e.starts_at) < new Date()) { await client.query('ROLLBACK'); return { error: 'event_over' }; }
    if (st === 'going') {
      const had = (await client.query(`SELECT status FROM bloom_event_rsvp WHERE event_id = $1 AND profile_id = $2`, [id, me])).rows[0];
      if (had?.status !== 'going' && e.capacity != null) {
        const n = (await client.query(`SELECT count(*)::int AS c FROM bloom_event_rsvp WHERE event_id = $1 AND status = 'going'`, [id])).rows[0].c;
        if (n >= e.capacity) { await client.query('ROLLBACK'); return { error: 'event_full' }; }
      }
    }
    await client.query(`INSERT INTO bloom_event_rsvp (event_id, profile_id, status) VALUES ($1,$2,$3) ON CONFLICT (event_id, profile_id) DO UPDATE SET status = EXCLUDED.status`, [id, me, st]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  return { ok: true };
};

/** Имена видит только организатор. */
export const attendees = async (me, id) => {
  if (!(await own(me, id))) return { error: 'not_found' };
  const { rows } = await query(`SELECT r.profile_id AS id, r.status, p.name, p.username FROM bloom_event_rsvp r JOIN profiles p ON p.id = r.profile_id WHERE r.event_id = $1 ORDER BY r.status, r.created_at LIMIT 500`, [id]);
  return { attendees: rows };
};

/** Администрация (право `bloom_communities`) снимает мероприятие с причиной. */
export const adminRemove = async (adminId, id, reason, meta = {}) => {
  if (!(await can(adminId, 'bloom_communities'))) return { error: 'not_allowed' };
  const why = line(reason, 300); if (why.length < 5) return { error: 'reason_required' };
  const e = (await query(`UPDATE bloom_events SET removed_at = now(), removed_by = $2, remove_reason = $3 WHERE id = $1 AND removed_at IS NULL RETURNING organizer_id, title`, [id, adminId, why])).rows[0];
  if (!e) return { error: 'not_found' };
  await logAdmin({ actorId: adminId, targetId: e.organizer_id, targetType: 'bloom_event', type: 'bloom_event_remove', detail: why.slice(0, 200), meta });
  await note(e.organizer_id, 'bloom_event', 'Мероприятие снято', `Модерация сняла «${e.title}». Причина: ${why}`, id);
  return { ok: true };
};

let lastSweep = 0;
/** Напоминание «через час» идущим и интересующимся, один раз; старые отменённые не трогаем. */
export const sweepBloomEvents = async () => {
  if (Date.now() - lastSweep < 55_000) return; lastSweep = Date.now();
  const { rows } = await query(`UPDATE bloom_events SET reminded_at = now() WHERE reminded_at IS NULL AND cancelled_at IS NULL AND removed_at IS NULL AND held_at IS NULL
    AND starts_at BETWEEN now() AND now() + interval '60 minutes' RETURNING id, title`);
  for (const e of rows) for (const r of (await query(`SELECT profile_id FROM bloom_event_rsvp WHERE event_id = $1 AND status = 'going'`, [e.id])).rows)
    await note(r.profile_id, 'bloom_event', 'Скоро мероприятие', `«${e.title}» начнётся меньше чем через час.`, e.id);
};
