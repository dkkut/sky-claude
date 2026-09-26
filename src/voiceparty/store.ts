/* ===========================================================
   VOICE PARTY STORE
   Комнаты и их живое состояние (кто внутри, роли, чат, реакции) —
   реальные, с сервера: HTTP для списка/создания/удаления
   (src/voiceparty/api.ts, server/routes/voiceparty.mjs), WebSocket
   для всего, что меняется, пока человек в комнате (server/voiceparty.mjs
   + case 'vp:*' в server/signal.mjs) — тем же приёмом, что уже
   применён к матчмейкингу игр (src/gaming/store.ts).
   Голос — настоящий P2P WebRTC-mesh (src/calls/webrtc.ts), сигналинг
   которого теперь тоже идёт через сервер, а не BroadcastChannel —
   поэтому, в отличие от прежней версии, работает между разными
   людьми и устройствами, а не только между вкладками одного браузера.
=========================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';
import { SkyPeerConnection, bsignal } from '@/calls/webrtc';
import { wireSend } from '@/core/wire';
import { apiListRooms, apiCreateRoom, apiDeleteRoom } from './api';
import type {
  VPRoom, VPParticipant, VPReaction, VPRole, VPCategory, VPRoomPermissions,
} from './types';

const me = () => useAuthStore.getState().currentUserId ?? '';

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
  loading: boolean;
  activeRoomId: string | null;
  localSpeaking: boolean;
  micReady: boolean;
  pttMode: boolean;
  reactions: VPReaction[];

  activeRoom: () => VPRoom | null;
  myParticipant: () => VPParticipant | null;
  myRole: () => VPRole | null;
  liveRooms: () => VPRoom[];
  scheduledRooms: () => VPRoom[];
  popularRooms: () => VPRoom[];
  roomsByCategory: (c: VPCategory) => VPRoom[];
  searchRooms: (q: string) => VPRoom[];

  loadRooms: () => Promise<void>;
  createRoom: (title: string, description: string, category: VPCategory, isPrivate: boolean, maxParticipants: number, scheduledFor?: string) => Promise<string | null>;
  deleteRoom: (roomId: string) => Promise<void>;
  joinRoom: (roomId: string) => void;
  leaveRoom: () => void;

  toggleMic: () => void;
  setPTTMode: (v: boolean) => void;
  pttPress: (down: boolean) => void;
  raiseHand: () => void;
  lowerHand: () => void;
  sendReaction: (emoji: string) => void;

  sendChatMessage: (text: string) => void;
  pinMessage: (id: string) => void;

  muteParticipant: (memberId: string) => void;
  promoteToSpeaker: (memberId: string) => void;
  demoteToListener: (memberId: string) => void;
  kickParticipant: (memberId: string) => void;
  banParticipant: (memberId: string) => void;
  updatePermissions: (p: Partial<VPRoomPermissions>) => void;

  _connectToPeer: (targetId: string, initiator: boolean) => Promise<void>;
  _teardownPeers: () => void;
  _startMic: () => Promise<void>;

  /* Применяются событиями с сервера (src/messenger/socket.ts, case 'vp:...') */
  applyJoined: (room: VPRoom) => void;
  applyParticipantJoined: (roomId: string, participant: VPParticipant) => void;
  applyParticipantLeft: (roomId: string, profileId: string) => void;
  applyParticipantUpdated: (roomId: string, profileId: string, patch: Partial<VPParticipant>) => void;
  applyRoomUpdated: (roomId: string, permissions: VPRoomPermissions) => void;
  applyChat: (roomId: string, message: { id: string; authorId: string; text: string; createdAt: string }) => void;
  applyPin: (roomId: string, messageId: string, pinned: boolean) => void;
  applyReaction: (roomId: string, reaction: VPReaction) => void;
  applyKicked: () => void;
}

const upsertRoom = (rooms: VPRoom[], roomId: string, fn: (r: VPRoom) => VPRoom): VPRoom[] => {
  const idx = rooms.findIndex((r) => r.id === roomId);
  if (idx < 0) return rooms;
  const next = [...rooms];
  next[idx] = fn(next[idx]);
  return next;
};

