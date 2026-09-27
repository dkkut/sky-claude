import { Home, BookOpen, Briefcase, Building2, Calendar, Check, ChevronLeft, Clock, Cloud, Crown, Film, Gem, Gift, Heart, MapPin, Megaphone, MessageCircle, MessageSquare, Mic2, MoreHorizontal, Music2, Pause, Play, Plus, QrCode, Send, Shield, ShoppingCart, Sparkles, Star, Ticket, Trash2, Tv2, Upload, Users, X, Zap, Bot, ChevronUp, ChevronDown } from 'lucide-react';
import { lazyChunk } from '@/app/lazyChunk';
import { BotsBrowser } from '@/bots/SkyBots';
import { BotCreatorPanel } from '@/bots/BotCreator';
import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlatformStore, type Track } from '@/platform/store';
import { useAuthStore } from '@/core/auth/store';
import { useMessengerStore } from '@/messenger/store';
import { useSkyVideoStore } from '@/video/serverStore';
import { useMusicStore } from '@/music/serverStore';
import { apiMediaActivity, type MediaActivity } from '@/extras/mediaActivityApi';
import { useModerationStore, type ModDomain, type WarningKind } from '@/shared/moderationStore';
import { BlockedChannelBadge } from '@/shared/ContentWarningGate';
import { useModuleStore } from '@/data/state/modules';
import { useIsMobile } from '@/interface/mobile/useIsMobile';

/** Заглушка на время подгрузки чанка вкладки. */
const TabFallback = () => (
  <div className="grid h-full place-items-center">
    <div className="h-8 w-8 rounded-full border-2 animate-spin"
      style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }}/>
  </div>
);

/* Экраны хаба «Медиа» — отдельными чанками: открытая вкладка тянет только себя. */
const WorkModule = lazyChunk(() => import('@/work/WorkModule').then(m => ({ default: m.WorkModule })));
const FamilyModule = lazyChunk(() => import('@/family/FamilyModule').then(m => ({ default: m.FamilyModule })));
const SkyMusic = lazyChunk(() => import('./SkyMusic').then(m => ({ default: m.SkyMusic })));
const SkySoundCloud = lazyChunk(() => import('./SkySoundCloud').then(m => ({ default: m.SkySoundCloud })));
const SkyFilm = lazyChunk(() => import('./SkyFilm').then(m => ({ default: m.SkyFilm })));
const SkyPrime = lazyChunk(() => import('./SkyPrime').then(m => ({ default: m.SkyPrime })));
const TogetherTab = lazyChunk(() => import('@/together/TogetherTab').then(m => ({ default: m.TogetherTab })));
const SkyMarket = lazyChunk(() => import('@/marketplace/SkyMarket').then(m => ({ default: m.SkyMarket })));
const SkyAdsCabinet = lazyChunk(() => import('@/ads/SkyAds').then(m => ({ default: m.SkyAdsCabinet })));
const SkyBooks = lazyChunk(() => import('@/books/SkyBooks').then(m => ({ default: m.SkyBooks })));
const SkyTV = lazyChunk(() => import('./SkyTV').then(m => ({ default: m.SkyTV })));
const SkyPodcasts = lazyChunk(() => import('@/podcasts/SkyPodcasts').then(m => ({ default: m.SkyPodcasts })));
const SkyTickets = lazyChunk(() => import('@/tickets/SkyTickets').then(m => ({ default: m.SkyTickets })));
const SkyAITab = lazyChunk(() => import('@/ai/SkyAI').then(m => ({ default: m.SkyAITab })));
const PrimePulse = lazyChunk(() => import('@/prime/PrimePulse').then(m => ({ default: m.PrimePulse })));
const Campaigns = lazyChunk(() => import('@/campaigns/Campaigns').then(m => ({ default: m.Campaigns })));
const MusicianHub = lazyChunk(() => import('@/music/MusicianHub').then(m => ({ default: m.MusicianHub })));
const SkyGarant = lazyChunk(() => import('@/garant/SkyGarant').then(m => ({ default: m.SkyGarant })));
const SkyPVZ = lazyChunk(() => import('@/pvz/SkyPVZ').then(m => ({ default: m.SkyPVZ })));
const SkyGiftsNFT = lazyChunk(() => import('@/gifts/SkyGiftsNFT').then(m => ({ default: m.SkyGiftsNFT })));
import { AdminMusicPanel } from '@/music/ArtistSubmit';
import { apiModerationQueue } from '@/music/musicApi';
import { PodcastModeration } from '@/podcasts/PodcastsAdmin';
import { BookModeration } from '@/books/BooksAdmin';
import { TicketsModeration } from '@/tickets/TicketsAdmin';
import { useTicketPendingCount } from '@/tickets/useTicketPending';
import { usePodcastPendingCount } from '@/podcasts/usePodcastPending';
import { useBookPendingCount } from '@/books/useBookPending';
import { BotModeration } from '@/bots/BotsAdmin';
import { useBotPendingCount } from '@/bots/useBotPending';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl } from '@/film/filmApi';
import { qrDataUri } from '@/shared/qr';
/* Реальная панель прав: роли, подтверждение личности, второй ключ
   владельца, второй фактор, журнал. Названа с приставкой Rbac здесь,
   чтобы не столкнуться с локальным именем AdminPanel ниже — тем самым,
   которое эта панель и заменяет. */
