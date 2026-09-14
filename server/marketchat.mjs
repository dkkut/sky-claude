/**
 * Чат сделки Sky Market.
 *
 * Это отдельная система, а не мессенджер. Написано это не для красоты
 * в комментарии, а буквально: здесь свои таблицы (market_chats,
 * market_messages), свои права и своя выдача. Ни одна строка отсюда не
 * попадает ни в chats, ни в messages, ни в список диалогов Sky
 * Messenger, и ни один запрос мессенджера сюда не заглядывает.
 *
 * Причина простая. Переписка по сделке живёт по правилам сделки: доступ
 * к ней есть у двух сторон заказа и у поддержки, она открывается вместе
 * с заказом и закрывается вместе с ним, и удалить её участник не может,
 * потому что это доказательство в возможном споре. У личной переписки
 * правила прямо противоположные. Смешать их — значит сломать оба набора
 * правил разом.
 *
 * Доступ решается по строке заказа, а не по тому, что прислал клиент:
 * chatId проверяется по образцу, стороны берутся из базы, и присланных
 * buyerId или sellerId здесь не читается.
 */
import { query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { logMarket, marketText as text, marketInt as int, CHAT_ID_RE, ORDER_ID_RE } from './market.mjs';
import { pushMarket } from './signal.mjs';

const MAX_MESSAGE = 4000;
const MAX_PER_PAGE = 100;

/**
 * Кто этот человек для этого чата.
 *
 * Поддержка попадает сюда как support и подписывается в переписке
 * именно так: в споре должно быть видно, что отвечает не вторая сторона.
 */
const roleInChat = async (chat, userId) => {
  if (!chat || !userId) return null;
  if (chat.buyer_id === userId) return 'buyer';
  if (chat.seller_id === userId) return 'seller';
  if (await can(userId, 'market')) return 'support';
  return null;
};

/**
 * Открыть чат с проверкой доступа.
 *
 * Постороннему — то же самое, что на несуществующий чат. Разница между
 * «нет такого» и «есть, но не твой» — это уже сведения о чужой сделке.
 */
export const accessChat = async (chatId, viewerId) => {
  const id = String(chatId ?? '');
  if (!CHAT_ID_RE.test(id)) return null;
  const { rows } = await query(
    `SELECT c.*, o.status AS order_status, o.market_type, o.title_snap
       FROM market_chats c JOIN market_orders o ON o.id = c.order_id
      WHERE c.id = $1`, [id]);
  const chat = rows[0];
  if (!chat) return null;
  const role = await roleInChat(chat, viewerId);
  if (!role) {
    await logMarket(viewerId, 'chat_access_denied', id);
    return null;
  }
  return { chat, role };
};

/** Чат по заказу — тем же правилам доступа. */
export const chatOfOrder = async (orderId, viewerId) => {
  const id = String(orderId ?? '');
  if (!ORDER_ID_RE.test(id)) return null;
  const { rows } = await query('SELECT id FROM market_chats WHERE order_id = $1', [id]);
  if (!rows[0]) return null;
  return accessChat(rows[0].id, viewerId);
};

const toChat = (chat, role, extra = {}) => ({
  id: chat.id,
  orderId: chat.order_id,
  role,
  orderStatus: chat.order_status,
  marketType: chat.market_type,
  title: chat.title_snap,
  createdAt: chat.created_at?.toISOString?.() ?? undefined,
  ...extra,
});

const toMessage = (row) => ({
  id: row.id,
  authorId: row.author_id,
  role: row.author_role,
  text: decryptContent(row.body_enc) ?? '',
  read: Boolean(row.read_at),
  createdAt: row.created_at?.toISOString?.() ?? undefined,
});

/**
 * Список чатов человека.
 *
 * Только чаты его сделок. Это не список диалогов: здесь нет ни друзей,
 * ни групп, ни переписки вне заказа, и попасть сюда чат может только
 * через заказ.
 */
export const listChats = async (userId, { limit } = {}) => {
  const lim = int(limit, 1, 100) ?? 50;
  const { rows } = await query(
    `SELECT c.*, o.status AS order_status, o.market_type, o.title_snap,
            (SELECT count(*)::int FROM market_messages m
              WHERE m.chat_id = c.id AND m.author_id <> $1 AND m.read_at IS NULL) AS unread,
            (SELECT m.body_enc FROM market_messages m
              WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_enc,
            (SELECT m.created_at FROM market_messages m
              WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_at
       FROM market_chats c JOIN market_orders o ON o.id = c.order_id
      WHERE c.buyer_id = $1 OR c.seller_id = $1
      ORDER BY COALESCE((SELECT m.created_at FROM market_messages m
                          WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1),
                        c.created_at) DESC
      LIMIT $2`, [userId, lim]);
  return rows.map((r) => toChat(r, r.buyer_id === userId ? 'buyer' : 'seller', {
    unread: Number(r.unread ?? 0),
    lastMessage: r.last_enc ? (decryptContent(r.last_enc) ?? '') : '',
    lastAt: r.last_at?.toISOString?.() ?? null,
  }));
};

export const readChat = async (chatId, viewerId, { limit, before } = {}) => {
  const found = await accessChat(chatId, viewerId);
  if (!found) return null;
  const lim = int(limit, 1, MAX_PER_PAGE) ?? 50;

  const args = [found.chat.id];
  let where = 'chat_id = $1';
  if (before) {
    args.push(String(before));
    where += ` AND created_at < (SELECT created_at FROM market_messages WHERE id = $${args.length})`;
  }
  args.push(lim);
  const { rows } = await query(
    `SELECT * FROM market_messages WHERE ${where}
      ORDER BY created_at DESC LIMIT $${args.length}`, args);

  return {
    chat: toChat(found.chat, found.role),
    messages: rows.reverse().map(toMessage),
  };
};

/**
 * Написать в чат сделки.
 *
 * Писать можно, пока сделка не закрыта: после завершения или отмены
 * переписка остаётся читаемой, но новых сообщений в неё не добавить.
 * Поддержка пишет и в закрытый — разбирательство бывает и после.
 */
export const sendMessage = async (chatId, authorId, body) => {
  const found = await accessChat(chatId, authorId);
  if (!found) return { error: 'not_found' };
  const { chat, role } = found;

  const message = text(body, MAX_MESSAGE);
  if (!message) return { error: 'empty_message' };

  const closed = ['completed', 'cancelled'].includes(chat.order_status);
  if (closed && role !== 'support') return { error: 'order_closed' };

  const id = `mm-${generateId()}`;
  const { rows } = await query(
    `INSERT INTO market_messages (id, chat_id, author_id, author_role, body_enc)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, chat.id, authorId, role, encryptContent(message)]);

  /* Второй стороне — по сокету. Тип свой, market-message: сообщения
     сделки не должны попадать в обработчик мессенджера. */
  const others = [chat.buyer_id, chat.seller_id].filter((u) => u !== authorId);
  pushMarket(others, {
    type: 'market-message',
    payload: { chatId: chat.id, orderId: chat.order_id, message: toMessage(rows[0]) },
  });

  await logMarket(authorId, 'chat_message', chat.id, { role });
  return { message: toMessage(rows[0]) };
};

/** Отметить чужие сообщения прочитанными. Свои не трогаем. */
export const markRead = async (chatId, userId) => {
  const found = await accessChat(chatId, userId);
  if (!found) return { error: 'not_found' };
  const { rowCount } = await query(
    `UPDATE market_messages SET read_at = now()
      WHERE chat_id = $1 AND author_id <> $2 AND read_at IS NULL`,
    [found.chat.id, userId]);
  return { ok: true, marked: rowCount };
};

export const unreadCount = async (userId) => {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM market_messages m
       JOIN market_chats c ON c.id = m.chat_id
      WHERE (c.buyer_id = $1 OR c.seller_id = $1)
        AND m.author_id <> $1 AND m.read_at IS NULL`, [userId]);
  return rows[0]?.n ?? 0;
};

/**
 * Системное сообщение в чат сделки.
 *
 * Пишется сервером на важных переходах, чтобы в переписке осталась та
 * же история, что и в журнале заказа. Автором значится тот, чьё
 * действие вызвало запись, но роль — system: сторона такого сообщения
 * не писала.
 */
export const systemMessage = async (orderId, textLine) => {
  const line = text(textLine, MAX_MESSAGE);
  if (!line) return;
  const { rows } = await query('SELECT id, buyer_id, seller_id FROM market_chats WHERE order_id = $1',
    [String(orderId ?? '')]);
  const chat = rows[0];
  if (!chat) return;
  const { rows: made } = await query(
    `INSERT INTO market_messages (id, chat_id, author_id, author_role, body_enc)
     VALUES ($1,$2,$3,'system',$4) RETURNING *`,
    [`mm-${generateId()}`, chat.id, chat.seller_id, encryptContent(line)]);
  pushMarket([chat.buyer_id, chat.seller_id], {
    type: 'market-message',
    payload: { chatId: chat.id, orderId: String(orderId), message: toMessage(made[0]) },
  });
};

/**
 * Поддержка и чат сделки.
 *
 * Отдельного чата поддержки по заказу нет намеренно. На заказ приходится
 * ровно один чат — это уникальность order_id в базе, — и поддержка
 * работает в нём же, подписываясь ролью support. Второй, «тайный» чат
 * той же сделки означал бы переписку о заказе, которой в истории заказа
 * не видно, а в споре это ровно то, чего нельзя допускать.
 */
