/**
 * Заказы, оплата, электронные билеты и контроль на входе.
 *
 * Три вещи, ради которых этот файл устроен именно так:
 *
 * ── Перепродажи не бывает ──────────────────────────────────────────
 * Занятое считается не «прочитали, прибавили, записали», а одним
 * условным UPDATE:
 *
 *     UPDATE ticket_types SET sold = sold + N
 *      WHERE id = ... AND sold + N <= quantity
 *
 * Кто не прошёл по условию — получил ноль изменённых строк и отказ.
 * Два одновременных запроса на последнее место не могут оба увидеть
 * «свободно»: второй придёт уже к обновлённой строке. Сверх того в
 * самой таблице стоит ограничение sold <= quantity — последняя
 * преграда на случай, если однажды в коде появится второй путь.
 *
 * ── Билет — на каждое место свой ───────────────────────────────────
 * Купил три — в базе три строки, три кода, три QR. Иначе контроль на
 * входе не работает: по одной записи нельзя отметить, что двое прошли,
 * а третий ещё нет. Это же даёт организатору список билетов, а не
 * список заказов.
 *
 * ── Цена берётся только отсюда ─────────────────────────────────────
 * Клиент присылает, ЧТО он хочет купить, и никогда — почём. Присланные
 * price и total не читаются вовсе: таких полей здесь нет.
 */
import crypto from 'node:crypto';
import { encryptSecret, openSecret } from './crypto.mjs';
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { config } from './config.mjs';
import { wallet } from './wallet.mjs';
import {
  EVENT_ID_RE, TYPE_ID_RE, ORDER_ID_RE, TICKET_ID_RE,
  ORGANIZER_PRICE, ORGANIZER_DAYS,
  extendOrganizer, ownsEvent, isOrganizer, logTicket,
} from './tickets.mjs';

/* ─── Код билета ───────────────────────────────────────────────────── */

/**
 * Алфавит без 0/O и 1/I/L: код называют голосом и вбивают руками на
 * контроле, и «ноль или О» — самая частая ошибка.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const newCode = () => {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `SKY-${out.slice(0, 4)}-${out.slice(4)}`;
};

export const normalizeCode = (raw) =>
  String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

/** Код в том виде, в каком он лежит в базе, из того, что набрали руками. */
const codeFromInput = (raw) => {
  const flat = normalizeCode(raw);
  if (flat.length < 11) return null;
  /* Набрать могли и «SKYABCD1234», и «SKY-ABCD-1234», и без «SKY». */
  const body = flat.startsWith('SKY') ? flat.slice(3) : flat;
  if (body.length !== 8) return null;
  return `SKY-${body.slice(0, 4)}-${body.slice(4)}`;
};

/* ══════════════════════════════════════════════════════════════════════
   Подписка организатора: оплата
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Оплата подписки 159 ₽ за месяц.
 *
 * Цена берётся из константы сервера, а не из запроса: иначе подписку
 * купили бы за рубль, поправив тело. Платит тот, кто в сессии, —
 * чужой кошелёк отсюда не потратить, потому что идентификатор
 * плательщика сюда приходит из токена, а не из тела.
 *
 * Идемпотентность: ключ уникален вместе с профилем. Повторное нажатие
 * не спишет второй раз и не добавит второй месяц — вернётся тот же
 * ответ, что и в первый раз.
 */
