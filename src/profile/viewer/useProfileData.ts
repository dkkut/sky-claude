/* ===============================================================
   PROFILE VIEWER — агрегатор данных
   Единая точка сборки всего, что показывает полный профиль:
   аккаунт, presence, активность, коллекции, соцсвязи, статистика.
   Каждое поле опирается на реальный стор — ничего не выдумываем;
   там, где данных объективно нет (например, публичного «сейчас
   слушает музыку»), поле просто отсутствует, и секция это учитывает.
=============================================================== */
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore, type Account } from '@/core/auth/store';
import type { PublicProfile } from '@/core/auth/api';
import { useOtherProfiles } from './otherProfiles';
import { useMessengerStore } from '@/messenger/store';
import type { ChatItem } from '@/messenger/types';
import { useBloomStore } from '@/bloom/store';
import type { BloomPost } from '@/bloom/store';
import { useGiftStore, GIFT_CATALOG, type SentGift } from '@/gifts/store';
import { apiPublicProfileGifts, toSentGift } from '@/gifts/giftsApi';
import { useGamingAccounts } from '@/gaming/accounts';
import { watchGamePresence } from '@/gaming/gameSync';
import type { GameActivity } from '@/gaming/accounts';
import { useSocialGraph, type FriendStatus } from './social';
import { useProgression } from './progression';
import { activeFrame, type FrameDef } from './cosmetics';
import { usePeerCosmetics } from '@/customization/store';
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

