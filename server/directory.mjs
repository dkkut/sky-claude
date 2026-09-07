/**
 * Справочник людей: поиск собеседника и разрешение id в имя.
 *
 * Мессенджер до этого искал людей по списку аккаунтов внутри браузера —
 * то есть находил только тех, кого туда положили при сборке. Найти
 * реального человека с другого устройства было нечем.
 *
 * Наружу отдаётся только то, что и так видно в переписке: id, имя, ник,
 * аватар. Ни почты, ни телефона, ни Sky ID здесь нет — иначе поиск стал
 * бы способом собрать контакты всех пользователей.
 */
import { query } from './db.mjs';

/** Короткий запрос вернул бы половину базы — ищем от двух символов. */
const MIN_QUERY = 2;
const MAX_RESULTS = 20;
/** Потолок на разовое разрешение id: список участников группы. */
const MAX_IDS = 100;

const toPerson = (row) => ({
  id: row.id,
  name: row.name,
  username: row.username,
  avatar: row.avatar ?? undefined,
});

/**
 * Поиск по началу ника или имени.
 *
 * Именно по началу, а не по вхождению: подстрочный поиск по одной букве
 * выдаёт список всех, у кого она встречается, и превращается в выгрузку
 * базы пользователей.
 */
export const searchPeople = async (raw, meId) => {
  const q = String(raw ?? '').trim().toLowerCase().replace(/^@/, '');
  if (q.length < MIN_QUERY || q.length > 64) return [];

  // Экранируем символы шаблона LIKE: иначе «%» найдёт вообще всех.
  const prefix = `${q.replace(/([\\%_])/g, '\\$1')}%`;

  const { rows } = await query(
    `SELECT id, name, username, avatar FROM profiles
      WHERE id <> $2
        AND (lower(username) LIKE $1 OR lower(name) LIKE $1)
      ORDER BY lower(username) = $3 DESC, lower(username)
      LIMIT ${MAX_RESULTS}`,
    [prefix, meId ?? '', q],
  );
  return rows.map(toPerson);
};

/** Разрешение известных id в имена — для участников чатов. */
export const peopleByIds = async (ids) => {
  const list = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String))).slice(0, MAX_IDS);
  if (list.length === 0) return [];
  const { rows } = await query(
    'SELECT id, name, username, avatar FROM profiles WHERE id = ANY($1::text[])', [list],
  );
  return rows.map(toPerson);
};
