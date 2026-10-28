/**
 * Sky Tickets: подписка организатора, мероприятия, типы билетов, афиша.
 *
 * Здесь живут все решения «кому что можно». Маршруты (routes/tickets.mjs)
 * только принимают запрос и зовут отсюда — иначе проверку пришлось бы
 * повторять в каждой ветке, и однажды в одной из них её бы не оказалось.
 *
 * Два правила, из которых следует почти всё остальное:
 *
 * 1. Право открыть кабинет организатора определяется ЗДЕСЬ, по строке в
 *    базе и текущему времени. Ни `subscription_status=active` в запросе,
 *    ни подменённый `active_until` на это не влияют — таких входных
 *    данных просто не существует.
 *
 * 2. Владелец мероприятия — это `organizer_id` в его строке. Всё, что
 *    меняет мероприятие, проходит через ownsEvent. Прислать чужой
 *    `event_id` можно, толку не будет.
 */
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { listStoredIds, remove as removeImage } from './ticketstore.mjs';

/* ─── Формы идентификаторов ───────────────────────────────────────────
   Идентификатор приходит от клиента и может быть любым. Форму проверяем
   до запроса: иначе в базу уезжает мусор, а по сообщениям об ошибке
   можно выяснять, что в ней есть. */
export const EVENT_ID_RE = /^tev-[0-9a-f-]{36}$/;
export const TYPE_ID_RE  = /^ttp-[0-9a-f-]{36}$/;
export const ORDER_ID_RE = /^tor-[0-9a-f-]{36}$/;
export const TICKET_ID_RE = /^tkt-[0-9a-f-]{36}$/;

/** Цена подписки организатора и её срок. Ровно то, что обещано на экране. */
export const ORGANIZER_PRICE = 159;
export const ORGANIZER_DAYS = 30;

export const CATEGORIES = [
  'Концерты', 'Театр', 'Спорт', 'Стендап', 'Фестивали',
  'Шоу', 'Детские', 'Выставки', 'Кино', 'Другое',
];

const MAX_TITLE = 140;
const MAX_DESC = 4000;
const MAX_PLACE = 200;
const MAX_TYPES_PER_EVENT = 20;
const MAX_EVENTS_PER_ORGANIZER = 500;

/**
 * Чистка строки от управляющих символов.
 *
 * Перевод каретки и забой в названии мероприятия — это не название, а
 * способ подделать вид афиши у того, кто её читает.
 */
const text = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

/** То же, но многострочное: в описании переводы строк нужны. */
const multiline = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim().slice(0, max);

const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback);

const accent = (value, fallback = '#4e8cf7') =>
  (/^#[0-9a-fA-F]{6}$/.test(String(value ?? '')) ? String(value) : fallback);

/** Целое в разумных пределах. Всё прочее — отказ, а не «ноль». */
const intIn = (value, min, max) => {
  /*
   * Number(null), Number(undefined ?? ''), Number('') и Number([]) дают
   * ноль или NaN не там, где ожидаешь. Без явной проверки отсутствующий
   * параметр превращался бы в осмысленный ноль: «цена не указана»
   * становилось бы «билет бесплатный», а пустой фильтр цены — фильтром
   * «не дороже нуля», который не находит ничего.
   */
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
};

/** Дата от клиента. Мусор превращается не в «сейчас», а в отказ. */
const when = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Событие в 1970-м или в 2300-м — это опечатка, а не мероприятие.
  const year = d.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return d;
};

/**
 * Строка, по которой ищут в афише.
 *
 * Приведение регистра делает JavaScript, а не база. lower() в
 * PostgreSQL складывает регистр по правилам LC_CTYPE той базы, где
 * выполняется: на одной сборке libc «Концерт» становится «концерт», на
 * другой остаётся как есть — и поиск по-русски молча делается
 * чувствительным к регистру. toLowerCase() ведёт себя одинаково везде.
 */
export const searchTextFor = (parts) =>
  parts.filter(Boolean).join(' ').toLowerCase().slice(0, 600);

/** Пересобрать строку поиска по тому, что сейчас лежит в базе. */
const refreshSearchText = async (eventId) => {
  const { rows } = await query(
    `SELECT e.title, e.venue, e.city, e.category,
            COALESCE(o.display_name, p.name) AS organizer_name
       FROM ticket_events e
       LEFT JOIN profiles p ON p.id = e.organizer_id
       LEFT JOIN ticket_organizers o ON o.profile_id = e.organizer_id
      WHERE e.id = $1`,
    [eventId],
  );
  const r = rows[0];
  if (!r) return;
  await query('UPDATE ticket_events SET search_text = $2 WHERE id = $1',
    [eventId, searchTextFor([r.title, r.venue, r.city, r.category, r.organizer_name])]);
};

/* ─── Журнал ────────────────────────────────────────────────────────── */

export const logTicket = async (eventId, actorId, action, detail = '') => {
  try {
    await query(
      'INSERT INTO ticket_log (event_id, actor_id, action, detail) VALUES ($1,$2,$3,$4)',
      [eventId, actorId, text(action, 64), text(detail, 400)],
    );
  } catch {
    /* Журнал не должен ронять операцию, которую он описывает. */
  }
};

/* ══════════════════════════════════════════════════════════════════════
   Подписка организатора
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Состояние подписки. Единственное место, где решается «активна ли».
 *
 * Решение принимается по сроку, а не по слову в колонке status:
 * рассинхрон между ними иначе давал бы месяц бесплатно. Поле status
 * остаётся для истории и для экрана.
 */
