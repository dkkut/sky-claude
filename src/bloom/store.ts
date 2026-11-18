/* ===========================================================
   BLOOM STORE  -  реальная социальная лента на сервере.

   Ничего здесь не решается на клиенте: кто автор, чей это пост,
   сколько стоит подарок, кому что видно — всё решает сервер
   (server/bloom.mjs). Стор только кэширует ответы и зовёт ручки.

   Компоненты раньше читали ленту синхронной функцией feed(tab) —
   теперь это сеть, поэтому стор хранит уже загруженное по вкладкам
   (feedCache) и по тегам (tagCache), а компоненты вызывают load*
   в useEffect и читают закэшированное.
============================================================ */
import { create } from 'zustand';
import { apiCall } from '@/core/auth/api';
import { useAuthStore } from '@/core/auth/store';
import { useMoney } from '@/wallet/store';
import type { Rarity } from '@/gifts/types';
import {
  apiBloomFeed, apiBloomAuthorPosts, apiBloomGetPost, apiBloomTrending, apiBloomSuggested, apiBloomHotComments,
  apiBloomNotifCount, apiBloomUploadMedia, apiBloomCreatePost, apiBloomDeletePost, apiBloomEditPost,
  apiBloomReact, apiBloomComment, apiBloomDeleteComment, apiBloomLikeComment,
  apiBloomToggleSave, apiBloomRepost, apiBloomView, apiBloomVote, apiBloomGift,
  apiBloomHidden, apiBloomToggleHide, apiBloomWrite,
  type CreatePostInput,
} from './bloomApi';

export type PostKind    = 'text'|'photo'|'video';
export type ReactionKey = '❤️'|'🔥'|'😂'|'😮'|'👏'|'💯'|'🎉'|'🤔';
export const REACTIONS: ReactionKey[] = ['❤️','🔥','😂','😮','👏','💯','🎉','🤔'];

/* Небольшой каталог «социальных» подарков для комментариев Bloom —
   визуал переиспользует GiftBadge/GIFT_MODELS из NFT-модуля, но это
   лёгкие decorative-подарки, без связи с владением настоящими NFT.
   Оплачиваются баллами Prime (тот же баланс, что в разделе Sky Prime);
   каталог и цены должны совпадать с server/bloom.mjs GIFT_CATALOG. */
export interface BloomGiftOption { modelKey: string; label: string; rarity: Rarity; cost: number; }
export const BLOOM_GIFT_CATALOG: BloomGiftOption[] = [
  { modelKey:'heart',  label:'Сердце',    rarity:'common',    cost:10   },
  { modelKey:'flower', label:'Цветок',    rarity:'uncommon',  cost:25   },
  { modelKey:'party',  label:'Праздник',  rarity:'rare',      cost:50   },
  { modelKey:'star',   label:'Звезда',    rarity:'epic',      cost:100  },
  { modelKey:'trophy', label:'Кубок',     rarity:'legendary', cost:250  },
  { modelKey:'crown',  label:'Корона',    rarity:'mythic',    cost:500  },
  { modelKey:'gem',    label:'Кристалл',  rarity:'divine',    cost:1000 },
  { modelKey:'rocket', label:'Ракета',    rarity:'limited',   cost:750  },
];

export interface PostReaction { emoji: ReactionKey; userIds: string[]; }

export interface BloomComment {
  id: string; authorId: string; authorName: string; authorAvatar?: string;
  text: string; likes: string[]; createdAt: string;
  gift?: { modelKey: string; rarity: Rarity };
}

export interface BloomPollOption { id: string; label: string; votes: string[]; }
export interface BloomPoll { question: string; options: BloomPollOption[]; }

export interface BloomPost {
  id: string; authorId: string; authorName: string; authorUsername: string;
  kind: PostKind; text: string; mediaUrl?: string; mediaAspect?: number;
  reactions: PostReaction[]; comments: BloomComment[]; saved: string[];
  reposts: number; repostedByMe?: boolean; views: number; createdAt: string; tags: string[];
  isPinned?: boolean; location?: string; poll?: BloomPoll;
  title?: string; isBlog?: boolean; isAd?: boolean; adNote?: string; editedAt?: string;
  communityId?: string; communitySlug?: string; communityName?: string; communityEmoji?: string; communityPinned?: boolean;
}

export type FeedTab = 'algo'|'fresh'|'saved'|'mine';
const FEED_TABS: FeedTab[] = ['algo', 'fresh', 'saved', 'mine'];

/* -- Патч поста во всех загруженных кэшах разом (вкладки + теги + чужие профили) -- */
const mapCache = (posts: BloomPost[] | undefined, postId: string, fn: (p: BloomPost) => BloomPost) =>
  posts?.map(p => p.id === postId ? fn(p) : p);

