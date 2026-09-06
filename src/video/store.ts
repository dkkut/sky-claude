import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';

/* --- Types -------------------------------------------------- */
export type VideoCategory = 'gaming' | 'music' | 'tech' | 'sport' | 'art' | 'humor' | 'news' | 'other';

export const CATEGORY_LABEL: Record<VideoCategory, string> = {
  gaming: 'Игры', music: 'Музыка', tech: 'Технологии',
  sport: 'Спорт', art: 'Творчество', humor: 'Юмор',
  news: 'Новости', other: 'Другое',
};

export interface VideoComment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
  likes: string[];
  replyToId?: string;   // ответ на другой комментарий
  pinned?:    boolean;  // закреплён автором видео
}

export interface VideoEntry {
  id: string;
  title: string;
  description: string;
  uploadedBy: string;       // userId
  uploaderName: string;
  createdAt: string;
  duration: string;         // "4:23"
  durationSec: number;
  views: number;
  likes: string[];          // userIds
  dislikes: string[];
  comments: VideoComment[];
  category: VideoCategory;
  tags: string[];
  isShort: boolean;         // vertical short video
  sourceUrl?: string;       // blob URL (restored from IndexedDB)
  thumbnailUrl?: string;    // base64 cover image
  thumbnailGrad?: [string, string];
  fileName?: string;
  mimeType?: string;
  bytes?: number;
  isDraft?:      boolean;  // черновик — не опубликовано, видно только автору
  scheduledAt?:  number;   // timestamp запланированной публикации
  isScheduled?:  boolean;  // true, пока не наступило scheduledAt
  status: 'published' | 'private' | 'unlisted';
  // Monetization
  isPaid?:        boolean;
  paidPrice?:     number;       // in prime points
  // Chapters
  chapters?:      { time: number; title: string }[];
}

/* --- IndexedDB for video blobs ------------------------------ */
const VDB_NAME = 'sky:video:v1';
let _vdb: IDBDatabase | null = null;

async function openVDB(): Promise<IDBDatabase> {
  if (_vdb) return _vdb;
  return new Promise((res, rej) => {
    const req = indexedDB.open(VDB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = e => { _vdb = (e.target as IDBOpenDBRequest).result; res(_vdb); };
    req.onerror   = () => rej(req.error);
  });
}

export async function saveVideoBlob(id: string, blob: Blob): Promise<void> {
  const db = await openVDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('blobs', 'readwrite');
    const req = tx.objectStore('blobs').put(blob, id);
    req.onsuccess = () => res(); req.onerror = () => rej(req.error);
  });
}

export async function loadVideoBlob(id: string): Promise<string | null> {
  const db = await openVDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('blobs', 'readonly');
    const req = tx.objectStore('blobs').get(id);
    req.onsuccess = () => res(req.result instanceof Blob ? URL.createObjectURL(req.result) : null);
    req.onerror   = () => rej(req.error);
  });
}

export async function deleteVideoBlob(id: string): Promise<void> {
  const db = await openVDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction('blobs', 'readwrite');
    const req = tx.objectStore('blobs').delete(id);
    req.onsuccess = () => res(); req.onerror = () => rej(req.error);
  });
}

/* --- Seed gradient palettes -------------------------------- */
const GRADS: [string, string][] = [
  ['#0d1422','#1a3a5c'], ['#1a0533','#4f2e8a'], ['#0f2417','#1a7a43'],
  ['#1f0e0e','#8a1a1a'], ['#0a1628','#1e4080'], ['#1a1a0e','#6b5a00'],
  ['#0e1a1a','#006b5a'], ['#1a0e1a','#6b006b'],
];
export const getVideoGrad = (id: string): [string, string] => {
  const h = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return GRADS[h % GRADS.length];
};

/* --- Storage ----------------------------------------------- */
const SK = 'sky:video:meta:v1';
const W  = typeof window !== 'undefined';

