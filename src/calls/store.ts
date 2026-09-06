import { create } from 'zustand';
import { SkyPeerConnection, bsignal } from './webrtc';

export type CallMode   = 'voice' | 'video';
export type CallStatus = 'missed' | 'completed' | 'rejected';

export interface CallHistoryItem {
  id: string; peerName: string; peerAvatar: string;
  mode: CallMode; startedAt: string; durationSec: number;
  status: CallStatus; direction: 'in' | 'out';
}

export interface ActiveCall {
  callId: string; peerId: string; peerName: string; peerAvatar: string;
  mode: CallMode; startedAt: number;
  localStream: MediaStream | null; remoteStream: MediaStream | null;
  screenShareOn: boolean; direction: 'in' | 'out';
  pc: SkyPeerConnection | null;      // WebRTC connection
  connected: boolean;                // peer connected (ice connected)
}

export interface IncomingCall {
  callId: string; from: string;
  callerName: string; callerAvatar: string; mode: CallMode;
  sdp: RTCSessionDescriptionInit;    // offer SDP
}

/* --- history ------------------------------------------------------------- */
const HIST_KEY = 'sky:calls:history:v3';
const loadHist = (): CallHistoryItem[] => { try { return JSON.parse(localStorage.getItem(HIST_KEY)||'[]'); } catch { return []; } };
const saveHist = (h: CallHistoryItem[]) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0,200))); } catch {} };

interface CallState {
  incoming:   IncomingCall | null;
  active:     ActiveCall   | null;
  miniMode:   boolean;
  muted:      boolean;
  cameraOff:  boolean;
  speakerOff: boolean;
  history:    CallHistoryItem[];

  startCall:        (peerId: string, peerName: string, peerAvatar: string, mode: CallMode) => Promise<void>;
  acceptIncoming:   () => Promise<void>;
  declineIncoming:  () => void;
  endCall:          () => void;
  toggleMute:       () => void;
  toggleCamera:     () => void;
  toggleSpeaker:    () => void;
  toggleScreen:     () => Promise<void>;
  toggleMini:       () => void;
  // внутренний  -  вызывается из socket.ts
  _handleIncomingOffer: (data: { callId: string; from: string; callerName: string; callerAvatar: string; mode: CallMode; sdp: RTCSessionDescriptionInit }) => void;
  _handleCallEnd: () => void;
}

const myId = () => {
  try { return JSON.parse(localStorage.getItem('sky:auth:v4:session')||'null')?.id ?? ''; } catch { return ''; }
};

