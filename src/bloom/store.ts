/* ===========================================================
   BLOOM STORE  -  полноценная социальная лента
   Алгоритм: score = likes×3 + comments×5 + reposts×4 + recency
   Персонализация: boost постов от тех, с кем взаимодействовал
============================================================ */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';
import { useMoney } from '@/wallet/store';
import type { Rarity } from '@/gifts/types';

export type PostKind    = 'text'|'photo'|'video';
export type ReactionKey = '❤️'|'🔥'|'😂'|'😮'|'👏'|'💯'|'🎉'|'🤔';
export const REACTIONS: ReactionKey[] = ['❤️','🔥','😂','😮','👏','💯','🎉','🤔'];

/* Небольшой каталог «социальных» подарков для комментариев Bloom —
   визуал переиспользует GiftBadge/GIFT_MODELS из NFT-модуля, но это
   лёгкие decorative-подарки, без связи с владением настоящими NFT.
   Оплачиваются баллами Prime (тот же баланс, что в разделе Sky Prime). */
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

export interface BloomGift {
  id: string; modelKey: string; rarity: Rarity;
  fromId: string; fromName: string; toId: string;
  postId: string; commentId?: string; createdAt: string;
}

export interface PostReaction { emoji: ReactionKey; userIds: string[]; }

export interface BloomComment {
  id: string; authorId: string; authorName: string; authorAvatar?: string;
  text: string; likes: string[]; createdAt: string;
  gift?: { modelKey: string; rarity: Rarity };
}

export interface BloomPollOption { label: string; votes: string[]; }
export interface BloomPoll { question: string; options: BloomPollOption[]; }

export interface BloomPost {
  id: string; authorId: string; authorName: string; authorUsername: string;
  kind: PostKind; text: string; mediaUrl?: string; mediaAspect?: number;
  reactions: PostReaction[]; comments: BloomComment[]; saved: string[];
  reposts: number; views: number; createdAt: string; tags: string[];
  isPinned?: boolean; location?: string; poll?: BloomPoll;
}

/* --- Seed posts -------------------------------------------- */
const T = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const mkReact = (emoji: ReactionKey, ids: string[]): PostReaction => ({ emoji, userIds: ids });

