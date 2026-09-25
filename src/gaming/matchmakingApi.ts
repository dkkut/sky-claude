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
}

export const apiGameRating = async (gameId: string): Promise<GameRating | null> => {
  const r = await apiCall<{ rating: GameRating }>(`/api/games/${encodeURIComponent(gameId)}/rating`);
  return r.ok ? r.data?.rating ?? null : null;
};
