/**
 * Состояние Sky Video/Studio, приходящее с сервера.
 *
 * Лента и «моё» держатся порознь по той же причине, что у Sky Film:
 * это разные множества с разными правами, и общий список рано или
 * поздно показал бы чужой черновик там, где ему быть не положено.
 *
 * Ничего здесь не является защитой — если браузер переписать и
 * попросить чужое, сервер откажет сам.
 */
import { create } from 'zustand';
import {
  apiSkyVideoFeed, apiSkyVideoCategories, apiMySkyVideos, apiSkyVideoTicket,
  apiSetSkyVideoLiked, apiCountSkyVideoView, apiPublishSkyVideo, apiPatchSkyVideo,
  apiDeleteSkyVideo, apiUploadSkyVideo, apiUploadSkyVideoThumbnail,
  apiRequestSkyVideoMonetization,
  type ServerVideo, type UploadMeta,
} from './skyVideoApi';

interface SkyVideoState {
  feed: ServerVideo[];
  mine: ServerVideo[];
  categories: string[];
  loading: boolean;
  loaded: boolean;
  error: string | null;

  load: (opts?: { force?: boolean }) => Promise<void>;
  refreshMine: () => Promise<void>;
  search: (q: string) => Promise<ServerVideo[]>;

  toggleLiked: (videoId: string) => Promise<void>;
  noteView: (videoId: string) => Promise<void>;

  upload: (file: Blob, meta: UploadMeta, onProgress?: (p: number) => void)
    => { promise: Promise<{ ok: boolean; reason?: string; id?: string }>; cancel: () => void };
  setThumbnail: (videoId: string, file: Blob) => Promise<boolean>;
  publish: (videoId: string, on: boolean) => Promise<void>;
  editVideo: (videoId: string, patch: Parameters<typeof apiPatchSkyVideo>[1]) => Promise<void>;
  removeVideo: (videoId: string) => Promise<void>;
  requestMonetization: (videoId: string) => Promise<{ ok: boolean; reason?: string }>;
}

/** Заменить ролик во всех списках, где он есть. */
const replace = (s: SkyVideoState, v: ServerVideo) => ({
  feed: s.feed.map((x) => (x.id === v.id ? v : x)),
  mine: s.mine.map((x) => (x.id === v.id ? v : x)),
});

export const useSkyVideoStore = create<SkyVideoState>((set, get) => ({
  feed: [],
  mine: [],
  categories: [],
  loading: false,
  loaded: false,
  error: null,

  load: async ({ force } = {}) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true, error: null });
    await apiSkyVideoTicket();
    const [feed, mine, cats] = await Promise.all([
      apiSkyVideoFeed({ limit: 100 }), apiMySkyVideos(), apiSkyVideoCategories(),
    ]);
    if (feed === null) {
      set({ loading: false, error: 'Не удалось загрузить Sky Video' });
      return;
    }
    set({
      feed, mine: mine ?? [], categories: cats ?? [],
      loading: false, loaded: true, error: null,
    });
  },

  refreshMine: async () => {
    const mine = await apiMySkyVideos();
    if (mine) set({ mine });
  },

  search: async (q) => (await apiSkyVideoFeed({ q, limit: 60 })) ?? [],

  toggleLiked: async (videoId) => {
    const current = [...get().feed, ...get().mine].find((v) => v.id === videoId);
    if (!current) return;
    const v = await apiSetSkyVideoLiked(videoId, !current.liked);
    if (v) set((s) => replace(s, v));
  },

  noteView: async (videoId) => { await apiCountSkyVideoView(videoId); },

  upload: (file, meta, onProgress) => {
    const { promise, cancel } = apiUploadSkyVideo(file, meta, onProgress);
    return {
      cancel,
      promise: promise.then((res) => {
        if (!res.ok || !res.video) return { ok: false, reason: res.reason };
        set((s) => ({ mine: [res.video!, ...s.mine] }));
        return { ok: true, id: res.video.id };
      }),
    };
  },

  setThumbnail: async (videoId, file) => {
    if (!(await apiUploadSkyVideoThumbnail(videoId, file))) return false;
    await get().refreshMine();
    return true;
  },

  publish: async (videoId, on) => {
    const v = await apiPublishSkyVideo(videoId, on);
    if (!v) return;
    set((s) => ({
      ...replace(s, v),
      feed: on ? s.feed : s.feed.filter((x) => x.id !== videoId),
    }));
    if (on) {
      const fresh = await apiSkyVideoFeed({ limit: 100 });
      if (fresh) set({ feed: fresh });
    }
  },

  editVideo: async (videoId, patch) => {
    const v = await apiPatchSkyVideo(videoId, patch);
    if (v) set((s) => replace(s, v));
  },

  removeVideo: async (videoId) => {
    if (!(await apiDeleteSkyVideo(videoId))) return;
    set((s) => ({
      feed: s.feed.filter((v) => v.id !== videoId),
      mine: s.mine.filter((v) => v.id !== videoId),
    }));
  },

  requestMonetization: async (videoId) => {
    const res = await apiRequestSkyVideoMonetization(videoId);
    if (res.ok) await get().refreshMine();
    return res;
  },
}));

/** Сброс при смене профиля — чужие ролики не должны остаться на экране. */
export const resetSkyVideoForUser = () => {
  useSkyVideoStore.setState({
    feed: [], mine: [], categories: [],
    loaded: false, loading: false, error: null,
  });
};
