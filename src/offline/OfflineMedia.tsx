import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music, Film, ShoppingBag, Download, Trash2, Play, Pause,
  Package, Truck, CheckCircle, Clock, MoreVertical, Volume2,
  ChevronRight
} from 'lucide-react';
import { listDownloads, getDownloadUrl, deleteDownload, type DownloadedItem } from './offlineDB';
import { useMarketStore } from '@/marketplace/store';
import { useAuthStore } from '@/core/auth/store';

/* -- цвета ------------------------------------------------------- */
const C = {
  bg:     'var(--bg)',
  l1:     'var(--bg-l1)',
  l2:     'var(--bg-l2)',
  border: 'var(--border)',
  t1:     'var(--t1)',
  t2:     'var(--t2)',
  t3:     'var(--t3)',
  accent: 'var(--accent)',
  green:  'var(--green)',
  amber:  'var(--amber)',
};

const YM_accent = '#a855f7';

/* -- градиент обложки из ID --------------------------------------- */
const PALETTE: [string,string][] = [
  ['#1a0533','#2d1b69'],['#0f2027','#2c5364'],['#0d1b2a','#1b4332'],
  ['#0f0c29','#302b63'],['#1a1a2e','#16213e'],['#200122','#6f0000'],
];
const getGrad = (id: string): [string,string] => {
  const h = id.split('').reduce((a,c) => a + c.charCodeAt(0), 0);
  return PALETTE[h % PALETTE.length];
};

