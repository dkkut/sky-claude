/**
 * Приватность профиля: кто может писать, звонить и видеть присутствие.
 *
 * Всё решается здесь, на сервере. Раньше эти настройки жили в
 * localStorage браузера и не значили ничего — их даже никто не
 * спрашивал. Настройка, защищающая человека от других, в браузере жить
 * не может: свой клиент переписывается за минуту.
 *
 * Про «контакты». Контакт — это не отдельный список, который надо
 * вести: им считается тот, с кем есть общая группа или канал, либо тот,
 * кому владелец настройки сам писал в личной переписке. Ответил — значит
 * знаком.
 *
 * Про «никто». Запрет касается только НОВЫХ разговоров: в переписке,
 * где владелец настройки уже писал сам, собеседник отвечать может. Иначе
 * человек, выбрав «никто», запер бы сам себя и перестал получать ответы
 * на собственные сообщения.
 */
import { childWriteDenied } from './childguard.mjs';
import { query } from './db.mjs';

export const PRIVACY_VALUES = ['all', 'contacts', 'nobody'];

/** Приводит присланное клиентом к допустимому значению. */
const clean = (value, fallback = 'all') =>
  PRIVACY_VALUES.includes(value) ? value : fallback;

const DEFAULTS = { whoCanWrite: 'all', whoCanCall: 'all', whoSeesOnline: 'all' };

