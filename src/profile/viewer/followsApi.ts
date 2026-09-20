/* ===============================================================
   ПОДПИСКИ — разговор с сервером (server/follows.mjs).

   Один настоящий граф для Bloom, SkyVideo и общего профиль-вьюера —
   вместо трёх локальных копий, которые раньше вручную держали
   синхронными друг с другом.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export interface FollowsOf {
  following: string[];
  followers: string[];
  followingCount: number;
  followerCount: number;
  isFollowing: boolean;
}

export const apiFollowsOf = async (userId: string): Promise<FollowsOf | null> => {
  const r = await apiCall<FollowsOf>(`/api/follows/${userId}`);
  return r.ok ? r.data ?? null : null;
};

export const apiToggleFollow = async (userId: string): Promise<{ following: boolean } | null> => {
  const r = await apiCall<{ following: boolean }>(`/api/follows/${userId}/toggle`, { method: 'POST' });
  return r.ok ? r.data ?? null : null;
};