const loadMeta = (): VideoEntry[] => {
  if (!W) return [];
  try { return JSON.parse(localStorage.getItem(SK) || '[]'); } catch { return []; }
};
const saveMeta = (videos: VideoEntry[]) => {
  if (!W) return;
  try {
    localStorage.setItem(SK, JSON.stringify(
      videos.map(v => ({ ...v, sourceUrl: v.sourceUrl?.startsWith('blob:') ? undefined : v.sourceUrl }))
    ));
  } catch {}
};

/* --- Seed videos ------------------------------------------- */
const SEED: VideoEntry[] = [
  {
    id:'v-1', title:'Sky Arena  -  разбор топ рейда сезона 5', description:'Полный разбор нашей победы в ранговом матче. Тактика, позиции, лучшие моменты.',
    uploadedBy:'acc-kutuzov', uploaderName:'Kutuzov', createdAt:new Date(Date.now()-86400000*2).toISOString(),
    duration:'18:42', durationSec:1122, views:4820, likes:['acc-luna','acc-neo'], dislikes:[],
    comments:[{id:'c1',authorId:'acc-luna',authorName:'Luna Nova',text:'Огонь контент! Давай ещё такие разборы 🔥',createdAt:new Date(Date.now()-3600000).toISOString(),likes:['acc-neo']}],
    category:'gaming', tags:['arena','fps','guide'], isShort:false,
    thumbnailGrad:['#0d1422','#4f2e8a'], status:'published',
  },
  {
    id:'v-2', title:'Neon Drift  -  как я взял первое место в чемпионате', description:'Прохождение трека «Neon Strip» и советы по дрифту.',
    uploadedBy:'acc-neo', uploaderName:'Neo Driver', createdAt:new Date(Date.now()-86400000*4).toISOString(),
    duration:'12:05', durationSec:725, views:9210, likes:['acc-kutuzov'], dislikes:[],
    comments:[], category:'gaming', tags:['racing','drift'], isShort:false,
    thumbnailGrad:['#0a1628','#1e4080'], status:'published',
  },
  {
    id:'v-3', title:'Мой новый трек  -  процесс создания', description:'Behind the scenes: пишем Bloom Drift от идеи до финального мастера.',
    uploadedBy:'acc-luna', uploaderName:'Luna Nova', createdAt:new Date(Date.now()-86400000*1).toISOString(),
    duration:'24:17', durationSec:1457, views:2103, likes:['acc-neo','acc-kutuzov'], dislikes:[],
    comments:[{id:'c2',authorId:'acc-neo',authorName:'Neo Driver',text:'Очень крутой процесс, спасибо за видео!',createdAt:new Date(Date.now()-1800000).toISOString(),likes:[]}],
    category:'music', tags:['music','studio','production'], isShort:false,
    thumbnailGrad:['#1a0533','#8a1a1a'], status:'published',
  },
  {
    id:'v-4', title:'Sky v4  -  обзор всех новых функций', description:'Полный обзор экосистемы Sky: мессенджер, музыка, кино, гейминг.',
    uploadedBy:'acc-kutuzov', uploaderName:'Kutuzov', createdAt:new Date(Date.now()-86400000*7).toISOString(),
    duration:'31:00', durationSec:1860, views:15400, likes:['acc-luna','acc-neo'], dislikes:[],
    comments:[], category:'tech', tags:['sky','review','tech'], isShort:false,
    thumbnailGrad:['#0f2417','#1a7a43'], status:'published',
  },
  // Shorts
  {
    id:'v-s1', title:'Момент матча 🔥', description:'Этот момент в Arena Squad просто нереальный',
    uploadedBy:'acc-neo', uploaderName:'Neo Driver', createdAt:new Date(Date.now()-3600000*5).toISOString(),
    duration:'0:58', durationSec:58, views:28300, likes:['acc-kutuzov','acc-luna'], dislikes:[],
    comments:[], category:'gaming', tags:['short','clip'], isShort:true,
    thumbnailGrad:['#1a0e1a','#6b006b'], status:'published',
  },
  {
    id:'v-s2', title:'Новый трек  -  превью 🎵', description:'Тизер нового релиза. Выходит в пятницу!',
    uploadedBy:'acc-luna', uploaderName:'Luna Nova', createdAt:new Date(Date.now()-3600000*12).toISOString(),
    duration:'0:45', durationSec:45, views:11700, likes:['acc-neo'], dislikes:[],
    comments:[], category:'music', tags:['short','music'], isShort:true,
    thumbnailGrad:['#0e1a1a','#006b5a'], status:'published',
  },
  {
    id:'v-s3', title:'Sky Market  -  первый заказ 📦', description:'Получил посылку от Luna Store!',
    uploadedBy:'acc-kutuzov', uploaderName:'Kutuzov', createdAt:new Date(Date.now()-86400000).toISOString(),
    duration:'1:12', durationSec:72, views:5600, likes:['acc-luna'], dislikes:[],
    comments:[], category:'other', tags:['short','market'], isShort:true,
    thumbnailGrad:['#1a1a0e','#6b5a00'], status:'published',
  },
];