export const payOrganizer = async (profileId, idemKey) => {
  /* Списание денег доступно только там, где оплата настроена. Тот же
     гейт, что и у пополнения кошелька и Prime: открывать его можно
     лишь вместе с настоящим приёмом платежей. */
  if (config.paymentsMode !== 'demo') return { error: 'payments_not_configured' };

  const key = String(idemKey ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (key.length < 8) return { error: 'idem_key_required' };

  /* Уже платили этим ключом — отвечаем тем же, ничего не делая. */
  const { rows: seen } = await query(
    'SELECT id, status FROM ticket_organizer_payments WHERE profile_id = $1 AND idem_key = $2',
    [profileId, key],
  );
  if (seen[0]) {
    return { alreadyDone: true, paymentId: seen[0].id };
  }

  const paid = await wallet.spend(
    profileId, ORGANIZER_PRICE, 'prime',
    `Sky Tickets · кабинет организатора, ${ORGANIZER_DAYS} дн.`,
  );
  if (paid.error) return paid;

  const paymentId = `tpay-${generateId()}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    /* Запись платежа и продление — одной транзакцией: иначе возможен
       списанный рубль без подписки или подписка без записи в журнале. */
    await client.query(
      `INSERT INTO ticket_organizer_payments
         (id, profile_id, idem_key, amount, days, method, status)
       VALUES ($1,$2,$3,$4,$5,'wallet','paid')`,
      [paymentId, profileId, key, ORGANIZER_PRICE, ORGANIZER_DAYS],
    );
    const until = await extendOrganizer(client, profileId, ORGANIZER_DAYS);
    await client.query('COMMIT');
    return { paymentId, activeUntil: until.toISOString(), balance: paid.balance, price: ORGANIZER_PRICE };
  } catch (err) {
    await client.query('ROLLBACK');
    /* Гонка по ключу идемпотентности: параллельный запрос успел
       первым. Деньги, которые мы успели списать, возвращаем — иначе
       двойное нажатие стоило бы вдвое. */
    await wallet.refund(profileId, ORGANIZER_PRICE, 'Возврат: подписка уже оформлена');
    if (err.code === '23505') {
      const { rows } = await query(
        'SELECT id FROM ticket_organizer_payments WHERE profile_id = $1 AND idem_key = $2',
        [profileId, key],
      );
      return { alreadyDone: true, paymentId: rows[0]?.id ?? null };
    }
    throw err;
  } finally {
    client.release();
  }
};

export const organizerPayments = async (profileId) => {
  const { rows } = await query(
    `SELECT id, amount, days, method, status, created_at
       FROM ticket_organizer_payments WHERE profile_id = $1
      ORDER BY created_at DESC LIMIT 24`,
    [profileId],
  );
  return rows.map((r) => ({
    id: r.id, amount: Number(r.amount), days: Number(r.days),
    method: r.method, status: r.status, at: r.created_at.toISOString(),
  }));
};

/* ══════════════════════════════════════════════════════════════════════
   Покупка билетов
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Покупка.
 *
 * Из тела запроса читаются ровно три вещи: какой тип билета, сколько
 * штук и ключ идемпотентности. Цена, остаток, лимит и принадлежность
 * типа мероприятию берутся из базы в той же транзакции, под
 * блокировкой строки.
 */
export const buyTickets = async (userId, typeId, rawQty, idemKey) => {
  if (config.paymentsMode !== 'demo') return { error: 'payments_not_configured' };
  if (!TYPE_ID_RE.test(String(typeId ?? ''))) return { error: 'not_found' };

  const qty = Number(rawQty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) return { error: 'invalid_quantity' };

  const key = String(idemKey ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (key.length < 8) return { error: 'idem_key_required' };

  /* Повтор того же нажатия — тот же заказ, без второго списания. */
  const { rows: seen } = await query(
    'SELECT id FROM ticket_orders WHERE user_id = $1 AND idem_key = $2', [userId, key],
  );
  if (seen[0]) return { alreadyDone: true, ...(await readOrder(seen[0].id, userId)) };

  /* Шаг 1: под блокировкой проверяем и занимаем места. Деньги ещё не
     тронуты — если оплата не пройдёт, место вернём. */
  const held = await holdSeats(userId, typeId, qty, key);
  if (held.error) return held;

  /* Шаг 2: оплата. Сумма — та, что посчитал сервер на шаге 1. */
  const paid = await wallet.spend(
    userId, held.total, 'market',
    `Билеты · ${held.eventTitle} · ${held.typeName} × ${qty}`,
    held.orderId,
  );
  if (paid.error) {
    await releaseOrder(held.orderId, 'cancelled');
    return paid;
  }

  /* Шаг 3: выпускаем билеты и закрываем заказ. */
  const issued = await issueTickets(held.orderId);
  if (issued.error) {
    await releaseOrder(held.orderId, 'cancelled');
    await wallet.refund(userId, held.total, 'Возврат: не удалось выпустить билеты', held.orderId);
    return { error: 'issue_failed' };
  }

  await logTicket(held.eventId, userId, 'order.paid', `${qty} шт · ${held.total} ₽`);
  return { ...(await readOrder(held.orderId, userId)), balance: paid.balance };
};

/**
 * Занимает места и создаёт заказ.
 *
 * Вся проверка — в одной транзакции, и занятие мест сделано условным
 * UPDATE. Это и есть защита от гонки: два запроса на последнее место
 * не могут оба увидеть «свободно».
 */
const holdSeats = async (userId, typeId, qty, idemKey) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* Блокируем строку типа билета: остальное считаем уже зная, что
       никто её параллельно не меняет. */
    const { rows: t } = await client.query(
      `SELECT tt.*, e.id AS event_id, e.title AS event_title, e.status AS event_status,
              e.starts_at, e.organizer_id
         FROM ticket_types tt JOIN ticket_events e ON e.id = tt.event_id
        WHERE tt.id = $1
        FOR UPDATE OF tt`,
      [typeId],
    );
    const type = t[0];
    if (!type) { await client.query('ROLLBACK'); return { error: 'not_found' }; }

    /* Мероприятие должно быть в продаже. Черновик, пауза, отмена и
       прошедшее — не продаются. */
    if (type.event_status !== 'published') { await client.query('ROLLBACK'); return { error: 'not_on_sale' }; }
    if (new Date(type.starts_at).getTime() < Date.now()) {
      await client.query('ROLLBACK'); return { error: 'event_started' };
    }
    if (type.status !== 'active') { await client.query('ROLLBACK'); return { error: 'not_on_sale' }; }
    if (type.sale_from && new Date(type.sale_from).getTime() > Date.now()) {
      await client.query('ROLLBACK'); return { error: 'sale_not_started' };
    }
    if (type.sale_to && new Date(type.sale_to).getTime() < Date.now()) {
      await client.query('ROLLBACK'); return { error: 'sale_ended' };
    }

    /* Свой же билет покупать незачем, но и запрещать нечего — организатор
       вправе выкупить место. А вот лимит на человека проверяем всегда. */
    const { rows: mine } = await client.query(
      `SELECT COALESCE(sum(quantity), 0)::int AS n FROM ticket_orders
        WHERE user_id = $1 AND ticket_type_id = $2 AND status IN ('paid','awaiting_payment')`,
      [userId, typeId],
    );
    if (Number(mine[0].n) + qty > Number(type.per_user_max)) {
      await client.query('ROLLBACK');
      return { error: 'per_user_limit', limit: Number(type.per_user_max), already: Number(mine[0].n) };
    }

    /* Занятие мест. Условие в самом UPDATE — ноль строк значит
       «не хватило», и никакого «прочитали свободно, записали занято». */
    const { rowCount } = await client.query(
      `UPDATE ticket_types SET sold = sold + $2
        WHERE id = $1 AND sold + $2 <= quantity`,
      [typeId, qty],
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      return { error: 'sold_out', available: Math.max(0, Number(type.quantity) - Number(type.sold)) };
    }

    /* Цена фиксируется в заказе: поднятая завтра цена не изменит
       вчерашнюю покупку. */
    const unitPrice = Number(type.price);
    const total = unitPrice * qty;
    const orderId = `tor-${generateId()}`;

    await client.query(
      `INSERT INTO ticket_orders
         (id, user_id, event_id, ticket_type_id, quantity, unit_price, total, status, idem_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'awaiting_payment',$8)`,
      [orderId, userId, type.event_id, typeId, qty, unitPrice, total, idemKey],
    );

    await client.query('COMMIT');
    return {
      orderId, total, unitPrice,
      eventId: type.event_id, eventTitle: type.event_title, typeName: type.name,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return { error: 'duplicate' };
    throw err;
  } finally {
    client.release();
  }
};

/** Возврат мест в продажу, если оплата не прошла. */
const releaseOrder = async (orderId, status) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE ticket_orders SET status = $2, cancelled_at = now()
        WHERE id = $1 AND status = 'awaiting_payment'
        RETURNING ticket_type_id, quantity`,
      [orderId, status],
    );
    if (rows[0]) {
      await client.query(
        'UPDATE ticket_types SET sold = GREATEST(sold - $2, 0) WHERE id = $1',
        [rows[0].ticket_type_id, rows[0].quantity],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Выпускает билеты: по одному на каждое место.
 *
 * Идемпотентно: заказ переводится в paid условием `status =
 * 'awaiting_payment'`, поэтому повторный вызов не выпустит второй
 * комплект билетов.
 */
const issueTickets = async (orderId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE ticket_orders SET status = 'paid', paid_at = now()
        WHERE id = $1 AND status = 'awaiting_payment'
        RETURNING user_id, event_id, ticket_type_id, quantity`,
      [orderId],
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return { error: 'not_awaiting' }; }
    const o = rows[0];

    for (let seat = 1; seat <= Number(o.quantity); seat += 1) {
      /* Код уникален по всей системе. Совпадение практически
         невозможно, но если оно случится, повторяем: ошибка на
         оплаченном заказе хуже лишнего круга. */
      let placed = false;
      for (let attempt = 0; attempt < 5 && !placed; attempt += 1) {
        try {
          await client.query(
            `INSERT INTO tickets
               (id, order_id, event_id, ticket_type_id, user_id, code, qr_secret, seat_no)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [`tkt-${generateId()}`, orderId, o.event_id, o.ticket_type_id, o.user_id,
             newCode(), encryptSecret(crypto.randomBytes(32).toString('base64url')), seat],
          );
          placed = true;
        } catch (err) {
          if (err.code !== '23505') throw err;
        }
      }
      if (!placed) { await client.query('ROLLBACK'); return { error: 'code_collision' }; }
    }

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/* ══════════════════════════════════════════════════════════════════════
   Заказы и билеты покупателя
   ══════════════════════════════════════════════════════════════════════ */

