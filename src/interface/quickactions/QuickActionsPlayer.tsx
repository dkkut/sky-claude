/* ===========================================================
   PC Quick Actions — вкладка «Плеер».
   Пульт к ЕДИНОМУ плееру основного окна — см. useRemotePlayer.ts.
=========================================================== */
import { Play, Pause, SkipBack, SkipForward, RotateCcw, RotateCw, Music2 } from 'lucide-react';
import { useRemotePlayer } from './useRemotePlayer';

const fmt = (s: number) => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${String(sec).padStart(2, '0')}`; };

export const QuickActionsPlayer = () => {
  const { state, toggle, next, prev, skip } = useRemotePlayer();

  if (!state.kind) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Music2 size={32} color="rgba(255,255,255,0.3)" />
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Ничего не играет</p>
      </div>
    );
  }

  const pct = state.duration ? (state.currentTime / state.duration) * 100 : 0;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6">
      <div className="h-32 w-32 shrink-0 rounded-2xl overflow-hidden"
        style={{ background: state.coverUrl ? `center/cover no-repeat url(${state.coverUrl})` : 'linear-gradient(160deg,#4f2e8a,#1a0e33)' }}>
        {!state.coverUrl && <div className="grid h-full w-full place-items-center"><Music2 size={36} color="rgba(255,255,255,0.35)" /></div>}
      </div>
      <div className="w-full text-center">
        <p className="truncate text-[16px] font-bold text-white">{state.title}</p>
        <p className="truncate text-[13px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{state.author}</p>
      </div>
      <div className="w-full">
        <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>
          <span>{fmt(state.currentTime)}</span><span>{fmt(state.duration)}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {state.kind === 'music' ? (
          <button type="button" onClick={prev} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <SkipBack size={16} color="#fff" />
          </button>
        ) : (
          <button type="button" onClick={() => skip(-15)} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <RotateCcw size={16} color="#fff" />
          </button>
        )}
        <button type="button" onClick={toggle} className="grid h-14 w-14 place-items-center rounded-full" style={{ background: 'var(--accent)' }}>
          {state.isPlaying ? <Pause size={22} color="#fff" fill="#fff" /> : <Play size={22} color="#fff" fill="#fff" />}
        </button>
        {state.kind === 'music' ? (
          <button type="button" onClick={next} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <SkipForward size={16} color="#fff" />
          </button>
        ) : (
          <button type="button" onClick={() => skip(15)} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <RotateCw size={16} color="#fff" />
          </button>
        )}
      </div>
    </div>
  );
};
