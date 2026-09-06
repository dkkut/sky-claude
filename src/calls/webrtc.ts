/**
 * WebRTC через BroadcastChannel как сигнальный канал.
 * Работает между вкладками одного браузера  -  реальный аудио/видео.
 * Когда появится сервер  -  заменить BC на WebSocket в SkySignal.
 */

const ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

type SignalMsg =
  | { type: 'offer';     callId: string; from: string; to: string; sdp: RTCSessionDescriptionInit; mode: string; callerName: string; callerAvatar: string }
  | { type: 'answer';    callId: string; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice';       callId: string; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: 'reject';    callId: string; from: string; to: string }
  | { type: 'end';       callId: string; from: string; to: string }
  | { type: 'ringing';   callId: string; from: string; to: string };

const SIG_CHANNEL = 'sky:signal:v1';

class BroadcastSignal {
  private bc: BroadcastChannel | null = null;
  private handlers = new Map<string, (msg: SignalMsg) => void>();

  init() {
    if (this.bc) return;
    if (typeof BroadcastChannel === 'undefined') return;
    this.bc = new BroadcastChannel(SIG_CHANNEL);
    this.bc.onmessage = (e) => {
      const msg: SignalMsg = e.data;
      // Каждый call имеет свой handler по callId
      this.handlers.get(msg.callId)?.(msg);
      // Также глобальный обработчик входящих
      this.handlers.get('__incoming__')?.(msg);
    };
  }

  send(msg: SignalMsg) { this.bc?.postMessage(msg); }

  on(callId: string, handler: (msg: SignalMsg) => void) { this.handlers.set(callId, handler); }

  off(callId: string) { this.handlers.delete(callId); }
}

export const bsignal = new BroadcastSignal();

/* --- PeerConnection wrapper ------------------------------------------------ */
export class SkyPeerConnection {
  pc: RTCPeerConnection;
  localStream: MediaStream | null = null;
  remoteStream: MediaStream = new MediaStream();
  readonly peerId:  string;
  readonly callId:  string;
  readonly myId:    string;
  private onRemote: (s: MediaStream) => void;
  private onConnected: () => void;
  private onFailed:    () => void;

  constructor(opts: {
    peerId: string; callId: string; myId: string;
    onRemoteStream: (s: MediaStream) => void;
    onConnected?: () => void;
    onFailed?: () => void;
  }) {
    this.peerId      = opts.peerId;
    this.callId      = opts.callId;
    this.myId        = opts.myId;
    this.onRemote    = opts.onRemoteStream;
    this.onConnected = opts.onConnected ?? (() => {});
    this.onFailed    = opts.onFailed    ?? (() => {});

    this.pc = new RTCPeerConnection({ iceServers: ICE });

    this.pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      bsignal.send({ type: 'ice', callId: this.callId, from: this.myId, to: this.peerId, candidate: ev.candidate.toJSON() });
    };

    this.pc.ontrack = (ev) => {
      ev.streams[0]?.getTracks().forEach(t => this.remoteStream.addTrack(t));
      this.onRemote(this.remoteStream);
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'connected')    this.onConnected();
      if (this.pc.connectionState === 'failed')       this.onFailed();
      if (this.pc.connectionState === 'disconnected') this.onFailed();
    };

    // Слушаем ICE-кандидатов от peer
    bsignal.on(this.callId, (msg) => {
      if (msg.from !== this.peerId) return;
      if (msg.type === 'ice') {
        this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
      }
    });
  }

  async getMedia(video: boolean): Promise<MediaStream> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    } catch {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        // микрофон недоступен  -  пустой поток
        this.localStream = new MediaStream();
      }
    }
    this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream!));
    return this.localStream;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  setMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
  }

  setCameraOff(off: boolean) {
    this.localStream?.getVideoTracks().forEach(t => { t.enabled = !off; });
  }

  async startScreenShare(): Promise<MediaStream | null> {
    try {
      const screen = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
      const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(screen.getVideoTracks()[0]);
      return screen;
    } catch { return null; }
  }

  destroy() {
    bsignal.off(this.callId);
    this.localStream?.getTracks().forEach(t => t.stop());
    this.pc.close();
  }
}

// Инициализируем сигнал при импорте модуля
bsignal.init();
