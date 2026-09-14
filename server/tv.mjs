/**
 * Sky TV: каналы, источники, телепрограмма.
 *
 * Разделение, ради которого всё это написано: канал — открытая вещь,
 * источник — закрытая.
 *
 * Наружу уходит только канал: название, раздел, логотип, есть ли эфир.
 * Ни адреса, ни заголовков, ни ключей источника нет ни в одном ответе —
 * не потому, что мы их вычёркиваем перед отправкой, а потому, что
 * функция представления (toChannel) их просто не читает. Чтобы они
 * утекли, надо специально это написать.
 *
 * Источник заводит владелец, и только он. Клиент не присылает адрес
 * никуда и никогда: такого параметра нет ни в одной ручке. Он
 * присылает идентификатор канала, а какой источник ему соответствует,
 * сервер решает сам, обращаясь к базе.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { isOwner, can } from './admin.mjs';
import { checkUrl, probeSource, SourceRejected } from './tvsource.mjs';

const newId = (p) => `${p}-${crypto.randomUUID()}`;

const MAX_NAME = 120;
const MAX_DESC = 2000;
const MAX_SHORT = 60;
const MAX_LICENCE = 500;

const text = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u001f\u007f]/g, '')
  .trim()
  .slice(0, max);

const num = (v, min, max) => {
  if (v === null || v === undefined || v === '' || typeof v === 'object') return null;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
};

/** Разделы каталога. Набор закрытый: по нему собираются кнопки. */
export const CATEGORIES = [
  'Новости', 'Развлекательные', 'Спорт', 'Детские',
  'Познавательные', 'Кино', 'Музыка', 'Региональные', 'Разное',
];

/* ─── Представление наружу ─────────────────────────────────────────── */

/**
 * Что уходит клиенту.
 *
 * Полей источника здесь нет ни одного. «Эфир доступен» — это ответ на
 * вопрос «показывать ли кнопку», а не сведения о том, откуда берётся
 * поток.
 */
export const toChannel = (row) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description || undefined,
  category: row.category,
  country: row.country,
  region: row.region || undefined,
  accent: row.accent,
  mark: row.mark || row.name.slice(0, 2).toUpperCase(),
  hasLogo: Boolean(row.has_logo),
  ageRating: row.age_rating || undefined,
  /** Есть ли у канала живой источник. Больше об источнике — ничего. */
  live: row.live === true,
  /**
   * Почему эфира нет. Два состояния, и оба — про нас, а не про
   * источник: 'no_source' — владелец ещё не подключил источник,
   * 'unavailable' — подключён, но сейчас не отвечает.
   */
  offline: row.live === true ? undefined : (row.has_source === true ? 'unavailable' : 'no_source'),
  favorite: row.favorite === true || undefined,
  now: row.now_title ? {
    title: row.now_title,
    startsAt: row.now_starts?.toISOString?.(),
    endsAt: row.now_ends?.toISOString?.(),
  } : undefined,
  next: row.next_title ? {
    title: row.next_title,
    startsAt: row.next_starts?.toISOString?.(),
  } : undefined,
});

/**
 * Общая выборка канала.
 *
 * «Живой» считается здесь, а не отдельным запросом: иначе каталог из
 * полусотни каналов превращался бы в полсотни запросов. Первым
 * параметром всегда идёт тот, кто спрашивает, — от него зависит
 * «в избранном».
 */
const SELECT_CHANNEL = `
  SELECT c.*,
         EXISTS (SELECT 1 FROM tv_sources s
                  WHERE s.channel_id = c.id AND s.active) AS has_source,
         EXISTS (SELECT 1 FROM tv_sources s
                  LEFT JOIN tv_source_health h ON h.source_id = s.id
                  WHERE s.channel_id = c.id AND s.active
                    AND (h.ok IS NULL OR h.ok)) AS live,
         EXISTS (SELECT 1 FROM tv_favorites f
                  WHERE f.channel_id = c.id AND f.user_id = $1) AS favorite,
         nw.title AS now_title, nw.starts_at AS now_starts, nw.ends_at AS now_ends,
         nx.title AS next_title, nx.starts_at AS next_starts
    FROM tv_channels c
    LEFT JOIN LATERAL (
      SELECT e.title, e.starts_at, e.ends_at FROM tv_epg e
       WHERE e.channel_id = c.id AND e.starts_at <= now() AND e.ends_at > now()
       ORDER BY e.starts_at DESC LIMIT 1
    ) nw ON TRUE
    LEFT JOIN LATERAL (
      SELECT e.title, e.starts_at FROM tv_epg e
       WHERE e.channel_id = c.id AND e.starts_at > now()
       ORDER BY e.starts_at ASC LIMIT 1
    ) nx ON TRUE
`;

