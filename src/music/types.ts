/* --- Shared types для Music модуля ----------------------- */
import type { Track } from '@/platform/store';

export type { Track };

export interface ListenCtx {
  genreCount:  Record<string, number>;
  artistCount: Record<string, number>;
  liked:       Set<string>;
  history:     Set<string>;
}

export type RepeatMode = 'off' | 'all' | 'one';
