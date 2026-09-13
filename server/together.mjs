/**
 * Sky «Вместе»: совместный просмотр и совместное прослушивание.
 *
 * Здесь живут права и состояние. Всё, что решает «можно ли», решается в
 * этом файле, а не в маршрутах и не в сокете: те два входа разные, а
 * правило должно быть одно. Маршрут и сокет умеют только спросить.
 *
 * Три вещи, которые стоит знать до чтения кода.
 *
 * 1. Закрытая сессия — это не «ссылка, которую никому не давали».
 *    Право войти даёт строка в together_participants. Знание
 *    идентификатора сессии не даёт ничего: чужая сессия отвечает ровно
 *    то же, что несуществующая, и по ответу их не различить.
 *
 * 2. Сервер не раздаёт медиа. Ни один байт фильма или трека через
 *    «Вместе» не проходит. Сервер держит состояние — играет или нет,
 *    какая позиция, какой трек — и решает, кому можно это состояние
 *    менять. Файл каждый тянет сам, своим пропуском, и права на файл
 *    проверяет модуль кино или музыки, как при одиночном просмотре.
 *    Поэтому «Вместе» не может стать обходом чужих ограничений: оно не
 *    участвует в выдаче.
 *
 * 3. Позиция хранится парой «сколько было + когда это было». Текущая
 *    позиция считается из неё в любой миг, и вошедшему на сороковой
 *    минуте сервер отдаёт сороковую минуту, а не ноль. Та же пара даёт
 *    поправку на задержку: клиент знает, когда спросил, и знает время
 *    сервера в ответе.
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { visibleMovie, readMovie } from './film.mjs';
import { visibleTrack, readTrack, readPlaylist } from './music.mjs';
import { hasPrime } from './skyid.mjs';
import { isAdmin } from './admin.mjs';

/* ─── Пределы ───────────────────────────────────────────────────────
   Все до единого живут на сервере. Клиент их показывает, но не
   устанавливает: число в браузере правится за десять секунд.        */

/** Сколько человек в сессии по умолчанию. */
export const MAX_PARTICIPANTS_DEFAULT = Number(process.env.TOGETHER_MAX_PARTICIPANTS || 10);
/** Выше этого не поднимет никто: столько же стоит в CHECK у таблицы. */
export const MAX_PARTICIPANTS_HARD = 100;
/** Столько незавершённых сессий держит один человек. Без предела создание сессий становится способом занять базу. */
export const MAX_LIVE_PER_OWNER = 5;
/** Срок годности приглашения. Смотреть кино «на той неделе» не зовут. */
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
/** Длина очереди: альбом и плейлист бывают большими, но не бесконечными. */
export const MAX_QUEUE = 200;
/** Столько живёт сессия, в которой никто ничего не делает. */
const IDLE_END_MS = 12 * 60 * 60 * 1000;

const MAX_TITLE = 80;

export const SESSION_ID_RE = /^tg-[0-9a-f-]{36}$/;
export const INVITE_ID_RE  = /^tgi-[0-9a-f-]{36}$/;

/** Какой вид содержимого к какому виду сессии. */
const KINDS_FOR_TYPE = {
  watch:  ['movie'],
  listen: ['track', 'album', 'playlist'],
};

export const SESSION_TYPES = Object.keys(KINDS_FOR_TYPE);

/** Роли, которым можно управлять воспроизведением всегда. */
const CONTROL_ROLES = ['owner', 'host', 'moderator'];

/* ─── Мелкие помощники ─────────────────────────────────────────────── */

const text = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

/**
 * Целое в границах — или null.
 *
 * Пустая строка, null и объект целым не считаются. Без этой проверки
 * Number('') дал бы ноль, и «не прислали» стало бы «прислали ноль» —
 * ошибка, на которой уже обжигались в билетах.
 */
const int = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean' || typeof v === 'object') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
};

const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128;

/* ─── Журнал ────────────────────────────────────────────────────────
   Пишем, кто что сделал и кому отказано. Не пишем: секретов
   приглашений и содержимого разговора.                              */

export const logTogether = async (sessionId, actorId, event, detail = {}) => {
  try {
    await query(
      'INSERT INTO together_log (session_id, actor_id, event, detail) VALUES ($1,$2,$3,$4)',
      [sessionId, actorId ?? null, text(event, 64), JSON.stringify(detail ?? {})],
    );
  } catch {
    /* Журнал не должен ронять то, что он описывает. */
  }
};

/* ─── Содержимое ────────────────────────────────────────────────────
   Единственное место, где «Вместе» разговаривает с кино и музыкой. И
   разговаривает только вопросами: «можно ли этому человеку», «как
   называется», «сколько длится». Ничего не меняет.                  */

/**
 * Разрешить содержимое в очередь.
 *
 * Возвращает { title, queue } или { error }. В очередь попадает только
 * опубликованное — и вот почему. Очередь общая на всех: если бы каждый
 * разворачивал альбом по своим правам, у владельца в ней было бы шесть
 * треков, а у гостя четыре, и «следующий трек» означал бы у них разное.
 * Поэтому очередь считается один раз, на сервере, и одинаково для всех.
 */
