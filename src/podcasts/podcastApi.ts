/**
 * Sky Podcasts: разговор с сервером.
 *
 * Здесь только вызовы. Кому что можно — решает сервер, и ни одна
 * проверка отсюда не заменяет его проверку: этот файл живёт в браузере,
 * а браузер переписывается.
 */
import { apiCall, getAccessToken, uploadUrl, nativeXhrHeaders } from '@/core/auth/api';
import { NATIVE_APP, MEDIA_BY_URL } from '@/core/nativeApp';

export interface Host { name: string; role?: string }

export interface Podcast {
  id: string;
  title: string;
  description?: string;
  category: string;
  language: string;
  accent: string;
  hasCover: boolean;
  status: 'private' | 'pending' | 'published' | 'rejected';
  private: boolean;
  explicit?: boolean;
  episodes: number;
  subscribers: number;
  hosts?: Host[];
  own?: boolean;
  subscribed?: boolean;
  favorite?: boolean;
  createdAt?: string;
  /** Причину отказа сервер отдаёт только автору. */
  rejectReason?: string;
}

export interface Episode {
  id: string;
  podcastId: string;
  podcastTitle?: string;
  number?: number;
  title: string;
  description?: string;
  /** Длительность в секундах. */
  duration: number;
  hasAudio: boolean;
  hasVideo: boolean;
  videoWidth?: number;
  videoHeight?: number;
  hasCover: boolean;
  hasTranscript: boolean;
  hasSummary?: boolean;
  explicit?: boolean;
  published: boolean;
  plays: number;
  accent?: string;
  own?: boolean;
  favorite?: boolean;
  /** На чём человек остановился — с сервера, а не из этого браузера. */
  position?: number;
  completed?: boolean;
  createdAt?: string;
}

export interface Cue { idx: number; start: number; end: number; text: string; speaker?: string }
export interface Chapter { start: number; title: string }

export interface Summary {
  short: string;
  main: string[];
  topics: { title: string; text: string }[];
  timecodes: { time: number; title: string }[];
  audience: string;
  takeaways: string[];
  /** Расшифровка не поместилась целиком — пересказ по её началу. */
  partial?: boolean;
  coveredCues?: number;
  totalCues?: number;
  model?: string;
  createdAt?: string;
}

export interface SummaryState {
  summary: Summary | null;
  cached?: boolean;
  canBuild?: boolean;
  reason?: 'no_transcript' | 'ai_not_configured' | null;
}

/* ─── Адреса файлов ────────────────────────────────────────────────── */

/**
 * Файл сам по себе закрыт: сервер проверит право на каждый кусок.
 *
 * В родном приложении страница и API — разные origin: относительный
 * путь резолвился бы не туда (uploadUrl делает его абсолютным), а
 * SameSite=Strict-кука с пропуском обратно кросс-доменно не долетит —
 * поэтому пропуск там же едет в адресе (?t=), см. apiMediaTicket.
 */
let mediaTicket: string | null = null;

const withMediaTicket = (path: string) => {
  const url = uploadUrl(path);
  if (!MEDIA_BY_URL || !mediaTicket) return url;
  return `${url}?t=${encodeURIComponent(mediaTicket)}`;
};

export const audioUrl = (id: string) => withMediaTicket(`/api/podcasts/episode/${encodeURIComponent(id)}/audio`);
export const videoUrl = (id: string) => withMediaTicket(`/api/podcasts/episode/${encodeURIComponent(id)}/video`);
export const epCoverUrl = (id: string) => withMediaTicket(`/api/podcasts/episode/${encodeURIComponent(id)}/cover`);
export const showCoverUrl = (id: string) => withMediaTicket(`/api/podcasts/show/${encodeURIComponent(id)}/cover`);

/**
 * Пропуск для медиа. Теги <audio>, <video> и <img> не умеют слать
 * заголовок авторизации, поэтому сервер кладёт короткую куку,
 * ограниченную путём /api/podcasts. Просим её при открытии подкастов.
 */
export const apiMediaTicket = async () => {
  const r = await apiCall<{ ticket?: string }>('/api/podcasts/ticket', { method: 'POST', body: '{}' });
  if (r.ok && r.data?.ticket) mediaTicket = r.data.ticket;
  return r.ok;
};

/* ─── Каталог ──────────────────────────────────────────────────────── */

export const apiCatalog = async (opts: {
  q?: string; category?: string; limit?: number; offset?: number;
  sort?: 'new' | 'popular' | 'episodes';
} = {}) => {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.category && opts.category !== 'Все') p.set('category', opts.category);
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.offset) p.set('offset', String(opts.offset));
  if (opts.sort) p.set('sort', opts.sort);
  const qs = p.toString();
  const r = await apiCall<{ podcasts: Podcast[] }>(`/api/podcasts/catalog${qs ? `?${qs}` : ''}`);
  return r.ok ? (r.data?.podcasts ?? []) : null;
};

