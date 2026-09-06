/* ===========================================================
   VOICE PARTY STORE
   Комнаты синхронизируются между вкладками через BroadcastChannel
   (тот же принцип, что и в src/bloom/store.ts). Голос — настоящий
   P2P WebRTC-mesh поверх уже существующей сигнальной шины
   src/calls/webrtc.ts (BroadcastChannel-сигналинг). Работает между
   вкладками ОДНОГО браузера — реальных серверов сигналинга нет,
   поэтому голос между разными устройствами пока недоступен.
=========================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';
import { SkyPeerConnection, bsignal } from '@/calls/webrtc';
import type {
  VPRoom, VPParticipant, VPChatMessage, VPReaction, VPRole, VPCategory, VPRoomPermissions,
} from './types';

const KEY = 'sky:voiceparty:v1:rooms';
const BC_CHANNEL = 'sky:voiceparty:bc:v1';
const AVATAR_COLORS = ['#4f6ef7','#8b5cf6','#ec4899','#f59e0b','#22c55e','#06b6d4','#ef4444','#a78bfa'];

const nowISO = () => new Date().toISOString();
const me = () => useAuthStore.getState().currentUserId ?? '';
const myName = () => useAuthStore.getState().accounts.find(a=>a.id===me())?.name ?? 'Вы';
const myColor = () => AVATAR_COLORS[Math.abs(hash(me())) % AVATAR_COLORS.length];
const hash = (s: string) => { let h=0; for (let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h; };
const genCode = () => Math.random().toString(36).slice(2,8).toUpperCase();

const loadRooms = (): VPRoom[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const persistRooms = (r: VPRoom[]) => { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch {} };

const BC = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(BC_CHANNEL) : null;

/* --- Реальный голос: не часть реактивного состояния (не сериализуется) --- */
const peers = new Map<string, SkyPeerConnection>();
const audioEls = new Map<string, HTMLAudioElement>();
let localStream: MediaStream | null = null;
let analyser: AnalyserNode | null = null;
let speakingTimer: ReturnType<typeof setInterval> | null = null;

function attachRemoteAudio(peerId: string, stream: MediaStream) {
  let el = audioEls.get(peerId);
  if (!el) {
    el = document.createElement('audio');
    el.autoplay = true;
    (el as any).playsInline = true;
    document.body.appendChild(el);
    audioEls.set(peerId, el);
  }
  el.srcObject = stream;
}
function detachRemoteAudio(peerId: string) {
  const el = audioEls.get(peerId);
  if (el) { el.srcObject = null; el.remove(); audioEls.delete(peerId); }
}

interface VPState {
  rooms: VPRoom[];
  activeRoomId: string | null;
  localSpeaking: boolean;
  micReady: boolean;
  pttMode: boolean;

  activeRoom: () => VPRoom | null;
  myParticipant: () => VPParticipant | null;
  liveRooms: () => VPRoom[];
  scheduledRooms: () => VPRoom[];
  popularRooms: () => VPRoom[];
  roomsByCategory: (c: VPCategory) => VPRoom[];
  searchRooms: (q: string) => VPRoom[];

  createRoom: (title: string, description: string, category: VPCategory, isPrivate: boolean, maxParticipants: number, scheduledFor?: string) => string;
  deleteRoom: (roomId: string) => void;
  joinRoom: (roomId: string) => Promise<void>;
  leaveRoom: () => void;

  toggleMic: () => void;
  setPTTMode: (v: boolean) => void;
  pttPress: (down: boolean) => void;
  raiseHand: () => void;
  lowerHand: () => void;
  sendReaction: (emoji: string) => void;
  reactions: VPReaction[];

  sendChatMessage: (text: string) => void;
  pinMessage: (id: string) => void;

  muteParticipant: (memberId: string) => void;
  promoteToSpeaker: (memberId: string) => void;
  demoteToListener: (memberId: string) => void;
  kickParticipant: (memberId: string) => void;
  banParticipant: (memberId: string) => void;
  updatePermissions: (p: Partial<VPRoomPermissions>) => void;
  myRole: () => VPRole | null;

  _connectToPeer: (targetId: string, initiator: boolean) => Promise<void>;
  _teardownPeers: () => void;
}

