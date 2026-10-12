/**
 * Поддержка: обращения и переписка по ним.
 *
 * Обратная связь и жалобы до сих пор записывались в localStorage того,
 * кто жаловался, — их не видел никто. Теперь это тикеты на сервере.
 *
 * Устройство простое и намеренно не похоже на чат: у обращения есть
 * состояние, один ответственный и история передач. Отвечают
 * администраторы; назначить можно только администратора, а передать —
 * другому администратору.
 *
 * Обращения не проходят через хаб мессенджера: забаненного туда не
 * пускают, а обжаловать блокировку он должен иметь возможность.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { can, adminsWith, writeAdminLog } from './admin.mjs';
import { emailGuestReply } from './sitesupport.mjs';

const KINDS = new Set(['question', 'bug', 'idea', 'report', 'appeal']);
const STATUSES = new Set(['open', 'in_progress', 'waiting', 'closed']);

const MAX_SUBJECT = 200;
const MAX_BODY = 4000;
/** Сколько обращений человек может завести за сутки. */
const TICKETS_PER_DAY = 20;
/** Сколько сообщений в обращение за час. */
const MESSAGES_PER_HOUR = 60;

const newId = (p) => `${p}-${crypto.randomUUID()}`;

const toTicket = (row) => ({
  id: row.id,
  authorId: row.author_id,
  subject: decryptContent(row.subject) ?? '',
  kind: row.kind,
  status: row.status,
  assigneeId: row.assignee_id ?? undefined,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  closedAt: row.closed_at ? row.closed_at.toISOString() : undefined,
  messages: row.messages ?? undefined,
  // Обращение с лендинга (server/sitesupport.mjs): контакт — почта; видно только сотрудникам (читать такой тикет больше некому).
  source: row.source ?? 'app',
  guestEmail: row.source === 'site' && row.guest_email ? decryptContent(row.guest_email) ?? undefined : undefined,
  guestCode: row.guest_code ?? undefined,
});

const toMessage = (row) => ({
  id: row.id,
  authorId: row.author_id ?? undefined,
  fromStaff: row.from_staff,
  body: decryptContent(row.body) ?? '',
  createdAt: row.created_at.toISOString(),
});

const writeEvent = async (ticketId, actorId, type, detail) => {
  await query(
    'INSERT INTO support_events (id, ticket_id, actor_id, type, detail) VALUES ($1,$2,$3,$4,$5)',
    [newId('se'), ticketId, actorId ?? null, String(type).slice(0, 40),
     encryptContent(String(detail ?? '').slice(0, 300))],
  );
};

/* ─── Создание обращения ───────────────────────────────────────────────── */

/**
 * Новое обращение. Первое сообщение кладётся сразу: обращение без
 * текста ничем не поможет тому, кто будет его читать.
 */
export const createTicket = async (authorId, { subject, body, kind } = {}) => {
  const text = String(body ?? '').trim().slice(0, MAX_BODY);
  if (!text) return { error: 'empty' };

  // Предел на сутки: без него один человек забьёт очередь поддержки.
  const { rows: recent } = await query(
    `SELECT count(*)::int AS n FROM support_tickets
      WHERE author_id = $1 AND created_at > now() - interval '1 day'`,
    [authorId],
  );
  if ((recent[0]?.n ?? 0) >= TICKETS_PER_DAY) return { error: 'too_many' };

  const id = newId('tk');
  const theme = String(subject ?? '').trim().slice(0, MAX_SUBJECT)
             || text.slice(0, 60);
  await query(
    `INSERT INTO support_tickets (id, author_id, subject, kind)
     VALUES ($1,$2,$3,$4)`,
    [id, authorId, encryptContent(theme), KINDS.has(kind) ? kind : 'question'],
  );
  await query(
    `INSERT INTO support_messages (id, ticket_id, author_id, from_staff, body)
     VALUES ($1,$2,$3,FALSE,$4)`,
    [newId('sm'), id, authorId, encryptContent(text)],
  );
  await writeEvent(id, authorId, 'created', 'Обращение создано');
  return { ticket: await readTicket(id, authorId) };
};

/* ─── Чтение ───────────────────────────────────────────────────────────── */

/** Обращение целиком. Видят его автор и администраторы, больше никто. */
export const readTicket = async (ticketId, viewerId) => {
  const { rows } = await query('SELECT * FROM support_tickets WHERE id = $1', [String(ticketId ?? '')]);
  const row = rows[0];
  if (!row) return null;
  if (row.author_id !== viewerId && !(await can(viewerId, 'support'))) return null;

  const { rows: msgs } = await query(
    'SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at', [row.id],
  );
  const { rows: events } = await query(
    'SELECT id, actor_id, type, detail, created_at FROM support_events WHERE ticket_id = $1 ORDER BY created_at',
    [row.id],
  );
  return {
    ...toTicket(row),
    messages: msgs.map(toMessage),
    events: events.map((e) => ({
      id: e.id, actorId: e.actor_id ?? undefined, type: e.type,
      detail: decryptContent(e.detail) ?? '', createdAt: e.created_at.toISOString(),
    })),
  };
};

/** Свои обращения. */
export const listMyTickets = async (userId) => {
  const { rows } = await query(
    'SELECT * FROM support_tickets WHERE author_id = $1 ORDER BY updated_at DESC LIMIT 100',
    [userId],
  );
  return rows.map(toTicket);
};

