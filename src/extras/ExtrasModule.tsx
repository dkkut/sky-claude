import { Home, BookOpen, Briefcase, Building2, Ban, Bug, Calendar, Check, CheckCircle, ChevronLeft, Clock, Cloud, Crown, Film, Flag, Gem, Heart, Inbox, Lightbulb, MapPin, Megaphone, MessageCircle, MessageSquare, Mic2, MicOff, MoreHorizontal, Music2, Pause, PenLine, Play, Plus, QrCode, Scale, Send, Shield, ShoppingCart, Snowflake, Sparkles, Star, Ticket, Trash2, Tv2, Upload, Users, X, XCircle, Zap, Bot, ChevronUp, ChevronDown } from 'lucide-react';
import { BotsBrowser } from '@/bots/SkyBots';
import { BotCreatorPanel } from '@/bots/BotCreator';
import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlatformStore, grantPrimeForUser, type Track } from '@/platform/store';
import { useAuthStore } from '@/core/auth/store';
import { useMessengerStore } from '@/messenger/store';
import { useVideoStore } from '@/video/store';
import { useModerationStore, type ModDomain, type WarningKind } from '@/shared/moderationStore';
import { BlockedChannelBadge } from '@/shared/ContentWarningGate';
import { useModuleStore } from '@/data/state/modules';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { useAdsStore, AD_PLACEMENTS, AD_STATUS_COLOR, AD_STATUS_LABEL } from '@/ads/store';

/** Заглушка на время подгрузки чанка вкладки. */
const TabFallback = () => (
  <div className="grid h-full place-items-center">
    <div className="h-8 w-8 rounded-full border-2 animate-spin"
      style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }}/>
  </div>
);

/* Экраны хаба «Медиа» — отдельными чанками: открытая вкладка тянет только себя. */
const WorkModule = React.lazy(() => import('@/work/WorkModule').then(m => ({ default: m.WorkModule })));
const FamilyModule = React.lazy(() => import('@/family/FamilyModule').then(m => ({ default: m.FamilyModule })));
const SkyMusic = React.lazy(() => import('./SkyMusic').then(m => ({ default: m.SkyMusic })));
const SkySoundCloud = React.lazy(() => import('./SkySoundCloud').then(m => ({ default: m.SkySoundCloud })));
const SkyFilm = React.lazy(() => import('./SkyFilm').then(m => ({ default: m.SkyFilm })));
const SkyPrime = React.lazy(() => import('./SkyPrime').then(m => ({ default: m.SkyPrime })));
const SkyMarket = React.lazy(() => import('@/marketplace/SkyMarket').then(m => ({ default: m.SkyMarket })));
const SkyAdsCabinet = React.lazy(() => import('@/ads/SkyAds').then(m => ({ default: m.SkyAdsCabinet })));
const SkyBooks = React.lazy(() => import('@/books/SkyBooks').then(m => ({ default: m.SkyBooks })));
const SkyTV = React.lazy(() => import('./SkyTV').then(m => ({ default: m.SkyTV })));
const SkyPodcasts = React.lazy(() => import('@/podcasts/SkyPodcasts').then(m => ({ default: m.SkyPodcasts })));
const SkyAITab = React.lazy(() => import('@/ai/SkyAI').then(m => ({ default: m.SkyAITab })));
const PrimePulse = React.lazy(() => import('@/prime/PrimePulse').then(m => ({ default: m.PrimePulse })));
const MusicianHub = React.lazy(() => import('@/music/MusicianHub').then(m => ({ default: m.MusicianHub })));
const SkyGarant = React.lazy(() => import('@/garant/SkyGarant').then(m => ({ default: m.SkyGarant })));
const SkyPVZ = React.lazy(() => import('@/pvz/SkyPVZ').then(m => ({ default: m.SkyPVZ })));
const SkyGiftsNFT = React.lazy(() => import('@/gifts/SkyGiftsNFT').then(m => ({ default: m.SkyGiftsNFT })));
import { AdminMusicPanel } from '@/music/ArtistSubmit';
import { apiModerationQueue } from '@/music/musicApi';
import { PodcastModeration } from '@/podcasts/PodcastsAdmin';
import { usePodcastPendingCount } from '@/podcasts/usePodcastPending';
import { BotModeration } from '@/bots/BotsAdmin';
import { useBotPendingCount } from '@/bots/useBotPending';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl } from '@/film/filmApi';
import { AdminDisputesPanel, AdminGarantPanel } from '@/admin/AdminDisputes';
import { qrDataUri } from '@/shared/qr';


/* --- BroadcastChannel: синхронизация комнат между вкладками ----------- */
const ROOMS_BC = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('sky:rooms:v1') : null;

type Tab = 'garant'|'home'|'music'|'soundcloud'|'movies'|'prime'|'rooms'|'market'|'pvz'|'nftgifts'|'admin'|'ads'|'books'|'pulse'|'musicians'|'tv'|'podcasts'|'tickets'|'ai'|'bots'|'mybots'|'work'|'family'|'more';

const fmtBytes = (b?: number) => b ? `${(b/1024/1024).toFixed(1)} MB` : '';
const fmtSec = (s: number) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

const toDur = (s: number) => {
  if (!isFinite(s)||s<=0) return '0:00';
  const t=Math.floor(s), h=Math.floor(t/3600), m=Math.floor((t%3600)/60), sec=t%60;
  return h>0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
};
const readDur = (file: File, kind: 'audio'|'video') => new Promise<number>(res => {
  const el=document.createElement(kind), url=URL.createObjectURL(file);
  el.preload='metadata'; el.onloadedmetadata=()=>{URL.revokeObjectURL(url);res(isFinite(el.duration)?el.duration:0);};
  el.onerror=()=>{URL.revokeObjectURL(url);res(0);}; el.src=url;
});
const toBase64 = (file: File): Promise<string> => new Promise((res,rej)=>{
  const r=new FileReader(); r.onload=()=>res(r.result as string); r.onerror=rej; r.readAsDataURL(file);
});

