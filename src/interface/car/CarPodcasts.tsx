/* ===========================================================
   SKY CAR MODE — Подкасты.
   Тот же реальный плеер подкастов (usePlayer, @/podcasts/playerStore) —
   продолжить прослушивание и список выпусков, без второго бэкенда.
=========================================================== */
import { useEffect, useState } from 'react';
import { Podcast, Play, Pause, RotateCcw, RotateCw } from 'lucide-react';
import { usePlayer } from '@/podcasts/playerStore';
import { apiContinue, apiNewFromSubscriptions, apiMediaTicket, epCoverUrl, type Episode } from '@/podcasts/podcastApi';
import { CAR_GLASS, CAR_GLASS_BORDER, CAR_BLUR } from './CarShell';

const fmt = (s: number) => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${String(sec).padStart(2, '0')}`; };

const Row = ({ ep, active, onPlay }: { ep: Episode; active: boolean; onPlay: () => void }) => (
  <button type="button" onClick={onPlay}
    className="flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition-transform active:scale-[0.98]"
    style={{ background: active ? 'rgba(255,255,255,0.10)' : 'transparent' }}>
    <div className="h-14 w-14 shrink-0 rounded-xl overflow-hidden"
      style={{ background: ep.hasCover ? `center/cover no-repeat url(${epCoverUrl(ep.id)})` : 'linear-gradient(160deg,#2b2440,#12101f)' }}>
      {!ep.hasCover && <div className="grid h-full w-full place-items-center"><Podcast size={20} color="rgba(255,255,255,0.4)" /></div>}
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[17px] font-bold" style={{ color: active ? 'var(--accent)' : '#fff' }}>{ep.title}</p>
      <p className="truncate text-[14px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{ep.podcastTitle ?? ''}</p>
    </div>
  </button>
);

export const CarPodcasts = () => {
  const episode = usePlayer(s => s.episode);
  const playing = usePlayer(s => s.playing);
  const currentTime = usePlayer(s => s.currentTime);
  const duration = usePlayer(s => s.duration);
  const play = usePlayer(s => s.play);
  const toggle = usePlayer(s => s.toggle);
  const skip = usePlayer(s => s.skip);

  const [list, setList] = useState<Episode[] | null>(null);

  useEffect(() => {
    void apiMediaTicket();
    (async () => {
      const cont = await apiContinue();
      if (cont.length > 0) { setList(cont); return; }
      setList(await apiNewFromSubscriptions());
    })();
  }, []);

  if (list === null) return null;

  return (
    <div className="flex flex-col gap-6">
      {episode && (
        <div className="flex items-center gap-4 rounded-3xl p-4" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
          <div className="h-16 w-16 shrink-0 rounded-2xl overflow-hidden"
            style={{ background: episode.hasCover ? `center/cover no-repeat url(${epCoverUrl(episode.id)})` : 'linear-gradient(160deg,#2b2440,#12101f)' }} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-bold text-white">{episode.title}</p>
            <div className="mt-2 h-1 w-full max-w-[320px] rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%`, background: 'var(--accent)' }} />
            </div>
            <p className="mt-1 text-[12px] font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>{fmt(currentTime)} / {fmt(duration)}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => skip(-15)} className="grid h-11 w-11 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <RotateCcw size={17} color="#fff" />
            </button>
            <button type="button" onClick={toggle} className="grid h-14 w-14 place-items-center rounded-full" style={{ background: 'var(--accent)' }}>
              {playing ? <Pause size={20} color="#fff" fill="#fff" /> : <Play size={20} color="#fff" fill="#fff" />}
            </button>
            <button type="button" onClick={() => skip(15)} className="grid h-11 w-11 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <RotateCw size={17} color="#fff" />
            </button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16">
          <Podcast size={40} color="rgba(255,255,255,0.35)" />
          <p className="text-[16px] font-bold text-white">Слушать пока нечего</p>
        </div>
      ) : (
        <section>
          <p className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.45)' }}>Продолжить</p>
          <div className="rounded-3xl p-2" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
            {list.map(ep => <Row key={ep.id} ep={ep} active={ep.id === episode?.id} onPlay={() => void play(ep)} />)}
          </div>
        </section>
      )}
    </div>
  );
};
