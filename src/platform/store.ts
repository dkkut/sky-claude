import { create } from 'zustand';
import { saveAudioDataUrl, saveAudioBlob, loadAudioUrl, deleteAudio } from './audioDB';

/* ===========================================================================
   TYPES
=========================================================================== */
// 'pending' — трек ждёт проверки, 'rejected' — её не прошёл: это
// разные вещи, и человеку их надо показывать по-разному.
export type TrackStatus = 'private' | 'pending' | 'published' | 'rejected';

export interface Track {
  id: string;
  title: string;
  artist: string;
  genre: string;
  album?: string;
  year?: number;
  lyrics?: string;
  coverUrl?: string;
  duration: string;
  premium: boolean;
  sourceUrl?: string;
  fileName?: string;
  mimeType?: string;
  bytes?: number;
  addedAt: string;
  isLocal?: boolean;
  uploadedBy?: string;
  uploaderName?: string;
  status: TrackStatus;
  plays: number;
  likes: string[];
  // Artist submission fields
  albumName?:     string;
  albumYear?:     string;
  copyrightDoc?:  string;   // base64 or filename
  copyrightType?: 'license' | 'personal' | 'author' | 'label' | 'other';
  copyrightNote?: string;
  rejectReason?:  string;
  submittedAt?:   string;
  syncedLyrics?:  { t: number; text: string }[];  // timed lyrics
  lyricsStatus?:  'pending' | 'approved' | 'rejected';  // separate lyrics moderation
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: string;
}

export interface Movie {
  id: string; title: string; category: string; description?: string;
  duration: string; trailerUrl?: string; coverUrl?: string;
  premium: boolean; sourceUrl?: string; fileName?: string;
  mimeType?: string; bytes?: number; addedAt: string;
  rating?: number; year?: number; genre?: string; director?: string;
  ageRating?: string; country?: string;
  license?: 'open' | 'personal';   // публикация по открытой или личной лицензии
  explicit?: boolean;               // пометка E — ненормативная лексика/контент
  ageRestricted18?: boolean;        // 18+ (для открытой лицензии)
  uploadedBy?: string; uploaderName?: string;
  isShort?: boolean;                // короткое вертикальное видео (9:16) — режим "Shorts"
  likes?: string[];                 // userId лайкнувших (используется в Shorts)
}

export interface SharedRoom {
  id: string; host: string; title: string; description?: string;
  mediaType: 'music'|'movie'; mediaId?: string; progressSec: number;
  active: boolean; participants: string[];
  chatMessages: { author:string; text:string; time:string }[];
}

/* ===========================================================================
   STORE INTERFACE
=========================================================================== */
interface PlatformState {
  isPrime: boolean; primeUntil: string|null;
  tracks:    Track[];
  playlists: Playlist[];
  favorites: string[];
  currentPlaylistId: string|null;
  movies:    Movie[];
  rooms:     SharedRoom[];
  grantPrime:         (days: number) => void;
  revokePrime:        () => void;
  addTrack:           (p: Omit<Track,'id'|'addedAt'|'plays'|'likes'>, dataUrl?: string) => string;
  updateTrack:        (id: string, p: Partial<Track>) => void;
  deleteTrack:        (id: string) => void;
  submitForReview:    (id: string) => void;
  approveTrack:       (id: string) => void;
  rejectTrack:        (id: string) => void;
  incrementPlays:     (id: string) => void;
  toggleLike:         (id: string, userId: string) => void;
  toggleFavorite:     (id: string) => void;
  createPlaylist:     (name: string) => string;
  deletePlaylist:     (id: string) => void;
  renamePlaylist:     (id: string, name: string) => void;
  addToPlaylist:      (plId: string, tId: string) => void;
  removeFromPlaylist: (plId: string, tId: string) => void;
  setCurrentPlaylist: (id: string|null) => void;
  addMovie:           (p: Omit<Movie,'id'|'addedAt'>) => void;
  updateMovie:        (id: string, p: Partial<Movie>) => void;
  toggleMovieLike:    (id: string, userId: string) => void;
  deleteMovie:        (id: string) => void;
  createRoom:         (p: Omit<SharedRoom,'id'|'progressSec'|'active'|'participants'|'chatMessages'>) => string;
  updateRoom:         (id: string, patch: Partial<SharedRoom>) => void;
  joinRoom:           (roomId: string, userId: string) => void;
  leaveRoom:          (roomId: string, userId: string) => void;
  syncRoomProgress:   (roomId: string, sec: number) => void;
  setRoomActive:      (roomId: string, active: boolean) => void;
  deleteRoom:         (roomId: string) => void;
  sendRoomMessage:    (roomId: string, author: string, text: string) => void;
}

