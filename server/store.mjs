/**
 * Пользователи в PostgreSQL.
 *
 * Раньше это был массив из двух захардкоженных аккаунтов с паролями,
 * захешированными голым SHA-256 без соли. Теперь записи лежат в БД,
 * пароли — scrypt (см. server/security.mjs).
 */
import { query } from './db.mjs';
import { generateId, hashPassword, verifyPassword } from './security.mjs';

/** Строка БД → объект, который отдаём наружу. Хеш пароля не выходит за пределы модуля. */
const toUser = (row) => row && ({
  id:       row.id,
  phone:    row.phone,
  username: row.username,
  name:     row.name,
  isAdmin:  row.is_admin,
  isPrime:  row.is_prime,
});

export const userStore = {
  async findByPhone(phone) {
    const { rows } = await query(
      'SELECT id, phone, username, name, is_admin, is_prime, password_hash FROM users WHERE phone = $1',
      [String(phone)],
    );
    return rows[0] ?? null;
  },

  async findByUsername(username) {
    const { rows } = await query(
      'SELECT id, phone, username, name, is_admin, is_prime, password_hash FROM users WHERE lower(username) = lower($1)',
      [String(username)],
    );
    return rows[0] ?? null;
  },

  async findById(id) {
    const { rows } = await query(
      'SELECT id, phone, username, name, is_admin, is_prime FROM users WHERE id = $1',
      [String(id)],
    );
    return toUser(rows[0]);
  },

  /** Сверяет пароль со строкой из БД. Принимает строку целиком, а не хеш. */
  verifyPassword(userRow, password) {
    return verifyPassword(password, userRow?.password_hash ?? '');
  },

  /**
   * Заводит пользователя. Уникальность телефона и ника проверяет БД —
   * так между проверкой и вставкой не может вклиниться параллельный запрос.
   */
  async create({ phone, username, name, password, isAdmin = false, isPrime = false }) {
    const id = `acc-${generateId()}`;
    const passwordHash = await hashPassword(password);
    try {
      const { rows } = await query(
        `INSERT INTO users (id, phone, username, name, password_hash, is_admin, is_prime)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, phone, username, name, is_admin, is_prime`,
        [id, String(phone), String(username), String(name), passwordHash, isAdmin, isPrime],
      );
      return { user: toUser(rows[0]) };
    } catch (err) {
      // 23505 — нарушение уникального индекса.
      if (err.code === '23505') {
        const field = err.constraint === 'users_phone_key' ? 'phone' : 'username';
        return { error: 'already_exists', field };
      }
      throw err;
    }
  },

  async changePassword(userId, newPassword) {
    const passwordHash = await hashPassword(newPassword);
    const { rowCount } = await query(
      'UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1',
      [userId, passwordHash],
    );
    return rowCount === 1;
  },

  async count() {
    const { rows } = await query('SELECT count(*)::int AS n FROM users');
    return rows[0].n;
  },
};

/**
 * Демонстрационные аккаунты. Заводятся только если таблица пуста, то есть
 * при первом запуске на чистой базе — на рабочих данных не срабатывают.
 *
 * Пароль берётся из SEED_PASSWORD; если переменная не задана, аккаунты
 * не создаются вовсе. Публичного пароля по умолчанию здесь нет намеренно:
 * иначе он уехал бы в продакшн вместе с образом.
 */
export const seedDemoUsers = async () => {
  if (await userStore.count() > 0) return;

  const password = process.env.SEED_PASSWORD;
  if (!password) {
    console.log('[store] База пуста, SEED_PASSWORD не задан — демо-аккаунты не создаются.');
    return;
  }

  const demo = [
    { phone: '+79005550100', username: 'kutuzov',     name: 'Kutuzov',     isAdmin: true, isPrime: true },
    { phone: '+79005550101', username: 'luna_nova',   name: 'Luna Nova',   isPrime: true },
    { phone: '+79005550102', username: 'neon_driver', name: 'Neo Driver'  },
  ];

  for (const account of demo) {
    const res = await userStore.create({ ...account, password });
    if (res.error) console.warn(`[store] демо-аккаунт ${account.username}: ${res.error}`);
  }
  console.log(`[store] Создано демо-аккаунтов: ${demo.length}`);
};
