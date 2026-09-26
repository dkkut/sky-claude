/**
 * Обычные подарки Sky Gifts (не NFT): каталог, версии медиа, заказ и
 * доставка.
 *
 * Заказ идёт тем же хол-пэй-ишью, что и билеты (server/ticketorders.mjs):
 * идемпотентность по ключу клиента, цена — только из своей таблицы,
 * списание — через кошелёк одной операцией, доставка — уже существующим
 * мессенджером. Второго мессенджера здесь нет: доставка обычного
 * подарка в чат — это обычное сообщение kind:'gift', которое создаёт
 * server/chats.mjs, и рассылает его тот же WebSocket-хаб.
 *
 * Сообщение несёт только непроверяемый клиентом идентификатор доставки
 * (giftInstanceId) — не цену, не картинку, не имя отправителя. Всё
 * остальное пузырь в чате получает отдельным запросом к getInstance,
 * который сверяет, что спрашивает участник этой самой доставки.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { wallet } from './wallet.mjs';
import { getPrivacy } from './privacy.mjs';
import { saveMessage, createChat, directChatId, memberIds } from './chats.mjs';
import { pushNewMessage } from './signal.mjs';
import { notifyGift } from './giftnotify.mjs';
import { remove as removeMediaFile, listStoredIds } from './giftstore.mjs';

export const GIFT_ID_RE = /^gc-[0-9a-f-]{36}$/;
export const MEDIA_ID_RE = /^gfm-[0-9a-f-]{36}$/;
export const INSTANCE_ID_RE = /^gi-[0-9a-f-]{36}$/;

/* ─── Каталог ──────────────────────────────────────────────────────── */

const toCatalogItem = (r) => ({
  id: r.id, name: r.name, description: r.description, emoji: r.emoji,
  pricePoints: Number(r.price_points), gradient: r.gradient,
  mediaId: r.media_id, thumbMediaId: r.thumb_media_id,
  // 'image' | 'video' | 'animation' | null — клиенту нужно знать это,
  // чтобы решить, рисовать <img> или <video> (см. gift_media.kind).
  mediaKind: r.media_kind ?? null, thumbKind: r.thumb_kind ?? null,
  rarity: r.rarity, seasonal: r.seasonal, active: r.active,
  sortOrder: r.sort_order,
});

const CATALOG_SELECT = `
  SELECT c.*, mm.kind AS media_kind, tm.kind AS thumb_kind
    FROM gift_catalog c
    LEFT JOIN gift_media mm ON mm.id = c.media_id
    LEFT JOIN gift_media tm ON tm.id = c.thumb_media_id`;

/** Каталог для витрины — только активные подарки. */
export const listCatalog = async () => {
  const { rows } = await query(
    `${CATALOG_SELECT} WHERE c.active ORDER BY c.sort_order ASC, c.created_at ASC`,
  );
  return rows.map(toCatalogItem);
};

/** Каталог для админки — включая выключенные. */
export const adminListCatalog = async () => {
  const { rows } = await query(`${CATALOG_SELECT} ORDER BY c.sort_order ASC, c.created_at ASC`);
  return rows.map(toCatalogItem);
};

const readCatalogItem = async (id) => {
  if (!GIFT_ID_RE.test(String(id ?? ''))) return null;
  const { rows } = await query(`${CATALOG_SELECT} WHERE c.id = $1`, [id]);
  return rows[0] ? toCatalogItem(rows[0]) : null;
};
export { readCatalogItem as getCatalogItem };