const mutRoom = (get: () => VPState, set: (fn: (s: VPState) => Partial<VPState>) => void, roomId: string, fn: (r: VPRoom) => VPRoom) => {
  set(s => {
    const rooms = s.rooms.map(r => r.id === roomId ? fn(r) : r);
    persistRooms(rooms);
    BC?.postMessage({ type: 'sync', rooms });
    return { rooms };
  });
};

export const useVoicePartyStore = create<VPState>((set, get) => {
  if (BC) {
    BC.onmessage = (e) => {
      if (e.data?.type === 'sync') set({ rooms: e.data.rooms });
    };
  }

  bsignal.on('__incoming__', async (msg: any) => {
    const uid = me();
    if (!msg.callId?.startsWith('vp:') || msg.to !== uid) return;

    if (msg.type === 'offer') {
      if (peers.has(msg.callId)) return;
      const pc = new SkyPeerConnection({
        peerId: msg.from, callId: msg.callId, myId: uid,
        onRemoteStream: (stream) => attachRemoteAudio(msg.from, stream),
      });
      peers.set(msg.callId, pc);
      await pc.getMedia(false);
      pc.setMuted(get().myParticipant()?.muted ?? false);
      const answer = await pc.handleOffer(msg.sdp);
      bsignal.send({ type:'answer', callId: msg.callId, from: uid, to: msg.from, sdp: answer });
      return;
    }

    if (msg.type === 'answer') {
      const pc = peers.get(msg.callId);
      if (pc) await pc.handleAnswer(msg.sdp);
    }
  });

  return {
    rooms: loadRooms(),
    activeRoomId: null,
    localSpeaking: false,
    micReady: false,
    pttMode: false,
    reactions: [],

    activeRoom: () => get().rooms.find(r => r.id === get().activeRoomId) ?? null,
    myParticipant: () => get().activeRoom()?.participants.find(p => p.id === me()) ?? null,
    myRole: () => get().myParticipant()?.role ?? null,

    liveRooms: () => get().rooms.filter(r => !r.ended && !r.scheduledFor && !r.isPrivate),
    scheduledRooms: () => get().rooms.filter(r => !r.ended && r.scheduledFor && new Date(r.scheduledFor).getTime() > Date.now())
      .sort((a,b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime()),
    popularRooms: () => [...get().liveRooms()].sort((a,b) => b.participants.length - a.participants.length).slice(0,6),
    roomsByCategory: (c) => get().liveRooms().filter(r => r.category === c),
    searchRooms: (q) => {
      const query = q.trim().toLowerCase();
      if (!query) return [];
      return get().rooms.filter(r => !r.ended && (r.title.toLowerCase().includes(query) || r.description.toLowerCase().includes(query)));
    },

    createRoom: (title, description, category, isPrivate, maxParticipants, scheduledFor) => {
      const uid = me();
      const owner: VPParticipant = {
        id: uid, name: myName(), avatarColor: myColor(), role: 'owner', muted: false, handRaised: false,
        speaking: false, joinedAt: nowISO(), isReal: true,
      };
      const room: VPRoom = {
        id: crypto.randomUUID(), title, description, category, isPrivate, inviteCode: genCode(), ownerId: uid,
        maxParticipants, participants: scheduledFor ? [] : [owner], messages: [], banned: [],
        permissions: { whoCanSpeak: 'everyone', whoCanReact: 'everyone', requireApprovalToSpeak: false },
        createdAt: nowISO(), scheduledFor, ended: false,
      };
      set(s => { const rooms = [room, ...s.rooms]; persistRooms(rooms); BC?.postMessage({ type:'sync', rooms }); return { rooms }; });
      return room.id;
    },

    deleteRoom: (roomId) => set(s => { const rooms = s.rooms.filter(r => r.id !== roomId); persistRooms(rooms); BC?.postMessage({ type:'sync', rooms }); return { rooms }; }),

    joinRoom: async (roomId) => {
      const uid = me();
      const room = get().rooms.find(r => r.id === roomId);
      if (!room || room.banned.includes(uid)) return;
      if (room.participants.length >= room.maxParticipants) return;

      const already = room.participants.some(p => p.id === uid);
      const requireApproval = room.permissions.requireApprovalToSpeak && room.ownerId !== uid;
      const participant: VPParticipant = already ? room.participants.find(p=>p.id===uid)! : {
        id: uid, name: myName(), avatarColor: myColor(), role: requireApproval ? 'listener' : 'speaker',
        muted: false, handRaised: false, speaking: false, joinedAt: nowISO(), isReal: true,
      };

      mutRoom(get, set, roomId, r => already ? r : { ...r, participants: [...r.participants, participant] });
      set({ activeRoomId: roomId });

      // локальный микрофон + анализ громкости (реально, через Web Audio API)
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(localStream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        if (speakingTimer) clearInterval(speakingTimer);
        speakingTimer = setInterval(() => {
          if (!analyser) return;
          analyser.getByteFrequencyData(data);
          const vol = data.reduce((a,b)=>a+b,0) / data.length;
          const speaking = vol > 12 && !get().myParticipant()?.muted;
          if (speaking !== get().localSpeaking) {
            set({ localSpeaking: speaking });
            const rid = get().activeRoomId;
            if (rid) mutRoom(get, set, rid, r => ({ ...r, participants: r.participants.map(p => p.id === uid ? { ...p, speaking } : p) }));
          }
        }, 300);
        set({ micReady: true });
      } catch { set({ micReady: false }); }

      // Подключаемся ко всем существующим реальным участникам (mesh)
      const others = room.participants.filter(p => p.isReal && p.id !== uid);
      for (const other of others) {
        const initiator = uid < other.id; // детерминированный tie-break, чтобы не было двойного offer
        get()._connectToPeer(other.id, initiator);
      }
    },

    _connectToPeer: async (targetId, initiator) => {
      const uid = me();
      const roomId = get().activeRoomId;
      if (!roomId) return;
      const callId = `vp:${roomId}:${[uid,targetId].sort().join('-')}`;
      if (peers.has(callId)) return;

      const pc = new SkyPeerConnection({
        peerId: targetId, callId, myId: uid,
        onRemoteStream: (stream) => attachRemoteAudio(targetId, stream),
      });
      peers.set(callId, pc);
      await pc.getMedia(false);
      if (localStream) pc.setMuted(get().myParticipant()?.muted ?? false);

      if (initiator) {
        const offer = await pc.createOffer();
        bsignal.send({ type:'offer', callId, from: uid, to: targetId, sdp: offer, mode:'voiceparty', callerName: myName(), callerAvatar: '' });
      }
    },

    leaveRoom: () => {
      const uid = me();
      const roomId = get().activeRoomId;
      if (roomId) {
        mutRoom(get, set, roomId, r => ({ ...r, participants: r.participants.filter(p => p.id !== uid) }));
      }
      get()._teardownPeers();
      set({ activeRoomId: null, localSpeaking: false, micReady: false });
    },

    _teardownPeers: () => {
      peers.forEach(p => p.destroy());
      peers.clear();
      audioEls.forEach((_, id) => detachRemoteAudio(id));
      if (speakingTimer) { clearInterval(speakingTimer); speakingTimer = null; }
      localStream?.getTracks().forEach(t => t.stop());
      localStream = null; analyser = null;
    },

    toggleMic: () => {
      const uid = me();
      const roomId = get().activeRoomId;
      if (!roomId) return;
      const nextMuted = !(get().myParticipant()?.muted ?? false);
      mutRoom(get, set, roomId, r => ({ ...r, participants: r.participants.map(p => p.id === uid ? { ...p, muted: nextMuted, speaking: false } : p) }));
      peers.forEach(p => p.setMuted(nextMuted));
    },

    setPTTMode: (v) => set({ pttMode: v }),
    pttPress: (down) => {
      const uid = me();
      const roomId = get().activeRoomId;
      if (!roomId || !get().pttMode) return;
      mutRoom(get, set, roomId, r => ({ ...r, participants: r.participants.map(p => p.id === uid ? { ...p, muted: !down } : p) }));
      peers.forEach(p => p.setMuted(!down));
    },

    raiseHand: () => {
      const uid = me(); const roomId = get().activeRoomId; if (!roomId) return;
      mutRoom(get, set, roomId, r => ({ ...r, participants: r.participants.map(p => p.id === uid ? { ...p, handRaised: true } : p) }));
    },
    lowerHand: () => {
      const uid = me(); const roomId = get().activeRoomId; if (!roomId) return;
      mutRoom(get, set, roomId, r => ({ ...r, participants: r.participants.map(p => p.id === uid ? { ...p, handRaised: false } : p) }));
    },

    sendReaction: (emoji) => {
      const reaction: VPReaction = { id: crypto.randomUUID(), emoji, memberId: me(), memberName: myName(), createdAt: nowISO() };
      set(s => ({ reactions: [...s.reactions.filter(r => Date.now() - new Date(r.createdAt).getTime() < 4000), reaction] }));
    },

    sendChatMessage: (text) => {
      const uid = me();
      const roomId = get().activeRoomId;
      if (!roomId || !text.trim()) return;
      const msg: VPChatMessage = { id: crypto.randomUUID(), authorId: uid, authorName: myName(), text: text.trim(), createdAt: nowISO(), pinned: false };
      mutRoom(get, set, roomId, r => ({ ...r, messages: [...r.messages, msg] }));
    },
    pinMessage: (id) => {
      const roomId = get().activeRoomId; if (!roomId) return;
      mutRoom(get, set, roomId, r => ({ ...r, messages: r.messages.map(m => m.id === id ? { ...m, pinned: !m.pinned } : m) }));
    },

    muteParticipant: (memberId) => {
      const roomId = get().activeRoomId; if (!roomId) return;
      mutRoom(get, set, roomId, r => ({ ...r, participants: r.participants.map(p => p.id === memberId ? { ...p, muted: true } : p) }));
    },
    promoteToSpeaker: (memberId) => {
      const roomId = get().activeRoomId; if (!roomId) return;
      mutRoom(get, set, roomId, r => ({ ...r, participants: r.participants.map(p => p.id === memberId ? { ...p, role: 'speaker', handRaised: false } : p) }));
    },
    demoteToListener: (memberId) => {
      const roomId = get().activeRoomId; if (!roomId) return;
      mutRoom(get, set, roomId, r => ({ ...r, participants: r.participants.map(p => p.id === memberId ? { ...p, role: 'listener', muted: true } : p) }));
    },
    kickParticipant: (memberId) => {
      const roomId = get().activeRoomId; if (!roomId) return;
      mutRoom(get, set, roomId, r => ({ ...r, participants: r.participants.filter(p => p.id !== memberId) }));
    },
    banParticipant: (memberId) => {
      const roomId = get().activeRoomId; if (!roomId) return;
      mutRoom(get, set, roomId, r => ({ ...r, participants: r.participants.filter(p => p.id !== memberId), banned: [...r.banned, memberId] }));
    },
    updatePermissions: (p) => {
      const roomId = get().activeRoomId; if (!roomId) return;
      mutRoom(get, set, roomId, r => ({ ...r, permissions: { ...r.permissions, ...p } }));
    },
  };
});

/* Синхронизация принудительного мьюта + автоподключение к новым участникам +
   отключение от тех, кто покинул комнату (реагируем на изменения состояния
   комнаты, синхронизированного между вкладками через BroadcastChannel). */
useVoicePartyStore.subscribe((state, prev) => {
  const uid = me();
  const room = state.rooms.find(r => r.id === state.activeRoomId);
  const prevRoom = prev.rooms.find(r => r.id === prev.activeRoomId);
  if (!room || state.activeRoomId !== prev.activeRoomId) return;

  const mutedNow = room.participants.find(p => p.id === uid)?.muted;
  const mutedBefore = prevRoom?.participants.find(p => p.id === uid)?.muted;
  if (mutedNow !== undefined && mutedNow !== mutedBefore) {
    peers.forEach(p => p.setMuted(mutedNow));
  }

  const prevIds = new Set((prevRoom?.participants ?? []).map(p => p.id));
  const nowIds = new Set(room.participants.map(p => p.id));

  room.participants.forEach(p => {
    if (p.isReal && p.id !== uid && !prevIds.has(p.id)) {
      useVoicePartyStore.getState()._connectToPeer(p.id, uid < p.id);
    }
  });
  (prevRoom?.participants ?? []).forEach(p => {
    if (p.id !== uid && !nowIds.has(p.id)) {
      const callId = `vp:${state.activeRoomId}:${[uid,p.id].sort().join('-')}`;
      peers.get(callId)?.destroy();
      peers.delete(callId);
      detachRemoteAudio(p.id);
    }
  });
});
