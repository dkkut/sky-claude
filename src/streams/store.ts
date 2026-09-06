/* ===============================================================
   SKY STREAMS — реестр активных трансляций.
   Тот же паттерн BroadcastChannel, что уже используют Stories и
   звонки (bsignal) — реальная кросс-вкладочная синхронизация,
   а не фейковые данные.
=============================================================== */
import { create } from 'zustand';

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
  authorId: string; authorName: string; authorAvatar: string;
  title: string; category: StreamCategory; tags: string[];
  startedAt: number;
  viewerIds: string[];        // реальные ID зрителей — не число «с потолка»
  peakViewers: number;
  chat: StreamChatMsg[];
  reactions: Record<string, number>;  // emoji -> count (нарастающим итогом)
  predictions: StreamPrediction[];
  source: 'camera' | 'screen';        // текущая «сцена»
  ended?: boolean; endedAt?: number;
  totalDonations: number;             // реальная сумма донатов SkyCoin за стрим
}

type WireMsg =
  | { type:'stream-start'; entry: LiveStreamEntry }
  | { type:'stream-end';   id: string }
  | { type:'stream-update'; id: string; patch: Partial<LiveStreamEntry> }
  | { type:'stream-join';  id: string; userId: string }
  | { type:'stream-leave'; id: string; userId: string }
  | { type:'stream-chat';  id: string; msg: StreamChatMsg }
  | { type:'stream-react'; id: string; emoji: string }
  | { type:'stream-predict-create'; id: string; prediction: StreamPrediction }
  | { type:'stream-predict-vote';   id: string; predictionId: string; userId: string; optIdx: number }
  | { type:'stream-predict-close';  id: string; predictionId: string };

const BC = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sky:streams:v1') : null;

interface StreamsState {
  streams: Record<string, LiveStreamEntry>;

  publish: (entry: LiveStreamEntry) => void;
  unpublish: (id: string) => void;
  updateStream: (id: string, patch: Partial<LiveStreamEntry>) => void;
  join: (id: string, userId: string) => void;
  leave: (id: string, userId: string) => void;
  sendChat: (id: string, msg: StreamChatMsg) => void;
  react: (id: string, emoji: string) => void;
  createPrediction: (id: string, prediction: StreamPrediction) => void;
  voteOnPrediction: (id: string, predictionId: string, userId: string, optIdx: number) => void;
  closePrediction: (id: string, predictionId: string) => void;
}

