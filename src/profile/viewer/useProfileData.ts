/* ===============================================================
   PROFILE VIEWER — агрегатор данных
   Единая точка сборки всего, что показывает полный профиль:
   аккаунт, presence, активность, коллекции, соцсвязи, статистика.
   Каждое поле опирается на реальный стор — ничего не выдумываем;
   там, где данных объективно нет (например, публичного «сейчас
   слушает музыку»), поле просто отсутствует, и секция это учитывает.
=============================================================== */
import { useMemo } from 'react';
import { useAuthStore, type Account } from '@/core/auth/store';
import { useMessengerStore } from '@/messenger/store';
import type { ChatItem } from '@/messenger/types';
import { useBloomStore } from '@/bloom/store';
import type { BloomPost } from '@/bloom/store';
import { useGiftStore, GIFT_CATALOG, type SentGift } from '@/gifts/store';
import { useVideoStore } from '@/video/store';
import type { VideoEntry } from '@/video/store';
import { useGamingAccounts } from '@/gaming/accounts';
import type { GameActivity } from '@/gaming/accounts';
import { useSocialGraph, type FriendStatus } from './social';
import { useProgression } from './progression';
import { activeFrame, type FrameDef } from './cosmetics';
import { useMediaPresence, type MusicPresence, type WatchPresence } from './mediaPresence';

/* -- Последняя история пользователя: читаем тот же localStorage,
      которым пользуется StoriesModule (общий, глобальный ключ). -- */
const STORIES_KEY = 'sky:stories:v3:global';
interface StoryPreview { createdAt: number; kind: 'photo'|'video'|'text'; text?: string; bg: string; }
function readLastStory(userId: string): StoryPreview | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = JSON.parse(localStorage.getItem(STORIES_KEY) || '[]') as any[];
    const mine = raw.filter(s => s.authorId === userId);
    if (!mine.length) return null;
    const cutoff = Date.now() - 24 * 3_600_000;
    const fresh = mine.filter(s => s.createdAt > cutoff).sort((a, b) => b.createdAt - a.createdAt);
    return fresh[0] ?? null;
  } catch { return null; }
}

export type Platform = 'desktop' | 'mobile' | null;
const classifyPlatform = (os?: string): Platform => {
  if (!os) return null;
  return os === 'Android' || os === 'iOS' ? 'mobile' : 'desktop';
};

export interface Presence {
  online:  boolean;
  label:   string;        // «в сети» / «был(а) 3 ч назад» / «давно не заходил(а)»
  platform: Platform;
  visible: boolean;       // учитывает privacy.whoSeesOnline
}

export interface GiftBuckets {
  all:       SentGift[];
  exclusive: SentGift[];
  limited:   SentGift[];
  seasonal:  SentGift[];
}

export interface ProfileData {
  userId:   string;
  account?: Account;
  notFound: boolean;
  isOwn:    boolean;
  viewerId: string;

  presence: Presence;
  frame:    FrameDef;

  relationship: {
    friendStatus:  FriendStatus;
    isFollowing:   boolean;
    isFollowedBy:  boolean;
    isBlocked:     boolean;
    isHidden:      boolean;
  };

  social: {
    friendIds:    string[];
    followerIds:  string[];
    followingIds: string[];
    mutualFriendIds: string[];
    mutualGroups: ChatItem[];
    viewCount:    number;
  };

  activity: {
    gaming:        GameActivity | null;
    recentVideos:  VideoEntry[];
    lastStory:     StoryPreview | null;
    recentPosts:   BloomPost[];
    nowPlaying:    MusicPresence | null;
    nowWatching:   WatchPresence | null;
    canShow:       boolean; // privacy.showActivity
  };

  gifts: GiftBuckets;

  progression: ReturnType<typeof useProgression>;

  stats: {
    postsCount:        number;
    reactionsReceived: number;
    giftsReceived:     number;
    giftsSent:         number;
    messagesWithMe:    number; // честная метрика: переписка именно со мной
    profileViews:      number;
  };
}

