/**
 * Чаты и сообщения в PostgreSQL.
 *
 * До этого WebSocket-хаб держал их в Map внутри процесса: перезапуск
 * стирал переписку, а второй экземпляр API не видел чужих сообщений.
 *
 * Важное правило: каждая функция, отдающая или меняющая данные, принимает
 * userId вызывающего и сама проверяет, что он участник чата. Проверять
 * это в обработчике сообщений нельзя — там легко забыть одну ветку.
 */
import { query, pool } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { claimAttachment, linkAttachment, dropForMessage } from './attachments.mjs';
import { postDenial, contextFor, roleOf, permissionsOf } from './chatadmin.mjs';
import { mayWriteTo } from './privacy.mjs';

/** Потолок участников группы или канала при создании. */
const MAX_PARTICIPANTS = 100;

/** Допустимые идентификаторы чатов, приходящие от клиента. */
const GROUP_ID_RE = /^(group|channel)-[a-z0-9-]{6,40}$/;

/**
 * Идентификатор сообщения задаёт клиент, чтобы сопоставить отправленное с
 * подтверждением. Форму задаём мы: произвольная строка в первичном ключе
 * — это и мусор в базе, и попытка занять чужой идентификатор.
 */
const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Потолок «остальных полей» сообщения (ответ, вложение, опрос).
 *
 * Кадр сокета ограничен 256 КБ, и без отдельного потолка каждое
 * сообщение могло занимать столько же: 240 сообщений в минуту — это
 * 60 МБ, то есть забить диск можно за вечер.
 */
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_TEXT_LENGTH = 8000;

/**
 * Ссылку на вложение задаёт сервер, а не клиент.
 *
 * Раньше она приходила в сообщении и попадала в src и href на страницах
 * других людей — значит любой мог прислать javascript: или ссылку на
 * свой сервер, который узнавал бы адрес каждого, кто открыл переписку.
 * Теперь клиент присылает только идентификатор загруженного файла, а
 * адрес выводится из него: он всегда наш и всегда один и тот же по виду.
 */
const FILE_ID_RE = /^f-[0-9a-f-]{36}$/;
const mediaUrlFor = (fileId) => (FILE_ID_RE.test(String(fileId ?? '')) ? `/api/files/${fileId}` : undefined);

/** Ключи, которые нельзя пускать в объект: они меняют его поведение. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Идентификатор личного чата выводится из пары собеседников, а не
 * придумывается тем, кто открыл переписку первым.
 *
 * Иначе выходило так: Алиса заводит чат «dm-Боб», Боб — «dm-Алиса», и
 * это два разных чата, каждый видит только свою половину разговора.
 * Отсортированная пара даёт обоим один и тот же id.
 */
export const directChatId = (a, b) => `dm-${[String(a), String(b)].sort().join('~')}`;

/** Проверка участия. Основа всех прав в мессенджере. */
export const isMember = async (chatId, userId) => {
  const { rowCount } = await query(
    'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId],
  );
  return rowCount > 0;
};

export const memberIds = async (chatId) => {
  const { rows } = await query('SELECT user_id FROM chat_members WHERE chat_id = $1', [chatId]);
  return rows.map((r) => r.user_id);
};

/**
 * Участники чата с именами и аватарами.
 *
 * Личный чат каждый его участник видит по-разному: у Алисы он называется
 * «Боб», у Боба — «Алиса». Хранить два названия в строке чата нельзя, а
 * рассылать двум людям разные пакеты — лишний источник расхождений.
 * Поэтому сервер отдаёт всем один и тот же список людей, а подпись
 * выбирает клиент, зная, кто из них он сам.
 *
 * Аватара здесь нет намеренно: он хранится картинкой прямо в строке и
 * весит до четверти мегабайта. В группе на сто человек один только
 * список участников весил бы двадцать пять мегабайт — и уходил бы при
 * каждом подключении. Интерфейс рисует кружок с буквой имени.
 */
const PEOPLE_SELECT = `
  (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'username', p.username)
          ORDER BY p.created_at), '[]'::jsonb)
     FROM chat_members cm JOIN profiles p ON p.id = cm.user_id
    WHERE cm.chat_id = c.id) AS people`;

