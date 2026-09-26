/**
 * Sky Video / Studio: разговор с сервером.
 *
 * Тот же приём, что у Sky Film (film/filmApi.ts): всё, что раньше жило в
 * localStorage и blob-ссылках, теперь лежит на сервере и спрашивается у
 * него. Закрытость черновика здесь не обеспечивается ничем на этой
 * стороне — сервер откажет в чужом ролике сам, сколько бы браузер ни
 * попросил.
 */
import { apiCall, getAccessToken, uploadUrl, nativeXhrHeaders } from '@/core/auth/api';
import { NATIVE_APP } from '@/core/nativeApp';

export type VideoStatus = 'draft' | 'published' | 'hidden' | 'removed';
export type VideoPrivacy = 'public' | 'unlisted' | 'private';
export type MonetizationStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'suspended';

export interface ServerVideo {
  id: string;
  title: string;
  description?: string;
  category: string;
  tags: string[];
  duration: number;
  bytes: number;
  width?: number;
  height?: number;
  hasThumbnail: boolean;
  privacy: VideoPrivacy;
  status: VideoStatus;
  own?: boolean;
  views: number;
  likes: number;
  liked?: boolean;
  commentCount?: number;
  monetizationStatus: MonetizationStatus;
  authorId?: string;
  authorName?: string;
  authorUsername?: string;
  publishedAt?: string;
  createdAt?: string;
  removedReason?: string;
}

export interface VideoComment {
  id: string;
  authorId?: string;
  authorName?: string;
  authorUsername?: string;
  body: string;
  createdAt: string;
}

export interface MonetizationRequest {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface MonetizationQueueEntry {
  requestId: string;
  videoId: string;
  title: string;
  views: number;
  duration: number;
  ownerId?: string;
  ownerName?: string;
  ownerUsername?: string;
  skyId?: string;
  requestedAt: string;
}

export interface RevenueEntry {
  id: string;
  amount: number;
  source: 'ads' | 'adjustment';
  impressions: number;
  note?: string;
  createdAt: string;
}

export const videoUrl = (id: string) => `/api/skyvideo/video/${encodeURIComponent(id)}/video`;
export const thumbnailUrl = (id: string) => `/api/skyvideo/video/${encodeURIComponent(id)}/thumbnail`;

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
 * Пропуск для видео и обложек. Теги <video>/<img> не шлют заголовок
 * Authorization, поэтому сервер кладёт короткую куку, ограниченную путём
 * /api/skyvideo. Просим её один раз при открытии модуля.
 */
export const apiSkyVideoTicket = async () => {
  const r = await apiCall('/api/skyvideo/ticket', { method: 'POST', body: '{}' });
  return r.ok;
};

/* ─── Лента и категории ────────────────────────────────────────────── */

export interface FeedOpts {
  q?: string;
  category?: string;
  sort?: 'new' | 'popular';
  limit?: number;
  offset?: number;
}

export const apiSkyVideoFeed = async (opts: FeedOpts = {}) => {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.category && opts.category !== 'Все') p.set('category', opts.category);
  if (opts.sort) p.set('sort', opts.sort);
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.offset) p.set('offset', String(opts.offset));
  const qs = p.toString();
  const r = await apiCall<{ videos: ServerVideo[] }>(`/api/skyvideo/feed${qs ? `?${qs}` : ''}`);
  return r.ok ? (r.data?.videos ?? []) : null;
};

export const apiSkyVideoCategories = async () => {
  const r = await apiCall<{ categories: string[] }>('/api/skyvideo/categories');
  return r.ok ? (r.data?.categories ?? []) : null;
};

/* ─── Каналы ───────────────────────────────────────────────────────── */

export interface ChannelInfo {
  authorId: string;
  authorName: string;
  authorUsername: string;
  avatar: string | null;
  videoCount: number;
  totalViews: number;
  totalLikes: number;
}

export interface ChannelListEntry {
  authorId: string;
  authorName: string;
  authorUsername: string;
  avatar: string | null;
  videoCount: number;
  totalViews: number;
}

/** Раздел «Каналы» — авторы с хотя бы одним опубликованным роликом. */
export const apiSkyVideoChannels = async (opts: { limit?: number; offset?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.offset) p.set('offset', String(opts.offset));
  const qs = p.toString();
  const r = await apiCall<{ channels: ChannelListEntry[] }>(`/api/skyvideo/channels${qs ? `?${qs}` : ''}`);
  return r.ok ? (r.data?.channels ?? []) : null;
};

/** Страница канала — карточка автора и его опубликованные ролики. */
export const apiSkyVideoChannel = async (authorId: string, opts: FeedOpts = {}) => {
  const p = new URLSearchParams();
  if (opts.sort) p.set('sort', opts.sort);
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.offset) p.set('offset', String(opts.offset));
  const qs = p.toString();
  const r = await apiCall<{ channel: ChannelInfo; videos: ServerVideo[] }>(
    `/api/skyvideo/channel/${encodeURIComponent(authorId)}${qs ? `?${qs}` : ''}`,
  );
  return r.ok ? (r.data ?? null) : null;
};