/* ─── Каталог ──────────────────────────────────────────────────────── */

export const listChannels = async (viewerId, { category, q, favorites } = {}) => {
  const args = [viewerId ?? ''];
  const where = ['c.enabled'];

  const cat = text(category, MAX_SHORT);
  if (cat && cat !== 'Все') { args.push(cat); where.push(`c.category = $${args.length}`); }

  const needle = text(q, 100).toLowerCase();
  if (needle) {
    args.push(`%${needle.replace(/([\\%_])/g, '\\$1')}%`);
    where.push(`(lower(c.name) LIKE $${args.length} ESCAPE '\\'
              OR lower(c.category) LIKE $${args.length} ESCAPE '\\')`);
  }
  if (favorites) {
    where.push('EXISTS (SELECT 1 FROM tv_favorites f2 WHERE f2.channel_id = c.id AND f2.user_id = $1)');
  }

  const { rows } = await query(
    `${SELECT_CHANNEL} WHERE ${where.join(' AND ')} ORDER BY c.position, c.name LIMIT 500`, args);
  return rows.map(toChannel);
};

export const readChannel = async (channelId, viewerId) => {
  const { rows } = await query(`${SELECT_CHANNEL} WHERE c.id = $2 AND c.enabled`,
    [viewerId ?? '', String(channelId ?? '')]);
  return rows[0] ? toChannel(rows[0]) : null;
};

/** Разделы, в которых есть хотя бы один включённый канал. */
export const listCategories = async () => {
  const { rows } = await query(
    `SELECT category, count(*)::int AS n FROM tv_channels WHERE enabled
      GROUP BY category ORDER BY n DESC, category`);
  return rows.map((r) => ({ name: r.category, count: r.n }));
};

/* ─── Источник для воспроизведения ─────────────────────────────────── */

/**
 * Какой источник соответствует каналу.
 *
 * Единственное место, где расшифровывается адрес, и оно не вызывается
 * ниоткуда, кроме выдачи манифеста. Возвращённое сюда наружу не
 * уходит: ручка берёт отсюда адрес, идёт по нему сама и отдаёт зрителю
 * только содержимое.
 */
export const sourceForChannel = async (channelId) => {
  const { rows } = await query(
    `SELECT s.*, c.enabled, h.ok AS health_ok
       FROM tv_sources s
       JOIN tv_channels c ON c.id = s.channel_id
       LEFT JOIN tv_source_health h ON h.source_id = s.id
      WHERE s.channel_id = $1 AND s.active AND c.enabled
      ORDER BY (h.ok IS NOT FALSE) DESC, s.priority, s.created_at
      LIMIT 1`,
    [String(channelId ?? '')]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    channelId: row.channel_id,
    kind: row.kind,
    url: decryptSecret(row.url_enc),
    headers: row.headers_enc ? safeHeaders(decryptSecret(row.headers_enc)) : {},
    delivery: row.delivery,
  };
};

/**
 * Заголовки источника из хранимой строки.
 *
 * Разбираем осторожно: это данные из базы, но попасть туда они могли
 * когда угодно и какими угодно, а подставляются в исходящий запрос.
 * Пропускаем только обычные имена заголовков и значения без переводов
 * строки — иначе одним значением можно дописать в запрос свои строки.
 */
const safeHeaders = (raw) => {
  let parsed;
  try { parsed = JSON.parse(raw ?? '{}'); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(k)) continue;
    if (/^(host|content-length|connection|transfer-encoding)$/i.test(k)) continue;
    const value = String(v ?? '');
    if (value.length > 1024 || /[\r\n]/.test(value)) continue;
    out[k] = value;
  }
  return out;
};

/* ─── Избранное и недавние ─────────────────────────────────────────── */

export const listFavorites = async (userId) => {
  const { rows } = await query(
    `${SELECT_CHANNEL}
      JOIN tv_favorites f3 ON f3.channel_id = c.id AND f3.user_id = $1
      WHERE c.enabled ORDER BY f3.created_at DESC LIMIT 300`,
    [userId]);
  return rows.map(toChannel);
};

