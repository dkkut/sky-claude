/* ===============================================================
   SKY STREAMS — WebRTC.
   Собственный сигнальный канал (не пересекается со звонками),
   один RTCPeerConnection на зрителя, единый обработчик всех типов
   сообщений на соединение — без риска перезаписи хендлера.
=============================================================== */
const ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

type SigMsg =
  | { type:'offer';  streamId:string; from:string; to:string; sdp:RTCSessionDescriptionInit }
  | { type:'answer'; streamId:string; from:string; to:string; sdp:RTCSessionDescriptionInit }
  | { type:'ice';    streamId:string; from:string; to:string; candidate:RTCIceCandidateInit }
  | { type:'viewer-request'; streamId:string; from:string };  // зритель просит offer у broadcaster

const CH = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sky:streams:signal:v1') : null;
const listeners = new Set<(m: SigMsg) => void>();
if (CH) CH.onmessage = (e) => listeners.forEach(l => l(e.data));
const sigSend = (m: SigMsg) => CH?.postMessage(m);
const sigOn = (fn: (m: SigMsg) => void) => { listeners.add(fn); return () => listeners.delete(fn); };

/* -- Broadcaster: одно локальное медиа, N peer connections (по одному на зрителя) -- */
export class StreamBroadcaster {
  readonly streamId: string;
  readonly myId: string;
  localStream: MediaStream | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private unsub: () => void;
  onViewerCount: (n: number) => void = () => {};

  constructor(streamId: string, myId: string) {
    this.streamId = streamId;
    this.myId = myId;
    this.unsub = sigOn(async (msg) => {
      if (msg.streamId !== this.streamId) return;
      if (msg.type === 'viewer-request') { await this.addViewer(msg.from); return; }
      if (msg.to !== this.myId) return;
      const pc = this.peers.get(msg.from);
      if (!pc) return;
      if (msg.type === 'answer') await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      if (msg.type === 'ice') { try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {} }
    });
  }

  /** camera или screen — реальный getUserMedia/getDisplayMedia */
  async startCamera(): Promise<MediaStream> {
    this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    return this.localStream;
  }
  async startScreen(): Promise<MediaStream | null> {
    try {
      const screen = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: true });
      this.localStream = screen;
      return screen;
    } catch { return null; }
  }

  /** переключение «сцены» на лету — заменяет видеотрек во всех активных соединениях */
  async switchSource(kind: 'camera' | 'screen'): Promise<MediaStream | null> {
    const next = kind === 'camera' ? await this.startCamera().catch(() => null) : await this.startScreen();
    if (!next) return null;
    const videoTrack = next.getVideoTracks()[0];
    for (const pc of this.peers.values()) {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender && videoTrack) sender.replaceTrack(videoTrack).catch(() => {});
    }
    return next;
  }

  private async addViewer(viewerId: string) {
    if (this.peers.has(viewerId) || !this.localStream) return;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream!));
    pc.onicecandidate = (ev) => { if (ev.candidate) sigSend({ type:'ice', streamId:this.streamId, from:this.myId, to:viewerId, candidate: ev.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        this.peers.delete(viewerId);
        this.onViewerCount(this.peers.size);
      }
    };
    this.peers.set(viewerId, pc);
    this.onViewerCount(this.peers.size);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sigSend({ type:'offer', streamId:this.streamId, from:this.myId, to:viewerId, sdp: offer });
  }

  removeViewer(viewerId: string) {
    this.peers.get(viewerId)?.close();
    this.peers.delete(viewerId);
    this.onViewerCount(this.peers.size);
  }

  destroy() {
    this.unsub();
    this.peers.forEach(pc => pc.close());
    this.peers.clear();
    this.localStream?.getTracks().forEach(t => t.stop());
  }
}

/* -- Viewer: одно peer connection к broadcaster-у --------------------- */
export class StreamViewerConn {
  readonly streamId: string;
  readonly myId: string;
  readonly broadcasterId: string;
  remoteStream = new MediaStream();
  private pc: RTCPeerConnection;
  private unsub: () => void;

  constructor(streamId: string, myId: string, broadcasterId: string, onRemoteStream: (s: MediaStream) => void) {
    this.streamId = streamId; this.myId = myId; this.broadcasterId = broadcasterId;
    this.pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc.ontrack = (ev) => { ev.streams[0]?.getTracks().forEach(t => this.remoteStream.addTrack(t)); onRemoteStream(this.remoteStream); };
    this.pc.onicecandidate = (ev) => { if (ev.candidate) sigSend({ type:'ice', streamId, from:myId, to:broadcasterId, candidate: ev.candidate.toJSON() }); };

    this.unsub = sigOn(async (msg) => {
      if (msg.streamId !== this.streamId || msg.to !== this.myId || msg.from !== this.broadcasterId) return;
      if (msg.type === 'offer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        sigSend({ type:'answer', streamId, from:myId, to:broadcasterId, sdp: answer });
      }
      if (msg.type === 'ice') { try { await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {} }
    });

    // просим broadcaster прислать offer
    sigSend({ type:'viewer-request', streamId, from: myId });
  }

  destroy() { this.unsub(); this.pc.close(); }
}
