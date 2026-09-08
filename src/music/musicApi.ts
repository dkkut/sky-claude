/**
 * Музыка: разговор с сервером.
 *
 * Всё, что раньше лежало в localStorage браузера, теперь спрашивается у
 * сервера. Здесь только вызовы; кому что можно — решает он, а не мы.
 */
import { apiCall } from '@/core/auth/api';
import type { Track, TrackStatus } from '@/platform/store';

/** Трек в том виде, в каком его отдаёт сервер. */
export interface ServerTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  year?: number;
  /** Длительность в секундах. */
  duration: number;
  hasCover: boolean;
  status: 'published' | 'private' | 'pending' | 'rejected';
  plays: number;
  own?: boolean;
  createdAt?: string;
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

/** Адреса звука и обложки. Файл сам по себе закрыт: сервер проверит право. */
export const audioUrl = (id: string) => `/api/music/track/${encodeURIComponent(id)}/audio`;
export const coverUrl = (id: string) => `/api/music/track/${encodeURIComponent(id)}/cover`;

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
  album: t.album,
  year: t.year,
  coverUrl: t.hasCover ? coverUrl(t.id) : undefined,
  duration: mmss(t.duration),
  premium: false,
  sourceUrl: audioUrl(t.id),
  addedAt: t.createdAt ?? new Date().toISOString(),
  // 'rejected' на клиенте отдельного вида не имеет: для владельца это
  // просто неопубликованный трек.
  status: (t.status === 'published' ? 'published'
    : t.status === 'pending' ? 'pending' : 'private') as TrackStatus,
  plays: t.plays,
  likes: [],
  uploadedBy: t.own ? 'me' : undefined,
});

/**
 * Пропуск для медиа. Теги <audio> и <img> не умеют слать заголовок
 * авторизации, поэтому сервер кладёт короткую куку, ограниченную путём
 * /api/music. Просим её один раз при открытии музыки.
 */
export const apiMediaTicket = async () => {
  const r = await apiCall('/api/music/ticket', { method: 'POST', body: '{}' });
  return r.ok;
};

/* ─── Каталог ──────────────────────────────────────────────────────── */

export const apiTracks = async (opts: { q?: string; mine?: boolean; limit?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.mine) p.set('mine', '1');
  if (opts.limit) p.set('limit', String(opts.limit));
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
  lyrics?: string; status?: 'published' | 'private';
}) => {
  const r = await apiCall<{ track: ServerTrack }>(`/api/music/track/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) });
  return r.ok ? (r.data?.track ?? null) : null;
};

export const apiDeleteTrack = async (id: string) => {
  const r = await apiCall(`/api/music/track/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return r.ok;
};

/** Отметка о прослушивании: она же история, она же счётчик. */
export const apiNotePlay = async (id: string) => {
  await apiCall(`/api/music/track/${encodeURIComponent(id)}/play`, { method: 'POST' });
};

export const apiLyrics = async (id: string) => {
  const r = await apiCall<{ lyrics: string; canEdit: boolean }>(
    `/api/music/track/${encodeURIComponent(id)}/lyrics`);
  return r.ok ? (r.data ?? null) : null;
};

/* ─── Загрузка ─────────────────────────────────────────────────────── */

export interface UploadMeta {
  title: string; artist: string; album?: string; genre?: string;
  year?: string | number; duration?: number;
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
  if (meta.year) p.set('year', String(meta.year));
  if (meta.duration) p.set('duration', String(Math.round(meta.duration)));

  const r = await apiCall<{ track: ServerTrack }>(`/api/music/upload?${p}`, {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  if (!r.ok) return { ok: false, reason: UPLOAD_REASONS[r.error ?? ''] ?? r.reason };
  return { ok: true, track: r.data?.track };
};

const UPLOAD_REASONS: Record<string, string> = {
  unsupported_type: 'Такой файл не подходит: нужен MP3, OGG, FLAC, WAV или M4A',
  file_too_large: 'Файл слишком большой — до 30 МБ',
  invalid_meta: 'Заполните название и исполнителя',
  rate_limited: 'Слишком часто. Попробуйте чуть позже',
};

export const apiUploadCover = async (trackId: string, file: Blob) => {
  const r = await apiCall(`/api/music/track/${encodeURIComponent(trackId)}/cover`, {
    method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' },
  });
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

export const apiProgress = async () => {
  const r = await apiCall<{ progress: TrackProgress[] }>('/api/music/progress');
  return r.ok ? (r.data?.progress ?? []) : null;
};

export const apiSetProgress = async (trackId: string, position: number) => {
  await apiCall('/api/music/progress',
    { method: 'POST', body: JSON.stringify({ trackId, position: Math.floor(position) }) });
};