export const organizerState = async (profileId) => {
  const { rows } = await query(
    'SELECT status, active_until, display_name, started_at FROM ticket_organizers WHERE profile_id = $1',
    [profileId],
  );
  const row = rows[0];
  if (!row) {
    return { status: 'inactive', active: false, activeUntil: null, price: ORGANIZER_PRICE, days: ORGANIZER_DAYS };
  }

  const until = row.active_until ? new Date(row.active_until) : null;
  const live = row.status === 'active' && until !== null && until.getTime() > Date.now();

  /* Срок вышел, а в колонке всё ещё «active» — это не «активна»,
     это «мы ещё не успели переписать колонку». Показываем правду. */
  const status = live ? 'active'
    : row.status === 'active' ? 'expired'
      : row.status;

  return {
    status,
    active: live,
    activeUntil: until ? until.toISOString() : null,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    displayName: row.display_name ?? null,
    price: ORGANIZER_PRICE,
    days: ORGANIZER_DAYS,
    /* Сколько дней осталось — чтобы экран не считал это сам из даты. */
    daysLeft: live ? Math.max(0, Math.ceil((until.getTime() - Date.now()) / 86400_000)) : 0,
  };
};

/** Короткий ответ на вопрос «можно ли ему в кабинет». */
export const isOrganizer = async (profileId) => (await organizerState(profileId)).active;

/**
 * Продление подписки после подтверждённой оплаты.
 *
 * Вызывается ТОЛЬКО из места, которое уже списало деньги. Сама по себе
 * эта функция ничего не проверяет про оплату — поэтому она не
 * экспортируется в маршруты напрямую, а вызывается из
 * ticketorders.mjs::payOrganizer.
 *
 * Продление считается от большего из «сейчас» и «текущего конца»: тот,
 * кто платит заранее, не теряет остаток, а тот, у кого срок вышел
 * месяц назад, не получает месяц задним числом.
 */
export const extendOrganizer = async (client, profileId, days) => {
  const { rows } = await client.query(
    `INSERT INTO ticket_organizers (profile_id, status, active_until, started_at, updated_at)
     VALUES ($1, 'active', now() + ($2 || ' days')::interval, now(), now())
     ON CONFLICT (profile_id) DO UPDATE SET
       status = 'active',
       active_until = GREATEST(COALESCE(ticket_organizers.active_until, now()), now())
                      + ($2 || ' days')::interval,
       started_at = COALESCE(ticket_organizers.started_at, now()),
       updated_at = now()
     RETURNING active_until`,
    [profileId, String(days)],
  );
  return rows[0].active_until;
};

/**
 * Гасит подписки, чей срок вышел.
 *
 * Данные организатора при этом не трогаются: ни мероприятия, ни
 * черновики, ни заказы, ни проданные билеты. Меняется только право
 * пользоваться кабинетом — и оно и так вычисляется по сроку. Эта
 * уборка нужна, чтобы колонка status не врала в отчётах.
 */
export const expireOrganizers = async () => {
  const { rowCount } = await query(
    `UPDATE ticket_organizers SET status = 'expired', updated_at = now()
      WHERE status = 'active' AND (active_until IS NULL OR active_until <= now())`,
  );
  return rowCount;
};

/** Имя организатора в афише. Пустое — берём имя профиля. */
export const setOrganizerName = async (profileId, name) => {
  const clean = text(name, 80);
  await query(
    `INSERT INTO ticket_organizers (profile_id, display_name, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (profile_id) DO UPDATE SET display_name = $2, updated_at = now()`,
    [profileId, clean || null],
  );
  /* Имя организатора участвует в поиске, поэтому строки поиска его
     мероприятий надо пересобрать: иначе афиша ещё долго находилась бы
     по прежнему имени. */
  const { rows } = await query(
    'SELECT id FROM ticket_events WHERE organizer_id = $1', [profileId],
  );
  for (const r of rows) await refreshSearchText(r.id);
  return organizerState(profileId);
};

/* ══════════════════════════════════════════════════════════════════════
   Право на мероприятие
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Это моё мероприятие?
 *
 * Единственная функция, дающая право на правку. Всё, что меняет
 * мероприятие, обязано пройти через неё, и ни одна ручка не решает сама.
 */
export const ownsEvent = async (eventId, organizerId) => {
  if (!EVENT_ID_RE.test(String(eventId ?? '')) || !organizerId) return false;
  const { rowCount } = await query(
    'SELECT 1 FROM ticket_events WHERE id = $1 AND organizer_id = $2',
    [eventId, organizerId],
  );
  return rowCount > 0;
};

/**
 * Право менять мероприятие: своё И с живой подпиской.
 *
 * Две проверки вместе, потому что порознь их однажды забудут связать.
 * Возвращает код отказа, а не просто false: «не ваше» и «подписка
 * кончилась» — разные вещи, и человеку надо сказать, какая именно.
 */
export const mayManage = async (eventId, profileId) => {
  if (!(await ownsEvent(eventId, profileId))) return { error: 'not_found' };
  if (!(await isOrganizer(profileId))) return { error: 'subscription_required' };
  return { ok: true };
};

/**
 * Право проверять билеты на входе: организатор мероприятия ИЛИ сотрудник (контролёр, кассир, менеджер,
 * администратор) либо владелец организации SkyKassa Business, к которой мероприятие привязано.
 * Подписка организатора для работы на входе не нужна: входит и тот, у кого кабинета организатора нет.
 */