export const apiCategories = async () => {
  const r = await apiCall<{ categories: { name: string; count: number }[] }>('/api/podcasts/categories');
  return r.ok ? (r.data?.categories ?? []) : [];
};

export const apiSearch = async (q: string, limit = 20) => {
  const r = await apiCall<{ podcasts: Podcast[]; episodes: Episode[] }>(
    `/api/podcasts/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  return r.ok ? { podcasts: r.data?.podcasts ?? [], episodes: r.data?.episodes ?? [] }
    : { podcasts: [], episodes: [] };
};

export const apiMine = async () => {
  const r = await apiCall<{ podcasts: Podcast[] }>('/api/podcasts/mine');
  return r.ok ? (r.data?.podcasts ?? []) : [];
};

export const apiPodcast = async (id: string) => {
  const r = await apiCall<{ podcast: Podcast }>(`/api/podcasts/show/${encodeURIComponent(id)}`);
  return r.ok ? (r.data?.podcast ?? null) : null;
};

export const apiEpisodes = async (podcastId: string, opts: { q?: string; limit?: number; offset?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.offset) p.set('offset', String(opts.offset));
  const qs = p.toString();
  const r = await apiCall<{ episodes: Episode[] }>(
    `/api/podcasts/show/${encodeURIComponent(podcastId)}/episodes${qs ? `?${qs}` : ''}`);
  return r.ok ? (r.data?.episodes ?? []) : null;
};

export const apiEpisode = async (id: string) => {
  const r = await apiCall<{ episode: Episode }>(`/api/podcasts/episode/${encodeURIComponent(id)}`);
  return r.ok ? (r.data?.episode ?? null) : null;
};

export const apiSimilar = async (id: string, limit = 6) => {
  const r = await apiCall<{ episodes: Episode[] }>(
    `/api/podcasts/episode/${encodeURIComponent(id)}/similar?limit=${limit}`);
  return r.ok ? (r.data?.episodes ?? []) : [];
};

/* ─── Своё ─────────────────────────────────────────────────────────── */

export const apiSubscriptions = async () => {
  const r = await apiCall<{ podcasts: Podcast[] }>('/api/podcasts/subscriptions');
  return r.ok ? (r.data?.podcasts ?? []) : [];
};

export const apiSetSubscribed = async (podcastId: string, on: boolean) => {
  const r = await apiCall<{ podcasts: Podcast[] }>('/api/podcasts/subscriptions',
    { method: 'POST', body: JSON.stringify({ podcastId, on }) });
  return r.ok ? (r.data?.podcasts ?? []) : null;
};

export const apiFavorites = async () => {
  const r = await apiCall<{ podcasts: Podcast[]; episodes: Episode[] }>('/api/podcasts/favorites');
  return r.ok ? { podcasts: r.data?.podcasts ?? [], episodes: r.data?.episodes ?? [] }
    : { podcasts: [], episodes: [] };
};

export const apiSetFavorite = async (what: { podcastId?: string; episodeId?: string }, on: boolean) => {
  const r = await apiCall<{ podcasts: Podcast[]; episodes: Episode[] }>('/api/podcasts/favorites',
    { method: 'POST', body: JSON.stringify({ ...what, on }) });
  return r.ok ? { podcasts: r.data?.podcasts ?? [], episodes: r.data?.episodes ?? [] } : null;
};

export const apiContinue = async (limit = 12) => {
  const r = await apiCall<{ episodes: Episode[] }>(`/api/podcasts/continue?limit=${limit}`);
  return r.ok ? (r.data?.episodes ?? []) : [];
};

export const apiNewFromSubscriptions = async (limit = 20) => {
  const r = await apiCall<{ episodes: Episode[] }>(`/api/podcasts/new?limit=${limit}`);
  return r.ok ? (r.data?.episodes ?? []) : [];
};

export const apiHistory = async (limit = 30) => {
  const r = await apiCall<{ episodes: Episode[] }>(`/api/podcasts/history?limit=${limit}`);
  return r.ok ? (r.data?.episodes ?? []) : [];
};

export const apiProgress = async () => {
  const r = await apiCall<{ progress: { episodeId: string; position: number; duration: number; completed: boolean }[] }>(
    '/api/podcasts/progress');
  return r.ok ? (r.data?.progress ?? []) : [];
};

/**
 * Позиция уходит на сервер, а не в этот браузер: с телефона и с
 * компьютера человек продолжает с одного и того же места.
 *
 * keepalive — чтобы последняя отправка при закрытии вкладки успела
 * уйти: без него браузер обрывает запрос вместе со страницей, и
 * последние секунды прослушивания теряются.
 */
export const apiSetProgress = async (
  episodeId: string, position: number, duration: number, completed?: boolean,
) => {
  const r = await apiCall('/api/podcasts/progress', {
    method: 'POST',
    body: JSON.stringify({ episodeId, position: Math.round(position), duration: Math.round(duration), completed }),
    keepalive: true,
  });
  return r.ok;
};

export const apiPlayed = async (episodeId: string) => {
  const r = await apiCall(`/api/podcasts/episode/${encodeURIComponent(episodeId)}/play`,
    { method: 'POST', body: '{}' });
  return r.ok;
};

/* ─── Расшифровка, главы, пересказ ─────────────────────────────────── */

export const apiTranscript = async (episodeId: string) => {
  const r = await apiCall<{ cues: Cue[] }>(`/api/podcasts/episode/${encodeURIComponent(episodeId)}/transcript`);
  return r.ok ? (r.data?.cues ?? []) : null;
};

export const apiSaveTranscript = async (episodeId: string, cues: Omit<Cue, 'idx'>[]) => {
  const r = await apiCall<{ saved: number }>(
    `/api/podcasts/episode/${encodeURIComponent(episodeId)}/transcript`,
    { method: 'PUT', body: JSON.stringify({ cues }) });
  return r.ok ? (r.data?.saved ?? 0) : null;
};

export const apiChapters = async (episodeId: string) => {
  const r = await apiCall<{ chapters: Chapter[] }>(`/api/podcasts/episode/${encodeURIComponent(episodeId)}/chapters`);
  return r.ok ? (r.data?.chapters ?? []) : [];
};

export const apiSaveChapters = async (episodeId: string, chapters: Chapter[]) => {
  const r = await apiCall(`/api/podcasts/episode/${encodeURIComponent(episodeId)}/chapters`,
    { method: 'PUT', body: JSON.stringify({ chapters }) });
  return r.ok;
};

export const apiSummary = async (episodeId: string) => {
  const r = await apiCall<SummaryState>(`/api/podcasts/episode/${encodeURIComponent(episodeId)}/summary`);
  return r.ok ? (r.data ?? null) : null;
};

/**
 * Просьба сделать пересказ. Ни модели, ни ключа, ни адреса отсюда не
 * уходит: всё это дело сервера, и присланное он не примет.
 */
export const apiBuildSummary = async (episodeId: string): Promise<
{ ok: true; summary: Summary } | { ok: false; reason: string }> => {
  const r = await apiCall<{ summary: Summary }>(
    `/api/podcasts/episode/${encodeURIComponent(episodeId)}/summary`, { method: 'POST', body: '{}' });
  if (r.ok && r.data?.summary) return { ok: true, summary: r.data.summary };
  return { ok: false, reason: SUMMARY_REASONS[r.error ?? ''] ?? 'Пересказ не получился' };
};

const SUMMARY_REASONS: Record<string, string> = {
  no_transcript: 'Пересказ делается по расшифровке, а её у выпуска ещё нет',
  ai_not_configured: 'Пересказ на этом сервере не настроен',
  ai_busy: 'Сейчас занято — попробуйте через минуту',
  ai_failed: 'Не удалось составить пересказ. Выдумывать мы не станем',
  rate_limited: 'Слишком часто. Попробуйте позже',
};

/* ─── Своё хозяйство ───────────────────────────────────────────────── */

export const apiCreatePodcast = async (meta: {
  title: string; description?: string; category?: string; accent?: string; explicit?: boolean;
}) => {
  const r = await apiCall<{ podcast: Podcast }>('/api/podcasts/show',
    { method: 'POST', body: JSON.stringify(meta) });
  return r.ok ? (r.data?.podcast ?? null) : null;
};

export const apiPatchPodcast = async (id: string, patch: {
  title?: string; description?: string; category?: string; accent?: string;
  explicit?: boolean; status?: 'private';
}) => {
  const r = await apiCall<{ podcast: Podcast }>(`/api/podcasts/show/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) });
  return r.ok ? (r.data?.podcast ?? null) : null;
};

