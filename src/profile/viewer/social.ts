/* ===============================================================
   PROFILE SOCIAL GRAPH
   Два независимых, но согласованных отношения между аккаунтами:

   • Follow  — одностороннее «подписаться». Раньше жило в трёх
     независимых копиях (эта общая, у Bloom-ленты, у SkyVideo-канала)
     в localStorage и вручную синхронизировалось между ними. Теперь
     это одна настоящая таблица на сервере (server/follows.mjs) —
     кэш здесь только в памяти вкладки, как чужие профили в
     otherProfiles.ts.

   • Friend  — двусторонняя дружба с заявкой/подтверждением, отдельно
     от подписки (как и просил бриф: «добавить в друзья» и
     «подписаться» — разные действия). Это вне Bloom и осталось
     локальным, как было.
=============================================================== */
import { create } from 'zustand';
import { apiFollowsOf, apiToggleFollow, type FollowsOf } from './followsApi';

export interface FriendEdge { aId: string; bId: string; requestedBy: string; status: 'pending' | 'accepted'; createdAt: string; }

export type FriendStatus = 'none' | 'pending_out' | 'pending_in' | 'friends';

const W = typeof window !== 'undefined';
const FRIEND_KEY = 'sky:profile:friends:v1';
const VIEWS_KEY  = 'sky:profile:views:v1';

const now = () => new Date().toISOString();
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

const SEED_FRIENDS: FriendEdge[] = [
  { aId: 'acc-kutuzov', bId: 'acc-luna', requestedBy: 'acc-luna', status: 'accepted', createdAt: ago(38) },
];

function load<T>(key: string, seed: T): T {
  if (!W) return seed;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return seed;
    return JSON.parse(raw) as T;
  } catch { return seed; }
}
function persist<T>(key: string, value: T) {
  if (!W) return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / privacy mode */ }
}
const pairKey = (a: string, b: string) => [a, b].sort().join('::');

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

  /* -- friend -- */
  friends: FriendEdge[];
  friendStatus:      (meId: string, otherId: string) => FriendStatus;
  sendFriendRequest: (fromId: string, toId: string) => void;
  removeFriend:       (aId: string, bId: string) => void;
  friendIds:          (userId: string) => string[];

  /* -- views -- */
  views: Record<string, number>;
  recordView: (userId: string, viewerId: string) => void;
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

  friends: load(FRIEND_KEY, SEED_FRIENDS),

  friendStatus: (meId, otherId) => {
    const edge = get().friends.find(e => pairKey(e.aId, e.bId) === pairKey(meId, otherId));
    if (!edge) return 'none';
    if (edge.status === 'accepted') return 'friends';
    return edge.requestedBy === meId ? 'pending_out' : 'pending_in';
  },

  sendFriendRequest: (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const { friends } = get();
    const key = pairKey(fromId, toId);
    const existing = friends.find(e => pairKey(e.aId, e.bId) === key);
    let next: FriendEdge[];
    if (!existing) {
      next = [...friends, { aId: fromId, bId: toId, requestedBy: fromId, status: 'pending', createdAt: now() }];
    } else if (existing.status === 'pending' && existing.requestedBy !== fromId) {
      // встречная заявка уже была отправлена нам — принимаем её
      next = friends.map(e => e === existing ? { ...e, status: 'accepted' as const } : e);
    } else {
      return; // заявка уже отправлена нами / уже друзья
    }
    persist(FRIEND_KEY, next);
    set({ friends: next });
  },

  removeFriend: (aId, bId) => {
    const key = pairKey(aId, bId);
    const next = get().friends.filter(e => pairKey(e.aId, e.bId) !== key);
    persist(FRIEND_KEY, next);
    set({ friends: next });
  },

  friendIds: (userId) => get().friends
    .filter(e => e.status === 'accepted' && (e.aId === userId || e.bId === userId))
    .map(e => e.aId === userId ? e.bId : e.aId),

  views: load(VIEWS_KEY, {} as Record<string, number>),

  recordView: (userId, viewerId) => {
    if (!userId || userId === viewerId) return;
    const next = { ...get().views, [userId]: (get().views[userId] ?? 0) + 1 };
    persist(VIEWS_KEY, next);
    set({ views: next });
  },

  viewCount: (userId) => get().views[userId] ?? 0,
}));
