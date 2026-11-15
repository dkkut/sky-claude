/**
 * Музыка: разговор с сервером.
 *
 * Всё, что раньше лежало в localStorage браузера, теперь спрашивается у
 * сервера. Здесь только вызовы; кому что можно — решает он, а не мы.
 */
import { withTicketRefresh } from '@/core/mediaTicketRefresh';
import { apiCall, uploadUrl } from '@/core/auth/api';
import { NATIVE_APP, MEDIA_BY_URL } from '@/core/nativeApp';
import { LIMIT_REASONS } from '@/shared/uploadReasons';
import { hideExplicitOn } from '@/labels/hideExplicit';
import { flash } from '@/shared/flash';
import type { Track, TrackStatus } from '@/platform/store';

/** Трек в том виде, в каком его отдаёт сервер. */
export interface ServerTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  license?: string;
  licenseSource?: string;
  /** Итог меток: Explicit (решение модератора или отметка автора) и «Старая версия» (только по решению модератора). */
  explicit?: boolean;
  legacy?: boolean;
  year?: number;
  /** Длительность в секундах. */
  duration: number;
  hasCover: boolean;
  hasVideo?: boolean;
  /** Есть, только если у карточки исполнителя загружено фото на прозрачном фоне. */
  artistCardId?: string;
  status: 'published' | 'private' | 'pending' | 'rejected';
  plays: number;
  own?: boolean;
  createdAt?: string;
  /** Причину отказа сервер отдаёт только владельцу. */
  rejectReason?: string;
  submittedAt?: string;
  /** Только для своего личного трека: защита от автоматической уборки и дата уборки. */
  retentionKeep?: boolean;
  expiresAt?: string;
  /** В очереди проверки — чей это трек. */
  ownerName?: string;
}

export interface ServerPlaylist {
  id: string;
  name: string;
  isPublic: boolean;
  own?: boolean;
  count: number;
  updatedAt?: string;
  tracks?: ServerTrack[];
}

export interface TrackProgress { trackId: string; position: number }

/**
 * Адреса звука и обложки. Файл сам по себе закрыт: сервер проверит право.
 *
 * Тег <audio>/<img> запрос браузер выполняет сам и заголовок Authorization
 * туда не подставить — вместо него короткий подписанный пропуск (см.
 * apiMediaTicket). В обычном браузере он едет курьером в куке, но в
 * родном приложении страница и API — разные origin, а кука на такой
 * случай SameSite=Strict и попросту не доедет обратно. Поэтому там же
 * пропуск подставляется в адрес строкой (?t=), и адрес становится
 * абсолютным (uploadUrl) — без этого относительный путь резолвился бы
 * не туда, а в собственный (пустой) origin самого приложения.
 */
let mediaTicket: string | null = null;

const withMediaTicket = (path: string) => {
  const url = uploadUrl(path);
  if (!MEDIA_BY_URL || !mediaTicket) return url;
  return `${url}?t=${encodeURIComponent(mediaTicket)}`;
};

export const audioUrl = (id: string) => withMediaTicket(`/api/music/track/${encodeURIComponent(id)}/audio`);
export const videoUrl = (id: string) => withMediaTicket(`/api/music/track/${encodeURIComponent(id)}/video`);
export const coverUrl = (id: string) => withMediaTicket(`/api/music/track/${encodeURIComponent(id)}/cover`);

const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Приведение к тому виду трека, которым уже пользуется весь интерфейс
 * музыки. Так серверные данные встают на место прежних без переделки
 * ни одного экрана.
 */
export const toClientTrack = (t: ServerTrack): Track => ({
  id: t.id,
  title: t.title,
  artist: t.artist,
  genre: t.genre || 'Другое',
  license: t.license ?? 'own',
  licenseSource: t.licenseSource,
  explicit: t.explicit,
  legacy: t.legacy,
  album: t.album,
  year: t.year,
  coverUrl: t.hasCover ? coverUrl(t.id) : undefined,
  videoUrl: t.hasVideo ? videoUrl(t.id) : undefined,
  cutoutCardId: t.artistCardId,
  duration: mmss(t.duration),
  premium: false,
  sourceUrl: audioUrl(t.id),
  addedAt: t.createdAt ?? new Date().toISOString(),
  status: t.status as TrackStatus,
  rejectReason: t.rejectReason,
  retentionKeep: t.retentionKeep,
  expiresAt: t.expiresAt,
  submittedAt: t.submittedAt,
  plays: t.plays,
  likes: [],
  uploadedBy: t.own ? 'me' : undefined,
});