const toChat = (row, viewerRole = undefined) => {
  const people = row.people ?? [];
  const name = decryptContent(row.name);
  const description = row.description ? decryptContent(row.description) : undefined;
  return {
    id: row.id,
    type: row.type,
    // null значит «расшифровать не удалось»: ключ сменили без
    // перешифровки. Показать мусор нельзя, промолчать — тоже.
    name: name ?? '(не удалось прочитать)',
    username: row.username,
    avatar: row.avatar,
    description: description ?? undefined,
    ownerId: row.owner_id ?? undefined,
    people,
    participants: people.map((p) => p.id),
    // Роль спрашивающего: по ней интерфейс решает, что показывать. Сами
    // права всё равно проверяются на сервере при каждом действии.
    myRole: viewerRole ?? row.my_role ?? undefined,
    // Пометки участника: у каждого свои, поэтому едут вместе с ролью.
    markedUnread: Boolean(row.marked_unread),
    pinned:   Boolean(row.pinned),
    archived: Boolean(row.archived),
    muted:    Boolean(row.muted),
    createdAt: row.created_at.toISOString(),
  };
};

/**
 * Довесок сообщения хранится зашифрованным одной строкой в поле «e».
 * Разбираем её обратно в объект; на старых записях поля лежат как есть.
 */
const readPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return {};
  if (typeof payload.e !== 'string') return payload;   // запись до шифрования
  const plain = decryptContent(payload.e);
  if (plain === null) return {};
  try { return JSON.parse(plain); } catch { return {}; }
};

const toMessage = (row) => {
  const extra = readPayload(row.payload);
  return {
  // Поля, специфичные для сообщения, лежат в payload — их набор задаёт
  // фронтенд и меняется чаще, чем схема таблицы.
  ...extra,
  id: row.id,
  chatId: row.chat_id,
  authorId: row.author_id,
  kind: row.kind,
  text: row.deleted ? 'Сообщение удалено' : (decryptContent(row.text) ?? '(не удалось прочитать)'),
  deleted: row.deleted,
  reactions: row.reactions ?? [],
  // Прочитано ли всеми, кроме автора: из этого клиент рисует галочки
  // на своих сообщениях. Считает сервер — у клиента нет списка чужих
  // прочтений, и раньше «прочитано» просто рисовалось по таймеру.
  readByAll: Boolean(row.read_by_all),
  // Прочитано ли ЭТИМ человеком: из этого клиент считает непрочитанные.
  readByMe: Boolean(row.read_by_me),
  editedAt: row.edited_at ? row.edited_at.toISOString() : undefined,
  // Закрепление — свойство сообщения для всех участников, а не пометка
  // в браузере закрепившего.
  pinned: Boolean(row.pinned_at),
  pinnedBy: row.pinned_by ?? undefined,
  // Уникальные читатели: нужны каналам, остальным просто не мешают.
  views: row.views ?? 0,
  createdAt: row.created_at.toISOString(),
  // Адрес вложения собирает сервер — см. mediaUrlFor.
  mediaUrl: row.deleted ? undefined : mediaUrlFor(extra.fileId),
  };
};

/** Чаты пользователя вместе с участниками. */
export const listChats = async (userId) => {
  const { rows } = await query(
    `SELECT c.*, me.role AS my_role, me.marked_unread,
            me.pinned, me.archived, me.muted, ${PEOPLE_SELECT}
       FROM chats c
       JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $1
      ORDER BY c.created_at DESC`,
    [userId],
  );
  // Роль берётся из строки. Писать rows.map(toChat) нельзя: вторым
  // аргументом ушёл бы номер строки и подменил бы роль числом.
  return rows.map((row) => toChat(row));
};

/** Один чат — с проверкой участия. Нужен, чтобы отдать его создателю. */
export const getChat = async (chatId, userId) => {
  const { rows } = await query(
    `SELECT c.*, me.role AS my_role, me.marked_unread,
            me.pinned, me.archived, me.muted, ${PEOPLE_SELECT}
       FROM chats c JOIN chat_members me ON me.chat_id = c.id AND me.user_id = $2
      WHERE c.id = $1`,
    [chatId, userId],
  );
  return rows[0] ? toChat(rows[0]) : null;
};