const resolveContent = async (type, kind, contentId, ownerId) => {
  if (!KINDS_FOR_TYPE[type]?.includes(kind)) return { error: 'bad_content_kind' };
  if (!isId(contentId)) return { error: 'bad_content' };

  if (kind === 'movie') {
    const movie = await readMovie(contentId, ownerId);
    if (!movie) return { error: 'content_not_found' };
    if (movie.bytes <= 0) return { error: 'content_not_ready' };

    /*
     * Что можно показать в сеансе.
     *
     * Опубликованное — всем: оно и так в каталоге.
     *
     * Личную загрузку — только свою. «Мне показали, а я показал
     * дальше» не проходит: у того, кому показывают, own ложно, и
     * пересобрать чужую запись в собственный сеанс он не может. Это
     * единственное место, где такая цепочка могла бы начаться, и она
     * обрывается здесь.
     *
     * Отправленное на проверку и отклонённое проверкой — нельзя ни в
     * каком виде. Отклонённое особенно: иначе совместный просмотр стал
     * бы способом раздавать ровно то, что модерация не пропустила.
     */
    if (movie.status !== 'published') {
      if (!movie.own) return { error: 'content_forbidden' };
      if (movie.status !== 'private') return { error: 'content_not_shareable' };
    }

    return {
      title: movie.title,
      queue: [{ id: movie.id, ms: Math.max(0, Math.round(Number(movie.duration || 0) * 1000)) }],
    };
  }

  if (kind === 'track') {
    const track = await readTrack(contentId, ownerId);
    if (!track) return { error: 'content_not_found' };
    if (track.status !== 'published') return { error: 'content_private' };
    return {
      title: `${track.artist} — ${track.title}`,
      queue: [{ id: track.id, ms: Math.max(0, Math.round(Number(track.duration || 0) * 1000)) }],
    };
  }

  if (kind === 'album') {
    const name = text(contentId, 200);
    if (!name) return { error: 'bad_content' };
    const { rows } = await query(
      `SELECT id, duration_sec FROM music_tracks
        WHERE album = $1 AND status = 'published'
        ORDER BY year NULLS LAST, title
        LIMIT ${MAX_QUEUE}`,
      [name],
    );
    if (rows.length === 0) return { error: 'content_not_found' };
    return {
      title: name,
      queue: rows.map((r) => ({ id: r.id, ms: Math.max(0, Math.round(Number(r.duration_sec || 0) * 1000)) })),
    };
  }

  if (kind === 'playlist') {
    const list = await readPlaylist(contentId, ownerId);
    if (!list) return { error: 'content_not_found' };
    const shared = (list.tracks ?? []).filter((t) => t.status === 'published').slice(0, MAX_QUEUE);
    /* Личные треки владельца из общей очереди выпадают: остальным их
       всё равно не отдадут. Молча подменять список было бы хуже —
       отвечаем честно, что делить нечего. */
    if (shared.length === 0) return { error: 'content_private' };
    return {
      title: list.name || 'Плейлист',
      queue: shared.map((t) => ({ id: t.id, ms: Math.max(0, Math.round(Number(t.duration || 0) * 1000)) })),
    };
  }

  return { error: 'bad_content_kind' };
};

/**
 * Может ли этот человек смотреть или слушать то, что стоит в очереди.
 *
 * Спрашивается у кино и у музыки — у тех, кто и так решает это для
 * одиночного просмотра. Проверяется на каждом входе, а не один раз при
 * приглашении: права меняются, и снятый с публикации фильм не должен
 * оставаться доступным через вчерашнее приглашение.
 */
const mayUseContent = async (row, userId) => {
  const queue = Array.isArray(row.queue) ? row.queue : [];
  if (queue.length === 0) return false;

  /* Кино и музыка входят в Sky Prime, и выдача файлов спрашивает про
     подписку у каждого запроса. Без этой проверки «Вместе» стало бы
     обходом: человек без подписки попадал бы в сессию, видел состояние
     и название фильма — а сам файл ему всё равно не отдали бы. Отказ
     на входе честнее и совпадает с правилом того модуля, чьё это
     содержимое. Администратор проходит там, пройдёт и здесь. */
  if (!(await hasPrime(userId)) && !(await isAdmin(userId))) return false;

  if (row.content_kind === 'movie') {
    /*
     * Смотрим глазами владельца сеанса, а не самого участника, и это
     * не послабление. Вопрос здесь один: можно ли ЭТО показывать в
     * ЭТОМ сеансе. Право же самого человека быть в сеансе уже
     * установлено — без строки участника сюда не попадают.
     *
     * Спрашивать глазами участника было бы и неверно: у позванного,
     * который ещё не вошёл, пропуска на личную загрузку нет по
     * определению, и позвать его на своё кино стало бы невозможно.
     */
    const movie = await visibleMovie(queue[0].id, row.owner_id);
    if (!movie) return false;
    if (movie.status === 'published') return true;
    return movie.status === 'private' && movie.owner_id === row.owner_id;
  }
  /* Музыка: право нужно на текущий трек. Остальные проверятся, когда до
     них дойдёт очередь, — к тому времени права могут и измениться. */
  const idx = Math.min(Math.max(0, Number(row.queue_index) || 0), queue.length - 1);
  const track = await visibleTrack(queue[idx].id, userId);
  return Boolean(track) && track.status === 'published';
};

/**
 * Показывает ли этот сеанс личную загрузку своего владельца.
 *
 * От ответа зависит, что делать, когда владелец выходит: обычный сеанс
 * переживает это со сменой владельца, а показ личной записи —
 * заканчивается вместе с тем, кто её показывал.
 */
const ownsPrivateContent = async (row) => {
  if (row.content_kind !== 'movie') return false;
  const queue = Array.isArray(row.queue) ? row.queue : [];
  if (queue.length === 0) return false;
  const { rows } = await query(
    "SELECT 1 FROM film_movies WHERE id = $1 AND owner_id = $2 AND status = 'private'",
    [queue[0].id, row.owner_id],
  );
  return rows.length > 0;
};

/* ─── Состояние воспроизведения ─────────────────────────────────────── */

const durationOf = (row) => {
  const queue = Array.isArray(row.queue) ? row.queue : [];
  const idx = Number(row.queue_index) || 0;
  return Math.max(0, Number(queue[idx]?.ms ?? 0));
};

/**
 * Где сейчас находится воспроизведение.
 *
 * Пока идёт — к записанной позиции прибавляется время, прошедшее с
 * момента записи, с поправкой на скорость. Остановленное никуда не
 * уходит. Дальше конца не убегает: иначе вошедший после окончания
 * получил бы позицию больше длительности.
 */
export const positionNow = (row) => {
  const base = Math.max(0, Number(row.position_ms) || 0);
  const dur = durationOf(row);
  let pos = base;
  if (row.playing && row.status === 'live') {
    const at = new Date(row.position_at).getTime();
    const elapsed = Number.isFinite(at) ? Date.now() - at : 0;
    pos = base + Math.round(Math.max(0, elapsed) * (Number(row.rate) || 1));
  }
  if (dur > 0) pos = Math.min(pos, dur);
  return Math.max(0, pos);
};

/** Кому можно трогать воспроизведение. */
export const mayControl = (row, part) => {
  if (!part || part.status !== 'joined') return false;
  if (CONTROL_ROLES.includes(part.role)) return true;
  return row.settings?.control === 'all';
};