const SEED: BloomPost[] = [
  {
    id:'bp-1', authorId:'acc-luna', authorName:'Luna Nova', authorUsername:'luna_nova',
    kind:'text',
    text:'Только что закрыла Diamond в Sky Arena 💎 367 матчей, 81% WR  -  это было нереально сложно, но мы сделали это. Спасибо всей команде! #skyarena #diamond #gaming',
    reactions:[mkReact('❤️',['acc-neo','acc-kutuzov']),mkReact('🔥',['acc-neo'])],
    comments:[{ id:'c1', authorId:'acc-neo', authorName:'Neo Driver', text:'Красавица! Ждём Master 🏆', likes:['acc-luna'], createdAt:T(1) }],
    saved:['acc-kutuzov'], reposts:8, views:1240, createdAt:T(2), tags:['skyarena','diamond','gaming'],
  },
  {
    id:'bp-2', authorId:'acc-neo', authorName:'Neo Driver', authorUsername:'neon_driver',
    kind:'text',
    text:'Новый рекорд на Neon Drift  -  1:47.3 на Токийском автодроме 🏎️ Физика дрифта после патча просто огонь. Скоро туториал по идеальной траектории #neondrift #racing #drift',
    reactions:[mkReact('❤️',['acc-luna']),mkReact('🔥',['acc-luna','acc-kutuzov']),mkReact('💯',['acc-kutuzov'])],
    comments:[
      { id:'c2', authorId:'acc-kutuzov', authorName:'Kutuzov', text:'Как ты держишь такой контроль? 🤯', likes:[], createdAt:T(3) },
      { id:'c3', authorId:'acc-luna', authorName:'Luna Nova', text:'Туториал ждём!!', likes:['acc-neo'], createdAt:T(2.5) },
    ],
    saved:['acc-luna'], reposts:14, views:3800, createdAt:T(5), tags:['neondrift','racing','drift'],
  },
  {
    id:'bp-3', authorId:'acc-kutuzov', authorName:'Kutuzov', authorUsername:'kutuzov',
    kind:'text',
    text:'Sky v4.7  -  большое обновление:\n\nИгровой хаб с турнирами\nПитомцы в чате\nSky Market\nУведомления в реальном времени\n\nСпасибо всем кто тестировал! Следующий этап  -  расширенный Bloom #sky #update #v4',
    reactions:[mkReact('❤️',['acc-luna','acc-neo']),mkReact('👏',['acc-luna','acc-neo']),mkReact('🔥',['acc-neo'])],
    comments:[
      { id:'c4', authorId:'acc-luna', authorName:'Luna Nova', text:'Bloom ждём больше всего', likes:['acc-kutuzov'], createdAt:T(20) },
      { id:'c5', authorId:'acc-neo', authorName:'Neo Driver', text:'Питомцы  -  лучшее что было добавлено', likes:[], createdAt:T(19) },
    ],
    saved:['acc-luna','acc-neo'], reposts:23, views:8900, createdAt:T(24), tags:['sky','update','v4'], isPinned:true,
  },
  {
    id:'bp-4', authorId:'acc-neo', authorName:'Neo Driver', authorUsername:'neon_driver',
    kind:'text',
    text:'Мой питомец Войд уже 21-я серия побед 🐺⚡ Такой зверь! Кормлю его каждый день, показатели на максимуме. Уход реально влияет на настроение в чате 😂 #skyпитомцы #wolf',
    reactions:[mkReact('😂',['acc-luna','acc-kutuzov']),mkReact('❤️',['acc-kutuzov'])],
    comments:[{ id:'c6', authorId:'acc-luna', authorName:'Luna Nova', text:'Мой Неон тоже максимал, соревнуемся 😸', likes:['acc-neo'], createdAt:T(6) }],
    saved:[], reposts:5, views:920, createdAt:T(8), tags:['skyпитомцы','wolf'],
  },
  {
    id:'bp-5', authorId:'acc-luna', authorName:'Luna Nova', authorUsername:'luna_nova',
    kind:'text',
    text:'Войд vs Неон  -  кто круче? 🐺 vs 🐱\n\nОба на максимальной дружбе, оба на 21+ серии. Пусть подписчики решат!',
    reactions:[mkReact('❤️',['acc-neo']),mkReact('😂',['acc-neo','acc-kutuzov']),mkReact('🔥',['acc-kutuzov'])],
    comments:[
      { id:'c7', authorId:'acc-kutuzov', authorName:'Kutuzov', text:'🐺 однозначно', likes:['acc-neo'], createdAt:T(10) },
      { id:'c8', authorId:'acc-neo', authorName:'Neo Driver', text:'Войд', likes:['acc-luna'], createdAt:T(9) },
    ],
    saved:['acc-neo'], reposts:11, views:2100, createdAt:T(12), tags:['battle','pets','sky'],
    poll: { question:'Кто круче в этом сезоне?', options:[
      { label:'🐺 Войд',  votes:['acc-kutuzov'] },
      { label:'🐱 Неон',  votes:['acc-neo'] },
      { label:'Оба хороши', votes:[] },
    ]},
  },
];

/* --- Алгоритм ---------------------------------------------- */
const score = (p: BloomPost, myId: string, interactions: Set<string>): number => {
  const totalReacts = p.reactions.reduce((a, r) => a + r.userIds.length, 0);
  const eng = totalReacts * 3 + p.comments.length * 5 + p.reposts * 4;
  const hoursAgo = (Date.now() - new Date(p.createdAt).getTime()) / 3_600_000;
  const recency  = Math.max(0, 100 - hoursAgo * 1.5);
  const boost    = interactions.has(p.authorId) ? 30 : 0;
  const ownBoost = p.authorId === myId ? -50 : 0; // свои посты не в топ-ленте
  const pinned   = p.isPinned ? 200 : 0;
  return eng + recency + boost + ownBoost + pinned;
};

const FOLLOW_KEY = 'sky:bloom:v4:following';
const loadFollowing = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(FOLLOW_KEY) || '[]')); } catch { return new Set(); }
};
const persistFollowing = (s: Set<string>) => {
  try { localStorage.setItem(FOLLOW_KEY, JSON.stringify([...s])); } catch {}
};

const HIDDEN_KEY = 'sky:bloom:v4:hidden';
const loadHidden = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); } catch { return new Set(); }
};
const persistHidden = (s: Set<string>) => {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s])); } catch {}
};