export const mayDoor = async (eventId, profileId) => {
  if (!EVENT_ID_RE.test(String(eventId ?? '')) || !profileId) return false;
  const { rowCount } = await query(
    `SELECT 1 FROM ticket_events e
      WHERE e.id = $1 AND (e.organizer_id = $2 OR (e.business_id IS NOT NULL AND (
            EXISTS (SELECT 1 FROM kb_businesses b WHERE b.id = e.business_id AND b.owner_id = $2)
         OR EXISTS (SELECT 1 FROM kb_staff s WHERE s.business_id = e.business_id AND s.profile_id = $2 AND s.status = 'active'
                      AND s.role IN ('admin','manager','cashier','controller')))))`,
    [eventId, profileId],
  );
  return rowCount > 0;
};

/** Организации, которыми человек владеет: к ним можно привязать своё мероприятие. */
export const ownBusinesses = async (profileId) => {
  const { rows } = await query(
    "SELECT id, name FROM kb_businesses WHERE owner_id = $1 AND status = 'active' ORDER BY created_at, id", [profileId]);
  return rows.map((r) => ({ id: r.id, name: r.name }));
};

/** Мероприятия, на входе которых человек вправе работать (свои и организаций, где он сотрудник/владелец): ближайшие и идущие. */
export const doorEvents = async (profileId) => {
  const { rows } = await query(
    `SELECT e.id, e.title, e.starts_at, e.venue, e.city, e.status, b.name AS business
       FROM ticket_events e LEFT JOIN kb_businesses b ON b.id = e.business_id
      WHERE e.status IN ('published','paused') AND COALESCE(e.ends_at, e.starts_at + interval '12 hours') > now() - interval '12 hours'
        AND (e.organizer_id = $1 OR (e.business_id IS NOT NULL AND (
              b.owner_id = $1 OR EXISTS (SELECT 1 FROM kb_staff s WHERE s.business_id = e.business_id AND s.profile_id = $1 AND s.status = 'active'
                                           AND s.role IN ('admin','manager','cashier','controller')))))
      ORDER BY e.starts_at LIMIT 50`, [profileId]);
  return rows.map((r) => ({ id: r.id, title: r.title, startsAt: r.starts_at.toISOString(), venue: r.venue, city: r.city, status: r.status, business: r.business ?? null }));
};

/* ══════════════════════════════════════════════════════════════════════
   Вид мероприятия наружу
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Публичная проекция. Ни причины отказа модератора, ни черновиков, ни
 * идентификатора организатора здесь нет: афишу видит кто угодно.
 */
const publicEvent = (row) => ({
  id: row.id,
  title: row.title,
  desc: row.description ? decryptContent(row.description) : '',
  category: row.category,
  ageLimit: row.age_limit,
  startsAt: row.starts_at.toISOString(),
  endsAt: row.ends_at ? row.ends_at.toISOString() : null,
  timezone: row.timezone,
  city: row.city,
  venue: row.venue,
  address: row.address,
  venueNote: row.venue_note,
  status: row.status,
  accent: row.accent,
  hasCover: row.has_cover,
  images: Number(row.image_count ?? 0),
  organizerName: row.organizer_name ?? 'Организатор',
  views: Number(row.views ?? 0),
  /* Цена «от» и остаток мест считает сервер: клиент их не складывает
     и подделать не может. */
  priceFrom: row.price_from === null || row.price_from === undefined ? null : Number(row.price_from),
  available: Number(row.available ?? 0),
  capacity: Number(row.capacity ?? 0),
  soldOut: Number(row.available ?? 0) <= 0,
  favorite: row.favorite === true,
});

const ownerEvent = (row) => ({
  ...publicEvent(row),
  own: true,
  rejectReason: row.reject_reason ?? undefined,
  publishedAt: row.published_at ? row.published_at.toISOString() : null,
  createdAt: row.created_at.toISOString(),
  sold: Number(row.sold_count ?? 0),
  revenue: Number(row.revenue ?? 0),
  orders: Number(row.order_count ?? 0),
});

/* Общий кусок запроса: цена «от», остаток и вместимость считаются в
   базе одним проходом, а не сложением на клиенте. */
const EVENT_AGG = `
  (SELECT min(t.price) FROM ticket_types t
    WHERE t.event_id = e.id AND t.status = 'active')                       AS price_from,
  (SELECT COALESCE(sum(t.quantity - t.sold), 0) FROM ticket_types t
    WHERE t.event_id = e.id AND t.status = 'active')                       AS available,
  (SELECT COALESCE(sum(t.quantity), 0) FROM ticket_types t
    WHERE t.event_id = e.id)                                               AS capacity,
  (SELECT count(*) FROM ticket_event_images i WHERE i.event_id = e.id)     AS image_count,
  COALESCE(o.display_name, p.name)                                         AS organizer_name`;

const EVENT_JOIN = `
  FROM ticket_events e
  LEFT JOIN profiles p ON p.id = e.organizer_id
  LEFT JOIN ticket_organizers o ON o.profile_id = e.organizer_id`;

/* ══════════════════════════════════════════════════════════════════════
   Афиша и поиск
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Каталог. Фильтрация и поиск — в базе, с пагинацией.
 *
 * Весь каталог на клиент не уезжает: на тысяче мероприятий это мегабайты
 * на каждое нажатие клавиши, а фильтровать всё равно пришлось бы здесь —
 * иначе черновик чужого мероприятия доехал бы до браузера, и «не
 * показывать» его было бы делом браузера.
 */
