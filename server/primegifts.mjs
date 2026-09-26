/**
 * Подарок Sky Prime — заказ, доставка карточкой в мессенджер и
 * атомарная получение (активация).
 *
 * Устройство заказа то же, что у обычного подарка (gifts.mjs) и у
 * билетов (ticketorders.mjs): хол-пэй-ишью с идемпотентностью по
 * ключу клиента, цена — только из PRIME_PRICES на сервере (skyid.mjs),
 * оплата — списанием с кошелька покупателя, а не webhook'ом: своего
 * платёжного шлюза у проекта нет, и wallet.spend — уже вся «оплата»,
 * которая существует.
 *
 * Получение подписки получателем — отдельный шаг (клик «Получить
 * Prime» по карточке), а не автоматика при доставке: до этого клика
 * подписка получателю не выдана, только предложена. Активация —
 * условный UPDATE (`WHERE status = 'new'`), поэтому сколько бы раз
 * подряд ни продублировался клик, Prime выдаётся ровно один раз.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { wallet } from './wallet.mjs';
import { grantPrime, PRIME_PRICES } from './skyid.mjs';
import { saveMessage, createChat, directChatId, memberIds } from './chats.mjs';
import { pushNewMessage } from './signal.mjs';
import { notifyGift } from './giftnotify.mjs';
import { currentPrimeCardMedia, CANCEL_WINDOW } from './gifts.mjs';

export const PRIME_GIFT_ID_RE = /^pgi-[0-9a-f-]{36}$/;

export const primePriceTiers = () => Object.entries(PRIME_PRICES)
  .map(([days, price]) => ({ days: Number(days), price }))
  .sort((a, b) => a.days - b.days);

const errCode = (error) => (
  error === 'not_found' ? 404
    : error === 'recipient_not_found' ? 404
      : error === 'not_allowed' ? 403
        : error === 'insufficient_funds' ? 402
          : error === 'already_activated' || error === 'unavailable' || error === 'already_cancelled' ? 409
            : 400
);
export { errCode };

/**
 * Отправка подарка Prime. Всегда идёт карточкой в личный чат: смысл
 * подарка — предложение получить подписку, и предлагать его нужно
 * там, где получатель это увидит и сможет нажать «Получить».
 */
export const sendPrimeGift = async (senderId, opts) => {
  const idemKey = String(opts?.idemKey ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (idemKey.length < 8) return { error: 'idem_key_required' };
  const recipientId = String(opts?.recipientId ?? '');
  if (!recipientId || recipientId === senderId) return { error: 'invalid_recipient' };
  const days = Number(opts?.days);
  const price = PRIME_PRICES[days];
  if (!price) return { error: 'invalid_plan' };
  const theme = String(opts?.theme ?? 'aurora').slice(0, 24);
  const message = String(opts?.message ?? '').slice(0, 300);

  const { rows: rp } = await query('SELECT id, name FROM profiles WHERE id = $1', [recipientId]);
  if (!rp[0]) return { error: 'recipient_not_found' };

  const chatId = directChatId(senderId, recipientId);
  const chat = await createChat({ type: 'direct', id: chatId, participants: [recipientId] }, senderId);
  if (chat?.error) return { error: chat.error };
  if (!chat) return { error: 'chat_unavailable' };

  // Та же блокировка по (покупатель, ключ идемпотентности), что и у
  // обычного подарка (gifts.mjs) — и по той же причине: без неё два
  // одновременных повтора одного клика могли бы оба списать деньги.
  const lockClient = await pool.connect();
  try {
    await lockClient.query('BEGIN');
    await lockClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`prime-gift-order:${senderId}:${idemKey}`]);
    const result = await sendPrimeGiftLocked(senderId, { recipientId, days, price, theme, message, idemKey, chatId });
    await lockClient.query('COMMIT');
    return result;
  } catch (err) {
    await lockClient.query('ROLLBACK');
    throw err;
  } finally {
    lockClient.release();
  }
};

