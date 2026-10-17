/** Сериалы Sky Film: разговор с сервером (`/api/film/series*`). Права решает сервер. */
import { apiCall, apiBlob } from '@/core/auth/api';
import type { ServerMovie } from '@/film/filmApi';

export interface ServerSeries {
  id: string; title: string; description?: string; category: string; genre?: string; year?: number; country?: string; ageRating?: string;
  status: 'private' | 'pending' | 'published' | 'rejected'; private: boolean; own?: boolean; uploaderName?: string;
  seasons: number; episodes: number; posterMovieId?: string; rejectReason?: string; addedAt?: string;
}
export interface SeasonView { id: string; number: number; title: string; episodes: ServerMovie[] }
export interface SeriesFull {
  series: ServerSeries; seasons: SeasonView[];
  resume: { episodeId: string; position: number; fresh?: boolean; next?: boolean; finished?: boolean } | null;
}

const ERR: Record<string, string> = {
  invalid_meta: 'Проверьте поля', too_many: 'Достигнут предел', season_exists: 'Сезон с таким номером уже есть',
  episode_exists: 'Серия с таким номером уже есть', already_pending: 'Уже на проверке', already_published: 'Уже опубликовано',
  no_episodes: 'Сначала загрузите хотя бы одну серию', bad_intro: 'Конец заставки должен быть позже начала',
  bad_lang: 'Неизвестный язык', bad_subtitles: 'Это не файл субтитров (нужен .srt или .vtt)', file_too_large: 'Файл субтитров слишком большой (до 300 КБ)',
  not_allowed: 'Нет прав на это действие', not_found: 'Не найдено', prime_required: 'Нужна подписка Sky Prime',
};
export const seriesError = (code?: string) => ERR[code ?? ''] ?? 'Не получилось. Попробуйте ещё раз';

const R = async <T>(path: string, method = 'GET', body?: unknown) => {
  const r = await apiCall<T>(path, body === undefined ? { method } : { method, body: JSON.stringify(body) });
  return r.ok ? { ok: true as const, data: r.data as T } : { ok: false as const, error: seriesError(r.error) };
};

export const apiSeriesCatalog = async (q?: string) => {
  const r = await apiCall<{ series: ServerSeries[] }>(`/api/film/series${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  return r.ok ? (r.data?.series ?? []) : null;
};
export const apiMySeries = async () => {
  const r = await apiCall<{ series: ServerSeries[] }>('/api/film/series/mine');
  return r.ok ? (r.data?.series ?? []) : null;
};
export const apiSeries = async (id: string) => { const r = await apiCall<SeriesFull>(`/api/film/series/${encodeURIComponent(id)}`); return r.ok ? (r.data ?? null) : null; };
export const apiCreateSeries = (meta: { title: string; description?: string; genre?: string; year?: number }) => R<{ id: string }>('/api/film/series', 'POST', meta);
export const apiPatchSeries = (id: string, patch: Record<string, unknown>) => R(`/api/film/series/${encodeURIComponent(id)}`, 'PATCH', patch);
export const apiDeleteSeries = (id: string) => R(`/api/film/series/${encodeURIComponent(id)}`, 'DELETE');
export const apiAddSeason = (id: string, title?: string) => R<{ id: string; number: number }>(`/api/film/series/${encodeURIComponent(id)}/seasons`, 'POST', { title });
export const apiPatchSeason = (id: string, patch: { title?: string; number?: number }) => R(`/api/film/season/${encodeURIComponent(id)}`, 'PATCH', patch);
export const apiDeleteSeason = (id: string) => R(`/api/film/season/${encodeURIComponent(id)}`, 'DELETE');
export const apiPatchEpisode = (id: string, patch: Record<string, unknown>) => R(`/api/film/episode/${encodeURIComponent(id)}`, 'PATCH', patch);
export const apiDeleteEpisode = (id: string) => R(`/api/film/episode/${encodeURIComponent(id)}`, 'DELETE');
export const apiNextEpisode = async (id: string) => { const r = await apiCall<{ next: ServerMovie | null }>(`/api/film/episode/${encodeURIComponent(id)}/next`); return r.ok ? (r.data?.next ?? null) : null; };
export const apiSubmitSeries = (id: string, license: 'open' | 'personal' = 'open') => R<{ sent: number }>(`/api/film/series/${encodeURIComponent(id)}/submit`, 'POST', { license });

export interface SubtitleTrack { lang: string; label: string }
export const apiSubtitles = async (movieId: string) => {
  const r = await apiCall<{ subtitles: SubtitleTrack[] }>(`/api/film/movie/${encodeURIComponent(movieId)}/subtitles`);
  return r.ok ? (r.data?.subtitles ?? []) : [];
};
/** Текст дорожки — через обычный запрос с токеном; в плеер он идёт blob-ссылкой, поэтому работает и в приложениях. */
export const apiSubtitleBlobUrl = async (movieId: string, lang: string) => {
  const r = await apiBlob(`/api/film/movie/${encodeURIComponent(movieId)}/subtitles/${encodeURIComponent(lang)}`);
  return r.ok && r.blob ? URL.createObjectURL(new Blob([r.blob], { type: 'text/vtt' })) : null;
};
export const apiPutSubtitle = (movieId: string, lang: string, content: string, label?: string) =>
  R(`/api/film/movie/${encodeURIComponent(movieId)}/subtitles/${encodeURIComponent(lang)}`, 'PUT', { content, label });
export const apiDeleteSubtitle = (movieId: string, lang: string) => R(`/api/film/movie/${encodeURIComponent(movieId)}/subtitles/${encodeURIComponent(lang)}`, 'DELETE');

export const SUBTITLE_LANGS: [string, string][] = [['ru', 'Русский'], ['en', 'English'], ['uk', 'Українська'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano'], ['tr', 'Türkçe'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文']];