export const listCatalog = async (viewerId, opts = {}) => {
  const clauses = [`e.status IN ('published', 'paused')`];
  const args = [viewerId ?? ''];

  const add = (value) => { args.push(value); return `$${args.length}`; };

  const q = text(opts.q, 80).toLowerCase();
  if (q.length >= 2) {
    const like = add(`%${q.replace(/([\\%_])/g, '\\$1')}%`);
    /* Ищем по заранее приведённой строке: приведение регистра сделал
       сервер, база только сравнивает. Так поиск по-русски одинаково
       работает на любой сборке libc — см. миграцию 036.

       Описания в этой строке нет: оно зашифровано, и расшифровывать
       тысячу строк ради одного запроса дороже, чем не искать по ним. */
    clauses.push(`e.search_text LIKE ${like}`);
  }

  if (opts.city && opts.city !== 'Все') clauses.push(`e.city = ${add(text(opts.city, 80))}`);
  if (CATEGORIES.includes(opts.category)) clauses.push(`e.category = ${add(opts.category)}`);

  const from = when(opts.from);
  const to = when(opts.to);
  if (from) clauses.push(`e.starts_at >= ${add(from)}`);
  if (to)   clauses.push(`e.starts_at <= ${add(to)}`);

  const priceMin = intIn(opts.priceMin, 0, 10_000_000);
  const priceMax = intIn(opts.priceMax, 0, 10_000_000);
  if (priceMin !== null) {
    clauses.push(`EXISTS (SELECT 1 FROM ticket_types t
                           WHERE t.event_id = e.id AND t.status = 'active' AND t.price >= ${add(priceMin)})`);
  }
  if (priceMax !== null) {
    clauses.push(`EXISTS (SELECT 1 FROM ticket_types t
                           WHERE t.event_id = e.id AND t.status = 'active' AND t.price <= ${add(priceMax)})`);
  }

  /* «Только те, где есть билеты» — тоже условие базы: считать остаток
     на клиенте значит сначала прислать ему всё. */
  if (opts.available === true) {
    clauses.push(`EXISTS (SELECT 1 FROM ticket_types t
                           WHERE t.event_id = e.id AND t.status = 'active' AND t.sold < t.quantity)`);
  }

  /* Прошедшие в афише не нужны: «купить билет на вчера» — не то, за чем
     сюда приходят. Показываем их только в своём кабинете. */
  if (opts.past !== true) clauses.push(`e.starts_at > now() - interval '4 hours'`);

  const period = String(opts.period ?? '');
  if (period === 'today')  clauses.push(`e.starts_at::date = now()::date`);
  if (period === 'week')   clauses.push(`e.starts_at <= now() + interval '7 days'`);

  const order = period === 'popular'
    ? 'e.views DESC, e.starts_at'
    : 'e.starts_at';

  const limit = Math.min(Math.max(intIn(opts.limit, 1, 100) ?? 30, 1), 100);
  const offset = Math.max(intIn(opts.offset, 0, 100000) ?? 0, 0);

  const { rows } = await query(
    `SELECT e.*, ${EVENT_AGG},
            EXISTS (SELECT 1 FROM ticket_favorites f
                     WHERE f.event_id = e.id AND f.user_id = $1) AS favorite
       ${EVENT_JOIN}
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${order}
      LIMIT ${limit + 1} OFFSET ${offset}`,
    args,
  );

  /* Берём на одну строку больше, чем просили: так «есть ли ещё» знаем
     точно и без второго запроса COUNT по всей таблице. */
  const more = rows.length > limit;
  return { events: rows.slice(0, limit).map(publicEvent), more, offset, limit };
};

/** Города, по которым есть что показать. Список для фильтра — из базы. */
export const listCities = async () => {
  const { rows } = await query(
    `SELECT city, count(*)::int AS n FROM ticket_events
      WHERE status IN ('published','paused') AND city <> '' AND starts_at > now()
      GROUP BY city ORDER BY n DESC, city LIMIT 40`,
  );
  return rows.map((r) => r.city);
};

/**
 * Одно мероприятие вместе с типами билетов.
 *
 * Черновик виден только своему организатору. Условие стоит здесь, а не
 * в разборе ответа: иначе черновик уже уехал бы к спрашивающему.
 */
export const readEvent = async (eventId, viewerId, { countView = false } = {}) => {
  if (!EVENT_ID_RE.test(String(eventId ?? ''))) return null;

  const { rows } = await query(
    `SELECT e.*, ${EVENT_AGG},
            EXISTS (SELECT 1 FROM ticket_favorites f
                     WHERE f.event_id = e.id AND f.user_id = $2) AS favorite
       ${EVENT_JOIN}
      WHERE e.id = $1`,
    [eventId, viewerId ?? ''],
  );
  const row = rows[0];
  if (!row) return null;

  const own = row.organizer_id === viewerId;
  const visible = ['published', 'paused', 'completed', 'cancelled'].includes(row.status);
  if (!own && !visible) return null;

  /* Просмотр считаем только чужой и только у опубликованного: иначе
     организатор накрутил бы себе статистику, открывая свою же страницу. */
  if (countView && !own && row.status === 'published') {
    await query('UPDATE ticket_events SET views = views + 1 WHERE id = $1', [eventId]);
  }

  const types = await listTypes(eventId, own);
  const images = await listImages(eventId);

  const base = own ? ownerEvent(await withOwnerStats(row)) : publicEvent(row);
  return { ...base, types, images };
};

/** Продажи и выручка — только в своём кабинете, одним запросом. */
const withOwnerStats = async (row) => {
  const { rows } = await query(
    `SELECT COALESCE(sum(o.quantity), 0)::int AS sold_count,
            COALESCE(sum(o.total), 0)::bigint AS revenue,
            count(*)::int                     AS order_count
       FROM ticket_orders o WHERE o.event_id = $1 AND o.status = 'paid'`,
    [row.id],
  );
  return { ...row, ...rows[0] };
};

