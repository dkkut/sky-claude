/**
 * Sky TV: разговор с сервером.
 *
 * Здесь нет ни одной функции, принимающей адрес потока, — и это не
 * упущение. Клиент присылает серверу идентификатор канала, а какой
 * источник ему соответствует, сервер решает сам. Поэтому переписанный
 * в браузере код не может заставить Sky TV сходить по чужому адресу:
 * такого параметра нет ни в одной ручке.
 *
 * Адрес манифеста, который здесь собирается, ведёт к нам же — сервер
 * сходит к источнику сам и отдаст только содержимое.
 */
import { getApiOrigin } from '@/core/nativeApp';
import { apiCall } from '@/core/auth/api';

/** Почему канал не показывается. Обе причины — про нас, а не про источник. */
export type ChannelOffline = 'no_source' | 'unavailable';

export interface Programme {
  id?: string;
  title: string;
  description?: string;
  category?: string;
  ageRating?: string;
  startsAt?: string;
  endsAt?: string;
  live?: boolean;
}

export interface TvChannel {
  id: string;
  slug: string;
  name: string;
  description?: string;
  category: string;
  country: string;
  region?: string;
  /** Фирменный цвет и буквенный знак — пока нет настоящего логотипа. */
  accent: string;
  mark: string;
  hasLogo: boolean;
  ageRating?: string;
  live: boolean;
  offline?: ChannelOffline;
  favorite?: boolean;
  now?: Programme;
  next?: Programme;
}

/**
 * Адрес манифеста канала. Ведёт к нашему серверу: он сходит к
 * источнику сам, перепишет адреса внутри и отдаст содержимое. Самого
 * источника здесь нет и быть не может.
 */
export const manifestUrl = (channelId: string) =>
  `${getApiOrigin()}/api/tv/channel/${encodeURIComponent(channelId)}/manifest`;

export const logoUrl = (channelId: string) =>
  `/api/tv/channel/${encodeURIComponent(channelId)}/logo`;

/* ─── Каталог ──────────────────────────────────────────────────────── */

export const apiChannels = async (opts: { category?: string; q?: string; favorites?: boolean } = {}) => {
  const p = new URLSearchParams();
  if (opts.category && opts.category !== 'Все') p.set('category', opts.category);
  if (opts.q) p.set('q', opts.q);
  if (opts.favorites) p.set('favorites', '1');
  const qs = p.toString();
  const r = await apiCall<{ channels: TvChannel[] }>(`/api/tv/channels${qs ? `?${qs}` : ''}`);
  return r.ok ? (r.data?.channels ?? []) : null;
};

export const apiTvCategories = async () => {
  const r = await apiCall<{ categories: { name: string; count: number }[]; all: string[] }>(
    '/api/tv/categories');
  return r.ok ? (r.data ?? { categories: [], all: [] }) : null;
};

export const apiChannel = async (id: string) => {
  const r = await apiCall<{ channel: TvChannel }>(`/api/tv/channel/${encodeURIComponent(id)}`);
  return r.ok ? (r.data?.channel ?? null) : null;
};

/* ─── Избранное и недавние ─────────────────────────────────────────── */

export const apiTvFavorites = async () => {
  const r = await apiCall<{ channels: TvChannel[] }>('/api/tv/favorites');
  return r.ok ? (r.data?.channels ?? []) : null;
};

export const apiSetTvFavorite = async (channelId: string, on: boolean) => {
  const r = await apiCall<{ channels: TvChannel[] }>('/api/tv/favorites',
    { method: 'POST', body: JSON.stringify({ channelId, on }) });
  return r.ok ? (r.data?.channels ?? []) : null;
};

export const apiTvRecent = async () => {
  const r = await apiCall<{ channels: TvChannel[] }>('/api/tv/recent');
  return r.ok ? (r.data?.channels ?? []) : null;
};

/** Отметить, что человек включил канал. Нужно для «недавно смотрели». */
export const apiNoteWatched = async (channelId: string) => {
  const r = await apiCall(`/api/tv/channel/${encodeURIComponent(channelId)}/watch`,
    { method: 'POST', body: '{}' });
  return r.ok;
};

/* ─── Телепрограмма ────────────────────────────────────────────────── */

/**
 * Расписание канала. Пустой ответ — это честно: значит, источник
 * расписания не подключён. Придумывать передачи нельзя.
 */
export const apiEpg = async (channelId: string, hours = 24) => {
  const r = await apiCall<{ programme: Programme[] }>(
    `/api/tv/channel/${encodeURIComponent(channelId)}/epg?hours=${hours}`);
  return r.ok ? (r.data?.programme ?? []) : null;
};

/* ─── Управление: только владельцу ─────────────────────────────────── */

export interface AdminChannel {
  slug: string;
  name: string;
  category: string;
  enabled: boolean;
  source: {
    id: string;
    kind: string;
    delivery: string;
    licence: string;
    active: boolean;
    priority: number;
    health: {
      ok: boolean; statusCode: number | null; detail: string | null;
      latencyMs: number | null; checkedAt: string; failures: number;
    } | null;
  } | null;
}

export const apiTvOverview = async () => {
  const r = await apiCall<{ channels: AdminChannel[] }>('/api/tv/admin/channels');
  return r.ok ? (r.data?.channels ?? []) : null;
};

export const apiTvCheckSources = async () => {
  const r = await apiCall<{ ok: number; bad: number }>('/api/tv/admin/check',
    { method: 'POST', body: '{}' });
  return r.ok ? (r.data ?? null) : null;
};

/** Понятная человеку причина, почему канал не идёт. */
export const offlineReason = (c: TvChannel) => {
  if (c.live) return '';
  return c.offline === 'no_source'
    ? 'Источник ещё не подключён'
    : 'Канал временно недоступен';
};
