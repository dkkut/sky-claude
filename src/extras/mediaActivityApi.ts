/* Реальная активность на главной вкладке Sky Media — секунды из
   server/mediaActivity.mjs (music_history/podcast_history/film_progress),
   не выдумка на клиенте. */
import { apiCall } from '@/core/auth/api';

export interface MediaActivity {
  today: { music: number; video: number; podcasts: number; games: number };
  week: { music: number; video: number; podcasts: number; games: number };
  playing: { kind: 'blox' | 'game'; refId: string; title: string; since: string } | null;
}

export const apiMediaActivity = async (): Promise<MediaActivity | null> => {
  const r = await apiCall<{ data: MediaActivity }>('/api/media/activity');
  return r.ok ? r.data?.data ?? null : null;
};

/** Пульс открытой игры: раз в 30 секунд, в том числе из фона. Ошибки молча не страшны — это только учёт времени. */
export const apiGamePing = (kind: 'blox' | 'game', refId: string, title?: string) =>
  apiCall('/api/games/activity/ping', { method: 'POST', body: JSON.stringify({ kind, refId, title }) });

export interface GamePlaying { kind: 'blox' | 'game'; refId: string; title: string; since: string }
export interface GameSummary { playing: GamePlaying | null; share: boolean; games: { kind: string; refId: string; title: string; totalSec: number; weekSec: number }[] }
export const apiGameStop = () => apiCall('/api/games/activity/stop', { method: 'POST', body: '{}' });
export const apiGameSummary = async (): Promise<GameSummary | null> => { const r = await apiCall<GameSummary>('/api/games/activity/summary'); return r.ok ? r.data ?? null : null; };
export const apiGameShare = (share: boolean) => apiCall('/api/games/activity/share', { method: 'PUT', body: JSON.stringify({ share }) });
export const apiGamePresence = async (ids: string[]): Promise<Record<string, GamePlaying> | null> => {
  if (!ids.length) return {};
  const r = await apiCall<{ playing: Record<string, GamePlaying> }>(`/api/games/activity/of?ids=${encodeURIComponent(ids.slice(0, 60).join(','))}`);
  return r.ok ? r.data?.playing ?? {} : null;
};
