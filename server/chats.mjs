/**
 * Чаты и сообщения в PostgreSQL.
 *
 * До этого WebSocket-хаб держал их в Map внутри процесса: перезапуск
 * стирал переписку, а второй экземпляр API не видел чужих сообщений.
 *
 * Важное правило: каждая функция, отдающая или меняющая данные, принимает
 * userId вызывающего и сама проверяет, что он участник чата. Проверять
 * это в обработчике сообщений нельзя — там легко забыть одну ветку.
 */
import { query, pool } from './db.mjs';

/** Проверка участия. Основа всех прав в мессенджере. */
export const isMember = async (chatId, userId) => {
  const { rowCount } = await query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId],
  );
  return rowCount > 0;
};

export const memberIds = async (chatId) => {
  const { rows } = await query('SELECT user_id FROM chat_members WHERE chat_id = $1', [chatId]);
  return rows.map((r) => r.user_id);
};

const toChat = (row, participants) => ({
  id: row.id,
  type: row.type,
  name: row.name,
  username: row.username,
  avatar: row.avatar,
  description: row.description ?? undefined,
  ownerId: row.owner_id ?? undefined,
  participants,
  createdAt: row.created_at.toISOString(),
});

const toMessage = (row) => ({
  // Поля, специфичные для сообщения, лежат в payload — их набор задаёт
  // фронтенд и меняется чаще, чем схема таблицы.
  ...(row.payload ?? {}),
  id: row.id,
  chatId: row.chat_id,
  authorId: row.author_id,
  kind: row.kind,
  text: row.deleted ? 'Сообщение удалено' : row.text,
  deleted: row.deleted,
  editedAt: row.edited_at ? row.edited_at.toISOString() : undefined,
  createdAt: row.created_at.toISOString(),
});

/** Чаты пользователя вместе со списком участников. */
export const listChats = async (userId) => {
  const { rows } = await query(
    `SELECT c.*, coalesce(
              (SELECT array_agg(m.user_id) FROM chat_members m WHERE m.chat_id = c.id),
              '{}') AS participants
       FROM chats c
       JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $1
      ORDER BY c.created_at DESC`,
    [userId],
  );
  return rows.map((r) => toChat(r, r.participants));
};

/** Последние сообщения чата. Не участник не получает ничего. */
export const listMessages = async (chatId, userId, limit = 50) => {
  if (!(await isMember(chatId, userId))) return null;
  const { rows } = await query(
    `SELECT * FROM messages WHERE chat_id = $1
      ORDER BY created_at DESC LIMIT $2`,
    [chatId, Math.min(Number(limit) || 50, 200)],
  );
  return rows.reverse().map(toMessage);
};

/**
 * Создаёт чат и добавляет участников одной транзакцией: чат без
 * участников недоступен даже своему создателю.
 */
export const createChat = async (chat, creatorId) => {
  const participants = Array.from(new Set([creatorId, ...(chat.participants ?? [])]));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO chats (id, type, name, username, avatar, description, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [chat.id, chat.type, chat.name ?? '', chat.username ?? '',
       chat.avatar ?? '', chat.description ?? null, creatorId],
    );
    for (const uid of participants) {
      await client.query(
        'INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [chat.id, uid],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows } = await query('SELECT * FROM chats WHERE id = $1', [chat.id]);
  return rows[0] ? toChat(rows[0], participants) : null;
};

/**
 * Сохраняет сообщение. Автор берётся из сессии, а не из тела: иначе
 * можно было бы написать в чат от чужого имени.
 */
export const saveMessage = async (chatId, authorId, msg) => {
  if (!(await isMember(chatId, authorId))) return null;

  // id приходит от клиента, чтобы он мог сопоставить отправленное с
  // подтверждением. Всё остальное задаём сами.
  const { id, text, kind, chatId: _c, authorId: _a, createdAt: _t, ...rest } = msg ?? {};

  const { rows } = await query(
    `INSERT INTO messages (id, chat_id, author_id, kind, text, payload)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [String(id || `m-${crypto.randomUUID()}`), chatId, authorId,
     String(kind || 'text'), String(text ?? ''), rest],
  );
  return rows[0] ? toMessage(rows[0]) : null;
};

/** Правит текст. Чужие сообщения не редактируются. */
export const editMessage = async (messageId, authorId, text) => {
  const { rows } = await query(
    `UPDATE messages SET text = $3, edited_at = now()
      WHERE id = $1 AND author_id = $2 AND NOT deleted
      RETURNING *`,
    [messageId, authorId, String(text ?? '')],
  );
  return rows[0] ? toMessage(rows[0]) : null;
};

/**
 * Помечает удалённым. Текст затирается в самой строке, а не скрывается
 * на клиенте: иначе он остался бы доступен любому, кто смотрит ответ API.
 */
export const deleteMessage = async (messageId, authorId) => {
  const { rows } = await query(
    `UPDATE messages SET deleted = TRUE, text = '', payload = '{}'::jsonb
      WHERE id = $1 AND author_id = $2
      RETURNING *`,
    [messageId, authorId],
  );
  return rows[0] ? toMessage(rows[0]) : null;
};

export const markRead = async (chatId, userId) => {
  if (!(await isMember(chatId, userId))) return false;
  await query(
    `INSERT INTO message_reads (message_id, user_id)
     SELECT id, $2 FROM messages WHERE chat_id = $1 AND author_id <> $2
     ON CONFLICT DO NOTHING`,
    [chatId, userId],
  );
  return true;
};