const MESSAGE_SELECT = `
  SELECT m.*,
         (SELECT count(*)::int FROM message_views v WHERE v.message_id = m.id) AS views,
         coalesce((SELECT jsonb_agg(jsonb_build_object('emoji', g.emoji, 'userIds', g.ids))
                     FROM (SELECT emoji, array_agg(user_id) AS ids
                             FROM message_reactions r WHERE r.message_id = m.id
                            GROUP BY emoji) g), '[]'::jsonb) AS reactions,
         (SELECT count(*) FROM chat_members cm
           WHERE cm.chat_id = m.chat_id AND cm.user_id <> m.author_id)
         = (SELECT count(*) FROM message_reads mr
             WHERE mr.message_id = m.id AND mr.user_id <> m.author_id) AS read_by_all,
         -- Своё прочтение. Без него при каждом подключении все входящие
         -- приходили как непрочитанные, и счётчик воскресал после
         -- перезагрузки страницы.
         EXISTS (SELECT 1 FROM message_reads me
                  WHERE me.message_id = m.id AND me.user_id = VIEWERPARAM) AS read_by_me
    FROM messages m`;

/** Тот же запрос, но с номером параметра под «прочитано мной». */
const selectFor = (viewerParam) => MESSAGE_SELECT.replace('VIEWERPARAM', viewerParam);

/**
 * Сообщения чата. Не участник не получает ничего.
 *
 * before — идентификатор самого старого уже показанного сообщения:
 * с ним отдаётся предыдущая страница. Без него переписка обрывалась на
 * последних пятидесяти сообщениях, и всё, что раньше, было недоступно
 * ни на одном устройстве.
 */
export const listMessages = async (chatId, userId, limit = 50, before = null) => {
  if (!(await isMember(chatId, userId))) return null;
  const size = Math.min(Math.max(Number(limit) || 50, 1), 200);

  const args = [chatId, size, userId];
  let cursor = '';
  if (before) {
    // Курсор — время создания того сообщения, плюс сам id на случай
    // совпадения времени до микросекунды.
    args.push(String(before));
    cursor = `AND (m.created_at, m.id) <
               (SELECT b.created_at, b.id FROM messages b WHERE b.id = $4 AND b.chat_id = $1)`;
  }

  const { rows } = await query(
    `${selectFor('$3')} WHERE m.chat_id = $1 ${cursor}
      ORDER BY m.created_at DESC, m.id DESC LIMIT $2`,
    args,
  );
  return rows.reverse().map(toMessage);
};

/** Одно сообщение по id — уже после того, как право на него проверено. */
const readMessage = async (messageId, viewerId = null) => {
  const { rows } = await query(`${selectFor('$2')} WHERE m.id = $1`, [messageId, viewerId]);
  return rows[0] ? toMessage(rows[0]) : null;
};

/**
 * Создаёт чат и добавляет участников одной транзакцией: чат без
 * участников недоступен даже своему создателю.
 *
 * Идентификатор приходит от клиента, поэтому «создание» чата с чужим
 * id — это попытка войти в чужую переписку. Раньше такая попытка
 * срабатывала: строка чата не вставлялась (ON CONFLICT DO NOTHING), а
 * участники дописывались как ни в чём не бывало. Теперь занятый id
 * означает отказ для всех, кроме тех, кто уже в этом чате.
 */
/**
 * Сколько новых чатов один человек может завести за час.
 *
 * Без этого один аккаунт заводит тысячи переписок со всеми подряд:
 * это и рассылка, и обход правила «звонить можно только тем, с кем есть
 * общий чат». Считаем по базе, а не в памяти процесса, чтобы счётчик
 * переживал перезапуск.
 */
const CHATS_PER_HOUR = 30;

/**
 * Сколько чатов человек ещё может завести.
 *
 * Считается внутри транзакции, уже под блокировкой по создателю: без
 * неё сорок запросов, отправленных разом, все успевали посчитать «ноль
 * созданных» до того, как хоть один из них записался, — и ограничение
 * не работало вовсе.
 */