const GIFTS_KEY = 'sky:bloom:v4:gifts';
const loadGifts = (): BloomGift[] => {
  try { return JSON.parse(localStorage.getItem(GIFTS_KEY) || '[]'); } catch { return []; }
};
const persistGifts = (g: BloomGift[]) => {
  try { localStorage.setItem(GIFTS_KEY, JSON.stringify(g)); } catch {}
};

/* --- Storage ----------------------------------------------- */
const KEY       = 'sky:bloom:v4:posts';
const MEDIA_KEY = 'sky:bloom:v4:media';
const BC        = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('sky:bloom:bc:v1') : null;
const TAB_ID    = Math.random().toString(36).slice(2);

const loadPosts = (): BloomPost[] => {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return SEED;
    const posts: BloomPost[] = JSON.parse(raw);
    const media: Record<string,string> = JSON.parse(localStorage.getItem(MEDIA_KEY)||'{}');
    return posts.map(p => {
      if (!p.mediaUrl && media[p.id]) {
        try {
          const [hdr, data] = media[p.id].split(',');
          const mime = hdr.match(/:(.*?);/)?.[1] || 'image/jpeg';
          const bytes = atob(data); const arr = new Uint8Array(bytes.length);
          for (let i=0;i<bytes.length;i++) arr[i]=bytes.charCodeAt(i);
          return { ...p, mediaUrl: URL.createObjectURL(new Blob([arr],{type:mime})) };
        } catch { return p; }
      }
      return p;
    });
  } catch { return SEED; }
};
const persist = (posts: BloomPost[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(
    posts.map(p => ({ ...p, mediaUrl: p.mediaUrl?.startsWith('blob:') ? undefined : p.mediaUrl }))
  )); } catch {}
};
const saveMedia = (id: string, b64: string) => {
  try {
    const m: Record<string,string> = JSON.parse(localStorage.getItem(MEDIA_KEY)||'{}');
    m[id] = b64; localStorage.setItem(MEDIA_KEY, JSON.stringify(m));
  } catch {}
};
const removeMedia = (id: string) => {
  try {
    const m: Record<string,string> = JSON.parse(localStorage.getItem(MEDIA_KEY)||'{}');
    delete m[id]; localStorage.setItem(MEDIA_KEY, JSON.stringify(m));
  } catch {}
};

/* --- Store ------------------------------------------------- */
interface BloomState {
  posts:         BloomPost[];
  interactions:  Set<string>;  // authorIds с кем взаимодействовали
  following:     Set<string>;  // authorIds, на кого подписан
  hidden:        Set<string>;  // authorIds, скрытые из ленты текущего пользователя
  gifts:         BloomGift[];

  // Computed
  feed:          (tab: FeedTab) => BloomPost[];
  trending:      () => string[][];   // [[tag, count]]
  suggestedUsers:() => string[];     // authorIds
  hotComments:   () => { post: BloomPost; comment: BloomComment }[];
  notificationsCount: () => number;
  giftsFor:      (authorId: string) => BloomGift[];

  // Actions
  addPost:       (p: BloomPost, mediaB64?: string) => void;
  deletePost:    (id: string) => void;
  react:         (postId: string, emoji: ReactionKey) => void;
  unreact:       (postId: string, emoji: ReactionKey) => void;
  addComment:    (postId: string, text: string) => void;
  likeComment:   (postId: string, commentId: string) => void;
  toggleSave:    (id: string) => void;
  repost:        (id: string) => void;
  incView:       (id: string) => void;
  toggleFollow:  (authorId: string) => void;
  toggleHide:    (authorId: string) => void;
  votePoll:      (postId: string, optIdx: number) => void;
  sendGift:      (toId: string, postId: string, modelKey: string) => boolean;
  syncFromBC:    (posts: BloomPost[]) => void;
}

export type FeedTab = 'algo'|'fresh'|'saved'|'mine';

const me = () => useAuthStore.getState().currentUserId ?? '';

