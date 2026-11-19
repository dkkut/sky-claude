/**
 * Sky Календарь — одно место для всех дат человека в экосистеме.
 *
 *  — собственные события (повтор, напоминание, приглашение друзей), текст зашифрован;
 *  — даты из других сервисов читаются НА ЛЕТУ из их же таблиц и не копируются: билеты на мероприятия, записи в организации,
 *    запланированные поездки и доставки, активные парковки, цели и сроки Sky Life, вскрытие капсул времени.
 *    Каждый источник читается отдельно: сбой одного не ломает остальные (в ответе — список недоступных).
 *  Видно только своё: свои события, приглашения себе и то, что человек сам оформил в других сервисах.
 */
import { query, pool } from './db.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { generateId } from './security.mjs';
import { friendStatus } from './friends.mjs';
import { notifyGift } from './giftnotify.mjs';
import { logEvent as skyLog } from './skylog.mjs';

const DAY = 86_400_000;
export const LIMITS = { events: 500, invitees: 20, title: 120, notes: 2000, rangeDays: 62, occurrences: 400 };
const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const COLORS = ['blue', 'violet', 'pink', 'red', 'orange', 'green', 'teal', 'gray'];
const clean = (s, n) => String(s ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const dec = (v) => { try { return v ? decryptSecret(v) : ''; } catch { return ''; } };
const decJson = (v) => { try { return JSON.parse(decryptSecret(v) ?? 'null') ?? {}; } catch { return {}; } };
const note = async (user, kind, title, body, ref) => { try { await notifyGift(user, kind, title, body, ref); } catch { /* уведомление не ломает дело */ } };

/* ───────────── повторы ───────────── */

const addMonths = (d, k) => {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + k;
  const ny = y + Math.floor(m / 12), nm = ((m % 12) + 12) % 12;
  const dim = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(d.getUTCDate(), dim), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
};

/** Начала вхождений события, пересекающих [from, to]. Повторы считаются по UTC (без переходов на летнее время). */
export const occurrences = (ev, from, to) => {
  const s = new Date(ev.starts_at), dur = ev.ends_at ? new Date(ev.ends_at) - s : 0;
  const hit = (d) => d <= to && new Date(+d + dur) >= from;
  if (ev.repeat === 'none') return hit(s) ? [s] : [];
  const out = [];
  if (ev.repeat === 'daily' || ev.repeat === 'weekly') {
    const step = ev.repeat === 'daily' ? DAY : 7 * DAY;
    for (let k = Math.max(0, Math.floor((from - s - dur) / step)); out.length < LIMITS.occurrences; k++) {
      const d = new Date(+s + k * step); if (d > to) break; if (hit(d)) out.push(d);
    }
    return out;
  }
  const per = ev.repeat === 'monthly' ? 1 : 12;
  const approx = Math.max(0, Math.floor(((from.getUTCFullYear() - s.getUTCFullYear()) * 12 + from.getUTCMonth() - s.getUTCMonth()) / per) - 1);
  for (let k = approx; out.length < LIMITS.occurrences; k++) {
    const d = addMonths(s, k * per); if (d > to) break; if (hit(d)) out.push(d);
  }
  return out;
};

/* ───────────── чтение диапазона ───────────── */

const parseRange = (from, to) => {
  const f = new Date(from), t = new Date(to);
  if (Number.isNaN(+f) || Number.isNaN(+t) || t <= f) return null;
  if (t - f > LIMITS.rangeDays * DAY) return null;
  return [f, t];
};

const SOURCES = {
  async events(me, f, t) {
    const { rows } = await query(
      `SELECT e.*, p.name AS owner_name, i.status AS invite_status,
              (SELECT count(*)::int FROM cal_invites WHERE event_id = e.id AND status = 'accepted') AS going
         FROM cal_events e JOIN profiles p ON p.id = e.owner_id
         LEFT JOIN cal_invites i ON i.event_id = e.id AND i.profile_id = $1
        WHERE (e.owner_id = $1 OR i.status IN ('pending','accepted'))
          AND e.starts_at <= $3 AND (e.repeat <> 'none' OR COALESCE(e.ends_at, e.starts_at) >= $2)
        ORDER BY e.starts_at LIMIT 600`, [me, f, t]);
    const out = [];
    for (const e of rows) {
      const mine = e.owner_id === me;
      for (const d of occurrences(e, f, t)) {
        out.push({
          id: `event:${e.id}:${+d}`, source: 'event', ref: e.id, title: dec(e.title_enc), notes: dec(e.notes_enc),
          start: d.toISOString(), end: e.ends_at ? new Date(+d + (new Date(e.ends_at) - new Date(e.starts_at))).toISOString() : null,
          allDay: e.all_day, color: e.color, repeat: e.repeat, remindMin: e.remind_min, mine,
          ...(mine ? {} : { ownerName: e.owner_name, invite: e.invite_status }), going: e.going,
        });
      }
    }
    return out;
  },
  async capsules(me, f, t) {
    const { rows } = await query(`SELECT id, open_at, author_id = recipient_id AS toself FROM time_capsules
      WHERE recipient_id = $1 AND status = 'sealed' AND open_at BETWEEN $2 AND $3 LIMIT 100`, [me, f, t]);
    return rows.map((r) => ({ id: `capsule:${r.id}`, source: 'capsule', ref: r.id, start: new Date(r.open_at).toISOString(), end: null, allDay: false, color: 'violet', toSelf: r.toself }));
  },
  async life(me, f, t) {
    const { rows } = await query(`SELECT id, kind, due_at, event_at, data_enc FROM life_items
      WHERE owner_id = $1 AND done_at IS NULL AND (due_at BETWEEN $2 AND $3 OR event_at BETWEEN $2 AND $3) LIMIT 200`, [me, f, t]);
    const out = [];
    for (const r of rows) {
      const title = clean(decJson(r.data_enc).title, LIMITS.title) || null;
      for (const [k, v] of [['event', r.event_at], ['due', r.due_at]]) {
        if (v && new Date(v) >= f && new Date(v) <= t) out.push({ id: `life:${r.id}:${k}`, source: 'life', ref: r.id, title, start: new Date(v).toISOString(), end: null, allDay: false, color: 'teal', what: k });
      }
    }
    return out;
  },
  async tickets(me, f, t) {
    const { rows } = await query(`SELECT o.id, o.quantity, e.title, e.starts_at, e.ends_at, e.city, e.venue FROM ticket_orders o JOIN ticket_events e ON e.id = o.event_id
      WHERE o.user_id = $1 AND o.status = 'paid' AND e.starts_at <= $3 AND COALESCE(e.ends_at, e.starts_at) >= $2 LIMIT 100`, [me, f, t]);
    return rows.map((r) => ({ id: `ticket:${r.id}`, source: 'ticket', ref: r.id, title: r.title, place: [r.venue, r.city].filter(Boolean).join(', ') || null, qty: r.quantity,
      start: new Date(r.starts_at).toISOString(), end: r.ends_at ? new Date(r.ends_at).toISOString() : null, allDay: false, color: 'pink' }));
  },
  async bookings(me, f, t) {
    const { rows } = await query(`SELECT id, item_title, starts_at, ends_at, status FROM gop_bookings
      WHERE buyer_id = $1 AND status IN ('requested','confirmed','awaiting_payment') AND starts_at BETWEEN $2 AND $3 LIMIT 100`, [me, f, t]);
    return rows.map((r) => ({ id: `booking:${r.id}`, source: 'booking', ref: r.id, title: r.item_title, state: r.status,
      start: new Date(r.starts_at).toISOString(), end: r.ends_at ? new Date(r.ends_at).toISOString() : null, allDay: false, color: 'orange' }));
  },
  async parking(me, f, t) {
    const { rows } = await query(`SELECT id, ends_at FROM parking_sessions WHERE profile_id = $1 AND status = 'active' AND ends_at BETWEEN $2 AND $3 LIMIT 20`, [me, f, t]);
    return rows.map((r) => ({ id: `parking:${r.id}`, source: 'parking', ref: r.id, start: new Date(r.ends_at).toISOString(), end: null, allDay: false, color: 'gray' }));
  },
  async trips(me, f, t) {
    const { rows } = await query(`SELECT id, kind, scheduled_at FROM go_orders WHERE customer_id = $1 AND status = 'scheduled' AND scheduled_at BETWEEN $2 AND $3 LIMIT 50`, [me, f, t]);
    return rows.map((r) => ({ id: `trip:${r.id}`, source: 'trip', ref: r.id, what: r.kind, start: new Date(r.scheduled_at).toISOString(), end: null, allDay: false, color: 'green' }));
  },
};

export const range = async (me, from, to) => {
  const r = parseRange(from, to); if (!r) return { error: 'bad_range' };
  const names = Object.keys(SOURCES);
  const res = await Promise.all(names.map(async (n) => { try { return [n, await SOURCES[n](me, r[0], r[1])]; } catch (e) { return [n, null]; } }));
  const items = res.flatMap(([, v]) => v ?? []).sort((a, b) => a.start.localeCompare(b.start));
  return { items, unavailable: res.filter(([, v]) => v === null).map(([n]) => n) };
};

/* ───────────── собственные события ───────────── */

const readEvent = async (me, id) => {
  const e = (await query(`SELECT e.*, i.status AS invite_status FROM cal_events e LEFT JOIN cal_invites i ON i.event_id = e.id AND i.profile_id = $2 WHERE e.id = $1`, [id, me])).rows[0];
  if (!e || (e.owner_id !== me && !e.invite_status)) return null;
  return e;
};

const norm = (b, partial = false) => {
  const out = {};
  if (!partial || b.title !== undefined) { out.title = clean(b.title, LIMITS.title); if (out.title.length < 1) return { error: 'bad_title' }; }
  if (!partial || b.notes !== undefined) out.notes = clean(b.notes, LIMITS.notes);
  if (!partial || b.start !== undefined) { const s = new Date(b.start); if (Number.isNaN(+s) || s.getUTCFullYear() < 2000 || s.getUTCFullYear() > 2100) return { error: 'bad_date' }; out.start = s; }
  if (b.end !== undefined) { if (b.end === null || b.end === '') out.end = null; else { const e = new Date(b.end); if (Number.isNaN(+e)) return { error: 'bad_date' }; out.end = e; } }
  if (out.start && out.end && out.end < out.start) return { error: 'bad_date' };
  if (out.end && out.start && out.end - out.start > 31 * DAY) return { error: 'too_long' };
  if (!partial || b.allDay !== undefined) out.allDay = Boolean(b.allDay);
  if (!partial || b.repeat !== undefined) { out.repeat = String(b.repeat ?? 'none'); if (!REPEATS.includes(out.repeat)) return { error: 'bad_repeat' }; }
  if (b.remindMin !== undefined) {
    if (b.remindMin === null || b.remindMin === '') out.remindMin = null;
    else { const n = Math.round(Number(b.remindMin)); if (!Number.isFinite(n) || n < 0 || n > 10080) return { error: 'bad_remind' }; out.remindMin = n; }
  }
  if (!partial || b.color !== undefined) { out.color = COLORS.includes(b.color) ? b.color : 'blue'; }
  return out;
};

export const createEvent = async (me, b) => {
  const v = norm(b); if (v.error) return v;
  const n = (await query(`SELECT count(*)::int AS n FROM cal_events WHERE owner_id = $1`, [me])).rows[0].n;
  if (n >= LIMITS.events) return { error: 'limit_reached', limit: LIMITS.events };
  const id = `cal-${generateId()}`;
  await query(`INSERT INTO cal_events (id, owner_id, title_enc, notes_enc, starts_at, ends_at, all_day, repeat, remind_min, color) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, me, encryptSecret(v.title), v.notes ? encryptSecret(v.notes) : null, v.start, v.end ?? null, v.allDay, v.repeat, v.remindMin ?? null, v.color]);
  return { ok: true, id };
};

export const updateEvent = async (me, id, b) => {
  const e = await readEvent(me, id); if (!e || e.owner_id !== me) return { error: 'not_found' };
  const v = norm(b, true); if (v.error) return v;
  const set = ['updated_at = now()']; const args = [id]; const add = (col, val) => { args.push(val); set.push(`${col} = $${args.length}`); };
  if (v.title !== undefined) add('title_enc', encryptSecret(v.title));
  if (v.notes !== undefined) add('notes_enc', v.notes ? encryptSecret(v.notes) : null);
  if (v.start !== undefined) add('starts_at', v.start);
  if (v.end !== undefined) add('ends_at', v.end);
  if (v.allDay !== undefined) add('all_day', v.allDay);
  if (v.repeat !== undefined) add('repeat', v.repeat);
  if (v.remindMin !== undefined) add('remind_min', v.remindMin);
  if (v.color !== undefined) add('color', v.color);
  const end = v.end !== undefined ? v.end : e.ends_at, start = v.start ?? e.starts_at;
  if (end && new Date(end) < new Date(start)) return { error: 'bad_date' };
  await query(`UPDATE cal_events SET ${set.join(', ')} WHERE id = $1`, args);
  if (v.start !== undefined || v.repeat !== undefined) await query(`DELETE FROM cal_reminded WHERE event_id = $1`, [id]);
  const guests = (await query(`SELECT profile_id FROM cal_invites WHERE event_id = $1 AND status <> 'declined'`, [id])).rows;
  for (const g of guests) await note(g.profile_id, 'cal_changed', 'Событие в календаре изменено', 'Организатор изменил событие, на которое вы приглашены.', id);
  return { ok: true };
};

export const deleteEvent = async (me, id) => {
  const e = await readEvent(me, id); if (!e) return { error: 'not_found' };
  if (e.owner_id !== me) { await query(`UPDATE cal_invites SET status = 'declined' WHERE event_id = $1 AND profile_id = $2`, [id, me]); return { ok: true, left: true }; }
  const guests = (await query(`SELECT profile_id FROM cal_invites WHERE event_id = $1 AND status <> 'declined'`, [id])).rows;
  await query(`DELETE FROM cal_events WHERE id = $1`, [id]);
  for (const g of guests) await note(g.profile_id, 'cal_cancelled', 'Событие отменено', 'Организатор отменил событие, на которое вы были приглашены.', id);
  return { ok: true };
};

export const guests = async (me, id) => {
  const e = await readEvent(me, id); if (!e) return { error: 'not_found' };
  const { rows } = await query(`SELECT i.profile_id AS id, i.status, p.name, p.username FROM cal_invites i JOIN profiles p ON p.id = i.profile_id WHERE i.event_id = $1 ORDER BY p.name`, [id]);
  return { guests: rows };
};

export const invite = async (me, id, ids) => {
  const e = await readEvent(me, id); if (!e || e.owner_id !== me) return { error: 'not_found' };
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((x) => x && x !== me).slice(0, LIMITS.invitees);
  if (!list.length) return { error: 'bad_value' };
  const have = (await query(`SELECT count(*)::int AS n FROM cal_invites WHERE event_id = $1`, [id])).rows[0].n;
  if (have + list.length > LIMITS.invitees) return { error: 'too_many', limit: LIMITS.invitees };
  let sent = 0;
  for (const pid of list) {
    if ((await friendStatus(me, pid)) !== 'friends') return { error: 'not_friend' };
    const r = await query(`INSERT INTO cal_invites (event_id, profile_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1`, [id, pid]);
    if (r.rows[0]) { sent++; await note(pid, 'cal_invite', 'Приглашение в календаре', 'Друг приглашает вас на событие. Откройте Sky Календарь, чтобы принять или отклонить.', id); }
  }
  skyLog({ category: 'user', type: 'calendar_invite', detail: { count: sent } });
  return { ok: true, sent };
};

export const respond = async (me, id, accept) => {
  const r = await query(`UPDATE cal_invites SET status = $3 WHERE event_id = $1 AND profile_id = $2 RETURNING 1`, [id, me, accept ? 'accepted' : 'declined']);
  if (!r.rows[0]) return { error: 'not_found' };
  const ev = (await query(`SELECT owner_id FROM cal_events WHERE id = $1`, [id])).rows[0];
  if (ev) await note(ev.owner_id, 'cal_reply', accept ? 'Приглашение принято' : 'Приглашение отклонено', accept ? 'Друг придёт на ваше событие.' : 'Друг не сможет прийти на ваше событие.', id);
  return { ok: true };
};

export const pendingInvites = async (me) => {
  const { rows } = await query(`SELECT e.id, e.title_enc, e.starts_at, p.name AS owner_name FROM cal_invites i JOIN cal_events e ON e.id = i.event_id JOIN profiles p ON p.id = e.owner_id
    WHERE i.profile_id = $1 AND i.status = 'pending' ORDER BY e.starts_at LIMIT 50`, [me]);
  return { invites: rows.map((r) => ({ id: r.id, title: dec(r.title_enc), start: new Date(r.starts_at).toISOString(), ownerName: r.owner_name })) };
};

/* ───────────── напоминания ───────────── */

/** Раз в минуту: напоминаем о событиях, начинающихся в пределах `remind_min`; одно напоминание на (событие, начало, человек). */
export const sweepCalendar = async () => {
  const now = new Date();
  const { rows } = await query(`SELECT * FROM cal_events WHERE remind_min IS NOT NULL AND (repeat <> 'none' OR (starts_at BETWEEN $1 AND $2)) LIMIT 3000`, [now, new Date(+now + 7 * DAY + 60_000)]);
  for (const e of rows) {
    const upto = new Date(+now + e.remind_min * 60_000);
    for (const d of occurrences(e, now, upto)) {
      if (d < now) continue;
      const people = [e.owner_id, ...(await query(`SELECT profile_id FROM cal_invites WHERE event_id = $1 AND status = 'accepted'`, [e.id])).rows.map((r) => r.profile_id)];
      for (const pid of people) {
        const ins = await query(`INSERT INTO cal_reminded (event_id, occ_at, profile_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1`, [e.id, d, pid]);
        if (ins.rows[0]) await note(pid, 'cal_remind', 'Скоро событие', dec(e.title_enc), e.id);
      }
    }
  }
  await query(`DELETE FROM cal_reminded WHERE occ_at < now() - interval '2 days'`);
};
