/**
 * Каналы и группы мессенджера для админ-панели: список всех, а не только
 * тех, в которых состоит сам администратор, и удаление.
 *
 * Названия чатов хранятся зашифрованными, поэтому поиск по названию
 * идёт в приложении после расшифровки, а не в SQL.
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { decryptContent } from './crypto.mjs';
import { logAdmin } from './adminsec.mjs';

const MAX_ROWS = 2000;

const view = (r) => ({
  id: r.id,
  type: r.type,
  name: decryptContent(r.name) || '(без названия)',
  username: r.username || '',
  ownerId: r.owner_id,
  ownerName: r.owner_name ?? null,
  ownerUsername: r.owner_username ?? null,
  memberCount: r.member_count,
  messageCount: r.message_count,
  lastMessageAt: r.last_message_at ? r.last_message_at.toISOString() : null,
  createdAt: r.created_at.toISOString(),
});

export const adminListChannels = async (adminId, { q, type, limit, offset } = {}) => {
  if (!(await can(adminId, 'moderation'))) return null;
  const kinds = type === 'group' ? ['group'] : type === 'all' ? ['channel', 'group'] : ['channel'];
  const { rows } = await query(
    `SELECT c.id, c.type, c.name, c.username, c.owner_id, c.created_at,
            p.name AS owner_name, p.username AS owner_username,
            (SELECT count(*)::int FROM chat_members m WHERE m.chat_id = c.id) AS member_count,
            (SELECT count(*)::int FROM messages x WHERE x.chat_id = c.id) AS message_count,
            (SELECT max(x.created_at) FROM messages x WHERE x.chat_id = c.id) AS last_message_at
       FROM chats c LEFT JOIN profiles p ON p.id = c.owner_id
      WHERE c.type = ANY($1)
      ORDER BY c.created_at DESC LIMIT $2`,
    [kinds, MAX_ROWS],
  );
  let items = rows.map(view);
  const needle = String(q ?? '').trim().toLowerCase().slice(0, 80);
  if (needle) {
    items = items.filter((c) => [c.id, c.name, c.username, c.ownerName, c.ownerUsername]
      .some((v) => String(v ?? '').toLowerCase().includes(needle)));
  }
  const total = items.length;
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  return { total, items: items.slice(off, off + lim) };
};

/** Удалить канал или группу целиком (каскад уберёт участников и сообщения). */
export const adminDeleteChannel = async (adminId, chatId, meta = {}) => {
  if (!(await can(adminId, 'moderation'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT id, type, name FROM chats WHERE id = $1 AND type <> \'direct\'', [chatId]);
  const chat = rows[0];
  if (!chat) return { error: 'not_found' };
  await query('DELETE FROM chats WHERE id = $1', [chatId]);
  await logAdmin({
    actorId: adminId, targetId: chatId, targetType: 'chat', type: 'chat_delete',
    detail: `${chat.type}: ${decryptContent(chat.name) || chatId}`.slice(0, 200), meta,
  });
  return { ok: true };
};