/** Настройки приватности человека. */
export const getPrivacy = async (userId) => {
  const { rows } = await query(
    `SELECT who_can_write, who_can_call, who_sees_online, profile_visibility
       FROM profiles WHERE id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) return { ...DEFAULTS, profileVisibility: {} };
  return {
    whoCanWrite:   r.who_can_write,
    whoCanCall:    r.who_can_call,
    whoSeesOnline: r.who_sees_online,
    profileVisibility: r.profile_visibility ?? {},
  };
};

/** Какие разделы профиля можно скрывать. Всё остальное отбрасывается. */
const VISIBILITY_KEYS = new Set([
  'showPhone', 'showBirthDate', 'showGames', 'showMusic', 'showMovies',
  'showGifts', 'showAchievements', 'showFollowing', 'showFriends',
  'showPhotos', 'showStories', 'showPosts',
  // Авторская часть профиля (Sky Media): по направлениям и статистика.
  'showCreatorMusic', 'showCreatorFilm', 'showCreatorPodcasts', 'showCreatorBooks', 'showCreatorStats',
  // Расширенный профиль (EditExtendedProfileSheet): раньше нигде не
  // сохранялись, поэтому тумблеры молча ничего не значили.
  'showCountry', 'showTimezone', 'showActivity',
  // Косметика своего профиля (bio/banner/nameColor+nameSticker/links/
  // customStatus) раньше вообще не долетала до publicProfile() — её
  // не от кого было скрывать, и тумблеров под неё не было. Теперь
  // долетает (см. skyid.mjs::publicProfile), и ей нужна та же
  // видимость, что у остальных разделов.
  'showBio', 'showBanner', 'showNameCustomization', 'showLinks', 'showCustomStatus',
]);

/**
 * Сохраняет настройки. Поле, которого нет в изменении, остаётся
 * прежним: иначе правка одной строки молча открывала бы остальные.
 */
export const setPrivacy = async (userId, patch = {}) => {
  const current = await getPrivacy(userId);

  const next = {
    whoCanWrite:   patch.whoCanWrite   === undefined ? current.whoCanWrite   : clean(patch.whoCanWrite,   current.whoCanWrite),
    whoCanCall:    patch.whoCanCall    === undefined ? current.whoCanCall    : clean(patch.whoCanCall,    current.whoCanCall),
    whoSeesOnline: patch.whoSeesOnline === undefined ? current.whoSeesOnline : clean(patch.whoSeesOnline, current.whoSeesOnline),
  };

  // Из присланного объекта берём только известные ключи и только
  // булевы значения: остальное — мусор или попытка положить в профиль
  // что-то своё.
  let visibility = current.profileVisibility;
  if (patch.profileVisibility && typeof patch.profileVisibility === 'object') {
    visibility = { ...visibility };
    for (const [key, value] of Object.entries(patch.profileVisibility)) {
      if (!VISIBILITY_KEYS.has(key)) continue;
      visibility[key] = Boolean(value);
    }
  }

  await query(
    `UPDATE profiles
        SET who_can_write = $2, who_can_call = $3, who_sees_online = $4,
            profile_visibility = $5
      WHERE id = $1`,
    [userId, next.whoCanWrite, next.whoCanCall, next.whoSeesOnline, JSON.stringify(visibility)],
  );
  return { ...next, profileVisibility: visibility };
};

/* ─── Кто кому знаком ──────────────────────────────────────────────────── */

/**
 * Считается ли other контактом для owner.
 *
 * Общая группа или канал — знакомство: туда не затаскивают без спроса,
 * вход только по ссылке или приглашению того, с кем уже есть переписка.
 * Личная переписка засчитывается, только если owner в ней сам писал:
 * входящее сообщение от незнакомца знакомством не делает, иначе любой
 * желающий назначал бы себя контактом одним сообщением.
 */
export const isContact = async (ownerId, otherId) => {
  if (ownerId === otherId) return true;
  const { rowCount } = await query(
    `SELECT 1 WHERE EXISTS (
       SELECT 1 FROM chat_members x
         JOIN chat_members y ON y.chat_id = x.chat_id
         JOIN chats c        ON c.id = x.chat_id
        WHERE x.user_id = $1 AND y.user_id = $2 AND c.type <> 'direct'
     ) OR EXISTS (
       SELECT 1 FROM messages m
         JOIN chat_members y ON y.chat_id = m.chat_id
         JOIN chats c        ON c.id = m.chat_id
        WHERE m.author_id = $1 AND y.user_id = $2 AND c.type = 'direct'
     )`,
    [ownerId, otherId],
  );
  return rowCount > 0;
};

/** Писал ли owner хоть раз в личной переписке именно с этим человеком. */
const spokeInDirect = async (ownerId, otherId) => {
  const chatId = `dm-${[String(ownerId), String(otherId)].sort().join('~')}`;
  const { rowCount } = await query(
    'SELECT 1 FROM messages WHERE chat_id = $1 AND author_id = $2 LIMIT 1',
    [chatId, ownerId],
  );
  return rowCount > 0;
};

/**
 * Общая проверка «пропускает ли настройка owner-а этого человека».
 *
 * keepOngoing = true означает «не обрывать разговор, который owner вёл
 * сам». Это верно для переписки: выбрав «никто», человек иначе перестал
 * бы получать ответы на собственные сообщения и запер бы себя сам.
 *
 * Для звонков — наоборот, keepOngoing = false: «никто не может мне
 * звонить» значит никто. Отправленное когда-то сообщение не должно
 * давать собеседнику право звонить в любой момент.
 */
const allows = async (ownerId, otherId, setting, { keepOngoing }) => {
  if (ownerId === otherId) return true;
  if (setting === 'all') return true;
  if (setting === 'nobody') {
    return keepOngoing ? spokeInDirect(ownerId, otherId) : false;
  }
  // «контакты»: общая группа либо переписка, в которой owner сам писал.
  return isContact(ownerId, otherId);
};

/** Исключение владельца для человека: 'allow' | 'deny' | null. Решает сервер. */
export const SCOPES = ['write', 'call', 'online', 'gifts', 'music'];
/** Допустимая область исключения: основные, либо раздел профиля (showXxx из VISIBILITY_KEYS). */
export const validScope = (sc) => SCOPES.includes(sc) || VISIBILITY_KEYS.has(sc);
/** Исключения owner для viewer по разделам профиля: { showPhotos: false, … } (deny → false, allow → true). */
export const sectionExceptions = async (ownerId, viewerId) => {
  if (!viewerId || ownerId === viewerId) return {};
  const { rows } = await query('SELECT scope, mode FROM privacy_exceptions WHERE owner_id=$1 AND other_id=$2', [ownerId, viewerId]);
  const out = {};
  for (const r of rows) {
    const key = r.scope === 'gifts' ? 'showGifts' : r.scope === 'music' ? 'showMusic' : r.scope;
    if (VISIBILITY_KEYS.has(key)) out[key] = r.mode === 'allow';
  }
  return out;
};
export const exceptionOf = async (ownerId, otherId, scope) => {
  if (!ownerId || !otherId || ownerId === otherId) return null;
  const { rows } = await query('SELECT mode FROM privacy_exceptions WHERE owner_id=$1 AND other_id=$2 AND scope=$3', [ownerId, otherId, scope]);
  return rows[0]?.mode ?? null;
};

/** Может ли writer написать человеку owner в личной переписке. */
export const mayWriteTo = async (ownerId, writerId) => {
  if (await childWriteDenied(ownerId, writerId)) return false;   // детский режим: только друзья, закрытые чаты
  const exc = await exceptionOf(ownerId, writerId, 'write');
  if (exc) return exc === 'allow';
  const { rows } = await query('SELECT who_can_write FROM profiles WHERE id = $1', [ownerId]);
  return allows(ownerId, writerId, rows[0]?.who_can_write ?? 'all', { keepOngoing: true });
};

/** Может ли caller позвонить человеку owner. */
export const mayCall = async (ownerId, callerId) => {
  const exc = await exceptionOf(ownerId, callerId, 'call');
  if (exc) return exc === 'allow';
  const { rows } = await query('SELECT who_can_call FROM profiles WHERE id = $1', [ownerId]);
  return allows(ownerId, callerId, rows[0]?.who_can_call ?? 'all', { keepOngoing: false });
};

/**
 * Кому из перечисленных видно, что owner в сети.
 *
 * Один запрос на всех: спрашивать про каждого отдельно означало бы
 * запрос на человека при каждом подключении.
 */
const presenceVisibleToBase = async (ownerId, candidates) => {
  if (candidates.length === 0) return [];
  const { rows } = await query('SELECT who_sees_online FROM profiles WHERE id = $1', [ownerId]);
  const setting = rows[0]?.who_sees_online ?? 'all';
  if (setting === 'nobody') return [];
  if (setting === 'all') return candidates;

  const { rows: near } = await query(
    `SELECT DISTINCT y.user_id FROM chat_members x
       JOIN chat_members y ON y.chat_id = x.chat_id
       JOIN chats c        ON c.id = x.chat_id
      WHERE x.user_id = $1 AND y.user_id = ANY($2::text[]) AND c.type <> 'direct'
     UNION
     SELECT DISTINCT y.user_id FROM messages m
       JOIN chat_members y ON y.chat_id = m.chat_id
       JOIN chats c        ON c.id = m.chat_id
      WHERE m.author_id = $1 AND y.user_id = ANY($2::text[]) AND c.type = 'direct'`,
    [ownerId, candidates],
  );
  const contacts = new Set(near.map((r) => r.user_id));
  return candidates.filter((id) => contacts.has(id));
};

export const presenceVisibleTo = async (ownerId, candidates) => {
  const base = await presenceVisibleToBase(ownerId, candidates);
  if (candidates.length === 0) return base;
  const { rows } = await query(`SELECT other_id, mode FROM privacy_exceptions WHERE owner_id=$1 AND scope='online' AND other_id = ANY($2::text[])`, [ownerId, candidates]);
  if (!rows.length) return base;
  const out = new Set(base);
  for (const r of rows) { if (r.mode === 'deny') out.delete(r.other_id); else out.add(r.other_id); }
  return candidates.filter((id) => out.has(id));
};

/**
 * Кого из перечисленных видит owner как «в сети» — то есть чьи
 * настройки его пропускают. Обратная сторона presenceVisibleTo.
 */
const presenceVisibleFromBase = async (viewerId, others) => {
  if (others.length === 0) return [];
  const { rows } = await query(
    `SELECT id, who_sees_online FROM profiles WHERE id = ANY($1::text[])`,
    [others],
  );
  const open = [];
  const needContact = [];
  for (const r of rows) {
    if (r.who_sees_online === 'all') open.push(r.id);
    else if (r.who_sees_online === 'contacts') needContact.push(r.id);
  }
  if (needContact.length === 0) return open;

  // Для каждого «только контактам» проверяем, знаком ли ему смотрящий.
  const { rows: ok } = await query(
    `SELECT DISTINCT x.user_id AS owner FROM chat_members x
       JOIN chat_members y ON y.chat_id = x.chat_id
       JOIN chats c        ON c.id = x.chat_id
      WHERE x.user_id = ANY($1::text[]) AND y.user_id = $2 AND c.type <> 'direct'
     UNION
     SELECT DISTINCT m.author_id AS owner FROM messages m
       JOIN chat_members y ON y.chat_id = m.chat_id
       JOIN chats c        ON c.id = m.chat_id
      WHERE m.author_id = ANY($1::text[]) AND y.user_id = $2 AND c.type = 'direct'`,
    [needContact, viewerId],
  );
  return [...open, ...ok.map((r) => r.owner)];
};

export const presenceVisibleFrom = async (viewerId, others) => {
  const base = await presenceVisibleFromBase(viewerId, others);
  if (others.length === 0) return base;
  const { rows } = await query(`SELECT owner_id, mode FROM privacy_exceptions WHERE other_id=$1 AND scope='online' AND owner_id = ANY($2::text[])`, [viewerId, others]);
  if (!rows.length) return base;
  const out = new Set(base);
  for (const r of rows) { if (r.mode === 'deny') out.delete(r.owner_id); else out.add(r.owner_id); }
  return others.filter((id) => out.has(id));
};

/**
 * Присутствие взаимно: кто видит меня, того вижу и я.
 *
 * Спрятавшись, человек перестаёт видеть и чужое присутствие — иначе
 * настройка давала бы одностороннюю выгоду: сам невидим, а за другими
 * наблюдаешь. Так же устроено в Telegram и WhatsApp.
 *
 * Отсюда и простота: «кого вижу я» и «кто видит меня» — это один и тот
 * же список, пересечение двух направлений.
 */
export const presenceBetween = async (userId, others) => {
  if (others.length === 0) return [];
  const iShow    = new Set(await presenceVisibleTo(userId, others));
  const theyShow = new Set(await presenceVisibleFrom(userId, others));
  return others.filter((id) => iShow.has(id) && theyShow.has(id));
};