export const apiDeletePodcast = async (id: string) => {
  const r = await apiCall(`/api/podcasts/show/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return r.ok;
};

export const apiSetHosts = async (id: string, hosts: Host[]) => {
  const r = await apiCall<{ podcast: Podcast }>(`/api/podcasts/show/${encodeURIComponent(id)}/hosts`,
    { method: 'POST', body: JSON.stringify({ hosts }) });
  return r.ok ? (r.data?.podcast ?? null) : null;
};

export const apiSubmitPodcast = async (id: string): Promise<
{ ok: true; podcast: Podcast | null } | { ok: false; reason: string }> => {
  const r = await apiCall<{ podcast: Podcast }>(`/api/podcasts/show/${encodeURIComponent(id)}/submit`,
    { method: 'POST', body: '{}' });
  if (r.ok) return { ok: true, podcast: r.data?.podcast ?? null };
  return { ok: false, reason: SUBMIT_REASONS[r.error ?? ''] ?? r.reason ?? 'Не получилось' };
};

const SUBMIT_REASONS: Record<string, string> = {
  no_episodes: 'Нужен хотя бы один выпуск с файлом: пустую передачу показывать нечем',
  already_pending: 'Передача уже ждёт проверки',
  already_published: 'Передача уже опубликована',
};

export const apiCreateEpisode = async (podcastId: string, meta: {
  title: string; description?: string; number?: number; duration?: number; explicit?: boolean;
}) => {
  const r = await apiCall<{ episode: Episode }>(
    `/api/podcasts/show/${encodeURIComponent(podcastId)}/episode`,
    { method: 'POST', body: JSON.stringify(meta) });
  return r.ok ? (r.data?.episode ?? null) : null;
};

export const apiPatchEpisode = async (id: string, patch: {
  title?: string; description?: string; number?: number; duration?: number;
  explicit?: boolean; published?: boolean;
}) => {
  const r = await apiCall<{ episode: Episode }>(`/api/podcasts/episode/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) });
  return r.ok ? (r.data?.episode ?? null) : null;
};

