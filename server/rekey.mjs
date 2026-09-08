/**
 * Перевод зашифрованных записей на другой ключ.
 *
 * Нужно ровно в одном случае: в .env не было ENCRYPTION_KEY, ключ
 * выводился из JWT_SECRET, и теперь заводится отдельный. Без этого
 * перехода всё, что уже зашифровано старым ключом, перестало бы
 * читаться — переписка, названия чатов, настройки, журнал и секреты
 * двухэтапной защиты.
 *
 * Работает так: старый ключ выводится из переданного материала, новый —
 * из нынешнего ENCRYPTION_KEY. Каждая запись расшифровывается старым и
 * зашифровывается новым. Записи, которые старым ключом не читаются,
 * НЕ трогаются: значит они либо уже на новом ключе (повторный запуск),
 * либо испорчены, и портить их дальше незачем.
 *
 * Запускается вручную, через scripts/set-encryption-key.sh.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { config } from './config.mjs';

const BATCH = 500;

/* ─── Ключи ────────────────────────────────────────────────────────────── */

const derive = (material, info) =>
  Buffer.from(crypto.hkdfSync('sha256', Buffer.from(material, 'utf8'),
                              Buffer.alloc(0), Buffer.from(info), 32));

/** Пара «расшифровать старым / зашифровать новым» для одного назначения. */
const codec = (oldMaterial, newMaterial, info) => {
  const oldKey = derive(oldMaterial, info);
  const newKey = derive(newMaterial, info);

  const decode = (blob) => {
    if (typeof blob !== 'string' || blob === '' || !blob.startsWith('v1.')) return null;
    const [, ivB64, tagB64, dataB64] = blob.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', oldKey, Buffer.from(ivB64, 'base64url'));
      d.setAuthTag(Buffer.from(tagB64, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(dataB64, 'base64url')), d.final()]).toString('utf8');
    } catch {
      return null;   // старым ключом не читается — не наша запись
    }
  };

  const encode = (plain) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', newKey, iv);
    const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'),
            enc.toString('base64url')].join('.');
  };

  /** null означает «оставить как есть». */
  const move = (blob) => {
    const plain = decode(blob);
    return plain === null ? null : encode(plain);
  };

  return { decode, encode, move };
};

/* ─── Проход по таблицам ───────────────────────────────────────────────── */

/**
 * Одна колонка одной таблицы.
 *
 * Ключ строки — список колонок, а не одна: у заявок на вступление он
 * составной (чат и человек). Обновлять такую строку по одному только
 * user_id нельзя — под условие попали бы заявки того же человека в
 * другие чаты, и в них легли бы чужие ответы.
 */
const rekeyColumn = async (table, keyCols, column, move) => {
  const keys = Array.isArray(keyCols) ? keyCols : [keyCols];
  const keyList = keys.join(', ');
  let moved = 0, offset = 0;
  for (;;) {
    const { rows } = await query(
      `SELECT ${keyList}, ${column} AS val FROM ${table}
        WHERE ${column} LIKE 'v1.%'
        ORDER BY ${keyList} LIMIT $1 OFFSET $2`,
      [BATCH, offset],
    );
    if (rows.length === 0) return moved;

    // WHERE a = $2 AND b = $3 — значение колонки идёт первым параметром.
    const where = keys.map((k, i) => `${k} = $${i + 2}`).join(' AND ');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const next = move(row.val);
        if (next === null) continue;          // не читается старым ключом
        await client.query(
          `UPDATE ${table} SET ${column} = $1 WHERE ${where}`,
          [next, ...keys.map((k) => row[k])],
        );
        moved += 1;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    // Сдвигаем окно: строки, которые пропустили, останутся на месте и
    // без сдвига мы читали бы их снова и снова.
    offset += rows.length;
  }
};

/** Довесок сообщения лежит в jsonb одной строкой в поле «e». */
const rekeyPayloads = async (move) => {
  let moved = 0, offset = 0;
  for (;;) {
    const { rows } = await query(
      `SELECT id, payload FROM messages
        WHERE payload ? 'e' ORDER BY id LIMIT $1 OFFSET $2`,
      [BATCH, offset],
    );
    if (rows.length === 0) return moved;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const next = move(row.payload?.e);
        if (next === null) continue;
        await client.query('UPDATE messages SET payload = $2 WHERE id = $1',
          [row.id, { e: next }]);
        moved += 1;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    offset += rows.length;
  }
};

/* ─── Точка входа ──────────────────────────────────────────────────────── */

/**
 * Переводит все зашифрованные записи со старого материала ключа на
 * нынешний ENCRYPTION_KEY. Возвращает, сколько записей перенесено.
 */
export const rekeyAll = async (oldMaterial) => {
  const newMaterial = config.encryptionKey;
  if (!newMaterial) throw new Error('ENCRYPTION_KEY не задан — переносить не на что');
  if (!oldMaterial)  throw new Error('не передан прежний материал ключа');
  if (oldMaterial === newMaterial) return { same: true };

  // Содержимое переписки и секреты двухэтапной защиты разведены разными
  // ключами — переносить их нужно порознь, каждым своим.
  const content = codec(oldMaterial, newMaterial, 'sky:message-content:v1');
  const secret  = codec(oldMaterial, newMaterial, 'sky:secret-encryption:v1');

  const counts = {
    messages:  await rekeyColumn('messages', ['id'], 'text', content.move),
    payloads:  await rekeyPayloads(content.move),
    chatNames: await rekeyColumn('chats', ['id'], 'name', content.move),
    chatDescr: await rekeyColumn('chats', ['id'], 'description', content.move),
    welcome:   await rekeyColumn('chat_settings', ['chat_id'], 'welcome_message', content.move),
    question:  await rekeyColumn('chat_settings', ['chat_id'], 'join_question', content.move),
    answers:   await rekeyColumn('chat_join_requests', ['chat_id', 'user_id'], 'answer', content.move),
    log:       await rekeyColumn('chat_log', ['id'], 'detail', content.move),
    twoFactor: await rekeyColumn('profiles', ['id'], 'two_factor_secret', secret.move)
             + await rekeyColumn('sky_ids', ['id'], 'two_factor_secret', secret.move),
  };
  return counts;
};