/**
 * Пропуск для медиа. Теги <audio> и <img> не умеют слать заголовок
 * авторизации, поэтому сервер кладёт короткую куку, ограниченную путём
 * /api/music. Просим её один раз при открытии музыки.
 */
export const apiMediaTicket = withTicketRefresh(async () => {
  const r = await apiCall<{ ticket?: string }>('/api/music/ticket', { method: 'POST', body: '{}' });
  if (r.ok && r.data?.ticket) mediaTicket = r.data.ticket;
  return r.ok;
});

/* ─── Каталог ──────────────────────────────────────────────────────── */

export const apiTracks = async (opts: { q?: string; mine?: boolean; limit?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.mine) p.set('mine', '1');
  if (opts.limit) p.set('limit', String(opts.limit));
  if (hideExplicitOn() && !opts.mine) p.set('hideExplicit', '1');
  const qs = p.toString();
  const r = await apiCall<{ tracks: ServerTrack[] }>(`/api/music/tracks${qs ? `?${qs}` : ''}`);
  return r.ok ? (r.data?.tracks ?? []) : null;
};

export const apiTrack = async (id: string) => {
  const r = await apiCall<{ track: ServerTrack }>(`/api/music/track/${encodeURIComponent(id)}`);
  return r.ok ? (r.data?.track ?? null) : null;
};

