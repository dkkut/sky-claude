/**
 * Sky Film: данные и права.
 *
 * Главное правило модуля — личная коллекция закрыта.
 *
 * Фильм, загруженный человеком, заводится со статусом 'private' и в
 * этом состоянии существует только для своего владельца. Он не
 * появляется ни в каталоге, ни в поиске, ни в популярном, ни в
 * новинках, ни в подборках по жанру — не потому, что мы его оттуда
 * вычёркиваем на экране, а потому, что все эти выборки написаны как
 * `status = 'published'` и закрытая строка в них просто не попадает.
 * Забыть спрятать личное здесь нельзя: чтобы оно куда-то попало, надо
 * специально это написать.
 *
 * Второе правило — закрытое не видит даже администратор. В музыке
 * администратор видит любой трек; в кино это было бы прямым нарушением
 * того, ради чего личная коллекция заводится. Администратору доступно
 * ровно то, что человек сам отправил на проверку (статус 'pending'), и
 * то, что уже опубликовано. Личное и отклонённое — дело владельца.
 *
 * Третье — публикации «само собой» не бывает. Из личной коллекции в
 * общий каталог фильм уходит только так: владелец просит проверку,
 * администратор её проводит. Ни загрузка, ни правка, ни какое-либо
 * поле в запросе опубликовать фильм не могут.
 *
 * Клиент во всём этом не участвует. Он присылает идентификаторы, а кому
 * что доступно — решают функции этого файла, каждая сама, обращаясь к
 * базе. Переписанный клиент, прямой запрос к API, подставленный чужой
 * owner_user_id — всё это проходит через те же условия в SQL.
 */
import crypto from 'node:crypto';
import { retentionOf } from './storagequota.mjs';
import { query } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { can } from './admin.mjs';
import { checkPublish } from './uploadlimits.mjs';
import { sharedInSession } from './watchgrant.mjs';
import { sharedDirectly } from './storageshare.mjs';
import { removeMovieFiles, listStoredIds, posterIdFor } from './filmstore.mjs';

const newId = () => `mov-${crypto.randomUUID()}`;

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;
const MAX_SHORT = 60;
const MAX_DIRECTOR = 120;
const MAX_AGE = 10;
const MAX_REASON = 500;
/** Сутки: всё, что длиннее, — не фильм, а ошибка в метаданных. */
const MAX_DURATION = 86400;
/**
 * Короткометражка — не «любое короткое видео». Пять минут это верхний
 * предел: дальше это уже фильм, и в вертикальной ленте, где листают
 * пальцем, ему не место. Предел стоит на сервере, потому что пометку
 * присылает клиент, а его можно переписать.
 */
const MAX_SHORT_DURATION = 300;
/** Столько фильмов в личной коллекции одного человека. */
const MAX_OWN_MOVIES = 500;

/** Обрезка и очистка от управляющих символов: в названиях им не место. */
const text = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

/**
 * Число в заданных границах — или null, если его не прислали.
 *
 * Проверка на пустоту здесь не придирка. Number(null), Number('') и
 * Number([]) — это ноль, а не «ничего», и без этой строчки фильм без
 * года получал год 1870: ноль проходил как настоящее число и упирался
 * в нижнюю границу. Ровно это и было видно на карточке.
 */
const num = (v, min, max) => {
  if (v === null || v === undefined || v === '' || typeof v === 'object') return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
};

/* ─── Представление наружу ─────────────────────────────────────────── */

/**
 * Что уходит клиенту.
 *
 * Ни пути на диске, ни имени файла от загрузившего, ни внутренних
 * отметок здесь нет: по ним не должно быть видно, как устроено
 * хранилище. Поля владельца («своё», причина отказа) проставляются
 * только тому, кто владелец, — это разговор с ним, а не сведения о
 * фильме.
 */
