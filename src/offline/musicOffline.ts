/**
 * Офлайн-музыка: скачивание треков в хранилище устройства (IndexedDB,
 * см. offlineDB.ts) — по одному и пачкой («всё избранное», «вся личная
 * коллекция»).
 *
 * Как и для кино, файл забирается потоком и кладётся блобом как есть, без
 * перевода в строку base64 (она раздувала файл на треть и поднимала его
 * целиком в память вкладки). Скачанное проигрывается и без сети — экран
 * OfflineMode читает то же хранилище, а PlayerEngine предпочитает
 * локальную копию сетевой, когда она есть.
 *
 * Пачка идёт по два трека сразу, пропускает уже скачанное, останавливается
 * при нехватке места и по кнопке «Отмена»; отдельный сбой одного трека не
 * обрывает остальные.
 */
import { create } from 'zustand';
import type { Track } from '@/platform/store';
import { audioUrl, coverUrl, apiMediaTicket } from '@/music/musicApi';
import { getG } from '@/music/utils';
import { flash } from '@/shared/flash';
import {
  saveDownload, listDownloads, deleteDownload, type DownloadedItem,
} from './offlineDB';

/** Запас свободного места, который не трогаем (системе и другим сайтам). */
const FREE_MARGIN = 120 * 1024 * 1024;
const PARALLEL = 2;

export type BulkState = {
  running: boolean;
  label: string;
  total: number;
  done: number;
  failed: number;
  /** Причина остановки, если пачка не дошла до конца сама. */
  stopped?: 'cancelled' | 'no_space';
} | null;

interface OfflineMusicState {
  ids: Set<string>;
  bytes: number;
  loaded: boolean;
  /** 0…1 по скачиваемым прямо сейчас трекам. */
  progress: Record<string, number>;
  bulk: BulkState;

  hydrate: () => Promise<void>;
  has: (id: string) => boolean;
  download: (track: Track) => Promise<'ok' | 'fail' | 'no_space'>;
  downloadAll: (tracks: Track[], label: string) => Promise<void>;
  cancel: () => void;
  remove: (id: string) => Promise<void>;
  removeAll: () => Promise<void>;
}

let cancelled = false;
const controllers = new Set<AbortController>();

/** Сколько ещё можно положить; null — браузер не говорит. */
const freeBytes = async (): Promise<number | null> => {
  try {
    const e = await navigator.storage?.estimate?.();
    if (e?.quota == null || e.usage == null) return null;
    return e.quota - e.usage;
  } catch { return null; }
};

const isQuotaError = (e: unknown) => {
  const n = (e as { name?: string } | null)?.name;
  return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED';
};

/** Тело ответа с прогрессом; без ReadableStream (старые браузеры) — просто blob(). */
const readBlob = async (resp: Response, onProgress: (p: number) => void, signal: AbortSignal) => {
  const total = Number(resp.headers.get('content-length') || 0);
  const type = resp.headers.get('content-type') || 'audio/mpeg';
  if (!resp.body) { const b = await resp.blob(); onProgress(1); return b; }
  const reader = resp.body.getReader();
  const parts: BlobPart[] = [];
  let got = 0;
  for (;;) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total > 0) onProgress(Math.min(0.99, got / total));
  }
  onProgress(1);
  return new Blob(parts, { type });
};