export const useStreamsStore = create<StreamsState>((set, get) => {
  if (BC) {
    BC.onmessage = (e) => {
      const msg: WireMsg = e.data;
      set(s => {
        const streams = { ...s.streams };
        switch (msg.type) {
          case 'stream-start': streams[msg.entry.id] = msg.entry; break;
          case 'stream-end': if (streams[msg.id]) streams[msg.id] = { ...streams[msg.id], ended: true, endedAt: Date.now() }; break;
          case 'stream-update': if (streams[msg.id]) streams[msg.id] = { ...streams[msg.id], ...msg.patch }; break;
          case 'stream-join': if (streams[msg.id] && !streams[msg.id].viewerIds.includes(msg.userId)) {
            const viewerIds = [...streams[msg.id].viewerIds, msg.userId];
            streams[msg.id] = { ...streams[msg.id], viewerIds, peakViewers: Math.max(streams[msg.id].peakViewers, viewerIds.length) };
          } break;
          case 'stream-leave': if (streams[msg.id]) streams[msg.id] = { ...streams[msg.id], viewerIds: streams[msg.id].viewerIds.filter(v => v !== msg.userId) }; break;
          case 'stream-chat': if (streams[msg.id]) streams[msg.id] = { ...streams[msg.id], chat: [...streams[msg.id].chat, msg.msg].slice(-200) }; break;
          case 'stream-react': if (streams[msg.id]) streams[msg.id] = { ...streams[msg.id], reactions: { ...streams[msg.id].reactions, [msg.emoji]: (streams[msg.id].reactions[msg.emoji] ?? 0) + 1 } }; break;
          case 'stream-predict-create': if (streams[msg.id]) streams[msg.id] = { ...streams[msg.id], predictions: [...streams[msg.id].predictions, msg.prediction] }; break;
          case 'stream-predict-vote': if (streams[msg.id]) streams[msg.id] = { ...streams[msg.id], predictions: streams[msg.id].predictions.map(p => p.id !== msg.predictionId || p.votes[msg.userId] !== undefined ? p : { ...p, votes: { ...p.votes, [msg.userId]: msg.optIdx } }) }; break;
          case 'stream-predict-close': if (streams[msg.id]) streams[msg.id] = { ...streams[msg.id], predictions: streams[msg.id].predictions.map(p => p.id === msg.predictionId ? { ...p, closed: true } : p) }; break;
        }
        return { streams };
      });
    };
  }

  const post = (m: WireMsg) => BC?.postMessage(m);

  return {
    streams: {},

    publish: (entry) => { set(s => ({ streams: { ...s.streams, [entry.id]: entry } })); post({ type:'stream-start', entry }); },
    unpublish: (id) => { set(s => s.streams[id] ? ({ streams: { ...s.streams, [id]: { ...s.streams[id], ended:true, endedAt:Date.now() } } }) : s); post({ type:'stream-end', id }); },
    updateStream: (id, patch) => { set(s => s.streams[id] ? ({ streams: { ...s.streams, [id]: { ...s.streams[id], ...patch } } }) : s); post({ type:'stream-update', id, patch }); },

    join: (id, userId) => {
      set(s => {
        if (!s.streams[id] || s.streams[id].viewerIds.includes(userId)) return s;
        const viewerIds = [...s.streams[id].viewerIds, userId];
        return { streams: { ...s.streams, [id]: { ...s.streams[id], viewerIds, peakViewers: Math.max(s.streams[id].peakViewers, viewerIds.length) } } };
      });
      post({ type:'stream-join', id, userId });
    },
    leave: (id, userId) => {
      set(s => s.streams[id] ? ({ streams: { ...s.streams, [id]: { ...s.streams[id], viewerIds: s.streams[id].viewerIds.filter(v=>v!==userId) } } }) : s);
      post({ type:'stream-leave', id, userId });
    },
    sendChat: (id, msg) => {
      set(s => s.streams[id] ? ({ streams: { ...s.streams, [id]: { ...s.streams[id], chat: [...s.streams[id].chat, msg].slice(-200) } } }) : s);
      post({ type:'stream-chat', id, msg });
    },
    react: (id, emoji) => {
      set(s => s.streams[id] ? ({ streams: { ...s.streams, [id]: { ...s.streams[id], reactions: { ...s.streams[id].reactions, [emoji]: (s.streams[id].reactions[emoji] ?? 0) + 1 } } } }) : s);
      post({ type:'stream-react', id, emoji });
    },
    createPrediction: (id, prediction) => {
      set(s => s.streams[id] ? ({ streams: { ...s.streams, [id]: { ...s.streams[id], predictions: [...s.streams[id].predictions, prediction] } } }) : s);
      post({ type:'stream-predict-create', id, prediction });
    },
    voteOnPrediction: (id, predictionId, userId, optIdx) => {
      set(s => {
        if (!s.streams[id]) return s;
        return { streams: { ...s.streams, [id]: { ...s.streams[id], predictions: s.streams[id].predictions.map(p => p.id !== predictionId || p.votes[userId] !== undefined ? p : { ...p, votes: { ...p.votes, [userId]: optIdx } }) } } };
      });
      post({ type:'stream-predict-vote', id, predictionId, userId, optIdx });
    },
    closePrediction: (id, predictionId) => {
      set(s => s.streams[id] ? ({ streams: { ...s.streams, [id]: { ...s.streams[id], predictions: s.streams[id].predictions.map(p => p.id === predictionId ? { ...p, closed:true } : p) } } }) : s);
      post({ type:'stream-predict-close', id, predictionId });
    },
  };
});
