/**
 * Sky Time — три «временных» функции экосистемы.
 *
 *  1. Капсулы времени: запечатанное сообщение себе или другу. Текст лежит зашифрованным, а сервер физически не отдаёт его
 *     никому (ни автору, ни получателю, ни администрации) до даты вскрытия. Вскрытие — условный UPDATE (`sealed → opened`)
 *     только когда `open_at <= now()`, поэтому гонка или подмена времени клиентом ничего не открывают раньше срока.
 *  2. Sky Balance: цифровое благополучие. Время активного использования по разделам сообщает клиент самого человека
 *     (секунды, пачками), лимиты и тихие часы человек задаёт себе сам. Это инструмент самоконтроля, а не защита:
 *     сервер ничего не блокирует, только ведёт учёт и считает отчёт.
 *  3. «В этот день»: только то, что уже есть у человека в Sky (регистрация, свои посты Bloom, друзья, прослушанное, капсулы).
 *     Ничего не выдумывается: нет данных — пустой список.
 */
import { query, pool } from './db.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { generateId } from './security.mjs';
import { friendStatus } from './friends.mjs';
import { notifyGift } from './giftnotify.mjs';
import { logEvent as skyLog } from './skylog.mjs';

const HOUR = 3600_000, DAY = 86_400_000;
export const LIMITS = { sealed: 30, perDay: 10, textMax: 5000, titleMax: 80, minLeadMs: HOUR, maxLeadMs: 10 * 365 * DAY };
const clean = (s, n) => String(s ?? '').replace(/\u0000/g, '').trim().slice(0, n);
const dec = (v) => { try { return v ? decryptSecret(v) : ''; } catch { return ''; } };
const note = async (user, kind, title, body, ref) => { try { await notifyGift(user, kind, title, body, ref); } catch { /* уведомление не ломает дело */ } };

/* ───────────── Капсулы времени ───────────── */

const rowOut = (r, me) => {
  const opened = r.status === 'opened';
  const mineRecipient = r.recipient_id === me, mineAuthor = r.author_id === me;
  return {
    id: r.id, status: r.status, openAt: r.open_at, openedAt: r.opened_at, createdAt: r.created_at, locked: r.locked,
    toSelf: r.author_id === r.recipient_id, fromMe: mineAuthor, forMe: mineRecipient,
    peer: mineAuthor && !r.toself ? { id: r.recipient_id, name: r.recipient_name, username: r.recipient_username } : { id: r.author_id, name: r.author_name, username: r.author_username },
    // Текст отдаётся ТОЛЬКО вскрытой капсулы и только её участникам; запечатанную не читает никто.
    ...(opened ? { title: dec(r.title_enc), text: dec(r.text_enc) } : {}),
  };
};
const SELECT = `SELECT c.*, (c.author_id = c.recipient_id) AS toself, pa.name AS author_name, pa.username AS author_username,
  pr.name AS recipient_name, pr.username AS recipient_username
  FROM time_capsules c JOIN profiles pa ON pa.id = c.author_id JOIN profiles pr ON pr.id = c.recipient_id`;

/** Вскрыть созревшие капсулы получателя (лениво при чтении и из уборки). Возвращает вскрытые id. */
export const openDue = async (recipientId = null) => {
  const { rows } = await query(
    `UPDATE time_capsules SET status = 'opened', opened_at = now()
      WHERE status = 'sealed' AND open_at <= now() ${recipientId ? 'AND recipient_id = $1' : ''}
      RETURNING id, author_id, recipient_id`, recipientId ? [recipientId] : []);
  for (const r of rows) {
    await note(r.recipient_id, 'capsule_open', 'Капсула времени вскрыта', r.author_id === r.recipient_id ? 'Письмо себе из прошлого ждёт вас в Sky Time.' : 'Для вас вскрылась капсула времени от друга.', r.id);
    if (r.author_id !== r.recipient_id) await note(r.author_id, 'capsule_open', 'Ваша капсула вскрыта', 'Капсула, которую вы запечатали, открылась у получателя.', r.id);
  }
  return rows.map((r) => r.id);
};