/** Кабинет автора — свои ролики любого статуса. */
export const apiMySkyVideos = async () => {
  const r = await apiCall<{ videos: ServerVideo[] }>('/api/skyvideo/mine');
  return r.ok ? (r.data?.videos ?? []) : null;
};

export const apiSkyVideo = async (id: string) => {
  const r = await apiCall<{ video: ServerVideo }>(`/api/skyvideo/video/${encodeURIComponent(id)}`);
  return r.ok ? (r.data?.video ?? null) : null;
};

export const apiPatchSkyVideo = async (id: string, patch: {
  title?: string; description?: string; category?: string; tags?: string;
  privacy?: VideoPrivacy;
}) => {
  const r = await apiCall<{ video: ServerVideo }>(`/api/skyvideo/video/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) });
  return r.ok ? (r.data?.video ?? null) : null;
};

export const apiDeleteSkyVideo = async (id: string, reason?: string) => {
  const r = await apiCall(`/api/skyvideo/video/${encodeURIComponent(id)}`,
    { method: 'DELETE', body: JSON.stringify({ reason }) });
  return r.ok;
};

export const apiPublishSkyVideo = async (id: string, on: boolean) => {
  const r = await apiCall<{ video: ServerVideo }>(`/api/skyvideo/video/${encodeURIComponent(id)}/publish`,
    { method: 'POST', body: JSON.stringify({ on }) });
  return r.ok ? (r.data?.video ?? null) : null;
};

export const apiCountSkyVideoView = async (id: string) => {
  const r = await apiCall(`/api/skyvideo/video/${encodeURIComponent(id)}/view`, { method: 'POST', body: '{}' });
  return r.ok;
};

export const apiSetSkyVideoLiked = async (id: string, on: boolean) => {
  const r = await apiCall<{ video: ServerVideo }>(`/api/skyvideo/video/${encodeURIComponent(id)}/like`,
    { method: 'POST', body: JSON.stringify({ on }) });
  return r.ok ? (r.data?.video ?? null) : null;
};

/* ─── Комментарии ─────────────────────────────────────────────────── */

export const apiSkyVideoComments = async (videoId: string) => {
  const r = await apiCall<{ comments: VideoComment[] }>(`/api/skyvideo/video/${encodeURIComponent(videoId)}/comments`);
  return r.ok ? (r.data?.comments ?? []) : null;
};

export const apiAddSkyVideoComment = async (videoId: string, body: string) => {
  const r = await apiCall<{ id: string }>(`/api/skyvideo/video/${encodeURIComponent(videoId)}/comments`,
    { method: 'POST', body: JSON.stringify({ body }) });
  return r.ok ? (r.data?.id ?? null) : null;
};

export const apiDeleteSkyVideoComment = async (commentId: string) => {
  const r = await apiCall(`/api/skyvideo/comment/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
  return r.ok;
};

/* ─── Загрузка ────────────────────────────────────────────────────── */

export interface UploadMeta {
  title: string;
  description?: string;
  category?: string;
  tags?: string;
  duration?: number;
  width?: number;
  height?: number;
}

const UPLOAD_REASONS: Record<string, string> = {
  unsupported_type: 'Такой файл не подходит: нужен MP4, MOV, WebM, AVI или OGV',
  file_too_large: 'Ролик слишком большой',
  invalid_meta: 'Заполните название',
  too_many: 'У вас уже слишком много роликов',
  empty_file: 'Файл пустой',
  upload_interrupted: 'Загрузка оборвалась — попробуйте ещё раз',
  rate_limited: 'Слишком часто. Попробуйте чуть позже',
};

/**
 * Загрузка ролика. XMLHttpRequest — как у Film, чтобы видеть прогресс:
 * ролик уходит минутами, и полоса, которая просто стоит, выглядит как
 * зависшая программа.
 */
export const apiUploadSkyVideo = (
  file: Blob,
  meta: UploadMeta,
  onProgress?: (percent: number) => void,
): { promise: Promise<{ ok: boolean; video?: ServerVideo; reason?: string }>; cancel: () => void } => {
  const p = new URLSearchParams({ title: meta.title });
  if (meta.description) p.set('description', meta.description);
  if (meta.category) p.set('category', meta.category);
  if (meta.tags) p.set('tags', meta.tags);
  if (meta.duration) p.set('duration', String(Math.round(meta.duration)));
  if (meta.width) p.set('width', String(Math.round(meta.width)));
  if (meta.height) p.set('height', String(Math.round(meta.height)));

  const xhr = new XMLHttpRequest();
  const promise = new Promise<{ ok: boolean; video?: ServerVideo; reason?: string }>((resolve) => {
    xhr.open('POST', uploadUrl(`/api/skyvideo/upload?${p}`));
    xhr.withCredentials = !NATIVE_APP;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    Object.entries(nativeXhrHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };

    xhr.onload = () => {
      let data: { video?: ServerVideo; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* тела может не быть */ }
      if (xhr.status === 201) { onProgress?.(100); resolve({ ok: true, video: data.video }); return; }
      if (xhr.status === 413) { resolve({ ok: false, reason: UPLOAD_REASONS.file_too_large }); return; }
      resolve({ ok: false, reason: UPLOAD_REASONS[data.error ?? ''] ?? `Не получилось (${xhr.status})` });
    };
    xhr.onerror = () => resolve({ ok: false, reason: 'Нет связи с сервером' });
    xhr.onabort = () => resolve({ ok: false, reason: 'Загрузка отменена' });
    xhr.send(file);
  });

  return { promise, cancel: () => xhr.abort() };
};

export const apiUploadSkyVideoThumbnail = async (videoId: string, file: Blob) => {
  const r = await apiCall(`/api/skyvideo/video/${encodeURIComponent(videoId)}/thumbnail`, {
    method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' },
  });
  return r.ok;
};

export interface VideoMeta { duration: number; width: number; height: number }

/** Длительность и размер кадра — браузер знает их сам, через <video>. */
export const readVideoMeta = (file: Blob) => new Promise<VideoMeta>((resolve) => {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.preload = 'metadata';
  const done = (m: VideoMeta) => { URL.revokeObjectURL(url); resolve(m); };
  v.onloadedmetadata = () => done({
    duration: Number.isFinite(v.duration) ? v.duration : 0,
    width: v.videoWidth || 0,
    height: v.videoHeight || 0,
  });
  v.onerror = () => done({ duration: 0, width: 0, height: 0 });
  v.src = url;
});

/* ─── Монетизация ─────────────────────────────────────────────────── */

const MONETIZE_REASONS: Record<string, string> = {
  already_pending: 'Заявка уже отправлена и ждёт решения',
  not_published: 'Сначала опубликуйте ролик',
  not_allowed: 'Это не ваш ролик',
};

export const apiRequestSkyVideoMonetization = async (videoId: string) => {
  const r = await apiCall(`/api/skyvideo/video/${encodeURIComponent(videoId)}/monetize`, { method: 'POST' });
  if (r.ok) return { ok: true as const };
  return { ok: false as const, reason: MONETIZE_REASONS[r.error ?? ''] ?? 'Не получилось отправить заявку' };
};

export const apiSkyVideoMonetizationHistory = async (videoId: string) => {
  const r = await apiCall<{ requests: MonetizationRequest[] }>(`/api/skyvideo/video/${encodeURIComponent(videoId)}/monetization`);
  return r.ok ? (r.data?.requests ?? []) : null;
};

export const apiSkyVideoRevenue = async (videoId: string) => {
  const r = await apiCall<{ entries: RevenueEntry[] }>(`/api/skyvideo/video/${encodeURIComponent(videoId)}/revenue`);
  return r.ok ? (r.data?.entries ?? []) : null;
};

/** Очередь заявок — только с правом content. */
export const apiSkyVideoMonetizationQueue = async () => {
  const r = await apiCall<{ requests: MonetizationQueueEntry[] }>('/api/skyvideo/monetization/queue');
  return r.ok ? (r.data?.requests ?? []) : null;
};

export const apiDecideSkyVideoMonetization = async (requestId: string, approve: boolean, reason?: string) => {
  const r = await apiCall(`/api/skyvideo/monetization/${encodeURIComponent(requestId)}/decide`,
    { method: 'POST', body: JSON.stringify({ approve, reason }) });
  return r.ok;
};

/* ─── Админка: региональная доступность роликов ───────────────────── */

export interface AdminSkyVideo {
  id: string;
  title: string;
  ownerId?: string;
  authorName?: string;
  authorUsername?: string;
  status: VideoStatus;
  blockedRegions: string[];
  createdAt: string;
}

export const apiSkyVideoAdminSearch = async (q?: string): Promise<AdminSkyVideo[]> => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const r = await apiCall<{ items: AdminSkyVideo[] }>(`/api/skyvideo/admin/videos?${params}`);
  return r.ok ? r.data?.items ?? [] : [];
};

export const apiSkyVideoSetRegions = async (videoId: string, blockedRegions: string[], reason?: string) =>
  apiCall<{ ok: true; blockedRegions: string[] }>(`/api/skyvideo/video/${encodeURIComponent(videoId)}/regions`, {
    method: 'POST', body: JSON.stringify({ blockedRegions, reason }),
  });