const orderView = (row) => ({
  id: row.id,
  eventId: row.event_id,
  eventTitle: row.event_title,
  startsAt: row.starts_at ? row.starts_at.toISOString() : null,
  venue: row.venue,
  city: row.city,
  accent: row.accent,
  typeName: row.type_name,
  quantity: Number(row.quantity),
  unitPrice: Number(row.unit_price),
  total: Number(row.total),
  currency: row.currency,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  paidAt: row.paid_at ? row.paid_at.toISOString() : null,
});

const ORDER_JOIN = `
  FROM ticket_orders o
  JOIN ticket_events e ON e.id = o.event_id
  LEFT JOIN ticket_types tt ON tt.id = o.ticket_type_id`;
const ORDER_COLS = `
  o.*, e.title AS event_title, e.starts_at, e.venue, e.city, e.accent,
  tt.name AS type_name`;

/**
 * Один заказ вместе с билетами.
 *
 * Условие user_id стоит в запросе. Подставить чужой order_id можно,
 * ответом будет «не найдено» — строка просто не выберется.
 */
export const readOrder = async (orderId, userId) => {
  if (!ORDER_ID_RE.test(String(orderId ?? ''))) return null;
  const { rows } = await query(
    `SELECT ${ORDER_COLS} ${ORDER_JOIN} WHERE o.id = $1 AND o.user_id = $2`,
    [orderId, userId],
  );
  if (!rows[0]) return null;
  return { order: orderView(rows[0]), tickets: await listOrderTickets(orderId, userId) };
};