export const createGift = async (data) => {
  const id = `gc-${generateId()}`;
  const name = String(data?.name ?? '').trim().slice(0, 80);
  if (!name) return { error: 'invalid_name' };
  const price = Math.trunc(Number(data?.pricePoints));
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) return { error: 'invalid_price' };
  const { rows } = await query(
    `INSERT INTO gift_catalog (id, name, description, emoji, price_points, gradient, rarity, seasonal, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, name, String(data?.description ?? '').slice(0, 500), String(data?.emoji ?? '🎁').slice(0, 8),
     price, String(data?.gradient ?? '').slice(0, 120), String(data?.rarity ?? 'common').slice(0, 24),
     data?.seasonal === true, Math.trunc(Number(data?.sortOrder ?? 0)) || 0],
  );
  return toCatalogItem(rows[0]);
};

export const updateGift = async (id, patch) => {
  const cur = await readCatalogItem(id);
  if (!cur) return { error: 'not_found' };
  const fields = [];
  const values = [];
  let i = 1;
  const set = (col, val) => { fields.push(`${col} = $${i}`); values.push(val); i += 1; };
  if (patch.name !== undefined) set('name', String(patch.name).trim().slice(0, 80));
  if (patch.description !== undefined) set('description', String(patch.description).slice(0, 500));
  if (patch.emoji !== undefined) set('emoji', String(patch.emoji).slice(0, 8));
  if (patch.pricePoints !== undefined) {
    const price = Math.trunc(Number(patch.pricePoints));
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) return { error: 'invalid_price' };
    set('price_points', price);
  }
  if (patch.gradient !== undefined) set('gradient', String(patch.gradient).slice(0, 120));
  if (patch.rarity !== undefined) set('rarity', String(patch.rarity).slice(0, 24));
  if (patch.seasonal !== undefined) set('seasonal', patch.seasonal === true);
  if (patch.sortOrder !== undefined) set('sort_order', Math.trunc(Number(patch.sortOrder)) || 0);
  if (!fields.length) return cur;
  values.push(id);
  const { rows } = await query(
    `UPDATE gift_catalog SET ${fields.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
    values,
  );
  return toCatalogItem(rows[0]);
};

