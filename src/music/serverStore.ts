/**
 * Состояние Sky Music, приходящее с сервера.
 *
 * Прежний источник данных — localStorage и IndexedDB устройства —
 * оставлен для фильмов и комнат, а музыка теперь живёт на сервере:
 * только так она одинакова на всех устройствах и только так её можно
 * защитить.
 *
 * Треки приводятся к тому же виду, каким пользуется интерфейс музыки с
 * самого начала, поэтому ни один экран переписывать не пришлось.
 */
import { create } from 'zustand';
import type { Track } from '@/platform/store';
import {
  apiTracks, apiFavorites, apiSetFavorite, apiHistory, apiNotePlay,
  apiPlaylists, apiCreatePlaylist, apiRenamePlaylist, apiDeletePlaylist,
  apiAddToPlaylist, apiRemoveFromPlaylist, apiReorderPlaylist,
  apiProgress, apiSetProgress, apiUploadTrack, apiPatchTrack, apiDeleteTrack, apiSubmitTrack, apiTrackKeep, apiTrack,
  apiMediaTicket, toClientTrack, type ServerPlaylist, type UploadMeta,
} from './musicApi';

export interface MusicPlaylist {
  id: string;
  name: string;
  isPublic: boolean;
  count: number;
  trackIds: string[];
  tracks: Track[];
}

const toPlaylist = (p: ServerPlaylist): MusicPlaylist => ({
  id: p.id,
  name: p.name,
  isPublic: p.isPublic,
  count: p.count,
  trackIds: (p.tracks ?? []).map((t) => t.id),
  tracks: (p.tracks ?? []).map(toClientTrack),
});

interface MusicState {
  tracks: Track[];
  favorites: string[];
  history: Track[];
  playlists: MusicPlaylist[];
  progress: Record<string, number>;
  /** Состояния экрана: пусто, грузим, не получилось. */
  loading: boolean;
  error: string | null;
  loaded: boolean;

  load: (opts?: { force?: boolean }) => Promise<void>;
  search: (q: string) => Promise<Track[]>;

  toggleFavorite: (trackId: string) => Promise<void>;
  notePlay: (trackId: string) => Promise<void>;
  saveProgress: (trackId: string, seconds: number) => void;

  createPlaylist: (name: string) => Promise<MusicPlaylist | null>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addToPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  reorderPlaylist: (playlistId: string, order: string[]) => Promise<void>;

  upload: (file: Blob, meta: UploadMeta) => Promise<{ ok: boolean; reason?: string; id?: string }>;
  /** Отправить свой трек на проверку — путь в общий каталог. */
  submitForReview: (trackId: string) => Promise<void>;
  /** Снять с публикации или отозвать заявку. */
  publish: (trackId: string, published: boolean) => Promise<void>;
  removeTrack: (trackId: string) => Promise<void>;
  /** «Хранить без срока» для личного трека. */
  setKeep: (trackId: string, keep: boolean) => Promise<boolean>;
}

/**
 * Позиция прослушивания сохраняется не на каждый тик, а раз в
 * несколько секунд: иначе на сервер летел бы запрос каждые 250 мс.
 */
const PROGRESS_EVERY_MS = 5000;
let lastProgressAt = 0;

