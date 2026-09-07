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

/**
 * Аватар наружу не отдаём: он хранится картинкой прямо в строке и весит
 * до четверти мегабайта, а двадцать результатов поиска — уже пять
 * мегабайт на каждое нажатие клавиши. Интерфейсу хватает буквы имени.
 */
const toPerson = (row) => ({
  id: row.id,
  name: row.name,
  username: row.username,
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
    `SELECT id, name, username FROM profiles
      WHERE id <> $2
        AND (lower(username) LIKE $1 OR lower(name) LIKE $1)
      ORDER BY lower(username) = $3 DESC, lower(username)
      LIMIT ${MAX_RESULTS}`,
    [prefix, meId ?? '', q],
  );
  return rows.map(toPerson);
};

/**
 * Разрешение известных id в имена — для участников чатов.
 *
 * Отдаём только тех, с кем у спрашивающего есть общий чат, и его самого.
 * Иначе ручка превращалась в способ узнать имя владельца любого
 * идентификатора, попавшего на глаза.
 */
export const peopleByIds = async (ids, meId) => {
  const list = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String))).slice(0, MAX_IDS);
  if (list.length === 0 || !meId) return [];
  const { rows } = await query(
    `SELECT p.id, p.name, p.username FROM profiles p
      WHERE p.id = ANY($1::text[])
        AND (p.id = $2 OR EXISTS (
              SELECT 1 FROM chat_members x
                JOIN chat_members y ON y.chat_id = x.chat_id
               WHERE x.user_id = $2 AND y.user_id = p.id))`,
    [list, meId],
  );
  return rows.map(toPerson);
};