export const setGiftActive = async (id, on) => {
  const { rows } = await query(
    `UPDATE gift_catalog SET active = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, on !== false],
  );
  return rows[0] ? toCatalogItem(rows[0]) : { error: 'not_found' };
};

/**
 * Регистрирует новую версию медиа и переключает на неё каталожную
 * запись. Старая версия НЕ удаляется — на неё могут ссылаться уже
 * отправленные подарки; её подметает отдельная уборка неиспользуемых
 * версий (см. server/server.mjs).
 */
/**
 * Регистрирует УЖЕ сохранённый на диске файл (mediaId выдаёт вызывающий
 * до записи потока — см. server/routes/gifts.mjs) и переключает на
 * него каталожную запись. Порядок обязателен: сперва файл цел на
 * диске, потом о нём узнаёт база — иначе при обрыве загрузки каталог
 * указывал бы на несуществующую версию.
 */
export const registerGiftMedia = async (giftId, mediaId, role, kind, mime, byteSize, actorId) => {
  const cur = await readCatalogItem(giftId);
  if (!cur) return { error: 'not_found' };
  await query(
    `INSERT INTO gift_media (id, owner_type, owner_id, role, kind, mime, byte_size, created_by)
     VALUES ($1,'gift_catalog',$2,$3,$4,$5,$6,$7)`,
    [mediaId, giftId, role, kind, mime, byteSize, actorId ?? null],
  );
  const column = role === 'thumbnail' ? 'thumb_media_id' : 'media_id';
  await query(`UPDATE gift_catalog SET ${column} = $2, updated_at = now() WHERE id = $1`, [giftId, mediaId]);
  return { mediaId };
};

export const mediaMime = async (mediaId) => {
  if (!MEDIA_ID_RE.test(String(mediaId ?? ''))) return null;
  const { rows } = await query('SELECT mime FROM gift_media WHERE id = $1', [mediaId]);
  return rows[0]?.mime ?? null;
};

/**
 * Медиа карточки Prime — своя маленькая витрина внутри gift_media
 * (owner_type='prime_card', owner_id=тема), без отдельной таблицы: у
 * карточки нет собственного каталога-сущности, только восемь готовых
 * тем оформления. «Текущая» версия — просто самая свежая строка по
 * этой теме и роли; ничего не переключаем отдельным указателем.
 */
export const registerPrimeCardMedia = async (themeId, mediaId, role, kind, mime, byteSize, actorId) => {
  await query(
    `INSERT INTO gift_media (id, owner_type, owner_id, role, kind, mime, byte_size, created_by)
     VALUES ($1,'prime_card',$2,$3,$4,$5,$6,$7)`,
    [mediaId, String(themeId).slice(0, 24), role, kind, mime, byteSize, actorId ?? null],
  );
  return { mediaId };
};

export const currentPrimeCardMedia = async (themeId) => {
  const { rows } = await query(
    `SELECT DISTINCT ON (role) id, role FROM gift_media
      WHERE owner_type = 'prime_card' AND owner_id = $1
      ORDER BY role, created_at DESC`,
    [String(themeId).slice(0, 24)],
  );
  const out = { mediaId: null, thumbMediaId: null };
  for (const r of rows) {
    if (r.role === 'main') out.mediaId = r.id;
    if (r.role === 'thumbnail') out.thumbMediaId = r.id;
  }
  return out;
};

/** Медиа, на которые больше не ссылается ни каталог, ни одна уже отправленная доставка. */
export const orphanMediaIds = async (candidateIds) => {
  if (!candidateIds.length) return [];
  const { rows } = await query(
    `SELECT id FROM gift_media m
      WHERE m.id = ANY($1::text[])
        AND NOT EXISTS (SELECT 1 FROM gift_catalog c WHERE c.media_id = m.id OR c.thumb_media_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM gift_instances i WHERE i.media_id = m.id OR i.thumb_media_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM prime_gift_instances p WHERE p.media_id = m.id OR p.thumb_media_id = m.id)
        AND m.created_at < now() - interval '1 hour'`,
    [candidateIds],
  );
  return rows.map((r) => r.id);
};

/* ─── Заказ и доставка ─────────────────────────────────────────────── */

const errCode = (error) => (
  error === 'not_found' ? 404
    : error === 'recipient_not_found' ? 404
      : error === 'not_allowed' || error === 'not_accepting' ? 403
        : error === 'insufficient_points' ? 402
          : error === 'already_cancelled' ? 409
            : 400
);
export { errCode };

/**
 * Отправка обычного подарка. target='chat' кладёт настоящее сообщение
 * в переписку (существующим мессенджером); target='profile' сохраняет
 * подарок сразу в профиль без сообщения — как и раньше умела
 * SkyGifts.tsx.
 */
export const sendGift = async (senderId, opts) => {
  const idemKey = String(opts?.idemKey ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (idemKey.length < 8) return { error: 'idem_key_required' };
  const recipientId = String(opts?.recipientId ?? '');
  const target = opts?.target === 'profile' ? 'profile' : 'chat';
  if (!recipientId) return { error: 'invalid_recipient' };
  // Подарок в чат самому себе не имеет смысла (и это была бы дыра —
  // сообщение в несуществующий личный чат с собой); подарок себе в
  // профиль — обычная покупка в витрине (GiftMarket), это законно.
  if (target === 'chat' && recipientId === senderId) return { error: 'invalid_recipient' };
  const giftCatalogId = String(opts?.giftCatalogId ?? '');
  const message = String(opts?.message ?? '').slice(0, 300);

  const item = await readCatalogItem(giftCatalogId);
  if (!item || !item.active) return { error: 'not_found' };

  const { rows: rp } = await query('SELECT id, name FROM profiles WHERE id = $1', [recipientId]);
  if (!rp[0]) return { error: 'recipient_not_found' };

  let chatId = null;
  if (target === 'chat') {
    chatId = directChatId(senderId, recipientId);
    const chat = await createChat({ type: 'direct', id: chatId, participants: [recipientId] }, senderId);
    if (chat?.error) return { error: chat.error };
    if (!chat) return { error: 'chat_unavailable' };
  }

  // Блокировка по (покупатель, ключ идемпотентности) сериализует все
  // одновременные повторы одной и той же попытки отправки: второй
  // запрос ждёт, пока первый полностью завершится (спишет деньги,
  // создаст доставку), и только потом читает уже готовый результат —
  // без этого два параллельных повтора могли бы оба списать деньги и
  // разойтись в том, какой из них выдал подарок.
  const lockClient = await pool.connect();
  try {
    await lockClient.query('BEGIN');
    await lockClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gift-order:${senderId}:${idemKey}`]);
    const result = await sendGiftLocked(senderId, { recipientId, target, giftCatalogId, message, idemKey, chatId, item });
    await lockClient.query('COMMIT');
    return result;
  } catch (err) {
    await lockClient.query('ROLLBACK');
    throw err;
  } finally {
    lockClient.release();
  }
};