export const useMusicStore = create<MusicState>((set, get) => ({
  tracks: [],
  favorites: [],
  history: [],
  playlists: [],
  progress: {},
  loading: false,
  error: null,
  loaded: false,

  load: async ({ force } = {}) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true, error: null });
    // Сначала пропуск: без него теги <audio> и <img> получат отказ.
    await apiMediaTicket();
    const [tracks, favs, hist, pls, prog] = await Promise.all([
      apiTracks({ limit: 100 }), apiFavorites(), apiHistory(), apiPlaylists(), apiProgress(),
    ]);
    if (tracks === null) {
      set({ loading: false, error: 'Не удалось загрузить музыку' });
      return;
    }
    // Любимое и история могут лежать за пределами первой страницы каталога — добавляем их в общий список,
    // иначе «Любимые» на любом устройстве теряли бы такие треки.
    const known = new Set(tracks.map((t) => t.id));
    const extra = [...(favs ?? []), ...(hist ?? [])].filter((t) => !known.has(t.id) && (known.add(t.id), true));
    set({
      tracks: [...tracks, ...extra].map(toClientTrack),
      favorites: (favs ?? []).map((t) => t.id),
      history: (hist ?? []).map(toClientTrack),
      playlists: (pls ?? []).map(toPlaylist),
      progress: Object.fromEntries((prog ?? []).map((p) => [p.trackId, p.position])),
      loading: false,
      loaded: true,
      error: null,
    });
  },

  search: async (q) => {
    const found = await apiTracks({ q, limit: 60 });
    return (found ?? []).map(toClientTrack);
  },

  toggleFavorite: async (trackId) => {
    const on = !get().favorites.includes(trackId);
    // Отклик сразу, правда — от сервера: если он откажет, вернём как было.
    const before = get().favorites;
    set({ favorites: on ? [...before, trackId] : before.filter((f) => f !== trackId) });
    const fresh = await apiSetFavorite(trackId, on);
    if (fresh === null) { set({ favorites: before }); return; }
    set({ favorites: fresh.map((t) => t.id) });
  },

  notePlay: async (trackId) => {
    await apiNotePlay(trackId);
    const hist = await apiHistory();
    if (hist) set({ history: hist.map(toClientTrack) });
  },

  saveProgress: (trackId, seconds) => {
    const now = Date.now();
    if (now - lastProgressAt < PROGRESS_EVERY_MS) return;
    lastProgressAt = now;
    set((s) => ({ progress: { ...s.progress, [trackId]: Math.floor(seconds) } }));
    void apiSetProgress(trackId, seconds);
  },

  createPlaylist: async (name) => {
    const pl = await apiCreatePlaylist(name);
    if (!pl) return null;
    const made = toPlaylist(pl);
    set((s) => ({ playlists: [made, ...s.playlists] }));
    return made;
  },

  renamePlaylist: async (id, name) => {
    if (!(await apiRenamePlaylist(id, name))) return;
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name } : p)) }));
  },

  deletePlaylist: async (id) => {
    if (!(await apiDeletePlaylist(id))) return;
    set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }));
  },

  addToPlaylist: async (playlistId, trackId) => {
    const pl = await apiAddToPlaylist(playlistId, trackId);
    if (!pl) return;
    const made = toPlaylist(pl);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === playlistId ? made : p)) }));
  },

  removeFromPlaylist: async (playlistId, trackId) => {
    const pl = await apiRemoveFromPlaylist(playlistId, trackId);
    if (!pl) return;
    const made = toPlaylist(pl);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === playlistId ? made : p)) }));
  },

  reorderPlaylist: async (playlistId, order) => {
    const pl = await apiReorderPlaylist(playlistId, order);
    if (!pl) return;
    const made = toPlaylist(pl);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === playlistId ? made : p)) }));
  },

  upload: async (file, meta) => {
    const res = await apiUploadTrack(file, meta);
    if (!res.ok || !res.track) return { ok: false, reason: res.reason };
    set((s) => ({ tracks: [toClientTrack(res.track!), ...s.tracks] }));
    return { ok: true, id: res.track.id };
  },

  submitForReview: async (trackId) => {
    const t = await apiSubmitTrack(trackId);
    if (!t) return;
    set((s) => ({ tracks: s.tracks.map((x) => (x.id === trackId ? toClientTrack(t) : x)) }));
  },

  publish: async (trackId, published) => {
    const t = await apiPatchTrack(trackId, { status: published ? 'published' : 'private' });
    if (!t) return;
    set((s) => ({ tracks: s.tracks.map((x) => (x.id === trackId ? toClientTrack(t) : x)) }));
  },

  setKeep: async (trackId, keep) => {
    if (!(await apiTrackKeep(trackId, keep))) return false;
    const t = await apiTrack(trackId);
    if (t) set((s) => ({ tracks: s.tracks.map((x) => (x.id === trackId ? toClientTrack(t) : x)) }));
    return true;
  },

  removeTrack: async (trackId) => {
    if (!(await apiDeleteTrack(trackId))) return;
    set((s) => ({
      tracks: s.tracks.filter((t) => t.id !== trackId),
      favorites: s.favorites.filter((f) => f !== trackId),
      history: s.history.filter((t) => t.id !== trackId),
    }));
  },
}));

/** Сброс при смене профиля: чужая музыка не должна остаться на экране. */
export const resetMusicForUser = () => {
  useMusicStore.setState({
    tracks: [], favorites: [], history: [], playlists: [], progress: {},
    loaded: false, loading: false, error: null,
  });
};
