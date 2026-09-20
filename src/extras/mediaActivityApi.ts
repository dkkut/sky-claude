/* Реальная активность на главной вкладке Sky Media — секунды из
   server/mediaActivity.mjs (music_history/podcast_history/film_progress),
   не выдумка на клиенте. */
import { apiCall } from '@/core/auth/api';

export interface MediaActivity {
  today: { music: number; video: number; podcasts: number };
  week: { music: number; video: number; podcasts: number };
}

export const apiMediaActivity = async (): Promise<MediaActivity | null> => {
  const r = await apiCall<{ data: MediaActivity }>('/api/media/activity');
  return r.ok ? r.data?.data ?? null : null;
};
