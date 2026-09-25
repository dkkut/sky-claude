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

/** Отвечает ли кэш. Нужно проверке готовности после смены паролей. */
export const redisAlive = async () => {
  try { return (await client?.ping()) === 'PONG'; } catch { return false; }
};

export const closeRedis = async () => {
  if (client?.isOpen) await client.quit();
  client = null;
};

/**
 * Кого предупредить, когда сессия перестала существовать.
 *
 * Открытый WebSocket живёт часами, а «Выйти из Sky ID» должно закрывать
 * его сразу. Опрос Redis перед каждой операцией с кэшем на несколько
 * секунд оставляет окно, в которое украденный токен ещё читает
 * переписку. Поэтому о прекращении сессии сообщаем сразу — хаб
 * подписывается и закрывает свои сокеты.
 */
const revokeWatchers = new Set();
export const onSessionRevoked = (fn) => { revokeWatchers.add(fn); return () => revokeWatchers.delete(fn); };
const announceRevoked = (ids) => {
  for (const id of ids) {
    for (const fn of revokeWatchers) {
      try { fn(id); } catch (err) { console.error('[sessions] слушатель', err.message); }
    }
  }
};

export const sessionStore = {
  /**
   * Кладёт сессию с временем жизни refresh-токена: Redis удалит запись
   * сам, отдельная чистка не нужна.
   *
   * userId здесь — это Sky ID: сессия принадлежит аккаунту, а не профилю.
   * Активный профиль хранится отдельным полем и меняется при переключении,
   * не затрагивая саму сессию.
   */
  async put({ id, userId, profileId = null, ua = '', ip = '' }, ttlSec) {
    const value = JSON.stringify({
      id, userId, profileId, ua, ip, createdAt: Date.now(), lastSeenAt: Date.now(),
    });
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

  /**
   * Меняет активный профиль в существующей сессии. Срок жизни сохраняем:
   * переключение профиля не должно ни продлевать, ни укорачивать вход.
   */
  async setActiveProfile(id, profileId) {
    const session = await this.get(id);
    if (!session) return false;
    const ttl = await client.ttl(KEY_SESSION(id));
    await client.setEx(
      KEY_SESSION(id),
      ttl > 0 ? ttl : 60,
      JSON.stringify({ ...session, profileId }),
    );
    return true;
  },

  /**
   * Настоящий список сессий Sky ID — то, что показывает экран
   * «Устройства». Раньше он рисовался из localStorage и не отражал
   * ничего реального: терминировать «устройство» там не значило ничего.
   */
  async listForUser(userId) {
    const ids = await client.sMembers(KEY_USER_SESS(userId));
    if (ids.length === 0) return [];
    const sessions = await Promise.all(ids.map((id) => this.get(id)));
    return sessions.filter(Boolean).sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0));
  },

  /** Отмечает сессию «видели только что» — вызывается при обновлении токена. */
  async touch(id) {
    const session = await this.get(id);
    if (!session) return;
    const ttl = await client.ttl(KEY_SESSION(id));
    await client.setEx(KEY_SESSION(id), ttl > 0 ? ttl : 60, JSON.stringify({ ...session, lastSeenAt: Date.now() }));
  },

  async revoke(id) {
    const session = await this.get(id);
    const multi = client.multi().del(KEY_SESSION(id));
    if (session?.userId) multi.sRem(KEY_USER_SESS(session.userId), id);
    await multi.exec();
    announceRevoked([id]);
  },

  /** Разлогинить пользователя на всех устройствах — например при смене пароля. */
  async revokeAllForUser(userId) {
    const ids = await client.sMembers(KEY_USER_SESS(userId));
    if (ids.length === 0) return 0;
    await client.multi()
      .del(ids.map(KEY_SESSION))
      .del(KEY_USER_SESS(userId))
      .exec();
    announceRevoked(ids);
    return ids.length;
  },
};