export const toMovie = (row) => ({
  ...retentionOf(row),
  id: row.id,
  title: row.title,
  description: row.description ? (decryptContent(row.description) ?? '') : undefined,
  category: row.category,
  genre: row.genre || undefined,
  year: row.year ?? undefined,
  country: row.country || undefined,
  director: row.director || undefined,
  ageRating: row.age_rating || undefined,
  duration: Number(row.duration_sec ?? 0),
  bytes: Number(row.bytes ?? 0),
  hasPoster: Boolean(row.has_poster),
  status: row.status,
  /** Закрытый фильм — тот, что лежит в личной коллекции. */
  private: row.status !== 'published',
  license: row.license ?? undefined,
  explicit: row.explicit === true || undefined,
  ageRestricted18: row.age_restricted18 === true || undefined,
  isShort: row.is_short === true || undefined,
  width: Number(row.width ?? 0) || undefined,
  height: Number(row.height ?? 0) || undefined,
  views: Number(row.views ?? 0),
  rating: row.rating == null ? undefined : Math.round(Number(row.rating) * 10) / 10,
  ratingCount: row.rating_count == null ? undefined : Number(row.rating_count),
  myRating: row.my_rating ?? undefined,
  saved: row.saved === true || undefined,
  own: row.own === true || undefined,
  uploaderName: row.uploader_name ?? undefined,
  addedAt: row.created_at?.toISOString?.() ?? undefined,
  submittedAt: row.own === true ? (row.submitted_at?.toISOString?.() ?? undefined) : undefined,
  rejectReason: row.own === true && row.reject_reason
    ? (decryptContent(row.reject_reason) ?? undefined) : undefined,
  position: row.position_sec == null ? undefined : Number(row.position_sec),
  seriesId: row.series_id ?? undefined,
  seasonId: row.season_id ?? undefined,
  epNo: row.ep_no ?? undefined,
  introStart: row.intro_start_sec ?? undefined,
  introEnd: row.intro_end_sec ?? undefined,
});

/**
 * Общий кусок выборки. Первым параметром всегда идёт тот, кто
 * спрашивает: от него зависят «своё», «в закладках», «моя оценка» и
 * «на чём остановился». Порядок держим одинаковым во всех запросах —
 * разъехавшаяся нумерация $-параметров однажды уже приводила к тому,
 * что в чужой выборке оказывался чужой идентификатор.
 */
const SELECT_MOVIE = `
  SELECT m.*,
         m.owner_id = $1 AS own,
         p.name AS uploader_name,
         (SELECT avg(r.score)::numeric(4,2) FROM film_ratings r WHERE r.movie_id = m.id) AS rating,
         (SELECT count(*) FROM film_ratings r WHERE r.movie_id = m.id) AS rating_count,
         (SELECT r.score FROM film_ratings r WHERE r.movie_id = m.id AND r.user_id = $1) AS my_rating,
         EXISTS (SELECT 1 FROM film_saved s WHERE s.movie_id = m.id AND s.user_id = $1) AS saved,
         (SELECT g.position_sec FROM film_progress g
           WHERE g.movie_id = m.id AND g.user_id = $1) AS position_sec
    FROM film_movies m
    LEFT JOIN profiles p ON p.id = m.owner_id
`;

/* ─── Доступ к фильму ──────────────────────────────────────────────── */

/**
 * Строка фильма, если этот человек имеет право её видеть.
 *
 * Через неё проходит всё: страница фильма, постер, само видео,
 * закладка, оценка, позиция просмотра. Одно место — один ответ на
 * вопрос «можно ли».
 *
 * Администратор здесь не всесилен намеренно. Ему доступно
 * опубликованное и отправленное на проверку; закрытый фильм из чужой
 * личной коллекции для него такой же чужой, как для любого другого.
 *
 * Единственное исключение — совместный просмотр, и оно узкое: владелец
 * может открыть СВОЮ личную загрузку тем, кого позвал, и только пока
 * идёт сеанс. В каталог она от этого не попадает — каталог отбирает
 * опубликованное, а личная загрузка опубликованной не становится. За
 * пределами сеанса пропуск не действует: см. watchgrant.mjs.
 */
