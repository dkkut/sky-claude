/**
 * Поиск профилей.
 *
 * После появления Sky ID таблица users переименована в profiles: то, что
 * раньше было «пользователем», по смыслу всегда было профилем — имя, ник,
 * аватар. Телефон переехал в sky_ids, потому что это способ входа, а не
 * свойство профиля.
 *
 * Модуль оставлен для тех мест, которым нужен просто профиль по id или
 * нику: перевод в кошельке, служебные проверки. Всё, что связано с
 * принадлежностью профиля аккаунту, живёт в skyid.mjs.
 */
import { query } from './db.mjs';

const toProfile = (row) => row && ({
  id:       row.id,
  skyId:    row.sky_id,
  username: row.username,
  name:     row.name,
  isAdmin:  row.is_admin,
  isPrime:  row.is_prime,
});

export const userStore = {
  async findById(id) {
    const { rows } = await query(
      'SELECT id, sky_id, username, name, is_admin, is_prime FROM profiles WHERE id = $1',
      [String(id)],
    );
    return toProfile(rows[0]);
  },

  async findByUsername(username) {
    const { rows } = await query(
      'SELECT id, sky_id, username, name, is_admin, is_prime FROM profiles WHERE lower(username) = lower($1)',
      [String(username)],
    );
    return toProfile(rows[0]);
  },

  async count() {
    const { rows } = await query('SELECT count(*)::int AS n FROM profiles');
    return rows[0].n;
  },
};