/* --- Store ------------------------------------------------- */
interface VideoState {
  videos: VideoEntry[];
  addVideo: (v: Omit<VideoEntry,'id'|'createdAt'|'views'|'likes'|'dislikes'|'comments'|'status'>, blob: Blob) => Promise<string>;
  publishVideoNow: (id: string) => void;
  updateVideoSchedule: (id: string, scheduledAt: number) => void;
  deleteVideo: (id: string) => void;
  likeVideo: (id: string, userId: string) => void;
  dislikeVideo: (id: string, userId: string) => void;
  addComment: (videoId: string, userId: string, name: string, text: string, replyToId?: string) => void;
  likeComment:  (videoId: string, commentId: string, userId: string) => void;
  pinComment:   (videoId: string, commentId: string) => void;
  deleteComment:(videoId: string, commentId: string) => void;
  incrementViews: (id: string) => void;
  restoreUrls: () => Promise<void>;
  // User data
  subscriptions:  Record<string, string[]>;   // userId → subscribedTo[]
  watchHistory:   Record<string, string[]>;   // userId → videoId[]
  savedPlaylists: Record<string, string[]>;   // userId → videoId[]
  subscribe:   (userId: string, channelId: string) => void;
  unsubscribe: (userId: string, channelId: string) => void;
  addToHistory:(userId: string, videoId: string) => void;
  saveVideo:   (userId: string, videoId: string) => void;
  unsaveVideo: (userId: string, videoId: string) => void;
  getHistory:  (userId: string) => VideoEntry[];
  getSaved:    (userId: string) => VideoEntry[];
  isSubscribed:(userId: string, channelId: string) => boolean;
}

const initVideos: VideoEntry[] = (() => {
  const stored = loadMeta();
  return stored.length > 0 ? stored : SEED;
})();

// User data localStorage
const UD_KEY = 'sky:video:userdata:v1';
const loadUD = () => { try { return JSON.parse(localStorage.getItem(UD_KEY)||'{}'); } catch { return {}; } };
const saveUD = (d: any) => { try { localStorage.setItem(UD_KEY, JSON.stringify(d)); } catch {} };
const ud = loadUD();

