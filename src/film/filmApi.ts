/**
 * Sky Film: разговор с сервером.
 *
 * Всё, что раньше лежало в localStorage браузера и во временных
 * ссылках blob:, теперь спрашивается у сервера. Здесь только вызовы;
 * кому какой фильм доступен — решает он, а не мы.
 *
 * Отдельно стоит сказать про личную коллекцию: закрытость фильма здесь
 * не обеспечивается ничем. Ни одна проверка на этой стороне не была бы
 * защитой — браузер можно переписать, а запрос отправить напрямую.
 * Личное закрыто в базе и в запросах сервера; этот файл просто не
 * получит чужого, сколько бы ни просил.
 */
import { withTicketRefresh } from '@/core/mediaTicketRefresh';
import { apiCall, getAccessToken, uploadUrl, nativeXhrHeaders } from '@/core/auth/api';
import { NATIVE_APP, MEDIA_BY_URL } from '@/core/nativeApp';

/** Состояния фильма. Всё, кроме 'published', видит только владелец. */
export type FilmStatus = 'private' | 'pending' | 'published' | 'rejected';

/** Фильм в том виде, в каком его отдаёт сервер. */
export interface ServerMovie {
  /** Только для своего личного фильма: защита от автоматической уборки и дата уборки. */
  retentionKeep?: boolean;
  expiresAt?: string;
  id: string;
  title: string;
  description?: string;
  category: string;
  genre?: string;
  year?: number;
  country?: string;
  director?: string;
  ageRating?: string;
  /** Длительность в секундах. */
  duration: number;
  bytes: number;
  hasPoster: boolean;
  status: FilmStatus;
  /** Лежит ли фильм в личной коллекции. Сервер считает это сам. */
  private: boolean;
  license?: 'open' | 'personal';
  explicit?: boolean;
  ageRestricted18?: boolean;
  isShort?: boolean;
  /** Размер кадра. Нужен, чтобы отличить вертикальное видео от обычного. */
  width?: number;
  height?: number;
  views: number;
  /** Средняя оценка живых зрителей; её нет, пока никто не оценил. */
  rating?: number;
  ratingCount?: number;
  myRating?: number;
  saved?: boolean;
  own?: boolean;
  uploaderName?: string;
  addedAt?: string;
  submittedAt?: string;
  /** Причину отказа сервер отдаёт только владельцу. */
  rejectReason?: string;
  /** На чём остановился этот зритель, в секундах. */
  position?: number;
  /** В очереди проверки — чей это фильм. */
  ownerName?: string;
  /** Серия сериала: к какому сериалу и сезону относится, номер, секунды заставки. */
  seriesId?: string;
  seasonId?: string;
  epNo?: number;
  introStart?: number;
  introEnd?: number;
  subtitles?: number;
  watchedAt?: string;
  progressDuration?: number;
}

export interface MovieProgress { movieId: string; position: number; duration: number }

/**
 * Адреса видео и постера. Сами по себе они ничего не открывают: сервер
 * проверяет право на каждый кусок каждого файла.
 *
 * В родном приложении страница и API — разные origin: относительный
 * путь резолвился бы не туда (uploadUrl делает его абсолютным), а
 * SameSite=Strict-кука с пропуском обратно кросс-доменно не долетит —
 * поэтому пропуск там же едет в адресе (?t=), см. apiFilmTicket.
 */
let mediaTicket: string | null = null;

const withMediaTicket = (path: string) => {
  const url = uploadUrl(path);
  if (!MEDIA_BY_URL || !mediaTicket) return url;
  return `${url}?t=${encodeURIComponent(mediaTicket)}`;
};

export const videoUrl = (id: string) => withMediaTicket(`/api/film/movie/${encodeURIComponent(id)}/video`);
export const posterUrl = (id: string) => withMediaTicket(`/api/film/movie/${encodeURIComponent(id)}/poster`);

/** Секунды → «ч:мм:сс» или «м:сс». */
export const fmtDuration = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
};

/**
 * Пропуск для видео. Тег <video> не умеет слать заголовок авторизации,
 * поэтому сервер кладёт короткую куку, ограниченную путём /api/film.
 * Просим её один раз при открытии кино.
 */
export const apiFilmTicket = withTicketRefresh(async () => {
  const r = await apiCall<{ ticket?: string }>('/api/film/ticket', { method: 'POST', body: '{}' });
  if (r.ok && r.data?.ticket) mediaTicket = r.data.ticket;
  return r.ok;
});