export const useVoicePartyStore = create<VPState>((set, get) => {
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
      bsignal.send({ type: 'answer', callId: msg.callId, from: uid, to: msg.from, sdp: answer });
      return;
    }

    if (msg.type === 'answer') {
      const pc = peers.get(msg.callId);
      if (pc) await pc.handleAnswer(msg.sdp);
    }
  });

  return {
    rooms: [],
    loading: false,
    activeRoomId: null,
    localSpeaking: false,
    micReady: false,
    pttMode: false,
    reactions: [],

    activeRoom: () => get().rooms.find((r) => r.id === get().activeRoomId) ?? null,
    myParticipant: () => get().activeRoom()?.participants.find((p) => p.id === me()) ?? null,
    myRole: () => get().myParticipant()?.role ?? null,

    liveRooms: () => get().rooms.filter((r) => !r.ended && !r.scheduledFor && !r.isPrivate),
    scheduledRooms: () => get().rooms.filter((r) => !r.ended && r.scheduledFor && new Date(r.scheduledFor).getTime() > Date.now())
      .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime()),
    popularRooms: () => [...get().liveRooms()].sort((a, b) => b.participants.length - a.participants.length).slice(0, 6),
    roomsByCategory: (c) => get().liveRooms().filter((r) => r.category === c),
    searchRooms: (q) => {
      const query = q.trim().toLowerCase();
      if (!query) return [];
      return get().rooms.filter((r) => !r.ended && (r.title.toLowerCase().includes(query) || r.description.toLowerCase().includes(query)));
    },

    loadRooms: async () => {
      set({ loading: true });
      const { live, scheduled } = await apiListRooms();
      set({ rooms: [...live, ...scheduled], loading: false });
    },

    createRoom: async (title, description, category, isPrivate, maxParticipants, scheduledFor) => {
      const room = await apiCreateRoom({ title, description, category, isPrivate, maxParticipants, scheduledFor });
      if (!room) return null;
      set((s) => ({ rooms: [room, ...s.rooms] }));
      return room.id;
    },

    deleteRoom: async (roomId) => {
      if (!(await apiDeleteRoom(roomId))) return;
      set((s) => ({ rooms: s.rooms.filter((r) => r.id !== roomId) }));
    },

    joinRoom: (roomId) => {
      set({ activeRoomId: roomId });
      wireSend({ type: 'vp:join', payload: { roomId } });
    },

    leaveRoom: () => {
      const roomId = get().activeRoomId;
      if (roomId) wireSend({ type: 'vp:leave', payload: { roomId } });
      get()._teardownPeers();
      set({ activeRoomId: null, localSpeaking: false, micReady: false, reactions: [] });
    },

    _startMic: async () => {
      const uid = me();
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
          const vol = data.reduce((a, b) => a + b, 0) / data.length;
          const speaking = vol > 12 && !get().myParticipant()?.muted;
          if (speaking !== get().localSpeaking) {
            set({ localSpeaking: speaking });
            const rid = get().activeRoomId;
            if (rid) {
              set((s) => ({ rooms: upsertRoom(s.rooms, rid, (r) => ({
                ...r, participants: r.participants.map((p) => (p.id === uid ? { ...p, speaking } : p)),
              })) }));
            }
          }
        }, 300);
        set({ micReady: true });
      } catch { set({ micReady: false }); }
    },

    _connectToPeer: async (targetId, initiator) => {
      const uid = me();
      const roomId = get().activeRoomId;
      if (!roomId) return;
      const callId = `vp:${roomId}:${[uid, targetId].sort().join('-')}`;
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
        bsignal.send({ type: 'offer', callId, from: uid, to: targetId, sdp: offer, mode: 'voiceparty', callerName: '', callerAvatar: '' });
      }
    },

    _teardownPeers: () => {
      peers.forEach((p) => p.destroy());
      peers.clear();
      audioEls.forEach((_, id) => detachRemoteAudio(id));
      if (speakingTimer) { clearInterval(speakingTimer); speakingTimer = null; }
      localStream?.getTracks().forEach((t) => t.stop());
      localStream = null; analyser = null;
    },

    toggleMic: () => {
      const roomId = get().activeRoomId;
      if (!roomId) return;
      const nextMuted = !(get().myParticipant()?.muted ?? false);
      wireSend({ type: 'vp:mute', payload: { roomId, muted: nextMuted } });
      peers.forEach((p) => p.setMuted(nextMuted));
    },

    setPTTMode: (v) => set({ pttMode: v }),
    pttPress: (down) => {
      const roomId = get().activeRoomId;
      if (!roomId || !get().pttMode) return;
      wireSend({ type: 'vp:mute', payload: { roomId, muted: !down } });
      peers.forEach((p) => p.setMuted(!down));
    },

    raiseHand: () => { const roomId = get().activeRoomId; if (roomId) wireSend({ type: 'vp:hand', payload: { roomId, raised: true } }); },
    lowerHand: () => { const roomId = get().activeRoomId; if (roomId) wireSend({ type: 'vp:hand', payload: { roomId, raised: false } }); },

    sendReaction: (emoji) => { const roomId = get().activeRoomId; if (roomId) wireSend({ type: 'vp:reaction', payload: { roomId, emoji } }); },

    sendChatMessage: (text) => {
      const roomId = get().activeRoomId;
      if (!roomId || !text.trim()) return;
      wireSend({ type: 'vp:chat', payload: { roomId, text: text.trim() } });
    },
    pinMessage: (id) => {
      const roomId = get().activeRoomId;
      if (!roomId) return;
      const pinned = !get().activeRoom()?.messages.find((m) => m.id === id)?.pinned;
      wireSend({ type: 'vp:pin', payload: { roomId, messageId: id, pinned } });
    },

    muteParticipant: (memberId) => { const roomId = get().activeRoomId; if (roomId) wireSend({ type: 'vp:role', payload: { roomId, targetId: memberId, role: 'listener' } }); },
    promoteToSpeaker: (memberId) => { const roomId = get().activeRoomId; if (roomId) wireSend({ type: 'vp:role', payload: { roomId, targetId: memberId, role: 'speaker' } }); },
    demoteToListener: (memberId) => { const roomId = get().activeRoomId; if (roomId) wireSend({ type: 'vp:role', payload: { roomId, targetId: memberId, role: 'listener' } }); },
    kickParticipant: (memberId) => { const roomId = get().activeRoomId; if (roomId) wireSend({ type: 'vp:kick', payload: { roomId, targetId: memberId } }); },
    banParticipant: (memberId) => { const roomId = get().activeRoomId; if (roomId) wireSend({ type: 'vp:ban', payload: { roomId, targetId: memberId } }); },
    updatePermissions: (p) => { const roomId = get().activeRoomId; if (roomId) wireSend({ type: 'vp:permissions', payload: { roomId, patch: p } }); },

    /* ── Применение серверных событий ─────────────────────────── */

    applyJoined: (room) => {
      set((s) => {
        const idx = s.rooms.findIndex((r) => r.id === room.id);
        const rooms = idx < 0 ? [room, ...s.rooms]
          : upsertRoom(s.rooms, room.id, (r) => ({ ...room, messages: r.messages }));
        return { rooms };
      });
      void get()._startMic();
      const uid = me();
      for (const p of room.participants) {
        if (p.id === uid) continue;
        get()._connectToPeer(p.id, uid < p.id);
      }
    },

    applyParticipantJoined: (roomId, participant) => {
      set((s) => ({ rooms: upsertRoom(s.rooms, roomId, (r) => (
        r.participants.some((p) => p.id === participant.id) ? r : { ...r, participants: [...r.participants, participant] }
      )) }));
      if (get().activeRoomId === roomId) {
        const uid = me();
        get()._connectToPeer(participant.id, uid < participant.id);
      }
    },

    applyParticipantLeft: (roomId, profileId) => {
      set((s) => ({ rooms: upsertRoom(s.rooms, roomId, (r) => ({ ...r, participants: r.participants.filter((p) => p.id !== profileId) })) }));
      if (get().activeRoomId === roomId) {
        const uid = me();
        const callId = `vp:${roomId}:${[uid, profileId].sort().join('-')}`;
        peers.get(callId)?.destroy();
        peers.delete(callId);
        detachRemoteAudio(profileId);
      }
    },

    applyParticipantUpdated: (roomId, profileId, patch) => {
      set((s) => ({ rooms: upsertRoom(s.rooms, roomId, (r) => ({
        ...r, participants: r.participants.map((p) => (p.id === profileId ? { ...p, ...patch } : p)),
      })) }));
      if (get().activeRoomId === roomId && profileId === me() && patch.muted !== undefined) {
        peers.forEach((p) => p.setMuted(patch.muted!));
      }
    },

    applyRoomUpdated: (roomId, permissions) => {
      set((s) => ({ rooms: upsertRoom(s.rooms, roomId, (r) => ({ ...r, permissions })) }));
    },

    applyChat: (roomId, message) => {
      set((s) => ({ rooms: upsertRoom(s.rooms, roomId, (r) => {
        const author = r.participants.find((p) => p.id === message.authorId);
        return { ...r, messages: [...r.messages, { ...message, authorName: author?.name ?? 'Участник', pinned: false }] };
      }) }));
    },
    applyPin: (roomId, messageId, pinned) => {
      set((s) => ({ rooms: upsertRoom(s.rooms, roomId, (r) => ({ ...r, messages: r.messages.map((m) => (m.id === messageId ? { ...m, pinned } : m)) })) }));
    },
    applyReaction: (roomId, reaction) => {
      set((s) => ({ reactions: [...s.reactions.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 4000), reaction] }));
      void roomId;
    },

    applyKicked: () => {
      get()._teardownPeers();
      set({ activeRoomId: null, localSpeaking: false, micReady: false, reactions: [] });
    },
  };
});