export const listOrders = async (userId, limit = 50) => {
  const { rows } = await query(
    `SELECT ${ORDER_COLS} ${ORDER_JOIN}
      WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 50, 1), 100)],
  );
  return rows.map(orderView);
};

const ticketView = (row, { withSecret = false } = {}) => ({
  id: row.id,
  code: row.code,
  status: row.status,
  seatNo: Number(row.seat_no),
  eventId: row.event_id,
  eventTitle: row.event_title,
  startsAt: row.starts_at ? row.starts_at.toISOString() : null,
  venue: row.venue,
  city: row.city,
  address: row.address,
  accent: row.accent,
  typeName: row.type_name,
  price: Number(row.unit_price ?? 0),
  usedAt: row.used_at ? row.used_at.toISOString() : null,
  orderId: row.order_id,
  createdAt: row.created_at.toISOString(),
  /* Ключ для QR отдаётся только владельцу билета и только в его же
     списке: по нему проходят на контроле. */
  ...(withSecret ? { qr: `${row.id}.${openSecret(row.qr_secret)}` } : {}),
});

const TICKET_JOIN = `
  FROM tickets k
  JOIN ticket_events e ON e.id = k.event_id
  LEFT JOIN ticket_types tt ON tt.id = k.ticket_type_id
  LEFT JOIN ticket_orders o ON o.id = k.order_id`;
const TICKET_COLS = `
  k.*, e.title AS event_title, e.starts_at, e.venue, e.city, e.address, e.accent,
  tt.name AS type_name, o.unit_price`;

export const listOrderTickets = async (orderId, userId) => {
  const { rows } = await query(
    `SELECT ${TICKET_COLS} ${TICKET_JOIN}
      WHERE k.order_id = $1 AND k.user_id = $2 ORDER BY k.seat_no`,
    [orderId, userId],
  );
  return rows.map((r) => ticketView(r, { withSecret: true }));
};

/**
 * «Мои билеты».
 *
 * Привязка к спрашивающему стоит в запросе: получить чужой билет
 * подменой идентификатора нельзя — идентификатор владельца сюда
 * приходит из сессии, а не из запроса.
 */
export const listMyTickets = async (userId, scope = 'active') => {
  const clauses = ['k.user_id = $1'];
  if (scope === 'active') {
    clauses.push(`k.status = 'valid'`);
    clauses.push(`e.starts_at > now() - interval '12 hours'`);
  } else if (scope === 'past') {
    clauses.push(`(k.status <> 'valid' OR e.starts_at <= now() - interval '12 hours')`);
  }

  const { rows } = await query(
    `SELECT ${TICKET_COLS} ${TICKET_JOIN}
      WHERE ${clauses.join(' AND ')}
      ORDER BY e.starts_at DESC, k.seat_no LIMIT 200`,
    [userId],
  );
  return rows.map((r) => ticketView(r, { withSecret: true }));
};

/* ══════════════════════════════════════════════════════════════════════
   Контроль на входе
   ══════════════════════════════════════════════════════════════════════ */

/** Находит билет по QR-ключу или по набранному коду. */
const findTicket = async (client, { qr, code }) => {
  if (qr) {
    const [id, secret] = String(qr).split('.');
    if (!TICKET_ID_RE.test(id ?? '') || !secret) return null;
    const { rows } = await client.query(
      `SELECT ${TICKET_COLS}, k.qr_secret AS secret ${TICKET_JOIN} WHERE k.id = $1 FOR UPDATE OF k`,
      [id],
    );
    if (!rows[0]) return null;
    /* Сравнение постоянного времени: по скорости обычного сравнения
       ключ подбирается побайтно. */
    const a = Buffer.from(String(openSecret(rows[0].secret) ?? ''));
    const b = Buffer.from(String(secret));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return rows[0];
  }

  const normalized = codeFromInput(code);
  if (!normalized) return null;
  const { rows } = await client.query(
    `SELECT ${TICKET_COLS} ${TICKET_JOIN} WHERE k.code = $1 FOR UPDATE OF k`,
    [normalized],
  );
  return rows[0] ?? null;
};

/**
 * Проверка билета на входе — без отметки.
 *
 * Смотреть чужой билет вправе только организатор того мероприятия, на
 * которое билет выписан. Проверка идёт по мероприятию из самого
 * билета, а не по тому, что прислали в запросе.
 */
export const inspectTicket = async (organizerId, { qr, code }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await findTicket(client, { qr, code });
    await client.query('ROLLBACK');
    if (!row) return { result: 'not_found' };
    if (!(await ownsEvent(row.event_id, organizerId))) return { result: 'not_found' };
    return { result: row.status, ticket: ticketView(row) };
  } finally {
    client.release();
  }
};

/**
 * Отметка «прошёл».
 *
 * Переход valid → used выполняется условным UPDATE внутри той же
 * транзакции, где билет был найден и заблокирован. Два одновременных
 * сканирования одного билета не могут оба получить «действителен»:
 * второй придёт к уже отмеченной строке и получит «уже использован».
 */
export const useTicket = async (organizerId, { qr, code }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const row = await findTicket(client, { qr, code });
    if (!row) { await client.query('ROLLBACK'); return { result: 'not_found' }; }

    /* Право отмечать — только у организатора ЭТОГО мероприятия. */
    const { rows: own } = await client.query(
      'SELECT 1 FROM ticket_events WHERE id = $1 AND organizer_id = $2',
      [row.event_id, organizerId],
    );
    if (!own[0]) {
      await client.query('ROLLBACK');
      /* Чужой билет неотличим от несуществующего: иначе по разнице
         ответов можно было бы выяснять, какие коды существуют. */
      return { result: 'not_found' };
    }

    if (row.status !== 'valid') {
      await client.query('ROLLBACK');
      return { result: row.status, ticket: ticketView(row) };
    }

    const { rows: marked } = await client.query(
      `UPDATE tickets SET status = 'used', used_at = now(), used_by = $2
        WHERE id = $1 AND status = 'valid'
        RETURNING used_at`,
      [row.id, organizerId],
    );
    if (!marked[0]) {
      await client.query('ROLLBACK');
      return { result: 'used', ticket: ticketView(row) };
    }

    await client.query('COMMIT');
    await logTicket(row.event_id, organizerId, 'ticket.used', row.code);
    return {
      result: 'ok',
      ticket: { ...ticketView(row), status: 'used', usedAt: marked[0].used_at.toISOString() },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Пометить билет просроченным — или вернуть в действующие.
 *
 * Пометка видна и покупателю: статус лежит в самой строке билета, и
 * его список читает ту же строку. Отдельной «копии у пользователя» не
 * существует, поэтому разойтись им негде.
 */
export const setTicketStatus = async (organizerId, ticketId, next) => {
  if (!TICKET_ID_RE.test(String(ticketId ?? ''))) return { error: 'not_found' };
  if (!['expired', 'valid', 'cancelled'].includes(next)) return { error: 'bad_status' };

  const { rows } = await query(
    `UPDATE tickets k SET status = $3,
            used_at = CASE WHEN $3 = 'valid' THEN NULL ELSE k.used_at END,
            used_by = CASE WHEN $3 = 'valid' THEN NULL ELSE k.used_by END
      FROM ticket_events e
      WHERE k.id = $1 AND e.id = k.event_id AND e.organizer_id = $2
      RETURNING k.id, k.code, k.event_id, k.status`,
    [ticketId, organizerId, next],
  );
  if (!rows[0]) return { error: 'not_found' };
  await logTicket(rows[0].event_id, organizerId, `ticket.${next}`, rows[0].code);
  return { ok: true, id: rows[0].id, status: rows[0].status };
};

/**
 * Пометить просроченными все непогашенные билеты мероприятия.
 *
 * То, чем закрывают вход после начала: вручную отмечать сотню
 * оставшихся никто не станет.
 */
export const expireRemaining = async (organizerId, eventId) => {
  if (!(await ownsEvent(eventId, organizerId))) return { error: 'not_found' };
  const { rowCount } = await query(
    `UPDATE tickets SET status = 'expired' WHERE event_id = $1 AND status = 'valid'`,
    [eventId],
  );
  await logTicket(eventId, organizerId, 'tickets.expired', `${rowCount} шт`);
  return { expired: rowCount };
};

/* ══════════════════════════════════════════════════════════════════════
   Кабинет организатора: билеты, заказы, статистика
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Билеты мероприятия — в кабинете организатора.
 *
 * Ключ QR сюда не попадает: организатору он не нужен (он проверяет
 * то, что показал гость), а лишняя копия ключа — лишний путь утечки.
 */
export const eventTickets = async (organizerId, eventId, { status = 'all', q = '', limit = 100, offset = 0 } = {}) => {
  if (!(await ownsEvent(eventId, organizerId))) return { error: 'not_found' };

  const clauses = ['k.event_id = $1'];
  const args = [eventId];
  if (['valid', 'used', 'expired', 'cancelled', 'refunded'].includes(status)) {
    args.push(status);
    clauses.push(`k.status = $${args.length}`);
  }
  const needle = codeFromInput(q);
  if (needle) { args.push(needle); clauses.push(`k.code = $${args.length}`); }

  const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);

  const { rows } = await query(
    `SELECT ${TICKET_COLS}, p.name AS buyer_name, p.username AS buyer_username
       ${TICKET_JOIN}
       LEFT JOIN profiles p ON p.id = k.user_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY k.created_at DESC, k.seat_no
      LIMIT ${lim + 1} OFFSET ${off}`,
    args,
  );
  const more = rows.length > lim;
  return {
    tickets: rows.slice(0, lim).map((r) => ({
      ...ticketView(r),
      buyer: r.buyer_name ?? '—',
      buyerUsername: r.buyer_username ? `@${r.buyer_username}` : null,
    })),
    more, offset: off, limit: lim,
  };
};

/** Заказы мероприятия. Тоже только своего. */
export const eventOrders = async (organizerId, eventId, limit = 100) => {
  if (!(await ownsEvent(eventId, organizerId))) return { error: 'not_found' };
  const { rows } = await query(
    `SELECT ${ORDER_COLS}, p.name AS buyer_name ${ORDER_JOIN}
       LEFT JOIN profiles p ON p.id = o.user_id
      WHERE o.event_id = $1 ORDER BY o.created_at DESC LIMIT $2`,
    [eventId, Math.min(Math.max(Number(limit) || 100, 1), 200)],
  );
  return rows.map((r) => ({ ...orderView(r), buyer: r.buyer_name ?? '—' }));
};

/**
 * Статистика мероприятия.
 *
 * Всё считается в базе. Значения, присланные клиентом, здесь не
 * принимаются вовсе — таких входных данных у функции нет.
 */
export const eventStats = async (organizerId, eventId) => {
  if (!(await ownsEvent(eventId, organizerId))) return { error: 'not_found' };

  const [totals, byType, daily, checkin] = await Promise.all([
    query(
      `SELECT COALESCE(sum(o.quantity), 0)::int AS sold,
              COALESCE(sum(o.total), 0)::bigint AS revenue,
              count(*)::int                     AS orders
         FROM ticket_orders o WHERE o.event_id = $1 AND o.status = 'paid'`,
      [eventId],
    ),
    query(
      `SELECT t.id, t.name, t.price, t.quantity, t.sold,
              COALESCE(sum(o.total) FILTER (WHERE o.status = 'paid'), 0)::bigint AS revenue
         FROM ticket_types t
         LEFT JOIN ticket_orders o ON o.ticket_type_id = t.id
        WHERE t.event_id = $1
        GROUP BY t.id ORDER BY t.ordering, t.price`,
      [eventId],
    ),
    query(
      `SELECT o.paid_at::date AS day,
              sum(o.quantity)::int AS sold,
              sum(o.total)::bigint AS revenue
         FROM ticket_orders o
        WHERE o.event_id = $1 AND o.status = 'paid' AND o.paid_at > now() - interval '60 days'
        GROUP BY day ORDER BY day`,
      [eventId],
    ),
    query(
      `SELECT status, count(*)::int AS n FROM tickets WHERE event_id = $1 GROUP BY status`,
      [eventId],
    ),
    ]);

  const { rows: ev } = await query(
    'SELECT views, title, starts_at FROM ticket_events WHERE id = $1', [eventId],
  );

  const byStatus = Object.fromEntries(checkin.rows.map((r) => [r.status, Number(r.n)]));

  return {
    title: ev[0]?.title ?? '',
    startsAt: ev[0]?.starts_at ? ev[0].starts_at.toISOString() : null,
    views: Number(ev[0]?.views ?? 0),
    sold: Number(totals.rows[0].sold),
    revenue: Number(totals.rows[0].revenue),
    orders: Number(totals.rows[0].orders),
    available: byType.rows.reduce((n, r) => n + (Number(r.quantity) - Number(r.sold)), 0),
    capacity: byType.rows.reduce((n, r) => n + Number(r.quantity), 0),
    byType: byType.rows.map((r) => ({
      id: r.id, name: r.name, price: Number(r.price),
      quantity: Number(r.quantity), sold: Number(r.sold), revenue: Number(r.revenue),
    })),
    daily: daily.rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      sold: Number(r.sold), revenue: Number(r.revenue),
    })),
    checkin: {
      valid: byStatus.valid ?? 0,
      used: byStatus.used ?? 0,
      expired: byStatus.expired ?? 0,
      cancelled: byStatus.cancelled ?? 0,
      refunded: byStatus.refunded ?? 0,
    },
  };
};

/** Сводка по всем своим мероприятиям — верх кабинета. */
export const organizerSummary = async (organizerId) => {
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE e.status = 'published')::int AS published,
            count(*) FILTER (WHERE e.status = 'draft')::int     AS drafts,
            count(*) FILTER (WHERE e.status = 'pending')::int   AS pending,
            count(*)::int                                       AS total
       FROM ticket_events e WHERE e.organizer_id = $1`,
    [organizerId],
  );
  const { rows: money } = await query(
    `SELECT COALESCE(sum(o.total), 0)::bigint AS revenue,
            COALESCE(sum(o.quantity), 0)::int AS sold
       FROM ticket_orders o JOIN ticket_events e ON e.id = o.event_id
      WHERE e.organizer_id = $1 AND o.status = 'paid'`,
    [organizerId],
  );
  return {
    ...rows[0],
    revenue: Number(money[0].revenue),
    sold: Number(money[0].sold),
  };
};

export { isOrganizer, EVENT_ID_RE };