const fetchAudio = async (id: string, onProgress: (p: number) => void, signal: AbortSignal) => {
  const go = () => fetch(audioUrl(id), { signal });
  let resp = await go();
  // Пропуск на выдачу мог протухнуть: обновляем и повторяем один раз.
  if (resp.status === 401 || resp.status === 403) {
    if (await apiMediaTicket()) resp = await go();
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const need = Number(resp.headers.get('content-length') || 0);
  const free = await freeBytes();
  if (free !== null && need > 0 && need + FREE_MARGIN > free) {
    void resp.body?.cancel();
    throw Object.assign(new Error('no_space'), { code: 'no_space' });
  }
  return readBlob(resp, onProgress, signal);
};

const fetchCover = async (id: string, signal: AbortSignal): Promise<Blob | null> => {
  try {
    const r = await fetch(coverUrl(id), { signal });
    return r.ok ? await r.blob() : null;
  } catch { return null; }
};

export const useOfflineMusic = create<OfflineMusicState>((set, get) => ({
  ids: new Set(),
  bytes: 0,
  loaded: false,
  progress: {},
  bulk: null,

  hydrate: async () => {
    try {
      const list = await listDownloads('track');
      set({ ids: new Set(list.map((i) => i.id)), bytes: list.reduce((n, i) => n + (i.bytes || 0), 0), loaded: true });
    } catch { set({ loaded: true }); }
  },

  has: (id) => get().ids.has(id),

  download: async (track) => {
    if (get().ids.has(track.id) || track.id in get().progress) return 'ok';
    const ctl = new AbortController();
    controllers.add(ctl);
    const setP = (p: number) => set((s) => ({ progress: { ...s.progress, [track.id]: p } }));
    setP(0);
    try {
      // Просим сохранённое хранилище: без этого iOS/Safari вправе стереть
      // скачанное через неделю неиспользования. Отказ не мешает.
      void navigator.storage?.persist?.().catch(() => {});
      const blob = await fetchAudio(track.id, setP, ctl.signal);
      const cover = track.coverUrl ? await fetchCover(track.id, ctl.signal) : null;
      const [g1, g2] = getG(track.id);
      const meta: DownloadedItem = {
        id: track.id, kind: 'track', title: track.title, artist: track.artist,
        duration: track.duration, mimeType: blob.type || track.mimeType || 'audio/mpeg',
        bytes: blob.size, addedAt: new Date().toISOString(), coverGrad: [g1, g2],
      };
      await saveDownload(meta, blob, cover);
      set((s) => ({ ids: new Set(s.ids).add(track.id), bytes: s.bytes + blob.size }));
      return 'ok';
    } catch (e) {
      if ((e as { code?: string })?.code === 'no_space' || isQuotaError(e)) return 'no_space';
      return 'fail';
    } finally {
      controllers.delete(ctl);
      set((s) => { const { [track.id]: _gone, ...rest } = s.progress; return { progress: rest }; });
    }
  },

  downloadAll: async (tracks, label) => {
    if (get().bulk?.running) return;
    const todo = tracks.filter((t) => !t.isLocal && !get().ids.has(t.id));
    if (todo.length === 0) { flash('Всё из этого списка уже скачано'); return; }
    cancelled = false;
    set({ bulk: { running: true, label, total: todo.length, done: 0, failed: 0 } });
    await apiMediaTicket().catch(() => false);

    let next = 0;
    let stopped: 'cancelled' | 'no_space' | undefined;
    const worker = async () => {
      while (!stopped) {
        if (cancelled) { stopped = 'cancelled'; return; }
        const t = todo[next++];
        if (!t) return;
        const r = await get().download(t);
        if (cancelled) { stopped = 'cancelled'; return; }
        if (r === 'no_space') { stopped = 'no_space'; return; }
        set((s) => s.bulk ? { bulk: { ...s.bulk, done: s.bulk.done + (r === 'ok' ? 1 : 0), failed: s.bulk.failed + (r === 'fail' ? 1 : 0) } } : s);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));

    const b = get().bulk;
    set({ bulk: b ? { ...b, running: false, stopped } : null });
    if (stopped === 'no_space') flash(`Не хватило места на устройстве: скачано ${b?.done ?? 0} из ${todo.length}. Удалите что-нибудь ненужное и повторите.`);
    else if (stopped === 'cancelled') flash(`Скачивание остановлено: скачано ${b?.done ?? 0} из ${todo.length}`);
    else if ((b?.failed ?? 0) > 0) flash(`Скачано ${b?.done ?? 0}, не удалось ${b?.failed}. Повторите — готовое пропустится.`);
    else flash(`Готово: скачано ${b?.done ?? todo.length}. Эти треки играют без сети.`);
    setTimeout(() => { if (!get().bulk?.running) set({ bulk: null }); }, 6000);
  },

  cancel: () => {
    cancelled = true;
    controllers.forEach((c) => c.abort());
  },

  remove: async (id) => {
    await deleteDownload(id).catch(() => {});
    set((s) => { const ids = new Set(s.ids); ids.delete(id); return { ids }; });
    void get().hydrate();
  },

  removeAll: async () => {
    const list = await listDownloads('track').catch(() => [] as DownloadedItem[]);
    for (const i of list) await deleteDownload(i.id).catch(() => {});
    set({ ids: new Set(), bytes: 0 });
  },
}));