/* ─── Каталог ──────────────────────────────────────────────────────── */

export interface CatalogOpts {
  q?: string;
  category?: string;
  sort?: 'new' | 'popular' | 'rating';
  limit?: number;
  offset?: number;
}

/** Общий каталог: только опубликованное. Личного здесь нет ни у кого. */
export const apiCatalog = async (opts: CatalogOpts = {}) => {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.category && opts.category !== 'Все') p.set('category', opts.category);
  if (opts.sort) p.set('sort', opts.sort);
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.offset) p.set('offset', String(opts.offset));
  const qs = p.toString();
  const r = await apiCall<{ movies: ServerMovie[] }>(`/api/film/catalog${qs ? `?${qs}` : ''}`);
  return r.ok ? (r.data?.movies ?? []) : null;
};

/**
 * Лента короткого кино. Листается по времени, а не по номеру страницы:
 * пока человек листает, кто-то мог выложить новое, и при счёте по
 * номерам одно видео он увидел бы дважды, а другое пропустил.
 */
export const apiShorts = async (opts: { limit?: number; before?: string } = {}) => {
  const p = new URLSearchParams();
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.before) p.set('before', opts.before);
  const qs = p.toString();
  const r = await apiCall<{ movies: ServerMovie[] }>(`/api/film/shorts${qs ? `?${qs}` : ''}`);
  return r.ok ? (r.data?.movies ?? []) : null;
};

export const apiCategories = async () => {
  const r = await apiCall<{ categories: { name: string; count: number }[] }>('/api/film/categories');
  return r.ok ? (r.data?.categories ?? []) : null;
};

/**
 * Личная коллекция. Чей она — сервер знает из сессии, поэтому попросить
 * чужую нельзя: такого запроса просто нет.
 */
export const apiMyFilms = async (q?: string) => {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  const r = await apiCall<{ movies: ServerMovie[] }>(`/api/film/mine${qs}`);
  return r.ok ? (r.data?.movies ?? []) : null;
};

export const apiMovie = async (id: string) => {
  const r = await apiCall<{ movie: ServerMovie }>(`/api/film/movie/${encodeURIComponent(id)}`);
  return r.ok ? (r.data?.movie ?? null) : null;
};