interface BloomState {
  feedCache:   Partial<Record<FeedTab, BloomPost[]>>;
  feedLoading: Partial<Record<FeedTab, boolean>>;
  tagCache:    Record<string, BloomPost[]>;
  tagLoading:  Record<string, boolean>;
  authorPostsCache: Record<string, BloomPost[]>;
  /** Отдельный пост, открытый напрямую (уведомление, ссылка) и не
   *  найденный ни в одном уже загруженном кэше. */
  postCache: Record<string, BloomPost>;

  trendingTags:   string[][];
  trendingLoaded: boolean;
  suggested:      string[];
  suggestedLoaded:boolean;
  hot:            { post: BloomPost; comment: BloomComment }[];
  hotLoaded:      boolean;
  notifCount:     number;
  hiddenIds:      Set<string>;
  hiddenLoaded:   boolean;

  /** Растёт при любом действии, меняющем состав постов в вкладках
   *  (новый пост, удаление, скрыть автора) — компоненты держат его
   *  в зависимостях useEffect, чтобы перезагрузить активную вкладку. */
  feedVersion: number;

  loadFeed:       (tab: FeedTab, force?: boolean) => Promise<void>;
  loadTag:        (tag: string, force?: boolean) => Promise<void>;
  loadAuthorPosts:(authorId: string, force?: boolean) => Promise<void>;
  /** Посты сообщества лежат в authorPostsCache под ключом `c:<id>` — так их патчат те же реакции/комментарии, что и везде. */
  loadCommunityPosts:(communityId: string) => Promise<boolean>;
  /** Найти пост в уже загруженных кэшах; если нигде нет — попросить сервер. */
  loadPost:       (postId: string) => Promise<void>;
  loadTrending:   (force?: boolean) => Promise<void>;
  loadSuggested:  (force?: boolean) => Promise<void>;
  loadHot:        (force?: boolean) => Promise<void>;
  loadNotifCount: () => Promise<void>;
  loadHidden:     (force?: boolean) => Promise<void>;

  addPost:      (input: Omit<CreatePostInput, 'mediaId'|'mediaMime'>, mediaFile?: File) => Promise<boolean>;
  deletePost:   (id: string) => Promise<void>;
  editPost:     (id: string, patch: { text?: string; title?: string; isAd?: boolean; adNote?: string }) => Promise<string | null>;
  react:        (postId: string, emoji: ReactionKey) => Promise<void>;
  addComment:   (postId: string, text: string) => Promise<void>;
  deleteComment:(postId: string, commentId: string) => Promise<void>;
  likeComment:  (postId: string, commentId: string) => Promise<void>;
  toggleSave:   (postId: string) => Promise<void>;
  repost:       (postId: string) => Promise<void>;
  incView:      (postId: string) => Promise<void>;
  votePoll:     (postId: string, optionId: string) => Promise<void>;
  sendGift:     (toId: string, postId: string, modelKey: string) => Promise<boolean>;
  toggleHide:   (authorId: string) => Promise<void>;
  writeTo:      (userId: string) => Promise<{ chatId: string } | { error: string }>;
}