const listImages = async (eventId) => {
  const { rows } = await query(
    'SELECT idx FROM ticket_event_images WHERE event_id = $1 ORDER BY idx', [eventId],
  );
  return rows.map((r) => r.idx);
};

/* ══════════════════════════════════════════════════════════════════════
   Кабинет организатора
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Свои мероприятия.
 *
 * Условие organizer_id стоит в запросе, а не в разборе результата:
 * подменённый в запросе `organizer_id` сюда не попадает вовсе — его
 * здесь просто не читают, идентификатор берётся из сессии.
 */
export const listMine = async (organizerId, status = 'all') => {
  const clauses = ['e.organizer_id = $1'];
  const args = [organizerId];
  if (['draft', 'pending', 'published', 'paused', 'completed', 'cancelled'].includes(status)) {
    args.push(status);
    clauses.push(`e.status = $${args.length}`);
  }

  const { rows } = await query(
    `SELECT e.*, ${EVENT_AGG},
            FALSE AS favorite,
            (SELECT COALESCE(sum(o.quantity), 0) FROM ticket_orders o
              WHERE o.event_id = e.id AND o.status = 'paid')  AS sold_count,
            (SELECT COALESCE(sum(o.total), 0) FROM ticket_orders o
              WHERE o.event_id = e.id AND o.status = 'paid')  AS revenue,
            (SELECT count(*) FROM ticket_orders o
              WHERE o.event_id = e.id AND o.status = 'paid')  AS order_count
       ${EVENT_JOIN}
      WHERE ${clauses.join(' AND ')}
      ORDER BY e.created_at DESC
      LIMIT 200`,
    args,
  );
  return rows.map(ownerEvent);
};

/**
 * Создаёт мероприятие. Всегда черновиком.
 *
 * Опубликовать сразу нельзя даже своей же рукой: публикация проверяет
 * полноту, и обойти её созданием «уже опубликованного» не выйдет —
 * статус сюда не принимается.
 */