/** Профиль, отданный ручкой /api/skyid/profile/:id, в форме локального Account. */
const toAccountFromPublic = (p: PublicProfile): Account => ({
  id: p.id, name: p.name, username: p.username, phone: '',
  avatar: p.avatar, isAdmin: p.isAdmin, isPrime: p.isPrime, primeUntil: p.primeUntil,
  createdAt: p.createdAt, privacy: p.privacy,
  // Косметика расширенного профиля — раньше publicProfile() их не
  // отдавал вовсе, и то, что человек настраивал у себя (баннер,
  // цвет ника, стикер, статус, ссылки, страна/часовой пояс/язык,
  // день рождения), другие никогда не видели.
  bio: p.bio, banner: p.banner, nameSticker: p.nameSticker, nameColor: p.nameColor,
  customStatus: p.customStatus, statusEmoji: p.statusEmoji, links: p.links,
  country: p.country, language: p.language, timezone: p.timezone, birthDate: p.birthDate,
});

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
  loading:  boolean;
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
  const cosmeticsVersion = usePeerCosmetics([userId]);
  const viewerId  = useAuthStore(s => s.currentUserId) ?? '';
  const accounts  = useAuthStore(s => s.accounts);

  const myChats    = useMessengerStore(s => s.chats);
  const myMessages = useMessengerStore(s => s.messages);
  const blockedList = useMessengerStore(s => s.blocked);

  const authorPostsRaw = useBloomStore(s => (userId ? s.authorPostsCache[userId] : undefined));
  const authorPosts = useMemo(() => authorPostsRaw ?? [], [authorPostsRaw]);
  const loadAuthorPosts = useBloomStore(s => s.loadAuthorPosts);
  const hiddenIds = useBloomStore(s => s.hiddenIds);
  const loadHidden = useBloomStore(s => s.loadHidden);

  const sent = useGiftStore(s => s.sent);

  // Подарки в профиле — серверные: «сохранить в профиль» и получение
  // подарка пишутся на сервере, а локальный список `sent` знает только
  // то, что отправлено с этого устройства, поэтому у получателя и у всех
  // зрителей раздел всегда был пустым.
  const [serverGifts, setServerGifts] = useState<{ userId: string; hidden: boolean; items: SentGift[] } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = () => apiPublicProfileGifts(userId).then((r) => {
      if (alive) setServerGifts({ userId, hidden: r.hidden, items: r.items.map(toSentGift) });
    });
    void load();
    // Подарок могли сохранить в профиль на другой вкладке или устройстве.
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { alive = false; window.removeEventListener('focus', onFocus); };
  }, [userId, sent.length]);

  const gamingActivity = useGamingAccounts(s => s.activity);
  useEffect(() => { if (userId) { watchGamePresence(userId); void useGamingAccounts.getState().refreshPresence([userId]); } }, [userId]);

  const followEntry = useSocialGraph(s => (userId ? s.followCache[userId] : undefined));
  const fetchFollows = useSocialGraph(s => s.fetchFollows);
  // Друзья — кэш по каждому userId, источник правды сервер (см.
  // social.ts). Для «общих друзей» нужен ещё и мой собственный список,
  // поэтому просим сразу за обоих.
  const targetFriends = useSocialGraph(s => (userId ? s.friendCache[userId] : undefined));
  const myFriends     = useSocialGraph(s => (viewerId ? s.friendCache[viewerId] : undefined));
  const fetchFriends  = useSocialGraph(s => s.fetchFriends);
  const viewCount = useSocialGraph(s => (userId ? s.viewCache[userId] : undefined)) ?? 0;
  const fetchViewCount = useSocialGraph(s => s.fetchViewCount);

  useEffect(() => {
    if (userId) void fetchFollows(userId);
  }, [userId, fetchFollows]);

  useEffect(() => {
    if (userId) void fetchFriends(userId);
    if (viewerId) void fetchFriends(viewerId);
  }, [userId, viewerId, fetchFriends]);

  useEffect(() => {
    if (userId && userId === viewerId) void fetchViewCount(userId);
  }, [userId, viewerId, fetchViewCount]);

  useEffect(() => {
    if (userId) void loadAuthorPosts(userId);
  }, [userId, loadAuthorPosts]);

  useEffect(() => { void loadHidden(); }, [loadHidden]);

  const musicPresenceMap = useMediaPresence(s => s.music);
  const watchPresenceMap = useMediaPresence(s => s.watch);

  const ownAccount = useMemo(() => accounts.find(a => a.id === userId), [accounts, userId]);

  // Чужой профиль своего Sky ID не бывает — его нет в accounts, он
  // приходит отдельной ручкой и живёт в своём кэше. Просим его, как
  // только видим id, которого нет ни среди своих, ни в кэше.
  const otherEntry = useOtherProfiles(s => (userId ? s.byId[userId] : undefined));
  const fetchOther = useOtherProfiles(s => s.fetch);
  useEffect(() => {
    if (userId && userId !== viewerId && !ownAccount) void fetchOther(userId);
  }, [userId, viewerId, ownAccount, fetchOther]);

  const account = useMemo(
    () => ownAccount ?? (otherEntry ? toAccountFromPublic(otherEntry) : undefined),
    [ownAccount, otherEntry],
  );
  // Чужой профиль ещё не отвечен сервером — это "загружается", а не
  // "не найден": otherEntry === undefined значит только "мы его ещё не
  // спросили или ждём ответ", а не что его нет (это даёт только null).
  const loading = !!userId && userId !== viewerId && !ownAccount && otherEntry === undefined;
  const progression = useProgression(userId ?? '', account);

  return useMemo<ProfileData | null>(() => {
    if (!userId) return null;
    const isOwn = userId === viewerId;

    if (!account) {
      return {
        userId, notFound: !loading, loading, isOwn, viewerId,
        presence: { online: false, label: '', platform: null, visible: false },
        frame: activeFrame(undefined),
        relationship: { friendStatus: 'none', isFollowing: false, isFollowedBy: false, isBlocked: false, isHidden: false },
        social: { friendIds: [], followerIds: [], followingIds: [], mutualFriendIds: [], mutualGroups: [], viewCount: 0 },
        activity: { gaming: null, lastStory: null, recentPosts: [], nowPlaying: null, nowWatching: null, canShow: false },
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
    const isFollowing  = followEntry?.isFollowing ?? false;
    const isFollowedBy = followEntry?.following.includes(viewerId) ?? false;
    const isBlocked = blockedList.includes(account.username);
    const isHidden  = hiddenIds.has(userId);

    /* -- social lists: друзья и подписки уже отфильтрованы сервером по
       privacy.profileVisibility (showFriends / showFollowing — см.
       server/routes/friends.mjs и server/routes/follows.mjs), здесь
       только читаем то, что он посчитал нужным отдать. -- */
    const friendIds    = targetFriends?.friendIds ?? [];
    const followerIds  = followEntry?.followers ?? [];
    const followingIds = followEntry?.following ?? [];
    const myFriendIds  = myFriends?.friendIds ?? [];
    const mutualFriendIds = friendIds.filter(id => myFriendIds.includes(id));
    const mutualGroups = myChats.filter(c =>
      c.type !== 'direct' && (c.participants ?? []).includes(userId) && (c.participants ?? []).includes(viewerId),
    );

    /* -- activity (гранулярная приватность по каждому виду данных) -- */
    const canSee = (key: 'showGames'|'showMusic'|'showMovies'|'showGifts'|'showAchievements'|'showFollowing'|'showFriends'|'showPhotos'|'showStories'|'showPosts') =>
      isOwn || (account.privacy?.[key] ?? true);
    const showActivity = isOwn || (account.privacy?.showActivity ?? true);
    const lastStory = showActivity && canSee('showStories') ? readLastStory(userId) : null;
    const recentPosts = canSee('showPosts') ? authorPosts.slice(0, 3) : [];
    const gaming = (showActivity && canSee('showGames')) ? (gamingActivity[userId] ?? null) : null;
    const freshMusic = musicPresenceMap[userId];
    const freshWatch = watchPresenceMap[userId];
    const nowPlaying = (showActivity && canSee('showMusic') && freshMusic && Date.now() - freshMusic.updatedAt < 120_000) ? freshMusic : null;
    const nowWatching = (showActivity && canSee('showMovies') && freshWatch && Date.now() - freshWatch.updatedAt < 120_000) ? freshWatch : null;

    /* -- gifts -- */
    const fromServer = serverGifts && serverGifts.userId === userId ? serverGifts : null;
    const myGifts = fromServer
      ? (fromServer.hidden && !isOwn ? [] : [...fromServer.items].sort((a, b) => b.sentAt.localeCompare(a.sentAt)))
      : canSee('showGifts') ? sent.filter(g => g.toId === userId && g.savedToProfile).sort((a, b) => b.sentAt.localeCompare(a.sentAt)) : [];
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
      userId, account, notFound: false, loading: false, isOwn, viewerId,
      presence,
      frame: activeFrame(account),
      relationship: { friendStatus, isFollowing, isFollowedBy, isBlocked, isHidden },
      social: { friendIds, followerIds, followingIds, mutualFriendIds, mutualGroups, viewCount },
      activity: { gaming, lastStory, recentPosts, nowPlaying, nowWatching, canShow: showActivity },
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
    userId, viewerId, account, loading, myChats, myMessages, blockedList, authorPosts, hiddenIds, sent,
    gamingActivity, followEntry, targetFriends, myFriends, viewCount, progression, musicPresenceMap, watchPresenceMap, serverGifts, cosmeticsVersion,
  ]);
}