const sendPrimeGiftLocked = async (senderId, { recipientId, days, price, theme, message, idemKey, chatId }) => {
  const orderId = `go-${generateId()}`;
  const { rows: ins } = await query(
    `INSERT INTO gift_orders (id, idem_key, buyer_id, kind, recipient_id, target, chat_id, message, price, currency, prime_days, prime_theme)
     VALUES ($1,$2,$3,'prime',$4,'chat',$5,$6,$7,'money',$8,$9)
     ON CONFLICT (buyer_id, idem_key) DO NOTHING
     RETURNING id`,
    [orderId, idemKey, senderId, recipientId, chatId, message, price, days, theme],
  );

  let realOrderId = ins[0]?.id ?? null;
  if (!realOrderId) {
    const { rows: existing } = await query(
      'SELECT id, status FROM gift_orders WHERE buyer_id = $1 AND idem_key = $2',
      [senderId, idemKey],
    );
    if (!existing[0]) return { error: 'conflict' };
    realOrderId = existing[0].id;
    if (existing[0].status === 'paid') {
      const { rows: pgi } = await query('SELECT id FROM prime_gift_instances WHERE order_id = $1', [realOrderId]);
      return { ok: true, orderId: realOrderId, instanceId: pgi[0]?.id, replay: true };
    }
    if (existing[0].status !== 'awaiting_payment') return { error: existing[0].status };
  }

  const paid = await wallet.spend(senderId, price, 'prime_gift', `Подарок Prime · ${days} дн.`, realOrderId);
  if (paid.error) {
    await query(`UPDATE gift_orders SET status = 'failed' WHERE id = $1 AND status = 'awaiting_payment'`, [realOrderId]);
    return paid;
  }

  const { rowCount } = await query(
    `UPDATE gift_orders SET status = 'paid', paid_at = now() WHERE id = $1 AND status = 'awaiting_payment'`,
    [realOrderId],
  );
  if (rowCount === 0) {
    await wallet.refund(senderId, price, 'Возврат — заказ уже выдан', realOrderId);
    const { rows: pgi } = await query('SELECT id FROM prime_gift_instances WHERE order_id = $1', [realOrderId]);
    return { ok: true, orderId: realOrderId, instanceId: pgi[0]?.id, replay: true };
  }

  try {
    const instanceId = `pgi-${generateId()}`;
    const msgId = generateId();
    const saved = await saveMessage(chatId, senderId, {
      id: msgId, kind: 'prime_gift', text: `✨ Подарок Prime · ${days} дн.`, primeGiftInstanceId: instanceId,
    });
    if (!saved || saved.error) throw new Error(saved?.error ?? 'send_failed');

    // Медиа темы фиксируется версией на момент отправки — если админ
    // потом заменит картинку/видео темы, уже подаренная карточка не
    // перерисуется задним числом.
    const media = await currentPrimeCardMedia(theme);

    await query(
      `INSERT INTO prime_gift_instances (id, order_id, sender_id, recipient_id, days, theme, media_id, thumb_media_id, message, chat_id, message_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [instanceId, realOrderId, senderId, recipientId, days, theme, media.mediaId, media.thumbMediaId, message, chatId, saved.id],
    );

    pushNewMessage(await memberIds(chatId), chatId, saved);
    return { ok: true, orderId: realOrderId, instanceId };
  } catch (err) {
    await wallet.refund(senderId, price, 'Возврат — не удалось доставить подарок Prime', realOrderId);
    await query(`UPDATE gift_orders SET status = 'refunded' WHERE id = $1`, [realOrderId]);
    throw err;
  }
};

const toView = (r) => ({
  id: r.id, senderId: r.sender_id, recipientId: r.recipient_id, days: r.days, theme: r.theme,
  mediaId: r.media_id, thumbMediaId: r.thumb_media_id,
  message: r.message, chatId: r.chat_id, status: r.status, unavailableReason: r.unavailable_reason,
  activatedAt: r.activated_at ? r.activated_at.toISOString() : null, createdAt: r.created_at.toISOString(),
  cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : null,
  cancelDeadline: new Date(r.created_at.getTime() + 3 * 60 * 60 * 1000).toISOString(),
  archivedBySender: Boolean(r.archived_by_sender_at),
  archivedByRecipient: Boolean(r.archived_by_recipient_at),
});

/** Карточка Prime — только её отправитель или получатель. */
export const getPrimeGiftInstance = async (viewerId, instanceId) => {
  const { rows } = await query('SELECT * FROM prime_gift_instances WHERE id = $1', [instanceId]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.sender_id !== viewerId && row.recipient_id !== viewerId) return { error: 'not_allowed' };
  return toView(row);
};

/**
 * Активация — единственный способ по-настоящему получить Prime из
 * подарка. Условный UPDATE `WHERE status = 'new'` — стражник гонки:
 * из скольких бы одновременных запросов ни состоял клик (двойной тап,
 * повтор сети), к выдаче Prime пройдёт только тот, что и переключит
 * строку первым; остальные получат `already_activated`.
 */
export const activatePrimeGift = async (userId, instanceId) => {
  const { rows: flip } = await query(
    `UPDATE prime_gift_instances SET status = 'activated', activated_at = now()
      WHERE id = $1 AND recipient_id = $2 AND status = 'new'
      RETURNING *`,
    [instanceId, userId],
  );
  if (!flip[0]) {
    const { rows: cur } = await query('SELECT recipient_id, status FROM prime_gift_instances WHERE id = $1', [instanceId]);
    if (!cur[0]) return { error: 'not_found' };
    if (cur[0].recipient_id !== userId) return { error: 'not_allowed' };
    return { error: cur[0].status === 'activated' ? 'already_activated' : 'unavailable' };
  }
  const row = flip[0];

  const { rows: rp } = await query('SELECT sky_id FROM profiles WHERE id = $1', [userId]);
  const skyId = rp[0]?.sky_id;
  if (!skyId) {
    await query(`UPDATE prime_gift_instances SET status = 'new', activated_at = NULL WHERE id = $1`, [instanceId]);
    return { error: 'not_found' };
  }

  // Дни прибавляются к тому, что уже есть, а не заменяют остаток —
  // ровно то, о чём просили: подарок не должен обнулить уже
  // оплаченную подписку получателя.
  const granted = await grantPrime(skyId, userId, 'standard', row.days, { additive: true });
  if (granted.error) {
    // Не удалось выдать — откатываем флажок, чтобы клик можно было
    // повторить: подарок не сгорает из-за временного сбоя.
    await query(`UPDATE prime_gift_instances SET status = 'new', activated_at = NULL WHERE id = $1`, [instanceId]);
    return { error: granted.error };
  }

  await notifyGift(row.sender_id, 'prime_gift_activated', '✨ Подарок Prime получен',
    `Получатель активировал ваш подарок Prime на ${row.days} дн.`, instanceId);

  return { ok: true, instance: toView({ ...row, status: 'activated', activated_at: new Date() }), profile: granted.profile };
};

export const mySentPrimeGifts = async (userId) => {
  const { rows } = await query(
    `SELECT * FROM prime_gift_instances WHERE sender_id = $1 AND archived_by_sender_at IS NULL ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(toView);
};

export const myReceivedPrimeGifts = async (userId) => {
  const { rows } = await query(
    `SELECT * FROM prime_gift_instances WHERE recipient_id = $1 AND archived_by_recipient_at IS NULL ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(toView);
};

export const archivedSentPrimeGifts = async (userId) => {
  const { rows } = await query(
    `SELECT * FROM prime_gift_instances WHERE sender_id = $1 AND archived_by_sender_at IS NOT NULL ORDER BY archived_by_sender_at DESC`,
    [userId],
  );
  return rows.map(toView);
};

export const archivedReceivedPrimeGifts = async (userId) => {
  const { rows } = await query(
    `SELECT * FROM prime_gift_instances WHERE recipient_id = $1 AND archived_by_recipient_at IS NOT NULL ORDER BY archived_by_recipient_at DESC`,
    [userId],
  );
  return rows.map(toView);
};

/**
 * Отмена отправленного подарка Prime — только отправитель, только пока
 * получатель ещё не нажал «Получить» (status='new') и только в
 * течение 3 часов с доставки. Тот же приём условного UPDATE, что и у
 * activatePrimeGift: если получатель активирует ровно в этот момент,
 * выиграет только один из двух конкурирующих UPDATE (оба бьют в одну
 * и ту же строку по одному и тому же условию status='new').
 */
export const cancelPrimeGiftInstance = async (senderId, instanceId) => {
  if (!PRIME_GIFT_ID_RE.test(String(instanceId ?? ''))) return { error: 'not_found' };

  const { rows: flip } = await query(
    `UPDATE prime_gift_instances SET status = 'unavailable', unavailable_reason = 'cancelled_by_sender', cancelled_at = now()
      WHERE id = $1 AND sender_id = $2 AND status = 'new'
        AND created_at > now() - interval '${CANCEL_WINDOW}'
      RETURNING *`,
    [instanceId, senderId],
  );

  if (!flip[0]) {
    const { rows: cur } = await query(
      'SELECT sender_id, status, created_at FROM prime_gift_instances WHERE id = $1', [instanceId],
    );
    if (!cur[0]) return { error: 'not_found' };
    if (cur[0].sender_id !== senderId) return { error: 'not_allowed' };
    if (cur[0].status === 'activated') return { error: 'already_activated' };
    if (cur[0].status === 'unavailable') return { error: 'already_cancelled' };
    return { error: 'window_expired' };
  }
  const instance = flip[0];

  const { rows: ord } = await query(
    `UPDATE gift_orders SET status = 'refunded' WHERE id = $1 AND status = 'paid' RETURNING price`,
    [instance.order_id],
  );
  if (ord[0]) {
    await wallet.refund(senderId, ord[0].price, 'Возврат — отменён подарок Prime', instance.order_id);
  }

  await notifyGift(instance.recipient_id, 'gift_cancelled', 'Подарок Prime отменён',
    'Отправитель отменил отправку подарка Prime', instanceId);

  return { ok: true, instance: toView(instance) };
};

/** Архив — по каждой стороне отдельно, как и у обычных подарков. */
export const archivePrimeGiftInstance = async (userId, instanceId, archived) => {
  if (!PRIME_GIFT_ID_RE.test(String(instanceId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT sender_id, recipient_id FROM prime_gift_instances WHERE id = $1', [instanceId]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.sender_id !== userId && row.recipient_id !== userId) return { error: 'not_allowed' };

  const setSender = row.sender_id === userId;
  const setRecipient = row.recipient_id === userId;
  const value = archived ? new Date() : null;
  await query(
    `UPDATE prime_gift_instances SET
       archived_by_sender_at = CASE WHEN $2 THEN $4 ELSE archived_by_sender_at END,
       archived_by_recipient_at = CASE WHEN $3 THEN $4 ELSE archived_by_recipient_at END
     WHERE id = $1`,
    [instanceId, setSender, setRecipient, value],
  );
  return { ok: true };
};
