import { create } from 'zustand';
import { SkyPeerConnection, bsignal } from './webrtc';
import { useAuthStore } from '@/core/auth/store';
import { computeCallSecurity, type CallSecurity } from './security';

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
  /**
   * Код звонка: считается из отпечатков ключей обеих сторон, когда они
   * ими обменялись. Совпал у обоих — посередине никого нет.
   */
  security: CallSecurity | null;
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
  _handleUnavailable: (callId: string) => void;
}

/**
 * Кто я — берём из живой сессии, а не из localStorage.
 *
 * Здесь читался ключ sky:auth:v4:session, которого не существует со
 * времён Sky ID: функция всегда возвращала пустую строку, и звонок уходил
 * «ни от кого».
 */
const myId = () => useAuthStore.getState().currentUserId ?? '';

export const useCallStore = create<CallState>((set, get) => {

  const pushHist = (item: Omit<CallHistoryItem,'id'>): CallHistoryItem[] => {
    const h = [{ ...item, id: crypto.randomUUID() }, ...get().history].slice(0, 200);
    saveHist(h); return h;
  };

  /** Поток мог прийти, пока экран звонка ещё не был создан. */
  const adoptRemote = (pc: SkyPeerConnection) => {
    if (!pc.remoteStream.getTracks().length) return;
    set(s => s.active ? ({ active: { ...s.active, remoteStream: pc.remoteStream, connected: true } }) : {});
  };

  /**
   * Код звонка считаем, когда обе стороны обменялись ключами. Раньше
   * этого момента отпечатка собеседника ещё нет, и сверять нечего.
   */
  const readSecurity = (pc: SkyPeerConnection, callId: string) => {
    void computeCallSecurity(pc.pc, callId).then((security) => {
      if (!security) return;
      set(s => (s.active && s.active.callId === callId)
        ? ({ active: { ...s.active, security } }) : {});
    }).catch(() => { /* код не посчитался — экран покажет это честно */ });
  };

  const cleanupPC = () => {
    const { active } = get();
    if (!active) return;
    active.pc?.destroy();
    // Звонок закончен — снимаем все подписки на него и придержанные
    // кандидаты, иначе они копились бы до конца сессии.
    bsignal.off(active.callId);
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
          pc.handleAnswer(msg.sdp)
            .then(() => { adoptRemote(pc); readSecurity(pc, callId); })
            .catch(() => {});
        }
        if (msg.type === 'reject') {
          const h = pushHist({ peerName, peerAvatar, mode, startedAt: new Date().toISOString(), durationSec: 0, status: 'rejected', direction: 'out' });
          cleanupPC();
          set({ active: null, history: h });
        }
        if (msg.type === 'end') {
          get().endCall();
        }
        if (msg.type === 'unavailable') {
          get()._handleUnavailable(callId);
        }
      });

      const localStream = await pc.getMedia(mode === 'video');
      const offer = await pc.createOffer();

      set({
        active: { callId, peerId, peerName, peerAvatar, mode, startedAt: Date.now(),
          localStream, remoteStream: null, screenShareOn: false, direction: 'out', pc,
          connected: false, security: null },
        muted: false, cameraOff: false, speakerOff: false, miniMode: false,
      });

      // Имя в offer — своё: раньше здесь стояло имя того, кому звонят,
      // и на экране входящего человек видел сам себя. Через хаб эти поля
      // не пересылаются вовсе (получатель подписывает звонок сам), они
      // нужны только локальным голосовым комнатам.
      const meAcc = useAuthStore.getState().accounts.find(a => a.id === me);
      bsignal.send({ type: 'offer', callId, from: me, to: peerId, sdp: offer, mode,
        callerName: meAcc?.name ?? 'Звонок', callerAvatar: (meAcc?.name ?? '?').slice(0, 1).toUpperCase() });
      adoptRemote(pc);
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

      // Экран звонка заводим ДО работы с медиа. Поток собеседника
      // приходит уже во время handleOffer, а обработчик кладёт его в
      // active — которого ещё не было, и звук у ответившего пропадал.
      set({
        active: { callId: incoming.callId, peerId: incoming.from, peerName: incoming.callerName,
          peerAvatar: incoming.callerAvatar, mode: incoming.mode, startedAt: Date.now(),
          localStream: null, remoteStream: null, screenShareOn: false, direction: 'in', pc,
          connected: false, security: null },
        incoming: null, muted: false, cameraOff: false, speakerOff: false, miniMode: false,
      });

      const localStream = await pc.getMedia(incoming.mode === 'video');
      set(s => s.active ? ({ active: { ...s.active, localStream } }) : {});

      const answer = await pc.handleOffer(incoming.sdp);
      adoptRemote(pc);
      readSecurity(pc, incoming.callId);

      bsignal.send({ type: 'answer', callId: incoming.callId, from: me, to: incoming.from, sdp: answer });
    },

    /* -- Отклонить ----------------------------------------------------- */
    declineIncoming() {
      const { incoming } = get(); if (!incoming) return;
      const me = myId();
      bsignal.send({ type: 'reject', callId: incoming.callId, from: me, to: incoming.from });
      bsignal.off(incoming.callId);
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
      if (get().active || get().incoming) {
        // Линия занята. Молчать нельзя: у звонящего шли бы гудки до
        // бесконечности — отвечаем отказом сразу.
        bsignal.send({ type: 'reject', callId, from: myId(), to: from });
        return;
      }
      set({ incoming: { callId, from, callerName, callerAvatar, mode, sdp } });
    },

    /** Собеседник не в сети: сервер сказал, что доставить offer некому. */
    _handleUnavailable(callId) {
      const { active } = get();
      if (!active || active.callId !== callId) return;
      // Экран звонка просто закроется — без объяснения это выглядит как
      // сбой, поэтому говорим, что произошло.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sky:call-unavailable',
          { detail: { peerName: active.peerName } }));
      }
      cleanupPC();
      const h = pushHist({ peerName: active.peerName, peerAvatar: active.peerAvatar,
        mode: active.mode, startedAt: new Date(active.startedAt).toISOString(),
        durationSec: 0, status: 'missed', direction: 'out' });
      set({ active: null, miniMode: false, muted: false, cameraOff: false, speakerOff: false, history: h });
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

/* --- Входящие звонки ------------------------------------------------------
   Хаб присылает только то, что адресовано нам, но локальные голосовые
   комнаты вещают всем вкладкам — поэтому адресата всё равно проверяем. */
bsignal.on('__incoming__', (msg) => {
  const me = myId();
  if (!me || msg.to !== me) return;

  if (msg.type === 'offer') {
    // Комнаты обслуживает свой модуль.
    if (msg.callId.startsWith('vp:')) return;
    useCallStore.getState()._handleIncomingOffer({
      callId: msg.callId, from: msg.from,
      callerName: msg.callerName, callerAvatar: msg.callerAvatar,
      mode: msg.mode as CallMode, sdp: msg.sdp,
    });
    return;
  }

  // Звонящий передумал до того, как мы взяли трубку.
  if (msg.type === 'end' || msg.type === 'reject') {
    const inc = useCallStore.getState().incoming;
    if (inc && inc.callId === msg.callId) useCallStore.getState()._handleCallEnd();
  }
});
