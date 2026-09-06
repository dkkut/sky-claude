/* ===============================================================
   PROFILE SOCIAL GRAPH
   Два независимых, но согласованных отношения между аккаунтами:

   • Follow  — одностороннее «подписаться», как в Bloom-ленте.
     У bloom/store.ts уже есть свой Set (following) — он остаётся
     единственным источником для алгоритма ленты и не трогается;
     здесь мы просто параллельно ведём двунаправленный граф
     (нужен, чтобы знать подписчиков ЧУЖОГО профиля, а не только
     свои подписки) и держим оба списка в согласованном состоянии
     через toggleFollow.

   • Friend  — двусторонняя дружба с заявкой/подтверждением,
     отдельно от подписки (как и просил бриф: «добавить в друзья»
     и «подписаться» — разные действия).
=============================================================== */
import { create } from 'zustand';
import { useBloomStore } from '@/bloom/store';

export interface FollowEdge { followerId: string; followingId: string; createdAt: string; }
export interface FriendEdge { aId: string; bId: string; requestedBy: string; status: 'pending' | 'accepted'; createdAt: string; }

export type FriendStatus = 'none' | 'pending_out' | 'pending_in' | 'friends';

const W = typeof window !== 'undefined';
const FOLLOW_KEY = 'sky:profile:follows:v1';
const FRIEND_KEY = 'sky:profile:friends:v1';
const VIEWS_KEY  = 'sky:profile:views:v1';

const now = () => new Date().toISOString();
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

/* Немного правдоподобных стартовых связей между демо-аккаунтами,
   чтобы раздел «Социальное» не пустовал при первом запуске —
   в духе остальных SEED_* констант в проекте. */
const SEED_FOLLOWS: FollowEdge[] = [
  { followerId: 'acc-luna',     followingId: 'acc-kutuzov', createdAt: ago(41) },
  { followerId: 'acc-neo',      followingId: 'acc-kutuzov', createdAt: ago(33) },
  { followerId: 'acc-kutuzov',  followingId: 'acc-luna',    createdAt: ago(40) },
  { followerId: 'acc-neo',      followingId: 'acc-luna',    createdAt: ago(19) },
  { followerId: 'acc-kutuzov',  followingId: 'acc-neo',     createdAt: ago(12) },
];

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
  follows: FollowEdge[];
  friends: FriendEdge[];
  views:   Record<string, number>;

  /* -- follow -- */
  isFollowing:  (followerId: string, targetId: string) => boolean;
  toggleFollow: (followerId: string, targetId: string) => void;
  followerIds:  (userId: string) => string[];
  followingIds: (userId: string) => string[];

  /* -- friend -- */
  friendStatus:      (meId: string, otherId: string) => FriendStatus;
  sendFriendRequest: (fromId: string, toId: string) => void;
  removeFriend:       (aId: string, bId: string) => void;
  friendIds:          (userId: string) => string[];

  /* -- views -- */
  recordView: (userId: string, viewerId: string) => void;
  viewCount:  (userId: string) => number;
}

export const useSocialGraph = create<SocialGraphState>((set, get) => ({
  follows: load(FOLLOW_KEY, SEED_FOLLOWS),
  friends: load(FRIEND_KEY, SEED_FRIENDS),
  views:   load(VIEWS_KEY, {} as Record<string, number>),

  isFollowing: (followerId, targetId) =>
    get().follows.some(e => e.followerId === followerId && e.followingId === targetId),

  toggleFollow: (followerId, targetId) => {
    if (!followerId || !targetId || followerId === targetId) return;
    const { follows } = get();
    const already = follows.some(e => e.followerId === followerId && e.followingId === targetId);
    const next = already
      ? follows.filter(e => !(e.followerId === followerId && e.followingId === targetId))
      : [...follows, { followerId, followingId: targetId, createdAt: now() }];
    persist(FOLLOW_KEY, next);
    set({ follows: next });
    // Bloom ведёт свой отдельный список для алгоритма ленты — держим его синхронным
    // с действием, совершённым здесь (подписка из профиля = подписка в ленте).
    if (useBloomStore.getState().following.has(targetId) !== !already) {
      useBloomStore.getState().toggleFollow(targetId);
    }
  },

  followerIds:  (userId) => get().follows.filter(e => e.followingId === userId).map(e => e.followerId),
  followingIds: (userId) => get().follows.filter(e => e.followerId  === userId).map(e => e.followingId),

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

  recordView: (userId, viewerId) => {
    if (!userId || userId === viewerId) return;
    const next = { ...get().views, [userId]: (get().views[userId] ?? 0) + 1 };
    persist(VIEWS_KEY, next);
    set({ views: next });
  },

  viewCount: (userId) => get().views[userId] ?? 0,
}));