export const apiPatchTrack = async (id: string, patch: {
  title?: string; artist?: string; album?: string; genre?: string;
  lyrics?: string; lyricsMode?: LyricsMode; status?: 'published' | 'private'; license?: string; licenseSource?: string; explicit?: boolean;
}) => {
  const r = await apiCall<{ track: ServerTrack }>(`/api/music/track/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) });
  return r.ok ? (r.data?.track ?? null) : null;
};

export const apiTrackKeep = async (id: string, keep: boolean) => {
  const r = await apiCall(`/api/music/track/${encodeURIComponent(id)}/retention-keep`,
    { method: 'POST', body: JSON.stringify({ keep }) });
  return r.ok;
};

export const apiDeleteTrack = async (id: string) => {
  const r = await apiCall(`/api/music/track/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return r.ok;
};

/* ─── Артист и подписки ────────────────────────────────────────────── */

export interface ServerArtist {
  id: string;
  name: string;
  bio: string;
  genres: string[];
  username?: string;
  followers: number;
  tracks: number;
  plays: number;
  following?: boolean;
  own?: boolean;
}

/** Свой профиль артиста. */
export const apiMyArtist = async () => {
  const r = await apiCall<{ artist: ServerArtist }>('/api/music/artist');
  return r.ok ? (r.data?.artist ?? null) : null;
};

/** Страница артиста по псевдониму — так её открывают из строки трека. */
export const apiArtistByName = async (name: string) => {
  const r = await apiCall<{ artist: ServerArtist }>(
    `/api/music/artist?name=${encodeURIComponent(name)}`);
  return r.ok ? (r.data?.artist ?? null) : null;
};

export const apiSaveArtist = async (p: { name: string; bio?: string; genres?: string[] }) => {
  const r = await apiCall<{ artist: ServerArtist }>('/api/music/artist',
    { method: 'PUT', body: JSON.stringify(p) });
  if (r.ok) return { ok: true as const, artist: r.data?.artist ?? null };
  return { ok: false as const, reason: ARTIST_REASONS[r.error ?? ''] ?? r.reason };
};

const ARTIST_REASONS: Record<string, string> = {
  invalid_name: 'Псевдоним слишком короткий',
  name_taken: 'Такой псевдоним уже занят',
  rate_limited: 'Слишком часто. Попробуйте чуть позже',
};

export const apiFollowArtist = async (artistId: string, on: boolean) => {
  const r = await apiCall<{ artist: ServerArtist }>(
    `/api/music/artist/${encodeURIComponent(artistId)}/follow`,
    { method: 'POST', body: JSON.stringify({ on }) });
  return r.ok ? (r.data?.artist ?? null) : null;
};

/** Витрина: артисты, у которых есть опубликованные треки. */
export const apiArtists = async () => {
  const r = await apiCall<{ artists: ServerArtist[] }>('/api/music/artists');
  return r.ok ? (r.data?.artists ?? []) : null;
};

export const apiFollowing = async () => {
  const r = await apiCall<{ artists: ServerArtist[] }>('/api/music/following');
  return r.ok ? (r.data?.artists ?? []) : null;
};

/** Новое у тех, на кого человек подписан. */
export const apiArtistFeed = async () => {
  const r = await apiCall<{ tracks: ServerTrack[] }>('/api/music/feed');
  return r.ok ? (r.data?.tracks ?? []) : null;
};

/* ─── Проверка перед публикацией ───────────────────────────────────── */

/** Владелец отправляет свой трек на проверку. */
export const apiSubmitTrack = async (id: string) => {
  const r = await apiCall<{ track: ServerTrack }>(
    `/api/music/track/${encodeURIComponent(id)}/submit`, { method: 'POST', body: '{}' });
  // Отказ лимитов публикации объясняем сразу — иначе кнопка «ничего не делает».
  if (!r.ok && LIMIT_REASONS[r.error ?? '']) flash(LIMIT_REASONS[r.error ?? '']);
  return r.ok ? (r.data?.track ?? null) : null;
};

/** Очередь проверки. Отдаётся только администратору. */
export const apiModerationQueue = async () => {
  const r = await apiCall<{ tracks: ServerTrack[] }>('/api/music/moderation');
  return r.ok ? (r.data?.tracks ?? []) : null;
};

/** Решение по заявке: принять или отклонить с причиной. */
export const apiModerate = async (id: string, approve: boolean, reason?: string) => {
  const r = await apiCall<{ status: string }>(
    `/api/music/track/${encodeURIComponent(id)}/moderate`,
    { method: 'POST', body: JSON.stringify({ approve, reason }) });
  return r.ok;
};

/** Отметка о прослушивании: она же история, она же счётчик. */
export const apiNotePlay = async (id: string) => {
  await apiCall(`/api/music/track/${encodeURIComponent(id)}/play`, { method: 'POST' });
};

export type LyricsMode = 'auto' | 'static' | 'synced';
export const apiLyrics = async (id: string) => {
  const r = await apiCall<{ lyrics: string; canEdit: boolean; mode?: LyricsMode }>(
    `/api/music/track/${encodeURIComponent(id)}/lyrics`);
  return r.ok ? (r.data ?? null) : null;
};

/* ─── Загрузка ─────────────────────────────────────────────────────── */

export interface UploadMeta {
  title: string; artist: string; album?: string; genre?: string;
  year?: string | number; duration?: number; license?: string; licenseSource?: string;
}

/**
 * Файл уходит телом запроса, сведения — строкой адреса. Тип сервер
 * определит сам, по первым байтам: тому, что напишет браузер, он не
 * верит.
 */
export const apiUploadTrack = async (
  file: Blob, meta: UploadMeta,
): Promise<{ ok: boolean; track?: ServerTrack; reason?: string }> => {
  const p = new URLSearchParams({ title: meta.title, artist: meta.artist });
  if (meta.album) p.set('album', meta.album);
  if (meta.genre) p.set('genre', meta.genre);
  if (meta.license) p.set('license', meta.license);
  if (meta.licenseSource) p.set('source', meta.licenseSource);
  if (meta.year) p.set('year', String(meta.year));
  if (meta.duration) p.set('duration', String(Math.round(meta.duration)));

  const r = await apiCall<{ track: ServerTrack }>(`/api/music/upload?${p}`, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  // 413 может прийти и без тела: так отвечает nginx, если файл больше
  // его потолка. Человеку нужно объяснение, а не голый код.
  if (r.status === 413) return { ok: false, reason: UPLOAD_REASONS.file_too_large };
  if (!r.ok) return { ok: false, reason: UPLOAD_REASONS[r.error ?? ''] ?? r.reason };
  return { ok: true, track: r.data?.track };
};

const UPLOAD_REASONS: Record<string, string> = {
  ...LIMIT_REASONS,
  unsupported_type: 'Такой файл не подходит: нужен MP3, OGG, FLAC, WAV или M4A',
  file_too_large: 'Файл слишком большой — до 30 МБ',
  invalid_meta: 'Заполните название и исполнителя',
  rate_limited: 'Слишком часто. Попробуйте чуть позже',
  prime_required: 'Загрузка музыки доступна по подписке Sky Prime',
};

export const apiUploadCover = async (trackId: string, file: Blob) => {
  const r = await apiCall(`/api/music/track/${encodeURIComponent(trackId)}/cover`, {
    method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' },
  });
  return r.ok;
};

export const VIDEO_REASONS: Record<string, string> = {
  unsupported_type: 'Нужен видеофайл MP4 или WebM',
  file_too_large: 'Видео слишком большое — до 30 МБ',
  not_allowed: 'Видеофон может добавить только владелец трека',
  rate_limited: 'Слишком часто. Попробуйте чуть позже',
};
/** Загрузка видеофона: вернёт null при успехе, иначе понятную причину. */
export const apiUploadVideo = async (trackId: string, file: Blob): Promise<string | null> => {
  const r = await apiCall<{ error?: string }>(`/api/music/track/${encodeURIComponent(trackId)}/video`, {
    method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' },
  });
  if (r.ok) return null;
  return VIDEO_REASONS[(r.data as { error?: string } | undefined)?.error ?? ''] ?? 'Не удалось загрузить видео. Попробуйте ещё раз.';
};
export const apiDeleteVideo = async (trackId: string) => {
  const r = await apiCall(`/api/music/track/${encodeURIComponent(trackId)}/video`, { method: 'DELETE' });
  return r.ok;
};

/* ─── Плейлисты ────────────────────────────────────────────────────── */

export const apiPlaylists = async () => {
  const r = await apiCall<{ playlists: ServerPlaylist[] }>('/api/music/playlists');
  return r.ok ? (r.data?.playlists ?? []) : null;
};

export const apiPlaylist = async (id: string) => {
  const r = await apiCall<{ playlist: ServerPlaylist }>(`/api/music/playlist/${encodeURIComponent(id)}`);
  return r.ok ? (r.data?.playlist ?? null) : null;
};

export const apiCreatePlaylist = async (name: string) => {
  const r = await apiCall<{ playlist: ServerPlaylist }>('/api/music/playlists',
    { method: 'POST', body: JSON.stringify({ name }) });
  return r.ok ? (r.data?.playlist ?? null) : null;
};

export const apiRenamePlaylist = async (id: string, name: string) => {
  const r = await apiCall<{ playlist: ServerPlaylist }>(`/api/music/playlist/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ name }) });
  return r.ok;
};

export const apiSetPlaylistPublic = async (id: string, isPublic: boolean) => {
  const r = await apiCall(`/api/music/playlist/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ isPublic }) });
  return r.ok;
};

