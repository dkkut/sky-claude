import { useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Heart, Upload, X, Cloud, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { usePlayerStore } from '@/player/playerStore';
import { useOpenSoundStore, type OpenTrack, type SoundLicense } from './openSoundStore';
import { ACCEPT_AUDIO } from '@/shared/fileAccept';

const ORANGE = '#ff5500'; // фирменный акцент SoundCloud-стиля

/* Псевдо-waveform — стабильный набор "случайных" полосок на основе id трека,
   чтобы каждая карточка выглядела как настоящая дорожка, а не одинаковый блок. */
const waveBars = (seed: string) => {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length: 46 }, () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return 18 + (h % 100) * 0.6;
  });
};

const TrackCard = ({ track, isActive, isPlaying, onPlay, onLike, liked }: {
  track: OpenTrack; isActive: boolean; isPlaying: boolean;
  onPlay: () => void; onLike: () => void; liked: boolean;
}) => {
  const bars = useMemo(() => waveBars(track.id), [track.id]);
  return (
    <div className="rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={onPlay}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl"
          style={{ background: isActive ? ORANGE : 'var(--bg-l2)', color: isActive ? '#fff' : 'var(--t2)' }}>
          {isActive && isPlaying ? <Pause size={18}/> : <Play size={18} style={{ marginLeft: 2 }}/>}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13.5px] font-semibold" style={{ color: 'var(--t1)' }}>{track.title}</p>
            {track.ageRestricted && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-black" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>18+</span>
            )}
          </div>
          <p className="truncate text-[11.5px]" style={{ color: 'var(--t3)' }}>{track.artist} · загрузил {track.uploaderName}</p>

          <div className="mt-2 flex h-8 items-end gap-[1.5px]" onClick={onPlay} role="button">
            {bars.map((h, i) => (
              <div key={i} className="flex-1 rounded-sm" style={{
                height: `${h}%`,
                background: isActive ? ORANGE : 'var(--border)',
                opacity: isActive && i / bars.length <= 0.35 ? 1 : isActive ? 0.35 : 1,
              }}/>
            ))}
          </div>

          <div className="mt-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--t3)' }}>
              {track.license === 'open'
                ? <><Cloud size={11}/>Открытая лицензия</>
                : <><ShieldCheck size={11} style={{ color: '#22c55e' }}/>Личная лицензия</>}
            </span>
            <button type="button" onClick={onLike} className="flex items-center gap-1 text-[11px]" style={{ color: liked ? '#f43f5e' : 'var(--t3)' }}>
              <Heart size={13} fill={liked ? '#f43f5e' : 'none'}/>{track.likes.length}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const UploadSheet = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const addTrack = useOpenSoundStore(s => s.addTrack);
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [license, setLicense] = useState<SoundLicense>('open');
  const [ageRestricted, setAgeRestricted] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const reset = () => { setFile(null); setUrl(null); setTitle(''); setArtist(''); setLicense('open'); setAgeRestricted(false); setAgreed(false); };

  const canPublish = file && title.trim() && artist.trim() && (license === 'personal' || agreed);

  const publish = () => {
    if (!canPublish || !url || !currentUserId) return;
    addTrack({
      title: title.trim(), artist: artist.trim(), sourceUrl: url,
      coverHue: Math.floor(Math.random() * 360), license, ageRestricted,
      uploadedBy: currentUserId, uploaderName: me?.name ?? 'Пользователь',
    });
    reset(); onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => { onClose(); reset(); }}>
          <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
            onClick={e => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5" style={{ background: 'var(--bg-l1)' }}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Загрузить трек</p>
              <button type="button" onClick={() => { onClose(); reset(); }}><X size={18} style={{ color: 'var(--t3)' }}/></button>
            </div>

            <input ref={fileRef} type="file" accept={ACCEPT_AUDIO} className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]; if (!f) return;
                setFile(f); setUrl(URL.createObjectURL(f));
                if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
              }}/>

            {!file ? (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-2xl py-8"
                style={{ border: '2px dashed var(--border)', color: 'var(--t3)' }}>
                <Upload size={22}/><span className="text-[12.5px] font-semibold">Выбрать аудиофайл</span>
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-l2)' }}>
                  <Cloud size={15} style={{ color: ORANGE }}/>
                  <p className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: 'var(--t1)' }}>{file.name}</p>
                  <button type="button" onClick={() => { setFile(null); setUrl(null); }}><X size={14} style={{ color: 'var(--t3)' }}/></button>
                </div>

                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название трека"
                  className="w-full rounded-xl px-3 py-2.5 text-[13.5px] outline-none" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}/>
                <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Исполнитель"
                  className="w-full rounded-xl px-3 py-2.5 text-[13.5px] outline-none" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}/>

                <div className="grid grid-cols-2 gap-2">
                  {([['open','Открытая'],['personal','Личная']] as const).map(([k,l]) => (
                    <button key={k} type="button" onClick={() => setLicense(k)}
                      className="rounded-xl py-2.5 text-[12.5px] font-semibold"
                      style={{ background: license===k ? (k==='open'?'rgba(255,85,0,0.12)':'rgba(34,197,94,0.12)') : 'var(--bg-l2)',
                        color: license===k ? (k==='open'?ORANGE:'#22c55e') : 'var(--t2)',
                        border: license===k ? `1px solid ${k==='open'?'rgba(255,85,0,0.3)':'rgba(34,197,94,0.3)'}` : '1px solid transparent' }}>
                      {l} лицензия
                    </button>
                  ))}
                </div>

                {license === 'open' ? (
                  <div className="rounded-xl p-3 space-y-2.5" style={{ background: 'rgba(255,85,0,0.06)', border: '1px solid rgba(255,85,0,0.2)' }}>
                    <p className="flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--t2)' }}>
                      <ShieldAlert size={13} className="mt-0.5 shrink-0" style={{ color: ORANGE }}/>
                      Взято из открытых источников. Экосистема и исполнитель (в открытой лицензии) не несут ответственности за использование открытых авторских прав.
                    </p>
                    <label className="flex items-start gap-2 text-[11.5px]" style={{ color: 'var(--t1)' }}>
                      <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5"/>
                      Подтверждаю: экосистема не несёт ответственности за использование лицензий и авторских прав этого трека
                    </label>
                    <label className="flex items-center gap-2 text-[11.5px]" style={{ color: 'var(--t1)' }}>
                      <input type="checkbox" checked={ageRestricted} onChange={e => setAgeRestricted(e.target.checked)}/>
                      Трек 18+ (нецензурная лексика / упоминание наркотических веществ)
                    </label>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 rounded-xl p-3 text-[11.5px]" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#22c55e' }}>
                    <ShieldCheck size={14} className="shrink-0"/>Авторское право на личную лицензию подтверждено
                  </div>
                )}

                <button type="button" disabled={!canPublish} onClick={publish}
                  className="w-full rounded-xl py-3 text-[13.5px] font-bold text-white disabled:opacity-40"
                  style={{ background: ORANGE }}>
                  Опубликовать
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const AgeGate = ({ onAccept }: { onAccept: () => void }) => (
  <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
    <div className="grid h-16 w-16 place-items-center rounded-full" style={{ background: 'rgba(239,68,68,0.12)' }}>
      <span className="text-2xl font-black" style={{ color: '#ef4444' }}>18+</span>
    </div>
    <p className="text-[15px] font-bold" style={{ color: 'var(--t1)' }}>Раздел открытых лицензий</p>
    <p className="max-w-xs text-[12.5px]" style={{ color: 'var(--t3)' }}>
      Здесь встречаются треки от разных авторов, в том числе с нецензурными словами.
      Экосистема не несёт ответственности за содержание загруженных треков —
      всё, что помечено «Открытая лицензия», взято из открытых источников.
    </p>
    <button type="button" onClick={onAccept}
      className="rounded-full px-6 py-2.5 text-[13px] font-bold text-white" style={{ background: ORANGE }}>
      Понятно, продолжить
    </button>
  </div>
);

