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

/** Потолок участников группы или канала при создании. */
const MAX_PARTICIPANTS = 100;

/** Допустимые идентификаторы чатов, приходящие от клиента. */
const GROUP_ID_RE = /^(group|channel)-[a-z0-9-]{6,40}$/;

/**
 * Идентификатор личного чата выводится из пары собеседников, а не
 * придумывается тем, кто открыл переписку первым.
 *
 * Иначе выходило так: Алиса заводит чат «dm-Боб», Боб — «dm-Алиса», и
 * это два разных чата, каждый видит только свою половину разговора.
 * Отсортированная пара даёт обоим один и тот же id.
 */
export const directChatId = (a, b) => `dm-${[String(a), String(b)].sort().join('~')}`;

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

/**
 * Участники чата с именами и аватарами.
 *
 * Личный чат каждый его участник видит по-разному: у Алисы он называется
 * «Боб», у Боба — «Алиса». Хранить два названия в строке чата нельзя, а
 * рассылать двум людям разные пакеты — лишний источник расхождений.
 * Поэтому сервер отдаёт всем один и тот же список людей, а подпись
 * выбирает клиент, зная, кто из них он сам.
 */
const PEOPLE_SELECT = `
  (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'username', p.username, 'avatar', p.avatar)
          ORDER BY p.created_at), '[]'::jsonb)
     FROM chat_members cm JOIN profiles p ON p.id = cm.user_id
    WHERE cm.chat_id = c.id) AS people`;

const toChat = (row) => {
  const people = row.people ?? [];
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    username: row.username,
    avatar: row.avatar,
    description: row.description ?? undefined,
    ownerId: row.owner_id ?? undefined,
    people,
    participants: people.map((p) => p.id),
    createdAt: row.created_at.toISOString(),
  };
};

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
  reactions: row.reactions ?? [],
  // Прочитано ли всеми, кроме автора: из этого клиент рисует галочки
  // на своих сообщениях. Считает сервер — у клиента нет списка чужих
  // прочтений, и раньше «прочитано» просто рисовалось по таймеру.
  readByAll: Boolean(row.read_by_all),
  editedAt: row.edited_at ? row.edited_at.toISOString() : undefined,
  createdAt: row.created_at.toISOString(),
});

/** Чаты пользователя вместе с участниками. */
export const listChats = async (userId) => {
  const { rows } = await query(
    `SELECT c.*, ${PEOPLE_SELECT}
       FROM chats c
       JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $1
      ORDER BY c.created_at DESC`,
    [userId],
  );
  return rows.map(toChat);
};

/** Один чат — с проверкой участия. Нужен, чтобы отдать его создателю. */
export const getChat = async (chatId, userId) => {
  if (!(await isMember(chatId, userId))) return null;
  const { rows } = await query(`SELECT c.*, ${PEOPLE_SELECT} FROM chats c WHERE c.id = $1`, [chatId]);
  return rows[0] ? toChat(rows[0]) : null;
};

const MESSAGE_SELECT = `
  SELECT m.*,
         coalesce((SELECT jsonb_agg(jsonb_build_object('emoji', g.emoji, 'userIds', g.ids))
                     FROM (SELECT emoji, array_agg(user_id) AS ids
                             FROM message_reactions r WHERE r.message_id = m.id
                            GROUP BY emoji) g), '[]'::jsonb) AS reactions,
         (SELECT count(*) FROM chat_members cm
           WHERE cm.chat_id = m.chat_id AND cm.user_id <> m.author_id)
         = (SELECT count(*) FROM message_reads mr
             WHERE mr.message_id = m.id AND mr.user_id <> m.author_id) AS read_by_all
    FROM messages m`;

/** Последние сообщения чата. Не участник не получает ничего. */
export const listMessages = async (chatId, userId, limit = 50) => {
  if (!(await isMember(chatId, userId))) return null;
  const { rows } = await query(
    `${MESSAGE_SELECT} WHERE m.chat_id = $1 ORDER BY m.created_at DESC LIMIT $2`,
    [chatId, Math.min(Number(limit) || 50, 200)],
  );
  return rows.reverse().map(toMessage);
};

/** Одно сообщение по id — уже после того, как право на него проверено. */
const readMessage = async (messageId) => {
  const { rows } = await query(`${MESSAGE_SELECT} WHERE m.id = $1`, [messageId]);
  return rows[0] ? toMessage(rows[0]) : null;
};

/**
 * Создаёт чат и добавляет участников одной транзакцией: чат без
 * участников недоступен даже своему создателю.
 *
 * Идентификатор приходит от клиента, поэтому «создание» чата с чужим
 * id — это попытка войти в чужую переписку. Раньше такая попытка
 * срабатывала: строка чата не вставлялась (ON CONFLICT DO NOTHING), а
 * участники дописывались как ни в чём не бывало. Теперь занятый id
 * означает отказ для всех, кроме тех, кто уже в этом чате.
 */