/* -- Форматирование размера --------------------------------------- */
const fmtBytes = (b: number) =>
  b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} МБ`
  : b > 1000    ? `${(b / 1000).toFixed(0)} КБ`
  : `${b} Б`;

/* ===================================================================
   OFFLINE MUSIC
=================================================================== */
const OfflineMusic = () => {
  const [tracks, setTracks]     = useState<DownloadedItem[]>([]);
  const [queueIdx, setQueueIdx] = useState(0);
  const [playing, setPlaying]   = useState(false);
  const [curTime, setCurTime]   = useState(0);
  const [durTime, setDurTime]   = useState(0);
  const [volume, setVolume]     = useState(0.85);
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    listDownloads('track').then(setTracks).catch(() => {});
    return () => { audioRef.current?.pause(); };
  }, []);

  const cur = tracks[queueIdx] ?? null;

  const loadAndPlay = async (idx: number, autoplay = true) => {
    const item = tracks[idx];
    if (!item) return;
    let url = blobUrls[item.id];
    if (!url) {
      url = (await getDownloadUrl(item.id)) ?? '';
      if (url) setBlobUrls(prev => ({ ...prev, [item.id]: url }));
    }
    if (!url) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    const a = new Audio(url);
    a.volume = volume;
    a.ontimeupdate = () => { setCurTime(a.currentTime); };
    a.onloadedmetadata = () => { setDurTime(a.duration); };
    a.onended = () => {
      if (idx < tracks.length - 1) { setQueueIdx(idx + 1); loadAndPlay(idx + 1, true); }
      else setPlaying(false);
    };
    audioRef.current = a;
    if (autoplay) { a.play().catch(() => {}); setPlaying(true); }
    else setPlaying(false);
  };

  const togglePlay = () => {
    if (!cur) return;
    if (!audioRef.current) { loadAndPlay(queueIdx); return; }
    if (audioRef.current.paused) { audioRef.current.play().catch(() => {}); setPlaying(true); }
    else { audioRef.current.pause(); setPlaying(false); }
  };

  const skipPrev = () => {
    if (queueIdx > 0) { const i = queueIdx - 1; setQueueIdx(i); loadAndPlay(i); }
  };
  const skipNext = () => {
    if (queueIdx < tracks.length - 1) { const i = queueIdx + 1; setQueueIdx(i); loadAndPlay(i); }
  };

  const seek = (pct: number) => {
    if (audioRef.current && durTime) audioRef.current.currentTime = pct * durTime;
  };

  const del = async (id: string) => {
    await deleteDownload(id).catch(() => {});
    setTracks(prev => prev.filter(t => t.id !== id));
  };

  const fmtS = (s: number) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const pct = durTime > 0 ? curTime / durTime : 0;

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-50">
        <Download size={40} style={{ color: C.t2 }} />
        <p className="text-sm font-semibold" style={{ color: C.t2 }}>Нет скачанных треков</p>
        <p className="text-xs text-center leading-relaxed px-6" style={{ color: C.t3 }}>
          В онлайн-режиме нажмите «Скачать» рядом с треком, чтобы слушать его без сети
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* -- Full Player -- */}
      {cur && (
        <div className="shrink-0 mx-3 mt-3 rounded-3xl overflow-hidden"
          style={{ background: `linear-gradient(155deg,${(cur.coverGrad??getGrad(cur.id))[0]},${(cur.coverGrad??getGrad(cur.id))[1]})`,
            boxShadow: `0 8px 32px rgba(0,0,0,0.5)` }}>
          <div className="p-4" style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)' }}>
            {/* Cover + info */}
            <div className="flex items-center gap-3 mb-4">
              <div className="h-16 w-16 shrink-0 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.1)' }}>
                <Music size={28} style={{ color: 'rgba(255,255,255,0.7)' }}/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-white truncate">{cur.title}</p>
                <p className="text-sm truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {cur.artist ?? 'Неизвестный исполнитель'}
                </p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 w-full rounded-full mb-2 cursor-pointer"
              style={{ background: 'rgba(255,255,255,0.2)' }}
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect();
                seek((e.clientX - r.left) / r.width);
              }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct*100}%`, background: '#fff' }}/>
            </div>
            <div className="flex justify-between text-[11px] mb-3" style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace' }}>
              <span>{fmtS(curTime)}</span><span>{fmtS(durTime)}</span>
            </div>
            {/* Controls */}
            <div className="flex items-center justify-center gap-4">
              <button type="button" onClick={skipPrev}
                disabled={queueIdx === 0}
                className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.1)' }}>
                <ChevronRight size={18} className="text-white rotate-180"/>
              </button>
              <motion.button whileTap={{ scale: 0.92 }} type="button" onClick={togglePlay}
                className="grid h-14 w-14 place-items-center rounded-full"
                style={{ background: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
                {playing
                  ? <Pause size={24} style={{ color: '#111' }}/>
                  : <Play size={24} style={{ color: '#111', marginLeft: 2 }}/>}
              </motion.button>
              <button type="button" onClick={skipNext}
                disabled={queueIdx === tracks.length - 1}
                className="grid h-10 w-10 place-items-center rounded-full disabled:opacity-30"
                style={{ background: 'rgba(255,255,255,0.1)' }}>
                <ChevronRight size={18} className="text-white"/>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* -- Track list -- */}
      <div className="flex-1 overflow-y-auto mt-3" style={{ scrollbarWidth: 'none' }}>
        <p className="px-4 pb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: C.t3 }}>
          Очередь · {tracks.length}
        </p>
        {tracks.map((item, idx) => {
          const [g1, g2] = item.coverGrad ?? getGrad(item.id);
          const isActive = idx === queueIdx;
          return (
            <motion.div key={item.id} whileTap={{ scale: 0.98 }}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-white/5"
              style={{ background: isActive ? 'rgba(168,85,247,0.08)' : 'transparent' }}
              onClick={() => { setQueueIdx(idx); loadAndPlay(idx); }}>
              <div className="relative h-11 w-11 shrink-0 rounded-xl overflow-hidden"
                style={{ background: `linear-gradient(135deg,${g1},${g2})` }}>
                {isActive && playing && (
                  <div className="absolute inset-0 flex items-end justify-center pb-1 gap-[2px]"
                    style={{ background: 'rgba(0,0,0,0.4)' }}>
                    {[0,1,2].map(i => (
                      <motion.div key={i} className="w-[3px] rounded-full"
                        style={{ background: YM_accent }}
                        animate={{ height: ['4px','12px','5px','9px','4px'] }}
                        transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}/>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate"
                  style={{ color: isActive ? YM_accent : C.t1 }}>{item.title}</p>
                <p className="text-xs mt-0.5" style={{ color: C.t3 }}>
                  {item.artist ?? ' - '} · {item.duration}
                </p>
              </div>
              <button type="button" onClick={e => { e.stopPropagation(); del(item.id); }}
                className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-red-500/10">
                <Trash2 size={14} style={{ color: 'var(--red)' }}/>
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

/* ===================================================================
   OFFLINE FILMS
=================================================================== */
const OfflineFilms = () => {
  const [films, setFilms]     = useState<DownloadedItem[]>([]);
  const [playId, setPlayId]   = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);

  useEffect(() => {
    listDownloads('movie').then(setFilms).catch(() => {});
  }, []);

  const openFilm = async (item: DownloadedItem) => {
    const url = await getDownloadUrl(item.id).catch(() => null);
    if (!url) return;
    setPlayUrl(url);
    setPlayId(item.id);
  };

  const del = async (id: string) => {
    await deleteDownload(id).catch(() => {});
    setFilms(prev => prev.filter(f => f.id !== id));
    if (playId === id) { setPlayId(null); setPlayUrl(null); }
  };

  if (playId && playUrl) {
    const film = films.find(f => f.id === playId);
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-3 py-3 shrink-0"
          style={{ borderBottom: `1px solid ${C.border}` }}>
          <button type="button" onClick={() => { setPlayId(null); setPlayUrl(null); }}
            className="text-xs font-medium flex items-center gap-1" style={{ color: C.t2 }}>
            ← Назад
          </button>
          <p className="text-sm font-semibold text-white truncate">{film?.title}</p>
        </div>
        <div className="flex-1 bg-black flex items-center justify-center">
          <video src={playUrl} controls autoPlay
            className="max-h-full max-w-full"
            style={{ background: '#000' }} />
        </div>
      </div>
    );
  }

  if (films.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-50">
        <Download size={40} style={{ color: C.t2 }} />
        <p className="text-sm font-semibold" style={{ color: C.t2 }}>Нет скачанных фильмов</p>
        <p className="text-xs text-center leading-relaxed" style={{ color: C.t3 }}>
          В онлайн-режиме нажмите «Скачать» рядом с фильмом
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-3 px-3">
      <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: C.t3 }}>
        Скачано · {films.length} {films.length === 1 ? 'фильм' : 'фильмов'}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {films.map(item => {
          const [g1, g2] = item.coverGrad ?? getGrad(item.id);
          return (
            <motion.div key={item.id} whileTap={{ scale: 0.96 }}
              className="rounded-2xl overflow-hidden cursor-pointer relative"
              style={{ background: `linear-gradient(155deg,${g1},${g2})`, minHeight: 160 }}
              onClick={() => openFilm(item)}>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="grid h-12 w-12 place-items-center rounded-full"
                  style={{ background: 'rgba(0,0,0,0.45)' }}>
                  <Play size={22} className="text-white ml-0.5" />
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-2.5"
                style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }}>
                <p className="text-xs font-bold text-white leading-tight truncate">{item.title}</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {item.duration} · {fmtBytes(item.bytes)}
                </p>
              </div>
              <button type="button"
                onClick={e => { e.stopPropagation(); del(item.id); }}
                className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full"
                style={{ background: 'rgba(0,0,0,0.5)' }}>
                <Trash2 size={12} style={{ color: 'var(--red)' }} />
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

/* ===================================================================
   OFFLINE MARKET (Orders)
=================================================================== */
const STATUS_LABELS: Record<string, string> = {
  pending:   'Ожидание',
  confirmed: 'Подтверждён',
  shipped:   'Отправлен',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};
const STATUS_COLOR: Record<string, string> = {
  pending:   'var(--amber)',
  confirmed: 'var(--accent)',
  shipped:   '#a855f7',
  delivered: 'var(--green)',
  cancelled: 'var(--red)',
};
const STATUS_ICON: Record<string, typeof Package> = {
  pending:   Clock,
  confirmed: Package,
  shipped:   Truck,
  delivered: CheckCircle,
};

const OfflineMarket = () => {
  const { orders }   = useMarketStore();
  const { currentUserId } = useAuthStore();
  const myOrders = orders.filter(o => o.buyerId === currentUserId);

  const fmt = (n: number) =>
    n.toLocaleString('ru', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0 });

  if (myOrders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-50">
        <ShoppingBag size={40} style={{ color: C.t2 }} />
        <p className="text-sm font-semibold" style={{ color: C.t2 }}>Нет заказов</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <p className="text-xs font-semibold uppercase tracking-wider px-1" style={{ color: C.t3 }}>
        Мои заказы · {myOrders.length}
      </p>
      {myOrders.map(o => {
        const color = STATUS_COLOR[o.status] ?? C.t2;
        const Icon  = STATUS_ICON[o.status] ?? Package;
        const sellerPhone = '+79000000000'; // В реальной версии берётся из profila
        return (
          <div key={o.id} className="rounded-2xl overflow-hidden"
            style={{ background: C.l2, border: `1px solid ${C.border}` }}>
            {/* Шапка заказа */}
            <div className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: `1px solid ${C.border}` }}>
              <div>
                <p className="text-xs font-bold text-white">{o.productTitle}</p>
                <p className="text-[11px] mt-0.5 font-mono" style={{ color: C.accent }}>
                  {o.trackNumber}
                </p>
              </div>
              <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
                style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
                <Icon size={11} style={{ color }} />
                <span className="text-[10px] font-semibold" style={{ color }}>
                  {STATUS_LABELS[o.status]}
                </span>
              </div>
            </div>
            {/* Детали */}
            <div className="px-4 py-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-xs" style={{ color: C.t2 }}>Кол-во</span>
                <span className="text-xs font-semibold text-white">{o.quantity} шт</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs" style={{ color: C.t2 }}>Сумма</span>
                <span className="text-xs font-semibold" style={{ color: C.green }}>{fmt(o.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs" style={{ color: C.t2 }}>Адрес</span>
                <span className="text-xs font-semibold text-white text-right max-w-[55%]">{o.address}</span>
              </div>
              {o.shippedAt && (
                <div className="flex justify-between">
                  <span className="text-xs" style={{ color: C.t2 }}>Отправлен</span>
                  <span className="text-xs font-semibold text-white">
                    {new Date(o.shippedAt).toLocaleDateString('ru')}
                  </span>
                </div>
              )}
            </div>
            {/* Offline связь с маркетом */}
            <div className="px-4 pb-3">
              <a href={`sms:${sellerPhone}?body=${encodeURIComponent(`[SKY Market] Заказ ${o.trackNumber}: `)}`}
                className="flex items-center justify-between w-full rounded-xl px-3 py-2.5 transition-colors"
                style={{ background: `${C.accent}12`, border: `1px solid ${C.accent}25` }}>
                <div className="flex items-center gap-2">
                  <div className="grid h-7 w-7 place-items-center rounded-full"
                    style={{ background: `${C.accent}20` }}>
                    <ShoppingBag size={12} style={{ color: C.accent }} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: C.t1 }}>Написать продавцу</p>
                    <p className="text-[10px]" style={{ color: C.t2 }}>Через SMS · {sellerPhone}</p>
                  </div>
                </div>
                <ChevronRight size={14} style={{ color: C.t3 }} />
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ===================================================================
   OFFLINE MEDIA SHELL
=================================================================== */
type MediaTab = 'music' | 'films' | 'market';

const MEDIA_TABS: { key: MediaTab; label: string; Icon: typeof Music }[] = [
  { key: 'music',  label: 'Музыка',   Icon: Music },
  { key: 'films',  label: 'Кино',     Icon: Film },
  { key: 'market', label: 'Маркет',   Icon: ShoppingBag },
];

export const OfflineMedia = () => {
  const [tab, setTab] = useState<MediaTab>('music');

  return (
    <div className="flex flex-col h-full" style={{ background: C.bg }}>
      {/* Вкладки */}
      <div className="flex px-3 pt-3 pb-0 gap-1 shrink-0">
        {MEDIA_TABS.map(({ key, label, Icon }) => {
          const active = tab === key;
          return (
            <button key={key} type="button" onClick={() => setTab(key)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all"
              style={{
                background: active ? `${C.accent}18` : 'rgba(255,255,255,0.03)',
                color:      active ? C.accent : C.t3,
                border:     `1px solid ${active ? C.accent + '35' : 'transparent'}`,
              }}>
              <Icon size={13} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Контент */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }} className="h-full">
            {tab === 'music'  && <OfflineMusic />}
            {tab === 'films'  && <OfflineFilms />}
            {tab === 'market' && <OfflineMarket />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