export const listCapsules = async (me) => {
  await openDue(me);
  const { rows } = await query(`${SELECT} WHERE (c.author_id = $1 OR c.recipient_id = $1) AND c.status <> 'cancelled' ORDER BY c.open_at ASC LIMIT 200`, [me]);
  const out = rows.map((r) => rowOut(r, me));
  return { sealed: out.filter((c) => c.status === 'sealed'), opened: out.filter((c) => c.status === 'opened').sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt))), limits: { sealed: LIMITS.sealed, textMax: LIMITS.textMax } };
};

export const createCapsule = async (me, b) => {
  const text = clean(b.text, LIMITS.textMax); if (text.length < 2) return { error: 'bad_text' };
  const title = clean(b.title, LIMITS.titleMax);
  const openAt = new Date(b.openAt); if (Number.isNaN(openAt.getTime())) return { error: 'bad_date' };
  const lead = openAt.getTime() - Date.now(); if (lead < LIMITS.minLeadMs) return { error: 'too_soon' }; if (lead > LIMITS.maxLeadMs) return { error: 'too_far' };
  const to = b.to && b.to !== 'self' ? String(b.to).slice(0, 80) : me;
  if (to !== me) { if ((await friendStatus(me, to)) !== 'friends') return { error: 'not_friend' }; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`capsule:${me}`]);   // лимиты не обходятся гонкой
    const c = (await client.query(`SELECT count(*) FILTER (WHERE status = 'sealed')::int AS sealed, count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS day FROM time_capsules WHERE author_id = $1`, [me])).rows[0];
    if (c.sealed >= LIMITS.sealed) { await client.query('ROLLBACK'); return { error: 'limit_reached', limit: LIMITS.sealed }; }
    if (c.day >= LIMITS.perDay) { await client.query('ROLLBACK'); return { error: 'daily_limit', limit: LIMITS.perDay }; }
    const id = `cap-${generateId()}`;
    await client.query(`INSERT INTO time_capsules (id, author_id, recipient_id, title_enc, text_enc, open_at, locked) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, me, to, title ? encryptSecret(title) : null, encryptSecret(text), openAt.toISOString(), Boolean(b.locked)]);
    await client.query('COMMIT');
    if (to !== me) await note(to, 'capsule_new', 'Вам запечатали капсулу времени', `Друг оставил для вас капсулу. Она откроется ${openAt.toLocaleDateString('ru-RU')}.`, id);
    skyLog({ category: 'user', type: 'capsule_sealed', detail: { toSelf: to === me, days: Math.round(lead / DAY) } });
    return { ok: true, id };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};

/** Отменить может только автор и только пока капсула запечатана и не «намертво». */
export const cancelCapsule = async (me, id) => {
  const r = await query(`UPDATE time_capsules SET status = 'cancelled' WHERE id = $1 AND author_id = $2 AND status = 'sealed' AND locked = FALSE AND open_at > now() RETURNING id`, [String(id).slice(0, 80), me]);
  if (r.rows[0]) return { ok: true };
  const x = (await query(`SELECT status, locked, author_id FROM time_capsules WHERE id = $1`, [String(id).slice(0, 80)])).rows[0];
  if (!x || x.author_id !== me) return { error: 'not_found' };
  return { error: x.locked ? 'locked' : 'not_sealed' };
};

export const sweepCapsules = async () => { try { return (await openDue()).length; } catch (e) { console.error('[time] капсулы:', e.message); return 0; } };

/* ───────────── Sky Balance ───────────── */

const MOD_RE = /^[a-z0-9:_-]{1,40}$/;
const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);

export const getBalance = async (me) => {
  const r = (await query(`SELECT * FROM time_balance WHERE profile_id = $1`, [me])).rows[0];
  return { tracking: r?.tracking ?? false, dailyTotal: r?.daily_total ?? null, limits: r?.limits ?? {}, quietFrom: r?.quiet_from ?? null, quietTo: r?.quiet_to ?? null, tzOffset: r?.tz_offset ?? 0 };
};

export const saveBalance = async (me, b) => {
  const num = (v, lo, hi) => { if (v === null || v === undefined || v === '') return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined; };
  const dailyTotal = num(b.dailyTotal, 5, 1440), qf = num(b.quietFrom, 0, 1439), qt = num(b.quietTo, 0, 1439), tz = num(b.tzOffset ?? 0, -840, 840) ?? 0;
  if (dailyTotal === undefined || qf === undefined || qt === undefined) return { error: 'bad_value' };
  if ((qf === null) !== (qt === null)) return { error: 'quiet_both' };
  const limits = {};
  for (const [k, v] of Object.entries(b.limits && typeof b.limits === 'object' ? b.limits : {})) {
    if (!MOD_RE.test(k)) continue; const n = num(v, 5, 1440); if (n === undefined) return { error: 'bad_value' }; if (n !== null) limits[k] = n;
    if (Object.keys(limits).length > 30) break;
  }
  await query(`INSERT INTO time_balance (profile_id, tracking, daily_total, limits, quiet_from, quiet_to, tz_offset, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now())
    ON CONFLICT (profile_id) DO UPDATE SET tracking = EXCLUDED.tracking, daily_total = EXCLUDED.daily_total, limits = EXCLUDED.limits, quiet_from = EXCLUDED.quiet_from, quiet_to = EXCLUDED.quiet_to, tz_offset = EXCLUDED.tz_offset, updated_at = now()`,
    [me, Boolean(b.tracking), dailyTotal, JSON.stringify(limits), qf, qt, tz]);
  return { ok: true, ...(await getBalance(me)) };
};

/** Пачка «раздел → секунды». Пока учёт выключен, ничего не пишется. Пределы: ≤120 с на раздел за пачку, ≤16 часов в сутки на раздел. */
export const addUsage = async (me, entries) => {
  const st = (await query(`SELECT tracking, tz_offset FROM time_balance WHERE profile_id = $1`, [me])).rows[0];
  if (!st?.tracking) return { ok: true, skipped: true };
  const day = dayOf(new Date(Date.now() + (st.tz_offset ?? 0) * 60_000));
  let saved = 0;
  for (const e of (Array.isArray(entries) ? entries : []).slice(0, 12)) {
    const mod = String(e?.module ?? ''); const sec = Math.round(Number(e?.sec ?? e?.seconds)); if (!MOD_RE.test(mod) || !Number.isFinite(sec) || sec < 1) continue;
    const have = (await query(`SELECT count(*)::int AS n, bool_or(module = $3) AS has FROM time_usage WHERE profile_id = $1 AND day = $2`, [me, day, mod])).rows[0];
    if (have.n >= 40 && !have.has) continue;   // не больше 40 разных разделов в сутки
    const r = await query(`INSERT INTO time_usage (profile_id, day, module, seconds) VALUES ($1,$2,$3,$4)
      ON CONFLICT (profile_id, day, module) DO UPDATE SET seconds = LEAST(time_usage.seconds + EXCLUDED.seconds, 57600) RETURNING seconds`, [me, day, mod, Math.min(sec, 120)]);
    if (r.rows[0]) saved++;
  }
  return { ok: true, saved };
};

export const clearUsage = async (me) => { await query(`DELETE FROM time_usage WHERE profile_id = $1`, [me]); return { ok: true }; };

export const usageReport = async (me, days = 7) => {
  const n = Math.max(1, Math.min(30, Math.round(Number(days)) || 7));
  const tz = (await query(`SELECT tz_offset FROM time_balance WHERE profile_id = $1`, [me])).rows[0]?.tz_offset ?? 0;
  const today = dayOf(new Date(Date.now() + tz * 60_000));
  const { rows } = await query(`SELECT day::text AS day, module, seconds FROM time_usage WHERE profile_id = $1 AND day > ($2::date - $3::int * 2) ORDER BY day`, [me, today, n]);
  const startCur = new Date(Date.parse(today) - (n - 1) * DAY).toISOString().slice(0, 10);
  const startPrev = new Date(Date.parse(today) - (2 * n - 1) * DAY).toISOString().slice(0, 10);
  const byDay = {}, byMod = {}; let cur = 0, prev = 0;
  for (const r of rows) {
    if (r.day >= startCur) { byDay[r.day] = (byDay[r.day] ?? 0) + r.seconds; byMod[r.module] = (byMod[r.module] ?? 0) + r.seconds; cur += r.seconds; }
    else if (r.day >= startPrev) prev += r.seconds;
  }
  const daysOut = Array.from({ length: n }, (_, i) => { const d = new Date(Date.parse(today) - (n - 1 - i) * DAY).toISOString().slice(0, 10); return { day: d, seconds: byDay[d] ?? 0 }; });
  const todayMods = Object.fromEntries(rows.filter((r) => r.day === today).map((r) => [r.module, r.seconds]));
  const active = daysOut.filter((d) => d.seconds > 0).length;
  return { days: n, total: cur, previous: prev, avgPerActiveDay: active ? Math.round(cur / active) : 0, byDay: daysOut,
    byModule: Object.entries(byMod).map(([module, seconds]) => ({ module, seconds })).sort((a, b) => b.seconds - a.seconds), today: todayMods, todayTotal: Object.values(todayMods).reduce((a, b) => a + b, 0) };
};

/* ───────────── «В этот день» ───────────── */

export const thisDay = async (me, dateStr) => {
  const d = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(`${dateStr}T12:00:00Z`) : new Date();
  const mm = d.getUTCMonth() + 1, dd = d.getUTCDate(), year = d.getUTCFullYear();
  const md = (col) => `EXTRACT(MONTH FROM ${col}) = $2 AND EXTRACT(DAY FROM ${col}) = $3 AND EXTRACT(YEAR FROM ${col}) < $4`;
  const P = [me, mm, dd, year];
  const [reg, posts, friends, music, caps] = await Promise.all([
    query(`SELECT created_at FROM profiles WHERE id = $1 AND ${md('created_at')}`, P),
    query(`SELECT id, body, created_at FROM bloom_posts WHERE author_id = $1 AND deleted_at IS NULL AND ${md('created_at')} ORDER BY created_at DESC LIMIT 10`, P),
    query(`SELECT p.id, p.name, p.username, f.created_at FROM friendships f JOIN profiles p ON p.id = CASE WHEN f.a_id = $1 THEN f.b_id ELSE f.a_id END
            WHERE (f.a_id = $1 OR f.b_id = $1) AND f.status = 'accepted' AND ${md('f.created_at')} ORDER BY f.created_at DESC LIMIT 10`, P),
    query(`SELECT DISTINCT ON (t.id) t.id, t.title, t.artist, h.played_at FROM music_history h JOIN music_tracks t ON t.id = h.track_id
            WHERE h.user_id = $1 AND ${md('h.played_at')} ORDER BY t.id, h.played_at DESC LIMIT 10`, P),
    query(`SELECT id, opened_at, author_id = recipient_id AS toself FROM time_capsules WHERE recipient_id = $1 AND status = 'opened' AND ${md('opened_at')} LIMIT 10`, P),
  ]);
  const items = [];
  const yr = (v) => new Date(v).getUTCFullYear();
  for (const r of reg.rows) items.push({ kind: 'registered', year: yr(r.created_at), title: 'Вы присоединились к Sky' });
  for (const r of posts.rows) items.push({ kind: 'post', year: yr(r.created_at), title: 'Ваш пост в Bloom', text: String(r.body ?? '').slice(0, 280), ref: r.id });
  for (const r of friends.rows) items.push({ kind: 'friend', year: yr(r.created_at), title: 'Вы подружились', peer: { id: r.id, name: r.name, username: r.username } });
  for (const r of music.rows) items.push({ kind: 'music', year: yr(r.played_at), title: 'Вы слушали', text: `${r.title} — ${r.artist}`, ref: r.id });
  for (const r of caps.rows) items.push({ kind: 'capsule', year: yr(r.opened_at), title: r.toself ? 'Вскрылась капсула, написанная себе' : 'Вскрылась капсула от друга', ref: r.id });
  items.sort((a, b) => b.year - a.year);
  return { date: `${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, items };
};