import { AdminPanel as RbacAdminPanel } from '@/admin/AdminPanel';
import { apiSupportStatus } from '@/moderation/supportApi';


/* --- «Вместе» -----------------------------------------------------------
   Экран переехал в src/together. Здесь его больше нет по двум причинам.

   Первая: прежняя вкладка жила целиком в браузере. «Синхронизация» шла
   через BroadcastChannel — канал между вкладками ОДНОГО браузера, — и
   два человека не видели друг друга никогда. Воспроизведение было
   таймером, прибавлявшим секунду к числу; ни кино, ни музыка при этом
   не играли.

   Вторая: сессия теперь живёт на сервере, и вместе с ней туда уехали
   права. Держать такой экран в общем файле дополнений неудобно —
   у него свой стор, свой обмен по сокету и своя связь с плеерами.

   Оформление и порядок экранов сохранены: список карточками, кнопка
   создания, внутри плеер и колонка участников.                     */

type Tab = 'garant'|'home'|'music'|'soundcloud'|'movies'|'prime'|'rooms'|'market'|'pvz'|'nftgifts'|'admin'|'ads'|'books'|'pulse'|'campaigns'|'musicians'|'tv'|'podcasts'|'tickets'|'ai'|'bots'|'mybots'|'work'|'family'|'more';

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
  // Кино и Sky Video берём из общего каталога на сервере: модерировать
  // можно то, что выложено на всех. Личные коллекции и черновики сюда
  // не попадают — сервер их не отдаёт никому, включая администратора.
  const movies = useFilmStore(s => s.catalog);
  const loadFilm = useFilmStore(s => s.load);
  const skyVideos = useSkyVideoStore(s => s.feed);
  const loadSkyVideo = useSkyVideoStore(s => s.load);
  const [sub, setSub] = useState<'messenger'|'video'|'movies'>('messenger');
  useEffect(() => { void loadFilm(); void loadSkyVideo(); }, [loadFilm, loadSkyVideo]);

  const channels = chats.filter(c => c.type === 'channel');
  const videoChannels = [...new Map(
    skyVideos.filter(v => v.authorId).map(v => [v.authorId as string, v.authorName ?? v.authorId as string]),
  ).entries()];

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
  const bookPending    = useBookPendingCount();
  const ticketPending  = useTicketPendingCount();
  const botPending     = useBotPendingCount();
  const [adminTab, setAdminTab] = useState<'core'|'moderation'|'podcasts_mod'|'books_mod'|'bots_mod'|'tickets_mod'|'content'|'channels'|'support'>('core');

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sub-tabs */}
      <div className="flex gap-0.5 border-b px-4 pt-2 shrink-0 overflow-x-auto" style={{borderColor:'var(--border)',scrollbarWidth:'none'}}>
        {([
          ['core',       'Права и запреты', Shield],
          ['moderation', `Музыка${musicPending > 0 ? ` (${musicPending})` : ''}`, Music2],
          ['podcasts_mod', `Подкасты${podcastPending > 0 ? ` (${podcastPending})` : ''}`, Mic2],
          ['books_mod', `Книги${bookPending > 0 ? ` (${bookPending})` : ''}`, BookOpen],
          ['bots_mod',     `Боты${botPending > 0 ? ` (${botPending})` : ''}`,         Bot],
          ['tickets_mod',  `Билеты${ticketPending > 0 ? ` (${ticketPending})` : ''}`,   Ticket],
          ['content',    'Контент',                                                   Upload],
          ['channels',   'Каналы',                                                   Shield],
          ['support',    'Поддержка',  MessageSquare],
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

        {/* ==== ПРАВА И ЗАПРЕТЫ ====
             Единый вход в реальную панель администратора: роли,
             подтверждение личности, второй ключ владельца, второй
             фактор, журнал. Раньше здесь были два экрана — «Жалобы» и
             «Пользователи», — которые не были ничем: бан, мут, выдача
             Prime и права администратора менялись только в localStorage
             этого браузера и не доходили до сервера ни в каком виде.
             Администратор видел у себя «забанен», а по факту никто
             нигде забанен не был. */}
        {adminTab==='core' && <RbacAdminPanel/>}

        {/* ==== MUSIC MODERATION ==== */}
        {adminTab==='moderation' && <AdminMusicPanel/>}

        {/* ==== PODCASTS MODERATION ==== */}
        {adminTab==='podcasts_mod' && <div className="p-4"><PodcastModeration/></div>}

        {/* ==== BOOKS MODERATION ==== */}
        {adminTab==='books_mod' && <div className="p-4"><BookModeration/></div>}

        {/* ==== БОТЫ ==== */}
        {adminTab==='bots_mod'     && <div className="p-4"><BotModeration/></div>}

        {/* ==== БИЛЕТЫ ==== */}
        {adminTab==='tickets_mod'  && <div className="p-4 overflow-y-auto"><TicketsModeration/></div>}

        {adminTab==='support'    && <AdminSupportTab/>}

        {/* Модерация рекламы переехала в общую RBAC-панель (src/admin/AdminPanel.tsx,
            раздел «Реклама»): там видно все кампании, а не только свои, и право
            проверяет сервер, а не локальный флаг isAdmin этого экрана. */}

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
  {key:'campaigns',label:'Мероприятия', icon:Gift},
  {key:'musicians',label:'Артисты',  icon:Mic2},
  {key:'ads',      label:'Реклама',  icon:Megaphone},
  {key:'more',   label:'Прочее', icon:MoreHorizontal},
  {key:'admin',  label:'Admin',  icon:Shield},
  {key:'garant', label:'Гарант', icon:Shield},
] as const;

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
  // Реальный, серверный каталог Sky Music (src/music/serverStore.ts) —
  // не локальный usePlatformStore, который остаётся сидом на случай,
  // если сервер недоступен. history приходит уже отсортированной
  // сервером по последнему прослушиванию (server/music.mjs::listHistory).
  const { tracks, history, load: loadMusic } = useMusicStore();
  useEffect(() => { void loadMusic(); }, [loadMusic]);
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const isPrime = me?.isPrime ?? false;
  const isMobile = useIsMobile();
  const hr = new Date().getHours();
  const greeting = hr < 6 ? 'Доброй ночи' : hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер';
  const recentTracks = history.slice(0, 8);

  const [activity, setActivity] = React.useState<MediaActivity | null>(null);
  useEffect(() => { void apiMediaActivity().then(setActivity); }, []);

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

  /* Раньше здесь были 5 выдуманных подборок с придуманными названиями и
     цифрами ("Lo-Fi Chill 2026 · 38 треков" и т.п.) — витрины
     реальных подборок в проекте нет, поэтому вместо неё показываем
     настоящий топ по реальному счётчику прослушиваний трека (то же
     поле `plays`, что и в профиле артиста). Если ни у одного трека
     ещё нет прослушиваний, секция скрывается — это честное «данных
     пока нет», а не подставная цифра. */
  const topTracks = tracks.filter(t => t.plays > 0).sort((a,b) => b.plays - a.plays).slice(0, 8);

  const trackWord = (n: number) => {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'трек';
    if ([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return 'трека';
    return 'треков';
  };
  const fmtPlays = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}М`
    : n >= 1_000 ? `${(n / 1_000).toFixed(1)}К` : String(n));
  /* Секунды с сервера (server/mediaActivity.mjs) → «Хч Yм» / «Yм». */
  const fmtMin = (totalSec: number) => {
    const m = Math.round(totalSec / 60);
    return m >= 60 ? `${Math.floor(m/60)}ч ${m%60}м` : `${m}м`;
  };

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
              {tracks.length > 0 && (
                <p className="text-[11px] mt-1.5" style={{ color:'rgba(255,255,255,.4)' }}>
                  {tracks.length} {trackWord(tracks.length)} в библиотеке
                </p>
              )}
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

      {/* ── ПОПУЛЯРНОЕ (реальный топ по прослушиваниям) ─────────── */}
      {topTracks.length > 0 && (
      <motion.section {...fu(2)} className="mt-5">
        <div className={`flex items-center justify-between mb-2.5 ${isMobile ? 'px-3' : 'px-4'}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.16em]"
            style={{ color:'var(--t3)' }}>Популярное</p>
          <button type="button" onClick={() => onNav('music')}
            className="text-[11px] font-bold" style={{ color:'var(--accent)', background:'none', border:'none', cursor:'pointer' }}>
            Все →
          </button>
        </div>
        <div className={`flex overflow-x-auto pb-1 ${isMobile ? 'gap-2 px-3' : 'gap-3 px-4'}`} style={{ scrollbarWidth:'none' }}>
          {topTracks.map((f, i) => {
            const cardSize = isMobile ? 108 : 148;
            const hue = ((f.id?.charCodeAt?.(0) ?? 200) * 47) % 360;
            const g: [string,string] = [`hsl(${hue},45%,16%)`, `hsl(${(hue+40)%360},40%,24%)`];
            return (
            <motion.div key={f.id}
              initial={{ opacity:0, x:16 }} animate={{ opacity:1, x:0 }}
              transition={{ delay:.15+i*.07, duration:.35, ease:[.22,1,.36,1] }}
              whileHover={{ y:-4 }} whileTap={{ scale:.96 }}
              className="shrink-0 cursor-pointer" style={{ width:cardSize }}
              onClick={() => onNav('music')}>
              {/* Cover */}
              <div className="relative overflow-hidden rounded-2xl mb-2"
                style={{ height:cardSize, background:f.coverUrl?undefined:`linear-gradient(155deg,${g[0]},${g[1]})`,
                  boxShadow:'0 8px 24px rgba(0,0,0,.45)', border:'1px solid rgba(255,255,255,.06)' }}>
                {f.coverUrl
                  ? <img src={f.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover"/>
                  : <div className="absolute inset-0 flex items-center justify-center">
                      <Music2 size={isMobile?30:44} style={{ color:'rgba(255,255,255,0.85)' }}/>
                    </div>}
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
              <p className="text-[10px] mt-0.5 truncate" style={{ color:'var(--t3)' }}>{f.artist} · {fmtPlays(f.plays)} прослушиваний</p>
            </motion.div>
            );
          })}
        </div>
      </motion.section>
      )}

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
            {recentTracks.map((track) => {
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

      {/* ── АКТИВНОСТЬ (реальные секунды из server/mediaActivity.mjs) ── */}
      {activity && (activity.today.music + activity.today.video + activity.today.podcasts
                   + activity.week.music + activity.week.video + activity.week.podcasts) > 0 && (
        <motion.section {...fu(4)} className="px-4 mt-6 mb-8">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] mb-3" style={{ color:'var(--t3)' }}>Активность</p>
          <div className="rounded-2xl p-4" style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { label:'Сегодня',   val:fmtMin(activity.today.music + activity.today.video + activity.today.podcasts), color:'#6366f1' },
                { label:'За неделю', val:fmtMin(activity.week.music + activity.week.video + activity.week.podcasts), color:'#22d3ee' },
              ].map(({ label, val, color }) => (
                <div key={label} className="rounded-xl px-3 py-3"
                  style={{ background:'var(--bg-l3)', border:'1px solid var(--border)' }}>
                  <p className="text-[10px] mb-1" style={{ color:'var(--t3)' }}>{label}</p>
                  <p className="text-lg font-black" style={{ color }}>{val}</p>
                </div>
              ))}
            </div>
            {(() => {
              const w = activity.week;
              const total = w.music + w.video + w.podcasts;
              if (total === 0) return null;
              const rows = [
                { label:'Музыка',   sec:w.music,    color:'#6366f1' },
                { label:'Видео',    sec:w.video,    color:'#f43f5e' },
                { label:'Подкасты', sec:w.podcasts, color:'#10b981' },
              ].filter(r => r.sec > 0);
              return rows.map(({ label, sec: s, color }, i) => (
                <div key={label} className={i>0?'mt-2.5':''}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[11px] font-semibold" style={{ color:'var(--t2)' }}>{label}</span>
                    <span className="text-[11px]" style={{ color:'var(--t3)' }}>{Math.round(s/total*100)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background:'var(--bg-l3)' }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.round(s/total*100)}%` }}
                      transition={{ duration: 0.7, delay: 0.4 + i * 0.12, ease: [0.22,1,0.36,1] }}
                      style={{ height:'100%', background:color, borderRadius:3 }}/>
                  </div>
                </div>
              ));
            })()}
          </div>
        </motion.section>
      )}

      </div>{/* /content */}
    </div>
  );
};


export const ExtrasModule = () => {
  const isMobile = useIsMobile();
  const { pendingExtrasTab, setPendingExtrasTab } = useModuleStore();
  const [tab, setTab] = useState<Tab>((pendingExtrasTab as Tab) || 'home');
  useEffect(() => { if (pendingExtrasTab) setPendingExtrasTab(null); }, []);
  const { reports } = useMessengerStore();
  const pendingCount = reports.filter(r=>(r.status??'pending')==='pending').length;

  // Плитка «Admin» — тот же признак, что и одноимённый пункт в
  // «Профиле»: спрашивается у сервера, а не берётся из локального
  // профиля в сторе. Владелец администратор по нику, а не по полю в
  // базе, и права меняются на сервере — сохранённая у клиента копия
  // рано или поздно разойдётся с тем, что на самом деле разрешено.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    void apiSupportStatus().then(r => { if (alive) setIsAdmin(r.isAdmin); });
    return () => { alive = false; };
  }, []);

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
        {tab==='rooms'  && <TogetherTab/>}
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
        {tab==='tickets'    && <SkyTickets/>}
        {tab==='ai'         && <SkyAITab/>}
        {tab==='pulse'     && <PrimePulse/>}
        {tab==='campaigns' && <Campaigns/>}
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
