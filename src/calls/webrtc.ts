/**
 * WebRTC: медиа-соединение и сигналинг.
 *
 * Сигналинг идёт через тот же хаб, что и сообщения (server/signal.mjs):
 * раньше это был BroadcastChannel, то есть дозвониться можно было
 * только в соседнюю вкладку своего же браузера.
 *
 * Сервер пересылает offer/answer/ICE только между теми, у кого есть
 * общий чат, подставляет отправителя из сессии и не пропускает ничего,
 * кроме нужного самому WebRTC. Поэтому «представиться» чужим именем
 * или дозвониться до незнакомого человека через хаб нельзя.
 */
import { wireSend } from '@/core/wire';

const ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export type SignalMsg =
  | { type: 'offer';     callId: string; from: string; to: string; sdp: RTCSessionDescriptionInit; mode: string; callerName: string; callerAvatar: string }
  | { type: 'answer';    callId: string; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice';       callId: string; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: 'reject';    callId: string; from: string; to: string }
  | { type: 'end';       callId: string; from: string; to: string }
  | { type: 'unavailable'; callId: string; from: string; to: string };

/**
 * Голосовые комнаты пока живут только в браузере: их состав нигде на
 * сервере не хранится, и общего чата у участников может не быть. Пока
 * это так, их сигналинг остаётся на BroadcastChannel — то есть между
 * вкладками одного браузера, как и сама комната.
 */
const PARTY_PREFIX = 'vp:';
const isParty = (callId: string) => callId.startsWith(PARTY_PREFIX);

const SIG_CHANNEL = 'sky:signal:v1';

/** Сколько держим кандидатов, пришедших до ответа на звонок. */
const PENDING_TTL_MS = 60_000;
const PENDING_MAX = 100;

class SkySignal {
  private bc: BroadcastChannel | null = null;
  /**
   * На один звонок подписаны двое: сам SkyPeerConnection (ему нужны
   * ICE-кандидаты) и стор (ему нужны ответ, отказ, завершение). Раньше
   * здесь была одна функция на callId, и вторая подписка молча стирала
   * первую — кандидаты до соединения не доходили вовсе.
   */
  private handlers = new Map<string, Set<(msg: SignalMsg) => void>>();
  /** Пришло раньше, чем появился получатель, — придержим и отдадим потом. */
  private pending = new Map<string, { at: number; msgs: SignalMsg[] }>();

  init() {
    if (this.bc) return;
    if (typeof BroadcastChannel === 'undefined') return;
    this.bc = new BroadcastChannel(SIG_CHANNEL);
    this.bc.onmessage = (e) => this.receive(e.data as SignalMsg);
  }

  /** Единая точка входа: сюда приходит и от хаба, и от комнат. */
  receive(msg: SignalMsg) {
    if (!msg?.callId) return;
    const set = this.handlers.get(msg.callId);
    if (set?.size) {
      for (const fn of [...set]) { try { fn(msg); } catch { /* один упал — остальные работают */ } }
    } else if (msg.type === 'ice') {
      // Кандидаты приходят раньше, чем человек взял трубку: без них
      // соединение потом не установится, поэтому придерживаем.
      this.buffer(msg);
    }
    for (const fn of [...(this.handlers.get('__incoming__') ?? [])]) {
      try { fn(msg); } catch { /* не мешаем остальным */ }
    }
  }

  private buffer(msg: SignalMsg) {
    const now = Date.now();
    for (const [id, box] of this.pending) if (now - box.at > PENDING_TTL_MS) this.pending.delete(id);
    const box = this.pending.get(msg.callId) ?? { at: now, msgs: [] };
    if (box.msgs.length < PENDING_MAX) box.msgs.push(msg);
    box.at = now;
    this.pending.set(msg.callId, box);
  }

  send(msg: SignalMsg) {
    if (isParty(msg.callId)) { this.bc?.postMessage(msg); return; }
    // «to» — единственное, что сервер берёт от клиента: кому звоним.
    // Кто звонит, он знает сам из сессии.
    switch (msg.type) {
      case 'offer':
        wireSend({ type: 'call-offer', payload: { to: msg.to, callId: msg.callId, sdp: msg.sdp, mode: msg.mode } });
        break;
      case 'answer':
        wireSend({ type: 'call-answer', payload: { to: msg.to, callId: msg.callId, sdp: msg.sdp } });
        break;
      case 'ice':
        wireSend({ type: 'ice-candidate', payload: { to: msg.to, callId: msg.callId, candidate: msg.candidate } });
        break;
      case 'reject':
        wireSend({ type: 'call-reject', payload: { to: msg.to, callId: msg.callId } });
        break;
      case 'end':
        wireSend({ type: 'call-end', payload: { to: msg.to, callId: msg.callId } });
        break;
    }
  }

  on(callId: string, handler: (msg: SignalMsg) => void) {
    if (!this.handlers.has(callId)) this.handlers.set(callId, new Set());
    this.handlers.get(callId)!.add(handler);

    const held = this.pending.get(callId);
    if (held) {
      this.pending.delete(callId);
      for (const msg of held.msgs) { try { handler(msg); } catch { /* пропускаем */ } }
    }
  }

  off(callId: string, handler?: (msg: SignalMsg) => void) {
    if (!handler) { this.handlers.delete(callId); this.pending.delete(callId); return; }
    const set = this.handlers.get(callId);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.handlers.delete(callId);
  }
}

export const bsignal = new SkySignal();

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
  private onSignal!: (msg: SignalMsg) => void;
  private pendingIce: RTCIceCandidateInit[] = [];

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

    // Слушаем ICE-кандидатов от собеседника.
    this.onSignal = (msg) => {
      if (msg.from !== this.peerId || msg.type !== 'ice') return;
      this.addCandidate(msg.candidate);
    };
    bsignal.on(this.callId, this.onSignal);
  }

  /**
   * Кандидата нельзя добавить, пока не принято описание другой стороны:
   * браузер отвергнет его, и путь соединения потеряется. Поэтому ранние
   * кандидаты складываем и добавляем сразу после setRemoteDescription.
   */
  private addCandidate(candidate: RTCIceCandidateInit) {
    if (!this.pc.remoteDescription) { this.pendingIce.push(candidate); return; }
    this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  }

  private flushCandidates() {
    const queued = this.pendingIce.splice(0);
    for (const c of queued) this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
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
    this.flushCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.flushCandidates();
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
    // Снимаем только свою подписку: на этом же звонке висит стор.
    bsignal.off(this.callId, this.onSignal);
    this.localStream?.getTracks().forEach(t => t.stop());
    this.pc.close();
  }
}

// Инициализируем сигнал при импорте модуля
bsignal.init();