export const createChat = async (chat, creatorId) => {
  const type = String(chat?.type ?? '');
  if (!['direct', 'group', 'channel'].includes(type)) return null;

  const participants = Array.from(new Set([creatorId, ...(chat.participants ?? []).map(String)]));
  if (participants.length > MAX_PARTICIPANTS) return null;

  const id = String(chat.id ?? '');
  if (type === 'direct') {
    // Личный чат — ровно двое, и id обязан быть выведен из этой пары.
    if (participants.length !== 2) return null;
    if (id !== directChatId(participants[0], participants[1])) return null;
  } else if (!GROUP_ID_RE.test(id)) {
    return null;
  }

  // Все указанные участники должны существовать: иначе внешний ключ
  // уронит транзакцию уже в середине вставки.
  const { rows: known } = await query(
    'SELECT id FROM profiles WHERE id = ANY($1::text[])', [participants],
  );
  if (known.length !== participants.length) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: inserted } = await client.query(
      `INSERT INTO chats (id, type, name, username, avatar, description, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [id, type, String(chat.name ?? '').slice(0, 64), String(chat.username ?? '').slice(0, 64),
       String(chat.avatar ?? '').slice(0, 64), chat.description ? String(chat.description).slice(0, 512) : null,
       creatorId],
    );

    if (inserted.length === 0) {
      // Чат с таким id уже есть. Повторное создание допустимо только
      // как идемпотентность для своего же чата — состав участников при
      // этом не меняется.
      const { rowCount } = await client.query(
        'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [id, creatorId],
      );
      if (rowCount === 0) { await client.query('ROLLBACK'); return null; }
    } else {
      for (const uid of participants) {
        await client.query(
          'INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, uid],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getChat(id, creatorId);
};

/**
 * Поля, которые задаёт только сервер. Клиент присылает сообщение целиком,
 * вместе с тем, как оно выглядит у него: «моё», «прочитано», время по
 * его часам. Если сохранить это как есть, получатель увидит чужое
 * сообщение помеченным как своё, а отправитель — «прочитано» до того,
 * как его кто-либо открыл.
 */
const SERVER_OWNED = new Set([
  'id', 'chatId', 'authorId', 'kind', 'text', 'createdAt',
  'fromMe', 'status', 'time', 'timestamp', 'reactions', 'readByAll',
  'deleted', 'editedAt', 'pinned', 'favorited', 'viewedBy',
]);

/**
 * Сохраняет сообщение. Автор берётся из сессии, а не из тела: иначе
 * можно было бы написать в чат от чужого имени.
 */
export const saveMessage = async (chatId, authorId, msg) => {
  if (!(await isMember(chatId, authorId))) return null;

  // id приходит от клиента, чтобы он мог сопоставить отправленное с
  // подтверждением. Всё остальное задаём сами.
  const rest = Object.fromEntries(
    Object.entries(msg ?? {}).filter(([k]) => !SERVER_OWNED.has(k)),
  );

  const { rows } = await query(
    `INSERT INTO messages (id, chat_id, author_id, kind, text, payload)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [String(msg?.id || `m-${crypto.randomUUID()}`), chatId, authorId,
     String(msg?.kind || 'text'), String(msg?.text ?? '').slice(0, 8000), rest],
  );
  return rows[0] ? readMessage(rows[0].id) : null;
};

/** Правит текст. Чужие сообщения не редактируются. */
export const editMessage = async (messageId, authorId, text) => {
  const { rows } = await query(
    `UPDATE messages SET text = $3, edited_at = now()
      WHERE id = $1 AND author_id = $2 AND NOT deleted
      RETURNING id, chat_id, edited_at`,
    [messageId, authorId, String(text ?? '').slice(0, 8000)],
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, chatId: rows[0].chat_id, editedAt: rows[0].edited_at.toISOString() };
};

/**
 * Помечает удалённым. Текст затирается в самой строке, а не скрывается
 * на клиенте: иначе он остался бы доступен любому, кто смотрит ответ API.
 */
export const deleteMessage = async (messageId, authorId) => {
  const { rows } = await query(
    `UPDATE messages SET deleted = TRUE, text = '', payload = '{}'::jsonb
      WHERE id = $1 AND author_id = $2
      RETURNING id, chat_id`,
    [messageId, authorId],
  );
  if (!rows[0]) return null;
  await query('DELETE FROM message_reactions WHERE message_id = $1', [messageId]);
  return { id: rows[0].id, chatId: rows[0].chat_id };
};

/**
 * Ставит или снимает реакцию.
 *
 * Раньше реакции жили только в браузере и рассылались по сокету: после
 * перезагрузки страницы их не было, а второе устройство того же
 * человека не видело их никогда.
 */
export const toggleReaction = async (messageId, userId, emoji) => {
  const clean = String(emoji ?? '').slice(0, 16);
  if (!clean) return null;

  const { rows } = await query(
    `SELECT m.chat_id FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
      WHERE m.id = $1 AND NOT m.deleted`,
    [messageId, userId],
  );
  if (!rows[0]) return null;

  const { rowCount } = await query(
    'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
    [messageId, userId, clean],
  );
  if (rowCount === 0) {
    await query(
      `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [messageId, userId, clean],
    );
  }
  return { chatId: rows[0].chat_id, emoji: clean, removed: rowCount > 0 };
};

/**
 * Отмечает чужие сообщения чата прочитанными. Возвращает id тех, чей
 * статус изменился: только по ним нужно оповещать авторов.
 */
export const markRead = async (chatId, userId) => {
  if (!(await isMember(chatId, userId))) return null;
  const { rows } = await query(
    `INSERT INTO message_reads (message_id, user_id)
     SELECT id, $2 FROM messages WHERE chat_id = $1 AND author_id <> $2
     ON CONFLICT DO NOTHING
     RETURNING message_id`,
    [chatId, userId],
  );
  return rows.map((r) => r.message_id);
};