export const apiDeletePlaylist = async (id: string) => {
  const r = await apiCall(`/api/music/playlist/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return r.ok;
};

export const apiAddToPlaylist = async (playlistId: string, trackId: string) => {
  const r = await apiCall<{ playlist: ServerPlaylist }>(
    `/api/music/playlist/${encodeURIComponent(playlistId)}/tracks`,
    { method: 'POST', body: JSON.stringify({ trackId }) });
  return r.ok ? (r.data?.playlist ?? null) : null;
};

export const apiRemoveFromPlaylist = async (playlistId: string, trackId: string) => {
  const r = await apiCall<{ playlist: ServerPlaylist }>(
    `/api/music/playlist/${encodeURIComponent(playlistId)}/tracks`,
    { method: 'DELETE', body: JSON.stringify({ trackId }) });
  return r.ok ? (r.data?.playlist ?? null) : null;
};

export const apiReorderPlaylist = async (playlistId: string, order: string[]) => {
  const r = await apiCall<{ playlist: ServerPlaylist }>(
    `/api/music/playlist/${encodeURIComponent(playlistId)}/order`,
    { method: 'POST', body: JSON.stringify({ order }) });
  return r.ok ? (r.data?.playlist ?? null) : null;
};

/* ─── Избранное, история, позиция ──────────────────────────────────── */

export const apiFavorites = async () => {
  const r = await apiCall<{ tracks: ServerTrack[] }>('/api/music/favorites');
  return r.ok ? (r.data?.tracks ?? []) : null;
};

export const apiSetFavorite = async (trackId: string, on: boolean) => {
  const r = await apiCall<{ tracks: ServerTrack[] }>('/api/music/favorites',
    { method: 'POST', body: JSON.stringify({ trackId, on }) });
  return r.ok ? (r.data?.tracks ?? null) : null;
};

export const apiHistory = async () => {
  const r = await apiCall<{ tracks: ServerTrack[] }>('/api/music/history');
  return r.ok ? (r.data?.tracks ?? []) : null;
};

export type TopArtist = { artist: string; plays: number; seconds: number };
export const apiTopArtists = async () => {
  const r = await apiCall<{ artists: TopArtist[] }>('/api/music/top-artists');
  return r.ok ? (r.data?.artists ?? []) : null;
};

export const apiProgress = async () => {
  const r = await apiCall<{ progress: TrackProgress[] }>('/api/music/progress');
  return r.ok ? (r.data?.progress ?? []) : null;
};

export const apiSetProgress = async (trackId: string, position: number) => {
  await apiCall('/api/music/progress',
    { method: 'POST', body: JSON.stringify({ trackId, position: Math.floor(position) }) });
};
