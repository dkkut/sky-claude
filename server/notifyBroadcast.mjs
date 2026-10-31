/**
 * Рассылки из админ-панели.
 *
 * Показ уведомления в интерфейсе не меняется — это по-прежнему тот же
 * useNotifStore и тот же тост, что и у лайков/комментариев Bloom (см.
 * NotifBridge.tsx): клиент опрашивает /api/notify/events тем же
 * способом, что и /api/bloom/events. Новое здесь — только то, чего не
 * было: кто должен получить рассылку и когда, и сервер, который
 * действительно её отправляет без открытого приложения.
 *
 * Разовая отправка «сейчас» и отложенная — один и тот же путь: «сейчас»
 * это просто scheduled_at = now(). Так дольше одну и ту же логику не
 * дублируем, и рассылка никогда не уходит одним долгим HTTP-запросом —
 * ручка создаёт запись и возвращает ответ, а отправляет её worker
 * (dispatchDueBroadcasts), которого крутит setInterval в server.mjs.
 */
import { query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { isValidRegion } from './regions.mjs';
import { pushToOffline } from './webpush.mjs';

export const MAX_TITLE = 200;
export const MAX_BODY = 1000;
export const MAX_LINK = 300;
export const MAX_REASON = 500;
export const MAX_USERS = 2000;

const STALE_RUN_MS = 10 * 60_000; // запуск, зависший дольше 10 минут, считаем упавшим

const clean = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
  .trim()
  .slice(0, max);

const newBroadcastId = () => `nb-${generateId()}`;
const newRunId = () => `nbr-${generateId()}`;

/** Ссылка — только собственный, известный маршрут приложения (например
 * /bloom или /skyvideo/video/svid-…), никогда произвольный внешний URL:
 * рассылка не должна становиться готовым инструментом фишинга. */
const LINK_RE = /^\/[a-zA-Z0-9/_-]{0,298}$/;
const cleanLink = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const s = clean(v, MAX_LINK);
  return LINK_RE.test(s) ? s : null;
};