/* ─── Представление наружу ─────────────────────────────────────────── */

/**
 * Что уходит клиенту.
 *
 * Ни отпечатков приглашений, ни чужих внутренних отметок. Поля «моя
 * роль» и «мой статус» проставляются тому, кто спрашивает, — это ответ
 * ему, а не сведения о сессии.
 */
export const toSession = (row, part = null) => ({
  id: row.id,
  type: row.session_type,
  contentKind: row.content_kind,
  contentId: row.content_id,
  title: row.title,
  status: row.status,
  ownerId: row.owner_id,
  control: row.settings?.control === 'all' ? 'all' : 'owner',
  maxParticipants: Number(row.max_participants),
  queue: (Array.isArray(row.queue) ? row.queue : []).map((q) => ({ id: q.id, ms: Number(q.ms) || 0 })),
  queueIndex: Number(row.queue_index) || 0,
  playing: Boolean(row.playing) && row.status === 'live',
  positionMs: positionNow(row),
  durationMs: durationOf(row),
  rate: Number(row.rate) || 1,
  seq: Number(row.state_seq) || 0,
  /* Время сервера в ответе: по нему клиент считает поправку на
     задержку — он знает, когда спросил. */
  serverTime: Date.now(),
  createdAt: row.created_at?.toISOString?.() ?? undefined,
  startedAt: row.started_at?.toISOString?.() ?? undefined,
  endedAt: row.ended_at?.toISOString?.() ?? undefined,
  myRole: part?.role ?? undefined,
  myStatus: part?.status ?? undefined,
  isOwner: Boolean(part && part.role === 'owner'),
  canControl: mayControl(row, part),
});

/**
 * Состояние воспроизведения без всего личного.
 *
 * Именно это уходит в рассылку. Полный вид сессии рассылать нельзя: в
 * нём есть «моя роль» и «мне можно управлять», посчитанные для того,
 * кто прислал команду. Разослав его всем, мы сообщили бы каждому, что
 * он владелец, — ровно та ошибка, из-за которой в чатах приглашённый
 * когда-то получал кнопки управления.
 *
 * Здесь только то, что у всех одинаково: что играет, где и с какой
 * скоростью. Свою роль клиент уже знает — он получил её при входе.
 */
export const playbackOf = (row) => ({
  sessionId: row.id,
  status: row.status,
  queue: (Array.isArray(row.queue) ? row.queue : []).map((q) => ({ id: q.id, ms: Number(q.ms) || 0 })),
  queueIndex: Number(row.queue_index) || 0,
  playing: Boolean(row.playing) && row.status === 'live',
  positionMs: positionNow(row),
  durationMs: durationOf(row),
  rate: Number(row.rate) || 1,
  seq: Number(row.state_seq) || 0,
  serverTime: Date.now(),
});

/* ─── Чтение строк ─────────────────────────────────────────────────── */

const sessionRow = async (sessionId) => {
  if (!SESSION_ID_RE.test(String(sessionId ?? ''))) return null;
  const { rows } = await query('SELECT * FROM together_sessions WHERE id = $1', [sessionId]);
  return rows[0] ?? null;
};

const partRow = async (sessionId, userId) => {
  if (!SESSION_ID_RE.test(String(sessionId ?? '')) || !isId(userId)) return null;
  const { rows } = await query(
    'SELECT * FROM together_participants WHERE session_id = $1 AND user_id = $2',
    [sessionId, userId],
  );
  return rows[0] ?? null;
};

/**
 * Сессия глазами участника — или null.
 *
 * Единственная дверь к строке сессии для всех остальных функций.
 * Отказ здесь всегда выглядит одинаково: null. Ни «нет такой», ни «есть,
 * но не для вас» — разница в ответах сама по себе рассказывает о чужих
 * сессиях больше, чем следует.
 */
export const accessSession = async (sessionId, userId) => {
  const row = await sessionRow(sessionId);
  if (!row) return null;
  const part = await partRow(sessionId, userId);
  if (!part) return null;
  /* Отказавшегося и удалённого сессия не касается. Вышедший её всё ещё
     помнит: он в ней был, и в истории она у него есть. */
  if (part.status === 'declined' || part.status === 'removed') return null;
  return { row, part };
};

export const readSession = async (sessionId, userId) => {
  const found = await accessSession(sessionId, userId);
  return found ? toSession(found.row, found.part) : null;
};

/* ─── Участники ────────────────────────────────────────────────────── */

/**
 * Список участников с именами.
 *
 * Имена берутся здесь, а не через общий справочник людей: тот отдаёт
 * только тех, с кем есть общий чат, а в сессию зовут и тех, с кем
 * переписки нет. Показываем ровно то же, что видно в переписке: имя,
 * ник, идентификатор. Ни почты, ни телефона.
 */
export const participantsOf = async (sessionId, viewerId) => {
  const found = await accessSession(sessionId, viewerId);
  if (!found) return null;
  const { rows } = await query(
    `SELECT tp.user_id, tp.role, tp.status, tp.invited_at, tp.joined_at, tp.left_at,
            p.name, p.username
       FROM together_participants tp
       JOIN profiles p ON p.id = tp.user_id
      WHERE tp.session_id = $1
      ORDER BY tp.role = 'owner' DESC, tp.invited_at`,
    [sessionId],
  );
  return rows.map((r) => ({
    id: r.user_id,
    name: r.name,
    username: r.username,
    role: r.role,
    status: r.status,
    invitedAt: r.invited_at?.toISOString?.() ?? undefined,
    joinedAt: r.joined_at?.toISOString?.() ?? undefined,
    leftAt: r.left_at?.toISOString?.() ?? undefined,
  }));
};

/** Кому рассылать события: те, кто сейчас внутри. */
export const liveMemberIds = async (sessionId) => {
  const { rows } = await query(
    "SELECT user_id FROM together_participants WHERE session_id = $1 AND status = 'joined'",
    [sessionId],
  );
  return rows.map((r) => r.user_id);
};

/* ─── Создание ─────────────────────────────────────────────────────── */

