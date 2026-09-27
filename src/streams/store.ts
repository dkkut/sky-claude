/* ===============================================================
   SKY STREAMS — реестр активных трансляций.

   Раньше синхронизация шла через BroadcastChannel — трансляция была
   видна только соседним вкладкам того же браузера, не другим людям.
   Теперь список и метаданные — с сервера (server/streams.mjs, HTTP),
   а всё живое (чат/реакции/прогнозы/донаты/кто смотрит) — через тот же
   WS-хаб, что и войс-пати (wireSend снаружи, applyX изнутри —
   диспетчеризация в src/messenger/socket.ts).
=============================================================== */
import { create } from 'zustand';
import { wireSend } from '@/core/wire';
import {
  apiStreamsList, apiStreamGet, apiStreamCreate, apiStreamEnd, apiStreamDonate,
  type CreateStreamInput,
} from './streamsApi';

export type StreamCategory = 'gaming'|'talk'|'music'|'creative'|'sport'|'irl'|'other';
export const CATEGORY_LABEL: Record<StreamCategory,string> = {
  gaming:'Игры', talk:'Общение', music:'Музыка', creative:'Творчество', sport:'Спорт', irl:'IRL', other:'Другое',
};

export interface StreamChatMsg {
  id: string; userId: string; userName: string; text: string; createdAt: number;
  isDonation?: boolean; donationAmount?: number;
}

export interface StreamPrediction {
  id: string; question: string; options: string[];
  votes: Record<string, number>;  // userId -> optionIdx
  closed: boolean; createdAt: number;
}

export interface LiveStreamEntry {
  id: string;
  authorId: string; authorName: string; authorUsername?: string; authorAvatar: string | null;
  title: string; description?: string; category: StreamCategory; tags: string[];
  startedAt: number;
  endedAt?: number | null;
  ended: boolean;
  viewerCount: number;         // реальное число с сервера — не массив ID (не наше дело, кто именно смотрит)
  peakViewers: number;
  chat: StreamChatMsg[];
  reactions: Record<string, number>;  // emoji -> count (нарастающим итогом)
  predictions: StreamPrediction[];
  source: 'camera' | 'screen';        // текущая «сцена»
  totalDonationsPoints: number;        // реальная сумма донатов SkyCoin за стрим
}

interface StreamsState {
  streams: Record<string, LiveStreamEntry>;

  loadList: () => Promise<void>;
  ensureLoaded: (id: string) => Promise<void>;
  create: (input: CreateStreamInput) => Promise<LiveStreamEntry | null>;
  end: (id: string) => Promise<void>;
  donate: (id: string, amount: number, message: string) => Promise<{ ok: true } | { error: string }>;

  join: (id: string) => void;
  leave: (id: string) => void;
  sendChat: (id: string, text: string) => void;
  react: (id: string, emoji: string) => void;
  createPrediction: (id: string, question: string, options: string[]) => void;
  voteOnPrediction: (id: string, predictionId: string, optIdx: number) => void;
  closePrediction: (id: string, predictionId: string) => void;
  kick: (id: string, targetId: string) => void;
  ban: (id: string, targetId: string) => void;

  /* Входящее с сервера — зовёт src/messenger/socket.ts. */
  applyJoined: (stream: LiveStreamEntry) => void;
  applyViewerJoined: (streamId: string, viewerId: string, viewerCount: number) => void;
  applyViewerLeft: (streamId: string, viewerCount?: number) => void;
  applyChat: (streamId: string, message: StreamChatMsg) => void;
  applyReact: (streamId: string, emoji: string, count: number) => void;
  applyPredictionCreate: (streamId: string, prediction: StreamPrediction) => void;
  applyPredictionUpdate: (streamId: string, prediction: StreamPrediction) => void;
  applyKicked: (streamId: string) => void;
  applyEnded: (streamId: string) => void;
  applyDonation: (streamId: string, message: StreamChatMsg | null, totalDonationsPoints: number) => void;
}

const patch = (
  set: (fn: (s: StreamsState) => Partial<StreamsState>) => void,
  id: string, fn: (e: LiveStreamEntry) => LiveStreamEntry,
) => set((s) => (s.streams[id] ? { streams: { ...s.streams, [id]: fn(s.streams[id]) } } : s));