export const useBloomStore = create<BloomState>((set, get) => {
  const mut = (fn: (posts: BloomPost[]) => BloomPost[]) => {
    const next = fn(get().posts);
    persist(next);
    set({ posts: next });
    return next;
  };

  return {
    posts: loadPosts(),
    interactions: new Set<string>(),
    following: loadFollowing(),
    hidden: loadHidden(),
    gifts: loadGifts(),

    feed: (tab) => {
      const { posts, interactions, hidden } = get();
      const uid = me();
      const visible = hidden.size ? posts.filter(p => p.authorId === uid || !hidden.has(p.authorId)) : posts;
      if (tab === 'algo') {
        return [...visible].sort((a,b) => score(b,uid,interactions) - score(a,uid,interactions));
      }
      if (tab === 'fresh') return [...visible].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
      if (tab === 'saved') return visible.filter(p => p.saved.includes(uid));
      if (tab === 'mine')  return visible.filter(p => p.authorId === uid);
      return visible;
    },

    trending: () => {
      const map = new Map<string,number>();
      get().posts.forEach(p => p.tags.forEach(t => map.set(t,(map.get(t)||0)+1)));
      return Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([t,n])=>[t,String(n)]);
    },

    suggestedUsers: () => {
      const uid = me();
      const ids = [...new Set(get().posts.map(p=>p.authorId))].filter(id=>id!==uid);
      return ids.slice(0,5);
    },

    hotComments: () => {
      const out: { post: BloomPost; comment: BloomComment }[] = [];
      get().posts.forEach(p => p.comments.forEach(c => out.push({ post:p, comment:c })));
      return out.sort((a,b) => b.comment.likes.length - a.comment.likes.length).slice(0,4);
    },

    notificationsCount: () => {
      const uid = me();
      let n = 0;
      get().posts.filter(p => p.authorId === uid).forEach(p => {
        n += p.comments.filter(c => c.authorId !== uid).length;
        n += p.reactions.reduce((a, r) => a + r.userIds.filter(id => id !== uid).length, 0);
      });
      return n;
    },

    giftsFor: (authorId) => get().gifts
      .filter(g => g.toId === authorId)
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt)),

    addPost: (p, mediaB64) => {
      if (mediaB64) saveMedia(p.id, mediaB64);
      const next = mut(posts => [p, ...posts]);
      BC?.postMessage({ type:'post-new', post:p, from:TAB_ID });
    },

    deletePost: (id) => {
      // revoke blob URL before deleting to avoid memory leak
      const post = get().posts.find(p => p.id === id);
      if (post?.mediaUrl?.startsWith('blob:')) URL.revokeObjectURL(post.mediaUrl);
      mut(posts => posts.filter(p=>p.id!==id));
      removeMedia(id);
      BC?.postMessage({ type:'post-delete', id, from:TAB_ID });
    },

    react: (postId, emoji) => {
      const uid = me();
      const next = mut(posts => posts.map(p => {
        if (p.id !== postId) return p;
        const exists = p.reactions.find(r=>r.emoji===emoji);
        const reactions = exists
          ? p.reactions.map(r => r.emoji===emoji
              ? { ...r, userIds: r.userIds.includes(uid) ? r.userIds.filter(u=>u!==uid) : [...r.userIds,uid] }
              : r)
          : [...p.reactions, { emoji, userIds:[uid] }];
        return { ...p, reactions: reactions.filter(r=>r.userIds.length>0) };
      }));
      set(s => ({ interactions: new Set([...s.interactions, postId]) }));
      const updated = next.find(p=>p.id===postId);
      if (updated) BC?.postMessage({ type:'post-react', post:updated, emoji, from:TAB_ID });
    },

    unreact: (postId, emoji) => get().react(postId, emoji),

    addComment: (postId, text) => {
      const uid  = me();
      const accs = useAuthStore.getState().accounts;
      const acc  = accs.find(a=>a.id===uid);
      const next = mut(posts => posts.map(p => p.id!==postId ? p : {
        ...p, comments: [...p.comments, {
          id: crypto.randomUUID(), authorId:uid,
          authorName: acc?.name ?? 'Вы', text,
          likes:[], createdAt: new Date().toISOString(),
        }]
      }));
      set(s => ({ interactions: new Set([...s.interactions, postId]) }));
      const updated = next.find(p=>p.id===postId);
      if (updated) BC?.postMessage({ type:'post-comment', post:updated, text, from:TAB_ID });
    },

    likeComment: (postId, commentId) => {
      const uid = me();
      mut(posts => posts.map(p => p.id!==postId ? p : {
        ...p, comments: p.comments.map(c => c.id!==commentId ? c : {
          ...c, likes: c.likes.includes(uid) ? c.likes.filter(u=>u!==uid) : [...c.likes,uid]
        })
      }));
    },

    toggleSave: (id) => {
      const uid = me();
      const next = mut(posts => posts.map(p => p.id!==id ? p : {
        ...p, saved: p.saved.includes(uid) ? p.saved.filter(u=>u!==uid) : [...p.saved,uid]
      }));
      const updated = next.find(p=>p.id===id);
      if (updated) BC?.postMessage({ type:'post-update', post:updated, from:TAB_ID });
    },

    repost: (id) => {
      const next = mut(posts => posts.map(p => p.id!==id ? p : { ...p, reposts:p.reposts+1 }));
      const updated = next.find(p=>p.id===id);
      if (updated) BC?.postMessage({ type:'post-update', post:updated, from:TAB_ID });
    },

    incView: (id) => {
      set(s => ({
        posts: s.posts.map(p => p.id!==id ? p : { ...p, views:p.views+1 })
      }));
    },

    toggleFollow: (authorId) => {
      set(s => {
        const next = new Set<string>(s.following);
        next.has(authorId) ? next.delete(authorId) : next.add(authorId);
        persistFollowing(next);
        return { following: next };
      });
    },

    toggleHide: (authorId) => {
      set(s => {
        const next = new Set<string>(s.hidden);
        next.has(authorId) ? next.delete(authorId) : next.add(authorId);
        persistHidden(next);
        return { hidden: next };
      });
    },

    votePoll: (postId, optIdx) => {
      const uid = me();
      mut(posts => posts.map(p => {
        if (p.id !== postId || !p.poll) return p;
        const already = p.poll.options.some(o => o.votes.includes(uid));
        if (already) return p;
        return { ...p, poll: { ...p.poll, options: p.poll.options.map((o,i) =>
          i===optIdx ? { ...o, votes:[...o.votes, uid] } : o) } };
      }));
    },

    sendGift: (toId, postId, modelKey) => {
      const uid = me();
      const opt = BLOOM_GIFT_CATALOG.find(g => g.modelKey === modelKey) ?? BLOOM_GIFT_CATALOG[0];
      const paid = useMoney.getState().spendPoints(uid, opt.cost, `Подарок в Bloom: ${opt.label}`, postId);
      if (!paid) return false;

      const accounts = useAuthStore.getState().accounts;
      const fromName = accounts.find(a => a.id === uid)?.name ?? 'Кто-то';
      const giftId = crypto.randomUUID();
      const commentId = crypto.randomUUID();

      const gift: BloomGift = {
        id: giftId, modelKey: opt.modelKey, rarity: opt.rarity,
        fromId: uid, fromName, toId, postId, commentId, createdAt: new Date().toISOString(),
      };
      set(s => { const next = [gift, ...s.gifts]; persistGifts(next); return { gifts: next }; });

      mut(posts => posts.map(p => p.id !== postId ? p : {
        ...p,
        comments: [...p.comments, {
          id: commentId, authorId: uid, authorName: fromName,
          text: `подарил(а) «${opt.label}»`, likes: [], createdAt: new Date().toISOString(),
          gift: { modelKey: opt.modelKey, rarity: opt.rarity },
        }],
      }));
      return true;
    },

    syncFromBC: (incoming) => {
      set(s => ({ posts: incoming }));
    },
  };
});