/**
 * Очередь поддержки. Только администраторам: в обращениях чужие
 * жалобы и переписка.
 */
export const listQueue = async (actorId, { status, mine } = {}) => {
  if (!(await can(actorId, 'support'))) return null;
  const where = ['TRUE'];
  const args = [];
  if (STATUSES.has(status)) { args.push(status); where.push(`status = $${args.length}`); }
  else { where.push("status <> 'closed'"); }
  if (mine) { args.push(actorId); where.push(`assignee_id = $${args.length}`); }

  const { rows } = await query(
    `SELECT * FROM support_tickets WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC LIMIT 200`,
    args,
  );
  return rows.map(toTicket);
};

/* ─── Переписка ────────────────────────────────────────────────────────── */

/**
 * Ответ в обращении. От автора — обычное сообщение; от администратора —
 * ответ поддержки, и обращение само переходит в работу.
 */
export const replyToTicket = async (ticketId, authorId, body) => {
  const text = String(body ?? '').trim().slice(0, MAX_BODY);
  if (!text) return { error: 'empty' };

  const { rows } = await query('SELECT * FROM support_tickets WHERE id = $1', [String(ticketId ?? '')]);
  const ticket = rows[0];
  if (!ticket) return { error: 'not_found' };

  const staff = await can(authorId, 'support');
  if (ticket.author_id !== authorId && !staff) return { error: 'not_allowed' };
  if (ticket.status === 'closed') return { error: 'closed' };

  const { rows: recent } = await query(
    `SELECT count(*)::int AS n FROM support_messages
      WHERE author_id = $1 AND created_at > now() - interval '1 hour'`,
    [authorId],
  );
  if ((recent[0]?.n ?? 0) >= MESSAGES_PER_HOUR) return { error: 'too_many' };

  await query(
    `INSERT INTO support_messages (id, ticket_id, author_id, from_staff, body)
     VALUES ($1,$2,$3,$4,$5)`,
    [newId('sm'), ticket.id, authorId, staff, encryptContent(text)],
  );

  // Ответ поддержки переводит обращение в работу, ответ человека —
  // обратно из «ждём ответа»: иначе очередь пришлось бы разбирать
  // вручную после каждого сообщения.
  const nextStatus = staff ? 'in_progress'
    : (ticket.status === 'waiting' ? 'open' : ticket.status);
  await query(
    'UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1',
    [ticket.id, nextStatus],
  );
  if (staff) void emailGuestReply(ticket, text);
  return { ticket: await readTicket(ticket.id, authorId) };
};

/* ─── Назначение и состояние ───────────────────────────────────────────── */

/**
 * Назначить ответственного. Назначать может администратор, и только
 * администратора: обычный человек не должен оказаться исполнителем
 * чужого обращения и увидеть его переписку.
 */
export const assignTicket = async (ticketId, actorId, assigneeId) => {
  if (!(await can(actorId, 'support'))) return { error: 'not_allowed' };
  const target = String(assigneeId ?? '');
  if (target && !(await can(target, 'support'))) return { error: 'not_admin' };

  const { rowCount } = await query(
    `UPDATE support_tickets
        SET assignee_id = $2,
            -- Приведение обязательно: в IS NOT NULL Постгрес не может
            -- вывести тип параметра сам и отказывается выполнять запрос.
            status = CASE WHEN status = 'open' AND $2::text IS NOT NULL
                          THEN 'in_progress' ELSE status END,
            updated_at = now()
      WHERE id = $1`,
    [String(ticketId ?? ''), target || null],
  );
  if (!rowCount) return { error: 'not_found' };

  await writeEvent(ticketId, actorId, target ? 'assigned' : 'unassigned',
    target ? 'Назначен ответственный' : 'Ответственный снят');
  await writeAdminLog(actorId, target || null, 'ticket_assign', `Обращение ${ticketId}`);
  return { ticket: await readTicket(ticketId, actorId) };
};

/**
 * Сменить состояние. Администратор может любое; автор — только закрыть
 * своё обращение и открыть его заново.
 */
export const setTicketStatus = async (ticketId, actorId, status) => {
  if (!STATUSES.has(status)) return { error: 'not_allowed' };
  const { rows } = await query('SELECT * FROM support_tickets WHERE id = $1', [String(ticketId ?? '')]);
  const ticket = rows[0];
  if (!ticket) return { error: 'not_found' };

  const staff = await can(actorId, 'support');
  if (!staff) {
    if (ticket.author_id !== actorId) return { error: 'not_allowed' };
    if (status !== 'closed' && status !== 'open') return { error: 'not_allowed' };
  }

  await query(
    `UPDATE support_tickets
        SET status = $2, updated_at = now(),
            closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END
      WHERE id = $1`,
    [ticket.id, status],
  );
  await writeEvent(ticket.id, actorId, `status_${status}`, `Состояние: ${status}`);
  return { ticket: await readTicket(ticket.id, actorId) };
};

/**
 * Из кого выбирать ответственного.
 *
 * Не «все администраторы», а те, у кого есть право на поддержку: тот же
 * набор, что проверяет assignTicket. Иначе экран предлагал бы человека,
 * которому сервер откажет, — и выглядело бы это как поломка, а не как
 * запрет.
 */
export const listAdmins = async (actorId) => {
  if (!(await can(actorId, 'support'))) return null;
  const rows = await adminsWith('support');
  return rows.map((r) => ({ id: r.id, name: r.name, username: r.username }));
};