export const useBloomStore = create<BloomState>((set, get) => {
  /** Применить fn к посту postId во всех кэшах разом (вкладки, теги, авторские подборки). */
  const patchEverywhere = (postId: string, fn: (p: BloomPost) => BloomPost) => {
    set(s => ({
      feedCache: Object.fromEntries(
        FEED_TABS.map(tab => [tab, mapCache(s.feedCache[tab], postId, fn) ?? s.feedCache[tab]]),
      ) as Partial<Record<FeedTab, BloomPost[]>>,
      tagCache: Object.fromEntries(
        Object.entries(s.tagCache).map(([tag, posts]) => [tag, mapCache(posts, postId, fn) ?? posts]),
      ),
      authorPostsCache: Object.fromEntries(
        Object.entries(s.authorPostsCache).map(([id, posts]) => [id, mapCache(posts, postId, fn) ?? posts]),
      ),
      postCache: s.postCache[postId] ? { ...s.postCache, [postId]: fn(s.postCache[postId]) } : s.postCache,
    }));
  };

  /** Пост уже где-то закэширован — не ходим на сервер второй раз. */
  const findCachedPost = (postId: string): BloomPost | undefined => {
    const s = get();
    for (const tab of FEED_TABS) {
      const hit = s.feedCache[tab]?.find(p => p.id === postId);
      if (hit) return hit;
    }
    for (const posts of Object.values(s.tagCache)) {
      const hit = posts.find(p => p.id === postId);
      if (hit) return hit;
    }
    for (const posts of Object.values(s.authorPostsCache)) {
      const hit = posts.find(p => p.id === postId);
      if (hit) return hit;
    }
    return s.postCache[postId];
  };

  /** Действие изменило состав постов в лентах (новый/удалён/скрыт автор) —
   *  сбрасываем кэш вкладок и тегов, компоненты перезагрузят активную вкладку. */
  const invalidateFeeds = () => set(s => ({
    feedCache: {}, tagCache: {}, authorPostsCache: {}, postCache: {},
    trendingLoaded: false, suggestedLoaded: false, hotLoaded: false,
    feedVersion: s.feedVersion + 1,
  }));

  return {
    feedCache: {}, feedLoading: {},
    tagCache: {}, tagLoading: {},
    authorPostsCache: {},
    postCache: {},
    trendingTags: [], trendingLoaded: false,
    suggested: [], suggestedLoaded: false,
    hot: [], hotLoaded: false,
    notifCount: 0,
    hiddenIds: new Set<string>(), hiddenLoaded: false,
    feedVersion: 0,

    loadFeed: async (tab, force) => {
      if (!force && (get().feedCache[tab] || get().feedLoading[tab])) return;
      set(s => ({ feedLoading: { ...s.feedLoading, [tab]: true } }));
      const posts = await apiBloomFeed(tab);
      set(s => ({ feedCache: { ...s.feedCache, [tab]: posts }, feedLoading: { ...s.feedLoading, [tab]: false } }));
    },

    loadTag: async (tag, force) => {
      if (!force && (get().tagCache[tag] || get().tagLoading[tag])) return;
      set(s => ({ tagLoading: { ...s.tagLoading, [tag]: true } }));
      const posts = await apiBloomFeed('fresh', tag);
      set(s => ({ tagCache: { ...s.tagCache, [tag]: posts }, tagLoading: { ...s.tagLoading, [tag]: false } }));
    },

    loadAuthorPosts: async (authorId, force) => {
      if (!force && get().authorPostsCache[authorId]) return;
      const posts = await apiBloomAuthorPosts(authorId);
      set(s => ({ authorPostsCache: { ...s.authorPostsCache, [authorId]: posts } }));
    },

    loadCommunityPosts: async (communityId) => {
      const r = await apiCall<{ posts: BloomPost[]; contentVisible: boolean }>(`/api/bloom/communities/${encodeURIComponent(communityId)}/posts`);
      if (!r.ok) return false;
      set(s => ({ authorPostsCache: { ...s.authorPostsCache, [`c:${communityId}`]: r.data?.posts ?? [] } }));
      return r.data?.contentVisible !== false;
    },

    loadPost: async (postId) => {
      if (findCachedPost(postId)) return;
      const post = await apiBloomGetPost(postId);
      if (!post) return;
      set(s => ({ postCache: { ...s.postCache, [postId]: post } }));
    },

    loadTrending: async (force) => {
      if (!force && get().trendingLoaded) return;
      const trendingTags = await apiBloomTrending();
      set({ trendingTags, trendingLoaded: true });
    },

    loadSuggested: async (force) => {
      if (!force && get().suggestedLoaded) return;
      const suggested = await apiBloomSuggested();
      set({ suggested, suggestedLoaded: true });
    },

    loadHot: async (force) => {
      if (!force && get().hotLoaded) return;
      const hot = await apiBloomHotComments();
      set({ hot, hotLoaded: true });
    },

    loadNotifCount: async () => {
      const notifCount = await apiBloomNotifCount();
      set({ notifCount });
    },

    loadHidden: async (force) => {
      if (!force && get().hiddenLoaded) return;
      const ids = await apiBloomHidden();
      set({ hiddenIds: new Set(ids), hiddenLoaded: true });
    },

    addPost: async (input, mediaFile) => {
      let mediaId: string | undefined;
      let mediaMime: string | undefined;
      const mediaAspect = input.mediaAspect;
      if (mediaFile) {
        const up = await apiBloomUploadMedia(mediaFile);
        if (!up) return false;
        mediaId = up.mediaId; mediaMime = up.mime;
      }
      const r = await apiBloomCreatePost({ ...input, mediaId, mediaMime, mediaAspect });
      if ('error' in r) return false;
      invalidateFeeds();
      return true;
    },

    editPost: async (id, patch) => {
      const r = await apiBloomEditPost(id, patch);
      if ('error' in r) return r.error;
      const np = r.post;
      const fn = (p: BloomPost) => p.id === id ? { ...p, text: np.text, title: np.title, isAd: np.isAd, adNote: np.adNote, editedAt: np.editedAt, tags: np.tags } : p;
      set(s => ({
        feedCache: Object.fromEntries(FEED_TABS.map(tab => [tab, mapCache(s.feedCache[tab], id, fn)])) as Partial<Record<FeedTab, BloomPost[]>>,
        tagCache: Object.fromEntries(Object.entries(s.tagCache).map(([t, ps]) => [t, ps.map(fn)])),
        authorPostsCache: Object.fromEntries(Object.entries(s.authorPostsCache).map(([a, ps]) => [a, ps.map(fn)])),
        postCache: Object.fromEntries(Object.entries(s.postCache).map(([k, v]) => [k, fn(v)])),
      }));
      return null;
    },

    deletePost: async (id) => {
      const ok = await apiBloomDeletePost(id);
      if (!ok) return;
      set(s => ({
        feedCache: Object.fromEntries(
          FEED_TABS.map(tab => [tab, s.feedCache[tab]?.filter(p => p.id !== id)]),
        ) as Partial<Record<FeedTab, BloomPost[]>>,
        tagCache: Object.fromEntries(
          Object.entries(s.tagCache).map(([tag, posts]) => [tag, posts.filter(p => p.id !== id)]),
        ),
        authorPostsCache: Object.fromEntries(
          Object.entries(s.authorPostsCache).map(([aid, posts]) => [aid, posts.filter(p => p.id !== id)]),
        ),
        postCache: Object.fromEntries(Object.entries(s.postCache).filter(([pid]) => pid !== id)),
      }));
    },

    react: async (postId, emoji) => {
      const reacted = await apiBloomReact(postId, emoji);
      if (reacted === null) return;
      const uid = useAuthStore.getState().currentUserId ?? '';
      patchEverywhere(postId, p => {
        const exists = p.reactions.find(r => r.emoji === emoji);
        let reactions: PostReaction[];
        if (reacted) {
          reactions = exists
            ? p.reactions.map(r => r.emoji === emoji ? { ...r, userIds: r.userIds.includes(uid) ? r.userIds : [...r.userIds, uid] } : r)
            : [...p.reactions, { emoji, userIds: [uid] }];
        } else {
          reactions = p.reactions
            .map(r => r.emoji === emoji ? { ...r, userIds: r.userIds.filter(u => u !== uid) } : r)
            .filter(r => r.userIds.length > 0);
        }
        return { ...p, reactions };
      });
    },

    addComment: async (postId, text) => {
      const res = await apiBloomComment(postId, text);
      if (!res) return;
      const uid = useAuthStore.getState().currentUserId ?? '';
      const acc = useAuthStore.getState().accounts.find(a => a.id === uid);
      patchEverywhere(postId, p => ({
        ...p,
        comments: [...p.comments, {
          id: res.id, authorId: uid, authorName: acc?.name ?? 'Вы',
          text, likes: [], createdAt: new Date().toISOString(),
        }],
      }));
    },

    deleteComment: async (postId, commentId) => {
      const ok = await apiBloomDeleteComment(commentId);
      if (!ok) return;
      patchEverywhere(postId, p => ({ ...p, comments: p.comments.filter(c => c.id !== commentId) }));
    },

    likeComment: async (postId, commentId) => {
      const liked = await apiBloomLikeComment(commentId);
      if (liked === null) return;
      const uid = useAuthStore.getState().currentUserId ?? '';
      patchEverywhere(postId, p => ({
        ...p,
        comments: p.comments.map(c => c.id !== commentId ? c : {
          ...c, likes: liked ? [...new Set([...c.likes, uid])] : c.likes.filter(u => u !== uid),
        }),
      }));
    },

    toggleSave: async (postId) => {
      const saved = await apiBloomToggleSave(postId);
      if (saved === null) return;
      const uid = useAuthStore.getState().currentUserId ?? '';
      patchEverywhere(postId, p => ({
        ...p,
        saved: saved ? Array.from(new Set([...p.saved, uid])) : p.saved.filter(u => u !== uid),
      }));
      // Отмена сохранения убирает пост из вкладки «Сохранённые» сразу;
      // добавление туда попадёт при следующей загрузке этой вкладки —
      // не переставляем пост между кэшами вручную ради сортировки.
      if (!saved) {
        set(s => (s.feedCache.saved
          ? { feedCache: { ...s.feedCache, saved: s.feedCache.saved.filter(p => p.id !== postId) } }
          : {}));
      }
    },

    repost: async (postId) => {
      const reposted = await apiBloomRepost(postId);
      if (reposted === null) return;
      patchEverywhere(postId, p => ({
        ...p,
        reposts: Math.max(0, p.reposts + (reposted ? 1 : -1)),
        repostedByMe: reposted,
      }));
    },

    incView: async (postId) => {
      patchEverywhere(postId, p => ({ ...p, views: p.views + 1 }));
      await apiBloomView(postId);
    },

    votePoll: async (postId, optionId) => {
      const ok = await apiBloomVote(postId, optionId);
      if (!ok) return;
      const uid = useAuthStore.getState().currentUserId ?? '';
      patchEverywhere(postId, p => {
        if (!p.poll) return p;
        return {
          ...p,
          poll: {
            ...p.poll,
            options: p.poll.options.map(o => o.id === optionId ? { ...o, votes: [...o.votes, uid] } : o),
          },
        };
      });
    },

    sendGift: async (toId, postId, modelKey) => {
      void toId;
      const r = await apiBloomGift(postId, modelKey);
      if ('error' in r) return false;
      await useMoney.getState().refresh();
      // Подарок добавляет реальный комментарий-подарок к посту — проще
      // перезагрузить вкладку, чем собирать точную копию строки с сервера.
      invalidateFeeds();
      return true;
    },

    toggleHide: async (authorId) => {
      const hidden = await apiBloomToggleHide(authorId);
      if (hidden === null) return;
      set(s => {
        const next = new Set(s.hiddenIds);
        if (hidden) next.add(authorId); else next.delete(authorId);
        return { hiddenIds: next };
      });
      invalidateFeeds();
    },

    writeTo: (userId) => apiBloomWrite(userId),
  };
});