/* -- Update authorName/authorUsername in posts when profile changes ------- */
export const syncBloomAuthor = (authorId: string, name: string, username: string) => {
  useBloomStore.setState(s => ({
    posts: s.posts.map(p => {
      if (p.authorId !== authorId) return p;
      return {
        ...p,
        authorName: name,
        authorUsername: username,
        comments: p.comments.map(c =>
          c.authorId === authorId ? { ...c, authorName: name } : c
        ),
      };
    }),
  }));
};

/* BroadcastChannel listener  -  отдельно, вне стора */
if (BC) {
  BC.addEventListener('message', (e) => {
    if (!e.data || e.data.from === TAB_ID) return;
    const { type, post, id } = e.data;
    if (type === 'post-new') {
      useBloomStore.setState(s => ({
        posts: s.posts.find(p=>p.id===post.id) ? s.posts : [post,...s.posts]
      }));
    }
    if (type === 'post-delete') {
      useBloomStore.setState(s => ({ posts: s.posts.filter(p=>p.id!==id) }));
    }
    // post-react, post-comment, post-update all update the post object
    if (type === 'post-react' || type === 'post-comment' || type === 'post-update') {
      useBloomStore.setState(s => ({
        posts: s.posts.map(p => p.id===post.id ? post : p)
      }));
    }
  });
}

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