export const useCallStore = create<CallState>((set, get) => {

  const pushHist = (item: Omit<CallHistoryItem,'id'>): CallHistoryItem[] => {
    const h = [{ ...item, id: crypto.randomUUID() }, ...get().history].slice(0, 200);
    saveHist(h); return h;
  };

  const cleanupPC = () => {
    const { active } = get();
    if (active?.pc) { active.pc.destroy(); }
  };

  return {
    incoming: null, active: null,
    miniMode: false, muted: false, cameraOff: false, speakerOff: false,
    history: loadHist(),

    /* -- Исходящий звонок ---------------------------------------------- */
    async startCall(peerId, peerName, peerAvatar, mode) {
      if (get().active || get().incoming) return;
      const callId = crypto.randomUUID();
      const me = myId();

      const pc = new SkyPeerConnection({
        peerId, callId, myId: me,
        onRemoteStream: (stream) => {
          set(s => s.active ? ({ active: { ...s.active, remoteStream: stream, connected: true } }) : {});
        },
        onConnected: () => {
          set(s => s.active ? ({ active: { ...s.active, connected: true } }) : {});
        },
        onFailed: () => {
          // Попытка восстановления не нужна  -  просто отображаем статус
          set(s => s.active ? ({ active: { ...s.active, connected: false } }) : {});
        },
      });

      // Слушаем ответ и ICE от peer
      bsignal.on(callId, (msg) => {
        if (msg.from !== peerId) return;
        if (msg.type === 'answer') {
          pc.handleAnswer(msg.sdp);
        }
        if (msg.type === 'reject') {
          const h = pushHist({ peerName, peerAvatar, mode, startedAt: new Date().toISOString(), durationSec: 0, status: 'rejected', direction: 'out' });
          cleanupPC();
          set({ active: null, history: h });
        }
        if (msg.type === 'end') {
          get().endCall();
        }
      });

      const localStream = await pc.getMedia(mode === 'video');
      const offer = await pc.createOffer();

      set({
        active: { callId, peerId, peerName, peerAvatar, mode, startedAt: Date.now(),
          localStream, remoteStream: null, screenShareOn: false, direction: 'out', pc, connected: false },
        muted: false, cameraOff: false, speakerOff: false, miniMode: false,
      });

      // Шлём offer через BroadcastChannel
      bsignal.send({ type: 'offer', callId, from: me, to: peerId, sdp: offer, mode, callerName: peerName, callerAvatar: peerAvatar });
    },

    /* -- Принять входящий ---------------------------------------------- */
    async acceptIncoming() {
      const { incoming } = get(); if (!incoming) return;
      const me = myId();

      const pc = new SkyPeerConnection({
        peerId: incoming.from, callId: incoming.callId, myId: me,
        onRemoteStream: (stream) => {
          set(s => s.active ? ({ active: { ...s.active, remoteStream: stream, connected: true } }) : {});
        },
        onConnected: () => {
          set(s => s.active ? ({ active: { ...s.active, connected: true } }) : {});
        },
        onFailed: () => {
          set(s => s.active ? ({ active: { ...s.active, connected: false } }) : {});
        },
      });

      // Слушаем end от caller
      bsignal.on(incoming.callId, (msg) => {
        if (msg.from !== incoming.from) return;
        if (msg.type === 'end') get().endCall();
      });

      const localStream = await pc.getMedia(incoming.mode === 'video');
      const answer = await pc.handleOffer(incoming.sdp);

      set({
        active: { callId: incoming.callId, peerId: incoming.from, peerName: incoming.callerName,
          peerAvatar: incoming.callerAvatar, mode: incoming.mode, startedAt: Date.now(),
          localStream, remoteStream: null, screenShareOn: false, direction: 'in', pc, connected: false },
        incoming: null, muted: false, cameraOff: false, speakerOff: false, miniMode: false,
      });

      bsignal.send({ type: 'answer', callId: incoming.callId, from: me, to: incoming.from, sdp: answer });
    },

    /* -- Отклонить ----------------------------------------------------- */
    declineIncoming() {
      const { incoming } = get(); if (!incoming) return;
      const me = myId();
      bsignal.send({ type: 'reject', callId: incoming.callId, from: me, to: incoming.from });
      const h = pushHist({ peerName: incoming.callerName, peerAvatar: incoming.callerAvatar,
        mode: incoming.mode, startedAt: new Date().toISOString(), durationSec: 0, status: 'rejected', direction: 'in' });
      set({ incoming: null, history: h });
    },

    /* -- Завершить ----------------------------------------------------- */
    endCall() {
      const { active } = get(); if (!active) return;
      const me = myId();
      bsignal.send({ type: 'end', callId: active.callId, from: me, to: active.peerId });
      cleanupPC();
      const durationSec = Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000));
      const h = pushHist({ peerName: active.peerName, peerAvatar: active.peerAvatar,
        mode: active.mode, startedAt: new Date(active.startedAt).toISOString(),
        durationSec, status: durationSec >= 2 ? 'completed' : 'missed', direction: active.direction });
      set({ active: null, miniMode: false, muted: false, cameraOff: false, speakerOff: false, history: h });
    },

    /* -- Управление ---------------------------------------------------- */
    toggleMute() {
      const muted = !get().muted;
      get().active?.pc?.setMuted(muted);
      set({ muted });
    },

    toggleCamera() {
      const cameraOff = !get().cameraOff;
      get().active?.pc?.setCameraOff(cameraOff);
      set({ cameraOff });
    },

    toggleSpeaker() { set(s => ({ speakerOff: !s.speakerOff })); },

    async toggleScreen() {
      const { active } = get(); if (!active?.pc) return;
      if (!active.screenShareOn) {
        const screen = await active.pc.startScreenShare();
        if (screen) {
          screen.getVideoTracks()[0].addEventListener('ended', () => {
            set(s => s.active ? ({ active: { ...s.active, screenShareOn: false } }) : {});
          });
          set(s => s.active ? ({ active: { ...s.active, screenShareOn: true } }) : {});
        }
      } else {
        // Вернуть камеру
        const cam = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }).catch(() => null);
        if (cam) {
          const sender = active.pc.pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(cam.getVideoTracks()[0]);
        }
        set(s => s.active ? ({ active: { ...s.active, screenShareOn: false } }) : {});
      }
    },

    toggleMini() { set(s => ({ miniMode: !s.miniMode })); },

    /* -- Внутренние  -  вызываются из socket.ts -------------------------- */
    _handleIncomingOffer({ callId, from, callerName, callerAvatar, mode, sdp }) {
      if (get().active || get().incoming) return; // уже в звонке
      set({ incoming: { callId, from, callerName, callerAvatar, mode, sdp } });
    },

    _handleCallEnd() {
      const { incoming } = get();
      if (incoming) { set({ incoming: null }); return; }
      const { active } = get();
      if (active) {
        cleanupPC();
        const durationSec = Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000));
        const h = pushHist({ peerName: active.peerName, peerAvatar: active.peerAvatar,
          mode: active.mode, startedAt: new Date(active.startedAt).toISOString(),
          durationSec, status: durationSec >= 2 ? 'completed' : 'missed', direction: active.direction });
        set({ active: null, miniMode: false, muted: false, cameraOff: false, speakerOff: false, history: h });
      }
    },
  };
});

/* --- Слушаем входящие offers через BroadcastChannel ----------------------- */
bsignal.on('__incoming__', (msg) => {
  if (msg.type !== 'offer') return;
  const me = myId();
  if (msg.to !== me) return;   // не нам
  useCallStore.getState()._handleIncomingOffer({
    callId: msg.callId, from: msg.from,
    callerName: msg.callerName, callerAvatar: msg.callerAvatar,
    mode: msg.mode as CallMode, sdp: msg.sdp,
  });
});
