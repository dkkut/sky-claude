/* ===============================================================
   VOICE PARTY — список/создание/удаление комнат (server/routes/voiceparty.mjs).
   Кто внутри и живое состояние комнаты — по WebSocket, см. store.ts и
   src/messenger/socket.ts (события vp:*).
=============================================================== */
import { apiCall } from '@/core/auth/api';
import type { VPRoom, VPParticipant, VPCategory } from './types';

interface ServerParticipant {
  id: string; name: string; username?: string; avatar: string | null;
  role: VPParticipant['role']; muted: boolean; handRaised: boolean; joinedAt: string;
}

interface ServerRoom {
  id: string; title: string; description: string; category: VPCategory;
  ownerId: string; isPrivate: boolean; inviteCode: string; maxParticipants: number;
  permissions: VPRoom['permissions']; createdAt: string; scheduledFor: string | null; ended: boolean;
  participants: ServerParticipant[];
}

const AVATAR_COLORS = ['#4f6ef7', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e', '#06b6d4', '#ef4444', '#a78bfa'];
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
export const colorFor = (id: string) => AVATAR_COLORS[hash(id) % AVATAR_COLORS.length];

export const toClientParticipant = (p: ServerParticipant): VPParticipant => ({
  id: p.id, name: p.name, avatarColor: colorFor(p.id), role: p.role, muted: p.muted,
  handRaised: p.handRaised, speaking: false, joinedAt: p.joinedAt, isReal: true,
});

export const toClientRoom = (r: ServerRoom): VPRoom => ({
  id: r.id, title: r.title, description: r.description, category: r.category,
  isPrivate: r.isPrivate, inviteCode: r.inviteCode, ownerId: r.ownerId, maxParticipants: r.maxParticipants,
  participants: r.participants.map(toClientParticipant),
  messages: [], permissions: r.permissions, createdAt: r.createdAt,
  scheduledFor: r.scheduledFor ?? undefined, ended: r.ended, banned: [],
});

export const apiListRooms = async (): Promise<{ live: VPRoom[]; scheduled: VPRoom[] }> => {
  const r = await apiCall<{ live: ServerRoom[]; scheduled: ServerRoom[] }>('/api/voiceparty/rooms');
  if (!r.ok || !r.data) return { live: [], scheduled: [] };
  return { live: r.data.live.map(toClientRoom), scheduled: r.data.scheduled.map(toClientRoom) };
};

export const apiCreateRoom = async (input: {
  title: string; description: string; category: VPCategory; isPrivate: boolean;
  maxParticipants: number; scheduledFor?: string;
}): Promise<VPRoom | null> => {
  const r = await apiCall<{ room: ServerRoom }>('/api/voiceparty/rooms', {
    method: 'POST', body: JSON.stringify(input),
  });
  return r.ok && r.data ? toClientRoom(r.data.room) : null;
};

export const apiDeleteRoom = async (roomId: string): Promise<boolean> => {
  const r = await apiCall(`/api/voiceparty/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
  return r.ok;
};
