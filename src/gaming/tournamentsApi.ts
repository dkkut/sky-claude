/* ===============================================================
   SKY GAMES — кабинет турниров (server/routes/games.mjs, server/tournaments.mjs).
   Общий для всех список вместо старой localStorage-заглушки.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export interface ServerTournament {
  id: string;
  gameId: string;
  title: string;
  description: string;
  format: string;
  prize: string;
  teamsMax: number;
  teamsIn: number;
  organizerId: string;
  status: 'upcoming' | 'live' | 'finished' | 'cancelled';
  isJoined: boolean;
  startsAt: string;
  createdAt: string;
}

export const apiListTournaments = async (): Promise<ServerTournament[]> => {
  const r = await apiCall<{ tournaments: ServerTournament[] }>('/api/games/tournaments');
  return r.ok ? r.data?.tournaments ?? [] : [];
};

export const apiCreateTournament = async (input: {
  gameId: string; title: string; description?: string; format?: string;
  prize?: string; teamsMax: number; startsAt: string;
}): Promise<{ tournament?: ServerTournament; error?: string }> => {
  const r = await apiCall<{ tournament: ServerTournament }>('/api/games/tournaments', {
    method: 'POST', body: JSON.stringify(input),
  });
  return r.ok && r.data ? { tournament: r.data.tournament } : { error: r.error ?? 'error' };
};

export const apiJoinTournament = async (id: string): Promise<ServerTournament | null> => {
  const r = await apiCall<{ tournament: ServerTournament }>(`/api/games/tournaments/${encodeURIComponent(id)}/join`, { method: 'POST' });
  return r.ok && r.data ? r.data.tournament : null;
};

export const apiLeaveTournament = async (id: string): Promise<ServerTournament | null> => {
  const r = await apiCall<{ tournament: ServerTournament }>(`/api/games/tournaments/${encodeURIComponent(id)}/leave`, { method: 'POST' });
  return r.ok && r.data ? r.data.tournament : null;
};

export const apiSetTournamentStatus = async (id: string, status: 'live' | 'finished' | 'cancelled'): Promise<ServerTournament | null> => {
  const r = await apiCall<{ tournament: ServerTournament }>(`/api/games/tournaments/${encodeURIComponent(id)}/status`, {
    method: 'POST', body: JSON.stringify({ status }),
  });
  return r.ok && r.data ? r.data.tournament : null;
};