export const visibleMovie = async (movieId, viewerId) => {
  const { rows } = await query('SELECT * FROM film_movies WHERE id = $1', [String(movieId ?? '')]);
  const row = rows[0];
  if (!row) return null;
  if (row.owner_id && row.owner_id === viewerId) return { ...row, own: true };
  if (row.status === 'published') return row;
  if (row.status === 'pending' && await can(viewerId, 'content')) return row;

  /* Личная загрузка, которую её владелец показывает в сеансе. Пометка
     viaSession говорит вызывающему, откуда взялось право: по ней видно,
     что это не «фильм стал общим», а «этому человеку его показывают
     прямо сейчас». */
  if (row.status === 'private' && await sharedInSession(row.id, viewerId)) {
    return { ...row, viaSession: true };
  }

  // Прямой доступ («Поделиться») — отдельно от сеанса и не зависит от
  // него: действует, пока владелец не отзовёт или не истечёт срок.
  if (row.status === 'private') {
    const share = await sharedDirectly('movie', row.id, viewerId);
    if (share.view) return { ...row, viaShare: true, canDownload: share.download };
  }

  // Чужой закрытый фильм неотличим от несуществующего: разница в
  // ответах сама по себе выдаёт, что такой фильм есть.
  return null;
};

/** Фильм со всеми полями показа — или null, если смотреть его нельзя. */
export const readMovie = async (movieId, viewerId) => {
  if (!(await visibleMovie(movieId, viewerId))) return null;
  const { rows } = await query(`${SELECT_MOVIE} WHERE m.id = $2`,
    [viewerId ?? '', String(movieId ?? '')]);
  return rows[0] ? toMovie(rows[0]) : null;
};

/* ─── Каталог ──────────────────────────────────────────────────────── */

/**
 * Условие каталога. Ровно одно слово отделяет общее кино от личного, и
 * оно здесь: в каталог попадает только опубликованное. Своего закрытого
 * человек тут не увидит тоже — для него есть личная коллекция.
 */
const PUBLIC_ONLY = "m.status = 'published' AND m.series_id IS NULL";

/**
 * Поиск по каталогу. Строка запроса уходит параметром, а не склейкой,
 * поэтому кавычка в запросе — просто кавычка. ESCAPE обязателен: без
 * него «%» из запроса стал бы шаблоном и вернул весь каталог.
 */
