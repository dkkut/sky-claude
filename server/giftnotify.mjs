/**
 * Уведомления о подарках, Prime-подарках и передаче NFT.
 *
 * По образцу market_notifications (server/marketorders.mjs) — своя
 * таблица, потому что общей таблицы уведомлений в проекте нет ни для
 * чего. Доставка та же связка: строка в базе (для истории и «непрочитано»)
 * плюс мгновенный пуш по WebSocket-хабу (server/signal.mjs), который
 * ловит src/notifications/NotifBridge.tsx и кладёт в уже существующий
 * экран уведомлений — второй экран не заводится.
 *
 * Там, где подарок и так приходит настоящим сообщением в чат (обычный
 * подарок в переписку, подарок Prime), отдельное уведомление не шлём:
 * новое сообщение уже поднимает всплывающее уведомление и бейдж через
 * действующий конвейер мессенджера — дублировать его не нужно.
 */
import { query } from './db.mjs';
import { generateId } from './security.mjs';
import { pushGiftNotification } from './signal.mjs';

export const notifyGift = async (userId, kind, title, body, refId = null) => {
  const id = `gnf-${generateId()}`;
  await query(
    `INSERT INTO gift_notifications (id, user_id, kind, title, body, ref_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, userId, kind, title, body, refId],
  );
  const note = { id, userId, kind, title, body, refId, read: false, createdAt: new Date().toISOString() };
  try { pushGiftNotification([userId], note); } catch { /* сокет недоступен — уведомление всё равно есть в базе */ }
  return note;
};

export const listGiftNotifications = async (userId, limit = 50) => {
  const { rows } = await query(
    `SELECT id, kind, title, body, ref_id, read_at, created_at FROM gift_notifications
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body, refId: r.ref_id,
    read: !!r.read_at, createdAt: r.created_at.toISOString(),
  }));
};

export const readGiftNotification = async (userId, id) => {
  await query(`UPDATE gift_notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL`, [id, userId]);
  return { ok: true };
};
