/* ===========================================================
   SKY CAR — главный экран: слева крупная карточка музыки, справа
   карточки подкастов, сообщений и Sky AI. Только реальные данные
   (плееры, серверная музыка и подкасты, мессенджер); навигации по
   карте в Sky нет, и выдумывать её здесь не стали.
=========================================================== */
import { useEffect, useMemo, useState } from 'react';
import { Music2, Heart, History, Library, Mic2, MessageCircle, Sparkles, Play } from 'lucide-react';
import { useMusicStore } from '@/music/serverStore';
import { playMusicQueue } from '@/music/useMusicSync';
import { useMessengerStore } from '@/messenger/store';
import { usePlayer as usePodcast } from '@/podcasts/playerStore';
import { apiContinue, apiMediaTicket, epCoverUrl, type Episode } from '@/podcasts/podcastApi';
import { CarNowCard, type CarNowState } from './CarNow';
import { CAR_ACCENT, CAR_BLUR, CAR_GLASS, CAR_GLASS_BORDER } from './carTheme';
import type { CarScreen } from './CarShell';

const Card = ({ onClick, children, label, className = '' }: { onClick: () => void; children: React.ReactNode; label: string; className?: string }) => (
  <button type="button" onClick={onClick} aria-label={label} className={`flex min-h-0 flex-1 items-center gap-5 overflow-hidden rounded-[32px] px-6 text-left outline-none transition active:scale-[0.98] focus-visible:ring-4 focus-visible:ring-violet-300 ${className}`}
    style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR, minHeight: 112 }}>
    {children}
  </button>
);

const IconBox = ({ children, color = CAR_ACCENT }: { children: React.ReactNode; color?: string }) => (
  <span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-3xl" style={{ background: color }}>{children}</span>
);

export const CarHome = ({ now, onOpen }: { now: CarNowState | null; onOpen: (s: CarScreen) => void }) => {
  const tracks = useMusicStore((s) => s.tracks);
  const favorites = useMusicStore((s) => s.favorites);
  const history = useMusicStore((s) => s.history);
  const loaded = useMusicStore((s) => s.loaded);
  const error = useMusicStore((s) => s.error);
  const unread = useMessengerStore((s) => s.messages.filter((m) => !m.fromMe && m.status !== 'read' && !m.deleted).length);
  const podPlaying = usePodcast((s) => s.episode);
  const playPod = usePodcast((s) => s.play);
  const [cont, setCont] = useState<Episode | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void apiMediaTicket();
    void apiContinue().then((l) => { if (alive) setCont(l[0] ?? null); }).catch(() => { if (alive) setCont(null); });
    return () => { alive = false; };
  }, []);

  const fav = useMemo(() => tracks.filter((t) => favorites.includes(t.id)), [tracks, favorites]);
  const mine = useMemo(() => tracks.filter((t) => t.uploadedBy === 'me'), [tracks]);
  const start = (pool: typeof tracks) => { if (pool[0]) playMusicQueue(pool, pool[0].id); };

  const Start = ({ icon: I, label, pool }: { icon: typeof Heart; label: string; pool: typeof tracks }) => (
    <button type="button" disabled={pool.length === 0} onClick={() => start(pool)} aria-label={label}
      className="flex min-h-[132px] flex-1 flex-col items-center justify-center gap-3 rounded-[28px] text-[22px] font-bold text-white outline-none transition active:scale-95 disabled:opacity-40 focus-visible:ring-4 focus-visible:ring-violet-300"
      style={{ background: 'rgba(255,255,255,0.1)' }}>
      <I size={40} /> {label}
      <span className="text-[16px] font-medium text-white/55">{pool.length > 0 ? `${pool.length}` : 'пока пусто'}</span>
    </button>
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-[1.55fr_1fr] gap-5">
      {now ? <CarNowCard now={now} /> : (
        <div className="flex min-h-0 flex-col justify-between rounded-[40px] p-8" style={{ background: 'linear-gradient(145deg, rgba(139,124,255,0.3), rgba(255,255,255,0.05) 60%)', border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
          <div>
            <p className="flex items-center gap-3 text-[18px] font-bold uppercase tracking-[0.2em]" style={{ color: '#c4baff' }}><Music2 size={22} /> Sky Music</p>
            <p className="mt-3 text-[clamp(30px,4vw,46px)] font-extrabold leading-tight text-white">Что послушаем?</p>
            {error && !loaded && <p className="mt-2 text-[20px] text-rose-300" role="alert">{error}</p>}
            {!loaded && !error && <p className="mt-2 text-[20px] text-white/55" role="status">Загружаем музыку…</p>}
          </div>
          <div className="flex gap-4">
            <Start icon={History} label="Недавние" pool={history} />
            <Start icon={Heart} label="Любимые" pool={fav} />
            <Start icon={Library} label="Моя музыка" pool={mine} />
          </div>
          <button type="button" onClick={() => onOpen('music')} className="self-start rounded-full px-8 text-[22px] font-bold text-[#0b0b14]" style={{ minHeight: 76, background: '#fff' }}>Весь каталог</button>
        </div>
      )}

      <div className="flex min-h-0 flex-col gap-5">
        <Card label="Подкасты" onClick={() => (cont && !podPlaying ? void playPod(cont) : onOpen('podcasts'))}>
          <IconBox color="#10b981"><Mic2 size={34} color="#fff" /></IconBox>
          <span className="min-w-0 flex-1">
            <span className="block text-[26px] font-extrabold text-white">Подкасты</span>
            <span className="block truncate text-[18px] text-white/55" translate={cont ? 'no' : undefined}>{cont ? cont.title : cont === undefined ? 'Загрузка…' : 'Открыть выпуски'}</span>
          </span>
          {cont && <span className="grid h-[64px] w-[64px] shrink-0 place-items-center rounded-full bg-white/15" style={cont.hasCover ? { background: `center/cover url(${epCoverUrl(cont.id)})` } : undefined}><Play size={26} color="#fff" fill="#fff" /></span>}
        </Card>
        <Card label="Сообщения" onClick={() => onOpen('messenger')}>
          <IconBox color="#4f6ef7"><MessageCircle size={34} color="#fff" /></IconBox>
          <span className="min-w-0 flex-1"><span className="block text-[26px] font-extrabold text-white">Сообщения</span>
            <span className="block text-[18px] text-white/55">{unread > 0 ? `Непрочитанных: ${unread}` : 'Новых нет'}</span></span>
          {unread > 0 && <span className="grid min-w-[44px] place-items-center rounded-full px-3 py-1 text-[22px] font-bold text-white" style={{ background: '#ef4444' }} translate="no">{unread > 99 ? '99+' : unread}</span>}
        </Card>
        <Card label="Sky AI" onClick={() => onOpen('ai')}>
          <IconBox><Sparkles size={34} color="#fff" /></IconBox>
          <span className="min-w-0 flex-1"><span className="block text-[26px] font-extrabold text-white">Sky AI</span>
            <span className="block text-[18px] text-white/55">Спросить голосом</span></span>
        </Card>
      </div>
    </div>
  );
};
