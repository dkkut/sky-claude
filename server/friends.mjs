/**
 * Дружба — двусторонняя связь с заявкой/подтверждением, отдельно от
 * подписки (follows.mjs). Раньше вся эта пара жила в localStorage
 * профиль-вьюера (src/profile/viewer/social.ts) в одном общем массиве —
 * заявка, отправленная одним человеком, физически не могла попасть в
 * браузер второго: localStorage не синхронизируется между устройствами
 * и людьми. Здесь — одна таблица `friendships` на двоих.
 */
import { query } from './db.mjs';

const pairKey = (a, b) => (a < b ? [a, b] : [b, a]);

export const friendStatus = async (meId, otherId) => {
  if (!meId || !otherId || meId === otherId) return 'none';
  const [a, b] = pairKey(meId, otherId);
  const { rows } = await query(
    'SELECT status, requested_by FROM friendships WHERE a_id = $1 AND b_id = $2',
    [a, b],
  );
  const row = rows[0];
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.requested_by === meId ? 'pending_out' : 'pending_in';
};

/**
 * Заявка — тот же переключатель, что уже есть у подписок: нет заявки —
 * создаём; встречная уже ждёт нас — принимаем её; свою же заявку или
 * готовую дружбу — не трогаем (идемпотентно, клиенту не нужно заранее
 * знать текущее состояние).
 */
export const sendFriendRequest = async (fromId, toId) => {
  if (!fromId || !toId || fromId === toId) return { error: 'bad_target' };
  const { rows: target } = await query('SELECT 1 FROM profiles WHERE id = $1', [toId]);
  if (!target.length) return { error: 'not_found' };

  const [a, b] = pairKey(fromId, toId);
  const { rows } = await query(
    'SELECT status, requested_by FROM friendships WHERE a_id = $1 AND b_id = $2',
    [a, b],
  );
  const row = rows[0];
  if (!row) {
    await query(
      "INSERT INTO friendships (a_id, b_id, requested_by, status) VALUES ($1,$2,$3,'pending')",
      [a, b, fromId],
    );
    return { status: 'pending_out' };
  }
  if (row.status === 'accepted') return { status: 'friends' };
  if (row.requested_by === fromId) return { status: 'pending_out' };

  await query("UPDATE friendships SET status = 'accepted' WHERE a_id = $1 AND b_id = $2", [a, b]);
  return { status: 'friends' };
};

/** Убирает связь целиком — годится и для разрыва дружбы, и для отмены
 *  своей заявки, и для отклонения чужой: во всех трёх случаях строки
 *  просто не должно остаться. */
export const removeFriend = async (meId, otherId) => {
  if (!meId || !otherId) return { error: 'bad_target' };
  const [a, b] = pairKey(meId, otherId);
  await query('DELETE FROM friendships WHERE a_id = $1 AND b_id = $2', [a, b]);
  return { status: 'none' };
};

export const friendIds = async (userId) => {
  const { rows } = await query(
    `SELECT CASE WHEN a_id = $1 THEN b_id ELSE a_id END AS id
       FROM friendships WHERE (a_id = $1 OR b_id = $1) AND status = 'accepted'`,
    [userId],
  );
  return rows.map((r) => r.id);
};

export const friendCount = async (userId) => {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM friendships WHERE (a_id = $1 OR b_id = $1) AND status = 'accepted'`,
    [userId],
  );
  return rows[0].n;
};