export const setFavorite = async (userId, channelId, on) => {
  const { rowCount } = await query('SELECT 1 FROM tv_channels WHERE id = $1 AND enabled',
    [String(channelId ?? '')]);
  if (!rowCount) return { error: 'not_found' };
  if (on) {
    await query('INSERT INTO tv_favorites (user_id, channel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [userId, channelId]);
  } else {
    await query('DELETE FROM tv_favorites WHERE user_id = $1 AND channel_id = $2', [userId, channelId]);
  }
  return { ok: true };
};

/**
 * Отметить, что человек включил канал.
 *
 * Одна строка на канал: нужен последний раз, а не журнал всех
 * включений. Держим двадцать последних — «недавно смотрели» не архив.
 */
export const noteWatched = async (userId, channelId) => {
  const { rowCount } = await query('SELECT 1 FROM tv_channels WHERE id = $1 AND enabled',
    [String(channelId ?? '')]);
  if (!rowCount) return { error: 'not_found' };
  await query(
    `INSERT INTO tv_recent (user_id, channel_id) VALUES ($1,$2)
     ON CONFLICT (user_id, channel_id) DO UPDATE SET watched_at = now()`,
    [userId, channelId]);
  await query(
    `DELETE FROM tv_recent WHERE user_id = $1 AND channel_id NOT IN (
       SELECT channel_id FROM tv_recent WHERE user_id = $1 ORDER BY watched_at DESC LIMIT 20)`,
    [userId]);
  return { ok: true };
};

export const listRecent = async (userId) => {
  const { rows } = await query(
    `${SELECT_CHANNEL}
      JOIN tv_recent r ON r.channel_id = c.id AND r.user_id = $1
      WHERE c.enabled ORDER BY r.watched_at DESC LIMIT 20`,
    [userId]);
  return rows.map(toChannel);
};

/* ─── Телепрограмма ────────────────────────────────────────────────── */

/**
 * Расписание канала на несколько дней вперёд.
 *
 * Пустой ответ — это честно: значит, источник расписания не подключён
 * или ничего не отдал. Придумывать передачи нельзя — расписание,
 * которого не было, хуже пустого экрана.
 */
export const listEpg = async (channelId, { hours } = {}) => {
  const span = num(hours, 1, 24 * 7) ?? 24;
  const { rows } = await query(
    `SELECT * FROM tv_epg
      WHERE channel_id = $1
        AND ends_at > now()
        AND starts_at < now() + ($2 || ' hours')::interval
      ORDER BY starts_at LIMIT 500`,
    [String(channelId ?? ''), String(span)]);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description || undefined,
    category: r.category || undefined,
    ageRating: r.age_rating || undefined,
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    live: r.starts_at <= new Date() && r.ends_at > new Date(),
  }));
};

/** Записать загруженное расписание. Повторная загрузка обновляет. */
export const saveEpg = async (channelId, items) => {
  if (!Array.isArray(items) || items.length === 0) return { saved: 0 };
  let saved = 0;
  for (const it of items.slice(0, 2000)) {
    const starts = new Date(it.startsAt);
    const ends = new Date(it.endsAt);
    const title = text(it.title, MAX_NAME);
    if (!title || Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) continue;
    if (ends <= starts) continue;
    await query(
      `INSERT INTO tv_epg (id, channel_id, starts_at, ends_at, title, description, category, age_rating)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (channel_id, starts_at) DO UPDATE
         SET ends_at = EXCLUDED.ends_at, title = EXCLUDED.title,
             description = EXCLUDED.description, category = EXCLUDED.category,
             age_rating = EXCLUDED.age_rating, fetched_at = now()`,
      [newId('epg'), channelId, starts.toISOString(), ends.toISOString(), title,
        text(it.description, MAX_DESC) || null, text(it.category, MAX_SHORT), text(it.ageRating, 10)]);
    saved += 1;
  }
  // Прошедшее держим сутки: «что было полчаса назад» иногда нужно, а
  // архив за год — нет.
  await query("DELETE FROM tv_epg WHERE channel_id = $1 AND ends_at < now() - interval '1 day'",
    [channelId]);
  return { saved };
};

/* ─── Управление каналами: только владелец ─────────────────────────── */

/**
 * Завести или обновить канал.
 *
 * Право здесь — владельца, а не администратора. Администраторов
 * назначают, и их может быть много; подключение вещателя — решение
 * хозяина сервиса, потому что отвечать за законность показа ему.
 */