export const useVideoStore = create<VideoState>((set, get) => {
  /* Реальный тикер отложенной публикации видео — раз в 15с проверяет,
     не настало ли время, и переводит запланированные видео в опубликованные. */
  if (typeof window !== 'undefined') {
    setInterval(() => {
      const now = Date.now();
      const due = get().videos.filter(v => v.isScheduled && v.scheduledAt && v.scheduledAt <= now);
      if (due.length === 0) return;
      set(s => ({
        videos: s.videos.map(v =>
          v.isScheduled && v.scheduledAt && v.scheduledAt <= now
            ? { ...v, isScheduled: false, scheduledAt: undefined, status: 'published' }
            : v),
      }));
      saveMeta(get().videos);
    }, 15000);
  }

  return {
  videos: initVideos,
  subscriptions:  ud.subscriptions  ?? {},
  watchHistory:   ud.watchHistory   ?? {},
  savedPlaylists: ud.savedPlaylists ?? {},


  addVideo: async (params, blob) => {
    const id = `v-${crypto.randomUUID()}`;
    const entry: VideoEntry = {
      ...params, id,
      createdAt: new Date().toISOString(),
      views: 0, likes: [], dislikes: [], comments: [],
      status: params.isDraft ? 'private' : 'published',
    };
    await saveVideoBlob(id, blob);
    const url = URL.createObjectURL(blob);
    set(s => ({ videos: [{ ...entry, sourceUrl: url }, ...s.videos] }));
    saveMeta(get().videos);
    return id;
  },

  publishVideoNow: (id) => {
    set(s => ({ videos: s.videos.map(v => v.id !== id ? v : { ...v, isDraft: false, isScheduled: false, scheduledAt: undefined, status: 'published' }) }));
    saveMeta(get().videos);
  },
  updateVideoSchedule: (id, scheduledAt) => {
    set(s => ({ videos: s.videos.map(v => v.id !== id ? v : { ...v, scheduledAt, isScheduled: true, isDraft: false }) }));
    saveMeta(get().videos);
  },

  deleteVideo: (id) => {
    deleteVideoBlob(id).catch(() => {});
    set(s => ({ videos: s.videos.filter(v => v.id !== id) }));
    saveMeta(get().videos);
  },

  likeVideo: (id, userId) => {
    set(s => ({
      videos: s.videos.map(v => v.id !== id ? v : {
        ...v,
        likes:    v.likes.includes(userId) ? v.likes.filter(u => u !== userId) : [...v.likes, userId],
        dislikes: v.dislikes.filter(u => u !== userId),
      })
    }));
    saveMeta(get().videos);
  },

  dislikeVideo: (id, userId) => {
    set(s => ({
      videos: s.videos.map(v => v.id !== id ? v : {
        ...v,
        dislikes: v.dislikes.includes(userId) ? v.dislikes.filter(u => u !== userId) : [...v.dislikes, userId],
        likes:    v.likes.filter(u => u !== userId),
      })
    }));
    saveMeta(get().videos);
  },

  addComment: (videoId, userId, name, text, replyToId) => {
    const comment: VideoComment = {
      id: `cmt-${Date.now()}`, authorId: userId, authorName: name,
      text, createdAt: new Date().toISOString(), likes: [], replyToId,
    };
    set(s => ({
      videos: s.videos.map(v => v.id !== videoId ? v : { ...v, comments: [...v.comments, comment] })
    }));
    saveMeta(get().videos);
  },

  likeComment: (videoId, commentId, userId) => {
    set(s => ({
      videos: s.videos.map(v => v.id !== videoId ? v : {
        ...v, comments: v.comments.map(c => c.id !== commentId ? c : {
          ...c, likes: c.likes.includes(userId) ? c.likes.filter(u => u !== userId) : [...c.likes, userId],
        }),
      }),
    }));
    saveMeta(get().videos);
  },

  /* Закрепить может только автор видео — одновременно закреплён только
     один комментарий, повторный клик по уже закреплённому — открепляет */
  pinComment: (videoId, commentId) => {
    set(s => ({
      videos: s.videos.map(v => v.id !== videoId ? v : {
        ...v, comments: v.comments.map(c => ({ ...c, pinned: c.id === commentId ? !c.pinned : false })),
      }),
    }));
    saveMeta(get().videos);
  },

  deleteComment: (videoId, commentId) => {
    set(s => ({
      videos: s.videos.map(v => v.id !== videoId ? v : {
        ...v, comments: v.comments.filter(c => c.id !== commentId && c.replyToId !== commentId),
      }),
    }));
    saveMeta(get().videos);
  },

  incrementViews: (id) => {
    set(s => ({ videos: s.videos.map(v => v.id === id ? { ...v, views: v.views + 1 } : v) }));
    const views = get().videos.find(v => v.id === id)?.views ?? 0;
    if (views % 5 === 0) saveMeta(get().videos);
  },

  subscribe: (userId, channelId) => {
    set(s => {
      const subs = { ...s.subscriptions };
      subs[userId] = [...(subs[userId]??[]).filter(x=>x!==channelId), channelId];
      const next = { ...s, subscriptions: subs };
      saveUD({ subscriptions:subs, watchHistory:s.watchHistory, savedPlaylists:s.savedPlaylists });
      return next;
    });
  },
  unsubscribe: (userId, channelId) => {
    set(s => {
      const subs = { ...s.subscriptions, [userId]: (s.subscriptions[userId]??[]).filter(x=>x!==channelId) };
      saveUD({ subscriptions:subs, watchHistory:s.watchHistory, savedPlaylists:s.savedPlaylists });
      return { subscriptions: subs };
    });
  },
  addToHistory: (userId, videoId) => {
    set(s => {
      const hist = { ...s.watchHistory };
      hist[userId] = [videoId, ...(hist[userId]??[]).filter(x=>x!==videoId)].slice(0,100);
      saveUD({ subscriptions:s.subscriptions, watchHistory:hist, savedPlaylists:s.savedPlaylists });
      return { watchHistory: hist };
    });
  },
  saveVideo: (userId, videoId) => {
    set(s => {
      const pl = { ...s.savedPlaylists };
      pl[userId] = [...(pl[userId]??[]).filter(x=>x!==videoId), videoId];
      saveUD({ subscriptions:s.subscriptions, watchHistory:s.watchHistory, savedPlaylists:pl });
      return { savedPlaylists: pl };
    });
  },
  unsaveVideo: (userId, videoId) => {
    set(s => {
      const pl = { ...s.savedPlaylists, [userId]: (s.savedPlaylists[userId]??[]).filter(x=>x!==videoId) };
      saveUD({ subscriptions:s.subscriptions, watchHistory:s.watchHistory, savedPlaylists:pl });
      return { savedPlaylists: pl };
    });
  },
  getHistory: (userId) => {
    const ids = get().watchHistory[userId] ?? [];
    const vids = get().videos;
    return ids.map(id => vids.find(v => v.id===id)).filter(Boolean) as VideoEntry[];
  },
  getSaved: (userId) => {
    const ids = get().savedPlaylists[userId] ?? [];
    return get().videos.filter(v => ids.includes(v.id));
  },
  isSubscribed: (userId, channelId) => (get().subscriptions[userId]??[]).includes(channelId),

  restoreUrls: async () => {
    const videos = get().videos;
    const toRestore = videos.filter(v => v.fileName && !v.sourceUrl?.startsWith('blob:'));
    for (const v of toRestore) {
      try {
        const url = await loadVideoBlob(v.id);
        if (url) set(s => ({ videos: s.videos.map(x => x.id === v.id ? { ...x, sourceUrl: url } : x) }));
      } catch {}
    }
  },
  };
});

// Restore blob URLs on startup
if (W) setTimeout(() => useVideoStore.getState().restoreUrls(), 200);

/* --- Helpers ----------------------------------------------- */
export const fmtViews = (n: number) =>
  n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(0)}K` : String(n);

export const fmtAgo = (iso: string) => {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 3600000)  return `${Math.floor(d/60000)} мин назад`;
  if (d < 86400000) return `${Math.floor(d/3600000)} ч назад`;
  if (d < 2592000000) return `${Math.floor(d/86400000)} дн назад`;
  return `${Math.floor(d/2592000000)} мес назад`;
};
