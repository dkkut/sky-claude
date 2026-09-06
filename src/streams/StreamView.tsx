/* ===============================================================
   SKY STREAMS — экран просмотра трансляции
=============================================================== */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Eye, Send, Gift, PictureInPicture2, TrendingUp,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useMoney } from '@/wallet/store';
import { useStreamsStore } from './store';
import { StreamViewerConn } from './webrtc';

const S = { bg:'#0a0a0e', l1:'#131318', l2:'#1c1c22', border:'rgba(255,255,255,0.08)', accent:'var(--accent)', t1:'#f2f2f5', t2:'rgba(255,255,255,0.65)', t3:'rgba(255,255,255,0.4)', red:'#e0555f', gold:'#f5b942' };
const REACTS = ['❤️','🔥','😂','👏','😮'];
const DONATE_AMOUNTS = [50, 100, 250, 500];

export const StreamView = ({ streamId, onClose, onOpenProfile }: { streamId: string; onClose: () => void; onOpenProfile: (id: string) => void }) => {
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const { streams, join, leave, sendChat, react, voteOnPrediction } = useStreamsStore();
  const { getBalance, transfer } = useMoney();

  const live = streams[streamId];
  const videoRef = useRef<HTMLVideoElement>(null);
  const connRef = useRef<StreamViewerConn | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [connected, setConnected] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [showDonate, setShowDonate] = useState(false);
  const [donateAmount, setDonateAmount] = useState(100);
  const [floatingReacts, setFloatingReacts] = useState<{ id: number; emoji: string }[]>([]);
  const reactKey = useRef(0);

  useEffect(() => {
    if (!currentUserId || !live) return;
    join(streamId, currentUserId);
    const conn = new StreamViewerConn(streamId, currentUserId, live.authorId, (stream) => {
      if (videoRef.current) videoRef.current.srcObject = stream;
      setConnected(true);
    });
    connRef.current = conn;
    return () => { conn.destroy(); leave(streamId, currentUserId); };
  }, [streamId, currentUserId, live?.authorId]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [live?.chat.length]);

  if (!live) {
    return (
      <div className="fixed inset-0 z-[400] flex flex-col items-center justify-center gap-3" style={{ background: S.bg }}>
        <p className="text-white font-bold">Трансляция завершена</p>
        <button type="button" onClick={onClose} className="rounded-xl px-5 py-2.5 text-sm font-bold text-white" style={{ background: S.accent }}>Закрыть</button>
      </div>
    );
  }

  const sendMsg = () => {
    if (!chatInput.trim() || !currentUserId || !me) return;
    sendChat(streamId, { id: crypto.randomUUID(), userId: currentUserId, userName: me.name, text: chatInput.trim(), createdAt: Date.now() });
    setChatInput('');
  };

  const doReact = (emoji: string) => {
    react(streamId, emoji);
    reactKey.current += 1;
    const id = reactKey.current;
    setFloatingReacts(f => [...f, { id, emoji }]);
    setTimeout(() => setFloatingReacts(f => f.filter(r => r.id !== id)), 1800);
  };

  const donate = () => {
    if (!currentUserId || !me) return;
    const ok = transfer(currentUserId, live.authorId, donateAmount);
    if (!ok) { alert('Недостаточно средств на балансе'); return; }
    sendChat(streamId, {
      id: crypto.randomUUID(), userId: currentUserId, userName: me.name,
      text: `задонатил(а) ${donateAmount}⚡`, createdAt: Date.now(),
      isDonation: true, donationAmount: donateAmount,
    });
    useStreamsStore.getState().updateStream(streamId, { totalDonations: live.totalDonations + donateAmount });
    setShowDonate(false);
  };

  const openPrediction = live.predictions.find(p => !p.closed);

  return (
    <div className="fixed inset-0 z-[400] flex flex-col sm:flex-row" style={{ background: S.bg }}>
      <div className="relative flex-1 min-h-[45vh] sm:min-h-full">
        <video ref={videoRef} autoPlay playsInline className="h-full w-full object-contain bg-black"/>
        {!connected && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: S.accent, borderTopColor: 'transparent' }}/>
            <p className="text-xs" style={{ color: S.t3 }}>Подключение к трансляции...</p>
          </div>
        )}

        <AnimatePresence>
          {floatingReacts.map(r => (
            <motion.div key={r.id} initial={{ opacity: 1, y: 0, x: Math.random()*40-20 }} animate={{ opacity: 0, y: -140 }} exit={{ opacity: 0 }}
              transition={{ duration: 1.8 }} className="absolute bottom-24 right-8 text-2xl pointer-events-none">
              {r.emoji}
            </motion.div>
          ))}
        </AnimatePresence>

        <div className="absolute top-4 inset-x-4 flex items-center gap-2">
          <button type="button" onClick={() => onOpenProfile(live.authorId)}
            className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <div className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white" style={{ background: S.accent }}>{live.authorAvatar}</div>
            <span className="text-xs font-bold text-white">{live.authorName}</span>
          </button>
          <div className="flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: S.red }}>
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse"/><span className="text-[11px] font-bold text-white">LIVE</span>
          </div>
          <div className="flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <Eye size={11} color="#fff"/><span className="text-[11px] font-bold text-white">{live.viewerIds.length}</span>
          </div>
          <div className="flex-1"/>
          {typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (
            <button type="button" onClick={() => videoRef.current?.requestPictureInPicture().catch(() => {})}
              className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.55)' }}>
              <PictureInPicture2 size={14} color="#fff"/>
            </button>
          )}
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <X size={16} color="#fff"/>
          </button>
        </div>

        <p className="absolute top-16 left-4 text-sm font-bold text-white max-w-[70%]" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>{live.title}</p>

        {openPrediction && (
          <div className="absolute inset-x-4 bottom-24 sm:bottom-4 rounded-2xl p-3" style={{ background: 'rgba(20,20,26,0.9)', backdropFilter: 'blur(10px)' }}>
            <p className="flex items-center gap-1.5 text-xs font-bold text-white mb-2"><TrendingUp size={12} style={{ color: S.gold }}/> {openPrediction.question}</p>
            <div className="flex gap-1.5">
              {openPrediction.options.map((opt, i) => {
                const myVote = openPrediction.votes[currentUserId ?? ''];
                const total = Object.keys(openPrediction.votes).length;
                const count = Object.values(openPrediction.votes).filter(v => v === i).length;
                const pct = total > 0 ? Math.round(count / total * 100) : 0;
                return (
                  <button key={i} type="button" disabled={myVote !== undefined}
                    onClick={() => currentUserId && voteOnPrediction(streamId, openPrediction.id, currentUserId, i)}
                    className="relative flex-1 overflow-hidden rounded-lg px-2 py-1.5 text-[11px] font-semibold text-white" style={{ background: 'rgba(255,255,255,0.1)' }}>
                    {myVote !== undefined && <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: i === myVote ? 'rgba(91,155,209,0.5)' : 'rgba(255,255,255,0.15)' }}/>}
                    <span className="relative">{opt} {myVote !== undefined && `${pct}%`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="absolute bottom-4 inset-x-4 flex items-center justify-center gap-2 sm:hidden">
          {REACTS.map(e => (
            <button key={e} type="button" onClick={() => doReact(e)} className="grid h-10 w-10 place-items-center rounded-full text-lg" style={{ background: 'rgba(255,255,255,0.12)' }}>{e}</button>
          ))}
        </div>
      </div>

      <div className="w-full sm:w-[340px] shrink-0 flex flex-col border-t sm:border-t-0 sm:border-l" style={{ borderColor: S.border, background: S.l1 }}>
        <div className="hidden sm:flex items-center justify-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: S.border }}>
          {REACTS.map(e => (
            <button key={e} type="button" onClick={() => doReact(e)} className="grid h-8 w-8 place-items-center rounded-full text-base hover:bg-white/10">{e}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[160px]">
          {live.chat.map(m => (
            <div key={m.id} className="text-xs">
              <button type="button" onClick={() => onOpenProfile(m.userId)} className="font-bold" style={{ color: m.isDonation ? S.gold : S.accent }}>{m.userName}</button>
              <span style={{ color: S.t1 }}>: {m.text}</span>
            </div>
          ))}
          <div ref={chatEndRef}/>
        </div>

        <div className="p-3 border-t space-y-2" style={{ borderColor: S.border }}>
          {showDonate && (
            <div className="rounded-xl p-3 space-y-2" style={{ background: S.l2 }}>
              <p className="text-xs font-bold" style={{ color: S.gold }}>Донат стримеру</p>
              <div className="flex gap-1.5">
                {DONATE_AMOUNTS.map(a => (
                  <button key={a} type="button" onClick={() => setDonateAmount(a)}
                    className="flex-1 rounded-lg py-1.5 text-[11px] font-bold" style={{ background: donateAmount===a?S.gold:'rgba(255,255,255,0.08)', color: donateAmount===a?'#000':S.t2 }}>
                    {a}⚡
                  </button>
                ))}
              </div>
              <p className="text-[10px]" style={{ color: S.t3 }}>Баланс: {currentUserId ? getBalance(currentUserId) : 0}⚡</p>
              <button type="button" onClick={donate} className="w-full rounded-lg py-2 text-xs font-bold" style={{ background: S.gold, color: '#000' }}>Отправить</button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowDonate(v => !v)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: `${S.gold}22` }}>
              <Gift size={15} style={{ color: S.gold }}/>
            </button>
            <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendMsg()}
              placeholder="Написать в чат..." className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={{ background: S.l2, color: S.t1, border: `1px solid ${S.border}` }}/>
            <button type="button" onClick={sendMsg} disabled={!chatInput.trim()} className="grid h-9 w-9 shrink-0 place-items-center rounded-full disabled:opacity-40" style={{ background: S.accent }}>
              <Send size={14} color="#fff"/>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
