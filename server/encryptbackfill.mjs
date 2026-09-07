/**
 * Перешифровка того, что было записано до перехода на шифрование.
 *
 * Миграции — обычный SQL, а шифрование живёт в приложении, поэтому эта
 * часть переезда выполняется здесь, при запуске. Проход идёт пачками и
 * повторный запуск ничего не портит: уже зашифрованные записи узнаются
 * по метке версии и пропускаются.
 */
import { query, pool } from './db.mjs';
import { encryptContent } from './crypto.mjs';

const BATCH = 500;

const encryptMessages = async () => {
  let done = 0;
  for (;;) {
    const { rows } = await query(
      `SELECT id, text, payload FROM messages
        WHERE (text <> '' AND text NOT LIKE 'v1.%')
           OR (payload <> '{}'::jsonb AND NOT payload ? 'e')
        LIMIT $1`,
      [BATCH],
    );
    if (rows.length === 0) return done;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const text = row.text && !row.text.startsWith('v1.') ? encryptContent(row.text) : row.text;
        const payload = row.payload && typeof row.payload === 'object' && !('e' in row.payload)
          ? { e: encryptContent(JSON.stringify(row.payload)) }
          : row.payload;
        await client.query('UPDATE messages SET text = $2, payload = $3 WHERE id = $1',
          [row.id, text, payload]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    done += rows.length;
    if (rows.length < BATCH) return done;
  }
};

const encryptChats = async () => {
  const { rows } = await query(
    `SELECT id, name, description FROM chats
      WHERE (name <> '' AND name NOT LIKE 'v1.%')
         OR (description IS NOT NULL AND description <> '' AND description NOT LIKE 'v1.%')`,
  );
  for (const row of rows) {
    await query('UPDATE chats SET name = $2, description = $3 WHERE id = $1', [
      row.id,
      row.name && !row.name.startsWith('v1.') ? encryptContent(row.name) : row.name,
      row.description && !row.description.startsWith('v1.') ? encryptContent(row.description) : row.description,
    ]);
  }
  return rows.length;
};

export const encryptExistingContent = async () => {
  const messages = await encryptMessages();
  const chats = await encryptChats();
  if (messages || chats) {
    console.log(`[crypto] зашифровано записей: сообщений ${messages}, чатов ${chats}`);
  }
};
