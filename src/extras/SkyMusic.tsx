import { VideoBackdrop } from '@/music/VideoBackdrop';
import { EqualizerDialog } from '@/music/Equalizer';
import { MusicContinue } from '@/handoff/Slots';
import { ExplicitBadge, LabelsButton, LegacyChip } from '@/labels/Labels';
import { requestDelete } from '@/island/deleteFlow';
import { ArtistSuggest } from '@/artists/ArtistCard';
import { RetentionNote } from '@/shared/RetentionNote';
import React from 'react';
/* ===========================================================
   SKY MUSIC  -  Редизайн в стиле Яндекс Музыки
=========================================================== */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, X, Play, Pause, SkipForward,
  Heart, Plus, MoreHorizontal, ChevronLeft,
  ListMusic, Upload, Loader, History, BarChart3, Music2, Mic2, Download, CheckCircle, Crown, ArrowDownToLine,
  Sparkles, Flame, Star, Check, Clock, Film, Share2, SlidersHorizontal
} from 'lucide-react';
import { saveDownload, isDownloaded } from '@/offline/offlineDB';
import { useOfflineMusic } from '@/offline/musicOffline';
import { flash } from '@/shared/flash';
import { LicenseBadge, RightsholderNotice } from '@/music/licenses';
import { loadAudioUrl } from '@/platform/audioDB';
import { usePlatformStore } from '@/platform/store';
import { useMusicStore } from '@/music/serverStore';
import { apiPatchTrack, apiUploadCover, apiLyrics } from '@/music/musicApi';
import { parseTimedLyrics } from '@/music/lyrics';
import { useMoney } from '@/wallet/store';
import { PrimeGate } from '@/prime/PrimeGate';
import { SkyPayCheckout } from '@/payment/SkyPay';
import { useAuthStore }      from '@/core/auth/store';
import { useIsMobile }       from '@/interface/mobile/useIsMobile';
import type { Track }        from '@/platform/store';
import type { RepeatMode }   from '@/music/types';
import { toDurStr, getG } from '@/music/utils';
import { AddToPlaylistModal } from '@/music/AddToPlaylistModal';
import { MusicImport } from '@/music/MusicImport';
import { parseBlob } from 'music-metadata';
import { ArtistProfile }      from '@/music/ArtistProfile';
import { MusicianProfileTab } from '@/music/MusicianProfile';
import { SkyMusicHome } from './SkyMusicHome';
import { SkyMusicLibrary } from './SkyMusicLibrary';
import { SkyMusicSearch } from './SkyMusicSearch';
import { usePlayerStore } from '@/player/playerStore';
import type { IconComponent } from '@/shared/icon';
import { ShareDialog } from '@/storage/ShareDialog';
import { StorageQuotaBar } from '@/storage/StorageQuotaBar';

/* ── Tab types & nav config ─────────────────────────────────── */
type TabKey = 'home' | 'collection' | 'charts' | 'upload' | 'import' | 'history' | 'musician';

const NAV_TABS: { key: TabKey; icon: IconComponent; label: string }[] = [
  { key: 'home',       icon: Music2,     label: 'Главная'   },
  { key: 'collection', icon: ListMusic,  label: 'Коллекция' },
  { key: 'charts',     icon: BarChart3,  label: 'Чарты'     },
  { key: 'upload',     icon: Upload,     label: 'Загрузить' },
  { key: 'history',    icon: History,    label: 'История'   },
  { key: 'musician',   icon: Mic2,       label: 'Артист'    },
];

/* -- design tokens (YM-style dark) ------------------------ */
const YM = {
  bg:       'var(--bg)',
  card:     'var(--bg-l2)',
  card2:    'var(--bg-l3)',
  accent:   'var(--purple)',
  accentFg: '#ffffff',
  text:     'var(--t1)',
  sub:      'var(--t2)',
  sub2:     'var(--t3)',
  border:   'var(--border)',
};

/* -- gradient cover --------------------------------------- */
const Cover = ({ track, size = 44, playing = false, active = false, radius = 8 }: {
  track: Track; size?: number; playing?: boolean; active?: boolean; radius?: number;
}) => {
  const [c1, c2] = getG(track.id);
  return (
    <div className="relative overflow-hidden shrink-0 grid place-items-center"
      style={{ width: size, height: size, borderRadius: radius,
        background: track.coverUrl ? undefined : `linear-gradient(135deg,${c1},${c2})` }}>
      {track.coverUrl && <img src={track.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />}
      {!track.coverUrl && !active && <Music2 size={size * 0.35} color="rgba(255,255,255,0.35)" />}
      {active && playing && (
        <div className="absolute inset-0 flex items-end justify-center pb-1.5 gap-[2px]"
          style={{ background: 'rgba(0,0,0,0.45)' }}>
          {[0,1,2].map(i => (
            <motion.div key={i} className="w-[3px] rounded-full" style={{ background: YM.accent }}
              animate={{ height: ['4px','14px','6px','10px','4px'] }}
              transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }} />
          ))}
        </div>
      )}
    </div>
  );
};

/* -- Viz bars --------------------------------------------- */
const Viz = ({ playing }: { playing: boolean }) => (
  <div className="flex items-end gap-[2px]" style={{ height: 14 }}>
    {[0,1,2].map(i => (
      <motion.div key={i} className="w-[3px] rounded-full" style={{ background: YM.accent }}
        animate={playing ? { height: ['3px','14px','5px','10px','3px'] } : { height: '3px' }}
        transition={{ duration: 0.7 + i * 0.1, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }} />
    ))}
  </div>
);

/* -- progress bar (YM thin style) ------------------------ */
const SeekBar = ({ current, total, onChange, accent = YM.accent }: {
  current: number; total: number; onChange: (v: number) => void; accent?: string;
}) => {
  const pct    = total > 0 ? (current / total) * 100 : 0;
  const drag   = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  const calc   = (e: MouseEvent | React.MouseEvent) => {
    const r = barRef.current?.getBoundingClientRect(); if (!r) return;
    onChange(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total);
  };
  useEffect(() => {
    const up = () => { drag.current = false; };
    const mv = (e: MouseEvent) => { if (drag.current) calc(e); };
    window.addEventListener('mouseup', up); window.addEventListener('mousemove', mv);
    return () => { window.removeEventListener('mouseup', up); window.removeEventListener('mousemove', mv); };
  }, [total]);
  return (
    <div className="group relative w-full cursor-pointer py-2 -my-2" ref={barRef}
      onMouseDown={e => { drag.current = true; calc(e); }}>
      <div className="h-[3px] w-full rounded-full transition-all group-hover:h-1" style={{ background: 'rgba(255,255,255,0.15)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: accent }} />
      </div>
      <div className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
        style={{ left: `calc(${pct}% - 6px)`, background: accent }} />
    </div>
  );
};

/* -- Heart button ----------------------------------------- */
const HeartBtn = ({ liked, onClick, size = 18 }: { liked: boolean; onClick: () => void; size?: number }) => (
  <motion.button type="button" whileTap={{ scale: 0.8 }} onClick={e => { e.stopPropagation(); onClick(); }}
    className="grid place-items-center" style={{ color: liked ? YM.accent : YM.sub2 }}>
    <Heart size={size} fill={liked ? YM.accent : 'none'} />
  </motion.button>
);

/* -- Track row  -  YM style --------------------------------- */
const TrackRow = ({ track, active, playing, onPlay, liked, onLike, onAdd, showNum, num, onArtist }: {
  track: Track; active: boolean; playing: boolean;
  onPlay: () => void; liked: boolean; onLike: () => void;
  onAdd: () => void; showNum?: boolean; num?: number;
  /** Открыть страницу исполнителя. Без неё имя — просто подпись. */
  onArtist?: (name: string) => void;
}) => {
  const offHas  = useOfflineMusic(st => st.ids.has(track.id));
  const offProg = useOfflineMusic(st => st.progress[track.id]);
  const [localDone, setLocalDone] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const dlState: 'idle'|'loading'|'done' = (offHas || localDone) ? 'done' : (offProg !== undefined || localBusy) ? 'loading' : 'idle';

  useEffect(() => {
    if (!useOfflineMusic.getState().loaded) void useOfflineMusic.getState().hydrate();
    if (track.isLocal) { isDownloaded(track.id).then(d => d && setLocalDone(true)).catch(() => {}); }
  }, [track.id, track.isLocal]);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dlState === 'loading') return;
    if (dlState === 'done') {
      // Повторное нажатие на галочку — убрать с устройства.
      if (window.confirm('Удалить скачанный трек с этого устройства?')) {
        await useOfflineMusic.getState().remove(track.id);
        setLocalDone(false);
      }
      return;
    }
    // Треки, загруженные с самого устройства, уже лежат в его хранилище —
    // копируем их в офлайн-раздел; серверные забираем потоком с сервера.
    if (track.isLocal) {
      setLocalBusy(true);
      try {
        const blobUrl = await loadAudioUrl(track.id);
        if (blobUrl) {
          const blob = await (await fetch(blobUrl)).blob();
          const [g1, g2] = getG(track.id);
          await saveDownload({
            id: track.id, kind: 'track', title: track.title, artist: track.artist,
            duration: track.duration, mimeType: track.mimeType ?? (blob.type || 'audio/mpeg'),
            bytes: blob.size, addedAt: new Date().toISOString(), coverGrad: [g1, g2],
          }, blob);
          setLocalDone(true);
        }
      } catch { flash('Не получилось сохранить трек'); }
      setLocalBusy(false);
      return;
    }
    const r = await useOfflineMusic.getState().download(track);
    if (r === 'no_space') flash('Не хватило места на устройстве. Удалите ненужное и повторите.');
    else if (r === 'fail') flash('Не получилось скачать трек — проверьте связь и повторите.');
  };

  const isMobile = useIsMobile();
  return (
  <motion.div layout
    className={isMobile ? 'group flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors' : 'group flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors'}
    style={{ background: active ? 'var(--border)' : 'rgba(255,255,255,0)' }}
    onClick={onPlay}
    whileHover={{ background: 'rgba(255,255,255,0.05)' }}>
    {showNum && (
      <div className="w-5 shrink-0 flex items-center justify-center">
        {active
          ? <Viz playing={playing} />
          : <span className="text-sm tabular-nums" style={{ color: YM.sub }}>{num}</span>}
      </div>
    )}
    {!showNum && (
      <div className="shrink-0">
        <Cover track={track} size={isMobile ? 36 : 44} playing={playing} active={active} />
      </div>
    )}
    <div className="flex-1 min-w-0">
      <p className={isMobile ? 'text-[13px] font-medium truncate' : 'text-sm font-medium truncate'} style={{ color: active ? YM.accent : YM.text }}>{track.title}<ExplicitBadge show={track.explicit} /></p>
      {onArtist ? (
        <button type="button" onClick={e => { e.stopPropagation(); onArtist(track.artist); }}
          className={isMobile ? 'block max-w-full truncate text-left text-[11px]' : 'block max-w-full truncate text-left text-xs'}
          style={{ color: YM.sub }}>
          {track.artist}
        </button>
      ) : (
        <p className={isMobile ? 'text-[11px] truncate' : 'text-xs truncate'} style={{ color: YM.sub }}>{track.artist}{track.legacy && <span className="ml-2"><LegacyChip show /></span>}</p>
      )}
    </div>
    <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
      <HeartBtn liked={liked} onClick={onLike} size={isMobile ? 14 : 16} />
      {/* «В плейлист» показываем и на телефоне: раньше кнопка была
          только на большом экране, и с телефона плейлист нельзя было
          собрать вообще никак. */}
      <button type="button" aria-label="Добавить в плейлист"
        onClick={e => { e.stopPropagation(); onAdd(); }}
        className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-white/10"
        style={{ color: YM.sub }}>
        <Plus size={15} />
      </button>
      {!track.isLocal && <LabelsButton kind="track" id={track.id} size={15} />}
      {/* Download for offline */}
      {(
      <button type="button" onClick={handleDownload}
        className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-white/10"
        style={{ color: dlState === 'done' ? 'var(--green)' : dlState === 'loading' ? YM.accent : YM.sub }}
        title={dlState === 'done' ? 'Скачано — нажмите, чтобы удалить с устройства' : 'Скачать офлайн'}
        aria-label={dlState === 'done' ? 'Скачано' : 'Скачать офлайн'}>
        {dlState === 'done'
          ? <CheckCircle size={15} />
          : dlState === 'loading' && offProg !== undefined && offProg > 0
            ? <span className="text-[9px] font-bold tabular-nums">{Math.round(offProg * 100)}%</span>
            : <motion.div animate={dlState === 'loading' ? { rotate: 360 } : {}} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                <Download size={15} />
              </motion.div>
        }
      </button>
      )}
    </div>
    <span className={isMobile ? 'text-[11px] tabular-nums shrink-0' : 'text-xs tabular-nums shrink-0'} style={{ color: YM.sub2 }}>{track.duration}</span>
  </motion.div>
  );
};

/* -- Waveform hero banner (like YM "Мой поток") ----------- */
const WaveBanner = ({ onPlay, onConfig }: { onPlay: () => void; onConfig: () => void }) => {
  const colors = [
    ['#FF6B9D','#FF4757','#FFA726'],
    ['#7C4DFF','#00E5FF','#69F0AE'],
    ['#FF6B35','#F7931E','#FFD700'],
    ['#E040FB','#7C4DFF','#40C4FF'],
  ];
  const [ci] = useState(() => Math.floor(Math.random() * colors.length));
  const [c1, c2, c3] = colors[ci];
  return (
    <div className="relative overflow-hidden rounded-2xl mx-3 mb-4"
      style={{ height: 220, background: `radial-gradient(ellipse at 30% 40%, ${c1}88 0%, transparent 60%),
        radial-gradient(ellipse at 70% 30%, ${c2}88 0%, transparent 55%),
        radial-gradient(ellipse at 50% 80%, ${c3}77 0%, transparent 60%), #0a0a0a` }}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <button type="button" onClick={onPlay}
          className="flex items-center gap-3 rounded-2xl px-6 py-3 text-lg font-bold text-white"
          style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.15)' }}>
          <Play size={22} fill="white" />
          <span>Мой поток</span>
        </button>
        <button type="button" onClick={onConfig}
          className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm"
          style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(6px)', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <MoreHorizontal size={14} /> Настроить
        </button>
      </div>
    </div>
  );
};

/* -- Horizontal scroll section ---------------------------- */
const HSection = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const isMobile = useIsMobile();
  return (
  <div className={isMobile ? 'mb-3.5' : 'mb-5'}>
    <h3 className={isMobile ? 'text-[13px] font-bold px-3 mb-2' : 'text-base font-bold px-3 mb-2.5'} style={{ color: YM.text }}>{title}</h3>
    <div className={isMobile ? 'flex gap-2 px-3 overflow-x-auto' : 'flex gap-3 px-3 overflow-x-auto'} style={{ scrollbarWidth: 'none' }}>
      {children}
    </div>
  </div>
  );
};

/* -- Square card (playlist / collection) ------------------ */
const SquareCard = ({ title, sub, color1, color2, icon, onClick }: {
  title: string; sub: string; color1: string; color2: string;
  icon?: React.ReactNode; onClick?: () => void;
}) => {
  const isMobile = useIsMobile();
  const w = isMobile ? 112 : 150;
  return (
  <button type="button" onClick={onClick}
    className="shrink-0 flex flex-col overflow-hidden rounded-2xl text-left transition-transform hover:scale-[1.02]"
    style={{ width: w, background: `linear-gradient(135deg,${color1},${color2})` }}>
    <div className={isMobile ? 'h-[72px] flex items-center justify-center' : 'h-24 flex items-center justify-center'}>
      {icon ?? <Music2 size={isMobile ? 26 : 36} color="rgba(255,255,255,0.6)" />}
    </div>
    <div className={isMobile ? 'px-2.5 pb-2.5' : 'px-3 pb-3'}>
      <p className={isMobile ? 'text-[12px] font-bold text-white truncate' : 'text-sm font-bold text-white truncate'}>{title}</p>
      <p className={isMobile ? 'text-[10px] text-white/60 truncate' : 'text-[11px] text-white/60 truncate'}>{sub}</p>
    </div>
  </button>
  );
};

