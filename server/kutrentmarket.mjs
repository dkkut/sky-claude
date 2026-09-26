/**
 * KutRent Market — логика сайта-партнёра (market.kutrent.online).
 *
 * Отдельный сайт, но не отдельный сервис: работает тем же API-процессом
 * и той же базой, что и весь Sky. Поэтому пополнение баланса Sky —
 * обычный внутрипроцессный вызов wallet.credit(), без сети, подписей
 * и общих секретов между «сервисами» — их просто нет, это один процесс.
 *
 * Посетитель сайта не обязан быть пользователем Sky: у него своя,
 * анонимная сессия (см. kutrent_sessions) — только чтобы «Профиль» и
 * «Заказы» показывали настоящую историю этого браузера, а не то, что
 * раньше жило в localStorage и терялось при очистке данных сайта.
 *
 * Оплата: сюда ещё не подключена ни одна касса (см. TODO ниже) — заказ
 * создаётся в статусе 'pending' и остаётся в нём, пока markOrderPaid()
 * не будет вызван настоящим подтверждением платежа. Функция готова:
 * подключить кассу — значит только вызвать её из вебхука/колбэка кассы,
 * ничего в этом файле для этого менять не нужно.
 */
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { wallet } from './wallet.mjs';
import { logSecurityEvent } from './adminsec.mjs';

const MIN_AMOUNT = 10;
const MAX_AMOUNT = 500_000;

export const ensureSession = async (sessionId) => {
  const id = sessionId && /^[a-z0-9-]{20,80}$/i.test(sessionId) ? sessionId : `krs-${generateId()}`;
  await query(
    `INSERT INTO kutrent_sessions (id) VALUES ($1)
       ON CONFLICT (id) DO UPDATE SET last_seen = now()`,
    [id],
  );
  return id;
};

/**
 * Ищет получателя по нику — только то, что и так видно всем в Sky
 * (ник и имя), без почты/телефона/баланса. Блокированный Sky ID как
 * получатель не годится: пополнять его баланс нет смысла и не должно
 * быть возможности.
 */
export const findRecipient = async (username) => {
  const clean = String(username ?? '').trim().replace(/^@/, '');
  if (!clean || clean.length > 32) return null;

  const { rows } = await query(
    `SELECT p.id, p.name, p.username, s.blocked_until
       FROM profiles p JOIN sky_ids s ON s.id = p.sky_id
      WHERE lower(p.username) = lower($1)`,
    [clean],
  );
  const row = rows[0];
  if (!row) return { found: false };
  if (row.blocked_until && new Date(row.blocked_until) > new Date()) return { found: false };
  return { found: true, id: row.id, username: row.username, name: row.name };
};

export const createSkyTopupOrder = async (sessionId, { amountRub, recipientUsername }) => {
  const amount = Math.trunc(Number(amountRub));
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return { error: 'invalid_amount' };
  }
  const recipient = await findRecipient(recipientUsername);
  if (!recipient?.found) return { error: 'recipient_not_found' };

  const id = `krm-${generateId()}`;
  await query(
    `INSERT INTO kutrent_market_orders
       (id, session_id, kind, amount_rub, sky_recipient_username, sky_recipient_profile_id)
     VALUES ($1,$2,'sky_topup',$3,$4,$5)`,
    [id, sessionId, amount, recipient.username, recipient.id],
  );
  return { ok: true, order: await getOrder(sessionId, id) };
};

export const getOrder = async (sessionId, orderId) => {
  const { rows } = await query(
    `SELECT * FROM kutrent_market_orders WHERE id = $1 AND session_id = $2`,
    [orderId, sessionId],
  );
  return rows[0] ? toView(rows[0]) : null;
};

export const listOrders = async (sessionId, limit = 50) => {
  const { rows } = await query(
    `SELECT * FROM kutrent_market_orders WHERE session_id = $1
      ORDER BY created_at DESC LIMIT $2`,
    [sessionId, limit],
  );
  return rows.map(toView);
};

const toView = (r) => ({
  id: r.id, kind: r.kind, amount: Number(r.amount_rub), status: r.status,
  recipientUsername: r.sky_recipient_username,
  createdAt: r.created_at.toISOString(),
  paidAt: r.paid_at ? r.paid_at.toISOString() : null,
});

/**
 * Настоящее подтверждение оплаты — единственная точка входа для любой
 * кассы (сейчас не подключена ни одна, см. шапку файла). Идемпотентно:
 * гонка из нескольких одновременных вебхуков по одному заказу зачислит
 * баланс ровно один раз — тем же приёмом, что и везде в Sky: один
 * guard-UPDATE со сменой статуса, дальше уже не пройти второй раз.
 */
export const markOrderPaid = async (orderId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE kutrent_market_orders SET status = 'paid', paid_at = now()
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [orderId],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      const { rows: existing } = await query('SELECT status FROM kutrent_market_orders WHERE id = $1', [orderId]);
      if (!existing[0]) return { error: 'not_found' };
      return { error: existing[0].status === 'paid' ? 'already_paid' : 'not_pending' };
    }
    await client.query('COMMIT');

    const order = rows[0];
    const credit = await wallet.credit(
      order.sky_recipient_profile_id, Number(order.amount_rub), 'external_topup',
      `Пополнение через KutRent Market (@${order.sky_recipient_username})`, order.id,
    );
    await logSecurityEvent(null, 'partner_topup', `KutRent Market ${order.id} → @${order.sky_recipient_username}: ${order.amount_rub} ₽`);
    return { ok: true, order: toView(order), balance: credit.balance };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Ручное подтверждение, пока не подключена ни одна касса. Только для
 * тестирования сотрудником с доступом к серверу (см. проверку в
 * routes/kutrentmarket.mjs) — не для посетителей сайта, иначе любой
 * мог бы «оплатить» себе заказ без реальных денег.
 */
export const adminMarkPaid = markOrderPaid;