export const useStreamsStore = create<StreamsState>((set, get) => ({
  streams: {},

  loadList: async () => {
    const list = await apiStreamsList();
    set((s) => {
      const streams = { ...s.streams };
      for (const entry of list) {
        const prev = streams[entry.id];
        // Уже открытый эфир держим на живом WS-состоянии (чат/реакции/
        // прогнозы копятся инкрементально) — обновляем только то, что
        // безопасно перезаписать снимком каталога.
        streams[entry.id] = prev
          ? { ...prev, ended: entry.ended, endedAt: entry.endedAt, viewerCount: entry.viewerCount, peakViewers: entry.peakViewers, totalDonationsPoints: entry.totalDonationsPoints, title: entry.title, category: entry.category, tags: entry.tags, source: entry.source }
          : entry;
      }
      // Эфиры, которых больше нет в списке живых (кто-то другой снял с
      // публикации, пока мы не смотрели) — оставляем в кэше как есть,
      // это дело live:ended, а не каталога.
      return { streams };
    });
  },

  ensureLoaded: async (id) => {
    if (get().streams[id]) return;
    const entry = await apiStreamGet(id);
    if (entry) set((s) => ({ streams: { ...s.streams, [id]: entry } }));
  },

  create: async (input) => {
    const r = await apiStreamCreate(input);
    if ('error' in r) return null;
    set((s) => ({ streams: { ...s.streams, [r.id]: r } }));
    return r;
  },

  end: async (id) => {
    await apiStreamEnd(id);
    patch(set, id, (e) => ({ ...e, ended: true, endedAt: Date.now() }));
  },

  donate: async (id, amount, message) => apiStreamDonate(id, amount, message, crypto.randomUUID()),

  join: (id) => wireSend({ type: 'live:join', payload: { streamId: id } }),
  leave: (id) => wireSend({ type: 'live:leave', payload: { streamId: id } }),
  sendChat: (id, text) => wireSend({ type: 'live:chat', payload: { streamId: id, text } }),
  react: (id, emoji) => wireSend({ type: 'live:react', payload: { streamId: id, emoji } }),
  createPrediction: (id, question, options) => wireSend({ type: 'live:predict-create', payload: { streamId: id, question, options } }),
  voteOnPrediction: (id, predictionId, optIdx) => wireSend({ type: 'live:predict-vote', payload: { streamId: id, predictionId, optIdx } }),
  closePrediction: (id, predictionId) => wireSend({ type: 'live:predict-close', payload: { streamId: id, predictionId } }),
  kick: (id, targetId) => wireSend({ type: 'live:kick', payload: { streamId: id, targetId } }),
  ban: (id, targetId) => wireSend({ type: 'live:ban', payload: { streamId: id, targetId } }),

  applyJoined: (stream) => set((s) => ({ streams: { ...s.streams, [stream.id]: stream } })),
  applyViewerJoined: (streamId, _viewerId, viewerCount) => patch(set, streamId, (e) => ({ ...e, viewerCount })),
  applyViewerLeft: (streamId, viewerCount) => patch(set, streamId, (e) => ({ ...e, viewerCount: viewerCount ?? Math.max(0, e.viewerCount - 1) })),
  applyChat: (streamId, message) => patch(set, streamId, (e) => ({ ...e, chat: [...e.chat, message].slice(-200) })),
  applyReact: (streamId, emoji, count) => patch(set, streamId, (e) => ({ ...e, reactions: { ...e.reactions, [emoji]: count } })),
  applyPredictionCreate: (streamId, prediction) => patch(set, streamId, (e) => ({ ...e, predictions: [...e.predictions, prediction] })),
  applyPredictionUpdate: (streamId, prediction) => patch(set, streamId, (e) => ({ ...e, predictions: e.predictions.map((p) => (p.id === prediction.id ? prediction : p)) })),
  applyKicked: (streamId) => patch(set, streamId, (e) => ({ ...e, ended: true, endedAt: Date.now() })),
  applyEnded: (streamId) => patch(set, streamId, (e) => ({ ...e, ended: true, endedAt: Date.now() })),
  applyDonation: (streamId, message, totalDonationsPoints) => patch(set, streamId, (e) => ({
    ...e, totalDonationsPoints, chat: message ? [...e.chat, message].slice(-200) : e.chat,
  })),
}));