const chatQuotaLeft = async (client, creatorId) => {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM chats
      WHERE owner_id = $1 AND created_at > now() - interval '1 hour'`,
    [creatorId],
  );
  return CHATS_PER_HOUR - (rows[0]?.n ?? 0);
};

/** Из списка — те, с кем у человека уже есть общий чат. */
const knownTo = async (creatorId, ids) => {
  if (ids.length === 0) return new Set();
  const { rows } = await query(
    `SELECT DISTINCT y.user_id FROM chat_members x
       JOIN chat_members y ON y.chat_id = x.chat_id
      WHERE x.user_id = $1 AND y.user_id = ANY($2::text[])`,
    [creatorId, ids],
  );
  return new Set(rows.map((r) => r.user_id));
};

/**
 * Создаёт чат и добавляет участников одной транзакцией: чат без
 * участников недоступен даже своему создателю.
 *
 * Идентификатор приходит от клиента, поэтому «создание» чата с чужим
 * id — это попытка войти в чужую переписку. Раньше такая попытка
 * срабатывала: строка чата не вставлялась (ON CONFLICT DO NOTHING), а
 * участники дописывались как ни в чём не бывало. Теперь занятый id
 * означает отказ для всех, кроме тех, кто уже в этом чате.
 *
 * В группу можно позвать только тех, с кем уже есть общий чат. Иначе
 * достаточно было создать группу со списком чужих идентификаторов,
 * чтобы получить право писать этим людям и звонить им, — а они об этом
 * согласия не давали. Личный чат — единственный способ начать разговор
 * с новым человеком, и он ограничен числом чатов в час.
 */
export const createChat = async (chat, creatorId) => {
  const type = String(chat?.type ?? '');
  if (!['direct', 'group', 'channel'].includes(type)) return null;

  const others = Array.from(new Set(
    (Array.isArray(chat?.participants) ? chat.participants : [])
      .map(String).filter((id) => id && id !== creatorId),
  ));
  const participants = [creatorId, ...others];
  if (participants.length > MAX_PARTICIPANTS) return null;

  const id = String(chat.id ?? '');
  if (type === 'direct') {
    // Личный чат — ровно двое, и id обязан быть выведен из этой пары.
    if (participants.length !== 2) return null;
    if (id !== directChatId(participants[0], participants[1])) return null;
  } else if (!GROUP_ID_RE.test(id)) {
    return null;
  }

  // Все указанные участники должны существовать: иначе внешний ключ
  // уронит транзакцию уже в середине вставки.
  const { rows: known } = await query(
    'SELECT id FROM profiles WHERE id = ANY($1::text[])', [participants],
  );
  if (known.length !== participants.length) return null;

  if (type !== 'direct' && others.length) {
    const allowed = await knownTo(creatorId, others);
    if (others.some((uid) => !allowed.has(uid))) return null;
  }

  // Настройка собеседника «кто может писать». Проверяется уже здесь, а
  // не только при отправке: иначе тот, кому писать нельзя, всё равно
  // заводил бы пустую переписку, и она появлялась бы в чужом списке.
  if (type === 'direct' && !(await mayWriteTo(others[0], creatorId))) {
    return { error: 'not_accepting' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Блокировка по создателю на время транзакции: одновременные
    // попытки выстраиваются в очередь, и счётчик считает честно.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [creatorId]);
    if (await chatQuotaLeft(client, creatorId) <= 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const { rows: inserted } = await client.query(
      `INSERT INTO chats (id, type, name, username, avatar, description, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [id, type, encryptContent(String(chat.name ?? '').slice(0, 64)),
       String(chat.username ?? '').slice(0, 64),
       String(chat.avatar ?? '').slice(0, 8),
       chat.description ? encryptContent(String(chat.description).slice(0, 512)) : null,
       creatorId],
    );

    if (inserted.length === 0) {
      // Чат с таким id уже есть. Повторное создание допустимо только
      // как идемпотентность для своего же чата — состав участников при
      // этом не меняется.
      const { rowCount } = await client.query(
        'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [id, creatorId],
      );
      if (rowCount === 0) {
        // Кроме одного случая: личный чат, из которого вышли и хотят
        // вернуться. Его идентификатор выведен из пары собеседников,
        // поэтому по нему нельзя попасть в чужую переписку — только в
        // свою собственную.
        const { rows: kind } = await client.query('SELECT type FROM chats WHERE id = $1', [id]);
        if (kind[0]?.type !== 'direct' || id !== directChatId(participants[0], participants[1])) {
          await client.query('ROLLBACK');
          return null;
        }
        await client.query(
          'INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, creatorId],
        );
      }
    } else {
      for (const uid of participants) {
        // Создателю — роль владельца: без неё он не мог бы ни настроить
        // собственную группу, ни написать в собственный канал.
        await client.query(
          `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,$3)
           ON CONFLICT (chat_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
          [id, uid, uid === creatorId ? 'owner' : 'member'],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return getChat(id, creatorId);
};

/**
 * Поля, которые задаёт только сервер. Клиент присылает сообщение целиком,
 * вместе с тем, как оно выглядит у него: «моё», «прочитано», время по
 * его часам. Если сохранить это как есть, получатель увидит чужое
 * сообщение помеченным как своё, а отправитель — «прочитано» до того,
 * как его кто-либо открыл.
 */
/**
 * Виды сообщений, которые клиент вправе прислать. Прочее — просто текст.
 *
 * 'system' сюда не входит намеренно: такие сообщения интерфейс рисует
 * без автора, посреди ленты, как уведомление от самого приложения.
 * Разреши его — и любой прислал бы «Администратор просит подтвердить
 * вход» от имени сервиса.
 */
const KINDS = new Set([
  'text', 'photo', 'voice', 'video-note', 'file',
  'pet', 'gift', 'prime_gift', 'poll', 'location',
]);

const SERVER_OWNED = new Set([
  'id', 'chatId', 'authorId', 'kind', 'text', 'createdAt',
  'fromMe', 'status', 'time', 'timestamp', 'reactions', 'readByAll',
  'deleted', 'editedAt', 'pinned', 'favorited', 'viewedBy',
  // Адрес вложения выводится из fileId — присланный клиентом
  // отбрасывается целиком.
  'mediaUrl',
]);

/**
 * Сохраняет сообщение. Автор берётся из сессии, а не из тела: иначе
 * можно было бы написать в чат от чужого имени.
 */
/**
 * Отказ по настройке «кто может писать» у собеседника.
 *
 * Настройка принадлежит получателю и проверяется на сервере: у
 * отправителя её в браузере нет и быть не должно.
 */
const directWriteDenied = async (chatId, authorId) => {
  const { rows } = await query('SELECT type FROM chats WHERE id = $1', [chatId]);
  if (rows[0]?.type !== 'direct') return null;
  const { rows: others } = await query(
    'SELECT user_id FROM chat_members WHERE chat_id = $1 AND user_id <> $2',
    [chatId, authorId],
  );
  for (const { user_id: peer } of others) {
    if (!(await mayWriteTo(peer, authorId))) return 'not_accepting';
  }
  return null;
};

export const saveMessage = async (chatId, authorId, msg) => {
  if (!(await isMember(chatId, authorId))) return null;
  // Запрет проверяется на сервере: раньше «заблокировать» лишь прятало
  // сообщения в браузере получателя, а доходили они по-прежнему.
  if (await blockedInChat(chatId, authorId)) return null;

  // Правила группы и канала — одним местом на все ветки: канал только
  // для админов, ограничения участника, антифлуд, медленный режим,
  // запрет ссылок. Отправитель узнаёт причину: она не секрет и без неё
  // непонятно, почему сообщение не ушло.
  const denial = await postDenial(chatId, authorId, msg?.text);
  if (denial) return { error: denial };

  // Настройка получателя «кто может писать» — только для личных чатов:
  // в группе право писать определяют её собственные правила, и они уже
  // проверены выше.
  const closed = await directWriteDenied(chatId, authorId);
  if (closed) return { error: closed };

  const id = String(msg?.id ?? '');
  // Идентификатор произвольной формы — это мусор в первичном ключе и
  // попытка занять чужой; форму задаёт сервер, а не клиент.
  if (!MESSAGE_ID_RE.test(id)) return null;

  const text = String(msg?.text ?? '').slice(0, MAX_TEXT_LENGTH);
  const kind = KINDS.has(msg?.kind) ? msg.kind : 'text';

  // Всё, кроме колонок таблицы, едет в payload. Оттуда выбрасываем то,
  // что задаёт только сервер, опасные ключи и всё, что не помещается в
  // потолок: иначе одно сообщение могло весить как весь кадр сокета.
  const rest = {};
  for (const [key, value] of Object.entries(msg ?? {})) {
    if (SERVER_OWNED.has(key) || FORBIDDEN_KEYS.has(key)) continue;
    if (key === 'fileName' || key === 'mimeType') {
      rest[key] = String(value ?? '').slice(0, 255);
      continue;
    }
    rest[key] = value;
  }
  if (Buffer.byteLength(JSON.stringify(rest)) > MAX_PAYLOAD_BYTES) return null;

  // Вложение остаётся в сообщении, только если оно действительно своё,
  // из этого же чата и ещё ни к чему не приложено. Иначе идентификатор
  // выбрасывается: подставить в своё сообщение чужой файл нельзя.
  const fileId = FILE_ID_RE.test(String(rest.fileId ?? '')) ? String(rest.fileId) : null;
  delete rest.fileId;

  const client = await pool.connect();
  let savedId = null;
  try {
    await client.query('BEGIN');

    // Сначала занимаем файл, потом пишем сообщение: внешний ключ не даст
    // сослаться на сообщение, которого ещё нет, а блокировка не даст
    // приложить один файл к двум сообщениям.
    const claimed = fileId && await claimAttachment(client, fileId, { chatId, ownerId: authorId });
    if (claimed) rest.fileId = fileId;

    // Содержимое ложится в базу зашифрованным: дамп без ключа бесполезен.
    const { rows } = await client.query(
      `INSERT INTO messages (id, chat_id, author_id, kind, text, payload)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [id, chatId, authorId, kind, encryptContent(text), { e: encryptContent(JSON.stringify(rest)) }],
    );
    savedId = rows[0]?.id ?? null;
    // Такой id уже занят — не пишем ничего и не отнимаем файл.
    if (!savedId) { await client.query('ROLLBACK'); return null; }

    if (claimed) await linkAttachment(client, fileId, savedId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return readMessage(savedId, authorId);
};

/** Правит текст. Чужие сообщения не редактируются. */
export const editMessage = async (messageId, authorId, text) => {
  const { rows } = await query(
    `UPDATE messages SET text = $3, edited_at = now()
      WHERE id = $1 AND author_id = $2 AND NOT deleted
      RETURNING id, chat_id, edited_at`,
    [String(messageId ?? ''), authorId, encryptContent(String(text ?? '').slice(0, MAX_TEXT_LENGTH))],
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, chatId: rows[0].chat_id, editedAt: rows[0].edited_at.toISOString() };
};

/**
 * Помечает удалённым. Текст затирается в самой строке, а не скрывается
 * на клиенте: иначе он остался бы доступен любому, кто смотрит ответ API.
 */
export const deleteMessage = async (messageId, actorId) => {
  // Своё сообщение удаляет автор; чужое — тот, кому это позволено
  // ролью в этом же чате. Право проверяется здесь, а не на клиенте.
  const { rows: found } = await query(
    'SELECT chat_id, author_id FROM messages WHERE id = $1 AND NOT deleted',
    [String(messageId ?? '')],
  );
  if (!found[0]) return null;
  if (found[0].author_id !== actorId) {
    const ctx = await contextFor(found[0].chat_id, actorId);
    if (!ctx || !ctx.can.deleteOthers) return null;
  }

  const { rows } = await query(
    `UPDATE messages SET deleted = TRUE, text = '', payload = '{}'::jsonb,
                         pinned_at = NULL, pinned_by = NULL
      WHERE id = $1
      RETURNING id, chat_id`,
    [String(messageId ?? '')],
  );
  if (!rows[0]) return null;
  await query('DELETE FROM message_reactions WHERE message_id = $1', [messageId]);
  // Вложение удаляется вместе с сообщением: иначе оно осталось бы
  // доступным по прямой ссылке после «удалить у всех».
  await dropForMessage(rows[0].id);
  return { id: rows[0].id, chatId: rows[0].chat_id };
};

/**
 * Ставит или снимает реакцию.
 *
 * Раньше реакции жили только в браузере и рассылались по сокету: после
 * перезагрузки страницы их не было, а второе устройство того же
 * человека не видело их никогда.
 */
export const toggleReaction = async (messageId, userId, emoji) => {
  const clean = String(emoji ?? '').slice(0, 16);
  if (!clean) return null;

  const { rows } = await query(
    `SELECT m.chat_id FROM messages m
       JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = $2
      WHERE m.id = $1 AND NOT m.deleted`,
    [messageId, userId],
  );
  if (!rows[0]) return null;

  const { rowCount } = await query(
    'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
    [messageId, userId, clean],
  );
  if (rowCount === 0) {
    await query(
      `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [messageId, userId, clean],
    );
  }
  return { chatId: rows[0].chat_id, emoji: clean, removed: rowCount > 0 };
};

/**
 * Отмечает чужие сообщения чата прочитанными. Возвращает id тех, чей
 * статус изменился: только по ним нужно оповещать авторов.
 */
/** Сколько сообщений отмечаем прочитанными за один раз. */
const READ_BATCH = 200;

/**
 * Отмечает чужие сообщения чата прочитанными. Возвращает id тех, чей
 * статус изменился: только по ним нужно оповещать авторов.
 *
 * Отбираем именно непрочитанное и не больше пачки за раз: раньше запрос
 * перебирал весь чат целиком на каждый вызов, а вызвать его можно было
 * сотни раз в минуту — на большом канале это укладывало базу.
 */
export const markRead = async (chatId, userId) => {
  if (!(await isMember(chatId, userId))) return null;
  // Прочитали — значит пометка «оставить непрочитанным» снимается.
  await query(
    'UPDATE chat_members SET marked_unread = FALSE WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId],
  );
  const { rows } = await query(
    `INSERT INTO message_reads (message_id, user_id)
     SELECT m.id, $2 FROM messages m
      WHERE m.chat_id = $1 AND m.author_id <> $2
        AND NOT EXISTS (SELECT 1 FROM message_reads r
                         WHERE r.message_id = m.id AND r.user_id = $2)
      ORDER BY m.created_at DESC
      LIMIT $3
     ON CONFLICT DO NOTHING
     RETURNING message_id`,
    [chatId, userId, READ_BATCH],
  );
  return rows.map((r) => r.message_id);
};

/** Какие пометки участник вправе менять у себя. */
const MEMBER_FLAGS = new Set(['pinned', 'archived', 'muted']);

/**
 * Закрепление, архив и звук. Пометки принадлежат участнику: меняя их,
 * человек меняет только свой вид чата и ничей больше.
 */
export const setChatFlags = async (chatId, userId, patch = {}) => {
  const sets = [];
  const args = [chatId, userId];
  for (const [key, value] of Object.entries(patch)) {
    if (!MEMBER_FLAGS.has(key)) continue;
    args.push(Boolean(value));
    sets.push(`${key} = $${args.length}`);
  }
  if (sets.length === 0) return false;
  const { rowCount } = await query(
    `UPDATE chat_members SET ${sets.join(', ')} WHERE chat_id = $1 AND user_id = $2`,
    args,
  );
  return rowCount > 0;
};

/**
 * «Пометить как новое» — свойство участника чата, а не сообщения:
 * человек помечает непрочитанной всю переписку целиком. Хранится на
 * сервере, поэтому пометка видна на всех его устройствах.
 */
export const setMarkedUnread = async (chatId, userId, value) => {
  const { rowCount } = await query(
    'UPDATE chat_members SET marked_unread = $3 WHERE chat_id = $1 AND user_id = $2',
    [chatId, userId, Boolean(value)],
  );
  return rowCount > 0;
};

/* ─── Блокировки ───────────────────────────────────────────────────────── */
/**
 * «Заблокировать» должно означать, что сообщения не доходят, а не что
 * их прячет браузер получателя. Проверка стоит на записи: отправитель
 * не узнаёт, что его заблокировали, — сообщение просто не сохраняется.
 */
export const blockUser = async (blockerId, blockedId) => {
  if (!blockerId || !blockedId || blockerId === blockedId) return false;
  const { rowCount } = await query(
    'SELECT 1 FROM profiles WHERE id = $1', [blockedId],
  );
  if (rowCount === 0) return false;
  await query(
    `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)
     ON CONFLICT DO NOTHING`, [blockerId, blockedId],
  );
  return true;
};

export const unblockUser = async (blockerId, blockedId) => {
  await query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]);
  return true;
};

export const listBlocked = async (blockerId) => {
  const { rows } = await query(
    'SELECT blocked_id FROM blocks WHERE blocker_id = $1', [blockerId],
  );
  return rows.map((r) => r.blocked_id);
};

/** Есть ли запрет в любую сторону между двумя людьми. */
export const blockedBetween = async (a, b) => {
  const { rowCount } = await query(
    `SELECT 1 FROM blocks
      WHERE (blocker_id = $1 AND blocked_id = $2)
         OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`,
    [a, b],
  );
  return rowCount > 0;
};

/**
 * Кто из участников личного чата запретил автору писать.
 *
 * В группе запрет не действует: там переписка общая, и уход одного
 * человека — это выход из чата, а не запрет всем остальным.
 */
const blockedInChat = async (chatId, authorId) => {
  const { rowCount } = await query(
    `SELECT 1 FROM chats c
       JOIN chat_members m ON m.chat_id = c.id AND m.user_id <> $2
       JOIN blocks b ON (b.blocker_id = m.user_id AND b.blocked_id = $2)
                     OR (b.blocker_id = $2 AND b.blocked_id = m.user_id)
      WHERE c.id = $1 AND c.type = 'direct' LIMIT 1`,
    [chatId, authorId],
  );
  return rowCount > 0;
};

/* ─── Состав чата ──────────────────────────────────────────────────────── */
/**
 * Добавляет участника в существующую группу.
 *
 * Право на это есть у владельца чата, и позвать можно только того, с
 * кем у зовущего уже есть общий чат, — то же правило, что и при
 * создании группы. Иначе через «добавить» обходилось бы ограничение,
 * поставленное при создании.
 */
export const addMember = async (chatId, actorId, userId) => {
  const { rows } = await query(
    `SELECT c.type, m.role FROM chats c
       JOIN chat_members m ON m.chat_id = c.id AND m.user_id = $2
      WHERE c.id = $1`,
    [chatId, actorId],
  );
  const chat = rows[0];
  if (!chat) return { error: 'not_found' };
  if (chat.type === 'direct') return { error: 'not_allowed' };
  if (chat.role !== 'owner' && chat.role !== 'admin') return { error: 'not_allowed' };

  const { rows: count } = await query(
    'SELECT count(*)::int AS n FROM chat_members WHERE chat_id = $1', [chatId],
  );
  if ((count[0]?.n ?? 0) >= MAX_PARTICIPANTS) return { error: 'chat_full' };

  const allowed = await knownTo(actorId, [String(userId)]);
  if (!allowed.has(String(userId))) return { error: 'not_allowed' };

  await query(
    'INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [chatId, String(userId)],
  );
  return { chat: await getChat(chatId, actorId) };
};

/**
 * Выход из чата.
 *
 * Из личного чата уходит только ушедший: у собеседника переписка
 * остаётся. Удалять её у обоих значило бы дать любому право стереть
 * общую историю в одностороннем порядке. Вернуться можно — открыв тот
 * же чат заново: его идентификатор выведен из пары собеседников, и
 * никого третьего он впустить не может.
 *
 * Владелец группы, выходя, распускает её целиком: оставлять чат без
 * хозяина некому.
 */
export const leaveChat = async (chatId, userId) => {
  const { rows } = await query(
    `SELECT c.type, c.owner_id,
            (SELECT array_agg(user_id) FROM chat_members WHERE chat_id = c.id) AS members
       FROM chats c JOIN chat_members m ON m.chat_id = c.id AND m.user_id = $2
      WHERE c.id = $1`,
    [chatId, userId],
  );
  const chat = rows[0];
  if (!chat) return null;

  const members = chat.members ?? [];
  const dissolve = chat.type !== 'direct' && chat.owner_id === userId;

  if (dissolve) {
    // Каскад удалит участников, сообщения, реакции и вложения.
    await query('DELETE FROM chats WHERE id = $1', [chatId]);
  } else {
    await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
  }
  return { members, dissolved: dissolve };
};