const sendGiftLocked = async (senderId, { recipientId, target, giftCatalogId, message, idemKey, chatId, item }) => {
  const orderId = `go-${generateId()}`;
  const { rows: ins } = await query(
    `INSERT INTO gift_orders (id, idem_key, buyer_id, kind, gift_catalog_id, recipient_id, target, chat_id, message, price, currency)
     VALUES ($1,$2,$3,'gift',$4,$5,$6,$7,$8,$9,'points')
     ON CONFLICT (buyer_id, idem_key) DO NOTHING
     RETURNING id`,
    [orderId, idemKey, senderId, giftCatalogId, recipientId, target, chatId, message, item.pricePoints],
  );

  let realOrderId = ins[0]?.id ?? null;
  if (!realOrderId) {
    // Повтор того же запроса (тот же ключ идемпотентности): не создаём
    // второй заказ, а возвращаем судьбу первого.
    const { rows: existing } = await query(
      'SELECT id, status FROM gift_orders WHERE buyer_id = $1 AND idem_key = $2',
      [senderId, idemKey],
    );
    if (!existing[0]) return { error: 'conflict' };
    realOrderId = existing[0].id;
    if (existing[0].status === 'paid') {
      const { rows: existingInstance } = await query('SELECT id FROM gift_instances WHERE order_id = $1', [realOrderId]);
      return { ok: true, orderId: realOrderId, instanceId: existingInstance[0]?.id, replay: true };
    }
    if (existing[0].status !== 'awaiting_payment') return { error: existing[0].status };
  }

  const paid = await wallet.spendPoints(senderId, item.pricePoints, `Подарок «${item.name}»`, realOrderId);
  if (paid.error) {
    await query(`UPDATE gift_orders SET status = 'failed' WHERE id = $1 AND status = 'awaiting_payment'`, [realOrderId]);
    return paid;
  }

  const { rowCount } = await query(
    `UPDATE gift_orders SET status = 'paid', paid_at = now() WHERE id = $1 AND status = 'awaiting_payment'`,
    [realOrderId],
  );
  if (rowCount === 0) {
    // Кто-то другой уже провёл выдачу этого заказа (параллельный повтор
    // того же ключа) — деньги вернуть, вторую выдачу не делать.
    await wallet.refund(senderId, item.pricePoints, 'Возврат — заказ уже выдан', realOrderId);
    const { rows: existingInstance } = await query('SELECT id FROM gift_instances WHERE order_id = $1', [realOrderId]);
    return { ok: true, orderId: realOrderId, instanceId: existingInstance[0]?.id, replay: true };
  }

  try {
    const instanceId = `gi-${generateId()}`;
    let messageId = null;
    let savedMessage = null;
    if (target === 'chat') {
      const msgId = generateId();
      savedMessage = await saveMessage(chatId, senderId, {
        id: msgId, kind: 'gift', text: `🎁 ${item.name}`, giftInstanceId: instanceId,
      });
      if (!savedMessage || savedMessage.error) throw new Error(savedMessage?.error ?? 'send_failed');
      messageId = savedMessage.id;
    }

    await query(
      `INSERT INTO gift_instances (id, order_id, gift_catalog_id, media_id, thumb_media_id, sender_id, recipient_id, chat_id, message_id, caption, saved_to_profile)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [instanceId, realOrderId, giftCatalogId, item.mediaId, item.thumbMediaId, senderId, recipientId, chatId, messageId, message, target === 'profile'],
    );

    if (target === 'chat') {
      pushNewMessage(await memberIds(chatId), chatId, savedMessage);
    } else {
      await notifyGift(recipientId, 'gift', '🎁 Вам подарок!', `Вам подарили «${item.name}»`, instanceId);
    }

    return { ok: true, orderId: realOrderId, instanceId };
  } catch (err) {
    // Возврат баллами, а не деньгами: списание было в баллах
    // (wallet.spendPoints выше), значит и возврат должен идти туда же —
    // wallet.refund трогает только денежный баланс.
    await wallet.earnPoints(senderId, item.pricePoints, 'Возврат — не удалось доставить подарок');
    await query(`UPDATE gift_orders SET status = 'refunded' WHERE id = $1`, [realOrderId]);
    throw err;
  }
};

export const CANCEL_WINDOW = '3 hours';

/**
 * Отмена отправленного обычного подарка — только отправитель, только в
 * течение 3 часов с момента доставки (created_at, серверное время;
 * клиент это время не присылает и повлиять на него не может).
 *
 * Условный UPDATE — тот же приём, что у activatePrimeGift: гонка между
 * несколькими одновременными попытками отмены (или отменой и, например,
 * повторным сохранением в профиль) решается тем, что до перехода
 * status='delivered'→'cancelled' доходит только один запрос — это
 * атомарность одной SQL-команды, отдельная блокировка строки не нужна.
 */
export const cancelGiftInstance = async (senderId, instanceId) => {
  if (!INSTANCE_ID_RE.test(String(instanceId ?? ''))) return { error: 'not_found' };

  const { rows: flip } = await query(
    `UPDATE gift_instances SET status = 'cancelled', cancelled_at = now()
      WHERE id = $1 AND sender_id = $2 AND status = 'delivered'
        AND created_at > now() - interval '${CANCEL_WINDOW}'
      RETURNING *`,
    [instanceId, senderId],
  );

  if (!flip[0]) {
    const { rows: cur } = await query(
      'SELECT sender_id, status, created_at FROM gift_instances WHERE id = $1', [instanceId],
    );
    if (!cur[0]) return { error: 'not_found' };
    if (cur[0].sender_id !== senderId) return { error: 'not_allowed' };
    if (cur[0].status === 'cancelled') return { error: 'already_cancelled' };
    return { error: 'window_expired' };
  }
  const instance = flip[0];

  const { rows: ord } = await query(
    `UPDATE gift_orders SET status = 'refunded' WHERE id = $1 AND status = 'paid' RETURNING price`,
    [instance.order_id],
  );
  // Заказ уже мог быть переведён в 'refunded' раньше (не должно
  // случиться при живой доставке, но на всякий случай не списываем
  // баллы второй раз, если строки заказа UPDATE не коснулся).
  if (ord[0]) {
    await wallet.earnPoints(senderId, ord[0].price, `Возврат — отменён подарок «${instance.gift_catalog_id}»`);
  }

  await notifyGift(instance.recipient_id, 'gift_cancelled', 'Подарок отменён',
    'Отправитель отменил отправку подарка', instanceId);

  const { rows: full } = await query(`${INSTANCE_SELECT} WHERE i.id = $1`, [instanceId]);
  return { ok: true, instance: toInstanceView(full[0]) };
};

/**
 * Архив — по каждой стороне отдельно: отправитель и получатель видят
 * одну и ту же доставку каждый в своём списке и должны уметь убрать её
 * из СВОЕГО списка независимо. Логическое состояние — строка никогда
 * не удаляется и продолжает нести media/историю/статус.
 */
export const archiveGiftInstance = async (userId, instanceId, archived) => {
  if (!INSTANCE_ID_RE.test(String(instanceId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT sender_id, recipient_id FROM gift_instances WHERE id = $1', [instanceId]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.sender_id !== userId && row.recipient_id !== userId) return { error: 'not_allowed' };

  const setSender = row.sender_id === userId;
  const setRecipient = row.recipient_id === userId;
  const value = archived ? new Date() : null;
  await query(
    `UPDATE gift_instances SET
       archived_by_sender_at = CASE WHEN $2 THEN $4 ELSE archived_by_sender_at END,
       archived_by_recipient_at = CASE WHEN $3 THEN $4 ELSE archived_by_recipient_at END
     WHERE id = $1`,
    [instanceId, setSender, setRecipient, value],
  );
  return { ok: true };
};

/** Сохранить уже полученный в чате подарок в свой профиль. */
export const saveInstanceToProfile = async (userId, instanceId) => {
  const { rows } = await query(
    `UPDATE gift_instances SET saved_to_profile = TRUE
      WHERE id = $1 AND recipient_id = $2 AND status != 'cancelled' RETURNING id`,
    [instanceId, userId],
  );
  return rows[0] ? { ok: true } : { error: 'not_found' };
};

const toInstanceView = (r) => ({
  id: r.id, giftCatalogId: r.gift_catalog_id, name: r.name, emoji: r.emoji, gradient: r.gradient,
  rarity: r.rarity, mediaId: r.media_id, thumbMediaId: r.thumb_media_id,
  senderId: r.sender_id, senderName: r.sender_name, recipientId: r.recipient_id, recipientName: r.recipient_name,
  chatId: r.chat_id, caption: r.caption,
  savedToProfile: r.saved_to_profile, createdAt: r.created_at.toISOString(),
  mediaKind: r.media_kind ?? null, thumbKind: r.thumb_kind ?? null,
  status: r.status,
  cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : null,
  // Крайний срок отмены считается на сервере из created_at — клиент
  // получает готовую дату, а не сырой sent_at, чтобы не пересчитывать
  // окно на своих часах.
  cancelDeadline: new Date(r.created_at.getTime() + 3 * 60 * 60 * 1000).toISOString(),
  archivedBySender: Boolean(r.archived_by_sender_at),
  archivedByRecipient: Boolean(r.archived_by_recipient_at),
});

const INSTANCE_SELECT = `
  SELECT i.*, c.name, c.emoji, c.gradient, c.rarity, sp.name AS sender_name, rp.name AS recipient_name,
         mm.kind AS media_kind, tm.kind AS thumb_kind
    FROM gift_instances i
    JOIN gift_catalog c ON c.id = i.gift_catalog_id
    JOIN profiles sp ON sp.id = i.sender_id
    JOIN profiles rp ON rp.id = i.recipient_id
    LEFT JOIN gift_media mm ON mm.id = i.media_id
    LEFT JOIN gift_media tm ON tm.id = i.thumb_media_id`;

/** Экземпляр подарка — только его отправитель или получатель. */
export const getInstance = async (viewerId, instanceId) => {
  const { rows } = await query(`${INSTANCE_SELECT} WHERE i.id = $1`, [instanceId]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.sender_id !== viewerId && row.recipient_id !== viewerId) return { error: 'not_allowed' };
  return toInstanceView(row);
};

/**
 * Активный список получателя: отменённый подарок для него больше не
 * действует (пункт задачи «подарок больше не считается активным у
 * получателя»), архивированный — убран получателем в архив. У
 * отправителя своя, независимая точка зрения — см. sentGifts.
 */
export const receivedGifts = async (userId) => {
  const { rows } = await query(
    `${INSTANCE_SELECT} WHERE i.recipient_id = $1 AND i.status != 'cancelled' AND i.archived_by_recipient_at IS NULL
      ORDER BY i.created_at DESC`,
    [userId],
  );
  return rows.map(toInstanceView);
};

export const archivedReceivedGifts = async (userId) => {
  const { rows } = await query(
    `${INSTANCE_SELECT} WHERE i.recipient_id = $1 AND i.archived_by_recipient_at IS NOT NULL
      ORDER BY i.archived_by_recipient_at DESC`,
    [userId],
  );
  return rows.map(toInstanceView);
};

export const profileGifts = async (userId) => {
  const { rows } = await query(
    `${INSTANCE_SELECT} WHERE i.recipient_id = $1 AND i.saved_to_profile
       AND i.status != 'cancelled' AND i.archived_by_recipient_at IS NULL
      ORDER BY i.created_at DESC`,
    [userId],
  );
  return rows.map(toInstanceView);
};

/**
 * Список отправителя — своя собственная история действий: отменённый
 * подарок в ней остаётся (это отправитель сам его отменил, прятать
 * нечего), убирает из активного списка только архив.
 */
export const sentGifts = async (userId) => {
  const { rows } = await query(
    `${INSTANCE_SELECT} WHERE i.sender_id = $1 AND i.archived_by_sender_at IS NULL ORDER BY i.created_at DESC`,
    [userId],
  );
  return rows.map(toInstanceView);
};

export const archivedSentGifts = async (userId) => {
  const { rows } = await query(
    `${INSTANCE_SELECT} WHERE i.sender_id = $1 AND i.archived_by_sender_at IS NOT NULL
      ORDER BY i.archived_by_sender_at DESC`,
    [userId],
  );
  return rows.map(toInstanceView);
};

/** Публичная витрина подарков профиля — с той же приватностью, что и остальной профиль. */
export const publicProfileGifts = async (viewerId, targetId) => {
  if (viewerId !== targetId) {
    const priv = await getPrivacy(targetId);
    if (priv.profileVisibility?.showGifts === false) return { hidden: true, items: [] };
  }
  return { hidden: false, items: await profileGifts(targetId) };
};

/**
 * Уборка версий медиа, на которые больше никто не ссылается: старше
 * часа (свежая версия могла секунду назад стать текущей у заказа,
 * который ещё не успел записаться) и не видна ни в каталоге, ни в
 * одном уже отправленном подарке.
 */
export const sweepOrphanGiftMedia = async () => {
  const stored = await listStoredIds();
  if (!stored.length) return { removed: 0 };
  const orphans = await orphanMediaIds(stored);
  for (const id of orphans) {
    await removeMediaFile(id);
    await query('DELETE FROM gift_media WHERE id = $1', [id]);
  }
  return { removed: orphans.length };
};