/** Найти пост где угодно в уже загруженных кэшах (вкладки, теги, авторские
 *  подборки, отдельно догруженный). Используется PostDetailView — пост туда
 *  можно попасть из любого места, не только из активной вкладки ленты. */
export const useBloomPost = (postId: string | null): BloomPost | undefined =>
  useBloomStore(s => {
    if (!postId) return undefined;
    for (const tab of FEED_TABS) {
      const hit = s.feedCache[tab]?.find(p => p.id === postId);
      if (hit) return hit;
    }
    for (const posts of Object.values(s.tagCache)) {
      const hit = posts.find(p => p.id === postId);
      if (hit) return hit;
    }
    for (const posts of Object.values(s.authorPostsCache)) {
      const hit = posts.find(p => p.id === postId);
      if (hit) return hit;
    }
    return s.postCache[postId];
  });

/** Сразу поправить имя/username автора в уже загруженных постах после
 *  редактирования профиля — чисто косметика для уже отрисованного: сервер
 *  и так отдаст свежее имя при следующей загрузке ленты. */
export const syncBloomAuthor = (authorId: string, name: string, username: string) => {
  const patchOne = (p: BloomPost): BloomPost => {
    const isAuthor = p.authorId === authorId;
    const touchesComments = p.comments.some(c => c.authorId === authorId);
    if (!isAuthor && !touchesComments) return p;
    return {
      ...p,
      ...(isAuthor ? { authorName: name, authorUsername: username } : {}),
      comments: touchesComments
        ? p.comments.map(c => c.authorId === authorId ? { ...c, authorName: name } : c)
        : p.comments,
    };
  };
  const patchList = (posts: BloomPost[] | undefined) => posts?.map(patchOne);

  useBloomStore.setState(s => ({
    feedCache: Object.fromEntries(
      FEED_TABS.map(tab => [tab, patchList(s.feedCache[tab]) ?? s.feedCache[tab]]),
    ) as Partial<Record<FeedTab, BloomPost[]>>,
    tagCache: Object.fromEntries(
      Object.entries(s.tagCache).map(([tag, posts]) => [tag, patchList(posts) ?? posts]),
    ),
    authorPostsCache: Object.fromEntries(
      Object.entries(s.authorPostsCache).map(([id, posts]) => [id, patchList(posts) ?? posts]),
    ),
    postCache: Object.fromEntries(
      Object.entries(s.postCache).map(([id, p]) => [id, patchOne(p)]),
    ),
  }));
};

export const fmtAgo = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60)    return 'только что';
  if (d < 3600)  return `${Math.floor(d/60)} мин`;
  if (d < 86400) return `${Math.floor(d/3600)} ч`;
  return `${Math.floor(d/86400)} д`;
};

export const fmtViews = (n: number) =>
  n >= 1000000 ? `${(n/1000000).toFixed(1)}M`
  : n >= 1000  ? `${(n/1000).toFixed(0)}K`
  : String(n);

export const badgeFor = (views: number): 'hot' | 'warm' | null =>
  views > 50000 ? 'hot' : views > 20000 ? 'warm' : null;