export const upsertChannel = async (actorId, p) => {
  if (!(await isOwner(actorId))) return { error: 'not_allowed' };
  const slug = text(p.slug, 60).toLowerCase().replace(/[^a-z0-9а-яё_-]/gi, '');
  const name = text(p.name, MAX_NAME);
  if (!slug || !name) return { error: 'invalid_channel' };
  const category = CATEGORIES.includes(text(p.category, MAX_SHORT)) ? text(p.category, MAX_SHORT) : 'Разное';

  const { rows } = await query(
    `INSERT INTO tv_channels (id, slug, name, description, category, country, region,
                              accent, mark, age_rating, position, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name, description = EXCLUDED.description,
           category = EXCLUDED.category, country = EXCLUDED.country,
           region = EXCLUDED.region, accent = EXCLUDED.accent, mark = EXCLUDED.mark,
           age_rating = EXCLUDED.age_rating, position = EXCLUDED.position,
           enabled = EXCLUDED.enabled, updated_at = now()
     RETURNING id`,
    [newId('ch'), slug, name, text(p.description, MAX_DESC) || null, category,
      text(p.country, 8) || 'RU', text(p.region, MAX_SHORT),
      /^#[0-9a-f]{6}$/i.test(String(p.accent ?? '')) ? String(p.accent) : '#4f6ef7',
      text(p.mark, 4), text(p.ageRating, 10),
      num(p.position, 0, 100000) ?? 1000,
      p.enabled !== false]);
  return { ok: true, id: rows[0].id };
};

/**
 * Логотип канала. Небольшая картинка, её кладёт владелец.
 * Тип определяется по первым байтам, а не по словам присылающего.
 */
export const setLogo = async (actorId, slug, buf) => {
  if (!(await isOwner(actorId))) return { error: 'not_allowed' };
  if (!buf || buf.length < 16 || buf.length > 256 * 1024) return { error: 'bad_logo' };
  const mime = buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG' ? 'image/png'
    : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg'
      : buf.subarray(0, 4).toString('latin1') === 'RIFF'
        && buf.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp'
        : buf.subarray(0, 5).toString('latin1').toLowerCase() === '<?xml'
          || buf.subarray(0, 4).toString('latin1').toLowerCase() === '<svg' ? null : null;
  if (!mime) return { error: 'unsupported_type' };
  const { rowCount } = await query(
    'UPDATE tv_channels SET logo_data = $2, logo_mime = $3, has_logo = TRUE, updated_at = now() WHERE slug = $1',
    [text(slug, 60).toLowerCase(), buf, mime]);
  return rowCount ? { ok: true } : { error: 'channel_not_found' };
};

/** Логотип для выдачи. Открытые сведения: показывается всем вошедшим. */
export const readLogo = async (channelId) => {
  const { rows } = await query(
    'SELECT logo_data, logo_mime FROM tv_channels WHERE id = $1 AND enabled AND has_logo',
    [String(channelId ?? '')]);
  return rows[0]?.logo_data ? { data: rows[0].logo_data, mime: rows[0].logo_mime || 'image/png' } : null;
};

export const deleteChannel = async (actorId, slug) => {
  if (!(await isOwner(actorId))) return { error: 'not_allowed' };
  const { rowCount } = await query('DELETE FROM tv_channels WHERE slug = $1', [text(slug, 60).toLowerCase()]);
  return rowCount ? { ok: true } : { error: 'not_found' };
};

/**
 * Подключить источник к каналу.
 *
 * Адрес проверяется здесь же, до записи: узел обязан быть в белом
 * списке владельца, имя обязано разрешаться в обычные адреса. Источник
 * с неразрешённым узлом не записывается вовсе — иначе он лежал бы в
 * базе и ждал, пока кто-нибудь добавит узел в список по невнимательности.
 *
 * Основание показа обязательно. Источник, про который нельзя сказать,
 * на каком основании мы его показываем, подключать нечего.
 */
