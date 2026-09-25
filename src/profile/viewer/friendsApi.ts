/* ===============================================================
   ДРУЖБА и ПРОСМОТРЫ ПРОФИЛЯ — разговор с сервером
   (server/friends.mjs, server/profileviews.mjs).

   Раньше обе вещи жили в localStorage профиль-вьюера: заявка в друзья
   существовала только в браузере отправителя (адресат её никогда не
   получал), а просмотры считались в браузере смотрящего, а не у
   владельца профиля.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export type FriendStatus = 'none' | 'pending_out' | 'pending_in' | 'friends';

export interface FriendsOf {
  status: FriendStatus;
  friendIds: string[];
  friendCount: number;
}

export const apiFriendsOf = async (userId: string): Promise<FriendsOf | null> => {
  const r = await apiCall<FriendsOf>(`/api/friends/${userId}`);
  return r.ok ? r.data ?? null : null;
};

export const apiSendFriendRequest = async (userId: string): Promise<{ status: FriendStatus } | null> => {
  const r = await apiCall<{ status: FriendStatus }>(`/api/friends/${userId}/request`, { method: 'POST' });
  return r.ok ? r.data ?? null : null;
};

export const apiRemoveFriend = async (userId: string): Promise<{ status: FriendStatus } | null> => {
  const r = await apiCall<{ status: FriendStatus }>(`/api/friends/${userId}/remove`, { method: 'POST' });
  return r.ok ? r.data ?? null : null;
};

export const apiRecordProfileView = async (userId: string): Promise<void> => {
  await apiCall(`/api/profile-views/${userId}`, { method: 'POST' });
};

/** count === null значит «не моя страница» — сервер не отдаёт чужие просмотры. */
export const apiProfileViewCount = async (userId: string): Promise<number | null> => {
  const r = await apiCall<{ count: number | null }>(`/api/profile-views/${userId}`);
  return r.ok ? r.data?.count ?? null : null;
};