const searchClause = (q, args) => {
  const needle = text(q, 100).toLowerCase();
  if (!needle) return null;
  args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`);
  const n = args.length;
  return `(lower(m.title) LIKE $${n} ESCAPE '\\'
        OR lower(m.category) LIKE $${n} ESCAPE '\\'
        OR lower(m.genre) LIKE $${n} ESCAPE '\\')`;
};

export const listCatalog = async (viewerId, { q, category, limit, offset, sort } = {}) => {
  const lim = num(limit, 1, 100) ?? 50;
  const off = num(offset, 0, 100000) ?? 0;
  const args = [viewerId ?? '', lim, off];
  const where = [PUBLIC_ONLY];

  const cat = text(category, MAX_SHORT);
  if (cat && cat !== 'Все') { args.push(cat.toLowerCase()); where.push(`lower(m.category) = $${args.length}`); }

  const s = searchClause(q, args);
  if (s) where.push(s);

  // Порядок задаётся набором, а не строкой из запроса: подставить сюда
  // своё выражение клиент не может в принципе.
  const order = sort === 'popular' ? 'm.views DESC, m.created_at DESC'
    : sort === 'rating' ? 'rating DESC NULLS LAST, m.created_at DESC'
      : 'm.created_at DESC';

  const { rows } = await query(
    `${SELECT_MOVIE} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $2 OFFSET $3`, args);
  return rows.map(toMovie);
};

/**
 * Лента короткого кино.
 *
 * Отдельная выборка, а не отсев каталога на экране. Разница
 * существенная: каталог отдаётся первой сотней, и короткометражка,
 * оказавшаяся сто первой, в ленту не попадала бы вовсе — притом что
 * сама лента бесконечна по смыслу.
 *
 * Условие то же, что и везде: только опубликованное. Закрытое кино в
 * общую ленту не попадает, даже своё, — листают её все подряд.
 *
 * Листается по времени добавления, а не по номеру страницы: пока
 * человек листает, кто-то мог выложить новое, и при счёте по номерам
 * одно видео он увидел бы дважды, а другое пропустил.
 */
export const listShorts = async (viewerId, { limit, before } = {}) => {
  const lim = num(limit, 1, 30) ?? 12;
  const args = [viewerId ?? '', lim];
  let cut = '';
  if (before) {
    const t = new Date(String(before));
    if (!Number.isNaN(t.getTime())) { args.push(t.toISOString()); cut = ` AND m.created_at < $${args.length}`; }
  }
  const { rows } = await query(
    `${SELECT_MOVIE}
      WHERE m.is_short AND m.status = 'published' AND m.series_id IS NULL${cut}
      ORDER BY m.created_at DESC
      LIMIT $2`,
    args);
  return rows.map(toMovie);
};

/** Категории каталога — только те, в которых есть опубликованное кино. */
export const listCategories = async () => {
  const { rows } = await query(
    `SELECT category, count(*)::int AS n FROM film_movies
      WHERE status = 'published' AND series_id IS NULL GROUP BY category ORDER BY n DESC, category ASC LIMIT 60`);
  return rows.map((r) => ({ name: r.category, count: r.n }));
};

/* ─── Личная коллекция ─────────────────────────────────────────────── */

/**
 * Личная коллекция: всё, что загрузил этот человек, в любом состоянии —
 * и закрытое, и ждущее проверки, и опубликованное, и отклонённое.
 *
 * Условие здесь одно и жёсткое: `owner_id = $1`. Идентификатор берётся
 * из сессии, а не из запроса, поэтому «покажи коллекцию такого-то»
 * попросить нельзя: такого запроса просто нет.
 */
export const listMine = async (ownerId, { q, limit, offset } = {}) => {
  const lim = num(limit, 1, 200) ?? 100;
  const off = num(offset, 0, 100000) ?? 0;
  const args = [ownerId, lim, off];
  const where = ['m.owner_id = $1', 'm.series_id IS NULL'];
  const s = searchClause(q, args);
  if (s) where.push(s);
  const { rows } = await query(
    `${SELECT_MOVIE} WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT $2 OFFSET $3`, args);
  return rows.map(toMovie);
};

/* ─── Загрузка ─────────────────────────────────────────────────────── */

/**
 * Запись о фильме заводится до того, как файл ляжет на диск: файл
 * называется по идентификатору, а его выдаёт база.
 *
 * Статус не принимается из метаданных вовсе. Новый фильм всегда
 * 'private' — это и есть «личная коллекция всегда закрыта»: даже если
 * клиент пришлёт status=published, писать это поле здесь нечему.
 */
export const createMovie = async (ownerId, meta) => {
  const title = text(meta.title, MAX_TITLE);
  if (title.length < 1) return { error: 'invalid_meta' };

  const { rows: cnt } = await query(
    'SELECT count(*)::int AS n FROM film_movies WHERE owner_id = $1', [ownerId]);
  if ((cnt[0]?.n ?? 0) >= MAX_OWN_MOVIES) return { error: 'too_many' };

  const description = text(meta.description, MAX_DESCRIPTION);
  const duration = num(meta.duration, 0, MAX_DURATION) ?? 0;
  const width = num(meta.width, 0, 16384) ?? 0;
  const height = num(meta.height, 0, 16384) ?? 0;

  const id = newId();
  await query(
    `INSERT INTO film_movies
       (id, owner_id, title, description, category, genre, year, country, director,
        age_rating, duration_sec, mime, bytes, is_short, width, height, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'private')`,
    [id, ownerId, title,
      description ? encryptContent(description) : null,
      text(meta.category, MAX_SHORT) || 'Другое',
      text(meta.genre, MAX_SHORT),
      num(meta.year, 1870, 2200),
      text(meta.country, MAX_SHORT),
      text(meta.director, MAX_DIRECTOR),
      text(meta.ageRating, MAX_AGE),
      duration,
      String(meta.mime ?? 'video/mp4'),
      0,
      shortAllowed(meta.isShort, duration),
      width, height],
  );
  return { id };
};

/**
 * Можно ли считать это короткометражкой.
 *
 * Решает сервер, а не пометка в запросе. Пометку присылает клиент, и
 * без этой проверки в вертикальную ленту, где листают пальцем, можно
 * было бы затолкать двухчасовой фильм — достаточно дописать один
 * параметр в адрес загрузки.
 *
 * Длительность к этому моменту уже своя: она пришла из браузера, но
 * обрезана по тем же правилам, и соврать ею можно только себе же —
 * в ленте окажется видео, которое там же и выглядит неуместно.
 */
const shortAllowed = (flag, duration) => {
  const asked = flag === true || flag === 'true' || flag === '1';
  if (!asked) return false;
  return duration > 0 && duration <= MAX_SHORT_DURATION;
};

/**
 * Размер и тип проставляются по факту записи на диск, а не по словам
 * клиента: присланный Content-Length и Content-Type к этому моменту
 * уже ничего не значат.
 */
export const finishMovie = async (movieId, ownerId, { bytes, mime }) => {
  await query(
    'UPDATE film_movies SET bytes = $3, mime = $4, updated_at = now() WHERE id = $1 AND owner_id = $2',
    [movieId, ownerId, Math.max(0, Number(bytes) || 0), String(mime)]);
};

/** Владелец правит своё; чужое не правит никто, включая администратора. */
export const updateMovie = async (movieId, ownerId, patch) => {
  const { rows } = await query('SELECT owner_id, status, duration_sec FROM film_movies WHERE id = $1',
    [String(movieId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].owner_id !== ownerId) return { error: 'not_allowed' };

  const sets = [];
  const args = [movieId];
  const put = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };

  if (patch.title !== undefined) {
    const t = text(patch.title, MAX_TITLE);
    if (!t) return { error: 'invalid_meta' };
    put('title', t);
  }
  if (patch.description !== undefined) {
    const d = text(patch.description, MAX_DESCRIPTION);
    put('description', d ? encryptContent(d) : null);
  }
  if (patch.category !== undefined) put('category', text(patch.category, MAX_SHORT) || 'Другое');
  if (patch.genre !== undefined) put('genre', text(patch.genre, MAX_SHORT));
  if (patch.year !== undefined) put('year', num(patch.year, 1870, 2200));
  if (patch.country !== undefined) put('country', text(patch.country, MAX_SHORT));
  if (patch.director !== undefined) put('director', text(patch.director, MAX_DIRECTOR));
  if (patch.ageRating !== undefined) put('age_rating', text(patch.ageRating, MAX_AGE));
  if (patch.duration !== undefined) put('duration_sec', num(patch.duration, 0, MAX_DURATION) ?? 0);

  if (patch.isShort !== undefined) {
    // Передумать можно: человек мог загрузить короткометражку обычным
    // фильмом и наоборот. Правило то же самое — длинное короткометражкой
    // не станет, сколько его ни помечай.
    const want = patch.isShort === true || patch.isShort === 'true';
    if (want && !shortAllowed(true, Number(rows[0].duration_sec ?? 0))) {
      return { error: 'too_long_for_short' };
    }
    put('is_short', want);
  }

  if (patch.status !== undefined) {
    // Вернуть фильм себе владелец может сам, в любой момент: это его
    // право убрать своё из общего доступа. Выложить — нет: туда фильм
    // попадает только через проверку, и 'pending' ставит submitMovie.
    if (String(patch.status) === 'private') { put('status', 'private'); put('submitted_at', null); }
    else return { error: 'invalid_status' };
  }
  if (sets.length === 0) return { ok: true };

  await query(`UPDATE film_movies SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  return { ok: true };
};

