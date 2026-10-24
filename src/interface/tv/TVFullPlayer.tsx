import { BufferingRing, useBuffering } from '@/player/BufferingRing';
/* Sky TV — музыка на весь экран: обложка, перемотка, управление пультом, текст песни по меткам времени. */
import { VideoBackdrop } from '@/music/VideoBackdrop';
import { useEffect } from 'react';
import { ChevronDown, Pause, Play, SkipBack, SkipForward, Rewind, FastForward, Music2 } from 'lucide-react';
import { usePlayerStore } from '@/player/playerStore';
import { useFullNow } from '@/player/fullNowStore';
import { TVFocusable } from './TVFocusable';
import { MusicContinue } from '@/handoff/Slots';
import { tvFocusManager } from './focusManager';

const SCOPE = 'full-now';
const fmt = (s: number) => { if (!isFinite(s) || s < 0) s = 0; return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };

const Btn = ({ id, label, onEnter, size = 84, primary, children }: { id: string; label: string; onEnter: () => void; size?: number; primary?: boolean; children: (f: boolean) => React.ReactNode }) => (
  <TVFocusable id={id} scope={SCOPE} onEnter={onEnter} autoFocusPriority={primary ? 0 : 5}>
    {({ focused }) => (
      <div aria-label={label} className="grid place-items-center rounded-full" style={{ width: size, height: size, background: primary ? (focused ? '#8b7cff' : '#fff') : (focused ? '#8b7cff' : 'rgba(255,255,255,0.14)'), boxShadow: focused ? '0 0 0 4px rgba(179,167,255,0.9), 0 0 36px rgba(139,124,255,0.6)' : 'none', transform: focused ? 'scale(1.1)' : 'scale(1)', transition: 'all .15s' }}>
        {children(focused)}
      </div>
    )}
  </TVFocusable>
);

export const TVFullPlayer = () => {
  const open = useFullNow((s) => s.open);
  const hide = useFullNow((s) => s.hide);
  const item = usePlayerStore((s) => s.item);
  const playing = usePlayerStore((s) => s.isPlaying);
  const buffering = useBuffering();
  const cur = usePlayerStore((s) => s.currentTime);
  const dur = usePlayerStore((s) => s.duration);

  useEffect(() => {
    if (!open) return undefined;
    tvFocusManager.setScope(SCOPE);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack' || e.keyCode === 10009 || e.keyCode === 461) { e.preventDefault(); e.stopPropagation(); hide(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); tvFocusManager.setScope(null); };
  }, [open, hide]);
  useEffect(() => { if (open && !item) hide(); }, [open, item, hide]);
  useEffect(() => { if (open) setTimeout(() => tvFocusManager.focusDefault(), 30); }, [open]);

  if (!open || !item) return null;
  const timed = (item.lyrics ?? []).filter((l) => l.text && l.t > 0);
  let at = -1;
  timed.forEach((l, i) => { if (l.t <= cur) at = i; });
  const shown = at >= 0 ? timed.slice(Math.max(0, at - 1), at + 3) : [];
  const ps = usePlayerStore.getState();
  const jump = (d: number) => ps.requestSeek(Math.max(0, Math.min(dur || Infinity, cur + d)));

  return (
    <div className="absolute inset-0 z-[40] flex flex-col px-[90px] py-[50px]" role="dialog" aria-modal="true" aria-label="Плеер"
      style={{ background: 'radial-gradient(110% 90% at 50% 0%, #2c2166 0%, #0d0b20 60%, #05050c 100%)' }}>
      <VideoBackdrop src={item.videoUrl} playing={playing} z={-1} />
      <div className="flex items-center justify-between">
        <Btn id="full-close" label="Свернуть" size={72} onEnter={hide}>{() => <ChevronDown size={34} color="#fff" />}</Btn>
        <p className="text-[18px] font-bold uppercase tracking-[0.25em]" style={{ color: '#c4baff' }}>{playing ? 'Сейчас играет' : 'На паузе'}</p>
        <MusicContinue variant="tv" tvScope={SCOPE} label={false} />
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-[70px]">
        <div className="aspect-square h-[min(52vh,520px)] shrink-0 overflow-hidden rounded-[40px]" style={{ background: item.coverUrl ? `center/cover no-repeat url(${item.coverUrl})` : 'linear-gradient(160deg,#4f2e8a,#101018)', boxShadow: '0 30px 90px rgba(0,0,0,0.65)' }}>
          {!item.coverUrl && <div className="grid h-full w-full place-items-center"><Music2 size={110} color="rgba(255,255,255,0.35)" /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[56px] font-extrabold leading-tight text-white" translate="no">{item.title}</p>
          <p className="mt-2 truncate text-[30px]" style={{ color: 'rgba(255,255,255,0.6)' }} translate="no">{item.author}</p>
          {shown.length > 0 && (
            <div className="mt-8 space-y-2" translate="no">
              {shown.map((l) => (
                <p key={l.t + l.text} className="line-clamp-2 text-[30px] font-bold" style={{ color: l === timed[at] ? '#fff' : 'rgba(255,255,255,0.4)' }}>{l.text}</p>
              ))}
            </div>
          )}
        </div>
      </div>
      <div>
        <div className="mb-2 h-[12px] w-full overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full" style={{ width: `${dur ? (cur / dur) * 100 : 0}%`, background: 'linear-gradient(90deg,#8b7cff,#4f6ef7)' }} /></div>
        <div className="mb-6 flex justify-between text-[20px] font-semibold tabular-nums" style={{ color: 'rgba(255,255,255,0.55)' }}><span>{fmt(cur)}</span><span>{fmt(dur)}</span></div>
        <div className="flex items-center justify-center gap-8">
          <Btn id="full-prev" label="Предыдущий" onEnter={() => ps.prevTrack()}>{() => <SkipBack size={34} color="#fff" fill="#fff" />}</Btn>
          <Btn id="full-back10" label="Назад на 10 секунд" onEnter={() => jump(-10)}>{() => <Rewind size={32} color="#fff" />}</Btn>
          <Btn id="full-play" label={playing ? 'Пауза' : 'Играть'} size={112} primary onEnter={() => ps.requestPlay(!usePlayerStore.getState().isPlaying)}>
            {(f) => buffering ? <BufferingRing size={50} color={f ? '#fff' : '#0a0a0e'}/> : playing ? <Pause size={50} color={f ? '#fff' : '#0a0a0e'} fill={f ? '#fff' : '#0a0a0e'} /> : <Play size={50} color={f ? '#fff' : '#0a0a0e'} fill={f ? '#fff' : '#0a0a0e'} />}
          </Btn>
          <Btn id="full-fwd10" label="Вперёд на 10 секунд" onEnter={() => jump(10)}>{() => <FastForward size={32} color="#fff" />}</Btn>
          <Btn id="full-next" label="Следующий" onEnter={() => ps.nextTrack()}>{() => <SkipForward size={34} color="#fff" fill="#fff" />}</Btn>
        </div>
      </div>
    </div>
  );
};