export const apiDeleteEpisode = async (id: string) => {
  const r = await apiCall(`/api/podcasts/episode/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return r.ok;
};

export const apiModerationQueue = async () => {
  const r = await apiCall<{ podcasts: Podcast[] }>('/api/podcasts/moderation');
  return r.ok ? (r.data?.podcasts ?? []) : null;
};

export const apiModerate = async (id: string, approve: boolean, reason?: string) => {
  const r = await apiCall<{ status: string }>(`/api/podcasts/show/${encodeURIComponent(id)}/moderate`,
    { method: 'POST', body: JSON.stringify({ approve, reason }) });
  return r.ok;
};

/* ─── Загрузка файлов ──────────────────────────────────────────────── */

const UPLOAD_REASONS: Record<string, string> = {
  unsupported_type: 'Такой файл не подходит',
  file_too_large: 'Файл слишком большой',
  upload_interrupted: 'Загрузка оборвалась — попробуйте ещё раз',
  empty_file: 'Файл пустой',
  storage_unavailable: 'На сервере нет места — сообщите владельцу',
  rate_limited: 'Слишком часто. Попробуйте позже',
};

/**
 * Файл уходит телом запроса, сведения — строкой адреса. Тип сервер
 * определит сам, по первым байтам: тому, что напишет браузер, он не
 * верит.
 *
 * XMLHttpRequest, а не fetch, ровно из-за одного: он показывает ход
 * отправки. Выпуск с видео идёт минутами, и полоса без движения
 * выглядит зависанием.
 */
export const apiUploadMedia = (
  episodeId: string,
  kind: 'audio' | 'video',
  file: Blob,
  meta: { width?: number; height?: number } = {},
  onProgress?: (percent: number) => void,
): { promise: Promise<{ ok: boolean; episode?: Episode; reason?: string }>; cancel: () => void } => {
  const p = new URLSearchParams();
  if (meta.width) p.set('width', String(Math.round(meta.width)));
  if (meta.height) p.set('height', String(Math.round(meta.height)));
  const qs = p.toString();

  const xhr = new XMLHttpRequest();
  const promise = new Promise<{ ok: boolean; episode?: Episode; reason?: string }>((resolve) => {
    xhr.open('POST', uploadUrl(`/api/podcasts/episode/${encodeURIComponent(episodeId)}/${kind}${qs ? `?${qs}` : ''}`));
    xhr.withCredentials = !NATIVE_APP;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    Object.entries(nativeXhrHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      // Сотню оставляем ответу сервера: пока он не ответил, выпуск ещё
      // не сохранён, и показывать «готово» рано.
      onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let data: { episode?: Episode; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* тела может не быть */ }
      if (xhr.status === 201) { onProgress?.(100); resolve({ ok: true, episode: data.episode }); return; }
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

export const apiUploadCover = async (what: { podcastId?: string; episodeId?: string }, file: Blob) => {
  const path = what.podcastId
    ? `/api/podcasts/show/${encodeURIComponent(what.podcastId)}/cover`
    : `/api/podcasts/episode/${encodeURIComponent(what.episodeId ?? '')}/cover`;
  const r = await apiCall(path, {
    method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' },
  });
  return r.ok;
};

/* ─── Мелочи ───────────────────────────────────────────────────────── */

export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
};

/** «42 мин» — для карточек, где точность до секунды не нужна. */
export const fmtDuration = (sec: number) => {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин`;
};
