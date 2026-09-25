/* ===============================================================
   PROFILE SOCIAL GRAPH
   Три независимых, но согласованных отношения между аккаунтами —
   follow, дружба и просмотры профиля. Источник правды для всех трёх —
   сервер (server/follows.mjs, server/friends.mjs,
   server/profileviews.mjs), здесь только кэш в памяти вкладки, как у
   чужих профилей в otherProfiles.ts.

   Дружба (заявка/подтверждение) отдельно от подписки — как и просил
   бриф: «добавить в друзья» и «подписаться» — разные действия.
   Раньше дружба и просмотры жили в localStorage одним общим массивом
   на браузер: заявка, отправленная одним человеком, физически не
   могла попасть в браузер второго (localStorage не синхронизируется
   между людьми и устройствами), а просмотр профиля считался в
   браузере смотрящего, а не у того, чей профиль смотрят, — так что
   владелец профиля свои же просмотры никогда не видел.
=============================================================== */
import { create } from 'zustand';
import { apiFollowsOf, apiToggleFollow, type FollowsOf } from './followsApi';
import {
  apiFriendsOf, apiSendFriendRequest, apiRemoveFriend,
  apiRecordProfileView, apiProfileViewCount,
  type FriendsOf, type FriendStatus,
} from './friendsApi';

export type { FriendStatus };

interface SocialGraphState {
  /* -- follow: кэш по просматриваемому userId, источник правды — сервер -- */
  followCache:   Record<string, FollowsOf | undefined>;
  followPending: Set<string>;
  fetchFollows:  (userId: string) => Promise<void>;
  isFollowing:   (followerId: string, targetId: string) => boolean;
  isFollowedBy:  (userId: string, otherId: string) => boolean;
  toggleFollow:  (followerId: string, targetId: string) => Promise<void>;
  followerIds:   (userId: string) => string[];
  followingIds:  (userId: string) => string[];
  followerCount: (userId: string) => number;
  followingCount:(userId: string) => number;

  /* -- friend: кэш по просматриваемому userId, источник правды — сервер -- */
  friendCache:   Record<string, FriendsOf | undefined>;
  friendPending: Set<string>;
  fetchFriends:  (userId: string) => Promise<void>;
  friendStatus:      (meId: string, otherId: string) => FriendStatus;
  sendFriendRequest: (fromId: string, toId: string) => Promise<void>;
  removeFriend:       (aId: string, bId: string) => Promise<void>;
  friendIds:          (userId: string) => string[];
  friendCount:        (userId: string) => number;

  /* -- views: сколько раз ПОСМОТРЕЛИ userId — знает только сам userId -- */
  viewCache: Record<string, number | undefined>;
  recordView: (userId: string, viewerId: string) => Promise<void>;
  fetchViewCount: (userId: string) => Promise<void>;
  viewCount:  (userId: string) => number;
}

export const useSocialGraph = create<SocialGraphState>((set, get) => ({
  followCache: {},
  followPending: new Set(),

  fetchFollows: async (userId) => {
    if (!userId || userId in get().followCache || get().followPending.has(userId)) return;
    set((s) => ({ followPending: new Set(s.followPending).add(userId) }));
    const data = await apiFollowsOf(userId);
    set((s) => {
      const pending = new Set(s.followPending);
      pending.delete(userId);
      return { followCache: { ...s.followCache, [userId]: data ?? undefined }, followPending: pending };
    });
  },

  isFollowing: (followerId, targetId) => {
    // Кэш всегда собран относительно текущей сессии (сервер сам знает
    // "я" по токену) — followerId здесь для формы вызова у мест, где он
    // уже под рукой, а не как параметр запроса.
    void followerId;
    return get().followCache[targetId]?.isFollowing ?? false;
  },

  isFollowedBy: (userId, otherId) => get().followCache[otherId]?.following.includes(userId) ?? false,

  toggleFollow: async (followerId, targetId) => {
    if (!followerId || !targetId || followerId === targetId) return;
    const r = await apiToggleFollow(targetId);
    if (!r) return;
    set((s) => {
      const prev = s.followCache[targetId];
      if (!prev) return {};
      const followers = r.following
        ? (prev.followers.includes(followerId) ? prev.followers : [followerId, ...prev.followers])
        : prev.followers.filter((id) => id !== followerId);
      return {
        followCache: {
          ...s.followCache,
          [targetId]: {
            ...prev, isFollowing: r.following, followers,
            followerCount: followers.length,
          },
        },
      };
    });
  },

  followerIds:  (userId) => get().followCache[userId]?.followers ?? [],
  followingIds: (userId) => get().followCache[userId]?.following ?? [],
  followerCount: (userId) => get().followCache[userId]?.followerCount ?? 0,
  followingCount: (userId) => get().followCache[userId]?.followingCount ?? 0,

  friendCache: {},
  friendPending: new Set(),

  fetchFriends: async (userId) => {
    if (!userId || userId in get().friendCache || get().friendPending.has(userId)) return;
    set((s) => ({ friendPending: new Set(s.friendPending).add(userId) }));
    const data = await apiFriendsOf(userId);
    set((s) => {
      const pending = new Set(s.friendPending);
      pending.delete(userId);
      return { friendCache: { ...s.friendCache, [userId]: data ?? undefined }, friendPending: pending };
    });
  },

  friendStatus: (meId, otherId) => {
    void meId; // см. isFollowing выше — сервер сам знает "я" по сессии
    return get().friendCache[otherId]?.status ?? 'none';
  },

  sendFriendRequest: async (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const r = await apiSendFriendRequest(toId);
    if (!r) return;
    set((s) => {
      const prev = s.friendCache[toId];
      const wasFriends = prev?.status === 'friends';
      const nowFriends = r.status === 'friends';
      const friendIds = !prev ? [] :
        nowFriends && !wasFriends ? [fromId, ...prev.friendIds] : prev.friendIds;
      return {
        friendCache: {
          ...s.friendCache,
          [toId]: { status: r.status, friendIds, friendCount: (prev?.friendCount ?? 0) + (nowFriends && !wasFriends ? 1 : 0) },
        },
      };
    });
  },

  removeFriend: async (aId, bId) => {
    if (!aId || !bId) return;
    const r = await apiRemoveFriend(bId);
    if (!r) return;
    set((s) => {
      const prev = s.friendCache[bId];
      if (!prev) return {};
      const wasFriends = prev.status === 'friends';
      return {
        friendCache: {
          ...s.friendCache,
          [bId]: {
            status: 'none',
            friendIds: prev.friendIds.filter((id) => id !== aId),
            friendCount: Math.max(0, prev.friendCount - (wasFriends ? 1 : 0)),
          },
        },
      };
    });
  },

  friendIds:   (userId) => get().friendCache[userId]?.friendIds ?? [],
  friendCount: (userId) => get().friendCache[userId]?.friendCount ?? 0,

  viewCache: {},

  recordView: async (userId, viewerId) => {
    if (!userId || userId === viewerId) return;
    await apiRecordProfileView(userId);
  },

  fetchViewCount: async (userId) => {
    if (!userId || userId in get().viewCache) return;
    const count = await apiProfileViewCount(userId);
    if (count === null) return; // чужая страница — сервер не отдаёт чужие просмотры
    set((s) => ({ viewCache: { ...s.viewCache, [userId]: count } }));
  },

  viewCount: (userId) => get().viewCache[userId] ?? 0,
}));
