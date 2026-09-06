/**
 * Refresh-сессии в Redis.
 *
 * Раньше они лежали в Map внутри процесса: перезапуск разлогинивал всех,
 * а несколько экземпляров API не видели сессии друг друга. Redis снимает
 * оба ограничения и сам удаляет протухшие записи по TTL.
 */
import { createClient } from 'redis';

const KEY_SESSION   = (id)  => `sess:${id}`;
const KEY_USER_SESS = (uid) => `user-sess:${uid}`;

let client = null;

export const connectRedis = async () => {
  if (client) return client;

  client = createClient({
    url: process.env.REDIS_URL,
    socket: {
      // Контейнер Redis может стартовать дольше API; не сдаёмся сразу.
      reconnectStrategy: (retries) => (retries > 20 ? new Error('Redis недоступен') : Math.min(retries * 200, 3000)),
    },
  });

  // Без обработчика ошибка соединения роняет процесс.
  client.on('error', (err) => console.error('[redis]', err.message));

  await client.connect();
  return client;
};

export const closeRedis = async () => {
  if (client?.isOpen) await client.quit();
  client = null;
};

export const sessionStore = {
  /**
   * Кладёт сессию с временем жизни refresh-токена: Redis удалит запись
   * сам, отдельная чистка не нужна.
   */
  async put({ id, userId }, ttlSec) {
    const value = JSON.stringify({ id, userId, createdAt: Date.now() });
    await client
      .multi()
      .setEx(KEY_SESSION(id), ttlSec, value)
      // Обратный индекс: нужен, чтобы разлогинить пользователя целиком.
      .sAdd(KEY_USER_SESS(userId), id)
      .expire(KEY_USER_SESS(userId), ttlSec)
      .exec();
  },

  async get(id) {
    const raw = await client.get(KEY_SESSION(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  async revoke(id) {
    const session = await this.get(id);
    const multi = client.multi().del(KEY_SESSION(id));
    if (session?.userId) multi.sRem(KEY_USER_SESS(session.userId), id);
    await multi.exec();
  },

  /** Разлогинить пользователя на всех устройствах — например при смене пароля. */
  async revokeAllForUser(userId) {
    const ids = await client.sMembers(KEY_USER_SESS(userId));
    if (ids.length === 0) return 0;
    await client.multi()
      .del(ids.map(KEY_SESSION))
      .del(KEY_USER_SESS(userId))
      .exec();
    return ids.length;
  },
};