/* ===========================================================================
   STORAGE
   GK  = глобальный ключ (треки, фильмы, комнаты  -  общие для всех)
   upk = per-user ключ   (избранное, плейлисты, prime  -  личное)
=========================================================================== */
const W   = typeof window !== 'undefined';
const GK  = 'sky:platform:global:v1';
const upk = (uid: string) => `sky:platform:user:v1:${uid}`;

if (W) {
  ['sky:platform:v5','sky:platform:v4','sky:platform:v3:global',
   'sky:platform:v3','sky:platform:v2'].forEach(k => {
    try { localStorage.removeItem(k); } catch {}
  });
}

const SEED_TRACKS: Track[] = [
  { id:'trk-1', title:'Neon Run',    artist:'Skyline',    genre:'Synthwave',  duration:'03:24', premium:false, status:'published', plays:1240, likes:[], addedAt:new Date(Date.now()-86400000*3).toISOString(), sourceUrl:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', copyrightType:'license' },
  { id:'trk-2', title:'Raid Pulse',  artist:'Core Audio', genre:'Electronic', duration:'04:10', premium:true,  status:'published', plays:892,  likes:[], addedAt:new Date(Date.now()-86400000*5).toISOString(), sourceUrl:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', copyrightType:'license' },
  { id:'trk-3', title:'Bloom Drift', artist:'Luna',       genre:'Ambient',    duration:'05:01', premium:false, status:'published', plays:673,  likes:[], addedAt:new Date(Date.now()-86400000*7).toISOString(), sourceUrl:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', copyrightType:'license' },
  { id:'trk-4', title:'Sky High',    artist:'Neo Driver', genre:'Electronic', duration:'03:45', premium:false, status:'published', plays:2100, likes:[], addedAt:new Date(Date.now()-86400000*2).toISOString(), sourceUrl:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3', copyrightType:'license' },
  { id:'trk-5', title:'Dark Matter', artist:'Skyline',    genre:'Synthwave',  duration:'04:22', premium:false, status:'published', plays:1580, likes:[], addedAt:new Date(Date.now()-86400000*1).toISOString(), sourceUrl:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3', copyrightType:'license' },
  { id:'trk-6', title:'Overdrive',   artist:'Core Audio', genre:'Rock',       duration:'03:12', premium:false, status:'published', plays:445,  likes:[], addedAt:new Date(Date.now()-86400000*4).toISOString(), sourceUrl:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3', copyrightType:'license' },
];
const SEED_MOVIES: Movie[] = [
  { id:'mov-1', title:'Bloom Horizon',    category:'Фантастика', description:'Молодой пилот обнаруживает таинственный сигнал с края солнечной системы. Экспедиция за его источником меняет всё, что он знал о вселенной.',           duration:'2ч 14м', premium:false, addedAt:new Date().toISOString(), rating:7.8, year:2024, genre:'Фантастика, Приключения', director:'А. Волков', ageRating:'12+', country:'Россия' },
  { id:'mov-2', title:'Raid Protocol',    category:'Боевик',     description:'Элитный отряд специального назначения получает задание в сердце враждебного города. Один на один с целой армией.',                                        duration:'1ч 52м', premium:true,  addedAt:new Date().toISOString(), rating:8.1, year:2024, genre:'Боевик, Триллер',       director:'Н. Дрейк',  ageRating:'18+', country:'США' },
  { id:'mov-3', title:'Neon District',    category:'Триллер',    description:'Детектив расследует серию исчезновений в неоновых кварталах мегаполиса. Следы ведут туда, куда лучше не заходить.',                                       duration:'1ч 48м', premium:false, addedAt:new Date().toISOString(), rating:7.4, year:2023, genre:'Триллер, Детектив',     director:'Л. Ким',    ageRating:'16+', country:'Корея' },
  { id:'mov-4', title:'Deep Signal',      category:'Фантастика', description:'Когда с далёкой звезды приходит сообщение, человечество должно решить: ответить или молчать. Выбор, от которого зависит судьба Земли.',                 duration:'2ч 05м', premium:false, addedAt:new Date().toISOString(), rating:8.5, year:2024, genre:'Фантастика, Драма',     director:'С. Парк',   ageRating:'12+', country:'Япония' },
  { id:'mov-5', title:'Street Kings',     category:'Боевик',     description:'Уличный боец с тёмным прошлым вынужден вернуться в мир, который он пытался забыть. Последняя схватка за тех, кто ему дорог.',                           duration:'1ч 39м', premium:true,  addedAt:new Date().toISOString(), rating:7.2, year:2023, genre:'Боевик, Драма',         director:'М. Чен',    ageRating:'18+', country:'Китай' },
  { id:'mov-6', title:'Hollow Echo',      category:'Ужасы',      description:'Группа исследователей аномалий попадает в заброшенный комплекс, где время работает по другим законам.',                                                   duration:'1ч 44м', premium:false, addedAt:new Date().toISOString(), rating:6.9, year:2023, genre:'Ужасы, Мистика',       director:'Е. Соков',  ageRating:'18+', country:'Россия' },
  { id:'mov-7', title:'Amber Theory',     category:'Драма',      description:'Двое незнакомцев встречаются в поезде и за одну ночь успевают прожить целую жизнь. История о выборе, который нельзя отменить.',                          duration:'1ч 56м', premium:false, addedAt:new Date().toISOString(), rating:8.3, year:2024, genre:'Драма, Мелодрама',      director:'А. Рид',    ageRating:'12+', country:'Франция' },
  { id:'mov-8', title:'Prism Break',      category:'Триллер',    description:'Хакер случайно взламывает сервер, на котором хранится государственная тайна. Теперь за ним охотятся с обеих сторон.',                                   duration:'2ч 02м', premium:true,  addedAt:new Date().toISOString(), rating:7.7, year:2024, genre:'Триллер, Экшн',        director:'Т. Хан',    ageRating:'16+', country:'Германия' },
  { id:'mov-s1', title:'Ночной забег',    category:'Короткометражка', description:'60 секунд из жизни курьера, который не успевает ни на что — но всё равно бежит.', duration:'0м 58с', premium:false, addedAt:new Date().toISOString(), rating:7.9, year:2025, genre:'Драма', director:'И. Орлова', ageRating:'12+', country:'Россия', isShort:true, likes:[] },
  { id:'mov-s2', title:'Комната 404',     category:'Короткометражка', description:'Что находится за дверью, которой нет в плане здания?', duration:'1м 12с', premium:false, addedAt:new Date().toISOString(), rating:8.0, year:2025, genre:'Ужасы', director:'Д. Марков', ageRating:'16+', country:'Россия', isShort:true, likes:[] },
  { id:'mov-s3', title:'Последний трамвай', category:'Короткометражка', description:'Городская зарисовка о случайной встрече двух незнакомцев в час ночи.', duration:'0м 47с', premium:false, addedAt:new Date().toISOString(), rating:7.5, year:2025, genre:'Драма', director:'А. Рид', ageRating:'0+', country:'Франция', isShort:true, likes:[] },
];
const SEED_PLAYLISTS: Playlist[] = [
  { id:'pl-fav', name:'Избранное ❤️', trackIds:[], createdAt:new Date().toISOString() },
];

/* audio binary stored in IndexedDB via audioDB.ts */

const rGlobal = () => {
  if (!W) return null;
  try { return JSON.parse(localStorage.getItem(GK)||'null'); } catch { return null; }
};
const wGlobal = (s: PlatformState) => {
  if (!W) return;
  const payload = {
    tracks: s.tracks.map(t => ({ ...t, sourceUrl: t.isLocal ? undefined : t.sourceUrl })),
    movies: s.movies.map(m => ({ ...m, sourceUrl: m.sourceUrl?.startsWith('blob:') ? undefined : m.sourceUrl })),
    rooms:  s.rooms,
  };
  try { localStorage.setItem(GK, JSON.stringify(payload)); } catch {}
};

const rUser = (uid: string) => {
  if (!W || !uid) return null;
  try { return JSON.parse(localStorage.getItem(upk(uid))||'null'); } catch { return null; }
};
const wUser = (uid: string, s: PlatformState) => {
  if (!W || !uid) return;
  try {
    localStorage.setItem(upk(uid), JSON.stringify({
      isPrime: s.isPrime, primeUntil: s.primeUntil,
      playlists: s.playlists, favorites: s.favorites,
      currentPlaylistId: s.currentPlaylistId,
    }));
  } catch {}
};

const getUid = (): string => {
  if (!W) return '';
  try { return JSON.parse(localStorage.getItem('sky:auth:v4:session')||'{}').id || ''; } catch { return ''; }
};

const initGlobal  = rGlobal();
const initUid     = getUid();
const initUser    = initUid ? rUser(initUid) : null;

// Tracks loaded without audio blob  -  blob URLs restored async from IndexedDB
// Треки, сохранённые прошлыми версиями, могут не содержать plays/likes/status —
// они добираются дефолтами ниже, поэтому тип сохранённой записи мягче Track.
type StoredTrack = Omit<Track, 'plays' | 'likes' | 'status'>
  & Partial<Pick<Track, 'plays' | 'likes' | 'status'>>;

const rawTracks0: StoredTrack[] = initGlobal?.tracks ?? SEED_TRACKS;

const seen0 = new Set<string>();
const initTracks = rawTracks0
  .filter(t => { if (seen0.has(t.id)) return false; seen0.add(t.id); return true; })
  .map(t => ({ plays:0, likes:[], status:'published' as TrackStatus, ...t }));

/* Restore blob URLs on startup  -  runs after store init */
if (W) {
  setTimeout(async () => {
    const localTracks = initTracks.filter(t => t.isLocal);
    for (const t of localTracks) {
      try {
        const url = await loadAudioUrl(t.id);
        if (url) {
          usePlatformStore.setState(s => ({
            tracks: s.tracks.map(tr => tr.id === t.id ? { ...tr, sourceUrl: url } : tr),
          }));
        }
      } catch {}
    }
  }, 100);
}

/* ===========================================================================
   STORE
=========================================================================== */
export const usePlatformStore = create<PlatformState>((set, get) => {
  const uid = () => getUid();
  const saveG = () => setTimeout(() => wGlobal(get()), 0);
  const saveU = () => setTimeout(() => { const u = uid(); if (u) wUser(u, get()); }, 0);
  const saveAll = () => setTimeout(() => { wGlobal(get()); const u = uid(); if (u) wUser(u, get()); }, 0);
  const upTracks = (fn: (t: Track) => Track) => { set(s => ({ tracks: s.tracks.map(fn) })); saveG(); };

  return {
    tracks:            initTracks,
    movies:            initGlobal?.movies  ?? SEED_MOVIES,
    rooms:             initGlobal?.rooms   ?? [],
    isPrime:           initUser?.isPrime           ?? false,
    primeUntil:        initUser?.primeUntil        ?? null,
    playlists:         initUser?.playlists         ?? SEED_PLAYLISTS,
    favorites:         initUser?.favorites         ?? [],
    currentPlaylistId: initUser?.currentPlaylistId ?? null,

    grantPrime:  days => { set({ isPrime:true, primeUntil:new Date(Date.now()+days*86400000).toISOString() }); saveU(); },
    revokePrime: ()   => { set({ isPrime:false, primeUntil:null }); saveU(); },

    addTrack: (p, dataUrl) => {
      const id = `trk-${crypto.randomUUID()}`;
      // Local tracks auto-publish so all accounts can see them
      const status = p.isLocal ? 'published' : (p.status ?? 'private');
      const track: Track = { ...p, id, status, plays:0, likes:[], addedAt:new Date().toISOString() };
      set(s => ({ tracks: [...s.tracks, track] }));
      saveG();
      // Store audio in IndexedDB (no localStorage size limit)
      if (dataUrl) {
        saveAudioDataUrl(id, dataUrl).then(() => {
          // After saving, create blob URL and update track
          loadAudioUrl(id).then(blobUrl => {
            if (blobUrl) {
              usePlatformStore.setState(s => ({
                tracks: s.tracks.map(t => t.id === id ? { ...t, sourceUrl: blobUrl } : t),
              }));
            }
          }).catch(() => {});
        }).catch(() => {});
      }
      return id;
    },
    updateTrack: (id, p) => { upTracks(t => t.id===id ? {...t,...p} : t); },
    deleteTrack: id => {
      const t = get().tracks.find(t => t.id===id);
      if (t?.sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(t.sourceUrl);
      if (t?.isLocal) deleteAudio(id).catch(() => {});
      set(s => ({
        tracks:    s.tracks.filter(t => t.id!==id),
        favorites: s.favorites.filter(f => f!==id),
        playlists: s.playlists.map(p => ({ ...p, trackIds: p.trackIds.filter(tid => tid!==id) })),
      }));
      saveAll();
    },
    submitForReview: id => { upTracks(t => t.id===id && t.status==='private' ? {...t, status:'pending'} : t); },
    approveTrack:    id => { upTracks(t => t.id===id ? {...t, status:'published'} : t); },
    rejectTrack:     id => { upTracks(t => t.id===id ? {...t, status:'private'} : t); },
    incrementPlays: id => {
      set(s => ({ tracks: s.tracks.map(t => t.id===id ? {...t, plays: t.plays+1} : t) }));
      const plays = get().tracks.find(t=>t.id===id)?.plays ?? 0;
      if (plays % 10 === 0) saveG();
    },
    toggleLike: (id, userId) => {
      upTracks(t => t.id===id ? {
        ...t, likes: t.likes.includes(userId) ? t.likes.filter(u=>u!==userId) : [...t.likes, userId]
      } : t);
    },
    toggleFavorite: id => {
      set(s => ({ favorites: s.favorites.includes(id) ? s.favorites.filter(f=>f!==id) : [...s.favorites, id] }));
      saveU();
    },

    createPlaylist: name => {
      const id = `pl-${crypto.randomUUID()}`;
      set(s => ({ playlists: [...s.playlists, { id, name, trackIds:[], createdAt:new Date().toISOString() }] }));
      saveU(); return id;
    },
    deletePlaylist:     id      => { set(s => ({ playlists: s.playlists.filter(p=>p.id!==id), currentPlaylistId: s.currentPlaylistId===id?null:s.currentPlaylistId })); saveU(); },
    renamePlaylist:     (id, n) => { set(s => ({ playlists: s.playlists.map(p=>p.id===id?{...p,name:n}:p) })); saveU(); },
    addToPlaylist:      (plId, tId) => { set(s => ({ playlists: s.playlists.map(p=>p.id===plId&&!p.trackIds.includes(tId)?{...p,trackIds:[...p.trackIds,tId]}:p) })); saveU(); },
    removeFromPlaylist: (plId, tId) => { set(s => ({ playlists: s.playlists.map(p=>p.id===plId?{...p,trackIds:p.trackIds.filter(id=>id!==tId)}:p) })); saveU(); },
    setCurrentPlaylist: id => { set({ currentPlaylistId: id }); saveU(); },

    addMovie: p => { set(s => ({ movies: [...s.movies, { ...p, id:`mov-${crypto.randomUUID()}`, addedAt:new Date().toISOString() }] })); saveG(); },
    updateMovie: (id, p) => { set(s => ({ movies: s.movies.map(m=>m.id===id?{...m,...p}:m) })); saveG(); },
    toggleMovieLike: (id, userId) => {
      set(s => ({ movies: s.movies.map(m => m.id===id
        ? { ...m, likes: (m.likes ?? []).includes(userId) ? (m.likes ?? []).filter(u=>u!==userId) : [...(m.likes ?? []), userId] }
        : m) }));
      saveG();
    },
    deleteMovie: id => {
      const m = get().movies.find(m=>m.id===id);
      if (m?.sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(m.sourceUrl);
      set(s => ({ movies: s.movies.filter(m=>m.id!==id) })); saveG();
    },

    createRoom: p => {
      const id = `room-${crypto.randomUUID()}`;
      set(s => ({ rooms: [...s.rooms, { ...p, id, progressSec:0, active:true, participants:[], chatMessages:[] }] }));
      saveG(); return id;
    },
    updateRoom:       (id, patch) => { set(s => ({ rooms: s.rooms.map(r=>r.id===id?{...r,...patch}:r) })); saveG(); },
    joinRoom:         (roomId, userId) => { set(s => ({ rooms: s.rooms.map(r=>r.id===roomId&&!r.participants.includes(userId)?{...r,participants:[...r.participants,userId]}:r) })); saveG(); },
    leaveRoom:        (roomId, userId) => { set(s => ({ rooms: s.rooms.map(r=>r.id===roomId?{...r,participants:r.participants.filter(p=>p!==userId)}:r) })); saveG(); },
    syncRoomProgress: (id, sec)    => { set(s => ({ rooms: s.rooms.map(r=>r.id===id?{...r,progressSec:sec}:r) })); saveG(); },
    setRoomActive:    (id, active) => { set(s => ({ rooms: s.rooms.map(r=>r.id===id?{...r,active}:r) })); saveG(); },
    deleteRoom:       id           => { set(s => ({ rooms: s.rooms.filter(r=>r.id!==id) })); saveG(); },
    sendRoomMessage:  (roomId, author, text) => {
      const msg = { author, text, time: new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) };
      set(s => ({ rooms: s.rooms.map(r=>r.id===roomId?{...r,chatMessages:[...r.chatMessages,msg]}:r) }));
      saveG();
    },
  };
});

/* -- Grant prime directly to any user's storage (admin use) ------------ */
export const grantPrimeForUser = (userId: string, days: number) => {
  if (!W || !userId) return;
  try {
    const existing = rUser(userId);
    const until = new Date(Date.now() + days * 86400000).toISOString();
    const updated = { ...(existing ?? {}), isPrime: true, primeUntil: until };
    localStorage.setItem(upk(userId), JSON.stringify(updated));
    // Also update live store if this is the current logged-in user
    if (userId === getUid()) {
      usePlatformStore.setState({ isPrime: true, primeUntil: until });
    }
  } catch {}
};

/* ===========================================================================
   Перезагрузка при смене аккаунта  -  вызывается из main.tsx
=========================================================================== */
/* Восстанавливаем blob URL из IndexedDB для локальных треков после загрузки */
const restoreAudioUrlsFromIndexedDB = async () => {
  const tracks = usePlatformStore.getState().tracks;
  const localTracks = tracks.filter(t => t.isLocal && !t.sourceUrl?.startsWith('blob:'));
  if (localTracks.length === 0) return;
  for (const t of localTracks) {
    try {
      const url = await loadAudioUrl(t.id);
      if (url) {
        usePlatformStore.setState(s => ({
          tracks: s.tracks.map(tr => tr.id === t.id ? { ...tr, sourceUrl: url } : tr),
        }));
      }
    } catch {}
  }
};

export const reloadPlatformForUser = (uid: string) => {
  const globalData = rGlobal();
  const userData   = uid ? rUser(uid) : null;

  const raw2: StoredTrack[] = globalData?.tracks ?? SEED_TRACKS;

  const seen2 = new Set<string>();
  const tracks2 = raw2
    .filter(t => { if (seen2.has(t.id)) return false; seen2.add(t.id); return true; })
    .map(t => ({ plays:0, likes:[], status:'published' as TrackStatus, ...t }));

  usePlatformStore.setState({
    tracks:            tracks2,
    movies:            globalData?.movies ?? SEED_MOVIES,
    rooms:             globalData?.rooms  ?? [],
    isPrime:           userData?.isPrime           ?? false,
    primeUntil:        userData?.primeUntil        ?? null,
    playlists:         userData?.playlists         ?? SEED_PLAYLISTS,
    favorites:         userData?.favorites         ?? [],
    currentPlaylistId: userData?.currentPlaylistId ?? null,
  });

  // Restore audio blob URLs from IndexedDB async
  restoreAudioUrlsFromIndexedDB();
};