export const createEvent = async (organizerId, input = {}) => {
  if (!(await isOrganizer(organizerId))) return { error: 'subscription_required' };

  const title = text(input.title, MAX_TITLE);
  if (title.length < 3) return { error: 'invalid_title' };

  const startsAt = when(input.startsAt);
  if (!startsAt) return { error: 'invalid_date' };

  const { rows: counted } = await query(
    'SELECT count(*)::int AS n FROM ticket_events WHERE organizer_id = $1', [organizerId],
  );
  if (counted[0].n >= MAX_EVENTS_PER_ORGANIZER) return { error: 'too_many' };

  const id = `tev-${generateId()}`;
  await query(
    `INSERT INTO ticket_events
       (id, organizer_id, title, description, category, age_limit,
        starts_at, ends_at, timezone, city, venue, address, venue_note, accent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, organizerId, title,
     input.desc ? encryptContent(multiline(input.desc, MAX_DESC)) : null,
     oneOf(input.category, CATEGORIES, 'Другое'),
     intIn(input.ageLimit, 0, 21) ?? 0,
     startsAt, when(input.endsAt), text(input.timezone, 64) || 'Europe/Moscow',
     text(input.city, 80), text(input.venue, MAX_PLACE), text(input.address, MAX_PLACE),
     text(input.venueNote, MAX_PLACE), accent(input.accent)],
  );
  await refreshSearchText(id);
  await logTicket(id, organizerId, 'event.created', title);
  return { event: await readEvent(id, organizerId) };
};

/**
 * Правка. Владелец не передаётся: он берётся из сессии выше по стеку.
 *
 * Ни organizer_id, ни статуса, ни счётчика просмотров среди правимых
 * полей нет — их здесь просто не читают.
 */
export const updateEvent = async (eventId, organizerId, patch = {}) => {
  const may = await mayManage(eventId, organizerId);
  if (may.error) return may;

  /* Отменённое и прошедшее не правят: заказы на него уже сделаны, и
     менять условия задним числом нельзя. */
  const { rows: cur } = await query('SELECT status FROM ticket_events WHERE id = $1', [eventId]);
  if (['cancelled', 'completed'].includes(cur[0].status)) return { error: 'event_closed' };

  const sets = [];
  const args = [eventId];
  const put = (column, value) => { args.push(value); sets.push(`${column} = $${args.length}`); };

  if (patch.title !== undefined) {
    const v = text(patch.title, MAX_TITLE);
    if (v.length < 3) return { error: 'invalid_title' };
    put('title', v);
  }
  if (patch.desc !== undefined) {
    const v = multiline(patch.desc, MAX_DESC);
    put('description', v ? encryptContent(v) : null);
  }
  if (patch.category !== undefined)  put('category', oneOf(patch.category, CATEGORIES, 'Другое'));
  if (patch.ageLimit !== undefined)  put('age_limit', intIn(patch.ageLimit, 0, 21) ?? 0);
  if (patch.city !== undefined)      put('city', text(patch.city, 80));
  if (patch.venue !== undefined)     put('venue', text(patch.venue, MAX_PLACE));
  if (patch.address !== undefined)   put('address', text(patch.address, MAX_PLACE));
  if (patch.venueNote !== undefined) put('venue_note', text(patch.venueNote, MAX_PLACE));
  if (patch.timezone !== undefined)  put('timezone', text(patch.timezone, 64) || 'Europe/Moscow');
  if (patch.accent !== undefined)    put('accent', accent(patch.accent));
  if (patch.businessId !== undefined) {
    /* Привязать можно только свою действующую организацию; пустое значение — отвязать. Менять после продаж нельзя: оплаты уже идут на её реквизиты. */
    const bid = patch.businessId ? String(patch.businessId) : null;
    if (bid && !(await ownBusinesses(organizerId)).some((b) => b.id === bid)) return { error: 'business_not_found' };
    const { rows: sold } = await query('SELECT 1 FROM ticket_orders WHERE event_id = $1 AND status IN (\'paid\',\'awaiting_payment\') LIMIT 1', [eventId]);
    const { rows: curB } = await query('SELECT business_id FROM ticket_events WHERE id = $1', [eventId]);
    if (sold[0] && (curB[0]?.business_id ?? null) !== bid) return { error: 'business_locked' };
    put('business_id', bid);
  }

  if (patch.startsAt !== undefined) {
    const d = when(patch.startsAt);
    if (!d) return { error: 'invalid_date' };
    put('starts_at', d);
  }
  if (patch.endsAt !== undefined) put('ends_at', when(patch.endsAt));

  if (sets.length === 0) return { event: await readEvent(eventId, organizerId) };
  sets.push('updated_at = now()');

  await query(`UPDATE ticket_events SET ${sets.join(', ')} WHERE id = $1`, args);
  await refreshSearchText(eventId);
  return { event: await readEvent(eventId, organizerId) };
};

/* ─── Публикация ───────────────────────────────────────────────────── */

/**
 * Чего не хватает, чтобы опубликовать.
 *
 * Список причин, а не «нельзя»: человек должен увидеть, что именно
 * дозаполнить, а не гадать.
 */
export const publishProblems = async (eventId) => {
  const { rows } = await query(
    `SELECT e.*,
            (SELECT count(*) FROM ticket_types t
              WHERE t.event_id = e.id AND t.status = 'active' AND t.quantity > 0) AS types
       FROM ticket_events e WHERE e.id = $1`,
    [eventId],
  );
  const e = rows[0];
  if (!e) return ['not_found'];

  const problems = [];
  if (text(e.title, MAX_TITLE).length < 3) problems.push('Нужно название');
  if (!e.description || decryptContent(e.description).trim().length < 20) problems.push('Нужно описание от 20 символов');
  if (!e.city) problems.push('Нужен город');
  if (!e.venue) problems.push('Нужна площадка');
  if (!e.starts_at) problems.push('Нужна дата и время');
  if (e.starts_at && new Date(e.starts_at).getTime() < Date.now()) problems.push('Дата уже прошла');
  if (!e.category || e.category === 'Другое') problems.push('Выберите категорию');
  if (!e.has_cover) problems.push('Нужна афиша');
  if (Number(e.types) === 0) problems.push('Нужен хотя бы один тип билета с местами');
  return problems;
};

/**
 * Отправляет в афишу.
 *
 * Если в Sky включена модерация — уходит на проверку, а не сразу в
 * каталог: обходить существующую модерацию отдельной дверью нельзя.
 */
export const submitEvent = async (eventId, organizerId, { moderated = true } = {}) => {
  const may = await mayManage(eventId, organizerId);
  if (may.error) return may;

  const { rows } = await query('SELECT status FROM ticket_events WHERE id = $1', [eventId]);
  const status = rows[0].status;
  if (status === 'pending')   return { error: 'already_pending' };
  if (status === 'published') return { error: 'already_published' };
  if (['cancelled', 'completed'].includes(status)) return { error: 'event_closed' };

  const problems = await publishProblems(eventId);
  if (problems.length) return { error: 'incomplete', problems };

  const next = moderated ? 'pending' : 'published';
  await query(
    `UPDATE ticket_events
        SET status = $2, reject_reason = NULL,
            published_at = CASE WHEN $2 = 'published' THEN now() ELSE published_at END,
            updated_at = now()
      WHERE id = $1`,
    [eventId, next],
  );
  await logTicket(eventId, organizerId, moderated ? 'event.submitted' : 'event.published', '');
  return { event: await readEvent(eventId, organizerId) };
};

/** Решение модератора. Право проверяет вызывающий. */
export const moderateEvent = async (eventId, approve, reason = '') => {
  if (!EVENT_ID_RE.test(String(eventId ?? ''))) return { error: 'not_found' };
  const { rowCount } = await query(
    `UPDATE ticket_events
        SET status = $2, reject_reason = $3,
            published_at = CASE WHEN $2 = 'published' THEN now() ELSE published_at END,
            updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [eventId, approve ? 'published' : 'draft', approve ? null : text(reason, 300)],
  );
  if (!rowCount) return { error: 'not_pending' };
  await logTicket(eventId, null, approve ? 'event.approved' : 'event.rejected', text(reason, 200));
  return { ok: true };
};

export const moderationQueue = async () => {
  const { rows } = await query(
    `SELECT e.*, ${EVENT_AGG}, FALSE AS favorite ${EVENT_JOIN}
      WHERE e.status = 'pending' ORDER BY e.updated_at LIMIT 100`,
  );
  return rows.map((r) => ({ ...publicEvent(r), organizerName: r.organizer_name }));
};

/**
 * Смена статуса владельцем.
 *
 * Разрешены только осмысленные переходы. «Опубликовать» отдельной
 * кнопкой здесь недоступно: для этого есть submitEvent с проверкой
 * полноты — иначе её можно было бы обойти сменой статуса.
 */