export const SkySoundCloud = () => {
  const { currentUserId } = useAuthStore();
  const { tracks, ageGateAccepted, acceptAgeGate, toggleLike, incrementPlays } = useOpenSoundStore();
  const [showUpload, setShowUpload] = useState(false);

  const gItem = usePlayerStore(s => s.item);
  const playing = usePlayerStore(s => s.isPlaying);
  const pushToPlayer = usePlayerStore(s => s.push);
  const setPlaying = usePlayerStore(s => s.setPlaying);

  const playFrom = useCallback((t: OpenTrack, pool: OpenTrack[]) => {
    const i = pool.findIndex(x => x.id === t.id); if (i < 0) return;
    pushToPlayer({
      id: t.id, kind: 'music', title: t.title, author: t.artist, hue: t.coverHue, srcUrl: t.sourceUrl, duration: 0,
      queue: pool.map(p => ({ id: p.id, kind: 'music' as const, title: p.title, author: p.artist, hue: p.coverHue, srcUrl: p.sourceUrl })),
      qIdx: i,
    });
    incrementPlays(t.id);
  }, [pushToPlayer, incrementPlays]);

  if (!ageGateAccepted) return <AgeGate onAccept={acceptAgeGate}/>;

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <div className="flex items-center justify-between border-b px-4 py-3 shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div>
          <p className="flex items-center gap-1.5 text-[15px] font-black" style={{ color: 'var(--t1)' }}>
            <Cloud size={16} style={{ color: ORANGE }}/>SkySound
          </p>
          <p className="text-[10.5px]" style={{ color: 'var(--t3)' }}>Открытая площадка — треки от пользователей</p>
        </div>
        <button type="button" onClick={() => setShowUpload(true)}
          className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-bold text-white" style={{ background: ORANGE }}>
          <Upload size={13}/>Загрузить
        </button>
      </div>

      <div className="mx-4 mt-3 flex items-start gap-1.5 rounded-xl p-2.5 text-[10.5px] shrink-0" style={{ background: 'rgba(255,85,0,0.06)', border: '1px solid rgba(255,85,0,0.15)', color: 'var(--t2)' }}>
        <ShieldAlert size={12} className="mt-0.5 shrink-0" style={{ color: ORANGE }}/>
        Треки с пометкой «Открытая лицензия» взяты из открытых источников — экосистема не несёт ответственности за использование этих лицензий.
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {tracks.map(t => (
          <TrackCard key={t.id} track={t}
            isActive={gItem?.id === t.id} isPlaying={playing}
            onPlay={() => gItem?.id === t.id ? setPlaying(!playing) : playFrom(t, tracks)}
            onLike={() => currentUserId && toggleLike(t.id, currentUserId)}
            liked={!!currentUserId && t.likes.includes(currentUserId)}/>
        ))}
      </div>

      <UploadSheet open={showUpload} onClose={() => setShowUpload(false)}/>
    </div>
  );
};