// --- Rooms --------------------------------------------------------------------
const RoomsTab = () => {
  const { rooms, tracks, createRoom, deleteRoom, syncRoomProgress, setRoomActive, joinRoom, leaveRoom, sendRoomMessage, updateRoom } = usePlatformStore();
  // Кино для совместного просмотра берётся из каталога на сервере.
  // Личные фильмы сюда не попадают намеренно: комната — это несколько
  // человек, а личная коллекция на то и личная.
  const movies = useFilmStore(s => s.catalog);
  const loadFilm = useFilmStore(s => s.load);
  useEffect(() => { void loadFilm(); }, [loadFilm]);
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a=>a.id===currentUserId);
  const [activeRoomId, setActiveRoomId] = useState<string|null>(null);
  const [chatMsg, setChatMsg] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<'music'|'movie'>('movie');
  const [newMediaId, setNewMediaId] = useState('');
  const [timer, setTimerVal] = useState<Record<string,number>>({});

  const activeRoom = rooms.find(r=>r.id===activeRoomId);
  const myName = me?.name ?? 'Вы';

  // Слушаем обновления из других вкладок
  useEffect(()=>{
    if(!ROOMS_BC) return;
    const handler = (e: MessageEvent) => {
      const { type, payload } = e.data ?? {};
      if (type === 'room-sync')    syncRoomProgress(payload.roomId, payload.sec);
      if (type === 'room-active')  setRoomActive(payload.roomId, payload.active);
      if (type === 'room-msg')     sendRoomMessage(payload.roomId, payload.author, payload.text);
      if (type === 'room-join')    joinRoom(payload.roomId, payload.userId);
      if (type === 'room-leave')   leaveRoom(payload.roomId, payload.userId);
    };
    ROOMS_BC.onmessage = handler;
    return () => { if(ROOMS_BC) ROOMS_BC.onmessage = null; };
  }, []);

  const create = () => {
    if (!newTitle.trim()) return;
    const id = createRoom({ host: myName, title: newTitle.trim(), mediaType: newType, mediaId: newMediaId||undefined });
    joinRoom(id, currentUserId!);
    setActiveRoomId(id); setCreating(false); setNewTitle('');
  };

  const join = (id: string) => {
    joinRoom(id, currentUserId!);
    ROOMS_BC?.postMessage({ type: 'room-join', payload: { roomId: id, userId: currentUserId } });
    setActiveRoomId(id);
  };
  const leave = (id: string) => {
    leaveRoom(id, currentUserId!);
    ROOMS_BC?.postMessage({ type: 'room-leave', payload: { roomId: id, userId: currentUserId } });
    if(activeRoomId===id) setActiveRoomId(null);
  };

  const sendMsg = () => {
    if (!chatMsg.trim()||!activeRoomId) return;
    sendRoomMessage(activeRoomId, myName, chatMsg.trim());
    ROOMS_BC?.postMessage({ type: 'room-msg', payload: { roomId: activeRoomId, author: myName, text: chatMsg.trim() } });
    setChatMsg('');
  };

  // Playback timer + BC broadcast
  const startPlay = (roomId: string) => {
    setRoomActive(roomId, true);
    ROOMS_BC?.postMessage({ type: 'room-active', payload: { roomId, active: true } });
    const t = window.setInterval(()=>{
      const r = usePlatformStore.getState().rooms.find(r=>r.id===roomId);
      if(!r||!r.active){clearInterval(t);return;}
      const newSec = (r.progressSec||0)+1;
      syncRoomProgress(roomId, newSec);
      ROOMS_BC?.postMessage({ type: 'room-sync', payload: { roomId, sec: newSec } });
    },1000);
    setTimerVal(v=>({...v,[roomId]:t}));
  };
  const stopPlay = (roomId: string) => {
    setRoomActive(roomId, false);
    ROOMS_BC?.postMessage({ type: 'room-active', payload: { roomId, active: false } });
    if(timer[roomId]) { clearInterval(timer[roomId]); setTimerVal(v=>({...v,[roomId]:0})); }
  };

  // Чистим все таймеры при unmount
  useEffect(()=>() => {
    Object.values(timer).forEach(t => { if(t) clearInterval(t); });
  }, [timer]);

  if (activeRoom) {
    const film  = activeRoom.mediaType==='movie' ? movies.find(m=>m.id===activeRoom.mediaId) : undefined;
    const track = activeRoom.mediaType==='movie' ? undefined : tracks.find(t=>t.id===activeRoom.mediaId);
    const media = film ?? track;
    // Постер фильма живёт на сервере и отдаётся по адресу, а обложка
    // трека приходит готовой ссылкой — отсюда две ветки.
    const mediaCover = film?.hasPoster ? posterUrl(film.id) : track?.coverUrl;

    return (
      <div className="flex h-full flex-col overflow-hidden sm:flex-row">
        {/* Player */}
        <div className="flex flex-1 min-h-0 flex-col">
          <div className="flex items-center gap-3 border-b px-4 py-3" style={{borderColor:'var(--border)'}}>
            <button type="button" onClick={()=>setActiveRoomId(null)} style={{color:'var(--t3)'}}>←</button>
            <p className="font-semibold text-white flex-1">{activeRoom.title}</p>
            <span className="text-xs px-2 py-1 rounded-full" style={{background:'rgba(34,197,94,0.1)',color:'#22c55e'}}>
              {activeRoom.participants.length} зрит.
            </span>
            <button type="button" onClick={()=>leave(activeRoom.id)}
              className="rounded-xl px-3 py-1.5 text-xs" style={{background:'rgba(239,68,68,0.1)',color:'var(--red)'}}>
              Выйти
            </button>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
            <div className="h-40 w-40 overflow-hidden rounded-xl grid place-items-center"
              style={{background:'var(--bg-l2)'}}>
              {mediaCover
                ? <img src={mediaCover} alt="" className="h-full w-full object-cover"/>
                : <div className="grid place-items-center" style={{ opacity: 0.3 }}>{activeRoom.mediaType==='movie' ? <Film size={48}/> : <Music2 size={48}/>}</div>}
            </div>
            <div className="text-center">
              <p className="font-bold text-white text-lg">{media?.title ?? activeRoom.title}</p>
              <p className="text-sm mt-1" style={{color:'var(--t3)'}}>Хост: {activeRoom.host}</p>
            </div>
            {/* Progress */}
            <div className="w-full max-w-sm">
              <div className="h-1.5 w-full overflow-hidden rounded-full cursor-pointer" style={{background:'rgba(255,255,255,0.1)'}}
                onClick={e=>{const r=e.currentTarget.getBoundingClientRect(); const pct=(e.clientX-r.left)/r.width; syncRoomProgress(activeRoom.id,Math.floor(pct*300));}}>
                <motion.div className="h-full rounded-full" style={{background:'linear-gradient(90deg,var(--accent),#818cf8)',width:`${Math.min(100,(activeRoom.progressSec/300)*100)}%`}}/>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-xs" style={{color:'var(--t3)'}}>{fmtSec(activeRoom.progressSec)}</span>
                <span className="text-xs" style={{color:'var(--t3)'}}>5:00</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={()=>syncRoomProgress(activeRoom.id,Math.max(0,activeRoom.progressSec-10))}
                className="rounded-2xl px-4 py-2 text-sm" style={{background:'var(--border)',color:'var(--t1)'}}>-10с</button>
              <motion.button whileTap={{scale:0.9}} type="button"
                onClick={()=>activeRoom.active?stopPlay(activeRoom.id):startPlay(activeRoom.id)}
                className="grid h-12 w-12 place-items-center rounded-full"
                style={{background:'var(--accent)'}}>
                {activeRoom.active?<Pause size={20} className="text-white"/>:<Play size={20} className="text-white ml-0.5"/>}
              </motion.button>
              <button type="button" onClick={()=>syncRoomProgress(activeRoom.id,activeRoom.progressSec+10)}
                className="rounded-2xl px-4 py-2 text-sm" style={{background:'var(--border)',color:'var(--t1)'}}>+10с</button>
            </div>
          </div>
        </div>
        {/* Chat */}
        <div className="flex w-full max-h-[40vh] shrink-0 flex-col border-t sm:w-64 sm:max-h-none sm:border-l sm:border-t-0"
          style={{borderColor:'var(--border)'}}>
          <div className="border-b px-3 py-2.5" style={{borderColor:'var(--border)'}}>
            <p className="text-sm font-medium text-white flex items-center gap-1.5"><MessageCircle size={13}/>Чат комнаты</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {activeRoom.chatMessages.length===0&&<p className="text-xs text-center py-4" style={{color:'var(--t3)'}}>Чат пуст</p>}
            {activeRoom.chatMessages.map((m,i)=>(
              <div key={i}>
                <p className="text-xs font-semibold" style={{color:'var(--accent)'}}>{m.author}</p>
                <p className="text-xs" style={{color:'var(--t1)'}}>{m.text}</p>
                <p className="text-[10px]" style={{color:'var(--t3)'}}>{m.time}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2 border-t p-2" style={{borderColor:'var(--border)'}}>
            <input value={chatMsg} onChange={e=>setChatMsg(e.target.value)} placeholder="Сообщение..."
              className="flex-1 rounded-xl px-3 py-2 text-sm outline-none text-white"
              style={{background:'var(--bg-l2)'}}
              onKeyDown={e=>e.key==='Enter'&&sendMsg()}/>
            <button type="button" onClick={sendMsg} className="grid h-9 w-9 place-items-center rounded-xl"
              style={{background:'var(--accent-bg)',color:'var(--accent)'}}><Send size={14}/></button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {creating ? (
        <div className="rounded-xl p-4 space-y-3" style={{background:'var(--bg-l1)',border:'1px solid var(--border)'}}>
          <p className="font-semibold text-white">Новая комната</p>
          <input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="Название комнаты..."
            className="w-full rounded-2xl px-4 py-2.5 text-sm text-white outline-none"
            style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}/>
          <div className="flex gap-2">
            {([['movie','Кино'],['music','Музыка']] as const).map(([k,l])=>(
              <button key={k} type="button" onClick={()=>setNewType(k)}
                className="flex-1 rounded-2xl py-2 text-sm transition-all"
                style={{background:newType===k?'var(--accent-bg)':'var(--bg-l2)',
                  border:`1px solid ${newType===k?'var(--accent-bg)':'var(--border)'}`,
                  color:newType===k?'var(--accent)':'var(--t3)'}}>
                {l}
              </button>
            ))}
          </div>
          <select value={newMediaId} onChange={e=>setNewMediaId(e.target.value)}
            className="w-full rounded-2xl px-4 py-2.5 text-sm outline-none"
            style={{background:'var(--bg-l2)',border:'1px solid var(--border)',color:'var(--t1)'}}>
            <option value=""> -  Выбрать {newType==='movie'?'фильм':'трек'}  - </option>
            {(newType==='movie'?movies:tracks).map((m:any)=>(
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button type="button" onClick={()=>setCreating(false)}
              className="flex-1 rounded-2xl py-2.5 text-sm" style={{background:'var(--border)',color:'var(--t2)'}}>
              Отмена
            </button>
            <motion.button whileTap={{scale:0.97}} type="button" onClick={create} disabled={!newTitle.trim()}
              className="flex-1 rounded-2xl py-2.5 text-sm font-bold text-white disabled:opacity-40"
              style={{background:'var(--accent)'}}>
              Создать
            </motion.button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={()=>setCreating(true)}
          className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-white"
          style={{background:'var(--accent)'}}>
          <Plus size={15}/> Создать комнату
        </button>
      )}

      {rooms.length===0&&!creating&&<p className="text-sm text-center py-8" style={{color:'var(--t3)'}}>Нет комнат. Создай первую!</p>}
      {rooms.map(room=>(
        <div key={room.id} className="rounded-xl p-4" style={{background:'var(--bg-l1)',border:'1px solid var(--border)'}}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="font-medium text-white">{room.title}</p>
              <p className="text-xs mt-0.5" style={{color:'var(--t3)'}}>
                Хост: {room.host} · {room.mediaType==='movie'?'Кино':'Музыка'} · {room.participants.length} зрит.
              </p>
            </div>
            <button type="button" onClick={()=>deleteRoom(room.id)} style={{color:'var(--t3)'}}><Trash2 size={14}/></button>
          </div>
          <button type="button" onClick={()=>join(room.id)}
            className="w-full rounded-2xl py-2.5 text-sm font-medium text-white mt-2"
            style={{background:'var(--accent-bg)',border:'1px solid var(--accent-bg)'}}>
            Войти в комнату →
          </button>
        </div>
      ))}
    </div>
  );
};


const WARNING_LABEL: Record<NonNullable<WarningKind>, string> = { casino: 'Казино', '18+': '18+', casino18: 'Казино + 18+' };

const ModRow = ({ domain, id, title, sub }: { domain: ModDomain; id: string; title: string; sub: string }) => {
  const { warningFor, setWarning, isBlocked, blockForScam, unblock, blockReason } = useModerationStore();
  const { currentUserId } = useAuthStore();
  const warning = warningFor(domain, id);
  const blocked = isBlocked(domain, id);

  return (
    <div className="rounded-2xl p-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
      <p className="truncate text-[13px] font-bold" style={{ color: 'var(--t1)' }}>{title}</p>
      <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>{sub}</p>
      {blocked ? (
        <div className="mt-2 space-y-2">
          <BlockedChannelBadge reason={blockReason(domain, id)} size="sm"/>
          <button type="button" onClick={() => unblock(domain, id)}
            className="w-full rounded-xl py-2 text-[11.5px] font-bold" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
            Снять блокировку
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {(['casino','18+','casino18'] as const).map(w => (
              <button key={w} type="button" onClick={() => setWarning(domain, id, warning === w ? null : w)}
                className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
                style={{ background: warning === w ? 'rgba(245,158,11,0.15)' : 'var(--bg-l2)', color: warning === w ? '#f59e0b' : 'var(--t2)' }}>
                {WARNING_LABEL[w]}
              </button>
            ))}
            {warning && (
              <button type="button" onClick={() => setWarning(domain, id, null)} className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold" style={{ background: 'var(--bg-l2)', color: 'var(--t3)' }}>
                Убрать пометку
              </button>
            )}
          </div>
          <button type="button" onClick={() => currentUserId && blockForScam(domain, id, currentUserId)}
            className="w-full rounded-xl py-2 text-[11.5px] font-bold" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
            Заблокировать за скам
          </button>
        </div>
      )}
    </div>
  );
};

const AdminChannelModerationTab = () => {
  const { chats } = useMessengerStore();
  const { videos } = useVideoStore();
  // Кино берём из общего каталога на сервере: модерировать можно то,
  // что выложено на всех. Личные коллекции сюда не попадают — сервер
  // их не отдаёт никому, включая администратора.
  const movies = useFilmStore(s => s.catalog);
  const loadFilm = useFilmStore(s => s.load);
  const [sub, setSub] = useState<'messenger'|'video'|'movies'>('messenger');
  useEffect(() => { void loadFilm(); }, [loadFilm]);

  const channels = chats.filter(c => c.type === 'channel');
  const videoChannels = [...new Map(videos.map(v => [v.uploadedBy, v.uploaderName])).entries()];

  return (
    <div className="space-y-3 p-4">
      <div className="flex gap-1.5">
        {([['messenger','Мессенджер'],['video','Видеохостинг'],['movies','Кино']] as const).map(([k,l]) => (
          <button key={k} type="button" onClick={() => setSub(k)}
            className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
            style={{ background: sub===k ? 'var(--accent)' : 'var(--bg-l1)', color: sub===k ? '#fff' : 'var(--t2)' }}>
            {l}
          </button>
        ))}
      </div>

      {sub === 'messenger' && (
        channels.length === 0
          ? <p className="py-6 text-center text-xs" style={{ color: 'var(--t3)' }}>Каналов пока нет</p>
          : channels.map(c => <ModRow key={c.id} domain="messenger-channel" id={c.id} title={c.name} sub={`@${c.username} · ${c.members ?? 0} участников`}/>)
      )}
      {sub === 'video' && (
        videoChannels.length === 0
          ? <p className="py-6 text-center text-xs" style={{ color: 'var(--t3)' }}>Каналов пока нет</p>
          : videoChannels.map(([id, name]) => <ModRow key={id} domain="video-channel" id={id} title={name as string} sub="Канал видеохостинга"/>)
      )}
      {sub === 'movies' && (
        movies.length === 0
          ? <p className="py-6 text-center text-xs" style={{ color: 'var(--t3)' }}>Фильмов пока нет</p>
          : movies.map(m => <ModRow key={m.id} domain="movie" id={m.id} title={m.title} sub={m.category}/>)
      )}
    </div>
  );
};

const AdminContentTab = ({ tracks, approveTrack, rejectTrack }: {
  tracks: Track[]; approveTrack: (id:string)=>void; rejectTrack: (id:string)=>void;
}) => {
  const [expandId,     setExpandId]     = useState<string|null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const pending   = tracks.filter(t => t.status === 'pending');
  const published = tracks.filter(t => t.status === 'published');
  return (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold" style={{color:'var(--t1)'}}>Треки на модерации</p>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{background:'rgba(245,158,11,0.12)',color:'#f59e0b'}}>
                  {pending.length} ожидают
                </span>
              </div>

              {pending.length === 0 && (
                <p className="text-xs text-center py-6" style={{color:'var(--t3)'}}>Нет треков на модерации</p>
              )}

              {pending.map(t => {
                const isExp = expandId === t.id;
                const hasSynced = t.syncedLyrics && t.syncedLyrics.length > 0;
                return (
                  <div key={t.id} className="rounded-2xl overflow-hidden"
                    style={{background:'var(--bg-l1)',border:'1px solid var(--border)'}}>
                    {/* Track header */}
                    <div className="flex items-center gap-3 p-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                        style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                        <Music2 size={19} style={{color:'var(--t2)'}}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate" style={{color:'var(--t1)'}}>{t.title}</p>
                        <p className="text-xs truncate" style={{color:'var(--t3)'}}>{t.artist} · {t.genre}</p>
                        <div className="flex gap-1.5 mt-1 flex-wrap">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{background:'rgba(245,158,11,0.12)',color:'#f59e0b'}}>
                            <span className="inline-flex items-center gap-1"><Clock size={9}/> На модерации</span>
                          </span>
                          {hasSynced && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{background:'rgba(99,102,241,0.12)',color:'#818cf8'}}>
                              <MapPin size={11} className="inline mr-1"/>{t.syncedLyrics!.length} тайм-кодов
                            </span>
                          )}
                          {t.uploaderName && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                              style={{background:'rgba(255,255,255,0.05)',color:'var(--t3)'}}>
                              <Users size={11} className="inline mr-1"/>{t.uploaderName}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0 flex-col">
                        <button type="button"
                          onClick={() => { approveTrack(t.id); setExpandId(null); }}
                          className="rounded-xl px-3 py-1.5 text-xs font-bold"
                          style={{background:'rgba(34,197,94,0.12)',color:'#22c55e',border:'1px solid rgba(34,197,94,0.2)',cursor:'pointer'}}>
                          <Check size={13} className="inline mr-1"/>Принять
                        </button>
                        <button type="button"
                          onClick={() => setExpandId(expandId === t.id ? null : t.id)}
                          className="rounded-xl px-3 py-1.5 text-xs font-bold"
                          style={{background:'rgba(255,255,255,0.05)',color:'var(--t3)',border:'1px solid var(--border)',cursor:'pointer'}}>
                          <span className="inline-flex items-center gap-1">
                            {isExp ? <><ChevronUp size={12}/> Скрыть</> : <><ChevronDown size={12}/> Просмотр</>}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Expanded: lyrics + timecodes review */}
                    {isExp && (
                      <div className="border-t px-4 pb-4 pt-3 space-y-3"
                        style={{borderColor:'var(--border)'}}>

                        {/* Lyrics text */}
                        {t.lyrics && (
                          <div>
                            <p className="text-xs font-bold mb-2" style={{color:'var(--t3)'}}>Текст песни</p>
                            <div className="rounded-xl p-3 text-xs leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto"
                              style={{background:'var(--bg-l2)',color:'var(--t2)',scrollbarWidth:'none'}}>
                              {t.lyrics}
                            </div>
                          </div>
                        )}

                        {/* Synced lyrics / timecodes */}
                        {hasSynced && (
                          <div>
                            <p className="text-xs font-bold mb-2" style={{color:'var(--t3)'}}>
                              Тайм-коды ({t.syncedLyrics!.length} фрагментов)
                            </p>
                            <div className="rounded-xl overflow-hidden max-h-48 overflow-y-auto"
                              style={{border:'1px solid var(--border)',scrollbarWidth:'none'}}>
                              {t.syncedLyrics!.map((line, i) => (
                                <div key={i} className="flex items-center gap-3 px-3 py-2"
                                  style={{borderBottom:i<t.syncedLyrics!.length-1?'1px solid var(--border)':'none',background:i%2===0?'var(--bg-l1)':'var(--bg-l2)'}}>
                                  <span className="text-[11px] font-mono shrink-0 font-bold"
                                    style={{color:'var(--accent)',minWidth:36}}>
                                    {`${Math.floor(line.t/60)}:${String(Math.floor(line.t%60)).padStart(2,'0')}`}
                                  </span>
                                  <span className="text-xs flex-1" style={{color:'var(--t1)'}}>{line.text}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Reject with reason */}
                        <div className="space-y-2">
                          <input value={rejectReason} onChange={e=>setRejectReason(e.target.value)}
                            placeholder="Причина отклонения (необязательно)"
                            className="w-full rounded-xl px-3 py-2 text-xs outline-none"
                            style={{background:'var(--bg-l2)',border:'1px solid var(--border)',color:'var(--t1)'}}/>
                          <button type="button"
                            onClick={() => {
                              rejectTrack(t.id);
                              if(rejectReason.trim()) {
                                // rejectReason is shown as part of track status
                              }
                              setRejectReason(''); setExpandId(null);
                            }}
                            className="w-full rounded-xl py-2 text-xs font-bold"
                            style={{background:'rgba(239,68,68,0.1)',color:'#ef4444',border:'1px solid rgba(239,68,68,0.2)',cursor:'pointer'}}>
                            <X size={13} className="inline mr-1"/>Отклонить
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Published tracks overview */}
              {published.length > 0 && (
                <div>
                  <p className="text-sm font-bold mt-4 mb-2" style={{color:'var(--t1)'}}>Опубликованные ({published.length})</p>
                  <div className="space-y-1">
                    {published.slice(0,8).map(t => (
                      <div key={t.id} className="flex items-center gap-2.5 rounded-xl px-3 py-2"
                        style={{background:'var(--bg-l1)'}}>
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                          style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                          <Music2 size={13} style={{color:'var(--t2)'}}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{color:'var(--t1)'}}>{t.title}</p>
                          <p className="text-[10px] truncate" style={{color:'var(--t3)'}}>{t.artist}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {t.syncedLyrics && t.syncedLyrics.length > 0 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{background:'rgba(34,197,94,0.1)',color:'#22c55e'}}>
                              <MapPin size={10} className="inline mr-1"/>{t.syncedLyrics.length}
                            </span>
                          )}
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{background:'rgba(34,197,94,0.1)',color:'#22c55e'}}><Check size={11}/></span>
                          <button type="button"
                            onClick={() => rejectTrack(t.id)}
                            style={{background:'none',border:'none',cursor:'pointer',color:'var(--t3)',fontSize:12}}>
                            <X size={12}/>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>);
};


// --- Admin Panel --------------------------------------------------------------

const AdminSupportTab = () => {
  const [selUid, setSelUid] = useState<string|null>(null);
  const [reply, setReply] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t+1), 4000); return () => clearInterval(id); }, []);
  const supUsers = (() => { try { return JSON.parse(localStorage.getItem("sky:sup:users")||"{}") as Record<string,{name:string;username:string;ts:number}>; } catch { return {}; } })();
  const userIds = Object.keys(supUsers).sort((a,b)=>(supUsers[b]?.ts??0)-(supUsers[a]?.ts??0));
  const getMsgs = (uid:string) => { try { return JSON.parse(localStorage.getItem(`sky:sup:${uid}`)||"[]") as {id:string;text:string;from:"user"|"support";ts:number}[]; } catch { return []; } };
  const sendReply = () => {
    if (!reply.trim() || !selUid) return;
    const updated = [...getMsgs(selUid), {id:Date.now().toString(),text:reply.trim(),from:"support" as const,ts:Date.now()}];
    try { localStorage.setItem(`sky:sup:${selUid}`, JSON.stringify(updated)); } catch {}
    setReply(""); setTick(t=>t+1);
  };
  const msgs = selUid ? getMsgs(selUid) : [];
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden sm:flex-row">
      <div className="w-full max-h-[38vh] shrink-0 border-b overflow-y-auto sm:w-44 sm:max-h-none sm:border-b-0 sm:border-r" style={{borderColor:"var(--border)",scrollbarWidth:"none"}}>
        <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest" style={{color:"var(--t3)"}}>Обращения ({userIds.length})</p>
        {userIds.length===0&&<p className="px-3 py-4 text-xs" style={{color:"var(--t3)"}}>Пусто</p>}
        {userIds.map(uid=>{
          const unread=getMsgs(uid).filter(m=>m.from==="user").length;
          return (<button key={uid} type="button" onClick={()=>setSelUid(uid)} className="w-full text-left px-3 py-2.5 hover:bg-white/5" style={{background:selUid===uid?"rgba(79,110,247,0.1)":"none",border:"none",cursor:"pointer",borderBottom:"1px solid var(--border)"}}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold truncate" style={{color:"var(--t1)"}}>{supUsers[uid]?.name??uid}</p>
              {unread>0&&<span className="text-[9px] font-bold px-1 rounded-full" style={{background:"var(--accent)",color:"#fff"}}>{unread}</span>}
            </div>
            <p className="text-[10px] truncate" style={{color:"var(--t3)"}}>@{supUsers[uid]?.username??uid}</p>
          </button>);
        })}
      </div>
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {!selUid?(
          <div className="grid flex-1 place-items-center"><p className="text-xs" style={{color:"var(--t3)"}}>Выберите обращение</p></div>
        ):(<>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" style={{scrollbarWidth:"none"}}>
            {msgs.map(msg=>(<div key={msg.id} className={`flex ${msg.from==="support"?"justify-end":"justify-start"}`}><div className="max-w-[80%] rounded-xl px-3 py-2" style={{background:msg.from==="support"?"var(--accent)":"var(--bg-l2)",border:msg.from==="support"?"none":"1px solid var(--border)"}}><p className="text-xs" style={{color:msg.from==="support"?"#fff":"var(--t1)"}}>{msg.text}</p></div></div>))}
          </div>
          <div className="flex gap-2 px-3 py-2 border-t shrink-0" style={{borderColor:"var(--border)"}}>
            <input value={reply} onChange={e=>setReply(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")sendReply();}} placeholder="Ответить..." className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={{background:"var(--bg-l2)",border:"1px solid var(--border)",color:"var(--t1)"}}/>
            <button type="button" onClick={sendReply} disabled={!reply.trim()} className="rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40" style={{background:"var(--accent)",color:"#fff",border:"none",cursor:"pointer"}}>→</button>
          </div>
        </>)}
      </div>
    </div>
  );
};


const AdminPanel = () => {
  const { tracks, approveTrack, rejectTrack } = usePlatformStore();
  // Сколько заявок на музыку ждёт решения — спрашиваем сервер: очередь
  // он отдаёт только администратору, и обычному человеку она пуста.
  const [musicPending, setMusicPending] = useState(0);
  useEffect(() => {
    void apiModerationQueue().then(q => setMusicPending(q?.length ?? 0));
  }, []);
  // Столько же для подкастов: очередь отдаётся только администратору,
  // у обычного человека выйдет ноль.
  const podcastPending = usePodcastPendingCount();
  const botPending     = useBotPendingCount();
  const { campaigns, moderate } = useAdsStore();
  const pendingAds = campaigns.filter(c=>c.status==='moderation');
  const { accounts, grantPrime, revokePrime, setAdmin, banUser, muteUser, spamBlock, freezeUser, setModerationNote, currentUserId } = useAuthStore();
  const { reports, resolveReport } = useMessengerStore();
  const [adminTab, setAdminTab] = useState<'reports'|'users'|'moderation'|'podcasts_mod'|'bots_mod'|'content'|'channels'|'ads_mod'|'feedback'|'disputes'|'support'|'garant_adm'>('reports');
  const [selUser, setSelUser] = useState<string|null>(null);
  const [muteMin, setMuteMin] = useState('30');
  const [spamMin, setSpamMin] = useState('60');
  const [freezeH, setFreezeH] = useState('24');
  const [primeD,  setPrimeD]  = useState('30');
  const [moderNote, setModerNote] = useState('');
  const [noteEdit, setNoteEdit] = useState(false);

  const pending = reports.filter(r => r.status === 'pending');
  const selAcc = accounts.find(a => a.id === selUser);

  const fmtUntil = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (d < new Date()) return '(истёк)';
    return `до ${d.toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`;
  };

  const iCls = "w-full rounded-2xl px-4 py-2.5 text-sm text-white outline-none";
  const iSty = {background:'var(--bg-l2)',border:'1px solid var(--border)'};

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sub-tabs */}
      <div className="flex gap-0.5 border-b px-4 pt-2 shrink-0 overflow-x-auto" style={{borderColor:'var(--border)',scrollbarWidth:'none'}}>
        {([
          ['reports',    `Жалобы${pending.length>0?` (${pending.length})`:''}`,    Flag],
          ['users',      'Пользователи',                                              Users],
          ['moderation', `Музыка${musicPending > 0 ? ` (${musicPending})` : ''}`, Music2],
          ['podcasts_mod', `Подкасты${podcastPending > 0 ? ` (${podcastPending})` : ''}`, Mic2],
          ['bots_mod',     `Боты${botPending > 0 ? ` (${botPending})` : ''}`,         Bot],
          ['content',    'Контент',                                                   Upload],
          ['channels',   'Каналы',                                                   Shield],
          ['ads_mod',    `Реклама${pendingAds.length>0?` (${pendingAds.length})`:''}`, Megaphone],
          ['disputes',   `Споры`,      Scale],
          ['garant_adm', `Гарант`,     Shield],
          ['support',    'Поддержка',  MessageSquare],
          ['feedback',   'Обратная связь', MessageSquare],
        ] as const).map(([k,l,Icon])=>(
          <button key={k} type="button" onClick={()=>setAdminTab(k)}
            className="flex shrink-0 items-center gap-1.5 rounded-t-xl px-3 py-2 text-xs font-medium"
            style={{borderBottom:adminTab===k?'2px solid var(--accent)':'2px solid transparent',
              color:adminTab===k?'var(--accent)':'var(--t3)'}}>
            <Icon size={12}/>{l}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto" style={{scrollbarWidth:'none'}}>

        {/* ==== REPORTS ==== */}
        {adminTab==='reports' && (
          <div className="p-4 space-y-3">
            {reports.length===0 && (
              <div className="flex flex-col items-center gap-2 py-12">
                <Flag size={36} style={{color:'var(--t3)'}}/>
                <p className="text-sm" style={{color:'var(--t3)'}}>Жалоб нет</p>
              </div>
            )}
            {reports.map(r => {
              const reporter = accounts.find(a=>a.id===r.reporterId);
              const reported = accounts.find(a=>a.id===r.reportedId);
              const isPending = (r.status??'pending')==='pending';
              return (
                <div key={r.id} className="rounded-2xl overflow-hidden"
                  style={{background:'var(--bg-l1)',border:`1px solid ${isPending?'rgba(245,158,11,0.3)':'var(--border)'}`}}>
                  {/* Header */}
                  <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isPending?'bg-amber-500/20 text-amber-400':'bg-white/8 text-white/35'}`}>
                          {isPending?'Рассматривается':(r.status??'')==='reviewed'?'Рассмотрено':'Отклонено'}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{background:'rgba(239,68,68,0.12)',color:'var(--red)'}}>
                          {r.reason}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs" style={{color:'var(--t2)'}}>
                        <span className="font-semibold text-white">{reporter?.name??'?'}</span>
                        <span style={{color:'var(--t3)'}}>пожаловался на</span>
                        <span className="font-semibold text-white">{reported?.name??r.reportedId??'?'}</span>
                      </div>
                    </div>
                    <span className="text-[10px] shrink-0" style={{color:'var(--t3)'}}>
                      {new Date(typeof r.createdAt === "number" ? r.createdAt : Date.now()).toLocaleDateString('ru',{day:'numeric',month:'short'})}
                    </span>
                  </div>

                  {/* Message */}
                  {r.comment && (
                    <div className="mx-4 mb-3 rounded-xl px-3 py-2.5"
                      style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}>
                      <p className="text-xs leading-relaxed" style={{color:'var(--t2)'}}>{r.comment}</p>
                      {r.messageId && (
                        <p className="text-[10px] mt-1" style={{color:'var(--t3)'}}>
                          Сообщение: {r.messageId.slice(0,12)}... · Чат: {r.chatId}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Quick actions on reported user */}
                  {isPending && r.reportedId && (
                    <div className="px-4 pb-3 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider" style={{color:'var(--t3)'}}>
                        Быстрые действия
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          {label:'Предупреждение',color:'var(--amber)',bg:'rgba(245,158,11,0.12)',
                            act:()=>resolveReport(r.id,'reviewed')},
                          {label:'Мут 1ч',color:'#a855f7',bg:'rgba(168,85,247,0.12)',
                            act:()=>{muteUser(r.reportedId!,60);resolveReport(r.id,'reviewed');}},
                          {label:'Мут 24ч',color:'#a855f7',bg:'rgba(168,85,247,0.12)',
                            act:()=>{muteUser(r.reportedId!,1440);resolveReport(r.id,'reviewed');}},
                          {label:'Спам-блок 1ч',color:'#f97316',bg:'rgba(249,115,22,0.12)',
                            act:()=>{spamBlock(r.reportedId!,60);resolveReport(r.id,'reviewed');}},
                          {label:'Заморозить 24ч',color:'#06b6d4',bg:'rgba(6,182,212,0.12)',
                            act:()=>{freezeUser(r.reportedId!,24);resolveReport(r.id,'reviewed');}},
                          {label:'Заблокировать',color:'#ef4444',bg:'rgba(239,68,68,0.12)',
                            act:()=>{banUser(r.reportedId!,true);resolveReport(r.id,'reviewed');}},
                        ].map(({label,color,bg,act})=>(
                          <button key={label} type="button" onClick={act}
                            className="rounded-xl px-2.5 py-1.5 text-[11px] font-semibold transition-all hover:brightness-110"
                            style={{background:bg,color,border:`1px solid ${color}30`}}>
                            {label}
                          </button>
                        ))}
                      </div>
                      {/* Resolve / Dismiss */}
                      <div className="flex gap-2 pt-1">
                        <button type="button" onClick={()=>resolveReport(r.id,'reviewed')}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold"
                          style={{background:'rgba(34,197,94,0.12)',color:'#22c55e',border:'1px solid rgba(34,197,94,0.25)'}}>
                          <CheckCircle size={13}/> Рассмотрено
                        </button>
                        <button type="button" onClick={()=>resolveReport(r.id,'dismissed')}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold"
                          style={{background:'rgba(239,68,68,0.08)',color:'var(--red)',border:'1px solid rgba(239,68,68,0.2)'}}>
                          <XCircle size={13}/> Отклонить
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ==== USERS ==== */}
        {adminTab==='users' && (
          <div className="flex h-full flex-col sm:flex-row">
            {/* User list */}
            <div className="w-full max-h-[38vh] shrink-0 border-b overflow-y-auto sm:w-44 sm:max-h-none sm:border-b-0 sm:border-r" style={{borderColor:'var(--border)',scrollbarWidth:'none'}}>
              {accounts.map(user=>(
                <button key={user.id} type="button" onClick={()=>{setSelUser(user.id);setModerNote(user.moderationNote??'');setNoteEdit(false);}}
                  className="flex w-full items-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
                  style={{background:selUser===user.id?'var(--accent-bg)':'transparent',
                    borderLeft:selUser===user.id?'2px solid var(--accent)':'2px solid transparent'}}>
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white overflow-hidden"
                    style={{background:'var(--accent-bg)'}}>
                    {user.avatar?<img src={user.avatar} alt="" className="h-full w-full object-cover"/>:user.name[0]}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-1">
                      <p className="text-xs font-semibold truncate text-white">{user.name}</p>
                      {user.isPrime&&<Crown size={9} style={{color:'var(--amber)'}}/>}
                      {user.isAdmin&&<Shield size={9} style={{color:'var(--accent)'}}/>}
                    </div>
                    <p className="text-[10px] truncate" style={{color:'var(--t3)'}}>@{user.username}</p>
                    {/* Status badges */}
                    <div className="flex gap-0.5 mt-0.5 flex-wrap">
                      {user.isBanned&&<span className="text-[8px] px-1 rounded" style={{background:'rgba(239,68,68,0.2)',color:'var(--red)'}}>БАН</span>}
                      {user.isMuted&&<span className="text-[8px] px-1 rounded" style={{background:'rgba(168,85,247,0.2)',color:'#a855f7'}}>МУТ</span>}
                      {user.isFrozen&&<Snowflake size={9} style={{color:'#06b6d4'}}/>}
                      {user.isSpamBlocked&&<span className="text-[8px] px-1 rounded" style={{background:'rgba(249,115,22,0.2)',color:'#f97316'}}>СПАМ</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* User detail */}
            {selAcc ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{scrollbarWidth:'none'}}>
                {/* Profile */}
                <div className="rounded-2xl p-4" style={{background:'var(--bg-l1)',border:'1px solid var(--border)'}}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="grid h-12 w-12 place-items-center rounded-2xl overflow-hidden text-lg font-bold text-white"
                      style={{background:'var(--accent-bg)'}}>
                      {selAcc.avatar?<img src={selAcc.avatar} alt="" className="h-full w-full object-cover"/>:selAcc.name[0]}
                    </div>
                    <div>
                      <p className="font-bold text-white">{selAcc.name}</p>
                      <p className="text-xs" style={{color:'var(--t3)'}}>@{selAcc.username} · {selAcc.phone}</p>
                      <p className="text-[10px] mt-0.5" style={{color:'var(--t3)'}}>
                        Зарегистрирован: {new Date(selAcc.createdAt).toLocaleDateString('ru')}
                      </p>
                    </div>
                  </div>
                  {/* Active restrictions */}
                  <div className="flex flex-wrap gap-1.5">
                    {selAcc.isPrime&&<span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{background:'rgba(245,158,11,0.15)',color:'var(--amber)'}}><Crown size={9} className="inline mr-1"/>Prime {fmtUntil(selAcc.primeUntil)}</span>}
                    {selAcc.isAdmin&&<span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{background:'var(--accent-bg)',color:'var(--accent)'}}><Shield size={9} className="inline mr-1"/>Admin</span>}
                    {selAcc.isBanned&&<span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{background:'rgba(239,68,68,0.15)',color:'var(--red)'}}><Ban size={9} className="inline mr-1"/>Заблокирован</span>}
                    {selAcc.isMuted&&<span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{background:'rgba(168,85,247,0.15)',color:'#a855f7'}}><MicOff size={9} className="inline mr-1"/>Мут {fmtUntil(selAcc.mutedUntil)}</span>}
                    {selAcc.isFrozen&&<span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{background:'rgba(6,182,212,0.15)',color:'#06b6d4'}}><Snowflake size={9} className="inline mr-1"/>Заморожен {fmtUntil(selAcc.frozenUntil)}</span>}
                    {selAcc.isSpamBlocked&&<span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{background:'rgba(249,115,22,0.15)',color:'#f97316'}}><Ban size={9} className="inline mr-1"/>Спам-блок {fmtUntil(selAcc.spamBlockedUntil)}</span>}
                  </div>
                </div>

                {/* Prime subscription */}
                <div className="rounded-2xl p-4 space-y-2.5" style={{background:'var(--bg-l1)',border:'1px solid var(--border)'}}>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{color:'var(--t3)'}}><Crown size={11} className="inline mr-1"/>Подписка Prime</p>
                  <div className="flex gap-2">
                    <input value={primeD} onChange={e=>setPrimeD(e.target.value)}
                      placeholder="Дней" type="number" min="1" max="365"
                      className="w-20 rounded-xl px-3 py-2 text-sm text-white outline-none"
                      style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}/>
                    <button type="button" onClick={()=>{grantPrime(selAcc.id,parseInt(primeD)||30);grantPrimeForUser(selAcc.id,parseInt(primeD)||30);}}
                      className="flex-1 rounded-xl py-2 text-xs font-bold"
                      style={{background:'rgba(245,158,11,0.15)',color:'var(--amber)',border:'1px solid rgba(245,158,11,0.3)'}}>
                      <Check size={13} className="inline mr-1"/>Выдать Prime на {primeD} дн.
                    </button>
                  </div>
                  {selAcc.isPrime&&(
                    <button type="button" onClick={()=>revokePrime(selAcc.id)}
                      className="w-full rounded-xl py-2 text-xs font-bold"
                      style={{background:'rgba(239,68,68,0.08)',color:'var(--red)',border:'1px solid rgba(239,68,68,0.2)'}}>
                      <X size={13} className="inline mr-1"/>Отозвать Prime
                    </button>
                  )}
                  {selAcc.id!==currentUserId&&(
                    <button type="button" onClick={()=>setAdmin(selAcc.id,!selAcc.isAdmin)}
                      className="w-full rounded-xl py-2 text-xs font-bold"
                      style={{background:selAcc.isAdmin?'rgba(239,68,68,0.08)':'var(--accent-bg)',
                        color:selAcc.isAdmin?'var(--red)':'var(--accent)',
                        border:`1px solid ${selAcc.isAdmin?'rgba(239,68,68,0.2)':'var(--accent-bg)'}`}}>
                      <><Shield size={13} className="inline mr-1"/>{selAcc.isAdmin?'Убрать права Admin':'Назначить Admin'}</>
                    </button>
                  )}
                </div>

                {/* Mute (no calls/voice) */}
                <div className="rounded-2xl p-4 space-y-2.5" style={{background:'var(--bg-l1)',border:'1px solid var(--border)'}}>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{color:'var(--t3)'}}><MicOff size={11} className="inline mr-1"/>Запрет говорить</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[['15','15 мин'],['60','1 час'],['360','6 ч'],['1440','24 ч'],['10080','7 дн'],['0','Снять']].map(([v,l])=>(
                      <button key={v} type="button"
                        onClick={()=>muteUser(selAcc.id,parseInt(v))}
                        className="rounded-xl py-2 text-[11px] font-semibold"
                        style={{background:v==='0'?'rgba(34,197,94,0.1)':'rgba(168,85,247,0.1)',
                          color:v==='0'?'#22c55e':'#a855f7',
                          border:`1px solid ${v==='0'?'rgba(34,197,94,0.25)':'rgba(168,85,247,0.2)'}`}}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Spam block */}
                <div className="rounded-2xl p-4 space-y-2.5" style={{background:'var(--bg-l1)',border:'1px solid var(--border)'}}>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{color:'var(--t3)'}}><Ban size={11} className="inline mr-1"/>Спам-блок (ограничение отправки)</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[['30','30 мин'],['60','1 час'],['360','6 ч'],['1440','24 ч'],['10080','7 дн'],['0','Снять']].map(([v,l])=>(
                      <button key={v} type="button"
                        onClick={()=>spamBlock(selAcc.id,parseInt(v))}
                        className="rounded-xl py-2 text-[11px] font-semibold"
                        style={{background:v==='0'?'rgba(34,197,94,0.1)':'rgba(249,115,22,0.1)',
                          color:v==='0'?'#22c55e':'#f97316',
                          border:`1px solid ${v==='0'?'rgba(34,197,94,0.25)':'rgba(249,115,22,0.2)'}`}}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Freeze */}
                <div className="rounded-2xl p-4 space-y-2.5" style={{background:'var(--bg-l1)',border:'1px solid var(--border)'}}>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{color:'var(--t3)'}}><Snowflake size={11} className="inline mr-1"/>Заморозить (только чтение)</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[['1','1 час'],['6','6 ч'],['24','24 ч'],['72','3 дня'],['168','7 дн'],['0','Снять']].map(([v,l])=>(
                      <button key={v} type="button"
                        onClick={()=>freezeUser(selAcc.id,parseInt(v))}
                        className="rounded-xl py-2 text-[11px] font-semibold"
                        style={{background:v==='0'?'rgba(34,197,94,0.1)':'rgba(6,182,212,0.1)',
                          color:v==='0'?'#22c55e':'#06b6d4',
                          border:`1px solid ${v==='0'?'rgba(34,197,94,0.25)':'rgba(6,182,212,0.2)'}`}}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ban */}
                <div className="rounded-2xl p-4 space-y-2" style={{background:'rgba(239,68,68,0.04)',border:'1px solid rgba(239,68,68,0.18)'}}>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{color:'rgba(239,68,68,0.7)'}}><Ban size={11} className="inline mr-1"/>Блокировка</p>
                  {selAcc.isBanned ? (
                    <button type="button" onClick={()=>banUser(selAcc.id,false)}
                      className="w-full rounded-xl py-2.5 text-xs font-bold"
                      style={{background:'rgba(34,197,94,0.12)',color:'#22c55e',border:'1px solid rgba(34,197,94,0.25)'}}>
                      <Check size={13} className="inline mr-1"/>Разблокировать пользователя
                    </button>
                  ) : (
                    <button type="button" onClick={()=>banUser(selAcc.id,true)}
                      className="w-full rounded-xl py-2.5 text-xs font-bold"
                      style={{background:'rgba(239,68,68,0.12)',color:'var(--red)',border:'1px solid rgba(239,68,68,0.25)'}}>
                      <Ban size={13} className="inline mr-1"/>Заблокировать навсегда
                    </button>
                  )}
                </div>

                {/* Moderation note */}
                <div className="rounded-2xl p-4 space-y-2" style={{background:'var(--bg-l1)',border:'1px solid var(--border)'}}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wider" style={{color:'var(--t3)'}}><PenLine size={11} className="inline mr-1"/>Заметка</p>
                    <button type="button" onClick={()=>setNoteEdit(!noteEdit)}
                      className="text-[10px] font-semibold" style={{color:'var(--accent)'}}>
                      {noteEdit?'Отмена':'Изменить'}
                    </button>
                  </div>
                  {noteEdit ? (
                    <div className="space-y-2">
                      <textarea value={moderNote} onChange={e=>setModerNote(e.target.value)}
                        rows={3} placeholder="Заметка о пользователе (видна только администраторам)..."
                        className="w-full rounded-xl px-3 py-2 text-xs text-white outline-none resize-none"
                        style={{background:'var(--bg-l2)',border:'1px solid var(--border)'}}/>
                      <button type="button"
                        onClick={()=>{setModerationNote(selAcc.id,moderNote);setNoteEdit(false);}}
                        className="w-full rounded-xl py-2 text-xs font-bold"
                        style={{background:'var(--accent-bg)',color:'var(--accent)'}}>
                        Сохранить
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs" style={{color:selAcc.moderationNote?'var(--t2)':'var(--t3)'}}>
                      {selAcc.moderationNote||'Нет заметок'}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm" style={{color:'var(--t3)'}}>Выберите пользователя</p>
              </div>
            )}
          </div>
        )}

        {/* ==== MUSIC MODERATION ==== */}
        {adminTab==='moderation' && <AdminMusicPanel/>}

        {/* ==== PODCASTS MODERATION ==== */}
        {adminTab==='podcasts_mod' && <div className="p-4"><PodcastModeration/></div>}

        {/* ==== БОТЫ ==== */}
        {adminTab==='bots_mod'     && <div className="p-4"><BotModeration/></div>}

        {/* ==== СПОРЫ И ГАРАНТ ==== */}
        {adminTab==='disputes'    && <AdminDisputesPanel/>}
        {adminTab==='garant_adm' && <AdminGarantPanel/>}

        {adminTab==='support'    && <AdminSupportTab/>}

        {/* ==== ADS MODERATION ==== */}
        {adminTab==='ads_mod' && (
          <div className="p-4 space-y-3">
            {pendingAds.length===0&&(
              <div className="py-12 text-center"><p className="text-sm" style={{color:'var(--t3)'}}>Нет рекламы на модерации</p></div>
            )}
            {pendingAds.map(ad=>(
              <div key={ad.id} className="rounded-2xl p-4 space-y-3"
                style={{background:'var(--bg-l1)',border:'1px solid rgba(245,158,11,0.2)'}}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white">{ad.title}</p>
                    <p className="text-xs mt-0.5" style={{color:'var(--t2)'}}>{ad.description}</p>
                    <div className="flex gap-2 mt-1.5 text-[10px]" style={{color:'var(--t3)'}}>
                      <span className="inline-flex items-center gap-1"><MapPin size={11}/>{AD_PLACEMENTS.find(p=>p.placement===ad.placement)?.label}</span>
                      <span>{ad.budget.toLocaleString('ru')} ₽</span>
                      <span className="inline-flex items-center gap-1"><Calendar size={11}/>{ad.durationDays} дн.</span>
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0"
                    style={{background:'rgba(245,158,11,0.15)',color:'var(--amber)'}}>Ожидает</span>
                </div>
                {ad.imageUrl&&<img src={ad.imageUrl} alt="" className="w-full max-h-24 object-cover rounded-xl"/>}
                <div className="flex gap-2">
                  <button type="button" onClick={()=>moderate(ad.id,true)}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
                    style={{background:'rgba(34,197,94,0.15)',color:'#22c55e',border:'1px solid rgba(34,197,94,0.3)'}}>
                    <Check size={13} className="inline mr-1"/>Одобрить
                  </button>
                  <button type="button" onClick={()=>moderate(ad.id,false,'Нарушение правил рекламы')}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
                    style={{background:'rgba(239,68,68,0.1)',color:'var(--red)',border:'1px solid rgba(239,68,68,0.2)'}}>
                    <X size={13} className="inline mr-1"/>Отклонить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ==== CONTENT ==== */}
        {adminTab==='feedback' && (() => {
          const feedbackItems = reports.filter(r => r.feedbackType);
          const bugs        = feedbackItems.filter(r => r.feedbackType === 'bug');
          const suggestions = feedbackItems.filter(r => r.feedbackType === 'suggestion');
          const complaints  = feedbackItems.filter(r => r.feedbackType === 'report');
          return (
            <div className="p-4 space-y-3">
              {/* Stats */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label:'Баги', count:bugs.length, color:'var(--red)', Icon:Bug },
                  { label:'Предложения', count:suggestions.length, color:'var(--green)', Icon:Lightbulb },
                  { label:'Жалобы', count:complaints.length, color:'var(--amber)', Icon:Flag },
                ].map(({label,count,color,Icon}) => (
                  <div key={label} className="rounded-2xl p-3 text-center" style={{ background:'var(--bg-l1)', border:`1px solid ${color}25` }}>
                    <Icon size={17} style={{ color, margin:'0 auto' }}/>
                    <p className="text-lg font-black text-white">{count}</p>
                    <p className="text-[10px]" style={{ color:'var(--t3)' }}>{label}</p>
                  </div>
                ))}
              </div>
              {feedbackItems.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10">
                  <Inbox size={34} style={{color:'var(--t3)'}}/>
                  <p className="text-sm" style={{ color:'var(--t3)' }}>Нет обращений</p>
                </div>
              ) : (
                feedbackItems.map((r: any, _fi: number) => {
                  if (!r || typeof r !== 'object') return null;
                  const feedType = r.feedbackType ?? 'bug';
                  const color = feedType==='bug'?'var(--red)':feedType==='suggestion'?'var(--green)':'var(--amber)';
                  const Icon  = feedType==='bug'?Bug:feedType==='suggestion'?Lightbulb:Flag;
                  const reporter = accounts.find(a=>a.id===(r.reporterId??''));
                  const itemKey = r.id ?? `fi-${_fi}`;
                  return (
                    <div key={itemKey} className="rounded-2xl overflow-hidden" style={{ background:'var(--bg-l1)', border:`1px solid ${color}25` }}>
                      <div className="h-0.5" style={{ background:color }}/>
                      <div className="p-4">
                        <div className="flex items-start gap-2.5 mb-2">
                          <Icon size={17} className="shrink-0" style={{ color }}/>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:`${color}20`, color }}>
                                {feedType==='bug'?'Баг':feedType==='suggestion'?'Предложение':'Жалоба'}
                              </span>
                              <span className="text-[10px]" style={{ color:'var(--t3)' }}>
                                {new Date(typeof r.createdAt === "number" ? r.createdAt : Date.now()).toLocaleDateString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
                              </span>
                            </div>
                            {r.feedbackTitle && <p className="text-sm font-bold text-white">{r.feedbackTitle}</p>}
                            <p className="text-xs mt-0.5" style={{ color:'var(--t2)' }}>от {reporter?.name??r.reporterId}</p>
                            {r.comment && (
                              <div className="mt-2 rounded-xl px-3 py-2" style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
                                <p className="text-xs leading-relaxed" style={{ color:'var(--t2)' }}>{r.comment}</p>
                              </div>
                            )}
                          </div>
                        </div>
                        {(r.status??'pending')==='pending' && (
                          <div className="flex gap-2">
                            <button type="button" onClick={()=>resolveReport(r.id,'reviewed')}
                              className="flex-1 rounded-xl py-2 text-xs font-bold"
                              style={{ background:'rgba(34,197,94,0.12)', color:'#22c55e', border:'1px solid rgba(34,197,94,0.25)' }}>
                              <Check size={12} className="inline mr-1"/>Рассмотрено
                            </button>
                            <button type="button" onClick={()=>resolveReport(r.id,'dismissed')}
                              className="flex-1 rounded-xl py-2 text-xs font-bold"
                              style={{ background:'rgba(239,68,68,0.08)', color:'var(--red)', border:'1px solid rgba(239,68,68,0.2)' }}>
                              Закрыть
                            </button>
                          </div>
                        )}
                        {r.status!=='pending' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background:(r.status??'')==='reviewed'?'rgba(34,197,94,0.15)':'var(--border)', color:(r.status??'')==='reviewed'?'#22c55e':'var(--t3)' }}>
                            {(r.status??'')==='reviewed'?'Рассмотрено':'Закрыто'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}

        {adminTab==='content' && <AdminContentTab tracks={tracks} approveTrack={approveTrack} rejectTrack={rejectTrack}/>}
        {adminTab==='channels' && <AdminChannelModerationTab/>}
      </div>
    </div>
  );
};


/* === MORE TAB  -  Прочее ==================================== */
type MoreView = 'hub' | 'garant';

const MoreTab = () => {
  const [view, setView] = useState<MoreView>('hub');

  if (view === 'garant') return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0" style={{borderColor:'var(--border)'}}>
        <button type="button" onClick={()=>setView('hub')}
          className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <ChevronLeft size={16} style={{color:'var(--t2)'}}/>
        </button>
        <Shield size={22} style={{color:'var(--t1)'}}/>
        <p className="text-sm font-bold" style={{color:'var(--t1)'}}>Sky Garant</p>
      </div>
      <div className="flex-1 overflow-hidden">
        <React.Suspense fallback={<TabFallback/>}><SkyGarant/></React.Suspense>
      </div>
    </div>
  );

  const MORE_APPS = [
    { key:'garant' as MoreView, Icon:Shield, label:'Sky Garant',
      desc:'Безопасные сделки между пользователями',
      color:'var(--accent)', badge:0 },
    { key:'hub' as MoreView, Icon:Clock, label:'Скоро',
      desc:'Новые сервисы в разработке', color:'var(--t2)', badge:0, disabled:true },
    { key:'hub' as MoreView, Icon:Clock, label:'Скоро',
      desc:'', color:'var(--t2)', badge:0, disabled:true },
    { key:'hub' as MoreView, Icon:Clock, label:'Скоро',
      desc:'', color:'var(--t2)', badge:0, disabled:true },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{background:'var(--bg)'}}>
      <div className="px-4 pt-4 pb-2 shrink-0">
        <p className="text-lg font-black" style={{color:'var(--t1)'}}>Прочее</p>
        <p className="text-xs mb-4" style={{color:'var(--t3)'}}>Дополнительные сервисы Sky</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{scrollbarWidth:'none'}}>
        <div className="grid grid-cols-2 gap-4">
          {MORE_APPS.map((app, i) => (
            <motion.button key={i} type="button" whileTap={app.disabled?{}:{scale:.95}}
              onClick={()=>!app.disabled&&app.key!=='hub'&&setView(app.key)}
              disabled={app.disabled}
              className="relative flex flex-col items-start gap-3 rounded-3xl p-5 text-left overflow-hidden"
              style={{background:app.disabled?'rgba(255,255,255,0.03)':`linear-gradient(135deg,${app.color}18,var(--bg-l1))`,
                border:`1px solid ${app.disabled?'rgba(255,255,255,0.05)':app.color+'30'}`,
                opacity:app.disabled?0.45:1}}>
              <div className="absolute top-0 right-0 w-20 h-20 rounded-full pointer-events-none"
                style={{background:`radial-gradient(circle,${app.color}12,transparent)`,transform:'translate(30%,-30%)'}}/>
              <div className="grid h-12 w-12 place-items-center rounded-2xl"
                style={{background:app.disabled?'rgba(255,255,255,0.05)':`${app.color}20`}}>
                <app.Icon size={22} style={{color:app.disabled?'var(--t3)':app.color}}/>
              </div>
              <div>
                <p className="text-sm font-black" style={{color:'var(--t1)'}}>{app.label}</p>
                {app.desc&&<p className="text-[10px] mt-0.5 leading-tight" style={{color:app.disabled?'var(--t3)':`${app.color}cc`}}>{app.desc}</p>}
              </div>
              {app.badge>0&&(
                <div className="absolute top-3 right-3 grid h-5 w-5 place-items-center rounded-full text-[10px] font-black text-white"
                  style={{background:app.color}}>{app.badge}</div>
              )}
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- Main ---------------------------------------------------------------------
const TABS = [
  {key:'home',   label:'Главная', icon:Home},
  {key:'music',  label:'Музыка', icon:Music2},
  {key:'soundcloud', label:'SkySound', icon:Cloud},
  {key:'movies', label:'Кино',   icon:Film},
  {key:'tv',      label:'ТВ',       icon:Tv2},
  {key:'bots',     label:'Боты',     icon:Bot},
  {key:'mybots',   label:'Мои боты', icon:Bot},
  {key:'podcasts', label:'Подкасты', icon:Mic2},
  {key:'tickets',  label:'Билеты',   icon:Ticket},
  {key:'ai',       label:'Sky AI',    icon:Sparkles},
  {key:'prime',  label:'Prime',  icon:Crown},
  {key:'rooms',  label:'Вместе', icon:Users},
  {key:'market', label:'Market', icon:ShoppingCart},
  {key:'pvz',    label:'Sky ПВЗ', icon:Building2},
  {key:'nftgifts', label:'Sky Gifts', icon:Gem},
  {key:'work',     label:'Работа',    icon:Briefcase},
  {key:'family',   label:'Sky Family',icon:Users},
  {key:'books',    label:'Книги',    icon:BookOpen},
  {key:'pulse',    label:'Pulse',    icon:Zap},
  {key:'musicians',label:'Артисты',  icon:Mic2},
  {key:'ads',      label:'Реклама',  icon:Megaphone},
  {key:'more',   label:'Прочее', icon:MoreHorizontal},
  {key:'admin',  label:'Admin',  icon:Shield},
  {key:'garant', label:'Гарант', icon:Shield},
] as const;

// ─── TicketsTab ─────────────────────────────────────────────────────────────

const TicketsTab = () => {
  const [tab, setTab]       = useState<'events'|'my'|'fav'>('events');
  const [filter, setFilter] = useState<'all'|'cinema'|'concert'>('all');
  const [city, setCity]     = useState('Все');
  const [priceF, setPriceF] = useState<'all'|'budget'|'mid'|'prem'>('all');
  const [q, setQ]           = useState('');
  const [open, setOpen]     = useState<any>(null);
  const [qty, setQty]       = useState(1);
  const [isVip, setVip]     = useState(false);
  const [confirm, setCfm]   = useState<any>(null);
  const [fav, setFav]       = useState<string[]>([]);
  const [myTix, setMyTix]   = useState<any[]>([]);
  const [showQR, setQR]     = useState<any>(null);

  const EVENTS = [
    { id:'ev1', type:'cinema',  title:'Dune: Part Two',           venue:'Каро 11 Октябрь',    city:'Москва', date:'15 апр', time:'19:30', price:450,  vip:750,  hue:45,  rating:'8.7', desc:'Пол Атрейдес ведёт фрименов. IMAX / Dolby Atmos.', avail:47,   total:220,   tags:['IMAX','Sci-Fi'] },
    { id:'ev2', type:'cinema',  title:'Мастер и Маргарита',       venue:'Формула Кино',        city:'СПб',    date:'17 апр', time:'20:15', price:420,  vip:680,  hue:270, rating:'8.1', desc:'Экранизация романа Булгакова. VIP-зал.',            avail:12,   total:80,    tags:['Драма','VIP'] },
    { id:'ev3', type:'cinema',  title:'Сто лет тому вперёд',      venue:'Синема Парк',         city:'Москва', date:'16 апр', time:'18:00', price:380,  vip:600,  hue:195, rating:'7.4', desc:'Фантастика по Булычёву. Семейный.',                 avail:112,  total:180,   tags:['Семейный'] },
    { id:'ev4', type:'concert', title:'Imagine Dragons',           venue:'СК Олимпийский',      city:'Москва', date:'22 апр', time:'20:00', price:3500, vip:8500, hue:320, rating:'9.2', desc:'Loom World Tour. Фанпит + трибуна + VIP.',           avail:342,  total:8000,  tags:['Рок','World Tour'] },
    { id:'ev5', type:'concert', title:'Miyagi & Andy Panda',       venue:'ВТБ Арена',           city:'Москва', date:'25 апр', time:'21:00', price:2200, vip:5000, hue:185, rating:'8.9', desc:'«Дорога домой» — 10 лет вместе.',                  avail:1240, total:12000, tags:['Хип-хоп'] },
    { id:'ev6', type:'concert', title:'Классика под открытым небом', venue:'Архангельское',     city:'МО',     date:'28 апр', time:'18:00', price:1800, vip:4500, hue:245, rating:'9.5', desc:'Оркестр Большого. Чайковский, Рахманинов.',         avail:560,  total:3000,  tags:['Классика','Open Air'] },
    { id:'ev7', type:'concert', title:'GONE.Fludd',                venue:'Adrenaline Stadium',  city:'Москва', date:'2 мая',  time:'20:30', price:1900, vip:4200, hue:155, rating:'8.4', desc:'«GONE.WILD» — новый альбом вживую. 18+.',           avail:780,  total:5000,  tags:['Инди','18+'] },
  ];

  const fmtP = (n: number) => n.toLocaleString('ru-RU') + ' ₽';
  const stockC = (av: number) => av < 20 ? 'var(--red)' : av < 100 ? 'var(--amber)' : 'var(--green)';
  const stockL = (av: number, tot: number) => Math.round((av / tot) * 100);
  const bgGrad = (hue: number) => `linear-gradient(135deg, hsl(${hue},55%,14%) 0%, hsl(${(hue+55)%360},45%,8%) 100%)`;
  const toggleFav = (id: string) => setFav(f => f.includes(id) ? f.filter(x => x !== id) : [...f, id]);

  const shown = EVENTS.filter(ev => {
    if (filter !== 'all' && ev.type !== filter) return false;
    if (city !== 'Все' && ev.city !== city) return false;
    if (priceF === 'budget' && ev.price > 1000) return false;
    if (priceF === 'mid' && (ev.price < 1000 || ev.price > 5000)) return false;
    if (priceF === 'prem' && ev.price < 5000) return false;
    if (q && !ev.title.toLowerCase().includes(q.toLowerCase()) && !ev.venue.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const buy = (ev: any) => {
    const t = {
      id: 'tkt' + Date.now(), eventId: ev.id, title: ev.title,
      venue: ev.venue, date: ev.date + ' ' + ev.time, type: ev.type,
      qty, isVip, price: (isVip ? ev.vip : ev.price) * qty,
      code: 'SKY-' + Math.random().toString(36).toUpperCase().slice(2, 8),
      hue: ev.hue,
      bought: new Date().toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    };
    setMyTix(m => [t, ...m]);
    setCfm(t);
    setOpen(null);
  };

  // ── QR viewer ──
  if (showQR) return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-xs rounded-3xl overflow-hidden"
        style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}>
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="mb-3 flex justify-center">
            {showQR.type === 'cinema'
              ? <Film size={28} style={{ color:'var(--t2)' }}/>
              : <Music2 size={28} style={{ color:'var(--t2)' }}/>}
          </div>
          <p className="text-base font-bold" style={{ color: 'var(--t1)' }}>{showQR.title}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>{showQR.venue} · {showQR.date}</p>
          {showQR.isVip && <span className="inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,215,0,0.1)', color: '#ffd700' }}>VIP</span>}
        </div>
        <div className="flex justify-center px-6 pb-4">
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <img
              src={qrDataUri(
                JSON.stringify({ id: showQR.code, event: showQR.title, date: showQR.date, venue: showQR.venue, qty: showQR.qty, vip: showQR.isVip }),
                { size: 200, background: '#141420', color: '#ffffff', quietZone: 2 },
              )}
              alt="QR" width={200} height={200} style={{ display: 'block' }} />
          </div>
        </div>
        <div className="px-6 pb-6 space-y-3">
          <div className="rounded-xl px-4 py-3 text-center" style={{ background: 'rgba(79,110,247,0.06)', border: '1px solid rgba(79,110,247,0.12)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--t3)' }}>Код билета</p>
            <p className="text-2xl font-black font-mono tracking-widest" style={{ color: 'var(--accent)' }}>{showQR.code}</p>
          </div>
          <p className="text-[10px] text-center" style={{ color: 'var(--t3)' }}>Покажите QR при входе · Скриншот работает офлайн</p>
          <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => setQR(null)}
            className="w-full rounded-xl py-2.5 text-sm font-bold"
            style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            Закрыть
          </motion.button>
        </div>
      </motion.div>
    </div>
  );

  // ── Confirm ──
  if (confirm) return (
    <div className="flex h-full flex-col items-center justify-center p-5">
      <motion.div initial={{ scale: 0.8, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="w-full max-w-sm rounded-3xl overflow-hidden"
        style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}>
        <div className="p-6 text-center" style={{ background: 'linear-gradient(135deg, rgba(0,200,90,0.08), rgba(0,200,90,0.02))' }}>
          <CheckCircle size={44} className="mx-auto mb-3" style={{ color:'#22c55e' }}/>
          <p className="text-xl font-black" style={{ color: 'var(--t1)' }}>Готово!</p>
          <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Билет сохранён в «Мои билеты»</p>
        </div>
        <div className="px-5 py-4 space-y-0">
          {([['Событие', confirm.title], ['Место', confirm.venue], ['Дата', confirm.date], ['Тип', confirm.isVip ? 'VIP' : 'Стандарт'], ['Количество', confirm.qty + ' шт'], ['Итого', fmtP(confirm.price)]] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between items-center py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="text-xs" style={{ color: 'var(--t3)' }}>{k}</p>
              <p className="text-xs font-bold" style={{ color: 'var(--t1)' }}>{v}</p>
            </div>
          ))}
          <div className="rounded-xl px-4 py-3 text-center mt-3" style={{ background: 'rgba(79,110,247,0.06)', border: '1px solid rgba(79,110,247,0.12)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--t3)' }}>Код</p>
            <p className="text-2xl font-black font-mono tracking-widest" style={{ color: 'var(--accent)' }}>{confirm.code}</p>
          </div>
        </div>
        <div className="flex gap-2 px-5 pb-5 mt-2">
          <motion.button whileTap={{ scale: 0.95 }} type="button"
            onClick={() => { setQR(confirm); setCfm(null); }}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold"
            style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            <QrCode size={13} className="inline mr-1"/>QR-код
          </motion.button>
          <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => setCfm(null)}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold"
            style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}>
            Отлично!
          </motion.button>
        </div>
      </motion.div>
    </div>
  );

  // ── Event detail ──
  if (open) {
    const ev = open;
    const total = (isVip ? ev.vip : ev.price) * qty;
    const avPct = stockL(ev.avail, ev.total);
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <motion.button whileTap={{ scale: 0.9 }} type="button"
            onClick={() => { setOpen(null); setQty(1); setVip(false); }}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </motion.button>
          <p className="flex-1 text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{ev.title}</p>
          <motion.button whileTap={{ scale: 0.85 }} type="button" onClick={() => toggleFav(ev.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20 }}>
            <Heart size={16} fill={fav.includes(ev.id) ? '#ef4444' : 'none'} style={{ color: fav.includes(ev.id) ? '#ef4444' : 'var(--t3)' }}/>
          </motion.button>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {/* Hero */}
          <div className="relative overflow-hidden" style={{ height: 160, background: bgGrad(ev.hue) }}>
            <div className="absolute right-8 top-1/2 -translate-y-1/2" style={{ opacity: 0.12 }}>
              {ev.type === 'cinema'
                ? <Film size={68} style={{ color:'#fff' }}/>
                : <Music2 size={68} style={{ color:'#fff' }}/>}
            </div>
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 60%)' }} />
            <div className="absolute bottom-5 left-5">
              <div className="flex gap-2 mb-2">
                <span className="text-[10px] font-black px-2 py-0.5 rounded" style={{ background: ev.type === 'cinema' ? 'rgba(245,158,11,0.35)' : 'rgba(168,85,247,0.35)', color: ev.type === 'cinema' ? '#f59e0b' : '#a855f7' }}>
                  {ev.type === 'cinema' ? 'КИНО' : 'КОНЦЕРТ'}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}><Star size={9} fill="#fff"/>{ev.rating}</span>
              </div>
              <p className="text-2xl font-black text-white drop-shadow-lg">{ev.title}</p>
            </div>
          </div>

          <div className="p-5 space-y-5">
            {/* Info grid */}
            <div className="grid grid-cols-2 gap-2">
              {([[Calendar, ev.date], [Clock, ev.time], [MapPin, ev.venue], [Building2, ev.city]] as [typeof Calendar, string][]).map(([Icon, val], i) => (
                <div key={i} className="flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                  <Icon size={15} style={{ color: 'var(--t3)' }}/>
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--t1)' }}>{val}</p>
                </div>
              ))}
            </div>

            {/* Tags */}
            <div className="flex gap-2 flex-wrap">
              {ev.tags.map((t: string) => (
                <span key={t} className="text-xs font-bold px-2.5 py-1 rounded-full"
                  style={{ background: `hsl(${ev.hue},40%,12%)`, color: `hsl(${ev.hue},70%,60%)`, border: `1px solid hsl(${ev.hue},40%,22%)` }}>
                  #{t}
                </span>
              ))}
            </div>

            <p className="text-sm leading-relaxed" style={{ color: 'var(--t2)' }}>{ev.desc}</p>

            {/* Availability */}
            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: `1px solid ${ev.avail < 50 ? 'rgba(244,63,94,0.2)' : 'var(--border)'}` }}>
              <div className="flex justify-between items-center mb-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--t3)' }}>Мест доступно</p>
                <p className="text-sm font-bold" style={{ color: stockC(ev.avail) }}>{ev.avail} из {ev.total}</p>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div className="h-full rounded-full" style={{ width: avPct + '%', background: stockC(ev.avail) }} />
              </div>
              {ev.avail < 50 && <p className="inline-flex items-center gap-1 text-[10px] font-bold mt-1.5" style={{ color: 'var(--red)' }}><Zap size={10}/>Торопитесь — осталось мало</p>}
            </div>

            {/* Ticket selector */}
            <div className="rounded-2xl p-4 space-y-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>Тип билета</p>
              <div className="grid grid-cols-2 gap-2">
                {([['Стандарт', false, ev.price], ['VIP', true, ev.vip]] as [string, boolean, number][]).map(([l, v, p]) => (
                  <div key={l} onClick={() => setVip(v)} className="rounded-xl p-3.5 cursor-pointer transition-all"
                    style={{ background: isVip === v ? `hsl(${ev.hue},50%,16%)` : 'var(--bg-l3)', border: `1.5px solid ${isVip === v ? `hsl(${ev.hue},60%,32%)` : 'var(--border)'}` }}>
                    <p className="text-xs font-bold mb-1" style={{ color: isVip === v ? `hsl(${ev.hue},80%,65%)` : 'var(--t2)' }}>{l}</p>
                    <p className="text-lg font-black" style={{ color: 'var(--t1)' }}>{fmtP(p)}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm" style={{ color: 'var(--t2)' }}>Количество</p>
                <div className="flex items-center rounded-xl overflow-hidden" style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)' }}>
                  <motion.button whileTap={{ scale: 0.85 }} type="button" onClick={() => setQty(q => Math.max(1, q - 1))}
                    className="w-10 h-9 grid place-items-center text-lg transition-colors hover:bg-white/10"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)' }}>−</motion.button>
                  <p className="w-8 text-center text-sm font-black" style={{ color: 'var(--t1)' }}>{qty}</p>
                  <motion.button whileTap={{ scale: 0.85 }} type="button" onClick={() => setQty(q => Math.min(8, q + 1))}
                    className="w-10 h-9 grid place-items-center text-lg transition-colors hover:bg-white/10"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)' }}>+</motion.button>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                <p className="text-sm" style={{ color: 'var(--t2)' }}>Итого</p>
                <p className="text-2xl font-black" style={{ color: 'var(--t1)' }}>{fmtP(total)}</p>
              </div>

              <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => buy(ev)}
                className="w-full rounded-xl py-3.5 text-sm font-black"
                style={{ background: `hsl(${ev.hue},65%,42%)`, color: '#fff', border: 'none', cursor: 'pointer', boxShadow: `0 4px 20px hsl(${ev.hue},60%,25%)` }}>
                Купить · {fmtP(total)}
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main ──
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <Ticket size={19} style={{ color:'var(--t1)' }}/>
            <h2 className="text-base font-black" style={{ color: 'var(--t1)' }}>Sky Билеты</h2>
          </div>
          {myTix.length > 0 && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid rgba(79,110,247,0.2)' }}>
              <Ticket size={12} className="inline mr-1"/>{myTix.length}
            </span>
          )}
        </div>
        {/* Search */}
        <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 mb-3" style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--t3)', flexShrink: 0 }}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск событий, площадок..."
            className="flex-1 text-sm bg-transparent outline-none" style={{ color: 'var(--t1)' }} />
          {q && <button type="button" onClick={() => setQ('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 16 }}>×</button>}
        </div>
        {/* Filters */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
          {([['all', 'Все'], ['cinema', 'Кино'], ['concert', 'Концерты']] as [string, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFilter(k as any)}
              className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
              style={{ background: filter === k ? 'var(--t1)' : 'var(--bg-l3)', color: filter === k ? 'var(--bg)' : 'var(--t3)', border: `1px solid ${filter === k ? 'transparent' : 'var(--border)'}`, cursor: 'pointer' }}>
              {l}
            </button>
          ))}
          <div className="w-px shrink-0" style={{ background: 'var(--border)', margin: '2px 4px' }} />
          {(['Все', 'Москва', 'СПб', 'МО']).map(ct => (
            <button key={ct} type="button" onClick={() => setCity(ct)}
              className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
              style={{ background: city === ct ? 'rgba(79,110,247,0.15)' : 'transparent', color: city === ct ? 'var(--accent)' : 'var(--t3)', border: `1px solid ${city === ct ? 'rgba(79,110,247,0.25)' : 'transparent'}`, cursor: 'pointer' }}>
              {ct}
            </button>
          ))}
          <div className="w-px shrink-0" style={{ background: 'var(--border)', margin: '2px 4px' }} />
          {([['all', 'Все'], ['budget', '< 1К'], ['mid', '1–5К'], ['prem', '5К+']] as [string, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setPriceF(k as any)}
              className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-all"
              style={{ background: priceF === k ? 'rgba(0,200,90,0.1)' : 'transparent', color: priceF === k ? 'var(--green)' : 'var(--t3)', border: `1px solid ${priceF === k ? 'rgba(0,200,90,0.2)' : 'transparent'}`, cursor: 'pointer' }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-5 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        {([['events', 'Афиша'], ['my', 'Мои билеты'], ['fav', 'Избранное']] as [string, string][]).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k as any)}
            className="rounded-xl px-4 py-1.5 text-xs font-bold transition-all"
            style={{ background: tab === k ? 'var(--accent)' : 'var(--bg-l2)', color: tab === k ? '#fff' : 'var(--t3)', border: `1px solid ${tab === k ? 'transparent' : 'var(--border)'}`, cursor: 'pointer' }}>
            {l}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ scrollbarWidth: 'none' }}>
        {tab === 'events' && (
          <>
            {shown.map(ev => {
              const urgent = ev.avail < 50;
              return (
                <motion.div key={ev.id} whileHover={{ y: -1 }} onClick={() => { setOpen(ev); setQty(1); setVip(false); }}
                  className="rounded-2xl overflow-hidden cursor-pointer"
                  style={{ background: 'var(--bg-l2)', border: `1px solid ${urgent ? 'rgba(244,63,94,0.25)' : 'var(--border)'}`, boxShadow: urgent ? '0 0 0 1px rgba(244,63,94,0.1)' : 'none' }}>
                  {/* Hero */}
                  <div className="relative overflow-hidden" style={{ height: 80, background: bgGrad(ev.hue) }}>
                    <div className="absolute right-5 top-1/2 -translate-y-1/2" style={{ opacity: 0.15 }}>
                      {ev.type === 'cinema'
                        ? <Film size={46} style={{ color:'#fff' }}/>
                        : <Music2 size={46} style={{ color:'#fff' }}/>}
                    </div>
                    <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.3), transparent 60%)' }} />
                    <div className="absolute inset-0 px-4 flex items-center gap-3">
                      <div>
                        <div className="flex gap-1.5 mb-1.5">
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                            style={{ background: ev.type === 'cinema' ? 'rgba(245,158,11,0.35)' : 'rgba(168,85,247,0.35)', color: ev.type === 'cinema' ? '#f59e0b' : '#a855f7' }}>
                            {ev.type === 'cinema' ? 'КИНО' : 'КОНЦЕРТ'}
                          </span>
                          {urgent && <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={{ background: 'rgba(244,63,94,0.35)', color: '#f43f5e' }}><Zap size={9} className="inline mr-1"/>МАЛО МЕСТ</span>}
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)' }}><Star size={9} fill="currentColor" className="inline mr-1"/>{ev.rating}</span>
                        </div>
                        <p className="text-sm font-black text-white">{ev.title}</p>
                      </div>
                    </div>
                  </div>
                  {/* Info row */}
                  <div className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={12} style={{ color: 'var(--t3)' }}/>
                        <p className="text-xs font-semibold" style={{ color: 'var(--t2)' }}>{ev.date}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin size={12} style={{ color: 'var(--t3)' }}/>
                        <p className="text-xs truncate max-w-[120px]" style={{ color: 'var(--t2)' }}>{ev.venue}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <motion.button whileTap={{ scale: 0.8 }} type="button"
                        onClick={e => { e.stopPropagation(); toggleFav(ev.id); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>
                        <Heart size={16} fill={fav.includes(ev.id) ? '#ef4444' : 'none'} style={{ color: fav.includes(ev.id) ? '#ef4444' : 'var(--t3)' }}/>
                      </motion.button>
                      <div className="text-right">
                        <p className="text-[10px]" style={{ color: 'var(--t3)' }}>от</p>
                        <p className="text-sm font-black" style={{ color: 'var(--t1)' }}>{fmtP(ev.price)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs" style={{ color: stockC(ev.avail) }}>
                        <div className="h-2 w-2 rounded-full" style={{ background: stockC(ev.avail) }} />
                        <span className="font-bold">{ev.avail}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
            {shown.length === 0 && (
              <div className="grid place-items-center h-40">
                <p className="text-sm" style={{ color: 'var(--t3)' }}>Ничего не найдено</p>
              </div>
            )}
          </>
        )}

        {tab === 'my' && (
          myTix.length === 0
            ? <div className="grid place-items-center h-40 text-center"><div><Ticket size={36} className="mx-auto mb-3" style={{ color:'var(--t3)' }}/><p className="text-sm font-bold" style={{ color: 'var(--t2)' }}>Нет билетов</p><p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Купите в разделе «Афиша»</p></div></div>
            : myTix.map((t: any) => (
              <div key={t.id} className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-3 px-4 py-3" style={{ background: bgGrad(t.hue), borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span className="text-2xl">{t.art}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate text-white">{t.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>{t.venue} · {t.date}</p>
                  </div>
                  {t.isVip && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,215,0,0.2)', color: '#ffd700' }}>VIP</span>}
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--t3)' }}>Куплено {t.bought}</p>
                    <p className="text-sm font-black" style={{ color: 'var(--accent)' }}>{fmtP(t.price)}</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-xs font-mono font-bold px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--bg-l3)', color: 'var(--accent)', border: '1px solid var(--border)' }}>{t.code}</span>
                    <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={() => setQR(t)}
                      className="rounded-lg px-3 py-1.5 text-xs font-bold"
                      style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid rgba(79,110,247,0.2)', cursor: 'pointer' }}>
                      <QrCode size={12} className="inline mr-1"/>QR
                    </motion.button>
                  </div>
                </div>
              </div>
            ))
        )}

        {tab === 'fav' && (
          fav.length === 0
            ? <div className="grid place-items-center h-40 text-center"><div><Heart size={36} className="mx-auto mb-3" style={{ color:'var(--t3)' }}/><p className="text-sm font-bold" style={{ color: 'var(--t2)' }}>Нет избранного</p></div></div>
            : EVENTS.filter(ev => fav.includes(ev.id)).map(ev => (
              <motion.div key={ev.id} whileHover={{ y: -1 }} onClick={() => { setOpen(ev); setQty(1); setVip(false); }}
                className="flex items-center gap-3 rounded-2xl px-4 py-3 cursor-pointer"
                style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                <div className="h-12 w-12 rounded-xl grid place-items-center shrink-0" style={{ background: bgGrad(ev.hue) }}>
                  {ev.type === 'cinema'
                    ? <Film size={20} style={{ color:'#fff' }}/>
                    : <Music2 size={20} style={{ color:'#fff' }}/>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{ev.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--t3)' }}>{ev.venue} · {ev.date}</p>
                  <p className="text-xs font-bold mt-1" style={{ color: 'var(--t1)' }}>от {fmtP(ev.price)}</p>
                </div>
                <motion.button whileTap={{ scale: 0.8 }} type="button" onClick={e => { e.stopPropagation(); toggleFav(ev.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}><Heart size={18} fill="#ef4444" style={{ color:'#ef4444' }}/></motion.button>
              </motion.div>
            ))
        )}
      </div>
    </div>
  );
};




/* ─────────────────────────────────────────────────────────────────────────────
   SKY MEDIA LOGO  – SVG inline, adapts to any size
   ───────────────────────────────────────────────────────────────────────────── */
const SkyMediaLogo = ({
  size = 28,
  animated = true,
}: {
  size?: number;
  animated?: boolean;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 36 36"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ flexShrink: 0 }}
  >
    {/* Gradient defs */}
    <defs>
      <linearGradient id="sgLogo" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="55%" stopColor="#4f6ef7" />
        <stop offset="100%" stopColor="#22d3ee" />
      </linearGradient>
      <linearGradient id="sgWave" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#4f6ef7" stopOpacity="0.8" />
        <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.4" />
      </linearGradient>
    </defs>
    {/* Outer ring */}
    <circle cx="18" cy="18" r="17" stroke="url(#sgLogo)" strokeWidth="1.5" opacity="0.25" />
    {/* Inner glow ring */}
    <circle cx="18" cy="18" r="12.5" stroke="url(#sgLogo)" strokeWidth="1" opacity="0.15" />
    {/* Sound-wave bars – 5 bars centred, heights vary like EQ */}
    {[
      { x: 8.5,  h: 6  },
      { x: 12.5, h: 12 },
      { x: 16.5, h: 17 },
      { x: 20.5, h: 12 },
      { x: 24.5, h: 6  },
    ].map(({ x, h }, i) => (
      <rect
        key={i}
        x={x}
        y={18 - h / 2}
        width="2.5"
        height={h}
        rx="1.25"
        fill="url(#sgLogo)"
        opacity={animated ? undefined : 0.9}
        style={
          animated
            ? {
                animation: `skyLogoBar 1.6s ease-in-out ${i * 0.14}s infinite alternate`,
                transformOrigin: `${x + 1.25}px 18px`,
              }
            : undefined
        }
      />
    ))}
    {/* Play triangle – subtle */}
    <path
      d="M15.5 14.2 L22.5 18 L15.5 21.8 Z"
      fill="url(#sgLogo)"
      opacity="0.18"
    />
  </svg>
);

/* logo bar animation */
const _LOGO_CSS =
  typeof document !== 'undefined' && !document.getElementById('_sky-logo-kf')
    ? (() => {
        const s = document.createElement('style');
        s.id = '_sky-logo-kf';
        s.textContent = `
@keyframes skyLogoBar {
  0%   { transform: scaleY(0.55); opacity: 0.6; }
  100% { transform: scaleY(1.0);  opacity: 1;   }
}
@keyframes _skyShimmer {
  0%   { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}
@keyframes skyFadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes skyFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}`;
        document.head.appendChild(s);
        return null;
      })()
    : null;

/* ─────────────────────────────────────────────────────────────────────────────
   MEDIA HOME TAB
   ───────────────────────────────────────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════
   STAR CANVAS — canvas-based starfield, 3 depth layers
   Uses requestAnimationFrame + transform/opacity only.
   Zero DOM nodes for stars → smooth 60fps.
══════════════════════════════════════════════════════════════ */
const StarCanvas = ({ scrollY = 0 }: { scrollY?: number }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const rafRef    = React.useRef<number>(0);
  const starsRef  = React.useRef<Array<{
    x: number; y: number; r: number; speed: number;
    opacity: number; phase: number; layer: number;
  }>>([]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const pr = window.devicePixelRatio || 1;
      const w  = canvas.offsetWidth;
      const h  = canvas.offsetHeight;
      canvas.width  = w * pr;
      canvas.height = h * pr;
      ctx.scale(pr, pr);
    };

    const init = () => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const COUNT = 120;
      starsRef.current = Array.from({ length: COUNT }, () => {
        const layer = Math.random() < 0.5 ? 0 : Math.random() < 0.6 ? 1 : 2;
        return {
          x:       Math.random() * w,
          y:       Math.random() * h,
          r:       layer === 0 ? 0.6 + Math.random() * 0.5
                 : layer === 1 ? 0.9 + Math.random() * 0.8
                               : 1.4 + Math.random() * 1.0,
          speed:   layer === 0 ? 0.04 + Math.random() * 0.04
                 : layer === 1 ? 0.08 + Math.random() * 0.06
                               : 0.14 + Math.random() * 0.10,
          opacity: 0.3 + Math.random() * 0.55,
          phase:   Math.random() * Math.PI * 2,
          layer,
        };
      });
    };

    resize();
    init();

    let t = 0;
    const draw = () => {
      const w  = canvas.offsetWidth;
      const h  = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);

      t += 0.008;

      for (const s of starsRef.current) {
        /* slow drift downward — layer parallax */
        s.y += s.speed;
        if (s.y > h + 4) {
          s.y = -4;
          s.x = Math.random() * w;
        }

        /* twinkle */
        const op = s.opacity * (0.55 + 0.45 * Math.sin(t * 1.8 + s.phase));

        /* colour shift by layer */
        const hue = s.layer === 2 ? 220 : s.layer === 1 ? 240 : 260;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue},70%,90%,${op.toFixed(3)})`;
        ctx.fill();

        /* halo on bright stars */
        if (s.r > 1.2 && op > 0.65) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 2.6, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${hue},80%,90%,${(op * 0.12).toFixed(3)})`;
          ctx.fill();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    const ro = new ResizeObserver(() => { resize(); init(); });
    ro.observe(canvas);

    draw();
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  /* parallax offset on scroll */
  const parallax = scrollY * 0.18;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{
        transform: `translateY(${parallax}px)`,
        transition: 'transform .05s linear',
        zIndex: 0,
      }}
    />
  );
};

const MediaHomeTab = ({
  onNav,
}: {
  onNav: (tab: string) => void;
}) => {
  const { tracks } = usePlatformStore();
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const isPrime = me?.isPrime ?? false;
  const isMobile = useIsMobile();
  const hr = new Date().getHours();
  const greeting = hr < 6 ? 'Доброй ночи' : hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер';
  const recentTracks = tracks.slice(0, 8);

  const [listenMin]  = React.useState(() => Math.floor(Math.random() * 120 + 20));
  const [activeRec, setActiveRec] = React.useState<number|null>(null);
  const [scrollY, setScrollY]     = React.useState(0);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  /* track scroll for parallax */
  const onScroll = React.useCallback(() => {
    if (scrollRef.current) setScrollY(scrollRef.current.scrollTop);
  }, []);


  const fu = (i: number) => ({
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.36, delay: i * 0.07, ease: [0.22,1,0.36,1] as any },
  });

  /* Значки разделов — из общего набора приложения, а не эмодзи.
     Эмодзи рисует шрифт устройства: на телефоне, на компьютере и на
     телевизоре это три разные картинки разного веса и цвета, и
     подстроить их под остальной интерфейс нельзя. Значок же берёт
     цвет и толщину линии оттуда же, откуда вся остальная разметка. */
  const SECTIONS = [
    { key:'music',   Icon:Music2,   label:'Музыка',   color:'#6366f1', bg:'rgba(99,102,241,.12)'  },
    { key:'movies',  Icon:Film,     label:'Кино',     color:'#f43f5e', bg:'rgba(244,63,94,.12)'   },
    { key:'tv',      Icon:Tv2,      label:'ТВ',       color:'#a855f7', bg:'rgba(168,85,247,.12)'  },
    { key:'podcasts',Icon:Mic2,     label:'Подкасты', color:'#10b981', bg:'rgba(16,185,129,.12)'  },
    { key:'tickets', Icon:Ticket,   label:'Билеты',   color:'#f59e0b', bg:'rgba(245,158,11,.12)'  },
    { key:'ai',      Icon:Sparkles, label:'Sky AI',   color:'#8b5cf6', bg:'rgba(139,92,246,.12)'  },
  ] as const;

  const FEATURED = [
    { title:'Lo-Fi Chill 2026',  sub:'Плейлист · 38 треков', Icon:Music2,   g:['#1e1b4b','#312e81'] as [string,string] },
    { title:'Sky Tech Podcast',  sub:'Еп. 54 · 42 мин',       Icon:Mic2,     g:['#052e16','#14532d'] as [string,string] },
    { title:'Neon Racer OST',    sub:'Саундтрек · 22 трека',  Icon:Zap,      g:['#1c1917','#44403c'] as [string,string] },
    { title:'Sky Hits · Апрель', sub:'Топ 50 · Каждую неделю',Icon:Sparkles, g:['#450a0a','#7f1d1d'] as [string,string] },
    { title:'Midnight Vibes',    sub:'Плейлист · 18 треков',  Icon:Music2,   g:['#0c0a09','#292524'] as [string,string] },
  ];

  const fmtMin = (m: number) => m >= 60 ? `${Math.floor(m/60)}ч ${m%60}м` : `${m}м`;

  return (
    <div ref={scrollRef} onScroll={onScroll}
      className="flex-1 overflow-y-auto relative" style={{ scrollbarWidth:'none' }}>

      {/* ── STAR FIELD (canvas, behind all content) ───────────── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex:0 }}>
        {/* Deep space gradient base */}
        <div className="absolute inset-0"
          style={{ background:'linear-gradient(175deg,#04050f 0%,#080b18 40%,#0a0618 100%)' }}/>
        {/* Nebula glows */}
        <div className="absolute pointer-events-none"
          style={{ top:'-10%', right:'-5%', width:'55%', height:'55%', borderRadius:'50%',
            background:'radial-gradient(circle,rgba(79,70,229,.08) 0%,transparent 65%)' }}/>
        <div className="absolute pointer-events-none"
          style={{ bottom:'10%', left:'-8%', width:'45%', height:'45%', borderRadius:'50%',
            background:'radial-gradient(circle,rgba(139,92,246,.06) 0%,transparent 65%)' }}/>
        <div className="absolute pointer-events-none"
          style={{ top:'35%', left:'30%', width:'40%', height:'40%', borderRadius:'50%',
            background:'radial-gradient(circle,rgba(59,130,246,.04) 0%,transparent 65%)' }}/>
        {/* Stars canvas */}
        <StarCanvas scrollY={scrollY}/>
      </div>

      {/* Content sits above the star field */}
      <div className="relative" style={{ zIndex:1 }}>

      {/* ── HERO ─────────────────────────────────────────────── */}
      <motion.div {...fu(0)} className={`relative overflow-hidden rounded-3xl ${isMobile ? 'mx-3 mt-3' : 'mx-4 mt-4'}`}
        style={{ background:'linear-gradient(145deg,#0f0c29,#302b63,#24243e)', minHeight: isMobile ? 136 : 168,
          boxShadow:'0 20px 60px rgba(0,0,0,.55)', border:'1px solid rgba(255,255,255,.07)' }}>
        {/* Stars bg */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(22)].map((_,i)=>(
            <div key={i} className="absolute rounded-full"
              style={{ width:i%4===0?2.5:1.5, height:i%4===0?2.5:1.5, background:'#fff',
                top:`${5+i%6*16}%`, left:`${3+i*4.4}%`,
                opacity:.2+Math.sin(i)*.25,
                animation:`pulse3d2 ${2+i*.15}s ease-in-out ${i*.12}s infinite` }}/>
          ))}
        </div>
        {/* Glow */}
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full pointer-events-none"
          style={{ background:'radial-gradient(circle,rgba(99,102,241,.3) 0%,transparent 70%)' }}/>
        <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full pointer-events-none"
          style={{ background:'radial-gradient(circle,rgba(168,85,247,.2) 0%,transparent 70%)' }}/>

        <div className={isMobile ? 'relative p-4' : 'relative p-6'}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <SkyMediaLogo size={isMobile ? 15 : 18} animated={false}/>
                <span className="text-[10px] font-black uppercase tracking-[0.18em]"
                  style={{ color:'rgba(99,102,241,.9)' }}>Sky Media</span>
              </div>
              <p className={isMobile ? 'text-[17px] font-black text-white leading-tight tracking-tight' : 'text-[22px] font-black text-white leading-tight tracking-tight'}>
                {greeting}{me?.name ? `,\u00a0${me.name.split(' ')[0]}` : ''}
              </p>
              <p className="text-[11px] mt-1.5" style={{ color:'rgba(255,255,255,.4)' }}>
                Сегодня {fmtMin(listenMin)} медиа
              </p>
            </div>
            {isPrime && (
              <div className="rounded-full px-2.5 py-1 shrink-0 mt-1"
                style={{ background:'rgba(245,158,11,.15)', border:'1px solid rgba(245,158,11,.3)' }}>
                <span className="inline-flex items-center gap-1 text-[9.5px] font-black" style={{ color:'#f59e0b' }}><Crown size={9}/>PRIME</span>
              </div>
            )}
          </div>

          {/* My Flow big button */}
          <motion.button whileTap={{ scale:.97 }} whileHover={{ scale:1.015 }}
            type="button" onClick={() => onNav('music')}
            className={isMobile ? 'mt-3.5 w-full flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 relative overflow-hidden' : 'mt-5 w-full flex items-center gap-3 rounded-2xl px-4 py-3 relative overflow-hidden'}
            style={{ background:'rgba(255,255,255,.07)', border:'1px solid rgba(255,255,255,.1)',
              backdropFilter:'blur(12px)', cursor:'pointer' }}>
            {/* wave */}
            <div className="absolute inset-0 pointer-events-none opacity-15"
              style={{ backgroundImage:"url(\"data:image/svg+xml,%3Csvg width='120' height='30' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 15 Q15 5 30 15 Q45 25 60 15 Q75 5 90 15 Q105 25 120 15' fill='none' stroke='white' stroke-width='1.2'/%3E%3C/svg%3E\")",
                backgroundRepeat:'repeat-x', backgroundSize:'120px 30px', backgroundPosition:'center' }}/>
            <div className={isMobile ? 'grid h-7 w-7 place-items-center rounded-lg shrink-0' : 'grid h-9 w-9 place-items-center rounded-xl shrink-0'}
              style={{ background:'linear-gradient(135deg,rgba(99,102,241,.5),rgba(168,85,247,.4))',
                border:'1px solid rgba(255,255,255,.15)' }}>
              <Music2 size={17} style={{ color:'var(--t2)' }}/>
            </div>
            <div className="flex-1 text-left">
              <p className="text-[13px] font-black text-white">Мой поток</p>
              <p className="text-[10px]" style={{ color:'rgba(255,255,255,.5)' }}>Персональная подборка · Только для тебя</p>
            </div>
            <div className="grid h-7 w-7 place-items-center rounded-full shrink-0"
              style={{ background:'rgba(255,255,255,.12)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </div>
          </motion.button>
        </div>
        <style>{`@keyframes pulse3d2{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.9;transform:scale(1.8)}}`}</style>
      </motion.div>

      {/* ── SECTIONS GRID ────────────────────────────────────── */}
      <motion.section {...fu(1)} className={isMobile ? 'px-3 mt-4' : 'px-4 mt-5'}>
        <p className="text-[10px] font-black uppercase tracking-[0.16em] mb-2.5"
          style={{ color:'var(--t3)' }}>Разделы</p>
        <div className={isMobile ? 'grid grid-cols-4 gap-1.5' : 'grid grid-cols-3 gap-2'}>
          {SECTIONS.map(({ key, Icon, label, color, bg }) => (
            <motion.button key={key} type="button"
              whileHover={{ scale:1.04, y:-2 }} whileTap={{ scale:.93 }}
              onClick={() => onNav(key)}
              className={isMobile ? 'flex flex-col items-center gap-1 rounded-xl py-2.5' : 'flex flex-col items-center gap-2 rounded-2xl py-4'}
              style={{ background:'var(--bg-l2)', border:'1px solid var(--border)', cursor:'pointer' }}>
              <div className={isMobile ? 'grid h-7 w-7 place-items-center rounded-lg' : 'grid h-10 w-10 place-items-center rounded-xl'}
                style={{ background:bg, border:`1px solid ${color}28` }}>
                <Icon size={isMobile ? 15 : 20} style={{ color }}/>
              </div>
              <span className={isMobile ? 'text-[9.5px] font-bold text-center leading-tight' : 'text-[11px] font-bold'} style={{ color:'var(--t1)' }}>{label}</span>
            </motion.button>
          ))}
        </div>
      </motion.section>

      {/* ── FEATURED HORIZONTAL ──────────────────────────────── */}
      <motion.section {...fu(2)} className="mt-5">
        <div className={`flex items-center justify-between mb-2.5 ${isMobile ? 'px-3' : 'px-4'}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.16em]"
            style={{ color:'var(--t3)' }}>Подборки</p>
          <button type="button" onClick={() => onNav('music')}
            className="text-[11px] font-bold" style={{ color:'var(--accent)', background:'none', border:'none', cursor:'pointer' }}>
            Все →
          </button>
        </div>
        <div className={`flex overflow-x-auto pb-1 ${isMobile ? 'gap-2 px-3' : 'gap-3 px-4'}`} style={{ scrollbarWidth:'none' }}>
          {FEATURED.map((f, i) => {
            const cardSize = isMobile ? 108 : 148;
            return (
            <motion.div key={f.title}
              initial={{ opacity:0, x:16 }} animate={{ opacity:1, x:0 }}
              transition={{ delay:.15+i*.07, duration:.35, ease:[.22,1,.36,1] }}
              whileHover={{ y:-4 }} whileTap={{ scale:.96 }}
              className="shrink-0 cursor-pointer" style={{ width:cardSize }}
              onClick={() => onNav('music')}>
              {/* Cover */}
              <div className="relative overflow-hidden rounded-2xl mb-2"
                style={{ height:cardSize, background:`linear-gradient(155deg,${f.g[0]},${f.g[1]})`,
                  boxShadow:'0 8px 24px rgba(0,0,0,.45)', border:'1px solid rgba(255,255,255,.06)' }}>
                <div className="absolute inset-0 flex items-center justify-center">
                  <f.Icon size={isMobile?30:44} style={{ color:'rgba(255,255,255,0.85)' }}/>
                </div>
                {/* Hover play overlay */}
                <motion.div className="absolute inset-0 flex items-center justify-center opacity-0"
                  style={{ background:'rgba(0,0,0,.45)' }}
                  whileHover={{ opacity:1 }}>
                  <div className="grid h-12 w-12 place-items-center rounded-full"
                    style={{ background:'rgba(255,255,255,.2)', backdropFilter:'blur(8px)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                  </div>
                </motion.div>
                {/* Gradient bottom */}
                <div className="absolute bottom-0 left-0 right-0 h-16"
                  style={{ background:'linear-gradient(transparent,rgba(0,0,0,.65))' }}/>
              </div>
              <p className="text-[11px] font-bold line-clamp-1" style={{ color:'var(--t1)' }}>{f.title}</p>
              <p className="text-[10px] mt-0.5 truncate" style={{ color:'var(--t3)' }}>{f.sub}</p>
            </motion.div>
            );
          })}
        </div>
      </motion.section>

      {/* ── RECENT TRACKS ────────────────────────────────────── */}
      {recentTracks.length > 0 && (
        <motion.section {...fu(3)} className="mt-5">
          <div className={`flex items-center justify-between mb-2.5 ${isMobile ? 'px-3' : 'px-4'}`}>
            <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color:'var(--t3)' }}>Недавнее</p>
            <button type="button" onClick={() => onNav('music')}
              className="text-[11px] font-bold" style={{ color:'var(--accent)', background:'none', border:'none', cursor:'pointer' }}>
              Все →
            </button>
          </div>
          <div className={`flex overflow-x-auto pb-1 ${isMobile ? 'gap-2 px-3' : 'gap-2.5 px-4'}`} style={{ scrollbarWidth:'none' }}>
            {recentTracks.map((track: any, i: number) => {
              const hue = ((track.id?.charCodeAt?.(0) ?? 200) * 47) % 360;
              const c1 = `hsl(${hue},55%,28%)`, c2 = `hsl(${(hue+50)%360},45%,18%)`;
              const size = isMobile ? 76 : 100;
              return (
                <motion.div key={track.id}
                  whileHover={{ y:-3 }} whileTap={{ scale:.95 }}
                  onClick={() => onNav('music')}
                  className="shrink-0 cursor-pointer" style={{ width:size }}>
                  <div className="relative overflow-hidden rounded-xl mb-1.5"
                    style={{ height:size, background:track.coverUrl?undefined:`linear-gradient(135deg,${c1},${c2})`,
                      boxShadow:'0 4px 16px rgba(0,0,0,.35)', border:'1px solid rgba(255,255,255,.05)' }}>
                    {track.coverUrl
                      ? <img src={track.coverUrl} alt="" className="w-full h-full object-cover"/>
                      : <div className="w-full h-full grid place-items-center"><Music2 size={isMobile?22:30} style={{ color:'var(--t3)' }}/></div>}
                  </div>
                  <p className="text-[10.5px] font-bold truncate" style={{ color:'var(--t1)' }}>{track.title}</p>
                  <p className="text-[9.5px] truncate mt-0.5" style={{ color:'var(--t3)' }}>{track.artist}</p>
                </motion.div>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* ── ACTIVITY ─────────────────────────────────────────── */}
      <motion.section {...fu(4)} className="px-4 mt-6 mb-8">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] mb-3" style={{ color:'var(--t3)' }}>Активность</p>
        <div className="rounded-2xl p-4" style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {[
              { label:'Сегодня',    val:fmtMin(listenMin), color:'#6366f1' },
              { label:'За неделю', val:fmtMin(listenMin*5), color:'#22d3ee' },
            ].map(({ label, val, color }) => (
              <div key={label} className="rounded-xl px-3 py-3"
                style={{ background:'var(--bg-l3)', border:'1px solid var(--border)' }}>
                <p className="text-[10px] mb-1" style={{ color:'var(--t3)' }}>{label}</p>
                <p className="text-lg font-black" style={{ color }}>{val}</p>
              </div>
            ))}
          </div>
          {([
            { label:'Музыка',   pct:58, color:'#6366f1' },
            { label:'Видео',    pct:24, color:'#f43f5e' },
            { label:'Подкасты', pct:18, color:'#10b981' },
          ] as const).map(({ label, pct, color }, i) => (
            <div key={label} className={i>0?'mt-2.5':''}>
              <div className="flex justify-between mb-1">
                <span className="text-[11px] font-semibold" style={{ color:'var(--t2)' }}>{label}</span>
                <span className="text-[11px]" style={{ color:'var(--t3)' }}>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background:'var(--bg-l3)' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.7, delay: 0.4 + i * 0.12, ease: [0.22,1,0.36,1] }}
                  style={{ height:'100%', background:color, borderRadius:3 }}/>
              </div>
            </div>
          ))}
        </div>
      </motion.section>

      </div>{/* /content */}
    </div>
  );
};


export const ExtrasModule = () => {
  const isMobile = useIsMobile();
  const { pendingExtrasTab, setPendingExtrasTab } = useModuleStore();
  const [tab, setTab] = useState<Tab>((pendingExtrasTab as Tab) || 'home');
  useEffect(() => { if (pendingExtrasTab) setPendingExtrasTab(null); }, []);
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a=>a.id===currentUserId);
  const isAdmin = me?.isAdmin ?? false;
  const { reports } = useMessengerStore();
  const pendingCount = reports.filter(r=>(r.status??'pending')==='pending').length;


  const visibleTabs = TABS.filter(t=>t.key!=='admin'||isAdmin);
  const handleNav = (t: string) => setTab(t as Tab);
  const tabsRef = useRef<HTMLDivElement>(null);

  const scrollTabs = (dir: 'left'|'right') => {
    if (!tabsRef.current) return;
    tabsRef.current.scrollBy({ left: dir==='left' ? -160 : 160, behavior: 'smooth' });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header: logo + tabs + arrows */}
      <div className="relative z-10 flex items-center gap-1.5 border-b px-2 shrink-0"
        style={{ borderColor:'var(--border)', background:'var(--bg)', paddingTop: 'calc(var(--safe-top) + 8px)', paddingBottom: 8 }}>

        {/* Logo */}
        <motion.div
          className="flex items-center gap-1.5 mr-0.5 shrink-0 cursor-pointer select-none"
          whileTap={{ scale: 0.92 }}
          onClick={() => setTab('home')}
          title="Главная">
          <SkyMediaLogo size={22} animated={tab==='home'} />
          <AnimatePresence mode="wait">
            {tab === 'home' && (
              <motion.span key="logo-label"
                initial={{ opacity:0, x:-4, width:0 }} animate={{ opacity:1, x:0, width:'auto' }}
                exit={{ opacity:0, x:-4, width:0 }}
                className="text-[12px] font-black tracking-tight whitespace-nowrap overflow-hidden"
                style={{ color:'var(--accent)' }}>
                Sky Media
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>

        <div className="w-px h-4 shrink-0" style={{ background:'var(--border)' }} />

        {/* Left arrow (desktop only — touch-scroll covers this on mobile) */}
        {!isMobile && (
        <button type="button" onClick={()=>scrollTabs('left')}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg transition-colors hover:bg-white/8"
          style={{ color:'var(--t3)', background:'transparent', border:'none', cursor:'pointer' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        )}

        {/* Tabs scrollable row */}
        <div ref={tabsRef} className="flex items-center gap-1 overflow-x-auto flex-1"
          style={{ scrollbarWidth:'none' }}>
          {visibleTabs.filter(t => t.key !== 'home').map(({key,label,icon:Icon})=>(
            <button key={key} type="button" onClick={()=>setTab(key as Tab)}
              className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all shrink-0"
              style={{
                background: tab===key ? 'var(--accent-bg)' : 'rgba(0,0,0,0)',
                color:      tab===key ? 'var(--accent)'    : 'var(--t3)',
                border:     tab===key ? '1px solid rgba(79,110,247,0.25)' : '1px solid transparent',
                cursor: 'pointer',
              }}>
              <Icon size={13}/>{label}
              {key==='admin'&&pendingCount>0&&(
                <span className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white"
                  style={{background:'#ef4444', boxShadow:'0 0 0 1.5px var(--bg-l1)'}}>{pendingCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Right arrow (desktop only) */}
        {!isMobile && (
        <button type="button" onClick={()=>scrollTabs('right')}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg transition-colors hover:bg-white/8"
          style={{ color:'var(--t3)', background:'transparent', border:'none', cursor:'pointer' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            className="h-full flex flex-col overflow-hidden"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
        <React.Suspense fallback={<TabFallback/>}>
        {tab==='home' && <MediaHomeTab onNav={handleNav}/>}
        {tab==='music'  && <SkyMusic/>}
        {tab==='soundcloud' && <SkySoundCloud/>}
        {tab==='movies' && <SkyFilm/>}
        {tab==='prime'  && <SkyPrime/>}
        {tab==='rooms'  && <RoomsTab/>}
        {tab==='market' && <SkyMarket/>}
        {tab==='pvz'    && <SkyPVZ/>}
        {tab==='nftgifts' && <SkyGiftsNFT/>}
        {tab==='work'     && <WorkModule/>}
        {tab==='family'   && <FamilyModule/>}
        {tab==='ads'    && <SkyAdsCabinet/>}
        {tab==='books'     && <SkyBooks/>}
        {tab==='tv'        && <SkyTV/>}
        {tab==='bots'       && <BotsBrowser onClose={()=>setTab('music')}/>}
        {tab==='mybots'     && <BotCreatorPanel/>}
        {tab==='podcasts'   && <SkyPodcasts/>}
        {tab==='tickets'    && <TicketsTab/>}
        {tab==='ai'         && <SkyAITab/>}
        {tab==='pulse'     && <PrimePulse/>}
        {tab==='musicians' && <MusicianHub/>}
        {tab==='more'         && <MoreTab/>}
        {tab==='admin'  && isAdmin && <AdminPanel/>}
        {tab==='garant'                && <SkyGarant/>}
        {tab==='admin'  && !isAdmin && (
          <div className="grid h-full place-items-center">
            <div className="text-center"><Shield size={40} style={{color:'var(--t3)',margin:'0 auto 12px'}}/><p className="text-sm" style={{color:'var(--t3)'}}>Нет доступа</p></div>
          </div>
        )}
        </React.Suspense>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