export const createSession = async (ownerId, input = {}) => {
  const type = String(input.type ?? '');
  if (!KINDS_FOR_TYPE[type]) return { error: 'bad_type' };

  /* Та же подписка, что и на одиночный просмотр: «Вместе» ничего не
     открывает сверх того, что человеку и так доступно. */
  if (!(await hasPrime(ownerId)) && !(await isAdmin(ownerId))) return { error: 'prime_required' };

  const kind = String(input.contentKind ?? '');
  const resolved = await resolveContent(type, kind, input.contentId, ownerId);
  if (resolved.error) return resolved;

  const max = int(input.maxParticipants, 2, MAX_PARTICIPANTS_HARD) ?? MAX_PARTICIPANTS_DEFAULT;
  const control = input.control === 'all' ? 'all' : 'owner';
  const title = text(input.title, MAX_TITLE) || resolved.title;

  /* Незавершённых сессий у одного человека — не больше пяти. Считаем до
     вставки и внутри той же транзакции, иначе десяток одновременных
     запросов проскочит проверку все разом. */
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    /* Замок на самого владельца, а не на строки.
       Считать незавершённые сессии «с блокировкой строк» нельзя: FOR
       UPDATE не работает вместе с подсчётом, да и блокировать было бы
       нечего — новая строка ещё не создана, и два запроса, идущие
       одновременно, не видят друг друга. Замок по владельцу
       выстраивает их в очередь и снимается вместе с транзакцией. */
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`together:${ownerId}`]);
    const { rows: live } = await client.query(
      `SELECT count(*)::int AS n FROM together_sessions
        WHERE owner_id = $1 AND status <> 'ended'`,
      [ownerId],
    );
    if ((live[0]?.n ?? 0) >= MAX_LIVE_PER_OWNER) {
      await client.query('ROLLBACK');
      return { error: 'too_many_sessions' };
    }

    const id = `tg-${generateId()}`;
    const { rows } = await client.query(
      `INSERT INTO together_sessions
         (id, owner_id, session_type, content_kind, content_id, title,
          max_participants, settings, queue, position_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       RETURNING *`,
      [id, ownerId, type, kind, text(input.contentId, 200), title, max,
        JSON.stringify({ control }), JSON.stringify(resolved.queue)],
    );

    /* Создатель — сразу владелец и сразу участник: отдельного
       приглашения самому себе не бывает. */
    await client.query(
      `INSERT INTO together_participants
         (session_id, user_id, role, status, invited_by, joined_at)
       VALUES ($1,$2,'owner','joined',$2, now())`,
      [id, ownerId],
    );
    await client.query('COMMIT');

    await logTogether(id, ownerId, 'session_created', { type, kind });
    const part = await partRow(id, ownerId);
    return { session: toSession(rows[0], part) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Приглашения ───────────────────────────────────────────────────
   Приглашение именное: принять его может только тот, кому оно
   выписано, и сравнение идёт с идентификатором из токена. Секрет —
   ВТОРОЕ условие, а не замена первому: он гасит повтор, даёт срок и
   позволяет отозвать. В базе лежит его отпечаток.                   */

const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

const newToken = () => crypto.randomBytes(32).toString('base64url');

/**
 * Позвать людей.
 *
 * Кого нельзя позвать и почему — возвращается списком, а не общим
 * отказом: владельцу надо понимать, что не так с конкретным человеком,
 * а остальных позвать всё равно.
 */
export const inviteToSession = async (sessionId, ownerId, userIds) => {
  const found = await accessSession(sessionId, ownerId);
  if (!found) return { error: 'not_found' };
  const { row, part } = found;
  if (part.role !== 'owner') return { error: 'forbidden' };
  if (row.status === 'ended') return { error: 'session_ended' };

  const wanted = Array.from(new Set((Array.isArray(userIds) ? userIds : [])
    .filter(isId).map(String))).slice(0, MAX_PARTICIPANTS_HARD);
  if (wanted.length === 0) return { error: 'no_users' };

  const invited = [];
  const skipped = [];

  for (const uid of wanted) {
    if (uid === ownerId) { skipped.push({ id: uid, reason: 'already_in' }); continue; }

    /* Существует ли профиль. Ответ «нет такого» здесь не утечка:
       спрашивает владелец о том, кого сам выбрал из поиска. */
    const { rows: who } = await query('SELECT id FROM profiles WHERE id = $1', [uid]);
    if (!who[0]) { skipped.push({ id: uid, reason: 'no_such_user' }); continue; }

    /* Право на содержимое проверяется у каждого своё. «Вместе» не
       открывает то, что закрыто в кино или в музыке. */
    if (!(await mayUseContent(row, uid))) { skipped.push({ id: uid, reason: 'content_forbidden' }); continue; }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      /* Потолок участников считается внутри транзакции и с блокировкой
         строки сессии: два одновременных приглашения иначе проходят
         проверку оба и переполняют сессию на одного. */
      const { rows: s } = await client.query(
        'SELECT max_participants FROM together_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const { rows: c } = await client.query(
        `SELECT count(*)::int AS n FROM together_participants
          WHERE session_id = $1 AND status IN ('invited','joined')`, [sessionId]);
      if ((c[0]?.n ?? 0) >= Number(s[0]?.max_participants ?? 0)) {
        await client.query('ROLLBACK');
        skipped.push({ id: uid, reason: 'session_full' });
        continue;
      }

      const { rows: existing } = await client.query(
        'SELECT status FROM together_participants WHERE session_id = $1 AND user_id = $2',
        [sessionId, uid],
      );
      if (existing[0]?.status === 'joined') {
        await client.query('ROLLBACK');
        skipped.push({ id: uid, reason: 'already_in' });
        continue;
      }
      /* «Позван» — ещё не повод отказать. Приглашение могло протухнуть
         или быть отозванным, и тогда строка участника говорит «позван»,
         а принять человеку нечего. Отказывать здесь значило бы запереть
         владельца: позвать снова он уже не может, а войти тот не может
         тем более. Поэтому смотрим не на строку, а на то, есть ли
         действующее приглашение. */
      if (existing[0]?.status === 'invited') {
        const { rows: liveInvite } = await client.query(
          `SELECT 1 FROM together_invitations
            WHERE session_id = $1 AND invitee_id = $2
              AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
          [sessionId, uid],
        );
        if (liveInvite[0]) {
          await client.query('ROLLBACK');
          skipped.push({ id: uid, reason: 'already_in' });
          continue;
        }
      }

      /* Повторное приглашение возвращает человека в «позван» — и
         отказавшегося, и вышедшего, и убранного. Строка не заводится
         второй раз: пара (сессия, человек) — первичный ключ. */
      await client.query(
        `INSERT INTO together_participants (session_id, user_id, role, status, invited_by, invited_at)
         VALUES ($1,$2,'participant','invited',$3, now())
         ON CONFLICT (session_id, user_id)
         DO UPDATE SET status = 'invited', invited_by = $3, invited_at = now(),
                       left_at = NULL, role = 'participant'`,
        [sessionId, uid, ownerId],
      );

      /* Прежние приглашения гасим: действующим остаётся одно. */
      await client.query(
        `UPDATE together_invitations SET revoked_at = now()
          WHERE session_id = $1 AND invitee_id = $2 AND used_at IS NULL AND revoked_at IS NULL`,
        [sessionId, uid],
      );

      const token = newToken();
      const inviteId = `tgi-${generateId()}`;
      await client.query(
        `INSERT INTO together_invitations
           (id, session_id, invitee_id, inviter_id, token_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5, now() + ($6::bigint * interval '1 millisecond'))`,
        [inviteId, sessionId, uid, ownerId, hashToken(token), INVITE_TTL_MS],
      );
      await client.query('COMMIT');

      invited.push({ id: uid, inviteId });
      await logTogether(sessionId, ownerId, 'invited', { userId: uid });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return { invited, skipped };
};

/** Отозвать приглашение или убрать участника. Может только владелец. */
export const removeParticipant = async (sessionId, ownerId, userId) => {
  const found = await accessSession(sessionId, ownerId);
  if (!found) return { error: 'not_found' };
  if (found.part.role !== 'owner') return { error: 'forbidden' };
  if (!isId(userId) || userId === ownerId) return { error: 'bad_user' };

  /* Убранный тоже в списке: ему нужно узнать, что его убрали, иначе
     его экран останется висеть на сессии, которой у него больше нет. */
  const recipients = Array.from(new Set([...(await liveMemberIds(sessionId)), userId]));

  const { rowCount } = await query(
    `UPDATE together_participants
        SET status = 'removed', left_at = now()
      WHERE session_id = $1 AND user_id = $2 AND status IN ('invited','joined')`,
    [sessionId, userId],
  );
  if (!rowCount) return { error: 'not_found' };

  await query(
    `UPDATE together_invitations SET revoked_at = now()
      WHERE session_id = $1 AND invitee_id = $2 AND used_at IS NULL AND revoked_at IS NULL`,
    [sessionId, userId],
  );
  await logTogether(sessionId, ownerId, 'removed', { userId });
  return { ok: true, recipients };
};

/**
 * Мои приглашения: кто позвал, куда и что там смотрят.
 *
 * Выборка ограничена идентификатором из токена — увидеть чужие
 * приглашения нечем. Отпечаток секрета наружу не уходит.
 */
export const listInvitations = async (userId) => {
  const { rows } = await query(
    `SELECT i.id, i.session_id, i.created_at, i.expires_at,
            s.session_type, s.content_kind, s.content_id, s.title, s.status,
            p.name AS inviter_name, p.username AS inviter_username, p.id AS inviter_id
       FROM together_invitations i
       JOIN together_sessions s ON s.id = i.session_id
       JOIN profiles p ON p.id = i.inviter_id
      WHERE i.invitee_id = $1
        AND i.used_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at > now()
        AND s.status <> 'ended'
      ORDER BY i.created_at DESC
      LIMIT 50`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    type: r.session_type,
    contentKind: r.content_kind,
    contentId: r.content_id,
    title: r.title,
    sessionStatus: r.status,
    invitedBy: { id: r.inviter_id, name: r.inviter_name, username: r.inviter_username },
    createdAt: r.created_at?.toISOString?.() ?? undefined,
    expiresAt: r.expires_at?.toISOString?.() ?? undefined,
  }));
};

/**
 * Принять или отклонить приглашение.
 *
 * Три условия, и все обязательны: приглашение выписано именно этому
 * профилю, оно ещё действует, и оно не использовано. Одноразовость
 * ставится в UPDATE с условием used_at IS NULL — два одновременных
 * «принять» изменят строку один раз, второй увидит ноль строк.
 */
export const answerInvitation = async (userId, invitationId, accept) => {
  if (!INVITE_ID_RE.test(String(invitationId ?? ''))) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE together_invitations SET used_at = now()
        WHERE id = $1 AND invitee_id = $2
          AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING session_id`,
      [invitationId, userId],
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    const sessionId = rows[0].session_id;

    const { rows: s } = await client.query(
      'SELECT * FROM together_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
    if (!s[0] || s[0].status === 'ended') {
      await client.query('ROLLBACK');
      return { error: 'session_ended' };
    }

    if (!accept) {
      await client.query(
        `UPDATE together_participants SET status = 'declined', left_at = now()
          WHERE session_id = $1 AND user_id = $2 AND status = 'invited'`,
        [sessionId, userId],
      );
      await client.query('COMMIT');
      await logTogether(sessionId, userId, 'declined');
      return { ok: true, accepted: false, sessionId, recipients: await liveMemberIds(sessionId) };
    }

    const { rowCount } = await client.query(
      `UPDATE together_participants SET status = 'joined', joined_at = COALESCE(joined_at, now())
        WHERE session_id = $1 AND user_id = $2 AND status IN ('invited','left')`,
      [sessionId, userId],
    );
    if (!rowCount) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    await client.query('COMMIT');
    await logTogether(sessionId, userId, 'accepted');
    return { ok: true, accepted: true, sessionId, recipients: await liveMemberIds(sessionId) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/* ─── Вход, выход, завершение ──────────────────────────────────────── */

/**
 * Войти в сессию.
 *
 * Право уже есть — иначе строки участника не было бы. Здесь
 * проверяется остальное: не завершена ли сессия, есть ли ещё место и не
 * закрылось ли содержимое с тех пор, как звали.
 */
export const joinSession = async (sessionId, userId) => {
  const found = await accessSession(sessionId, userId);
  if (!found) return { error: 'not_found' };
  const { row } = found;
  if (row.status === 'ended') return { error: 'session_ended' };
  if (found.part.status === 'invited') return { error: 'invitation_pending' };
  if (!(await mayUseContent(row, userId))) return { error: 'content_forbidden' };

  if (found.part.status !== 'joined') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM together_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      const { rows: c } = await client.query(
        "SELECT count(*)::int AS n FROM together_participants WHERE session_id = $1 AND status = 'joined'",
        [sessionId]);
      if ((c[0]?.n ?? 0) >= Number(row.max_participants)) {
        await client.query('ROLLBACK');
        return { error: 'session_full' };
      }
      await client.query(
        `UPDATE together_participants
            SET status = 'joined', joined_at = COALESCE(joined_at, now()), left_at = NULL
          WHERE session_id = $1 AND user_id = $2`,
        [sessionId, userId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    await logTogether(sessionId, userId, 'joined');
  }

  /* Первый вход владельца переводит сессию в «идёт». */
  if (row.status === 'planned' && found.part.role === 'owner') {
    await query(
      "UPDATE together_sessions SET status = 'live', started_at = COALESCE(started_at, now()) WHERE id = $1 AND status = 'planned'",
      [sessionId],
    );
  }

  const fresh = await accessSession(sessionId, userId);
  return { session: toSession(fresh.row, fresh.part), recipients: await liveMemberIds(sessionId) };
};

/**
 * Выйти.
 *
 * Уход владельца не убивает сеанс: владение переходит к тому, кто
 * дольше всех внутри. Кино не должно обрываться оттого, что у хозяина
 * поезд въехал в тоннель. Если внутри не осталось никого — сессия
 * закрывается: держать живой пустую незачем.
 */
export const leaveSession = async (sessionId, userId) => {
  const found = await accessSession(sessionId, userId);
  if (!found) return { error: 'not_found' };
  const { row, part } = found;
  if (row.status === 'ended') return { ok: true, ended: true, recipients: [] };

  /* Кому рассказать — выясняем ДО изменения. После него вышедшего в
     списке уже нет, а узнать о собственном выходе он должен: на другом
     его устройстве та же сессия открыта. */
  const recipients = await liveMemberIds(sessionId);

  await query(
    `UPDATE together_participants SET status = 'left', left_at = now()
      WHERE session_id = $1 AND user_id = $2 AND status = 'joined'`,
    [sessionId, userId],
  );
  await logTogether(sessionId, userId, 'left');

  if (part.role !== 'owner') return { ok: true, recipients };

  /*
   * Уход владельца, который показывал СВОЮ личную загрузку.
   *
   * Здесь владение не передаётся, а сеанс закрывается. Разрешение было
   * не «смотрите это кино», а «я вам его показываю»: оно держится на
   * том, кто показывает. Передать его вместе с ролью значило бы, что
   * личная запись человека продолжает крутиться без него и уже по
   * чужому решению.
   *
   * Опубликованного кино и музыки это не касается: они и так доступны
   * каждому, и там владение переходит как обычно.
   */
  if (await ownsPrivateContent(row)) {
    await query(
      "UPDATE together_sessions SET status = 'ended', ended_at = now(), playing = FALSE WHERE id = $1",
      [sessionId]);
    await query(
      `UPDATE together_participants SET status = 'left', left_at = now()
        WHERE session_id = $1 AND status = 'joined'`,
      [sessionId]);
    await logTogether(sessionId, userId, 'session_ended', { reason: 'owner_left_private' });
    return { ok: true, ended: true, recipients };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM together_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
    const { rows: heirs } = await client.query(
      `SELECT user_id FROM together_participants
        WHERE session_id = $1 AND status = 'joined' AND user_id <> $2
        ORDER BY joined_at
        LIMIT 1`,
      [sessionId, userId],
    );
    if (!heirs[0]) {
      await client.query(
        "UPDATE together_sessions SET status = 'ended', ended_at = now(), playing = FALSE WHERE id = $1",
        [sessionId]);
      await client.query('COMMIT');
      await logTogether(sessionId, userId, 'session_ended', { reason: 'owner_left_empty' });
      return { ok: true, ended: true, recipients };
    }

    const heir = heirs[0].user_id;
    await client.query("UPDATE together_participants SET role = 'participant' WHERE session_id = $1 AND user_id = $2",
      [sessionId, userId]);
    await client.query("UPDATE together_participants SET role = 'owner' WHERE session_id = $1 AND user_id = $2",
      [sessionId, heir]);
    await client.query('UPDATE together_sessions SET owner_id = $2 WHERE id = $1', [sessionId, heir]);
    await client.query('COMMIT');
    await logTogether(sessionId, userId, 'owner_transferred', { to: heir });
    return { ok: true, newOwnerId: heir, recipients };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Завершить сессию. Может только владелец.
 *
 * Ничего не удаляется: строки остаются, история остаётся. Меняется
 * состояние — и с ним закрывается вход: joinSession завершённую не
 * пустит, а рассылка событий по ней перестанет проходить проверку.
 */
export const endSession = async (sessionId, actorId) => {
  const found = await accessSession(sessionId, actorId);
  if (!found) return { error: 'not_found' };
  if (found.part.role !== 'owner') return { error: 'forbidden' };
  if (found.row.status === 'ended') return { ok: true, already: true, recipients: [] };

  /* Список тех, кто внутри, снимаем до завершения: сразу после него
     внутри не остаётся никого, и рассылать было бы некому. */
  const recipients = await liveMemberIds(sessionId);

  await query(
    "UPDATE together_sessions SET status = 'ended', ended_at = now(), playing = FALSE WHERE id = $1",
    [sessionId]);
  await query(
    `UPDATE together_participants SET status = 'left', left_at = now()
      WHERE session_id = $1 AND status = 'joined'`,
    [sessionId]);
  await query(
    `UPDATE together_invitations SET revoked_at = now()
      WHERE session_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
    [sessionId]);
  await logTogether(sessionId, actorId, 'session_ended', { reason: 'owner' });
  return { ok: true, recipients };
};

/** Настройки сессии: кто управляет и сколько человек пускать. */
export const updateSettings = async (sessionId, ownerId, patch = {}) => {
  const found = await accessSession(sessionId, ownerId);
  if (!found) return { error: 'not_found' };
  if (found.part.role !== 'owner') return { error: 'forbidden' };
  if (found.row.status === 'ended') return { error: 'session_ended' };

  const settings = { ...(found.row.settings ?? {}) };
  if (patch.control !== undefined) settings.control = patch.control === 'all' ? 'all' : 'owner';

  let max = Number(found.row.max_participants);
  if (patch.maxParticipants !== undefined) {
    const wanted = int(patch.maxParticipants, 2, MAX_PARTICIPANTS_HARD);
    if (wanted === null) return { error: 'bad_limit' };
    /* Ниже числа тех, кто уже внутри, потолок не опускаем: иначе
       пришлось бы кого-то выгонять, а такого решения никто не принимал. */
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM together_participants
        WHERE session_id = $1 AND status IN ('invited','joined')`, [sessionId]);
    if (wanted < (rows[0]?.n ?? 0)) return { error: 'limit_below_current' };
    max = wanted;
  }

  const { rows } = await query(
    'UPDATE together_sessions SET settings = $2, max_participants = $3 WHERE id = $1 RETURNING *',
    [sessionId, JSON.stringify(settings), max],
  );
  await logTogether(sessionId, ownerId, 'settings_changed', { control: settings.control, max });
  return { session: toSession(rows[0], found.part), recipients: await liveMemberIds(sessionId) };
};

/* ─── История ──────────────────────────────────────────────────────── */

/**
 * Мои сессии.
 *
 * Отбор по участию, и отбор идёт в базе. Не «выбрать все и отфильтровать
 * на клиенте» — так чужие сессии уезжают в браузер и видны в любом
 * перехватчике, даже если экран их не рисует.
 */
export const listMySessions = async (userId, { status, limit } = {}) => {
  const lim = int(limit, 1, 100) ?? 50;
  let where = "tp.status IN ('joined','left')";
  if (status === 'live')  where += " AND s.status <> 'ended'";
  if (status === 'ended') where += " AND s.status = 'ended'";

  const { rows } = await query(
    `SELECT s.*, tp.role AS my_role, tp.status AS my_status,
            (SELECT count(*)::int FROM together_participants x
              WHERE x.session_id = s.id AND x.status = 'joined') AS live_count
       FROM together_sessions s
       JOIN together_participants tp ON tp.session_id = s.id AND tp.user_id = $1
      WHERE ${where}
      ORDER BY s.created_at DESC
      LIMIT ${lim}`,
    [userId],
  );
  return rows.map((r) => ({
    ...toSession(r, { role: r.my_role, status: r.my_status }),
    liveCount: Number(r.live_count) || 0,
  }));
};

/* ─── Уборка ───────────────────────────────────────────────────────── */

/**
 * Закрыть брошенные сессии.
 *
 * Брошенная — та, где полсуток не было ни одного события. Такие висят
 * после закрытых вкладок и потерянной связи: сокет умер, а строка
 * осталась «живой».
 */
export const sweepTogether = async ({ isOnline } = {}) => {
  const { rowCount } = await query(
    `UPDATE together_sessions
        SET status = 'ended', ended_at = now(), playing = FALSE
      WHERE status <> 'ended'
        AND position_at < now() - ($1::bigint * interval '1 millisecond')
        AND created_at < now() - ($1::bigint * interval '1 millisecond')`,
    [IDLE_END_MS],
  );

  /*
   * Показ личной записи держится на том, кто её показывает.
   *
   * Кнопки «Выйти» и «Завершить» закрывают его сразу. Но вкладку можно
   * и просто закрыть — тогда сеанс остаётся живым, и личная запись
   * человека продолжала бы отдаваться позванным до самой уборки, уже
   * без него. Поэтому спрашиваем у хаба, на связи ли владелец, и если
   * его нет — показ заканчиваем.
   *
   * Короткий обрыв связи этому не помеха: уборка ходит раз в час, и
   * вернувшийся за это время владелец снова на связи. Опубликованного
   * кино и музыки правило не касается — они доступны и без хозяина
   * сеанса.
   */
  let closed = 0;
  if (typeof isOnline === 'function') {
    const { rows } = await query(
      `SELECT s.id, s.owner_id
         FROM together_sessions s
         JOIN film_movies m ON m.id = s.content_id AND m.owner_id = s.owner_id
        WHERE s.status <> 'ended'
          AND s.content_kind = 'movie'
          AND m.status = 'private'`,
    );
    for (const row of rows) {
      if (isOnline(row.owner_id)) continue;
      await query(
        "UPDATE together_sessions SET status = 'ended', ended_at = now(), playing = FALSE WHERE id = $1",
        [row.id]);
      await query(
        `UPDATE together_participants SET status = 'left', left_at = now()
          WHERE session_id = $1 AND status = 'joined'`,
        [row.id]);
      await logTogether(row.id, null, 'session_ended', { reason: 'owner_offline_private' });
      closed += 1;
    }
  }

  return rowCount + closed;
};

/* ══════════════════════════════════════════════════════════════════════
   Управление воспроизведением
   ══════════════════════════════════════════════════════════════════════

   Одна функция на все события: play, pause, seek, смена скорости, смена
   трека, конец записи. Ни одно из них не меняет строку «как прислали» —
   сервер сначала спрашивает, можно ли этому человеку, потом сам считает
   новое состояние.

   Почему позиция досчитывается в SQL, а не в JavaScript. Пауза должна
   остановить воспроизведение ровно там, где оно сейчас, — а «сейчас»
   надо взять из той же строки, которую меняем, и в тот же миг. Прочитать
   строку, посчитать в коде и записать обратно — это три шага, между
   которыми успевает пройти чужая команда, и её перемотка молча
   теряется. Одним UPDATE такого окна нет.
*/

/** Досчёт позиции до текущего мига прямо в запросе. */
const ADVANCED = `GREATEST(0, position_ms + CASE WHEN playing AND status = 'live'
      THEN (EXTRACT(EPOCH FROM (now() - position_at)) * 1000 * rate)::bigint
      ELSE 0 END)`;

/** Действия, которые меняют состояние, и действие «просто расскажи». */
export const COMMANDS = ['play', 'pause', 'seek', 'rate', 'track', 'next', 'prev', 'ended', 'sync'];

/**
 * Не сняли ли трек с публикации, пока сессия шла.
 *
 * Спрашиваем перед каждой сменой трека. Очередь составлена при
 * создании, а с тех пор могло пройти несколько часов: снятый с
 * публикации трек не должен доигрываться через вчерашнюю очередь.
 */
const trackStillOpen = async (row, index) => {
  const queue = Array.isArray(row.queue) ? row.queue : [];
  const item = queue[index];
  if (!item) return false;
  if (row.content_kind === 'movie') {
    const movie = await visibleMovie(item.id, row.owner_id);
    if (!movie) return false;
    if (movie.status === 'published') return true;
    return movie.status === 'private' && movie.owner_id === row.owner_id;
  }
  const track = await visibleTrack(item.id, row.owner_id);
  return Boolean(track) && track.status === 'published';
};

/**
 * Выполнить команду воспроизведения.
 *
 * Возвращает { state, event } или { error }. event — то, что уходит
 * остальным: вид события и новое состояние целиком. Разослать его
 * должен вызывающий: кому именно, знает слой связи, а не этот файл.
 */
export const applyCommand = async (sessionId, userId, cmd = {}) => {
  const action = String(cmd.action ?? '');
  if (!COMMANDS.includes(action)) return { error: 'bad_command' };

  const found = await accessSession(sessionId, userId);
  if (!found) return { error: 'not_found' };
  const { row, part } = found;

  /* Запрос состояния доступен любому, кто внутри: это чтение. */
  if (action === 'sync') {
    if (part.status !== 'joined') return { error: 'forbidden' };
    return { state: toSession(row, part), shared: playbackOf(row), event: null };
  }

  if (row.status !== 'live') return { error: 'session_not_live' };

  /* Единственная проверка права на управление — здесь. По умолчанию
     это владелец; настройка control: 'all' открывает его всем внутри.
     Никакого «клиент прислал, что он владелец» в этой ветке нет: роль
     берётся из строки участника, найденной по идентификатору из
     токена. */
  if (!mayControl(row, part)) return { error: 'not_controller' };

  const queue = Array.isArray(row.queue) ? row.queue : [];
  const lastIdx = Math.max(0, queue.length - 1);
  const curIdx = Math.min(Math.max(0, Number(row.queue_index) || 0), lastIdx);

  let sql = null;
  let args = [sessionId];
  let event = action;

  if (action === 'play') {
    /* Позицию всё равно досчитываем: если уже играло, без этого она
       отмоталась бы назад к той, что была записана в прошлый раз. */
    sql = `UPDATE together_sessions
              SET playing = TRUE, position_ms = ${ADVANCED}, position_at = now(),
                  state_seq = state_seq + 1
            WHERE id = $1 RETURNING *`;
  } else if (action === 'pause') {
    sql = `UPDATE together_sessions
              SET playing = FALSE, position_ms = ${ADVANCED}, position_at = now(),
                  state_seq = state_seq + 1
            WHERE id = $1 RETURNING *`;
  } else if (action === 'seek') {
    const dur = durationOf(row);
    /* Верхняя граница разбора щедрая намеренно: она отсекает не
       большие числа, а не-числа. Слишком большое число — это «в
       конец», и отвечать на него ошибкой значило бы ломать ползунок
       у того, кто дотянул его до края. */
    const wanted = int(cmd.positionMs, 0, 30 * 24 * 60 * 60 * 1000);
    if (wanted === null) return { error: 'bad_position' };
    /* Дальше конца не перематываем. Длительность берётся из записи о
       содержимом, а не из того, что прислал клиент. */
    const pos = dur > 0 ? Math.min(wanted, dur) : wanted;
    sql = `UPDATE together_sessions
              SET position_ms = $2, position_at = now(), state_seq = state_seq + 1
            WHERE id = $1 RETURNING *`;
    args = [sessionId, pos];
  } else if (action === 'rate') {
    const raw = Number(cmd.rate);
    if (!Number.isFinite(raw) || raw < 0.25 || raw > 4) return { error: 'bad_rate' };
    /* Сначала замораживаем позицию по старой скорости, потом ставим
       новую: иначе весь прошедший отрезок пересчитался бы по новой. */
    sql = `UPDATE together_sessions
              SET position_ms = ${ADVANCED}, position_at = now(),
                  rate = $2, state_seq = state_seq + 1
            WHERE id = $1 RETURNING *`;
    args = [sessionId, Math.round(raw * 100) / 100];
  } else if (action === 'track' || action === 'next' || action === 'prev') {
    let idx;
    if (action === 'track') {
      idx = int(cmd.index, 0, MAX_QUEUE - 1);
      if (idx === null || idx > lastIdx) return { error: 'bad_index' };
    } else if (action === 'next') {
      if (curIdx >= lastIdx) return { error: 'queue_end' };
      idx = curIdx + 1;
    } else {
      if (curIdx <= 0) return { error: 'queue_start' };
      idx = curIdx - 1;
    }
    if (!(await trackStillOpen(row, idx))) return { error: 'content_forbidden' };
    sql = `UPDATE together_sessions
              SET queue_index = $2, position_ms = 0, position_at = now(),
                  playing = TRUE, state_seq = state_seq + 1
            WHERE id = $1 RETURNING *`;
    args = [sessionId, idx];
    event = 'track';
  } else if (action === 'ended') {
    /* Конец записи. В музыке переходим к следующему треку, в кино и на
       последнем треке просто останавливаемся в конце — так же, как
       ведёт себя обычный плеер. */
    if (row.content_kind !== 'movie' && curIdx < lastIdx && await trackStillOpen(row, curIdx + 1)) {
      sql = `UPDATE together_sessions
                SET queue_index = $2, position_ms = 0, position_at = now(),
                    playing = TRUE, state_seq = state_seq + 1
              WHERE id = $1 RETURNING *`;
      args = [sessionId, curIdx + 1];
      event = 'track';
    } else {
      const dur = durationOf(row);
      sql = `UPDATE together_sessions
                SET playing = FALSE, position_ms = $2, position_at = now(),
                    state_seq = state_seq + 1
              WHERE id = $1 RETURNING *`;
      args = [sessionId, dur];
      event = 'pause';
    }
  }

  const { rows } = await query(sql, args);
  if (!rows[0]) return { error: 'not_found' };
  return {
    state: toSession(rows[0], part),
    shared: playbackOf(rows[0]),
    event,
    recipients: await liveMemberIds(sessionId),
  };
};