export function useProfileData(userId: string | null): ProfileData | null {
  const viewerId  = useAuthStore(s => s.currentUserId) ?? '';
  const accounts  = useAuthStore(s => s.accounts);

  const myChats    = useMessengerStore(s => s.chats);
  const myMessages = useMessengerStore(s => s.messages);
  const blockedList = useMessengerStore(s => s.blocked);

  const posts = useBloomStore(s => s.posts);
  const hidden = useBloomStore(s => s.hidden);

  const sent = useGiftStore(s => s.sent);

  const watchHistory = useVideoStore(s => s.watchHistory);
  const videos       = useVideoStore(s => s.videos);

  const gamingActivity = useGamingAccounts(s => s.activity);

  const follows = useSocialGraph(s => s.follows);
  const friends = useSocialGraph(s => s.friends);
  const views   = useSocialGraph(s => s.views);

  const musicPresenceMap = useMediaPresence(s => s.music);
  const watchPresenceMap = useMediaPresence(s => s.watch);

  const account = useMemo(() => accounts.find(a => a.id === userId), [accounts, userId]);
  const progression = useProgression(userId ?? '', account);

  return useMemo<ProfileData | null>(() => {
    if (!userId) return null;
    const isOwn = userId === viewerId;

    if (!account) {
      return {
        userId, notFound: true, isOwn, viewerId,
        presence: { online: false, label: '', platform: null, visible: false },
        frame: activeFrame(undefined),
        relationship: { friendStatus: 'none', isFollowing: false, isFollowedBy: false, isBlocked: false, isHidden: false },
        social: { friendIds: [], followerIds: [], followingIds: [], mutualFriendIds: [], mutualGroups: [], viewCount: 0 },
        activity: { gaming: null, recentVideos: [], lastStory: null, recentPosts: [], nowPlaying: null, nowWatching: null, canShow: false },
        gifts: { all: [], exclusive: [], limited: [], seasonal: [] },
        progression,
        stats: { postsCount: 0, reactionsReceived: 0, giftsReceived: 0, giftsSent: 0, messagesWithMe: 0, profileViews: 0 },
      };
    }

    /* -- presence -- */
    const whoSeesOnline = account.privacy?.whoSeesOnline ?? 'all';
    const latestDevice = [...(account.devices ?? [])].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0];
    const online = isOwn ? true : !!latestDevice?.isCurrent;
    const lastSeenMs = latestDevice ? new Date(latestDevice.lastSeen).getTime() : 0;
    const minsAgo = lastSeenMs ? Math.max(0, Math.round((Date.now() - lastSeenMs) / 60000)) : null;
    const label = online
      ? 'в сети'
      : minsAgo === null ? 'давно не заходил(а)'
      : minsAgo < 1 ? 'только что была(а)'
      : minsAgo < 60 ? `был(а) ${minsAgo} мин назад`
      : minsAgo < 1440 ? `был(а) ${Math.round(minsAgo / 60)} ч назад`
      : `был(а) ${Math.round(minsAgo / 1440)} дн назад`;
    const presenceVisible = isOwn || whoSeesOnline === 'all';
    const presence: Presence = { online, label, platform: classifyPlatform(latestDevice?.os), visible: presenceVisible };

    /* -- relationship -- */
    const friendStatus = useSocialGraph.getState().friendStatus(viewerId, userId);
    const isFollowing  = follows.some(e => e.followerId === viewerId && e.followingId === userId);
    const isFollowedBy = follows.some(e => e.followerId === userId && e.followingId === viewerId);
    const isBlocked = blockedList.includes(account.username);
    const isHidden  = hidden.has(userId);

    /* -- social lists (гранулярная приватность: друзья / подписки) -- */
    const canSeeFriends    = isOwn || (account.privacy?.showFriends ?? true);
    const canSeeFollowing  = isOwn || (account.privacy?.showFollowing ?? true);
    const friendIds    = canSeeFriends   ? friends.filter(e => e.status === 'accepted' && (e.aId === userId || e.bId === userId)).map(e => e.aId === userId ? e.bId : e.aId) : [];
    const followerIds  = canSeeFollowing ? follows.filter(e => e.followingId === userId).map(e => e.followerId) : [];
    const followingIds = canSeeFollowing ? follows.filter(e => e.followerId === userId).map(e => e.followingId) : [];
    const myFriendIds  = friends.filter(e => e.status === 'accepted' && (e.aId === viewerId || e.bId === viewerId)).map(e => e.aId === viewerId ? e.bId : e.aId);
    const mutualFriendIds = friendIds.filter(id => myFriendIds.includes(id));
    const mutualGroups = myChats.filter(c =>
      c.type !== 'direct' && (c.participants ?? []).includes(userId) && (c.participants ?? []).includes(viewerId),
    );
    const viewCount = views[userId] ?? 0;

    /* -- activity (гранулярная приватность по каждому виду данных) -- */
    const canSee = (key: 'showGames'|'showMusic'|'showMovies'|'showGifts'|'showAchievements'|'showFollowing'|'showFriends'|'showPhotos'|'showStories'|'showPosts') =>
      isOwn || (account.privacy?.[key] ?? true);
    const showActivity = isOwn || (account.privacy?.showActivity ?? true);
    const recentVideos = showActivity && canSee('showMovies') ? (watchHistory[userId] ?? []).slice(0, 6).map(id => videos.find(v => v.id === id)).filter((v): v is VideoEntry => !!v) : [];
    const lastStory = showActivity && canSee('showStories') ? readLastStory(userId) : null;
    const recentPosts = canSee('showPosts') ? posts.filter(p => p.authorId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3) : [];
    const gaming = (showActivity && canSee('showGames')) ? (gamingActivity[userId] ?? null) : null;
    const freshMusic = musicPresenceMap[userId];
    const freshWatch = watchPresenceMap[userId];
    const nowPlaying = (showActivity && canSee('showMusic') && freshMusic && Date.now() - freshMusic.updatedAt < 120_000) ? freshMusic : null;
    const nowWatching = (showActivity && canSee('showMovies') && freshWatch && Date.now() - freshWatch.updatedAt < 120_000) ? freshWatch : null;

    /* -- gifts -- */
    const myGifts = canSee('showGifts') ? sent.filter(g => g.toId === userId && g.savedToProfile).sort((a, b) => b.sentAt.localeCompare(a.sentAt)) : [];
    const catalogOf = (g: SentGift) => GIFT_CATALOG.find(c => c.id === g.giftId);
    const gifts: GiftBuckets = {
      all: myGifts,
      exclusive: myGifts.filter(g => g.giftRarity === 'legendary' || g.giftRarity === 'unique'),
      limited:   myGifts.filter(g => (catalogOf(g)?.available ?? -1) !== -1),
      seasonal:  myGifts.filter(g => !!catalogOf(g)?.seasonal),
    };

    /* -- stats -- */
    const dmWithTarget = myChats.find(c => c.type === 'direct' && (c.participants ?? []).includes(userId));
    const messagesWithMe = dmWithTarget ? myMessages.filter(m => m.chatId === dmWithTarget.id && !m.deleted).length : 0;

    return {
      userId, account, notFound: false, isOwn, viewerId,
      presence,
      frame: activeFrame(account),
      relationship: { friendStatus, isFollowing, isFollowedBy, isBlocked, isHidden },
      social: { friendIds, followerIds, followingIds, mutualFriendIds, mutualGroups, viewCount },
      activity: { gaming, recentVideos, lastStory, recentPosts, nowPlaying, nowWatching, canShow: showActivity },
      gifts,
      progression: canSee('showAchievements') ? progression : { ...progression, achievements: [] },
      stats: {
        postsCount: progression.postsCount,
        reactionsReceived: progression.reactionsReceived,
        giftsReceived: progression.giftsReceived,
        giftsSent: progression.giftsSent,
        messagesWithMe,
        profileViews: viewCount,
      },
    };
  }, [
    userId, viewerId, account, myChats, myMessages, blockedList, posts, hidden, sent,
    watchHistory, videos, gamingActivity, follows, friends, views, progression, musicPresenceMap, watchPresenceMap,
  ]);
}