export const setPoster = async (movieId, ownerId, mime) => {
  const { rowCount } = await query(
    `UPDATE film_movies SET has_poster = TRUE, poster_mime = $3, updated_at = now()
      WHERE id = $1 AND owner_id = $2`,
    [movieId, ownerId, String(mime)]);
  return rowCount > 0;
};

/**
 * Удаление. Своё убирает владелец; чужое — только администратор и
 * только опубликованное, то есть то, что сам же и пропустил в общий
 * каталог. Чужую личную коллекцию не трогает никто.
 */
export const deleteMovie = async (movieId, actorId) => {
  const { rows } = await query('SELECT owner_id, status FROM film_movies WHERE id = $1',
    [String(movieId ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };

  if (row.owner_id !== actorId) {
    if (row.status !== 'published') return { error: 'not_found' };
    if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  }
  await query('DELETE FROM film_movies WHERE id = $1', [movieId]);
  // Файлы убираем после записи в базе: строки уже нет, и если уборка
  // файла не удастся, её доделает sweepOrphanFilms.
  await removeMovieFiles(movieId).catch(() => {});
  return { ok: true };
};

/* ─── Проверка перед публикацией ───────────────────────────────────── */

/**
 * Владелец отправляет свой фильм на проверку. Отправить можно закрытый
 * или отклонённый — отклонённый после правок идёт тем же путём.
 *
 * Лицензия и пометки принимаются только здесь: они имеют смысл для
 * общего каталога, а не для личной полки.
 */
export const submitMovie = async (movieId, ownerId, { license, explicit, ageRestricted18 } = {}) => {
  const { rows } = await query('SELECT id, owner_id, status, bytes, mime, duration_sec FROM film_movies WHERE id = $1',
    [String(movieId ?? '')]);
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (row.owner_id !== ownerId) return { error: 'not_allowed' };
  if (row.status === 'pending') return { error: 'already_pending' };
  if (row.status === 'published') return { error: 'already_published' };
  // Лимиты публикации (отдельно от лимитов личной загрузки): размер, формат, длительность, число и объём опубликованного.
  const lim = await checkPublish('film', row);
  if (lim.error) return lim;
  // Фильма без файла в каталоге быть не должно: там его открыли бы и
  // увидели пустоту.
  if (Number(row.bytes ?? 0) <= 0) return { error: 'no_file' };

  const lic = license === 'personal' ? 'personal' : 'open';
  // Проверка выше и запись — два разных мгновения. Условие по нынешнему
  // состоянию стоит в самом UPDATE, поэтому из нескольких одновременных
  // нажатий срабатывает ровно одно, а остальные ничего не меняют и
  // получают честный отказ.
  const { rowCount } = await query(
    `UPDATE film_movies
        SET status = 'pending', submitted_at = now(),
            license = $2, explicit = $3, age_restricted18 = $4,
            reject_reason = NULL, moderated_at = NULL, moderated_by = NULL,
            updated_at = now()
      WHERE id = $1 AND status IN ('private','rejected')`,
    [movieId, lic, explicit === true, lic === 'open' && ageRestricted18 === true]);
  if (rowCount === 0) return { error: 'already_pending' };
  return { ok: true };
};

/** Очередь проверки. Только для администратора и только ждущее её. */
export const moderationQueue = async (adminId, { limit } = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const lim = num(limit, 1, 200) ?? 100;
  const { rows } = await query(
    `${SELECT_MOVIE} WHERE m.status = 'pending'
      ORDER BY m.submitted_at ASC NULLS LAST LIMIT $2`,
    [adminId, lim]);
  return {
    movies: rows.map((r) => ({
      ...toMovie(r),
      ownerName: r.uploader_name ?? undefined,
      submittedAt: r.submitted_at?.toISOString?.() ?? undefined,
    })),
  };
};

/**
 * Решение по заявке. Принять — фильм уходит в общий каталог; отклонить
 * — возвращается владельцу с причиной и снова виден только ему.
 */
export const moderateMovie = async (movieId, adminId, { approve, reason } = {}) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT status FROM film_movies WHERE id = $1', [String(movieId ?? '')]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].status !== 'pending') return { error: 'not_pending' };

  // Решение принимается один раз. Условие «ещё на проверке» стоит в
  // самом UPDATE: иначе два администратора, нажавшие одновременно,
  // оба получали бы «готово», а в базе оставалось бы решение того, кто
  // записал вторым — и заявка могла оказаться отклонённой после того,
  // как её уже пропустили.
  if (approve) {
    const { rowCount } = await query(
      `UPDATE film_movies SET status = 'published', moderated_at = now(), moderated_by = $2,
              reject_reason = NULL, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [movieId, adminId]);
    if (rowCount === 0) return { error: 'not_pending' };
    return { ok: true, status: 'published' };
  }

  const why = text(reason, MAX_REASON);
  const { rowCount } = await query(
    `UPDATE film_movies SET status = 'rejected', moderated_at = now(), moderated_by = $2,
            reject_reason = $3, updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [movieId, adminId, why ? encryptContent(why) : null]);
  if (rowCount === 0) return { error: 'not_pending' };
  return { ok: true, status: 'rejected' };
};

/* ─── Закладки, просмотры, оценка ──────────────────────────────────── */

export const listSaved = async (userId) => {
  const { rows } = await query(
    `${SELECT_MOVIE}
      JOIN film_saved s2 ON s2.movie_id = m.id AND s2.user_id = $1
      WHERE m.status = 'published' OR m.owner_id = $1
      ORDER BY s2.created_at DESC LIMIT 500`,
    [userId]);
  return rows.map(toMovie);
};

export const setSaved = async (userId, movieId, on) => {
  const row = await visibleMovie(movieId, userId);
  if (!row) return { error: 'not_found' };
  /* Закладка на чужую личную загрузку не имеет смысла: в списке
     закладок она всё равно не покажется, потому что тот отбирает
     опубликованное и своё. Отказываем сразу, а не оставляем строку,
     которая никогда никому не понадобится. */
  if (row.status !== 'published' && row.own !== true) return { error: 'not_allowed' };
  if (on) {
    await query('INSERT INTO film_saved (user_id, movie_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [userId, movieId]);
  } else {
    await query('DELETE FROM film_saved WHERE user_id = $1 AND movie_id = $2', [userId, movieId]);
  }
  return { ok: true };
};

/** Счётчик просмотров. Только для общего каталога: личное никто не считает. */
export const countView = async (movieId) => {
  await query("UPDATE film_movies SET views = views + 1 WHERE id = $1 AND status = 'published'",
    [String(movieId ?? '')]);
};

/**
 * Оценка. Только опубликованному кино: у закрытого фильма один зритель,
 * и «средняя оценка» из одной своей же ничего не значит.
 *
 * Ноль — это снять свою оценку. Нужен он не для полноты: в коротком
 * кино та же таблица показана сердечком, а сердечко должно нажиматься
 * дважды. Раньше это сердечко считало отметки в localStorage нажавшего,
 * то есть не значило ничего и никому, кроме одной вкладки, не было
 * видно.
 */
export const rateMovie = async (userId, movieId, score) => {
  const raw = Number(score);
  if (!Number.isFinite(raw) || raw < 0 || raw > 10) return { error: 'invalid_score' };
  const row = await visibleMovie(movieId, userId);
  if (!row) return { error: 'not_found' };
  if (row.status !== 'published') return { error: 'not_allowed' };

  if (Math.trunc(raw) === 0) {
    await query('DELETE FROM film_ratings WHERE user_id = $1 AND movie_id = $2', [userId, movieId]);
    return { ok: true };
  }
  const s = num(raw, 1, 10);
  await query(
    `INSERT INTO film_ratings (user_id, movie_id, score) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, movie_id) DO UPDATE SET score = $3, created_at = now()`,
    [userId, movieId, s]);
  return { ok: true };
};

/* ─── Продолжить просмотр ──────────────────────────────────────────── */

/**
 * На чём человек остановился.
 *
 * Это и есть синхронизация устройств: позиция лежит на сервере, а не в
 * браузере, поэтому телефон и телевизор читают одну и ту же строку.
 * Права проверяются те же, что и на просмотр: записать позицию в чужой
 * фильм нельзя, потому что чужой фильм для этого человека не
 * существует. Свою чужую строку тоже не переписать — ключ таблицы
 * включает user_id, и он берётся из сессии.
 */
export const setProgress = async (userId, movieId, { position, duration } = {}) => {
  if (!(await visibleMovie(movieId, userId))) return { error: 'not_found' };
  const pos = num(position, 0, MAX_DURATION) ?? 0;
  const dur = num(duration, 0, MAX_DURATION) ?? 0;
  await query(
    `INSERT INTO film_progress (user_id, movie_id, position_sec, duration_sec)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, movie_id)
     DO UPDATE SET position_sec = $3,
                   duration_sec = GREATEST(film_progress.duration_sec, $4),
                   updated_at = now()`,
    [userId, movieId, pos, dur]);
  return { ok: true };
};

export const listProgress = async (userId) => {
  const { rows } = await query(
    `SELECT movie_id, position_sec, duration_sec FROM film_progress
      WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200`, [userId]);
  return rows.map((r) => ({
    movieId: r.movie_id,
    position: Number(r.position_sec),
    duration: Number(r.duration_sec),
  }));
};

/**
 * «Продолжить просмотр»: начатое и не досмотренное. Досмотренным
 * считаем последнюю минуту — возвращать человека к титрам незачем.
 */
export const listContinue = async (userId, { limit } = {}) => {
  const lim = num(limit, 1, 50) ?? 20;
  const { rows } = await query(
    `${SELECT_MOVIE}
      JOIN film_progress g2 ON g2.movie_id = m.id AND g2.user_id = $1
      WHERE (m.status = 'published' OR m.owner_id = $1)
        AND g2.position_sec > 30
        AND (g2.duration_sec = 0 OR g2.position_sec < g2.duration_sec - 60)
      ORDER BY g2.updated_at DESC LIMIT $2`,
    [userId, lim]);
  return rows.map(toMovie);
};

/* ─── Уборка ───────────────────────────────────────────────────────── */

/**
 * Осиротевшее.
 *
 * Два случая, и оба оставляют занятое место без хозяина:
 *
 *   • профиль удалён — ссылка владельца обнулилась. Опубликованное
 *     остаётся в каталоге, а закрытое перестаёт совпадать с кем бы то
 *     ни было: оно уже невидимо, но лежит;
 *   • файл на диске есть, а строки в базе нет — загрузка оборвалась
 *     так, что запись не доделалась.
 *
 * Оба убираем: непрочитанный никем файл — это всё равно чьё-то видео на
 * нашем диске.
 */
export const sweepOrphanFilms = async () => {
  const { rows } = await query(
    `DELETE FROM film_movies
      WHERE owner_id IS NULL AND status <> 'published'
      RETURNING id`);
  for (const r of rows) await removeMovieFiles(r.id).catch(() => {});

  const stored = await listStoredIds();
  if (stored.length === 0) return rows.length;
  const movieIds = stored.filter((n) => n.startsWith('mov-'));
  const { rows: alive } = await query(
    'SELECT id FROM film_movies WHERE id = ANY($1::text[])', [movieIds]);
  const live = new Set(alive.map((r) => r.id));
  let removed = rows.length;
  for (const id of movieIds) {
    if (live.has(id)) continue;
    await removeMovieFiles(id).catch(() => {});
    removed += 1;
  }
  // Постер без своего фильма тоже ни к чему.
  for (const id of stored) {
    if (!id.startsWith('pst-')) continue;
    const movie = `mov-${id.slice(4)}`;
    if (live.has(movie)) continue;
    if (movieIds.includes(movie)) continue;
    const { rowCount } = await query('SELECT 1 FROM film_movies WHERE id = $1', [movie]);
    if (rowCount === 0) { await removeMovieFiles(movie).catch(() => {}); removed += 1; }
  }
  return removed;
};

export { posterIdFor };