export const apiPatchMovie = async (id: string, patch: {
  title?: string; description?: string; category?: string; genre?: string;
  year?: number; country?: string; director?: string; ageRating?: string;
  isShort?: boolean;
  status?: 'private';
}) => {
  const r = await apiCall<{ movie: ServerMovie }>(`/api/film/movie/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) });
  return r.ok ? (r.data?.movie ?? null) : null;
};

export const apiDeleteMovie = async (id: string) => {
  const r = await apiCall(`/api/film/movie/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return r.ok;
};

/* ─── Закладки, оценка, просмотры ──────────────────────────────────── */

export const apiSavedFilms = async () => {
  const r = await apiCall<{ movies: ServerMovie[] }>('/api/film/saved');
  return r.ok ? (r.data?.movies ?? []) : null;
};

export const apiSetSaved = async (movieId: string, on: boolean) => {
  const r = await apiCall<{ movies: ServerMovie[] }>('/api/film/saved',
    { method: 'POST', body: JSON.stringify({ movieId, on }) });
  return r.ok ? (r.data?.movies ?? []) : null;
};

export const apiRateMovie = async (movieId: string, score: number) => {
  const r = await apiCall<{ movie: ServerMovie }>(
    `/api/film/movie/${encodeURIComponent(movieId)}/rate`,
    { method: 'POST', body: JSON.stringify({ score }) });
  return r.ok ? (r.data?.movie ?? null) : null;
};

/** Отметка просмотра. Счётчик общий, поэтому его ведёт сервер. */
export const apiCountView = async (movieId: string) => {
  const r = await apiCall(`/api/film/movie/${encodeURIComponent(movieId)}/view`,
    { method: 'POST', body: '{}' });
  return r.ok;
};

/* ─── Продолжить просмотр ──────────────────────────────────────────── */

/**
 * Позиция просмотра лежит на сервере, а не в браузере. Поэтому начатое
 * на телефоне продолжается на телевизоре с того же места — это и есть
 * синхронизация устройств, отдельного механизма для неё не нужно.
 */
export const apiSetProgress = async (movieId: string, position: number, duration: number) => {
  const r = await apiCall('/api/film/progress', {
    method: 'POST',
    body: JSON.stringify({ movieId, position: Math.floor(position), duration: Math.floor(duration) }),
  });
  return r.ok;
};

export const apiProgress = async () => {
  const r = await apiCall<{ progress: MovieProgress[] }>('/api/film/progress');
  return r.ok ? (r.data?.progress ?? []) : null;
};

export const apiContinue = async () => {
  const r = await apiCall<{ movies: ServerMovie[] }>('/api/film/continue');
  return r.ok ? (r.data?.movies ?? []) : null;
};

/* ─── Публикация и проверка ────────────────────────────────────────── */

/** Включить/снять «хранить без срока» для личного фильма. */
export const apiMovieKeep = async (id: string, keep: boolean) => {
  const r = await apiCall(`/api/film/movie/${encodeURIComponent(id)}/retention-keep`,
    { method: 'POST', body: JSON.stringify({ keep }) });
  return r.ok;
};

/** Владелец просит проверку. Сам себя опубликовать он не может. */
export const apiSubmitMovie = async (id: string, p: {
  license: 'open' | 'personal'; explicit?: boolean; ageRestricted18?: boolean;
}) => {
  const r = await apiCall<{ movie: ServerMovie }>(
    `/api/film/movie/${encodeURIComponent(id)}/submit`,
    { method: 'POST', body: JSON.stringify(p) });
  if (r.ok) return { ok: true as const, movie: r.data?.movie ?? null };
  return { ok: false as const, reason: SUBMIT_REASONS[r.error ?? ''] ?? r.reason };
};

const SUBMIT_REASONS: Record<string, string> = {
  already_pending: 'Этот фильм уже ждёт проверки',
  already_published: 'Этот фильм уже в общем каталоге',
  no_file: 'У фильма нет файла — загрузите видео заново',
  not_allowed: 'Это не ваш фильм',
  rate_limited: 'Слишком часто. Попробуйте чуть позже',
};

/** Очередь проверки. Отдаётся только администратору. */
export const apiFilmModerationQueue = async () => {
  const r = await apiCall<{ movies: ServerMovie[] }>('/api/film/moderation');
  return r.ok ? (r.data?.movies ?? []) : null;
};

export const apiModerateMovie = async (id: string, approve: boolean, reason?: string) => {
  const r = await apiCall(`/api/film/movie/${encodeURIComponent(id)}/moderate`,
    { method: 'POST', body: JSON.stringify({ approve, reason }) });
  return r.ok;
};

/* ─── Загрузка ─────────────────────────────────────────────────────── */

export interface UploadMeta {
  title: string;
  description?: string;
  category?: string;
  genre?: string;
  year?: number;
  country?: string;
  director?: string;
  ageRating?: string;
  duration?: number;
  width?: number;
  height?: number;
  isShort?: boolean;
  /** Загрузка серии: сезон, номер (по умолчанию следующий) и заставка в секундах. */
  seasonId?: string;
  epNo?: number;
  introStart?: number;
  introEnd?: number;
}

const UPLOAD_REASONS: Record<string, string> = {
  episode_exists: 'Серия с таким номером уже есть в этом сезоне',
  bad_season: 'Сезон не найден',
  unsupported_type: 'Такой файл не подходит: нужен MP4, MOV, MKV, WebM или AVI',
  file_too_large: 'Фильм слишком большой',
  invalid_meta: 'Заполните название',
  too_many: 'В личной коллекции уже слишком много фильмов',
  empty_file: 'Файл пустой',
  upload_interrupted: 'Загрузка оборвалась — попробуйте ещё раз',
  prime_required: 'Sky Film доступен по подписке Sky Prime',
  rate_limited: 'Слишком часто. Попробуйте чуть позже',
};

/**
 * Загрузка фильма.
 *
 * Здесь XMLHttpRequest, а не fetch, и по одной причине: fetch не умеет
 * сообщать, сколько уже отправлено. Для песни это неважно, а фильм
 * уходит минутами, и полоса, которая просто стоит на месте, выглядит
 * как зависшая программа.
 *
 * Файл уходит телом запроса, сведения — строкой адреса. Тип сервер
 * определит сам, по первым байтам: тому, что напишет браузер, он не
 * верит. Куда положить фильм, здесь тоже не решается — сервер всегда
 * кладёт его в личную коллекцию закрытым.
 */
export const apiUploadMovie = (
  file: Blob,
  meta: UploadMeta,
  onProgress?: (percent: number) => void,
): { promise: Promise<{ ok: boolean; movie?: ServerMovie; reason?: string }>; cancel: () => void } => {
  const p = new URLSearchParams({ title: meta.title });
  if (meta.description) p.set('description', meta.description);
  if (meta.category) p.set('category', meta.category);
  if (meta.genre) p.set('genre', meta.genre);
  if (meta.year) p.set('year', String(meta.year));
  if (meta.country) p.set('country', meta.country);
  if (meta.director) p.set('director', meta.director);
  if (meta.ageRating) p.set('ageRating', meta.ageRating);
  if (meta.duration) p.set('duration', String(Math.round(meta.duration)));
  if (meta.width) p.set('width', String(Math.round(meta.width)));
  if (meta.height) p.set('height', String(Math.round(meta.height)));
  if (meta.isShort) p.set('isShort', 'true');
  if (meta.seasonId) p.set('seasonId', meta.seasonId);
  if (meta.epNo) p.set('epNo', String(meta.epNo));
  if (meta.introEnd && meta.introEnd > (meta.introStart ?? 0)) { p.set('introStart', String(meta.introStart ?? 0)); p.set('introEnd', String(meta.introEnd)); }

  const xhr = new XMLHttpRequest();
  const promise = new Promise<{ ok: boolean; movie?: ServerMovie; reason?: string }>((resolve) => {
    xhr.open('POST', uploadUrl(`/api/film/upload?${p}`));
    xhr.withCredentials = !NATIVE_APP;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    Object.entries(nativeXhrHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      // Сотню оставляем ответу сервера: пока он не ответил, фильм ещё
      // не сохранён, и показывать «готово» рано.
      onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };

    xhr.onload = () => {
      let data: { movie?: ServerMovie; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* тела может не быть */ }
      if (xhr.status === 201) { onProgress?.(100); resolve({ ok: true, movie: data.movie }); return; }
      // 413 приходит и без тела: так отвечает nginx, если файл больше
      // его потолка. Человеку нужно объяснение, а не голый код.
      if (xhr.status === 413) { resolve({ ok: false, reason: UPLOAD_REASONS.file_too_large }); return; }
      resolve({ ok: false, reason: UPLOAD_REASONS[data.error ?? ''] ?? `Не получилось (${xhr.status})` });
    };
    xhr.onerror = () => resolve({ ok: false, reason: 'Нет связи с сервером' });
    xhr.onabort = () => resolve({ ok: false, reason: 'Загрузка отменена' });
    xhr.send(file);
  });

  return { promise, cancel: () => xhr.abort() };
};

export const apiUploadPoster = async (movieId: string, file: Blob) => {
  const r = await apiCall(`/api/film/movie/${encodeURIComponent(movieId)}/poster`, {
    method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' },
  });
  return r.ok;
};

/** Сколько длится короткометражка. То же число стоит и на сервере. */
export const MAX_SHORT_DURATION = 300;

export interface VideoMeta { duration: number; width: number; height: number }

/**
 * Длительность и размер кадра узнаём в браузере: сервер для этого
 * пришлось бы разбирать контейнер, а здесь их знает сам проигрыватель.
 * Числа потом всё равно проверяются на стороне сервера, так что соврать
 * ими нельзя — можно только испортить себе же подпись под своим фильмом.
 */
export const readVideoMeta = (file: Blob) => new Promise<VideoMeta>((resolve) => {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.preload = 'metadata';
  // Не каждый браузер шлёт и loadedmetadata, и error на файл с непонятным
  // кодеком: без таймера загрузка вечно висела бы на «Читаем файл».
  let finished = false;
  const done = (m: VideoMeta) => { if (finished) return; finished = true; clearTimeout(timer); URL.revokeObjectURL(url); resolve(m); };
  const timer = setTimeout(() => done({ duration: 0, width: 0, height: 0 }), 10_000);
  v.onloadedmetadata = () => done({
    duration: Number.isFinite(v.duration) ? v.duration : 0,
    width: v.videoWidth || 0,
    height: v.videoHeight || 0,
  });
  v.onerror = () => done({ duration: 0, width: 0, height: 0 });
  v.src = url;
});

/**
 * Похоже ли это на короткометражку. Подсказка для галочки при
 * загрузке, не более: решает всё равно сервер, а человек может
 * передумать в обе стороны.
 */
export const looksLikeShort = (m: VideoMeta) =>
  m.duration > 0 && m.duration <= MAX_SHORT_DURATION
  && m.height > 0 && m.height >= m.width;
