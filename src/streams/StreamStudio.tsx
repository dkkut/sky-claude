/* ===============================================================
   SKY STREAMS — Stream Studio
   Отсюда начинается трансляция. Реальная камера/экран через
   getUserMedia/getDisplayMedia, реальные зрители через WebRTC.
=============================================================== */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Video, Monitor, Mic, MicOff, VideoOff, MessageSquare,
  X, Clock, Eye,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useStreamsStore, CATEGORY_LABEL, type StreamCategory, type LiveStreamEntry } from './store';
import { StreamBroadcaster } from './webrtc';

const S = { bg:'#0a0a0e', l1:'#131318', l2:'#1c1c22', border:'rgba(255,255,255,0.08)', accent:'var(--accent)', t1:'#f2f2f5', t2:'rgba(255,255,255,0.65)', t3:'rgba(255,255,255,0.4)', red:'#e0555f' };
const CATS = Object.keys(CATEGORY_LABEL) as StreamCategory[];

interface StreamStudioProps { onClose: () => void; onGoLive?: (id: string) => void; }

export const StreamStudio = ({ onClose, onGoLive }: StreamStudioProps) => {
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const { publish, unpublish, updateStream, sendChat, streams } = useStreamsStore();

  const [phase, setPhase] = useState<'setup' | 'live'>('setup');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<StreamCategory>('talk');
  const [tags, setTags] = useState('');
  const [source, setSource] = useState<'camera' | 'screen'>('camera');

  const [streamId, setStreamId] = useState<string | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const broadcasterRef = useRef<StreamBroadcaster | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [viewerCount, setViewerCount] = useState(0);

  const live = streamId ? streams[streamId] : null;

  useEffect(() => { if (videoRef.current) videoRef.current.srcObject = previewStream; }, [previewStream]);

  useEffect(() => {
    if (phase !== 'live' || !live) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - live.startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase, live?.startedAt]);

  const goLive = async () => {
    if (!title.trim() || !currentUserId || !me) return;
    const b = new StreamBroadcaster(crypto.randomUUID(), currentUserId);
    b.onViewerCount = (n) => setViewerCount(n);
    const stream = source === 'camera' ? await b.startCamera().catch(() => null) : await b.startScreen();
    if (!stream) { alert('Нет доступа к камере/микрофону или демонстрации экрана'); return; }
    broadcasterRef.current = b;
    setPreviewStream(stream);

    const entry: LiveStreamEntry = {
      id: b.streamId, authorId: currentUserId, authorName: me.name, authorAvatar: me.name[0]?.toUpperCase() ?? '?',
      title: title.trim(), category, tags: tags.split(/[,\s]+/).map(t=>t.trim()).filter(Boolean),
      startedAt: Date.now(), viewerIds: [], peakViewers: 0, chat: [], reactions: {}, predictions: [],
      source, totalDonations: 0,
    };
    publish(entry);
    setStreamId(b.streamId);
    setPhase('live');
    onGoLive?.(b.streamId);
  };

  const switchSource = async (kind: 'camera' | 'screen') => {
    const b = broadcasterRef.current; if (!b || !streamId) return;
    const next = await b.switchSource(kind);
    if (next) { setSource(kind); setPreviewStream(next); updateStream(streamId, { source: kind }); }
  };

  const toggleMute = () => {
    const track = previewStream?.getAudioTracks()[0];
    if (track) { track.enabled = muted; setMuted(!muted); }
  };
  const toggleCam = () => {
    const track = previewStream?.getVideoTracks()[0];
    if (track) { track.enabled = camOff; setCamOff(!camOff); }
  };

  const endStream = () => {
    broadcasterRef.current?.destroy();
    if (streamId) unpublish(streamId);
    onClose();
  };

  const sendModChat = () => {
    if (!chatInput.trim() || !streamId || !currentUserId || !me) return;
    sendChat(streamId, { id: crypto.randomUUID(), userId: currentUserId, userName: me.name, text: chatInput.trim(), createdAt: Date.now() });
    setChatInput('');
  };

  const fmtTime = (s: number) => { const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60; return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`; };

  useEffect(() => () => { broadcasterRef.current?.destroy(); }, []);

  if (phase === 'setup') {
    return (
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
        <motion.div initial={{ scale:0.94, opacity:0 }} animate={{ scale:1, opacity:1 }}
          className="w-full max-w-[420px] rounded-3xl p-6" style={{ background: S.l1, border: `1px solid ${S.border}` }}>
          <div className="flex items-center justify-between mb-5">
            <p className="text-lg font-extrabold" style={{ color: S.t1 }}>Начать трансляцию</p>
            <button type="button" onClick={onClose} style={{ color: S.t3 }}><X size={18}/></button>
          </div>

          <p className="text-[11px] font-bold mb-1.5" style={{ color: S.t3 }}>НАЗВАНИЕ</p>
          <input value={title} onChange={e=>setTitle(e.target.value.slice(0,80))} placeholder="О чём стрим?"
            className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none mb-4" style={{ background: S.l2, color: S.t1, border: `1px solid ${S.border}` }}/>

          <p className="text-[11px] font-bold mb-1.5" style={{ color: S.t3 }}>КАТЕГОРИЯ</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {CATS.map(c => (
              <button key={c} type="button" onClick={()=>setCategory(c)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold"
                style={{ background: category===c?S.accent:S.l2, color: category===c?'#fff':S.t2 }}>
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>

          <p className="text-[11px] font-bold mb-1.5" style={{ color: S.t3 }}>ТЕГИ</p>
          <input value={tags} onChange={e=>setTags(e.target.value)} placeholder="через запятую"
            className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none mb-4" style={{ background: S.l2, color: S.t1, border: `1px solid ${S.border}` }}/>

          <p className="text-[11px] font-bold mb-1.5" style={{ color: S.t3 }}>ИСТОЧНИК</p>
          <div className="flex gap-2 mb-6">
            <button type="button" onClick={()=>setSource('camera')}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold"
              style={{ background: source==='camera'?S.accent:S.l2, color: source==='camera'?'#fff':S.t2 }}>
              <Video size={14}/> Камера
            </button>
            <button type="button" onClick={()=>setSource('screen')}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold"
              style={{ background: source==='screen'?S.accent:S.l2, color: source==='screen'?'#fff':S.t2 }}>
              <Monitor size={14}/> Экран
            </button>
          </div>

          <button type="button" onClick={goLive} disabled={!title.trim()}
            className="w-full rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-40"
            style={{ background: S.red }}>
            Начать трансляцию
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[400] flex flex-col sm:flex-row" style={{ background: S.bg }}>
      {/* Preview + controls */}
      <div className="relative flex-1 min-h-[40vh] sm:min-h-full">
        <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain bg-black"/>
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: S.red }}>
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse"/>
            <span className="text-[11px] font-bold text-white">В ЭФИРЕ</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <Clock size={11} color="#fff"/><span className="text-[11px] font-bold text-white">{fmtTime(elapsed)}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <Eye size={11} color="#fff"/><span className="text-[11px] font-bold text-white">{viewerCount}</span>
          </div>
        </div>

        <div className="absolute bottom-4 inset-x-4 flex items-center justify-center gap-3">
          <button type="button" onClick={toggleMute} className="grid h-12 w-12 place-items-center rounded-full" style={{ background: muted?S.red:'rgba(255,255,255,0.14)' }}>
            {muted?<MicOff size={19} color="#fff"/>:<Mic size={19} color="#fff"/>}
          </button>
          <button type="button" onClick={toggleCam} className="grid h-12 w-12 place-items-center rounded-full" style={{ background: camOff?S.red:'rgba(255,255,255,0.14)' }}>
            {camOff?<VideoOff size={19} color="#fff"/>:<Video size={19} color="#fff"/>}
          </button>
          <button type="button" onClick={()=>switchSource(source==='camera'?'screen':'camera')}
            className="grid h-12 w-12 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.14)' }}>
            {source==='camera'?<Monitor size={19} color="#fff"/>:<Video size={19} color="#fff"/>}
          </button>
          <button type="button" onClick={endStream} className="rounded-full px-5 py-3 text-sm font-bold text-white" style={{ background: S.red }}>
            Завершить
          </button>
        </div>
      </div>

      {/* Chat + moderation */}
      <div className="w-full sm:w-[340px] shrink-0 flex flex-col border-t sm:border-t-0 sm:border-l" style={{ borderColor: S.border, background: S.l1 }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0" style={{ borderColor: S.border }}>
          <MessageSquare size={15} style={{ color: S.t2 }}/>
          <p className="flex-1 text-sm font-bold" style={{ color: S.t1 }}>Чат</p>
          <p className="text-xs" style={{ color: S.t3 }}>{live?.chat.length ?? 0}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[160px]">
          {(live?.chat ?? []).length === 0 ? (
            <p className="text-xs text-center py-6" style={{ color: S.t3 }}>Чат появится, когда зрители начнут писать</p>
          ) : live!.chat.map(m => (
            <div key={m.id} className="text-xs">
              <span className="font-bold" style={{ color: m.isDonation?'#f5b942':S.accent }}>{m.userName}</span>
              {m.isDonation && <span className="ml-1 font-bold" style={{ color:'#f5b942' }}>+{m.donationAmount}⚡</span>}
              <span style={{ color: S.t1 }}>: {m.text}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 p-3 border-t shrink-0" style={{ borderColor: S.border }}>
          <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendModChat()}
            placeholder="Написать в чат..." className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={{ background: S.l2, color: S.t1, border: `1px solid ${S.border}` }}/>
        </div>
      </div>
    </div>
  );
};