const toBroadcast = (r) => ({
  id: r.id,
  createdBy: r.created_by ?? undefined,
  title: r.title,
  body: r.body,
  link: r.link ?? undefined,
  audienceType: r.audience_type,
  audienceUserIds: r.audience_user_ids ?? [],
  audienceRegion: r.audience_region ?? undefined,
  scheduleKind: r.schedule_kind,
  scheduledAt: r.scheduled_at ? r.scheduled_at.toISOString() : undefined,
  timezoneLabel: r.timezone_label ?? undefined,
  status: r.status,
  reason: r.reason ?? undefined,
  cancelledBy: r.cancelled_by ?? undefined,
  cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : undefined,
  lastError: r.last_error ?? undefined,
  lastSentAt: r.last_sent_at ? r.last_sent_at.toISOString() : undefined,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/* ─── Создание ─────────────────────────────────────────────────────── */

/** `opts.trusted` — вызывающий модуль уже проверил право сам (например, «Обновления» в админке: право `site`). */
export const createBroadcast = async (actorId, body, opts = {}) => {
  if (!opts.trusted && !(await can(actorId, 'notifications'))) return { error: 'not_allowed' };

  const title = clean(body?.title, MAX_TITLE);
  const text = clean(body?.body, MAX_BODY);
  if (!title || !text) return { error: 'empty' };
  const link = cleanLink(body?.link);
  if (body?.link && !link) return { error: 'bad_link' };

  const audienceType = String(body?.audienceType ?? '');
  if (!['all', 'users', 'region'].includes(audienceType)) return { error: 'bad_audience' };

  let audienceUserIds = [];
  let audienceRegion = null;
  if (audienceType === 'users') {
    const usernames = Array.isArray(body?.usernames)
      ? [...new Set(body.usernames.map((u) => String(u ?? '').trim().toLowerCase()).filter(Boolean))]
      : [];
    if (!usernames.length) return { error: 'empty_audience' };
    if (usernames.length > MAX_USERS) return { error: 'too_many_users' };
    const { rows } = await query(
      'SELECT id, lower(username) AS u FROM profiles WHERE lower(username) = ANY($1::text[])', [usernames],
    );
    const found = new Map(rows.map((r) => [r.u, r.id]));
    const unknown = usernames.filter((u) => !found.has(u));
    if (unknown.length) return { error: 'unknown_usernames', unknown };
    audienceUserIds = [...found.values()];
  } else if (audienceType === 'region') {
    const region = String(body?.region ?? '').toUpperCase().trim();
    if (!isValidRegion(region) || region === 'WW') return { error: 'bad_region' };
    audienceRegion = region;
  }

  const scheduleKind = ['once', 'daily', 'weekly'].includes(body?.scheduleKind) ? body.scheduleKind : 'once';

  let scheduledAt = null;
  let status = 'draft';
  if (body?.sendNow === true) {
    scheduledAt = new Date();
    status = 'scheduled';
  } else if (body?.scheduledAt) {
    const d = new Date(body.scheduledAt);
    if (Number.isNaN(d.getTime())) return { error: 'bad_schedule' };
    scheduledAt = d;
    status = 'scheduled';
  }

  const id = newBroadcastId();
  const { rows } = await query(
    `INSERT INTO notify_broadcasts
       (id, created_by, title, body, link, audience_type, audience_user_ids, audience_region,
        schedule_kind, scheduled_at, timezone_label, status, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [id, actorId, title, text, link, audienceType, audienceUserIds, audienceRegion,
      scheduleKind, scheduledAt, body?.timezoneLabel ? clean(body.timezoneLabel, 60) : null,
      status, body?.reason ? clean(body.reason, MAX_REASON) : null],
  );

  // «Отправить сейчас» не ждёт следующего тика воркера — тот же самый
  // idempotent-путь, просто запущенный сразу же, без долгого HTTP-ответа:
  // ручка уже вернула запись, эта отправка идёт в фоне.
  if (status === 'scheduled' && scheduledAt.getTime() <= Date.now()) {
    void dispatchDueBroadcasts().catch((err) => console.error('[рассылки] немедленная отправка', err.message));
  }

  return { broadcast: toBroadcast(rows[0]) };
};

/* ─── Список и детали (админка) ───────────────────────────────────── */

export const listBroadcasts = async (actorId, { status, limit } = {}) => {
  if (!(await can(actorId, 'notifications'))) return { error: 'not_allowed' };
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
  const where = [];
  const args = [];
  if (status) { args.push(status); where.push(`status = $${args.length}`); }
  args.push(lim);
  const { rows } = await query(
    `SELECT b.*, p.name AS creator_name, p.username AS creator_username
       FROM notify_broadcasts b LEFT JOIN profiles p ON p.id = b.created_by
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY b.created_at DESC LIMIT $${args.length}`,
    args,
  );
  return {
    items: rows.map((r) => ({
      ...toBroadcast(r),
      creatorName: r.creator_name ?? undefined,
      creatorUsername: r.creator_username ?? undefined,
    })),
  };
};

export const getBroadcast = async (actorId, id) => {
  if (!(await can(actorId, 'notifications'))) return { error: 'not_allowed' };
  const { rows } = await query(
    `SELECT b.*, p.name AS creator_name, p.username AS creator_username
       FROM notify_broadcasts b LEFT JOIN profiles p ON p.id = b.created_by WHERE b.id = $1`,
    [id],
  );
  if (!rows[0]) return { error: 'not_found' };
  const { rows: runs } = await query(
    `SELECT id, scheduled_for, status, recipients_total, recipients_sent, recipients_failed, push_targets, push_sent,
            error, started_at, finished_at
       FROM notify_broadcast_runs WHERE broadcast_id = $1 ORDER BY started_at DESC LIMIT 100`,
    [id],
  );
  return {
    broadcast: { ...toBroadcast(rows[0]), creatorName: rows[0].creator_name ?? undefined, creatorUsername: rows[0].creator_username ?? undefined },
    runs: runs.map((r) => ({
      id: r.id,
      scheduledFor: r.scheduled_for.toISOString(),
      status: r.status,
      recipientsTotal: r.recipients_total,
      recipientsSent: r.recipients_sent,
      recipientsFailed: r.recipients_failed,
      pushTargets: r.push_targets ?? 0,
      pushSent: r.push_sent ?? 0,
      error: r.error ?? undefined,
      startedAt: r.started_at.toISOString(),
      finishedAt: r.finished_at ? r.finished_at.toISOString() : undefined,
    })),
  };
};

/* ─── Отмена ───────────────────────────────────────────────────────── */

/** До начала отправки — снимается совсем. После того, как хоть один
 * запуск начался, история не должна пропадать: отменяем будущие
 * запуски повторяющейся рассылки, но её прошлые runs остаются как есть. */
export const cancelBroadcast = async (actorId, id, reason) => {
  if (!(await can(actorId, 'notifications'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT status FROM notify_broadcasts WHERE id = $1', [id]);
  if (!rows[0]) return { error: 'not_found' };
  if (!['draft', 'scheduled'].includes(rows[0].status)) return { error: 'not_cancellable' };
  await query(
    `UPDATE notify_broadcasts
        SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), reason = COALESCE($3, reason), updated_at = now()
      WHERE id = $1 AND status IN ('draft','scheduled')`,
    [id, actorId, reason ? clean(reason, MAX_REASON) : null],
  );
  return { ok: true };
};

/* ─── Аудитория ────────────────────────────────────────────────────── */

const resolveAudience = async (b) => {
  if (b.audience_type === 'all') {
    const { rows } = await query('SELECT id FROM profiles WHERE is_bot IS NOT TRUE');
    return rows.map((r) => r.id);
  }
  if (b.audience_type === 'region') {
    const { rows } = await query(
      'SELECT id FROM profiles WHERE is_bot IS NOT TRUE AND region_code = $1', [b.audience_region],
    );
    return rows.map((r) => r.id);
  }
  // 'users' — список зафиксирован на момент создания рассылки.
  return b.audience_user_ids ?? [];
};

/* ─── Worker: отправка due-рассылок ───────────────────────────────── */

const INTERVAL_SQL = { daily: "interval '1 day'", weekly: "interval '1 week'" };

/**
 * Забирает все рассылки, чьё время пришло, и отправляет каждую.
 *
 * Идемпотентность — на уникальном индексе (broadcast_id, scheduled_for)
 * у notify_broadcast_runs: если два worker'а (или повторный тик после
 * рестарта) возьмутся за один и тот же запуск одновременно, INSERT ...
 * ON CONFLICT DO NOTHING одного из них не вставит ничего, и он просто
 * пропустит эту рассылку в этом тике — второй раз она не уйдёт.
 */
export const dispatchDueBroadcasts = async () => {
  const { rows: due } = await query(
    `SELECT * FROM notify_broadcasts WHERE status = 'scheduled' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 50`,
  );
  for (const b of due) {
    await dispatchOne(b).catch((err) => console.error('[рассылки] запуск', b.id, err.message));
  }
};

const dispatchOne = async (b) => {
  const runId = newRunId();
  // Захват запуска — один атомарный UPSERT по (broadcast_id, scheduled_for):
  //  - строки ещё нет            → вставляется новая, забрано;
  //  - есть и уже 'processing'   → WHERE не совпал, 0 строк, не забрано
  //    (кто-то другой уже в процессе — не отправляем второй раз);
  //  - есть и уже 'sent'         → то же самое: уже отправлено, не трогаем;
  //  - есть и 'failed' (сервер упал посреди предыдущей попытки, см.
  //    sweepStaleBroadcastRuns) → переоткрывается и забирается заново,
  //    иначе зависший запуск блокировал бы этот момент времени навсегда.
  // date_trunc, не голое значение колонки: JS Date (которым node-postgres
  // отдаёт TIMESTAMPTZ и которым же сервер сам заводит scheduled_at)
  // хранит только миллисекунды, а колонка в базе — микросекунды. Без
  // усечения здесь два способа завести одно и то же время (JS Date и
  // SQL now()) дали бы разные значения scheduled_for — и уникальный
  // индекс, который должен защищать от двойной отправки, попросту не
  // сработал бы на них как на одном и том же запуске.
  const { rows: claim } = await query(
    `INSERT INTO notify_broadcast_runs (id, broadcast_id, scheduled_for, status)
     VALUES ($1,$2, date_trunc('milliseconds', $3::timestamptz), 'processing')
     ON CONFLICT (broadcast_id, scheduled_for) DO UPDATE
       SET id = EXCLUDED.id, status = 'processing', started_at = now(), finished_at = NULL, error = NULL
       WHERE notify_broadcast_runs.status = 'failed'
     RETURNING id`,
    [runId, b.id, b.scheduled_at],
  );
  if (!claim.length) return; // уже забрано, уже в процессе или уже отправлено

  try {
    const recipients = await resolveAudience(b);
    if (recipients.length) {
      // Один массовый INSERT вместо построчных — тысячи получателей не
      // должны превращаться в тысячи запросов на каждую рассылку.
      const values = [];
      const args = [];
      recipients.forEach((pid) => {
        args.push(runId, b.id, pid);
        values.push(`($${args.length - 2},$${args.length - 1},$${args.length})`);
      });
      await query(
        `INSERT INTO notify_deliveries (run_id, broadcast_id, profile_id) VALUES ${values.join(',')}
         ON CONFLICT (run_id, profile_id) DO NOTHING`,
        args,
      );
    }
    await query(
      `UPDATE notify_broadcast_runs
          SET status = 'sent', recipients_total = $2, recipients_sent = $2, finished_at = now()
        WHERE id = $1`,
      [runId, recipients.length],
    );
    /* Пуш тем, у кого приложение закрыто (остальные получат опросом).
       Охват считаем честно: сколько людей имеют подписку и сколько пушей ушло. */
    let pushTargets = 0; let pushSent = 0;
    try {
      const { rows: subs } = await query(
        'SELECT count(DISTINCT profile_id)::int AS n FROM push_subscriptions WHERE profile_id = ANY($1::text[])', [recipients]);
      pushTargets = subs[0]?.n ?? 0;
      for (let i = 0; i < recipients.length; i += 500) {
        pushSent += await pushToOffline(recipients.slice(i, i + 500), { title: b.title, body: b.body, url: b.link ?? '/', tag: `nb:${b.id}` });
      }
      await query('UPDATE notify_broadcast_runs SET push_targets = $2, push_sent = $3 WHERE id = $1', [runId, pushTargets, pushSent]);
    } catch (e) { console.error('[notify] охват пуша:', e.message); }

    if (b.schedule_kind === 'once') {
      await query(
        `UPDATE notify_broadcasts SET status = 'sent', last_sent_at = now(), updated_at = now() WHERE id = $1`,
        [b.id],
      );
    } else {
      // Повторяющаяся — переносим на следующий срок и оставляем
      // 'scheduled': кампания всё ещё активна, просто ждёт следующего раза.
      await query(
        `UPDATE notify_broadcasts
            SET scheduled_at = scheduled_at + ${INTERVAL_SQL[b.schedule_kind]},
                last_sent_at = now(), updated_at = now()
          WHERE id = $1`,
        [b.id],
      );
    }
  } catch (err) {
    await query(
      `UPDATE notify_broadcast_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
      [runId, String(err.message ?? err).slice(0, 500)],
    ).catch(() => {});
    // Провал — независимо от once/daily/weekly — требует внимания
    // администратора, а не тихих бесконечных повторов одного и того же
    // сбоя: см. пункт 14 брифа — не усложнять сверх необходимого.
    await query(
      `UPDATE notify_broadcasts SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
      [b.id, String(err.message ?? err).slice(0, 500)],
    ).catch(() => {});
  }
};

/** Запуск, зависший в processing дольше окна (сервер упал посреди
 * работы) — считаем упавшим, чтобы он не висел вечно и не блокировал
 * (в теории) наблюдение за состоянием кампании. */
export const sweepStaleBroadcastRuns = async () => {
  await query(
    `UPDATE notify_broadcast_runs SET status = 'failed', error = 'timeout', finished_at = now()
      WHERE status = 'processing' AND started_at < now() - ($1::int * interval '1 millisecond')`,
    [STALE_RUN_MS],
  );
};

/* ─── Приём рассылок клиентом (по образцу /api/bloom/events) ────────── */

/** Новые рассылки, дошедшие до этого человека с такого-то момента —
 * ровно то же самое опрашивание, что уже есть у Bloom. Тот же принцип:
 * окно ограничено сутками, since берётся с часов сервера (см. now). */
export const recentDeliveries = async (profileId, sinceIso) => {
  const { rows } = await query(
    `SELECT d.id AS delivery_id, b.title, b.body, b.link, d.created_at
       FROM notify_deliveries d JOIN notify_broadcasts b ON b.id = d.broadcast_id
      WHERE d.profile_id = $1 AND d.created_at > $2
      ORDER BY d.created_at ASC LIMIT 50`,
    [profileId, sinceIso],
  );
  return rows.map((r) => ({
    id: String(r.delivery_id), title: r.title, body: r.body, link: r.link ?? undefined,
    createdAt: r.created_at.toISOString(),
  }));
};

/** Поиск людей для выбора получателей (право notifications). Возвращает
 * только публичное: имя, ник и есть ли у человека подписка на пуши. */
export const searchRecipients = async (actorId, q) => {
  if (!(await can(actorId, 'notifications'))) return { error: 'not_allowed' };
  const s = clean(q, 60);
  if (s.length < 2) return { items: [] };
  const like = `%${s.replace(/^@/, '').replace(/[%_\\]/g, '\\$&')}%`;
  const { rows } = await query(
    `SELECT p.id, p.name, p.username,
            EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.profile_id = p.id) AS push
       FROM profiles p WHERE p.username ILIKE $1 OR p.name ILIKE $1 ORDER BY p.username LIMIT 15`, [like]);
  return { items: rows.map((r) => ({ id: r.id, name: r.name, username: r.username, push: r.push })) };
};