/* -- Collection tab  -  like YM "Коллекция" --------------- */
const CollectionTab = ({ tracks, favorites, playing, activeId, onPlay, onLike, onAdd, onArtist, onWave }: {
  tracks: Track[]; favorites: string[]; playing: boolean; activeId: string | null;
  onPlay: (t: Track, pool: Track[]) => void;
  onLike: (id: string) => void; onAdd: (id: string) => void; onArtist: (a: string) => void;
  onWave: () => void;
}) => {
  // Плейлисты теперь серверные: у них тот же вид (id, name, trackIds),
  // поэтому разметка ниже не изменилась ни строкой.
  const playlists = useMusicStore(st => st.playlists);
  const setCurrentPlaylist = usePlatformStore(st => st.setCurrentPlaylist);
  const likedTracks = useMemo(() => tracks.filter(t => favorites.includes(t.id)), [tracks, favorites]);
  const [view, setView] = useState<'main' | 'liked' | 'playlist'>('main');
  const [openPl, setOpenPl] = useState<string | null>(null);

  if (view === 'liked') return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-3 py-3 shrink-0">
        <button type="button" onClick={() => setView('main')} style={{ color: YM.sub }}><ChevronLeft size={20} /></button>
        <h2 className="text-base font-bold" style={{ color: YM.text }}>Мне нравится</h2>
        <span className="text-sm ml-auto" style={{ color: YM.sub }}>{likedTracks.length}</span>
      </div>
      {likedTracks.length > 0 && (
        <button type="button" onClick={() => onPlay(likedTracks[0], likedTracks)}
          className="mx-3 mb-3 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold shrink-0"
          style={{ background: YM.accent, color: YM.accentFg }}>
          <Play size={18} fill={YM.accentFg} /> Слушать всё · {likedTracks.length} треков
        </button>
      )}
      <div className="flex-1 overflow-y-auto pb-4">
        {likedTracks.map((t, i) => (
          <TrackRow key={t.id} track={t} active={activeId === t.id} playing={playing && activeId === t.id}
            onPlay={() => onPlay(t, likedTracks)} liked={favorites.includes(t.id)} onLike={() => onLike(t.id)}
            onAdd={() => onAdd(t.id)} showNum num={i + 1} />
        ))}
        {likedTracks.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16">
            <Heart size={36} color={YM.sub2} />
            <p className="text-sm" style={{ color: YM.sub }}>Добавляйте треки в избранное</p>
          </div>
        )}
      </div>
    </div>
  );

  if (view === 'playlist' && openPl) {
    const pl = playlists.find(p => p.id === openPl);
    if (!pl) { setView('main'); return null; }
    const pool = pl.trackIds.map(id => tracks.find(t => t.id === id)).filter(Boolean) as Track[];
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-3 py-3 shrink-0">
          <button type="button" onClick={() => setView('main')} style={{ color: YM.sub }}><ChevronLeft size={20} /></button>
          <h2 className="text-base font-bold truncate flex-1" style={{ color: YM.text }}>{pl.name}</h2>
          <span className="text-sm" style={{ color: YM.sub }}>{pool.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto pb-4">
          {pool.map((t, i) => (
            <TrackRow key={t.id} track={t} active={activeId === t.id} playing={playing && activeId === t.id}
              onPlay={() => onPlay(t, pool)} liked={favorites.includes(t.id)} onLike={() => onLike(t.id)}
              onAdd={() => onAdd(t.id)} showNum num={i + 1} />
          ))}
          {pool.length === 0 && <p className="py-8 text-center text-sm" style={{ color: YM.sub }}>Плейлист пуст</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Мой поток — WaveBanner */}
      <WaveBanner
        onPlay={onWave}
        onConfig={() => {}}
      />

      {/* Мне нравится block */}
      <button type="button" onClick={() => setView('liked')}
        className="flex items-center gap-4 px-3 py-3 transition-colors hover:bg-white/5">
        <div className="grid h-14 w-14 place-items-center rounded-xl shrink-0"
          style={{ background: 'linear-gradient(135deg,#FF4C4C,#FF8C00)' }}>
          <Heart size={26} fill="white" color="white" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="font-bold text-base" style={{ color: YM.text }}>Мне нравится</p>
          <p className="text-sm" style={{ color: YM.sub }}>{likedTracks.length} треков</p>
        </div>
        <ChevronLeft size={18} style={{ color: YM.sub2, transform: 'rotate(180deg)' }} />
      </button>

      {/* Latest liked tracks (top 3) */}
      {likedTracks.slice(0, 3).map(t => (
        <TrackRow key={t.id} track={t} active={activeId === t.id} playing={playing && activeId === t.id}
          onPlay={() => onPlay(t, likedTracks)} liked onLike={() => onLike(t.id)}
          onAdd={() => onAdd(t.id)} />
      ))}

      {/* Ещё в коллекции */}
      {playlists.length > 0 && (
        <div className="mt-4 mb-2">
          <h3 className="px-3 text-base font-bold mb-2" style={{ color: YM.text }}>Ещё у вас в Коллекции</h3>
          {playlists.map(pl => {
            const first = pl.trackIds.map(id => tracks.find(t => t.id === id)).find(Boolean);
            const [c1, c2] = first ? getG(first.id) : ['#333', '#555'];
            return (
              <button key={pl.id} type="button"
                onClick={() => { setOpenPl(pl.id); setView('playlist'); setCurrentPlaylist(pl.id); }}
                className="flex items-center gap-4 px-3 py-2.5 w-full transition-colors hover:bg-white/5">
                <div className="h-14 w-14 rounded-xl shrink-0 grid place-items-center"
                  style={{ background: `linear-gradient(135deg,${c1},${c2})` }}>
                  <ListMusic size={24} color="rgba(255,255,255,0.5)" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-semibold text-sm" style={{ color: YM.text }}>{pl.name}</p>
                  <p className="text-xs" style={{ color: YM.sub }}>{pl.trackIds.length} треков</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <div className="h-4" />
    </div>
  );
};

/* -- Home tab ---------------------------------------------- */

/* ═══════════════════════════════════════════════════════════════════════════
   PREMIUM HOME TAB  ·  Sky Music
   Уровень: Яндекс Музыка / Apple Music
═══════════════════════════════════════════════════════════════════════════ */
const HomeTab = ({ tracks, favorites, playing, activeId, onPlay, onLike, onAdd, onArtist, onWave }: {
  tracks: Track[]; favorites: string[]; playing: boolean; activeId: string | null;
  onPlay: (t: Track, pool: Track[]) => void;
  onLike: (id: string) => void; onAdd: (id: string) => void;
  onArtist: (a: string) => void; onWave: () => void;
}) => {
  const pub   = useMemo(() => tracks.filter(t => t.status === 'published'), [tracks]);
  const top   = useMemo(() => [...pub].sort((a, b) => b.plays - a.plays).slice(0, 12), [pub]);
  const fresh = useMemo(() => [...pub].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 8), [pub]);
  const genres= useMemo(() => [...new Set(pub.map(t => t.genre))].slice(0, 6), [pub]);
  const [heroIdx, setHeroIdx] = useState(0);
  const heroTracks = top.slice(0, 5);
  const heroCur    = heroTracks[heroIdx] ?? heroTracks[0];

  /* Auto-rotate hero */
  useEffect(() => {
    if (heroTracks.length < 2) return;
    const id = setInterval(() => setHeroIdx(i => (i + 1) % heroTracks.length), 6000);
    return () => clearInterval(id);
  }, [heroTracks.length]);

  const GENRE_PALETTE: Record<string, string> = {
    'Synthwave':'#a855f7','Electronic':'#3b82f6','Ambient':'#10b981',
    'Rock':'#ef4444','Hip-Hop':'#f59e0b','Jazz':'#ec4899',
    'Classical':'#14b8a6','Другое':'#8b5cf6','Pop':'#f43f5e',
    'Indie':'#84cc16','Soul':'#fb923c','Country':'#eab308',
  };

  if (pub.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 pb-8">
      <Music2 size={56} className="opacity-20" style={{ color: YM.sub }}/>
      <p className="text-sm font-semibold" style={{ color: YM.sub }}>Пока нет треков</p>
      <p className="text-xs" style={{ color: YM.sub2 }}>Загрузите первый трек во вкладке «Загрузить»</p>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto pb-6" style={{ scrollbarWidth: 'none' }}>

      {/* ── HERO SECTION ─────────────────────────────────────────────────── */}
      {heroCur && (
        <div className="relative overflow-hidden mx-3 mt-3 mb-5 rounded-2xl" style={{ minHeight: 200 }}>
          {/* Blurred BG */}
          <AnimatePresence mode="wait">
            <motion.div key={heroCur.id}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="absolute inset-0"
              style={{
                background: (() => {
                  const [c1, c2] = getG(heroCur.id);
                  return `linear-gradient(135deg, ${c1}cc 0%, ${c2}99 50%, rgba(0,0,0,0.6) 100%)`;
                })(),
              }}
            />
          </AnimatePresence>
          {/* Noise */}
          <div className="absolute inset-0 opacity-[0.06]"
            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")', backgroundSize: '180px' }} />

          <div className="relative z-10 flex items-end gap-5 p-5 pt-12">
            {/* Cover */}
            <AnimatePresence mode="wait">
              <motion.div key={heroCur.id}
                initial={{ scale: 0.85, opacity: 0, rotate: -4 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                className="shrink-0 rounded-xl overflow-hidden"
                style={{ width: 100, height: 100, boxShadow: '0 12px 40px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {heroCur.coverUrl
                  ? <img src={heroCur.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (
                    <div style={{ width: '100%', height: '100%', background: `linear-gradient(135deg,${getG(heroCur.id)[0]},${getG(heroCur.id)[1]})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Music2 size={36} color="rgba(255,255,255,0.3)" />
                    </div>
                  )
                }
              </motion.div>
            </AnimatePresence>

            {/* Info + controls */}
            <div className="flex-1 min-w-0">
              <AnimatePresence mode="wait">
                <motion.div key={heroCur.id}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.35 }}>
                  <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    {heroCur.genre}
                  </p>
                  <p className="text-xl font-black text-white leading-tight truncate mb-0.5">
                    {heroCur.title}
                  </p>
                  <p className="text-sm font-semibold truncate" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    {heroCur.artist}
                  </p>
                </motion.div>
              </AnimatePresence>

              <div className="flex items-center gap-3 mt-3">
                <motion.button whileTap={{ scale: 0.9 }} type="button"
                  onClick={() => onPlay(heroCur, top)}
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 font-bold text-sm"
                  style={{ background: 'rgba(255,255,255,0.95)', color: '#111', border: 'none', cursor: 'pointer' }}>
                  {playing && activeId === heroCur.id
                    ? <><Pause size={16} style={{ flexShrink: 0 }} /> Пауза</>
                    : <><Play  size={16} style={{ flexShrink: 0, marginLeft: 1 }} /> Слушать</>
                  }
                </motion.button>
                <motion.button whileTap={{ scale: 0.88 }} type="button"
                  onClick={() => onLike(heroCur.id)}
                  style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 10, width: 40, height: 40, display: 'grid', placeItems: 'center', cursor: 'pointer', color: favorites.includes(heroCur.id) ? '#f43f5e' : 'rgba(255,255,255,0.8)', backdropFilter: 'blur(8px)' }}>
                  <Heart size={18} fill={favorites.includes(heroCur.id) ? 'currentColor' : 'none'} />
                </motion.button>
              </div>
            </div>
          </div>

          {/* Hero dots */}
          {heroTracks.length > 1 && (
            <div className="absolute bottom-3 right-4 flex gap-1.5 z-20">
              {heroTracks.map((_, i) => (
                <button key={i} type="button" onClick={() => setHeroIdx(i)}
                  style={{ width: i === heroIdx ? 16 : 6, height: 6, borderRadius: 3, border: 'none', cursor: 'pointer', transition: 'all 0.3s ease', background: i === heroIdx ? '#fff' : 'rgba(255,255,255,0.35)' }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── QUICK PLAYLISTS ──────────────────────────────────────────────── */}
      <div className="flex gap-2.5 px-3 mb-5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {[
          { label: 'Для вас',    sub: 'Персональная',  pool: top,   Icon: Sparkles, color: '#a855f7' },
          { label: 'В тренде',  sub: `${top.length} треков`,  pool: top,   Icon: Flame,    color: '#f43f5e' },
          { label: 'Новинки',   sub: 'Свежие треки',   pool: fresh, Icon: Star,     color: '#22d3ee' },
          { label: 'Любимые',   sub: 'Мои треки',      pool: tracks.filter(t => favorites.includes(t.id)), Icon: Heart, color: '#ec4899' },
        ].map(item => (
          <motion.button key={item.label} type="button" whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => item.pool[0] && onPlay(item.pool[0], item.pool)}
            className="shrink-0 flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left"
            style={{ background: YM.card, border: '1px solid rgba(255,255,255,0.06)', minWidth: 170, cursor: 'pointer' }}>
            <div className="h-10 w-10 rounded-xl shrink-0 grid place-items-center"
              style={{ background: `${item.color}22`, border: `1px solid ${item.color}30` }}>
              <item.Icon size={18} style={{ color: item.color }}/>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate" style={{ color: YM.text }}>{item.label}</p>
              <p className="text-xs truncate" style={{ color: YM.sub2 }}>{item.sub}</p>
            </div>
          </motion.button>
        ))}
      </div>

      {/* ── TOP TRACKS (card grid) ───────────────────────────────────────── */}
      {top.length > 0 && (
        <section className="mb-5">
          <div className="flex items-center justify-between px-3 mb-3">
            <p className="text-sm font-black" style={{ color: YM.text }}>Популярное</p>
            <span className="text-xs font-semibold" style={{ color: YM.sub2 }}>{top.length} треков</span>
          </div>
          <div className="flex gap-3 px-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {top.map((t, rank) => {
              const [c1, c2] = getG(t.id);
              const isActive = activeId === t.id;
              return (
                <motion.div key={t.id} whileHover={{ y: -3 }} whileTap={{ scale: 0.97 }}
                  onClick={() => onPlay(t, top)}
                  className="shrink-0 cursor-pointer rounded-2xl overflow-hidden"
                  style={{ width: 140, background: YM.card, border: `1px solid ${isActive ? 'rgba(168,85,247,0.35)' : 'rgba(255,255,255,0.05)'}`, boxShadow: isActive ? '0 0 0 1px rgba(168,85,247,0.2)' : 'none' }}>
                  {/* Cover */}
                  <div style={{ height: 140, position: 'relative', background: t.coverUrl ? undefined : `linear-gradient(135deg,${c1},${c2})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {t.coverUrl
                      ? <img src={t.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <Music2 size={40} color="rgba(255,255,255,0.2)" />
                    }
                    {/* Rank badge */}
                    <div className="absolute top-2 left-2 rounded-lg px-1.5 py-0.5 text-[10px] font-black"
                      style={{ background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(6px)' }}>
                      #{rank + 1}
                    </div>
                    {/* Playing indicator */}
                    {isActive && playing && (
                      <div className="absolute inset-0 flex items-center justify-center"
                        style={{ background: 'rgba(0,0,0,0.35)' }}>
                        <div className="flex gap-0.5 items-end h-5">
                          {[0,1,2].map(j => (
                            <div key={j} style={{ width: 3, borderRadius: 2, background: '#fff', height: 4 + j * 4, animation: `skyEqBarHT ${0.5 + j * 0.15}s ease-in-out infinite alternate` }} />
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Like overlay */}
                    <button type="button" onClick={e => { e.stopPropagation(); onLike(t.id); }}
                      className="absolute top-2 right-2"
                      style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, width: 28, height: 28, display: 'grid', placeItems: 'center', cursor: 'pointer', color: favorites.includes(t.id) ? '#f43f5e' : 'rgba(255,255,255,0.6)' }}>
                      <Heart size={12} fill={favorites.includes(t.id) ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  {/* Info */}
                  <div className="px-3 py-2.5">
                    <p className="text-xs font-bold truncate" style={{ color: YM.text }}>{t.title}<ExplicitBadge show={t.explicit} /></p>
                    <p className="text-[11px] truncate mt-0.5" style={{ color: YM.sub2 }}>{t.artist}</p>
                    <p className="text-[10px] mt-1 font-semibold flex items-center gap-1" style={{ color: YM.sub2 }}>
                      <Play size={9} fill="currentColor"/> {t.plays.toLocaleString('ru')}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── GENRES ──────────────────────────────────────────────────────── */}
      {genres.length > 0 && (
        <section className="mb-5 px-3">
          <p className="text-sm font-black mb-3" style={{ color: YM.text }}>Жанры</p>
          <div className="grid grid-cols-3 gap-2">
            {genres.map(g => {
              const color = GENRE_PALETTE[g] ?? '#8b5cf6';
              const pool  = pub.filter(t => t.genre === g);
              return (
                <motion.button key={g} type="button" whileTap={{ scale: 0.95 }}
                  onClick={() => pool[0] && onPlay(pool[0], pool)}
                  className="rounded-xl py-4 text-center"
                  style={{ background: `${color}18`, border: `1px solid ${color}30`, cursor: 'pointer' }}>
                  <p className="text-xs font-bold" style={{ color }}>{g}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: YM.sub2 }}>{pool.length} тр.</p>
                </motion.button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── FRESH TRACKS (list) ─────────────────────────────────────────── */}
      {fresh.length > 0 && (
        <section className="mb-5 px-3">
          <p className="text-sm font-black mb-3" style={{ color: YM.text }}>Новинки</p>
          <div className="space-y-1">
            {fresh.map((t, i) => (
              <TrackRow key={t.id} track={t} active={activeId === t.id}
                playing={playing && activeId === t.id}
                onPlay={() => onPlay(t, fresh)} liked={favorites.includes(t.id)}
                onLike={() => onLike(t.id)} onAdd={() => onAdd(t.id)} />
            ))}
          </div>
        </section>
      )}

      <style>{`
        @keyframes skyEqBarHT {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1.6); }
        }
      `}</style>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   UPLOAD TAB WITH TIMECODE EDITOR
   Полная система: загрузка → текст + тайм-коды → модерация → плеер
═══════════════════════════════════════════════════════════════════════════ */
const UploadTab = ({ playing, activeId, onPlay }: {
  playing: boolean; activeId: string | null; onPlay: (t: Track, pool: Track[]) => void;
}) => {
  // Загрузка идёт на сервер: файл ложится на диск, а не в память
  // браузера, и потому виден с любого устройства.
  const tracks = useMusicStore(st => st.tracks);
  const uploadTrack = useMusicStore(st => st.upload);
  const removeTrack = useMusicStore(st => st.removeTrack);
  const publishTrack = useMusicStore(st => st.publish);
  const submitForReview = useMusicStore(st => st.submitForReview);
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);

  type Step = 'drop' | 'meta' | 'lyrics' | 'done' | 'batch';
  const [step,      setStep]      = useState<Step>('drop');
  type BItem = { id: number; file: File; title: string; artist: string; album: string; genre: string; year: string; explicit: boolean; lyrics: string; dur: number; cover: Blob | null; state: 'wait' | 'up' | 'ok' | 'err'; err?: string };
  const [batch, setBatch] = useState<BItem[]>([]);
  const [bAlbum, setBAlbum] = useState('');
  const [bArtist, setBArtist] = useState('');
  const [bGenre, setBGenre] = useState('');
  const [bBusy, setBBusy] = useState(false);
  const [bOpen, setBOpen] = useState<number | null>(null);
  const [bPublish, setBPublish] = useState(true);
  const bAudio = useRef<HTMLAudioElement>(null);
  const [bUrl, setBUrl] = useState<string | null>(null);
  const [dragging,  setDragging]  = useState(false);
  const [pFile,     setPFile]     = useState<File | null>(null);
  const [pUrl,      setPUrl]      = useState<string | null>(null);
  const [pDur,      setPDur]      = useState(0);
  const [title,     setTitle]     = useState('');
  const [artist,    setArtist]    = useState('');
  const [genre,     setGenre]     = useState('');
  const [album,     setAlbum]     = useState('');
  const [year,      setYear]      = useState('');
  const [coverUrl,  setCoverUrl]  = useState<string | undefined>(undefined);
  const [tagsDetected, setTagsDetected] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);
  const [editId,    setEditId]    = useState<string|null>(null);

  /* Timecode editor state */
  const [lyricsRaw, setLyricsRaw] = useState('');      // plain text, one line = one fragment
  const [timecodes, setTimecodes] = useState<{t:number;text:string}[]>([]);
  const [playPos,   setPlayPos]   = useState(0);
  const [isAudPlaying, setAudPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement|null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const fileRef  = useRef<HTMLInputElement>(null);

  const mine = tracks.filter(t => t.uploadedBy === 'me');
  const GENRES = ['Pop','Rock','Electronic','Hip-Hop','Jazz','Classical','Ambient','Synthwave','Indie','Soul','Другое'];

  /* Audio playback for timecode marking */
  useEffect(() => {
    if (!pUrl) return;
    const a = new Audio(pUrl);
    audioRef.current = a;
    a.ontimeupdate = () => setPlayPos(a.currentTime);
    a.onended      = () => { setAudPlaying(false); clearInterval(timerRef.current!); };
    return () => { a.pause(); a.src = ''; };
  }, [pUrl]);

  const toggleAudioPlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isAudPlaying) { a.pause(); setAudPlaying(false); }
    else { a.play(); setAudPlaying(true); }
  };

  const isAudioFile = (f: File) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a|alac|caf)$/i.test(f.name);

  /** Несколько файлов сразу: одна карточка-партия со списком треков; теги читаются из файлов. */
  const processFiles = async (list: File[]) => {
    const files = list.filter(isAudioFile).slice(0, 30);
    if (files.length === 0) return;
    if (files.length === 1) { void processFile(files[0]); return; }
    const items: BItem[] = [];
    let n = 0;
    for (const f of files) {
      const url = URL.createObjectURL(f);
      const dur = await new Promise<number>(r => { const a = document.createElement('audio'); a.onloadedmetadata = () => r(a.duration); a.onerror = () => r(0); a.src = url; });
      URL.revokeObjectURL(url);
      let title = '', artist = '', album = '', genre = '', year = '', cover: Blob | null = null;
      try {
        const c = (await parseBlob(f)).common;
        title = c.title ?? ''; artist = c.artist ?? ''; album = c.album ?? ''; genre = c.genre?.[0] ?? ''; year = c.year ? String(c.year) : '';
        const pic = c.picture?.[0]; if (pic) cover = new Blob([pic.data], { type: pic.format });
      } catch { /* без тегов — берём из имени */ }
      if (!title) { const base = f.name.replace(/\.[^.]+$/, ''); const parts = base.split(/\s+-\s+/); title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : base; if (!artist && parts.length > 1) artist = parts[0].trim(); }
      items.push({ id: n++, file: f, title, artist, album, genre, year, explicit: false, lyrics: '', dur: Number.isFinite(dur) ? dur : 0, cover, state: 'wait' });
    }
    setBatch(items); setBAlbum(''); setBArtist(''); setBGenre(''); setBOpen(null); setUploadError(null); setStep('batch');
  };
  const patchItem = (id: number, patch: Partial<BItem>) => setBatch(b => b.map(x => x.id === id ? { ...x, ...patch } : x));
  const uploadBatch = async () => {
    setBBusy(true); setUploadError(null);
    for (const it of batch) {
      if (it.state === 'ok' || !it.title.trim()) continue;
      patchItem(it.id, { state: 'up', err: undefined });
      try {
        const res = await uploadTrack(it.file, {
          title: it.title.trim(), artist: (it.artist.trim() || bArtist.trim() || (me?.name ?? 'Неизвестный')),
          album: (it.album.trim() || bAlbum.trim()) || undefined, genre: it.genre || bGenre || 'Другое',
          year: it.year.trim() || undefined, duration: it.dur,
        });
        if (!res.ok) { patchItem(it.id, { state: 'err', err: res.reason ?? 'Не получилось загрузить' }); continue; }
        if (res.id) {
          if (it.cover) await apiUploadCover(res.id, it.cover).catch(() => {});
          const lyr = it.lyrics.trim();
          if (lyr || it.explicit) await apiPatchTrack(res.id, { ...(lyr ? { lyrics: lyr } : {}), ...(it.explicit ? { explicit: true } : {}) }).catch(() => {});
          // Владелец сервиса публикует сразу, остальные уходят на проверку — решает сервер.
          if (bPublish) await submitForReview(res.id).catch(() => {});
        }
        patchItem(it.id, { state: 'ok' });
      } catch { patchItem(it.id, { state: 'err', err: 'Не получилось загрузить' }); }
    }
    setBBusy(false);
  };
  useEffect(() => {
    const it = bOpen === null ? null : batch.find(x => x.id === bOpen);
    if (!it) { setBUrl(null); return; }
    const u = URL.createObjectURL(it.file); setBUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const STAMP = /^\s*\[\d{1,3}:\d{2}(?:[.,]\d{1,3})?\]/;
  const stampNext = (id: number) => {
    const it = batch.find(x => x.id === id); const a = bAudio.current; if (!it || !a) return;
    const lines = it.lyrics.split('\n'); const i = lines.findIndex(l => l.trim() && !STAMP.test(l)); if (i < 0) return;
    const t = a.currentTime, mm = Math.floor(t / 60), ss = (t % 60).toFixed(2).padStart(5, '0');
    lines[i] = `[${mm}:${ss}] ${lines[i].trim()}`; patchItem(id, { lyrics: lines.join('\n') });
  };
  const batchDone = batch.length > 0 && batch.every(x => x.state === 'ok');

  const processFile = async (f: File) => {
    if (!f.type.startsWith('audio/') && !f.name.match(/\.(mp3|wav|ogg|flac|aac|m4a|alac|caf)$/i)) return;
    const url = URL.createObjectURL(f);
    const dur = await new Promise<number>(r => {
      const a = document.createElement('audio');
      a.onloadedmetadata = () => r(a.duration);
      a.onerror = () => r(0); a.src = url;
    });

    // Автоопределение метаданных из тегов файла (ID3/FLAC/OGG/MP4) —
    // если тегов нет, аккуратно догадываемся по имени файла "Артист - Название".
    let detected = false;
    try {
      const meta = await parseBlob(f);
      const c = meta.common;
      if (c.title)  { setTitle(c.title); detected = true; }
      if (c.artist) { setArtist(c.artist); detected = true; }
      if (c.album)  { setAlbum(c.album); detected = true; }
      if (c.year)   { setYear(String(c.year)); detected = true; }
      if (c.genre?.[0]) { setGenre(c.genre[0]); detected = true; }
      const pic = c.picture?.[0];
      if (pic) {
        const blob = new Blob([pic.data], { type: pic.format });
        setCoverUrl(URL.createObjectURL(blob));
        // Тот же файл уйдёт на сервер: обложка должна быть видна и с
        // другого устройства, а не только тому, кто загружал.
        setCoverBlob(blob);
        detected = true;
      }
    } catch { /* файл без читаемых тегов — не критично, работаем с эвристикой ниже */ }

    if (!detected) {
      const base = f.name.replace(/\.[^.]+$/, ''), parts = base.split(/[\s\-\_]+/);
      setTitle(parts.length > 1 ? parts.slice(1).join(' ').trim() : base);
      setArtist(parts[0].trim()); setGenre(''); setAlbum(''); setYear(''); setCoverUrl(undefined); setCoverBlob(null);
    }
    setTagsDetected(detected);
    setLyricsRaw(''); setTimecodes([]);
    setPFile(f); setPUrl(url); setPDur(dur); setStep('meta');
  };

  /* Parse raw lyrics lines into timecodes list */
  const parseLyricsLines = (raw: string): string[] =>
    raw.split('\n').map(l => l.trim()).filter(Boolean);

  /* Assign timecode to next unassigned lyric line */
  const markTimecode = () => {
    const lines = parseLyricsLines(lyricsRaw);
    const assigned = timecodes.length;
    if (assigned >= lines.length) return;
    const t = audioRef.current?.currentTime ?? playPos;
    const newLine = { t: Math.round(t * 100) / 100, text: lines[assigned] };
    setTimecodes(prev => [...prev, newLine]);
  };

  /* Remove last timecode */
  const removeLastTimecode = () => setTimecodes(prev => prev.slice(0, -1));

  /* Edit existing timecode time */
  const updateTimecodeTime = (i: number, sec: number) => {
    setTimecodes(prev => prev.map((tc, idx) => idx === i ? { ...tc, t: sec } : tc));
  };

  const fmt = (s: number) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

  const confirm = async () => {
    if (!pFile || !pUrl || !title.trim()) return;
    setSaving(true);
    try {
      const syncedLyrics = timecodes.length > 0
        ? [...timecodes].sort((a,b) => a.t - b.t)
        : lyricsRaw.trim()
          ? parseLyricsLines(lyricsRaw).map((text, i) => ({ t: i * 10, text }))
          : undefined;

      // Файл уходит как есть, целиком потоком запроса. Base64 из него
      // делать не нужно и вредно: он весит на треть больше и целиком
      // проходит через память браузера.
      const res = await uploadTrack(pFile, {
        title: title.trim(),
        artist: artist.trim() || (me?.name ?? 'Неизвестный'),
        album: album.trim() || undefined,
        genre: genre || 'Другое',
        year: year.trim() || undefined,
        duration: pDur,
      });
      if (!res.ok) {
        setUploadError(res.reason ?? 'Не получилось загрузить');
        setSaving(false);
        return;
      }
      if (res.id && (lyricsRaw.trim() || syncedLyrics)) {
        await apiPatchTrack(res.id, { lyrics: lyricsRaw.trim() || undefined });
      }
      if (res.id && coverBlob) await apiUploadCover(res.id, coverBlob);

      setPFile(null); setPUrl(null); setTitle(''); setArtist(''); setGenre('');
      setAlbum(''); setYear(''); setCoverUrl(undefined); setCoverBlob(null); setTagsDetected(false);
      setLyricsRaw(''); setTimecodes([]); setStep('done');
    } catch { setUploadError('Не получилось загрузить. Попробуйте ещё раз'); }
    finally { setSaving(false); }
  };

  /* Inline edit timecodes for existing track */
  const editingTrack = editId ? mine.find(t => t.id === editId) : null;
  const [editTimecodes, setEditTimecodes] = useState<{t:number;text:string}[]>([]);
  const [editLyricsRaw, setEditLyricsRaw] = useState('');

  useEffect(() => {
    if (editingTrack) {
      setEditTimecodes(editingTrack.syncedLyrics ?? []);
      setEditLyricsRaw(editingTrack.lyrics ?? '');
    }
  }, [editId]);

  const saveEditedLyrics = () => {
    if (!editId) return;
    const newSynced = editTimecodes.length > 0
      ? [...editTimecodes].sort((a,b) => a.t - b.t)
      : editLyricsRaw.trim()
        ? parseLyricsLines(editLyricsRaw).map((text, i) => ({ t: i * 10, text }))
        : undefined;
    // Текст хранится на сервере вместе с треком: править его может
    // только владелец, и проверяет это сервер.
    void apiPatchTrack(editId, { lyrics: editLyricsRaw });
    void newSynced;
    setEditId(null);
  };

  /* ── DONE state ──────────────────────────────────────────────────────── */
  if (step === 'done') return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-6">
      <motion.div initial={{scale:0}} animate={{scale:1}} transition={{type:'spring',stiffness:300}}>
        <div className="grid h-20 w-20 place-items-center rounded-full" style={{ background: 'rgba(168,85,247,0.15)', border: '2px solid rgba(168,85,247,0.3)' }}>
          <Music2 size={36} style={{ color: YM.accent }}/>
        </div>
      </motion.div>
      <div className="text-center">
        <p className="text-base font-black text-white mb-1">Трек загружен</p>
        <p className="text-sm" style={{ color: YM.sub }}>
          Пока он виден только вам и слышен с любого вашего устройства.
          Чтобы он появился в общем каталоге, нажмите «Опубликовать» в списке ниже.
        </p>
      </div>
      <motion.button whileTap={{scale:0.95}} type="button"
        onClick={() => setStep('drop')}
        className="rounded-2xl px-8 py-3 text-sm font-bold"
        style={{ background: YM.accent, color: '#fff', border: 'none', cursor: 'pointer' }}>
        Загрузить ещё
      </motion.button>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4" style={{ scrollbarWidth: 'none' }}>

      {/* ── STEP INDICATOR ─────────────────────────────────────────────── */}
      {step !== 'drop' && (
        <div className="flex items-center gap-2 px-4 py-3 shrink-0">
          {(['meta','lyrics'] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-black"
                  style={{ background: step === s ? YM.accent : step === 'lyrics' && s === 'meta' ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.08)', color: step === s ? '#fff' : step === 'lyrics' && s === 'meta' ? YM.accent : YM.sub2 }}>
                  {step === 'lyrics' && s === 'meta' ? <Check size={11}/> : i + 1}
                </div>
                <span className="text-xs font-semibold" style={{ color: step === s ? YM.text : YM.sub2 }}>
                  {s === 'meta' ? 'Инфо' : 'Текст и тайм-коды'}
                </span>
              </div>
              {i === 0 && <div className="flex-1 h-px mx-1" style={{ background: step === 'lyrics' ? YM.accent : 'rgba(255,255,255,0.08)', width: 20 }} />}
            </div>
          ))}
        </div>
      )}

      {/* ── STEP: DROP ─────────────────────────────────────────────────── */}
      {step === 'drop' && (
        <div className="mx-3 mt-3 mb-4 shrink-0"
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); void processFiles(Array.from(e.dataTransfer.files ?? [])); }}
          onClick={() => fileRef.current?.click()}>
          <input ref={fileRef} type="file" multiple accept="audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a,.alac,.caf" className="hidden"
            onChange={e => { const l = Array.from(e.target.files ?? []); e.target.value = ''; void processFiles(l); }} />
          <div className="flex flex-col items-center justify-center gap-4 rounded-3xl py-12 cursor-pointer transition-all"
            style={{ background: dragging ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.03)', border: `2px dashed ${dragging ? YM.accent : 'rgba(255,255,255,0.1)'}` }}>
            <div className="grid h-16 w-16 place-items-center rounded-2xl" style={{ background: dragging ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.05)' }}>
              <Upload size={28} style={{ color: dragging ? YM.accent : YM.sub2 }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold" style={{ color: dragging ? YM.accent : YM.text }}>
                {dragging ? 'Отпустите файлы' : 'Загрузить трек или несколько сразу'}
              </p>
              <p className="text-xs mt-1" style={{ color: YM.sub2 }}>MP3 · WAV · FLAC · OGG · M4A</p>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: BATCH ────────────────────────────────────────────────── */}
      {step === 'batch' && (
        <div className="mx-3 mt-3 space-y-3">
          <div className="rounded-2xl p-3 space-y-2" style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.18)' }}>
            <p className="text-sm font-black text-white">{`Треков в партии: ${batch.length}`}</p>
            <p className="text-[11px]" style={{ color: YM.sub2 }}>Общие поля подставляются там, где у трека своё не задано. У каждого трека есть «Настройки»: данные, текст и метки.</p>
            <input value={bArtist} onChange={e => setBArtist(e.target.value)} placeholder="Исполнитель (для всех)" maxLength={200} disabled={bBusy}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: 'rgba(255,255,255,0.06)', color: YM.text, border: 'none' }}/>
            <input value={bAlbum} onChange={e => setBAlbum(e.target.value)} placeholder="Альбом (для всех)" maxLength={200} disabled={bBusy}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: 'rgba(255,255,255,0.06)', color: YM.text, border: 'none' }}/>
            <select value={bGenre} onChange={e => setBGenre(e.target.value)} disabled={bBusy}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: 'rgba(255,255,255,0.06)', color: YM.text, border: 'none' }}>
              <option value="">Жанр</option>{GENRES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            {batch.map((it, i) => {
              const open = bOpen === it.id; const inp = 'w-full rounded-lg px-2.5 py-1.5 text-xs outline-none';
              const st = { background: 'rgba(255,255,255,0.06)', color: YM.text, border: 'none' } as const;
              return (
              <div key={it.id} className="rounded-xl p-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-center text-[11px] font-bold" style={{ color: YM.sub2 }}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <input value={it.title} translate="no" onChange={e => patchItem(it.id, { title: e.target.value })} disabled={bBusy || it.state === 'ok'} maxLength={200} placeholder="Название"
                      className="w-full bg-transparent text-sm font-semibold outline-none" style={{ color: YM.text }}/>
                    <p className="truncate text-[10px]" translate="no" style={{ color: it.state === 'err' ? '#ef4444' : YM.sub2 }}>{it.err ?? it.file.name}</p>
                  </div>
                  {it.state !== 'ok' && it.state !== 'up' && (
                    <button type="button" disabled={bBusy} onClick={() => setBOpen(open ? null : it.id)} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold"
                      style={{ background: open ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.08)', color: YM.text, border: 'none' }}>{open ? 'Свернуть' : 'Настройки'}</button>
                  )}
                  <div className="shrink-0 w-6 grid place-items-center">
                    {it.state === 'up' ? <Loader size={14} className="animate-spin" style={{ color: YM.accent }}/> : it.state === 'ok' ? <Check size={15} style={{ color: '#22c55e' }}/> :
                      !bBusy ? <button type="button" aria-label="Убрать" onClick={() => { setBatch(b => b.filter(x => x.id !== it.id)); if (open) setBOpen(null); }}><X size={14} style={{ color: YM.sub2 }}/></button> : null}
                  </div>
                </div>
                {open && it.state !== 'ok' && (
                  <div className="mt-2 space-y-1.5" translate="no">
                    <div className="grid grid-cols-2 gap-1.5">
                      <input value={it.artist} onChange={e => patchItem(it.id, { artist: e.target.value })} placeholder="Исполнитель" maxLength={200} className={inp} style={st}/>
                      <input value={it.album} onChange={e => patchItem(it.id, { album: e.target.value })} placeholder="Альбом" maxLength={200} className={inp} style={st}/>
                      <select value={it.genre} onChange={e => patchItem(it.id, { genre: e.target.value })} className={inp} style={st}>
                        <option value="">Жанр</option>{GENRES.map(g => <option key={g} value={g}>{g}</option>)}
                      </select>
                      <input value={it.year} onChange={e => patchItem(it.id, { year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="Год" inputMode="numeric" className={inp} style={st}/>
                    </div>
                    <label className="flex items-center gap-2 text-xs" style={{ color: YM.sub }}>
                      <input type="checkbox" checked={it.explicit} onChange={e => patchItem(it.id, { explicit: e.target.checked })}/>
                      <span translate="yes">Есть ненормативная лексика (E)</span>
                    </label>
                    {bUrl && <audio ref={bAudio} src={bUrl} controls className="w-full h-9"/>}
                    <textarea value={it.lyrics} onChange={e => patchItem(it.id, { lyrics: e.target.value })} rows={6} maxLength={20000}
                      placeholder={'Текст песни. Строки с метками: [0:12.50] строка'} className={inp + ' resize-y'} style={{ ...st, lineHeight: 1.5 }}/>
                    <div className="flex flex-wrap gap-1.5" translate="yes">
                      <button type="button" onClick={() => stampNext(it.id)} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold" style={{ background: YM.accent, color: '#fff', border: 'none' }}>Поставить метку на следующую строку</button>
                      <button type="button" onClick={() => patchItem(it.id, { lyrics: it.lyrics.split('\n').map(l => l.replace(STAMP, '').trimStart()).join('\n') })} className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold" style={{ background: 'rgba(255,255,255,0.08)', color: YM.text, border: 'none' }}>Сбросить метки</button>
                    </div>
                    <p className="text-[10px]" style={{ color: YM.sub2 }} translate="yes">Включите трек, в нужный момент нажмите «Поставить метку» — она встанет перед первой строкой без метки. Без меток текст показывается целиком.</p>
                  </div>
                )}
              </div>
            );})}
          </div>
          <label className="flex items-center gap-2 text-xs" style={{ color: YM.sub }}>
            <input type="checkbox" checked={bPublish} onChange={e => setBPublish(e.target.checked)} disabled={bBusy}/>
            Сразу отправить в каталог (у владельца Sky публикуется без проверки, у остальных — на проверку)
          </label>
          {uploadError && <p className="text-xs" style={{ color: '#ef4444' }}>{uploadError}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={bBusy} onClick={() => { setBatch([]); setStep('drop'); }}
              className="rounded-2xl px-4 py-3 text-sm font-bold" style={{ background: 'rgba(255,255,255,0.06)', color: YM.text, border: 'none' }}>Отмена</button>
            {batchDone
              ? <button type="button" onClick={() => { setBatch([]); setStep('done'); }} className="flex-1 rounded-2xl py-3 text-sm font-bold" style={{ background: YM.accent, color: '#fff', border: 'none' }}>Готово</button>
              : <button type="button" disabled={bBusy || batch.length === 0} onClick={() => void uploadBatch()} className="flex-1 rounded-2xl py-3 text-sm font-bold disabled:opacity-50" style={{ background: YM.accent, color: '#fff', border: 'none' }}>
                  {bBusy ? `Загружаем… ${batch.filter(x => x.state === 'ok').length}/${batch.length}` : batch.some(x => x.state === 'err') ? 'Повторить для ошибочных' : `Загрузить все (${batch.length})`}
                </button>}
          </div>
        </div>
      )}

      {/* ── STEP: META ─────────────────────────────────────────────────── */}
      {step === 'meta' && (
        <div className="mx-3 mt-1 space-y-3">
          {/* File preview */}
          <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.18)' }}>
            <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl" style={{ background: 'rgba(168,85,247,0.15)' }}>
              {coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-cover"/> : <Music2 size={20} style={{ color: YM.accent }} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate text-white">{pFile?.name}</p>
              <p className="text-[11px]" style={{ color: YM.sub2 }}>{fmt(pDur)} · {((pFile?.size ?? 0)/1024/1024).toFixed(1)} MB</p>
              {tagsDetected && (
                <p className="text-[10.5px] font-medium flex items-center gap-1" style={{ color: YM.accent }}>
                  <Check size={11}/> Метаданные найдены автоматически
                </p>
              )}
            </div>
            <button type="button" onClick={() => { setPFile(null); setPUrl(null); setStep('drop'); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: YM.sub2 }}>
              <X size={16} />
            </button>
          </div>

          {/* Fields */}
          {[['Название *', title, setTitle], ['Исполнитель', artist, setArtist], ['Альбом', album, setAlbum], ['Год', year, setYear]].map(([label, val, fn]) => (
            <div key={label as string}>
              <p className="text-xs font-semibold mb-1.5" style={{ color: YM.sub }}>{label as string}</p>
              <input value={val as string} onChange={e => (fn as Function)(e.target.value)}
                placeholder={label === 'Название *' ? 'Название трека' : label === 'Исполнитель' ? (me?.name ?? 'Исполнитель') : label === 'Год' ? '2024' : 'Альбом'}
                inputMode={label === 'Год' ? 'numeric' : undefined}
                className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: YM.text }} />
              {label === 'Исполнитель' && <ArtistSuggest name={String(val)} />}
            </div>
          ))}

          {/* Genre */}
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: YM.sub }}>Жанр</p>
            <div className="flex flex-wrap gap-1.5">
              {GENRES.map(g => (
                <button key={g} type="button" onClick={() => setGenre(g === genre ? '' : g)}
                  className="rounded-xl px-3 py-1.5 text-xs font-semibold"
                  style={{ background: genre === g ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${genre === g ? 'rgba(168,85,247,0.4)' : 'rgba(255,255,255,0.08)'}`, color: genre === g ? YM.accent : YM.sub, cursor: 'pointer' }}>
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <motion.button whileTap={{scale:0.97}} type="button"
              onClick={() => setStep('lyrics')}
              disabled={!title.trim()}
              className="flex-1 rounded-xl py-2.5 text-sm font-bold"
              style={{ background: title.trim() ? YM.accent : 'rgba(255,255,255,0.06)', color: title.trim() ? '#fff' : YM.sub2, border: 'none', cursor: title.trim() ? 'pointer' : 'default' }}>
              Далее →
            </motion.button>
            <motion.button whileTap={{scale:0.97}} type="button" onClick={confirm} disabled={!title.trim() || saving}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ background: 'rgba(255,255,255,0.06)', color: YM.sub, border: 'none', cursor: 'pointer' }}>
              {saving ? '...' : 'Без текста'}
            </motion.button>
          </div>
        </div>
      )}

      {/* ── STEP: LYRICS + TIMECODES ────────────────────────────────────── */}
      {step === 'lyrics' && (
        <div className="mx-3 mt-1 space-y-3">

          {/* Mini audio player */}
          <div className="rounded-2xl p-3 flex items-center gap-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <button type="button" onClick={toggleAudioPlay}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
              style={{ background: YM.accent, border: 'none', cursor: 'pointer' }}>
              {isAudPlaying ? <Pause size={16} color="#fff" /> : <Play size={16} color="#fff" style={{ marginLeft: 1 }} />}
            </button>
            <div className="flex-1">
              <div className="h-1.5 rounded-full overflow-hidden cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.1)' }}
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const pct = (e.clientX - r.left) / r.width;
                  if (audioRef.current) {
                    audioRef.current.currentTime = pct * pDur;
                    setPlayPos(pct * pDur);
                  }
                }}>
                <div className="h-full rounded-full" style={{ width: `${(playPos/pDur)*100}%`, background: YM.accent, transition: 'width 0.1s linear' }} />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[11px] font-mono font-bold" style={{ color: YM.accent }}>{fmt(playPos)}</span>
                <span className="text-[10px] font-mono" style={{ color: YM.sub2 }}>{fmt(pDur)}</span>
              </div>
            </div>
          </div>

          {/* Lyrics raw input */}
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: YM.sub }}>
              Текст песни <span style={{ color: YM.sub2, fontWeight: 400 }}>(каждая строка — отдельный фрагмент)</span>
            </p>
            <textarea
              value={lyricsRaw}
              onChange={e => { setLyricsRaw(e.target.value); setTimecodes([]); }}
              rows={5}
              placeholder={"Введите текст песни...\nКаждая новая строка — один фрагмент"}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: YM.text, lineHeight: '1.6' }}
            />
          </div>

          {/* Timecode editor */}
          {lyricsRaw.trim() && (() => {
            const lines = parseLyricsLines(lyricsRaw);
            return (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold" style={{ color: YM.sub }}>
                    Тайм-коды <span style={{ color: YM.sub2 }}>({timecodes.filter(tc => tc.t >= 0).length}/{lines.length})</span>
                  </p>
                  <button type="button"
                    onClick={() => setTimecodes(lines.map((text, i) => ({ text, t: timecodes[i]?.t ?? -1 })))}
                    className="text-[11px] font-semibold"
                    style={{ color: YM.sub2, background: 'none', border: 'none', cursor: 'pointer' }}>
                    Обновить список
                  </button>
                </div>

                {/* Hint */}
                <div className="rounded-xl px-3 py-2 mb-3"
                  style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.14)' }}>
                  <p className="text-[11px]" style={{ color: YM.sub2, lineHeight: '1.5' }}>
                    Воспроизведите трек → нажмите <strong style={{ color: YM.sub }}>«Взять»</strong> напротив строки в нужный момент. Или введите время вручную.
                  </p>
                </div>

                {/* Lines table */}
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5 pb-1" style={{ scrollbarWidth: 'none' }}>
                  {lines.map((lineText, i) => {
                    const tc = timecodes[i];
                    const hasTime = tc && tc.t >= 0;
                    return (
                      <div key={i}
                        className="flex items-center gap-2 rounded-xl px-3 py-2"
                        style={{
                          background: hasTime ? 'rgba(168,85,247,0.07)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${hasTime ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.06)'}`,
                        }}>
                        {/* Line number */}
                        <span className="text-[10px] w-4 text-center shrink-0 font-mono" style={{ color: YM.sub2 }}>{i+1}</span>

                        {/* Text (editable) */}
                        <input
                          value={tc?.text ?? lineText}
                          onChange={e => setTimecodes(prev => {
                            const next = [...prev];
                            if (next[i]) next[i] = { ...next[i], text: e.target.value };
                            else next[i] = { text: e.target.value, t: -1 };
                            return next;
                          })}
                          className="flex-1 min-w-0 text-xs outline-none bg-transparent"
                          style={{ color: hasTime ? YM.text : YM.sub }}
                        />

                        {/* Time input */}
                        <input
                          type="number"
                          value={hasTime ? tc.t : ''}
                          min={0} max={pDur} step={0.1}
                          placeholder="--"
                          onChange={e => {
                            const val = parseFloat(e.target.value);
                            setTimecodes(prev => {
                              const next = [...prev];
                              next[i] = { text: next[i]?.text ?? lineText, t: isNaN(val) ? -1 : val };
                              return next;
                            });
                          }}
                          className="text-[11px] font-mono w-14 outline-none text-center rounded-lg px-1.5 py-1"
                          style={{
                            background: hasTime ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.05)',
                            border: `1px solid ${hasTime ? 'rgba(168,85,247,0.28)' : 'rgba(255,255,255,0.08)'}`,
                            color: hasTime ? YM.accent : YM.sub2,
                          }}
                        />

                        {/* Взять текущее время */}
                        <motion.button
                          whileTap={{ scale: 0.88 }}
                          type="button"
                          title="Взять текущее время из плеера"
                          onClick={() => {
                            const t = Math.round((audioRef.current?.currentTime ?? playPos) * 100) / 100;
                            setTimecodes(prev => {
                              const next = [...prev];
                              next[i] = { text: next[i]?.text ?? lineText, t };
                              return next;
                            });
                          }}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors"
                          style={{
                            background: 'rgba(168,85,247,0.12)',
                            border: '1px solid rgba(168,85,247,0.22)',
                            cursor: 'pointer',
                            color: YM.accent,
                          }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 15.5 14"/>
                          </svg>
                        </motion.button>

                        {/* Clear */}
                        {hasTime && (
                          <button type="button"
                            onClick={() => setTimecodes(prev => {
                              const next = [...prev];
                              next[i] = { ...next[i], t: -1 };
                              return next;
                            })}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: YM.sub2, padding: 2 }}>
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Add / remove row */}
                <div className="flex gap-2 mt-2">
                  <button type="button"
                    onClick={() => setLyricsRaw(r => r + '\n')}
                    className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: YM.sub, cursor: 'pointer' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Строка
                  </button>
                  {lines.length > 1 && (
                    <button type="button"
                      onClick={() => {
                        const ls = lyricsRaw.split('\n');
                        // remove last non-empty
                        for (let j = ls.length - 1; j >= 0; j--) {
                          if (ls[j].trim()) { ls.splice(j, 1); break; }
                        }
                        setLyricsRaw(ls.join('\n'));
                        setTimecodes(prev => prev.slice(0, ls.filter(Boolean).length));
                      }}
                      className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
                      style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)', color: '#ef4444', cursor: 'pointer' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Удалить
                    </button>
                  )}
                  <span className="ml-auto text-[10px] self-center" style={{ color: YM.sub2 }}>
                    {timecodes.filter(tc => tc && tc.t >= 0).length} / {lines.length} размечено
                  </span>
                </div>
              </div>
            );
          })()}

          <div className="flex gap-2 pt-1">
            <motion.button whileTap={{scale:0.97}} type="button" onClick={() => setStep('meta')}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ background: 'rgba(255,255,255,0.06)', color: YM.sub, border: 'none', cursor: 'pointer' }}>
              ← Назад
            </motion.button>
            <motion.button whileTap={{scale:0.97}} type="button" onClick={confirm} disabled={saving}
              className="flex-1 rounded-xl py-2.5 text-sm font-bold"
              style={{ background: YM.accent, color: '#fff', border: 'none', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Загружаем...' : 'Загрузить трек'}
            </motion.button>
          </div>
          {uploadError && (
            <p className="mt-2 text-center text-[12px]" style={{ color: 'var(--red)' }}>{uploadError}</p>
          )}
        </div>
      )}

      {/* ── MY TRACKS ────────────────────────────────────────────────────── */}
      <div className="mx-3 mt-6">
        <StorageQuotaBar />
      </div>
      {mine.length > 0 && (
        <div className="mx-3 mt-6">
          <p className="text-sm font-black mb-3" style={{ color: YM.text }}>Мои треки</p>
          <div className="space-y-2">
            {mine.map(t => {
              const isEditing = editId === t.id;
              const statusColor = t.status === 'published' ? '#22c55e'
                : t.status === 'pending' ? '#f59e0b'
                : t.status === 'rejected' ? '#ef4444' : '#8a8f9a';
              const statusLabel = t.status === 'published' ? 'В каталоге'
                : t.status === 'pending' ? 'На проверке'
                : t.status === 'rejected' ? 'Отклонён' : 'Только у вас';
              const lyricsStatusColor = t.lyricsStatus === 'approved' ? '#22c55e' : t.lyricsStatus === 'pending' ? '#f59e0b' : t.lyricsStatus === 'rejected' ? '#ef4444' : 'transparent';
              return (
                <div key={t.id} className="rounded-2xl overflow-hidden"
                  style={{ background: YM.card, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex items-center gap-3 p-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                      style={{ background: `linear-gradient(135deg,${getG(t.id)[0]},${getG(t.id)[1]})` }}>
                      <Music2 size={20} color="rgba(255,255,255,0.4)" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: YM.text }}>{t.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${statusColor}18`, color: statusColor }}>
                          {statusLabel}
                        </span>
                        {t.syncedLyrics && t.syncedLyrics.length > 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${lyricsStatusColor}18`, color: lyricsStatusColor || YM.sub2, border: `1px solid ${lyricsStatusColor}30` }}>
                            {t.syncedLyrics.length} тайм-кодов
                            {t.lyricsStatus === 'approved' ? <Check size={10}/>
                              : t.lyricsStatus === 'pending' ? <Clock size={10}/>
                              : t.lyricsStatus === 'rejected' ? <X size={10}/> : null}
                          </span>
                        )}
                      </div>
                      {t.status === 'private' && (
                        <RetentionNote compact expiresAt={t.expiresAt} keep={t.retentionKeep}
                          onKeep={(keep) => useMusicStore.getState().setKeep(t.id, keep)} />
                      )}
                      {t.status === 'rejected' && t.rejectReason && (
                        <p className="mt-1 text-[11px] leading-snug" style={{ color: '#ef4444' }}>
                          Причина: {t.rejectReason}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button type="button" onClick={() => setEditId(isEditing ? null : t.id)}
                        className="grid h-8 w-8 place-items-center rounded-xl"
                        style={{ background: isEditing ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.06)', border: `1px solid ${isEditing ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.08)'}`, color: isEditing ? YM.accent : YM.sub2, cursor: 'pointer' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m18.5 2.5 2.5 2.5L12 14l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      {/* В общий каталог трек попадает через проверку, а не
                          по нажатию: за то, что лежит в каталоге, отвечает
                          владелец сервиса. Снять с публикации и отозвать
                          заявку человек может сам. */}
                      {t.status === 'published' ? (
                        <button type="button" title="Убрать из каталога"
                          onClick={() => void publishTrack(t.id, false)}
                          className="rounded-lg px-2 py-1 text-[11px] font-bold"
                          style={{ background: 'rgba(255,255,255,0.06)', color: YM.sub, border: 'none', cursor: 'pointer' }}>
                          Скрыть
                        </button>
                      ) : t.status === 'pending' ? (
                        <button type="button" title="Отозвать заявку"
                          onClick={() => void publishTrack(t.id, false)}
                          className="rounded-lg px-2 py-1 text-[11px] font-bold"
                          style={{ background: 'rgba(255,255,255,0.06)', color: YM.sub, border: 'none', cursor: 'pointer' }}>
                          Отозвать
                        </button>
                      ) : (
                        <button type="button" title="Отправить трек на проверку"
                          onClick={() => void submitForReview(t.id)}
                          className="rounded-lg px-2 py-1 text-[11px] font-bold"
                          style={{ background: 'rgba(255,255,255,0.06)', color: YM.sub, border: 'none', cursor: 'pointer' }}>
                          {t.status === 'rejected' ? 'Отправить снова' : 'На проверку'}
                        </button>
                      )}
                      {t.status === 'private' && (
                        <button type="button" title="Поделиться" onClick={() => setSharingId(t.id)}
                          className="grid h-8 w-8 place-items-center rounded-xl"
                          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: YM.sub2, cursor: 'pointer' }}>
                          <Share2 size={13} />
                        </button>
                      )}
                      <button type="button" onClick={() => requestDelete({ id: t.id, title: t.title, noun: 'трек', archive: true, run: async () => { if (!(await removeTrack(t.id))) throw new Error('Не удалось удалить трек. Попробуйте ещё раз.'); } })}
                        className="grid h-8 w-8 place-items-center rounded-xl"
                        style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)', color: '#ef4444', cursor: 'pointer' }}>
                        <X size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Inline lyric editor */}
                  {isEditing && (() => {
                    const editLines = editLyricsRaw.split('\n').map(l => l.trim()).filter(Boolean);
                    return (
                      <div className="border-t px-3 pb-3 pt-3 space-y-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        <p className="text-xs font-bold" style={{ color: YM.sub }}>Редактор текста и тайм-кодов</p>

                        {/* Raw lyrics */}
                        <textarea value={editLyricsRaw}
                          onChange={e => { setEditLyricsRaw(e.target.value); setEditTimecodes([]); }}
                          rows={4} placeholder="Текст песни (каждая строка — фрагмент)"
                          className="w-full rounded-xl px-3 py-2 text-xs outline-none resize-none"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: YM.text }} />

                        {/* Per-row timecode editor */}
                        {editLines.length > 0 && (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                            {editLines.map((lineText, i) => {
                              const tc = editTimecodes[i];
                              const hasTime = tc && tc.t >= 0;
                              return (
                                <div key={i} className="flex items-center gap-2 rounded-xl px-2.5 py-1.5"
                                  style={{ background: hasTime ? 'rgba(168,85,247,0.07)' : 'rgba(255,255,255,0.03)', border: `1px solid ${hasTime ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.06)'}` }}>
                                  <span className="text-[9px] w-4 text-center shrink-0 font-mono" style={{ color: YM.sub2 }}>{i+1}</span>

                                  {/* Editable text */}
                                  <input
                                    value={tc?.text ?? lineText}
                                    onChange={e => setEditTimecodes(prev => {
                                      const next = [...prev];
                                      next[i] = { text: e.target.value, t: next[i]?.t ?? -1 };
                                      return next;
                                    })}
                                    className="flex-1 min-w-0 text-[11px] outline-none bg-transparent"
                                    style={{ color: hasTime ? YM.text : YM.sub }}
                                  />

                                  {/* Time input */}
                                  <input type="number"
                                    value={hasTime ? tc.t : ''}
                                    min={0} step={0.1} placeholder="--"
                                    onChange={e => {
                                      const val = parseFloat(e.target.value);
                                      setEditTimecodes(prev => {
                                        const next = [...prev];
                                        next[i] = { text: next[i]?.text ?? lineText, t: isNaN(val) ? -1 : val };
                                        return next;
                                      });
                                    }}
                                    className="text-[10px] font-mono w-12 outline-none text-center rounded-lg px-1 py-0.5"
                                    style={{ background: hasTime ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.05)', border: `1px solid ${hasTime ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.08)'}`, color: hasTime ? YM.accent : YM.sub2 }}
                                  />

                                  {/* Взять время из главного плеера */}
                                  <motion.button whileTap={{ scale: 0.85 }} type="button"
                                    title={`Взять ${fmt(playing && activeId ? 0 : 0)} из плеера`}
                                    onClick={() => {
                                      // Get time from the global playerStore (main player)
                                      const playerTime = (window as any).__skyPlayerCurrentTime ?? 0;
                                      const t = Math.round(playerTime * 100) / 100;
                                      setEditTimecodes(prev => {
                                        const next = [...prev];
                                        next[i] = { text: next[i]?.text ?? lineText, t };
                                        return next;
                                      });
                                    }}
                                    className="grid h-6 w-6 shrink-0 place-items-center rounded-lg"
                                    style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.22)', cursor: 'pointer', color: YM.accent }}>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 15.5 14"/>
                                    </svg>
                                  </motion.button>

                                  {/* Clear */}
                                  {hasTime && (
                                    <button type="button"
                                      onClick={() => setEditTimecodes(prev => {
                                        const next = [...prev];
                                        next[i] = { ...next[i], t: -1 };
                                        return next;
                                      })}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: YM.sub2, padding: 1 }}>
                                      <X size={10} />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[10px] flex-1" style={{ color: YM.sub2 }}>
                            {editTimecodes.filter(tc => tc && tc.t >= 0).length}/{editLines.length} строк размечено
                          </span>
                          <button type="button" onClick={() => setEditId(null)}
                            className="rounded-xl px-3 py-2 text-xs font-semibold"
                            style={{ background: 'rgba(255,255,255,0.06)', color: YM.sub, border: 'none', cursor: 'pointer' }}>
                            Отмена
                          </button>
                          <button type="button" onClick={saveEditedLyrics}
                            className="rounded-xl px-3 py-2 text-xs font-bold"
                            style={{ background: YM.accent, color: '#fff', border: 'none', cursor: 'pointer' }}>
                            Сохранить
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sharingId && (
        <ShareDialog kind="track" fileId={sharingId}
          title={mine.find(t => t.id === sharingId)?.title ?? ''}
          onClose={() => setSharingId(null)} />
      )}
    </div>
  );
};





const HistTab = ({ tracks, favorites, playing, activeId, onPlay, onLike, onAdd, onArtist }: {
  tracks: Track[]; favorites: string[]; playing: boolean; activeId: string | null;
  onPlay: (t: Track, pool: Track[]) => void; onLike: (id: string) => void; onAdd: (id: string) => void;
  onArtist?: (name: string) => void;
}) => {
  // История — с сервера: тот же список на телефоне и на компьютере.
  const history = useMusicStore(st => st.history);
  const hist = useMemo(
    () => history.map(h => tracks.find(t => t.id === h.id)).filter(Boolean) as Track[],
    [history, tracks],
  );
  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      <h3 className="px-3 pt-3 pb-2 text-base font-bold" style={{ color: YM.text }}>
        История · {hist.length}
      </h3>
      {hist.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12">
          <History size={32} color={YM.sub2} />
          <p className="text-sm" style={{ color: YM.sub }}>Здесь появятся прослушанные треки</p>
        </div>
      )}
      {hist.map((t, i) => (
        <TrackRow key={`${t.id}-${i}`} track={t} active={activeId === t.id} playing={playing && activeId === t.id}
          onPlay={() => onPlay(t, hist)} liked={favorites.includes(t.id)} onLike={() => onLike(t.id)}
          onAdd={() => onAdd(t.id)} showNum num={i + 1} onArtist={onArtist} />
      ))}
    </div>
  );
};

/* -- Charts tab ------------------------------------------- */
const ChartsTab = ({ tracks, favorites, playing, activeId, onPlay, onLike, onAdd, onArtist }: {
  tracks: Track[]; favorites: string[]; playing: boolean; activeId: string | null;
  onPlay: (t: Track, pool: Track[]) => void; onLike: (id: string) => void; onAdd: (id: string) => void;
  onArtist?: (name: string) => void;
}) => {
  const pub = useMemo(() => tracks.filter(t => t.status === 'published'), [tracks]);
  const top = useMemo(() => [...pub].sort((a, b) => b.plays - a.plays), [pub]);
  return (
    <div className="flex flex-col h-full overflow-y-auto pb-4">
      <h3 className="px-3 pt-3 pb-2 text-base font-bold" style={{ color: YM.text }}>Чарты</h3>
      {top.map((t, i) => (
        <TrackRow key={t.id} track={t} active={activeId === t.id} playing={playing && activeId === t.id}
          onPlay={() => onPlay(t, top)} liked={favorites.includes(t.id)} onLike={() => onLike(t.id)}
          onAdd={() => onAdd(t.id)} showNum num={i + 1} onArtist={onArtist} />
      ))}
    </div>
  );
};

/* ===========================================================
   MAIN  -  SkyMusic
=========================================================== */


/* ───────────────────────────────────────────────────────────────────────────
   SkyFullPlayer — Премиальный fullscreen плеер
   Встроен в SkyMusic.tsx как замена NowPlaying
─────────────────────────────────────────────────────────────────────────── */
const getHue = (id: string) => parseInt(id.replace(/\D/g,'').slice(0,4)||'1234') % 360;

const hslAcc  = (h:number) => `hsl(${h},68%,60%)`;
const hslMid  = (h:number) => `hsl(${(h+35)%360},55%,45%)`;
const hslDark = (h:number) => `hsl(${h},55%,12%)`;
const hslDk2  = (h:number) => `hsl(${(h+40)%360},45%,8%)`;
const hslGlow = (h:number) => `hsl(${h},58%,36%)`;
/** hsl(...) + две шестнадцатеричные цифры прозрачности → hsla(...). Дописанное к hsl() «55»
 *  (`hsl(...)55`) — недопустимый цвет, браузер его отбрасывал: ни свечения, ни подложки. */
const hslA = (color: string, hex: string) =>
  color.replace(/^hsl\((.*)\)$/, (_m, inner) => `hsla(${inner},${(parseInt(hex, 16) / 255).toFixed(2)})`);

/* Разбор текста песни вынесен в @/music/lyrics (его же использует карточка «Мой поток»). */
export { parseTimedLyrics };



const VolumeIcon = ({ v }: { v: number }) => {
  if (v === 0) return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
    </svg>
  );
  if (v < 0.5) return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>
  );
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>
  );
};

interface SkyFullPlayerProps {
  track:       Track;
  playing:     boolean;
  currentTime: number;
  duration:    number;
  volume:      number;
  shuffle:     boolean;
  repeat:      RepeatMode;
  favorites:   string[];
  queue:       Track[];
  queueIdx:    number;
  onPlay:      () => void;
  onPrev:      () => void;
  onNext:      () => void;
  onSeek:      (t: number) => void;
  onVolume:    (v: number) => void;
  onShuffle:   () => void;
  onRepeat:    () => void;
  onLike:      (id: string) => void;
  onAdd:       (id: string) => void;
  onClose:     () => void;
}

/* ── MiniBar — bottom mini player ─────────────────────────── */
const MiniBar = ({ track, playing, cur, dur, liked, onPlay, onNext, onOpen, onLike, onHide, bottom = 0 }: {
  /** Отступ снизу: мини-плеер стоит НАД нижней панелью Sky Music, а не перекрывает её. */
  bottom?: number;
  track: Track; playing: boolean; cur: number; dur: number;
  liked: boolean; onPlay: () => void; onNext: () => void;
  onOpen: () => void; onLike: () => void; onHide: () => void;
}) => {
  const pct = dur > 0 ? (cur / dur) * 100 : 0;
  const fmtT = (s: number) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const [g1, g2] = getG ? getG(track.id) : ['#4f6ef7','#818cf8'];
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      className="absolute left-0 right-0 z-50"
      style={{ bottom, padding: '0 8px 8px' }}>
      <div
        className="flex items-center gap-3 rounded-2xl px-3 py-2.5"
        style={{
          background: 'var(--bg-l2)',
          border: '1px solid var(--border-m)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
          backdropFilter: 'blur(20px)',
        }}>
        {/* Progress bar top */}
        <div
          className="absolute top-0 left-8 right-8 h-0.5 rounded-full overflow-hidden"
          style={{ background: 'var(--border)' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: YM.accent, borderRadius: 1 }} />
        </div>

        {/* Cover — click to open full player */}
        <div
          className="shrink-0 rounded-xl overflow-hidden cursor-pointer"
          style={{ width: 42, height: 42, background: `linear-gradient(135deg,${g1},${g2})` }}
          onClick={onOpen}>
          {track.coverUrl
            ? <img src={track.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
                <Music2 size={18} color="rgba(255,255,255,0.7)"/>
              </div>}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpen}>
          <p className="text-[13px] font-bold truncate" style={{ color: YM.text }}>{track.title}<ExplicitBadge show={track.explicit} /></p>
          <p className="text-[11px] truncate" style={{ color: YM.sub }}>{track.artist}</p>
        </div>

        {/* Time */}
        <span className="text-[10px] shrink-0 tabular-nums" style={{ color: YM.sub2, fontFamily: 'DM Mono,monospace' }}>
          {fmtT(cur)}
        </span>

        {/* Like */}
        <motion.button whileTap={{ scale: 0.85 }} type="button" onClick={onLike}
          className="grid h-8 w-8 place-items-center rounded-full"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: liked ? '#ef4444' : YM.sub2 }}>
          <Heart size={16} fill={liked ? '#ef4444' : 'none'} stroke={liked ? '#ef4444' : YM.sub2} />
        </motion.button>

        {/* Play/Pause */}
        <motion.button whileTap={{ scale: 0.88 }} type="button" onClick={onPlay}
          className="grid h-9 w-9 place-items-center rounded-full shrink-0"
          style={{ background: YM.accent, border: 'none', cursor: 'pointer' }}>
          {playing
            ? <Pause size={16} fill="white" stroke="white" />
            : <Play  size={16} fill="white" stroke="white" style={{ marginLeft: 1 }} />}
        </motion.button>

        {/* Skip */}
        <motion.button whileTap={{ scale: 0.88 }} type="button" onClick={onNext}
          className="grid h-8 w-8 place-items-center rounded-full"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: YM.sub2 }}>
          <SkipForward size={16} />
        </motion.button>

        {/* Скрыть мини-плеер с экрана (музыка продолжает играть) */}
        <motion.button whileTap={{ scale: 0.88 }} type="button" onClick={onHide} aria-label="Hide player"
          className="grid h-8 w-8 place-items-center rounded-full"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: YM.sub2 }}>
          <X size={15} />
        </motion.button>
      </div>
    </motion.div>
  );
};


export const SkyFullPlayer = ({
  track, playing, currentTime, duration, volume,
  shuffle, repeat, favorites, queue, queueIdx,
  onPlay, onPrev, onNext, onSeek, onVolume,
  onShuffle, onRepeat, onLike, onAdd, onClose,
}: SkyFullPlayerProps) => {
  const [showQueue,   setShowQueue]   = React.useState(false);
  /* «Скрыть текст»: в полноэкранном плеере остаются только обложка и кнопки управления по центру —
     ни текста песни, ни очереди, ни названия. Выбор помнится на устройстве. */
  const [bare, setBareState] = React.useState(() => { try { return localStorage.getItem('sky:fullplayer:bare') === '1'; } catch { return false; } });
  const [showLyrics,  setShowLyrics]  = React.useState(() => { try { return localStorage.getItem('sky:fullplayer:bare') !== '1'; } catch { return true; } });
  const setBare = (v: boolean) => {
    setBareState(v);
    try { localStorage.setItem('sky:fullplayer:bare', v ? '1' : '0'); } catch { /* не критично */ }
    setShowQueue(false);
    setShowLyrics(!v);
  };
  // Высота колонки с плеером на телефоне: окно текста/очереди кончается над ней, а не лежит под обложкой и кнопками.
  const ctlRef = React.useRef<HTMLDivElement>(null);
  const [ctlH, setCtlH] = React.useState(0);
  const [muted,       setMuted]       = React.useState(false);
  const [seeking,     setSeeking]     = React.useState(false);
  const lyricsRef    = React.useRef<HTMLDivElement>(null);
  const lyricItems   = React.useRef<(HTMLDivElement|null)[]>([]);
  const prevTrackRef = React.useRef(track.id);
  const isMobile = useIsMobile();
  React.useEffect(() => {
    const el = ctlRef.current;
    if (!isMobile || !el || typeof ResizeObserver === 'undefined') { setCtlH(0); return undefined; }
    const ro = new ResizeObserver(() => setCtlH(el.offsetHeight));
    ro.observe(el); setCtlH(el.offsetHeight);
    return () => ro.disconnect();
  }, [isMobile, showLyrics, showQueue]);

  /* Редактирование текста — только у своих же треков (canEdit с
     сервера), не у чужих: показать чужой песне чужие слова уже
     нельзя было (см. ниже), а вот дать редактировать чужую — отдельная
     дыра, которую сервер и так закрывает через canEdit. */
  const [lyricsCanEdit, setLyricsCanEdit] = React.useState(false);
  const [lyricsRaw, setLyricsRaw] = React.useState('');
  const [editingLyrics, setEditingLyrics] = React.useState(false);
  const [lyricsDraft, setLyricsDraft] = React.useState('');
  const [savingLyrics, setSavingLyrics] = React.useState(false);

  const h   = getHue(track.id);
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isFav = favorites.includes(track.id);
  const [c1, c2] = getG(track.id);
  const effVol = muted ? 0 : volume;

  /* Текст песни приходит с сервера — тот, который загрузил владелец.
     Придуманных строк здесь больше нет: показать чужой песне чужие
     слова хуже, чем не показать никаких. */
  const [serverLyrics, setServerLyrics] = React.useState<{t:number;text:string}[] | null>(null);
  React.useEffect(() => {
    let alive = true;
    setServerLyrics(null);
    setLyricsCanEdit(false);
    setLyricsRaw('');
    setEditingLyrics(false);
    void apiLyrics(track.id).then(res => {
      if (!alive || !res) return;
      setServerLyrics(parseTimedLyrics(res.lyrics));
      setLyricsCanEdit(res.canEdit);
      setLyricsRaw(res.lyrics ?? '');
    });
    return () => { alive = false; };
  }, [track.id]);

  /* «Расставить»: строки получают метки времени [мм:сс]. Шаг — сколько секунд строка
     «висит» на экране; 0 — растянуть строки равномерно по всей песне. */
  const [holdSec, setHoldSec] = React.useState('4');
  const tagLyrics = (raw: string, hold: number) => {
    const lines = raw.split('\n').map(l => l.replace(/^\s*\[\d{1,2}:\d{2}(?:[.:]\d{1,2})?\]\s*/, '').trimEnd()).filter(l => l.trim() !== '');
    if (!lines.length) return raw;
    const step = hold > 0 ? hold : (duration > 0 ? duration / lines.length : 4);
    return lines.map((text, i) => {
      const t = Math.round(i * step * 10) / 10;
      const mm = String(Math.floor(t / 60)).padStart(2, '0');
      const ss = (t % 60).toFixed(1).padStart(4, '0');
      return `[${mm}:${ss}] ${text}`;
    }).join('\n');
  };

  const openLyricsEditor = () => { setLyricsDraft(lyricsRaw); setEditingLyrics(true); };
  const saveLyrics = async () => {
    setSavingLyrics(true);
    const saved = await apiPatchTrack(track.id, { lyrics: lyricsDraft });
    setSavingLyrics(false);
    if (!saved) return;
    setLyricsRaw(lyricsDraft);
    setServerLyrics(parseTimedLyrics(lyricsDraft));
    setEditingLyrics(false);
  };

  const lyrics = React.useMemo(() => {
    const base = track.syncedLyrics && track.syncedLyrics.length > 0 ? track.syncedLyrics : (serverLyrics ?? []);
    const lines = base.filter(l => l.text);
    return lines;
  }, [track.id, track.syncedLyrics, serverLyrics]);

  /* Без меток времени текст показывается целиком и сам не листается: придумывать,
     какая строка поётся сейчас, нельзя — подсветка и прокрутка только по настоящим меткам. */
  const lyricsTimed = React.useMemo(() => lyrics.some(l => l.t > 0), [lyrics]);
  const activeLyric = React.useMemo(
    () => lyricsTimed ? lyrics.reduce((best, l, i) => l.t <= currentTime ? i : best, 0) : -1,
    [lyrics, currentTime, lyricsTimed]
  );

  /* Auto-scroll */
  React.useEffect(() => {
    const el = activeLyric >= 0 ? lyricItems.current[activeLyric] : null;
    if (el && lyricsRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeLyric]);

  /* Reset scroll on track change */
  React.useEffect(() => {
    if (prevTrackRef.current !== track.id) {
      prevTrackRef.current = track.id;
      lyricsRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [track.id]);

  const fmt = (s: number) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - r.left) / r.width) * duration);
  };

  /* Портал прямо в body: без него этот fixed-оверлей остаётся потомком
     нескольких вложенных position:relative/overflow:hidden контейнеров
     ExtrasModule/MobileShell — на части WebView (в т.ч. мобильных) это
     превращает "fixed" в позиционирование относительно ближайшего из
     них, а не всего экрана, и верхние кнопки/шапка рисуются под ними.
     Портал убирает эту зависимость целиком, как уже сделано для
     BottomSheet/ChatWindow и других полноэкранных оверлеев. */
  return createPortal((
    <motion.div
      initial={{ opacity:0, y:32 }}
      animate={{ opacity:1, y:0 }}
      exit={{ opacity:0, y:24 }}
      transition={{ type:'spring', stiffness:320, damping:32 }}
      className="fixed inset-0 z-[500] flex flex-col overflow-hidden"
      data-keep-dark
      style={{ fontFamily: "'Manrope','Nunito',system-ui,sans-serif" }}
    >
      {/* ── Background ───────────────────────────────────────── */}
      <div className="absolute inset-0" style={{
        background: `linear-gradient(145deg, ${hslDark(h)} 0%, ${hslDk2(h)} 55%, hsl(${(h+120)%360},30%,6%) 100%)`,
        transition: 'background 1.1s ease',
      }}/>
      {/* Видеофон трека (если владелец его добавил) — вместо статичного фона, затемнён */}
      <VideoBackdrop src={track.videoUrl} playing={playing} />
      {/* Glow */}
      <div className="absolute pointer-events-none" style={{
        top:'-10%', left:'15%', width:'70%', height:'55%', zIndex:1,
        background:`radial-gradient(ellipse, ${hslA(hslGlow(h),'50')} 0%, transparent 70%)`,
        filter:'blur(64px)', transition:'background 1.1s ease',
      }}/>
      {/* Grain */}
      <div className="absolute inset-0 opacity-[0.035] pointer-events-none" style={{
        backgroundImage:"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        backgroundSize:'200px 200px',
      }}/>

      {/* ── Top bar ──────────────────────────────────────────── */}
      <div className="relative z-10 flex items-center justify-between gap-2 px-4 pb-3 shrink-0 sm:px-6"
        style={{ paddingTop: 'calc(var(--safe-top) + 14px)' }}>
        <button type="button" onClick={onClose}
          className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/10"
          style={{ background:'rgba(255,255,255,0.07)', color:'rgba(255,255,255,0.65)', border:'1px solid rgba(255,255,255,0.1)', cursor:'pointer' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Назад
        </button>
        <div className="flex min-w-0 gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <button type="button" onClick={() => setBare(!bare)} aria-pressed={bare}
            className="shrink-0 whitespace-nowrap rounded-xl px-3.5 py-1.5 text-xs font-bold transition-colors"
            style={{
              background: bare ? `${hslA(hslAcc(h),'22')}` : 'rgba(255,255,255,0.06)',
              color: bare ? hslAcc(h) : 'rgba(255,255,255,0.5)',
              border: `1px solid ${bare ? hslA(hslAcc(h),'55') : 'rgba(255,255,255,0.1)'}`,
              cursor:'pointer',
            }}>{bare ? 'Показать текст' : 'Скрыть текст'}</button>
          {!bare && <>
          <button type="button"
            onClick={() => { setShowLyrics(v=>!v); setShowQueue(false); }}
            className="shrink-0 whitespace-nowrap rounded-xl px-3.5 py-1.5 text-xs font-bold transition-colors"
            style={{
              background: showLyrics&&!showQueue ? `${hslA(hslAcc(h),'22')}` : 'rgba(255,255,255,0.06)',
              color: showLyrics&&!showQueue ? hslAcc(h) : 'rgba(255,255,255,0.5)',
              border: `1px solid ${showLyrics&&!showQueue ? hslA(hslAcc(h),'55') : 'rgba(255,255,255,0.1)'}`,
              cursor:'pointer',
            }}>Текст</button>
          <button type="button"
            onClick={() => { setShowQueue(v=>!v); setShowLyrics(false); }}
            className="shrink-0 whitespace-nowrap rounded-xl px-3.5 py-1.5 text-xs font-bold transition-colors"
            style={{
              background: showQueue ? `${hslA(hslAcc(h),'22')}` : 'rgba(255,255,255,0.06)',
              color: showQueue ? hslAcc(h) : 'rgba(255,255,255,0.5)',
              border:`1px solid ${showQueue ? hslA(hslAcc(h),'55') : 'rgba(255,255,255,0.1)'}`,
              cursor:'pointer',
            }}>Очередь</button>
          <MusicContinue style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '6px 12px' }} className="inline-flex items-center" />
          </>}
        </div>
        <button type="button" onClick={() => onAdd(track.id)}
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"
          style={{ background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.6)', cursor:'pointer' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
          </svg>
        </button>
      </div>

      {/* ── Main layout ──────────────────────────────────────── */}
      <div className="relative z-10 flex flex-1 min-h-0 overflow-hidden gap-0">

        {/* LEFT: Cover + Controls */}
        {/* На телефоне панель «Текст/Очередь» — оверлей на всю область (absolute inset-0,
            zIndex 2) и целиком перехватывала касания: кнопки плеера под ней «не работали».
            Колонку с обложкой поднимаем над оверлеем, а сама колонка касаний не ловит
            (pointer-events: none), кроме обложки с кнопками и блока названия — так
            текст песни по-прежнему прокручивается там, где плеера нет. */}
        <div ref={ctlRef} className="flex flex-col items-center shrink-0"
          style={{
            // alignSelf: колонка не растягивается на всю высоту экрана — иначе её offsetHeight (а по нему считается низ окна
            // текста, `ctlH`) захватывал пустое место над названием, и окно текста обрывалось высоко над ним.
            ...(isMobile ? { position: 'relative', zIndex: 3, pointerEvents: 'none' as const, alignSelf: 'flex-end' } : {}),
            // Пока правится текст, карточка плеера не должна лежать поверх редактора.
            ...(editingLyrics ? { display: 'none' } : {}),
            width: !isMobile && (showQueue || showLyrics) ? '40%' : '100%',
            minWidth: 280, maxWidth: 480,
            padding: isMobile ? '8px 20px 4px' : '12px 24px 8px',
            justifyContent: isMobile ? 'flex-end' : 'center',
            paddingBottom: isMobile ? 'calc(var(--safe-bottom) + 22px)' : 8,
            transition:'width 0.3s ease',
          }}>

          {/* Track info */}
          <AnimatePresence mode="wait">
            {!bare && <motion.div key={track.id}
              initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}
              transition={{duration:0.3}}
              style={{textAlign:'center', marginBottom: isMobile ? 12 : 18, width:'100%'}}>
              <p className="font-black text-white" style={{
                fontSize: isMobile ? 17 : 20, letterSpacing:'-0.5px', margin:0, lineHeight:1.25,
                display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden',
              }}>
                {track.title}
              </p>
              <p className="font-semibold" style={{fontSize: isMobile ? 13 : 14, margin:'5px 0 0', color:hslAcc(h), overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                {track.artist}
              </p>
              {(track.uploadedBy || track.license) && (
                <div style={{marginTop:8, display:'flex', flexDirection:'column', alignItems:'center', gap:6, color:'rgba(255,255,255,0.7)'}}>
                  <LicenseBadge license={track.license} source={track.licenseSource}/>
                  <RightsholderNotice/>
                </div>
              )}
            </motion.div>}
          </AnimatePresence>

          {/* Cover with overlaid controls */}
          <div style={{position:'relative', width:'100%', maxWidth: isMobile ? 260 : 300, aspectRatio:'1', pointerEvents:'auto'}}>
            {/* Glow behind */}
            <div className="absolute pointer-events-none" style={{
              inset:-24, borderRadius:'50%',
              background:`radial-gradient(ellipse, ${hslA(hslGlow(h),'55')} 0%, transparent 65%)`,
              filter:'blur(28px)', zIndex:0,
            }}/>
            <AnimatePresence mode="wait">
              <motion.div key={track.id}
                initial={{scale:0.88,opacity:0,rotate:-4}}
                animate={{scale:1,opacity:1,rotate:0}}
                exit={{scale:0.92,opacity:0,rotate:3}}
                transition={{type:'spring',stiffness:240,damping:22}}
                style={{
                  position:'relative',zIndex:1,
                  borderRadius:22,overflow:'hidden',
                  boxShadow:`0 36px 80px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.07), 0 10px 40px ${hslA(hslGlow(h),'55')}`,
                  width:'100%', aspectRatio:'1',
                }}>
                {/* Cover art */}
                {track.coverUrl
                  ? <img src={track.coverUrl} alt="" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                  : (
                    <div style={{
                      width:'100%',height:'100%',
                      background:`linear-gradient(135deg,${c1},${c2})`,
                      display:'flex',alignItems:'center',justifyContent:'center',
                    }}>
                      <Music2 size={72} color="rgba(255,255,255,0.2)"/>
                    </div>
                  )
                }

                {/* Controls overlay */}
                <div style={{
                  position:'absolute',inset:0,
                  background:'linear-gradient(to bottom, rgba(0,0,0,0.02) 30%, rgba(0,0,0,0.72) 100%)',
                  display:'flex',flexDirection:'column',justifyContent:'space-between',
                  padding:14,
                }}>
                  {/* Top: like + add */}
                  <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
                    <button type="button" onClick={() => onLike(track.id)} style={{
                      width:36,height:36,borderRadius:'50%',display:'grid',placeItems:'center',
                      background:'rgba(0,0,0,0.38)',backdropFilter:'blur(8px)',
                      border:'1px solid rgba(255,255,255,0.12)',cursor:'pointer',
                      color: isFav ? '#f43f5e' : 'rgba(255,255,255,0.75)',
                    }}>
                      <Heart size={16} fill={isFav?'currentColor':'none'}/>
                    </button>
                  </div>

                  {/* Center: prev/play/next */}
                  <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:18}}>
                    <motion.button whileTap={{scale:0.88}} type="button" onClick={onPrev} style={{
                      width:46,height:46,borderRadius:'50%',display:'grid',placeItems:'center',
                      background:'rgba(0,0,0,0.42)',backdropFilter:'blur(8px)',
                      border:'1px solid rgba(255,255,255,0.14)',cursor:'pointer',
                      color:'rgba(255,255,255,0.85)',
                    }}>
                      <SkipForward size={18} style={{transform:'scaleX(-1)'}}/>
                    </motion.button>

                    <motion.button whileTap={{scale:0.88}} type="button" onClick={onPlay} style={{
                      width:62,height:62,borderRadius:'50%',display:'grid',placeItems:'center',
                      background:`linear-gradient(135deg,${hslAcc(h)},${hslMid(h)})`,
                      border:'none',cursor:'pointer',
                      boxShadow:`0 6px 30px ${hslA(hslGlow(h),'80')}`,
                    }}>
                      {playing
                        ? <Pause size={24} color="white"/>
                        : <Play  size={24} color="white" style={{marginLeft:2}}/>
                      }
                    </motion.button>

                    <motion.button whileTap={{scale:0.88}} type="button" onClick={onNext} style={{
                      width:46,height:46,borderRadius:'50%',display:'grid',placeItems:'center',
                      background:'rgba(0,0,0,0.42)',backdropFilter:'blur(8px)',
                      border:'1px solid rgba(255,255,255,0.14)',cursor:'pointer',
                      color:'rgba(255,255,255,0.85)',
                    }}>
                      <SkipForward size={18}/>
                    </motion.button>
                  </div>

                  {/* Bottom: repeat + shuffle */}
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <button type="button" onClick={onRepeat} style={{
                      background:'none',border:'none',cursor:'pointer',padding:4,
                      color: repeat==='off' ? 'rgba(255,255,255,0.38)' : hslAcc(h),
                      display:'flex',alignItems:'center',gap:3,
                    }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                        <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                      </svg>
                      {repeat==='one' && <span style={{fontSize:10,fontWeight:800}}>1</span>}
                    </button>
                    <button type="button" onClick={onShuffle} style={{
                      background:'none',border:'none',cursor:'pointer',padding:4,
                      color: shuffle ? hslAcc(h) : 'rgba(255,255,255,0.38)',
                    }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
                        <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
                        <line x1="4" y1="4" x2="9" y2="9"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Progress */}
          <div style={{width:'100%',maxWidth:300,marginTop:18,padding:'0 2px',pointerEvents:'auto'}}>
            <div
              onClick={handleSeekClick}
              onMouseDown={()=>setSeeking(true)}
              onMouseUp={e=>{setSeeking(false);handleSeekClick(e);}}
              style={{height:32,display:'flex',alignItems:'center',cursor:'pointer'}}>
              <div style={{
                width:'100%',height:4,borderRadius:2,
                background:'rgba(255,255,255,0.12)',position:'relative',overflow:'hidden',
              }}>
                <motion.div
                  style={{
                    height:'100%',borderRadius:2,
                    background:`linear-gradient(90deg,${hslAcc(h)},${hslMid((h+30)%360)})`,
                    boxShadow:`0 0 10px ${hslGlow(h)}`,
                    width:`${pct}%`,
                  }}
                  transition={{duration:0.12}}
                />
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',marginTop:1}}>
              <span style={{fontSize:11,color:'rgba(255,255,255,0.4)',fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{fmt(currentTime)}</span>
              <span style={{fontSize:11,color:'rgba(255,255,255,0.4)',fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{fmt(duration)}</span>
            </div>
          </div>

          {/* Volume */}
          <div style={{pointerEvents:'auto',
            display:'flex',alignItems:'center',gap:10,marginTop:10,
            width:'100%',maxWidth:300,padding:'0 2px',
          }}>
            <button type="button" onClick={()=>setMuted(v=>!v)} style={{
              background:'none',border:'none',cursor:'pointer',color:'rgba(255,255,255,0.4)',padding:2,
            }}><VolumeIcon v={effVol}/></button>
            <div
              onClick={e=>{
                const r=e.currentTarget.getBoundingClientRect();
                onVolume(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)));
                setMuted(false);
              }}
              style={{flex:1,height:24,display:'flex',alignItems:'center',cursor:'pointer'}}>
              <div style={{width:'100%',height:3,borderRadius:2,background:'rgba(255,255,255,0.1)',overflow:'hidden'}}>
                <div style={{height:'100%',borderRadius:2,background:'rgba(255,255,255,0.4)',width:`${effVol*100}%`}}/>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Lyrics / Queue — на мобильном не отдельная колонка (там ей
            попросту негде помещаться), а оверлей поверх обложки, поверх
            уже отрисованных кнопок шапки (у него меньший z-index и он не
            перекрывает их, а верхний отступ оставляет их кликабельными). */}
        <AnimatePresence mode="wait">
          {(showLyrics || showQueue) && (
            <motion.div key={showQueue?'queue':'lyrics'}
              initial={isMobile ? {opacity:0,y:16} : {opacity:0,x:20}}
              animate={isMobile ? {opacity:1,y:0} : {opacity:1,x:0}}
              exit={isMobile ? {opacity:0,y:12} : {opacity:0,x:16}}
              transition={{duration:0.25}}
              style={isMobile ? {
                position:'absolute', top:0, left:0, right:0, bottom: ctlH, zIndex:2,
                background:`linear-gradient(180deg, ${hslA(hslDk2(h),'f2')} 0%, ${hslA(hslDark(h),'f5')} 100%)`,
                display:'flex', flexDirection:'column',
                padding:'64px 20px 12px', overflow:'hidden',
              } : {
                flex:1,minWidth:0,display:'flex',flexDirection:'column',
                padding:'0 28px 20px 8px',overflow:'hidden',
              }}>

              {showQueue ? (
                // ── Queue ──
                <>
                  <p style={{color:'rgba(255,255,255,0.32)',fontSize:11,fontWeight:800,letterSpacing:'1.5px',textTransform:'uppercase',marginBottom:14}}>
                    Очередь · {queue.length} треков
                  </p>
                  <div style={{flex:1,overflowY:'auto',scrollbarWidth:'none'}}>
                    {queue.map((t,i) => {
                      const th = getHue(t.id);
                      const [tc1,tc2] = getG(t.id);
                      const isActive = i === queueIdx;
                      return (
                        <motion.div key={t.id} whileHover={{x:4}}
                          style={{
                            display:'flex',alignItems:'center',gap:14,padding:'10px 12px',
                            borderRadius:14,marginBottom:4,cursor:'pointer',
                            background: isActive ? `${hslA(hslAcc(th),'18')}` : 'transparent',
                            border:`1px solid ${isActive ? hslA(hslAcc(th),'40') : 'transparent'}`,
                          }}>
                          <div style={{width:44,height:44,borderRadius:10,overflow:'hidden',flexShrink:0,
                            boxShadow:isActive?`0 4px 16px ${hslA(hslGlow(th),'55')}`:'none',
                            background: t.coverUrl?undefined:`linear-gradient(135deg,${tc1},${tc2})`,
                            position:'relative',display:'grid',placeItems:'center',
                          }}>
                            {t.coverUrl?<img src={t.coverUrl} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                              :<Music2 size={18} color="rgba(255,255,255,0.3)"/>}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <p style={{color:isActive?'white':'rgba(255,255,255,0.72)',fontWeight:isActive?700:500,fontSize:14,margin:0,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{t.title}<ExplicitBadge show={t.explicit} /></p>
                            <p style={{color:isActive?hslAcc(th):'rgba(255,255,255,0.38)',fontSize:12,margin:'3px 0 0'}}>{t.artist}</p>
                          </div>
                          <span style={{fontSize:12,color:'rgba(255,255,255,0.28)',fontVariantNumeric:'tabular-nums',flexShrink:0}}>
                            {t.duration || '0:00'}
                          </span>
                          {isActive && playing && (
                            <div style={{display:'flex',gap:2,alignItems:'flex-end',height:16,flexShrink:0}}>
                              {[0,1,2].map(j=>(
                                <div key={j} style={{
                                  width:3,borderRadius:2,background:hslAcc(th),
                                  height:4+j*4,
                                  animation:`skyEqBar ${0.6+j*0.15}s ease-in-out infinite alternate`,
                                }}/>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                </>
              ) : (
                // ── Lyrics ──
                <>
                  <div style={{marginBottom:14, display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12}}>
                    <div>
                      <p style={{color:'rgba(255,255,255,0.28)',fontSize:11,fontWeight:800,letterSpacing:'1.5px',textTransform:'uppercase',margin:0}}>
                        Текст песни
                      </p>
                      <p style={{color:hslAcc(h),fontSize:13,fontWeight:600,margin:'4px 0 0'}}>
                        {track.title} — {track.artist}
                      </p>
                    </div>
                    {/* Добавить/поправить текст может только владелец
                        трека — сервер решает через canEdit, не клиент. */}
                    {lyricsCanEdit && !editingLyrics && (
                      <button type="button" onClick={openLyricsEditor}
                        className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold"
                        style={{ background:`${hslA(hslAcc(h),'22')}`, color:hslAcc(h), border:`1px solid ${hslA(hslAcc(h),'55')}`, cursor:'pointer' }}>
                        {lyricsRaw ? 'Изменить' : '+ Добавить текст'}
                      </button>
                    )}
                  </div>

                  {editingLyrics ? (
                    <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0,gap:10}}>
                      <textarea value={lyricsDraft} onChange={e=>setLyricsDraft(e.target.value)}
                        placeholder="Каждая строка — отдельный фрагмент. Можно с тайм-кодами вида [мм:сс]."
                        style={{
                          flex:1,minHeight:120,resize:'none',outline:'none',
                          background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.12)',
                          borderRadius:14,padding:'10px 12px',color:'white',fontSize:14,lineHeight:1.5,
                        }} />
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <span style={{fontSize:12,color:'rgba(255,255,255,0.7)'}}>Строка висит</span>
                        <input value={holdSec} onChange={e=>setHoldSec(e.target.value.replace(/[^\d.]/g,'').slice(0,5))} inputMode="decimal"
                          aria-label="Секунд на строку"
                          style={{width:56,borderRadius:10,padding:'6px 8px',background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.15)',color:'white',fontSize:13,outline:'none'}} />
                        <span style={{fontSize:12,color:'rgba(255,255,255,0.7)'}}>сек</span>
                        <button type="button" onClick={()=>setLyricsDraft(d=>tagLyrics(d, Math.max(0.5, Number(holdSec) || 4)))}
                          className="rounded-xl px-3 py-1.5 text-xs font-bold"
                          style={{background:'rgba(255,255,255,0.1)',color:'white',border:'1px solid rgba(255,255,255,0.15)',cursor:'pointer'}}>Расставить</button>
                        <button type="button" onClick={()=>setLyricsDraft(d=>tagLyrics(d, 0))}
                          className="rounded-xl px-3 py-1.5 text-xs font-bold"
                          style={{background:'rgba(255,255,255,0.1)',color:'white',border:'1px solid rgba(255,255,255,0.15)',cursor:'pointer'}}>По всей песне</button>
                      </div>
                      <p style={{fontSize:11,lineHeight:1.4,color:'rgba(255,255,255,0.5)',margin:0}}>
                        Метку времени [мм:сс] у любой строки можно поправить вручную — так задаётся, сколько она висит.
                      </p>
                      <div style={{display:'flex',gap:8}}>
                        <button type="button" disabled={savingLyrics} onClick={() => void saveLyrics()}
                          className="rounded-xl px-4 py-2 text-xs font-bold"
                          style={{ background:hslAcc(h), color:'#0a0a10', border:'none', cursor:'pointer', opacity:savingLyrics?0.6:1 }}>
                          {savingLyrics ? 'Сохраняем…' : 'Сохранить'}
                        </button>
                        <button type="button" onClick={()=>setEditingLyrics(false)}
                          className="rounded-xl px-4 py-2 text-xs font-bold"
                          style={{ background:'rgba(255,255,255,0.06)', color:'rgba(255,255,255,0.6)', border:'1px solid rgba(255,255,255,0.1)', cursor:'pointer' }}>
                          Отмена
                        </button>
                      </div>
                    </div>
                  ) : lyrics.filter(l=>l.text).length === 0 ? (
                    <p style={{color:'rgba(255,255,255,0.3)',fontSize:14,lineHeight:1.5}}>
                      {lyricsCanEdit ? 'Текста пока нет — добавьте его кнопкой выше.' : 'Текст песни ещё не добавлен.'}
                    </p>
                  ) : (
                  <div ref={lyricsRef}
                    style={{flex:1,overflowY:'auto',scrollbarWidth:'none',paddingRight:4,paddingBottom:48}}>
                    {lyrics.filter(l=>l.text).map((line,i) => {
                      const isActive = i === activeLyric && line.text !== '...';
                      const isPast   = lyricsTimed && line.t < currentTime;
                      return (
                        <div key={i}
                          ref={el=>lyricItems.current[i]=el}
                          onClick={()=>{ if (lyricsTimed) onSeek(line.t); }}
                          style={{padding:isActive?'6px 0':'2px 0',cursor:lyricsTimed?'pointer':'default'}}>
                          <p style={{
                            fontSize: isMobile ? (isActive ? 21 : 16) : (isActive ? 28 : 20),
                            fontWeight: isActive ? 800 : isPast ? 500 : 400,
                            color: isActive ? 'white' : !lyricsTimed ? 'rgba(255,255,255,0.85)' : isPast ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.5)',
                            lineHeight:1.3, margin:0,
                            letterSpacing: isActive?'-0.4px':'0',
                            transition:'all 0.3s ease',
                            textShadow: isActive?`0 0 32px ${hslA(hslAcc(h),'90')}`:'none',
                          }}>
                            {line.text==='...'
                              ? <span style={{letterSpacing:5,opacity:0.35}}>···</span>
                              : line.text}
                          </p>
                          {isActive && (
                            <motion.div layoutId="sky-lyric-line"
                              style={{
                                height:2,width:36,borderRadius:2,marginTop:5,
                                background:`linear-gradient(90deg,${hslAcc(h)},transparent)`,
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes skyEqBar {
          from { transform: scaleY(0.35); }
          to   { transform: scaleY(1.5); }
        }
      `}</style>
    </motion.div>
  ), document.body);
};


/* ═══════════════════════════════════════════════════════════
   MUSIC BG  — animated gradient canvas behind SkyMusic
   • 4 soft orbs, each drifts on a Lissajous path
   • Orb colours shift toward current track palette
   • Pure canvas + RAF → GPU compositing, 0 extra DOM nodes
═══════════════════════════════════════════════════════════ */
const MusicBg = ({ trackColor1 = '#4f46e5', trackColor2 = '#7c3aed' }: {
  trackColor1?: string; trackColor2?: string;
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const rafRef    = React.useRef<number>(0);
  const tRef      = React.useRef(0);

  /* parse hex → [r,g,b] */
  const hex2rgb = (h: string): [number,number,number] => {
    const s = h.replace('#','');
    const n = parseInt(s.length === 3 ? s.split('').map(c=>c+c).join('') : s, 16);
    return [(n>>16)&255,(n>>8)&255,n&255];
  };

  /* lerp two [r,g,b] */
  const lerpRgb = (a:[number,number,number], b:[number,number,number], t:number):[number,number,number] =>
    [Math.round(a[0]+(b[0]-a[0])*t), Math.round(a[1]+(b[1]-a[1])*t), Math.round(a[2]+(b[2]-a[2])*t)];

  const targetRef = React.useRef({ c1: hex2rgb(trackColor1), c2: hex2rgb(trackColor2) });
  const currentRef = React.useRef({ c1: hex2rgb('#4f46e5'), c2: hex2rgb('#7c3aed') });

  /* update target when track changes */
  React.useEffect(() => {
    try {
      targetRef.current = { c1: hex2rgb(trackColor1), c2: hex2rgb(trackColor2) };
    } catch {}
  }, [trackColor1, trackColor2]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Фон — размытые градиенты: в полном разрешении экрана (на телефоне это
    // втрое по каждой оси) он перерисовывался 60 раз в секунду и съедал
    // процессор. Холст в половину css-пикселя выглядит так же и в ~36 раз
    // дешевле на экране телефона.
    const pr = 0.5;
    let cw = canvas.offsetWidth;
    let ch = canvas.offsetHeight;
    const resize = () => {
      cw = canvas.offsetWidth;
      ch = canvas.offsetHeight;
      canvas.width  = Math.max(1, Math.round(cw * pr));
      canvas.height = Math.max(1, Math.round(ch * pr));
      ctx.scale(pr, pr);
    };
    resize();

    /* 4 orbs — each has Lissajous params for natural drift */
    const ORBS = [
      { ax:0.62, ay:0.55, fx:0.28, fy:0.22, px:0.0,  py:1.1,  size:0.68, col:0 },
      { ax:0.45, ay:0.60, fx:0.19, fy:0.31, px:2.1,  py:0.4,  size:0.55, col:1 },
      { ax:0.55, ay:0.40, fx:0.23, fy:0.17, px:1.0,  py:2.4,  size:0.50, col:0 },
      { ax:0.35, ay:0.50, fx:0.15, fy:0.26, px:3.2,  py:1.8,  size:0.42, col:1 },
    ];

    let lastFrame = 0;
    const draw = (now = 0) => {
      rafRef.current = requestAnimationFrame(draw);
      // ~20 кадров в секунду хватает для медленного дрейфа, а во вкладке
      // в фоне рисовать нечего.
      if (document.hidden || now - lastFrame < 50) return;
      const dt = lastFrame ? Math.min(now - lastFrame, 200) : 50;
      lastFrame = now;
      const w  = cw;
      const h  = ch;
      tRef.current += 0.004 * (dt / 16.7);
      const t = tRef.current;

      /* slowly lerp current colours toward target */
      const sp = 0.008;
      currentRef.current.c1 = lerpRgb(currentRef.current.c1, targetRef.current.c1, sp);
      currentRef.current.c2 = lerpRgb(currentRef.current.c2, targetRef.current.c2, sp);

      ctx.clearRect(0, 0, w, h);

      /* dark base */
      ctx.fillStyle = '#080810';
      ctx.fillRect(0, 0, w, h);

      /* draw orbs */
      for (const o of ORBS) {
        const cx = w * (0.5 + o.ax * Math.sin(o.fx * t + o.px));
        const cy = h * (0.5 + o.ay * Math.sin(o.fy * t + o.py));
        const r  = Math.max(w, h) * o.size;

        const [rr,gg,bb] = o.col === 0 ? currentRef.current.c1 : currentRef.current.c2;

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0,   `rgba(${rr},${gg},${bb},0.18)`);
        grad.addColorStop(0.4, `rgba(${rr},${gg},${bb},0.07)`);
        grad.addColorStop(1,   `rgba(${rr},${gg},${bb},0)`);

        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.75, t * 0.05, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      /* subtle grain overlay for "depth" */
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, 0, w, h);
    };

    const ro = new ResizeObserver(() => { resize(); });
    ro.observe(canvas);
    rafRef.current = requestAnimationFrame(draw);

    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);

  // zIndex: -1, а не 0 — и это не косметика.
  //
  // Холст спозиционирован (absolute), а заголовки разделов и подписи —
  // обычный поток. По порядку отрисовки CSS позиционированные потомки
  // рисуются ПОВЕРХ обычного содержимого, поэтому при zIndex: 0 холст
  // закрашивал собой весь текст: он оставался в разметке, кликался и
  // читался программой чтения с экрана, но его не было видно.
  // Карточки при этом оставались видны — им framer-motion выставляет
  // transform, а это поднимает их в тот же слой, что и холст.
  //
  // Отрицательный z-index кладёт холст между фоном родителя и обычным
  // потоком: фон виден, текст поверх него. Родителю нужен isolate,
  // иначе холст ушёл бы искать ближайший контекст наложения выше и мог
  // спрятаться за непрозрачным фоном экрана целиком.
  return (
    <canvas ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: -1 }}/>
  );
};

export const SkyMusic = () => {
  // Музыка приходит с сервера. Плеер это не касается: ему по-прежнему
  // отдаётся srcUrl, просто теперь он указывает на наш поток, а не на
  // blob из памяти устройства.
  const tracks = useMusicStore(st => st.tracks);
  const favorites = useMusicStore(st => st.favorites);
  const musicLoading = useMusicStore(st => st.loading);
  const musicError = useMusicStore(st => st.error);
  const loadMusic = useMusicStore(st => st.load);
  const toggleFavorite = useMusicStore(st => st.toggleFavorite);
  const notePlay = useMusicStore(st => st.notePlay);
  const toggleLike = usePlatformStore(st => st.toggleLike);
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const isPrime = me?.isPrime ?? false;
  // Высота нижней панели: мини-плеер встаёт над ней.
  const navRef = React.useRef<HTMLElement | HTMLDivElement>(null);
  const [navH, setNavH] = React.useState(0);
  React.useEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setNavH(el.offsetHeight));
    ro.observe(el); setNavH(el.offsetHeight);
    return () => ro.disconnect();
  }, [isPrime]);
  const uid = currentUserId ?? '';
  const isMobile = useIsMobile();

  /* -- Audio engine -----------------------------------------
     Реальный <audio> живёт в PlayerEngine (смонтирован в AppShell
     постоянно), поэтому переключение вкладок больше не обрывает звук.
     Здесь мы просто читаем/пишем в общий usePlayerStore. */
  const gItem      = usePlayerStore(s => s.item);
  const gHidden    = usePlayerStore(s => s.hidden);
  const gHide      = usePlayerStore(s => s.hide);
  const playing    = usePlayerStore(s => s.isPlaying);
  const curTime    = usePlayerStore(s => s.currentTime);
  const durTime    = usePlayerStore(s => s.duration);
  const volume     = usePlayerStore(s => s.volume);
  const shuffle    = usePlayerStore(s => s.shuffle);
  const repeat     = usePlayerStore(s => s.repeat) as RepeatMode;
  const pushToPlayer     = usePlayerStore(s => s.push);
  const requestSeek      = usePlayerStore(s => s.requestSeek);
  const setPlaying       = usePlayerStore(s => s.setPlaying);
  const setVolume        = usePlayerStore(s => s.setVolume);
  const setShuffle       = usePlayerStore(s => s.setShuffle);
  const setRepeatG       = usePlayerStore(s => s.setRepeat);
  const globalNext       = usePlayerStore(s => s.nextTrack);
  const globalPrev       = usePlayerStore(s => s.prevTrack);
  const setRepeat = useCallback((v: RepeatMode) => setRepeatG(v), [setRepeatG]);

  // Восстанавливаем очередь как Track[] из глобального стора —
  // работает даже сразу после возврата на вкладку (стор пережил размонтирование)
  const queue: Track[] = useMemo(() => {
    if (gItem?.kind !== 'music' || !gItem.queue) return [];
    return gItem.queue.map(q => tracks.find(t => t.id === q.id)).filter((t): t is Track => !!t);
  }, [gItem?.queue, gItem?.kind, tracks]);
  const qIdx = gItem?.kind === 'music' ? (gItem.qIdx ?? 0) : 0;
  const cur = queue[qIdx] ?? null;

  const seek = useCallback((v: number) => { requestSeek(v); }, [requestSeek]);
  const skipNext = useCallback(() => { globalNext(); }, [globalNext]);
  const skipPrev = useCallback(() => { globalPrev(); }, [globalPrev]);

  const playFrom = useCallback((t: Track, pool: Track[]) => {
    const i = pool.findIndex(x => x.id === t.id); if (i < 0) return;
    // Текст подтянется отдельно, с сервера: класть в плеер выдуманные
    // строки только ради заполненного экрана — нечестно.
    const lyrics = t.syncedLyrics && t.syncedLyrics.length > 0 ? t.syncedLyrics : [];
    pushToPlayer({
      id: t.id, kind: 'music', title: t.title, author: t.artist ?? '', explicit: t.explicit, legacy: t.legacy,
      coverUrl: t.coverUrl, videoUrl: t.videoUrl, hue: parseInt(t.id, 36) % 360,
      srcUrl: t.sourceUrl, duration: 0, lyrics,
      queue: pool.map(p => ({
        id: p.id, kind: 'music' as const, title: p.title, author: p.artist ?? '', explicit: p.explicit, legacy: p.legacy,
        coverUrl: p.coverUrl, videoUrl: p.videoUrl, hue: parseInt(p.id, 36) % 360, srcUrl: p.sourceUrl,
      })),
      qIdx: i,
    });
    // История и счётчик — на сервере: они должны быть одинаковыми на
    // всех устройствах, а не лежать в этом браузере.
    void notePlay(t.id);
  }, [pushToPlayer, notePlay]);

  const onLike = useCallback((id: string) => {
    void toggleFavorite(id);
    toggleLike(id, uid);
  }, [uid, toggleFavorite, toggleLike]);

  // Первая загрузка каталога. Повторные заходы на вкладку ничего не
  // перезапрашивают: store помнит, что уже загрузился.
  useEffect(() => { void loadMusic(); }, [loadMusic]);

  // Где человек остановился — на сервер, чтобы продолжить с другого
  // устройства. Само сохранение придерживает частоту внутри store:
  // сюда время приходит по нескольку раз в секунду.
  const saveProgress = useMusicStore(st => st.saveProgress);
  const progressMap = useMusicStore(st => st.progress);

  // ...и обратно: когда трек начинает играть, возвращаемся туда, где
  // человек его бросил. Сохранять позицию и не пользоваться ею —
  // половина дела. Один раз на трек: дальше он играет как обычно.
  const restoredRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!cur?.id || durTime <= 0) return;
    if (restoredRef.current === cur.id) return;
    restoredRef.current = cur.id;
    // Зашли на вкладку, пока трек уже играет, — перематывать нельзя: сохранённая позиция
    // на сервере старее живой, и трек «включался заново». Возвращаемся только на старте.
    if (curTime > 3) return;
    const at = progressMap[cur.id] ?? 0;
    // Совсем начало и самый хвост не восстанавливаем: в первом случае
    // возвращать некуда, во втором человек трек уже дослушал.
    if (at > 5 && at < durTime - 10) seek(at);
  }, [cur?.id, durTime, progressMap, seek]);
  useEffect(() => {
    if (!cur?.id || !playing || curTime <= 0) return;
    saveProgress(cur.id, curTime);
  }, [cur?.id, playing, curTime, saveProgress]);

  /* -- UI ------------------------------------------------- */
  const [tab,      setTab]      = useState<TabKey>('home');
  const [showNP,   setShowNP]   = useState(false);
  const [artist,   setArtist]   = useState<string | null>(null);
  const [addModal, setAddModal] = useState<string | null>(null);
  const [search,   setSearch]   = useState('');
  const [showEq,   setShowEq]    = useState(false);
  const [showSrch, setShowSrch] = useState(false);

  const pub = useMemo(() => tracks.filter(t => t.status === 'published'), [tracks]);
  const searchRes = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return [];
    return pub.filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.genre.toLowerCase().includes(q));
  }, [search, pub]);

  const tabProps = { tracks, favorites, playing, activeId: cur?.id ?? null, onPlay: playFrom, onLike, onAdd: (id: string) => setAddModal(id), onArtist: setArtist };

  /* colours for animated bg — change with current track */
  const [bgC1, bgC2] = cur ? getG(cur.id) : ['#4f46e5', '#7c3aed'];

  /* Sky Music входит в подписку. Экран — только вежливость: доступ к
     каталогу и файлам закрывает сервер, и переписанный клиент ничего
     этим не добьётся. Администратор проходит без подписки: ему
     разбирать заявки на публикацию. */
  if (!isPrime && !(me?.isAdmin ?? false)) {
    return (
      <div className="relative flex h-full flex-col overflow-hidden"
        style={{ background: YM.bg, isolation: 'isolate' }}>
        <PrimeGate service="music"/>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden"
      style={{ background: YM.bg, isolation: 'isolate' }}>
      {/* ── Animated gradient bg ── */}
      <MusicBg trackColor1={bgC1} trackColor2={bgC2}/>

      {/* -- Header ------------------------------------------- */}
      <header className={isMobile ? 'shrink-0 flex items-center justify-between px-3 pt-3 pb-1.5' : 'shrink-0 flex items-center justify-between px-4 pt-4 pb-2'}
        style={{ background: YM.bg }}>
        <h1 className={isMobile ? 'text-[15px] font-bold' : 'text-lg font-bold'} style={{ color: YM.text }}>
          {tab === 'home' ? 'Sky Music' : tab === 'collection' ? 'Коллекция' : tab === 'charts' ? 'Чарты' : tab === 'upload' ? 'Загрузить' : tab === 'import' ? 'Перенос музыки' : tab === 'musician' ? 'Профиль артиста' : 'История'}
        </h1>
        <div className="flex items-center">
        <button type="button" aria-label="Звук и эквалайзер" onClick={() => setShowEq(true)}
          className={isMobile ? 'grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-white/10 shrink-0' : 'grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-white/10 shrink-0'}
          style={{ color: YM.sub }}>
          <SlidersHorizontal size={isMobile ? 15 : 18} />
        </button>
        {tab !== 'home' && (
        <button type="button"
          onClick={() => setShowSrch(true)}
          className={isMobile ? 'ml-2 grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-white/10 shrink-0' : 'ml-2 grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-white/10 shrink-0'}
          style={{ color: YM.sub }}>
          <Search size={isMobile ? 15 : 18} />
        </button>
        )}
        </div>
      </header>
      {showEq && <EqualizerDialog onClose={() => setShowEq(false)} />}

      {showSrch && (
        <SkyMusicSearch tracks={tracks} favorites={favorites} playing={playing} activeId={cur?.id ?? null}
          onPlay={(t, pool) => { playFrom(t, pool); setShowSrch(false); }}
          onLike={onLike} onArtist={a => { setArtist(a); setShowSrch(false); }}
          onClose={() => { setShowSrch(false); setSearch(''); }}/>
      )}

      {/* -- Content ------------------------------------------ */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0"
        style={{ paddingBottom: cur && !showNP && !gHidden ? 64 : 0 }}>
        {(
          <>
            {tab === 'home'       && <SkyMusicHome tracks={tracks} favorites={favorites} playing={playing} activeId={cur?.id ?? null} onPlay={playFrom}
              cur={cur} onTogglePlay={() => setPlaying(!playing)} onLike={onLike} onOpenPlayer={() => setShowNP(true)} onArtist={setArtist}
              loading={musicLoading} error={musicError}
              onRetry={() => void loadMusic({ force: true })} onUpload={() => setTab('upload')} onSearch={() => setShowSrch(true)}/>}
            {tab === 'collection' && <SkyMusicLibrary tracks={tracks} favorites={favorites} playing={playing} activeId={cur?.id ?? null} onPlay={playFrom} onLike={onLike}
              onArtist={setArtist} onOpenUpload={() => setTab('upload')} onOpenImport={() => setTab('import')}/>}
            {tab === 'charts'     && <ChartsTab     {...tabProps} />}
            {tab === 'upload'     && <UploadTab     playing={playing} activeId={cur?.id ?? null} onPlay={playFrom} />}
            {tab === 'import'     && <MusicImport/>}
            {tab === 'history'    && <HistTab       {...tabProps} />}
            {tab === 'musician'   && <MusicianProfileTab playing={playing} activeId={cur?.id ?? null} onPlay={playFrom}/>}
          </>
        )}
      </div>

      {/* -- Bottom nav --------------------------------------- */}
      <div ref={navRef as React.RefObject<HTMLDivElement>} className="shrink-0 px-3 pb-2 pt-1" style={{ background: YM.bg, position: 'relative', zIndex: 1 }}>
      <nav className="glass-pill flex items-center justify-around" style={{ minHeight: isMobile ? 50 : 56 }}>
        {NAV_TABS.map(({ key, icon: Icon, label }) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`relative isolate flex flex-1 flex-col items-center gap-0.5 rounded-full transition-colors ${isMobile ? 'px-2 py-1.5' : 'px-3 py-2'}`}
            style={{ color: tab === key ? YM.accent : YM.sub2 }}>
            {tab === key && <motion.span layoutId="music-nav-lens" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="glass-lens absolute inset-0 -z-10" />}
            <Icon size={isMobile ? 17 : 20} />
            <span className="text-[8.5px] font-medium">{label}</span>
          </button>
        ))}
      </nav>
      </div>

      {/* -- Mini player -------------------------------------- */}
      {/* Внутри самой музыки всегда показываем полноценный (тот же, что на десктопе)
          MiniBar — с лайком, таймером и т.д. Глобальный MobileMiniPlayer в это время
          скрыт (см. MobileShell.tsx), чтобы не было двух плееров разом. */}
      <AnimatePresence>
        {cur && !showNP && !gHidden && (
          <MiniBar bottom={navH} track={cur} onHide={gHide} playing={playing} cur={curTime} dur={durTime}
            liked={favorites.includes(cur.id)}
            onPlay={() => setPlaying(!playing)} onNext={skipNext} onOpen={() => setShowNP(true)}
            onLike={() => onLike(cur.id)} />
        )}
      </AnimatePresence>

      {/* -- Fullscreen player -------------------------------- */}
      <AnimatePresence>
        {cur && showNP && (
          <SkyFullPlayer
            track={cur} playing={playing} currentTime={curTime} duration={durTime}
            volume={volume} shuffle={shuffle} repeat={repeat}
            favorites={favorites} queue={queue} queueIdx={qIdx}
            onPlay={() => setPlaying(!playing)} onPrev={skipPrev} onNext={skipNext}
            onSeek={seek} onVolume={setVolume}
            onShuffle={() => setShuffle(!shuffle)}
            onRepeat={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}
            onLike={onLike} onAdd={id => setAddModal(id)}
            onClose={() => setShowNP(false)} />
        )}
      </AnimatePresence>

      {/* -- Artist profile ----------------------------------- */}
      <AnimatePresence>
        {artist && (
          <ArtistProfile artist={artist} tracks={tracks} favorites={favorites}
            playing={playing} activeId={cur?.id ?? null}
            onPlay={playFrom} onLike={onLike} onAdd={id => setAddModal(id)}
            onArtist={setArtist} onClose={() => setArtist(null)} />
        )}
      

      <AddToPlaylistModal trackId={addModal} onClose={() => setAddModal(null)} />
      </AnimatePresence>
    </div>
  );
};