export const setEventStatus = async (eventId, organizerId, next) => {
  const may = await mayManage(eventId, organizerId);
  if (may.error) return may;

  const { rows } = await query('SELECT status FROM ticket_events WHERE id = $1', [eventId]);
  const cur = rows[0].status;

  const allowed = {
    published: ['paused', 'cancelled', 'draft'],
    paused:    ['published', 'cancelled'],
    pending:   ['draft'],
    draft:     ['cancelled'],
  };
  if (!allowed[cur]?.includes(next)) return { error: 'bad_transition' };

  await query('UPDATE ticket_events SET status = $2, updated_at = now() WHERE id = $1', [eventId, next]);
  await logTicket(eventId, organizerId, `event.${next}`, '');

  /* Отмена мероприятия гасит выпущенные билеты: держать «действителен»
     на отменённом — обман того, кто придёт по нему ко входу. */
  if (next === 'cancelled') {
    await query(
      `UPDATE tickets SET status = 'cancelled' WHERE event_id = $1 AND status = 'valid'`,
      [eventId],
    );
    await logTicket(eventId, organizerId, 'tickets.cancelled', 'мероприятие отменено');
  }
  return { event: await readEvent(eventId, organizerId) };
};

/* ══════════════════════════════════════════════════════════════════════
   Типы билетов
   ══════════════════════════════════════════════════════════════════════ */

const publicType = (row) => ({
  id: row.id,
  name: row.name,
  desc: row.description,
  price: Number(row.price),
  /* Наружу — остаток, а не «сколько всего» и «сколько продано»:
     количество проданного не дело постороннего. */
  available: Math.max(0, Number(row.quantity) - Number(row.sold)),
  saleFrom: row.sale_from ? row.sale_from.toISOString() : null,
  saleTo: row.sale_to ? row.sale_to.toISOString() : null,
  perUserMax: Number(row.per_user_max),
  status: row.status,
  /* На продажу сейчас или нет — считает сервер, вместе с окном продаж. */
  onSale: row.status === 'active'
    && Number(row.sold) < Number(row.quantity)
    && (!row.sale_from || new Date(row.sale_from).getTime() <= Date.now())
    && (!row.sale_to || new Date(row.sale_to).getTime() >= Date.now()),
});

const ownerType = (row) => ({
  ...publicType(row),
  quantity: Number(row.quantity),
  sold: Number(row.sold),
});

export const listTypes = async (eventId, own = false) => {
  const { rows } = await query(
    `SELECT * FROM ticket_types WHERE event_id = $1 ${own ? '' : "AND status <> 'hidden'"}
      ORDER BY ordering, price`,
    [eventId],
  );
  return rows.map(own ? ownerType : publicType);
};