export const attachSource = async (actorId, { slug, url, kind, headers, delivery, licence, priority }) => {
  if (!(await isOwner(actorId))) return { error: 'not_allowed' };

  const { rows: ch } = await query('SELECT id FROM tv_channels WHERE slug = $1',
    [text(slug, 60).toLowerCase()]);
  if (!ch[0]) return { error: 'channel_not_found' };

  const why = text(licence, MAX_LICENCE);
  if (why.length < 3) return { error: 'licence_required' };

  try {
    await checkUrl(url);
  } catch (err) {
    if (err instanceof SourceRejected) {
      return { error: 'source_rejected', reason: err.reason, detail: err.detail };
    }
    throw err;
  }

  const headerText = headers && typeof headers === 'object' ? JSON.stringify(headers) : null;
  const id = newId('src');
  await query(
    `INSERT INTO tv_sources (id, channel_id, kind, url_enc, headers_enc, delivery, licence, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, ch[0].id,
      kind === 'dash' ? 'dash' : 'hls',
      encryptSecret(String(url)),
      headerText ? encryptSecret(headerText) : null,
      delivery === 'proxy' ? 'proxy' : 'redirect',
      why,
      num(priority, 0, 10000) ?? 100]);
  return { ok: true, id };
};

export const detachSource = async (actorId, sourceId) => {
  if (!(await isOwner(actorId))) return { error: 'not_allowed' };
  const { rowCount } = await query('DELETE FROM tv_sources WHERE id = $1', [String(sourceId ?? '')]);
  return rowCount ? { ok: true } : { error: 'not_found' };
};

/**
 * Что видит владелец: каналы вместе с состоянием источников.
 *
 * Адрес источника не показывается и здесь. Владелец его и так знает —
 * он его заводил, — а вот в ответ, который может попасть в журнал
 * браузера или на чужой экран за плечом, ему незачем.
 */
export const adminOverview = async (actorId) => {
  if (!(await isOwner(actorId)) && !(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query(
    `SELECT c.slug, c.name, c.category, c.enabled,
            s.id AS source_id, s.kind, s.delivery, s.licence, s.active, s.priority,
            h.ok, h.status_code, h.detail, h.latency_ms, h.checked_at, h.failures
       FROM tv_channels c
       LEFT JOIN tv_sources s ON s.channel_id = c.id
       LEFT JOIN tv_source_health h ON h.source_id = s.id
      ORDER BY c.position, c.name, s.priority`);
  return {
    channels: rows.map((r) => ({
      slug: r.slug, name: r.name, category: r.category, enabled: r.enabled,
      source: r.source_id ? {
        id: r.source_id, kind: r.kind, delivery: r.delivery,
        licence: r.licence, active: r.active, priority: r.priority,
        health: r.checked_at ? {
          ok: r.ok, statusCode: r.status_code, detail: r.detail,
          latencyMs: r.latency_ms, checkedAt: r.checked_at.toISOString(), failures: r.failures,
        } : null,
      } : null,
    })),
  };
};

/* ─── Проверка здоровья ────────────────────────────────────────────── */

/**
 * Обойти все включённые источники и записать, живы ли они.
 *
 * Нужно не для красоты: неотвечающий источник должен превратиться в
 * честное «канал временно недоступен» на карточке, а не в чёрный
 * экран после нажатия. Подробности отказа остаются здесь, в базе, для
 * владельца — зрителю про них знать нечего.
 */
export const checkAllSources = async () => {
  const { rows } = await query(
    `SELECT s.id, s.kind, s.url_enc, s.headers_enc
       FROM tv_sources s JOIN tv_channels c ON c.id = s.channel_id
      WHERE s.active AND c.enabled`);
  let ok = 0; let bad = 0;
  for (const s of rows) {
    let r;
    try {
      r = await probeSource(decryptSecret(s.url_enc),
        s.headers_enc ? safeHeaders(decryptSecret(s.headers_enc)) : {}, s.kind);
    } catch {
      r = { ok: false, statusCode: null, detail: 'сбой проверки', latencyMs: null };
    }
    await query(
      `INSERT INTO tv_source_health (source_id, ok, status_code, detail, latency_ms, checked_at, failures)
       VALUES ($1,$2,$3,$4,$5, now(), $6)
       ON CONFLICT (source_id) DO UPDATE
         SET ok = EXCLUDED.ok, status_code = EXCLUDED.status_code,
             detail = EXCLUDED.detail, latency_ms = EXCLUDED.latency_ms,
             checked_at = now(),
             failures = CASE WHEN EXCLUDED.ok THEN 0 ELSE tv_source_health.failures + 1 END`,
      [s.id, r.ok, r.statusCode, r.detail?.slice(0, 300) ?? null, r.latencyMs, r.ok ? 0 : 1]);
    if (r.ok) ok += 1; else bad += 1;
  }
  return { ok, bad };
};

export { safeHeaders };
