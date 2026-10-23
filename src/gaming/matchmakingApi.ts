/* ===============================================================
   SKY GAMES — реальный рейтинг с сервера (server/matchmaking.mjs).
   Очередь и матчи — по WebSocket, см. src/gaming/store.ts и
   src/messenger/socket.ts (события mm:*).
=============================================================== */
import { apiCall } from '@/core/auth/api';

export interface GameRating {
  elo: number;
  wins: number;
  losses: number;
  /* Расширение ELO (server/gameelo.mjs) — старый сервер этих полей не отдаёт. */
  peak?: number;
  games?: number;
  calibrating?: boolean;
  gamesToCalibrate?: number;
  position?: number | null;
  tier?: { id: string; name: string; min: number; next: { id: string; name: string; min: number } | null; progress: number };
}

export interface BoardRow { place: number; profileId: string; name: string; username: string; elo: number; wins: number; losses: number; tier: string; me: boolean }
export interface EloHistoryItem { matchId: string | null; before: number; after: number; delta: number; won: boolean; k: number; rated: boolean; at: string }

export const apiGameLeaderboard = async (gameId: string, limit = 20) => {
  const r = await apiCall<{ top: BoardRow[]; mine: GameRating }>(`/api/games/${encodeURIComponent(gameId)}/leaderboard?limit=${limit}`);
  return r.ok ? r.data ?? null : null;
};

export const apiGameEloHistory = async (gameId: string, limit = 15) => {
  const r = await apiCall<{ items: EloHistoryItem[] }>(`/api/games/${encodeURIComponent(gameId)}/rating/history?limit=${limit}`);
  return r.ok ? r.data?.items ?? [] : [];
};

export const apiGameRating = async (gameId: string): Promise<GameRating | null> => {
  const r = await apiCall<{ rating: GameRating }>(`/api/games/${encodeURIComponent(gameId)}/rating`);
  return r.ok ? r.data?.rating ?? null : null;
};
