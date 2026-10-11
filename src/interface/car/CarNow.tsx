/* Состояние «сейчас играет» для Sky Car: музыка (usePlayerStore) или подкаст (usePlayer).
   Читает и командует теми же плеерами, что и вся Sky — второго плеера нет. */
import { Play, Pause, SkipBack, SkipForward, Music2, RotateCcw, RotateCw } from 'lucide-react';
import { usePlayerStore } from '@/player/playerStore';
import { usePlayer as usePodcast } from '@/podcasts/playerStore';
import { epCoverUrl } from '@/podcasts/podcastApi';
import { CAR_ACCENT, CAR_BLUR, CAR_GLASS, CAR_GLASS_BORDER, fmtTime } from './carTheme';

export interface CarNowState {
  kind: 'music' | 'podcast';
  title: string; artist: string; cover?: string;
  playing: boolean; cur: number; dur: number;
  toggle: () => void; prev: () => void; next: () => void;
}

export const useCarNow = (): CarNowState | null => {
  const m = usePlayerStore((s) => s.item);
  const mPlaying = usePlayerStore((s) => s.isPlaying);
  const mCur = usePlayerStore((s) => s.currentTime);
  const mDur = usePlayerStore((s) => s.duration);
  const ep = usePodcast((s) => s.episode);
  const pPlaying = usePodcast((s) => s.playing);
  const pCur = usePodcast((s) => s.currentTime);
  const pDur = usePodcast((s) => s.duration);

  if (ep && (pPlaying || !m)) {
    return {
      kind: 'podcast', title: ep.title, artist: ep.podcastTitle ?? '', cover: ep.hasCover ? epCoverUrl(ep.id) : undefined,
      playing: pPlaying, cur: pCur, dur: pDur || ep.duration || 0,
      toggle: () => usePodcast.getState().toggle(), prev: () => usePodcast.getState().skip(-15), next: () => usePodcast.getState().skip(30),
    };
  }
  if (m) {
    return {
      kind: 'music', title: m.title, artist: m.author, cover: m.coverUrl,
      playing: mPlaying, cur: mCur, dur: mDur || m.duration || 0,
      toggle: () => usePlayerStore.getState().requestPlay(!usePlayerStore.getState().isPlaying),
      prev: () => usePlayerStore.getState().prevTrack(), next: () => usePlayerStore.getState().nextTrack(),
    };
  }
  return null;
};

const RoundBtn = ({ label, onClick, size, primary, children }: { label: string; onClick: () => void; size: number; primary?: boolean; children: React.ReactNode }) => (
  <button type="button" aria-label={label} onClick={onClick} className="grid shrink-0 place-items-center rounded-full outline-none transition active:scale-90 focus-visible:ring-4 focus-visible:ring-violet-300"
    style={{ width: size, height: size, background: primary ? '#fff' : 'rgba(255,255,255,0.12)' }}>
    {children}
  </button>
);

/** Крупная карточка на главном экране. */
export const CarNowCard = ({ now }: { now: CarNowState }) => {
  const pod = now.kind === 'podcast';
  return (
    <div className="flex h-full min-h-0 flex-col justify-between overflow-hidden rounded-[40px] p-8"
      style={{ background: 'linear-gradient(145deg, rgba(139,124,255,0.35), rgba(255,255,255,0.06) 60%)', border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
      <div className="flex min-h-0 items-center gap-8">
        <div className="aspect-square h-[min(34vh,260px)] shrink-0 overflow-hidden rounded-[32px]" style={{ background: now.cover ? `center/cover no-repeat url(${now.cover})` : 'linear-gradient(160deg,#4f2e8a,#1a0e33)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
          {!now.cover && <div className="grid h-full w-full place-items-center"><Music2 size={64} color="rgba(255,255,255,0.4)" /></div>}
        </div>
        <div className="min-w-0">
          <p className="text-[18px] font-bold uppercase tracking-[0.2em]" style={{ color: '#c4baff' }}>{now.playing ? 'Сейчас играет' : 'На паузе'}</p>
          <p className="mt-2 line-clamp-2 text-[clamp(28px,4vw,44px)] font-extrabold leading-tight text-white" translate="no">{now.title}</p>
          <p className="mt-1 truncate text-[clamp(20px,2.4vw,28px)]" style={{ color: 'rgba(255,255,255,0.6)' }} translate="no">{now.artist}</p>
        </div>
      </div>
      <div>
        <div className="mb-2 h-[10px] w-full overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full" style={{ width: `${now.dur ? (now.cur / now.dur) * 100 : 0}%`, background: CAR_ACCENT }} /></div>
        <div className="mb-4 flex justify-between text-[18px] font-semibold tabular-nums" style={{ color: 'rgba(255,255,255,0.55)' }}><span>{fmtTime(now.cur)}</span><span>{fmtTime(now.dur)}</span></div>
        <div className="flex items-center justify-center gap-10">
          <RoundBtn label={pod ? 'Назад на 15 секунд' : 'Предыдущий'} onClick={now.prev} size={96}>{pod ? <RotateCcw size={36} color="#fff" /> : <SkipBack size={38} color="#fff" fill="#fff" />}</RoundBtn>
          <RoundBtn label={now.playing ? 'Пауза' : 'Играть'} onClick={now.toggle} size={124} primary>{now.playing ? <Pause size={52} color="#0b0b14" fill="#0b0b14" /> : <Play size={52} color="#0b0b14" fill="#0b0b14" className="ml-1" />}</RoundBtn>
          <RoundBtn label={pod ? 'Вперёд на 30 секунд' : 'Следующий'} onClick={now.next} size={96}>{pod ? <RotateCw size={36} color="#fff" /> : <SkipForward size={38} color="#fff" fill="#fff" />}</RoundBtn>
        </div>
      </div>
    </div>
  );
};

/** Нижняя полоса на внутренних экранах: управление без возврата на главную. */
export const CarNowBar = ({ now }: { now: CarNowState | null }) => {
  if (!now) return null;
  return (
    <div className="flex shrink-0 items-center gap-5 rounded-[30px] px-5 py-3" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
      <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-2xl" style={{ background: now.cover ? `center/cover no-repeat url(${now.cover})` : 'linear-gradient(160deg,#4f2e8a,#1a0e33)' }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[24px] font-bold text-white" translate="no">{now.title}</p>
        <p className="truncate text-[18px]" style={{ color: 'rgba(255,255,255,0.55)' }} translate="no">{now.artist}</p>
      </div>
      <RoundBtn label="Предыдущий" onClick={now.prev} size={72}><SkipBack size={28} color="#fff" fill="#fff" /></RoundBtn>
      <RoundBtn label={now.playing ? 'Пауза' : 'Играть'} onClick={now.toggle} size={84} primary>{now.playing ? <Pause size={34} color="#0b0b14" fill="#0b0b14" /> : <Play size={34} color="#0b0b14" fill="#0b0b14" className="ml-0.5" />}</RoundBtn>
      <RoundBtn label="Следующий" onClick={now.next} size={72}><SkipForward size={28} color="#fff" fill="#fff" /></RoundBtn>
    </div>
  );
};