export const createType = async (eventId, organizerId, input = {}) => {
  const may = await mayManage(eventId, organizerId);
  if (may.error) return may;

  const name = text(input.name, 80);
  if (name.length < 2) return { error: 'invalid_type_name' };

  const price = intIn(input.price, 0, 10_000_000);
  if (price === null) return { error: 'invalid_price' };

  const quantity = intIn(input.quantity, 1, 1_000_000);
  if (quantity === null) return { error: 'invalid_quantity' };

  const { rows: counted } = await query(
    'SELECT count(*)::int AS n FROM ticket_types WHERE event_id = $1', [eventId],
  );
  if (counted[0].n >= MAX_TYPES_PER_EVENT) return { error: 'too_many_types' };

  const id = `ttp-${generateId()}`;
  await query(
    `INSERT INTO ticket_types
       (id, event_id, name, description, price, quantity, sale_from, sale_to, per_user_max, ordering)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, eventId, name, text(input.desc, 200), price, quantity,
     when(input.saleFrom), when(input.saleTo),
     intIn(input.perUserMax, 1, 100) ?? 8, counted[0].n],
  );
  await logTicket(eventId, organizerId, 'type.created', `${name} · ${price} ₽ · ${quantity} шт`);
  return { types: await listTypes(eventId, true) };
};

/**
 * Правка типа билета.
 *
 * Количество нельзя опустить ниже уже проданного: иначе у людей на
 * руках оказались бы билеты на места, которых больше нет.
 */
export const updateType = async (typeId, organizerId, patch = {}) => {
  if (!TYPE_ID_RE.test(String(typeId ?? ''))) return { error: 'not_found' };

  const { rows } = await query('SELECT event_id, sold FROM ticket_types WHERE id = $1', [typeId]);
  if (!rows[0]) return { error: 'not_found' };
  const may = await mayManage(rows[0].event_id, organizerId);
  if (may.error) return may;

  const sets = [];
  const args = [typeId];
  const put = (column, value) => { args.push(value); sets.push(`${column} = $${args.length}`); };

  if (patch.name !== undefined) {
    const v = text(patch.name, 80);
    if (v.length < 2) return { error: 'invalid_type_name' };
    put('name', v);
  }
  if (patch.desc !== undefined) put('description', text(patch.desc, 200));
  if (patch.price !== undefined) {
    const v = intIn(patch.price, 0, 10_000_000);
    if (v === null) return { error: 'invalid_price' };
    put('price', v);
  }
  if (patch.quantity !== undefined) {
    const v = intIn(patch.quantity, 0, 1_000_000);
    if (v === null) return { error: 'invalid_quantity' };
    if (v < Number(rows[0].sold)) return { error: 'below_sold' };
    put('quantity', v);
  }
  if (patch.saleFrom !== undefined)   put('sale_from', when(patch.saleFrom));
  if (patch.saleTo !== undefined)     put('sale_to', when(patch.saleTo));
  if (patch.perUserMax !== undefined) put('per_user_max', intIn(patch.perUserMax, 1, 100) ?? 8);
  if (patch.status !== undefined)     put('status', oneOf(patch.status, ['active', 'hidden', 'closed'], 'active'));

  if (sets.length === 0) return { types: await listTypes(rows[0].event_id, true) };
  await query(`UPDATE ticket_types SET ${sets.join(', ')} WHERE id = $1`, args);
  await logTicket(rows[0].event_id, organizerId, 'type.updated', '');
  return { types: await listTypes(rows[0].event_id, true) };
};

/** Удалить можно только то, по чему ещё ничего не продано. */
export const deleteType = async (typeId, organizerId) => {
  if (!TYPE_ID_RE.test(String(typeId ?? ''))) return { error: 'not_found' };
  const { rows } = await query('SELECT event_id, sold FROM ticket_types WHERE id = $1', [typeId]);
  if (!rows[0]) return { error: 'not_found' };
  const may = await mayManage(rows[0].event_id, organizerId);
  if (may.error) return may;
  if (Number(rows[0].sold) > 0) return { error: 'has_sales' };

  await query('DELETE FROM ticket_types WHERE id = $1', [typeId]);
  return { types: await listTypes(rows[0].event_id, true) };
};

/* ══════════════════════════════════════════════════════════════════════
   Обложка и картинки
   ══════════════════════════════════════════════════════════════════════ */

export const setCover = async (eventId, organizerId, mime) => {
  const may = await mayManage(eventId, organizerId);
  if (may.error) return may;
  await query(
    'UPDATE ticket_events SET has_cover = TRUE, cover_mime = $2, updated_at = now() WHERE id = $1',
    [eventId, String(mime).slice(0, 64)],
  );
  return { ok: true };
};

export const coverMime = async (eventId) => {
  const { rows } = await query(
    'SELECT cover_mime, has_cover, status FROM ticket_events WHERE id = $1', [eventId],
  );
  if (!rows[0] || !rows[0].has_cover) return null;
  return { mime: rows[0].cover_mime ?? 'image/jpeg', status: rows[0].status };
};

export const addImage = async (eventId, organizerId, mime) => {
  const may = await mayManage(eventId, organizerId);
  if (may.error) return may;
  const { rows } = await query(
    'SELECT COALESCE(max(idx), -1) + 1 AS next FROM ticket_event_images WHERE event_id = $1',
    [eventId],
  );
  const idx = Number(rows[0].next);
  if (idx >= 8) return { error: 'too_many_images' };
  await query(
    'INSERT INTO ticket_event_images (event_id, idx, mime) VALUES ($1,$2,$3)',
    [eventId, idx, String(mime).slice(0, 64)],
  );
  return { idx };
};

export const imageMime = async (eventId, idx) => {
  const { rows } = await query(
    'SELECT mime FROM ticket_event_images WHERE event_id = $1 AND idx = $2', [eventId, idx],
  );
  return rows[0]?.mime ?? null;
};

/* ══════════════════════════════════════════════════════════════════════
   Избранное
   ══════════════════════════════════════════════════════════════════════ */

export const setFavorite = async (eventId, userId, on) => {
  if (!EVENT_ID_RE.test(String(eventId ?? ''))) return { error: 'not_found' };
  if (on) {
    await query(
      'INSERT INTO ticket_favorites (user_id, event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [userId, eventId],
    );
  } else {
    await query('DELETE FROM ticket_favorites WHERE user_id = $1 AND event_id = $2', [userId, eventId]);
  }
  return { favorite: on === true };
};

export const listFavorites = async (userId) => {
  const { rows } = await query(
    `SELECT e.*, ${EVENT_AGG}, TRUE AS favorite
       ${EVENT_JOIN}
       JOIN ticket_favorites f ON f.event_id = e.id AND f.user_id = $1
      WHERE e.status IN ('published','paused','completed')
      ORDER BY e.starts_at LIMIT 100`,
    [userId],
  );
  return rows.map(publicEvent);
};

/* ══════════════════════════════════════════════════════════════════════
   Уборка
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Прошедшее переводим в «завершено», а его билеты — в «просрочен».
 *
 * Без этого «действителен» висел бы на билете годами, и человек не
 * отличал бы свой завтрашний билет от прошлогоднего.
 */
export const closePastEvents = async () => {
  const { rows } = await query(
    `UPDATE ticket_events SET status = 'completed', updated_at = now()
      WHERE status IN ('published', 'paused')
        AND COALESCE(ends_at, starts_at + interval '6 hours') < now() - interval '12 hours'
      RETURNING id`,
  );
  if (rows.length) {
    await query(
      `UPDATE tickets SET status = 'expired'
        WHERE status = 'valid' AND event_id = ANY($1::text[])`,
      [rows.map((r) => r.id)],
    );
  }
  return rows.length;
};

/**
 * Картинки, у которых больше нет строки в базе.
 *
 * Оборвавшаяся загрузка и удалённое мероприятие оставляют файл на
 * диске: открыть его уже нечем, а место он занимает. Идём от диска к
 * базе, а не наоборот — так лишний файл находится, а нужный не
 * пропадёт: если строка есть, файл остаётся.
 */
export const sweepOrphanTicketImages = async () => {
  const stored = await listStoredIds();
  if (!stored.length) return 0;

  const { rows: events } = await query('SELECT id FROM ticket_events WHERE has_cover');
  const alive = new Set();
  for (const e of events) alive.add(`tcv-${e.id.slice(4)}`);

  const { rows: images } = await query('SELECT event_id, idx FROM ticket_event_images');
  for (const i of images) alive.add(`tim-${i.event_id.slice(4)}-${i.idx}`);

  let removed = 0;
  for (const id of stored) {
    if (alive.has(id)) continue;
    await removeImage(id);
    removed += 1;
  }
  return removed;
};

export { pool };
