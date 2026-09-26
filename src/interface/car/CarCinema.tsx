/* ===========================================================
   SKY CAR MODE — Кино.
   Тот же реальный каталог/продолжить-просмотр/сохранённое, что и в
   SkyFilm (useFilmStore, @/film/serverStore). Открытие фильма идёт
   через уже существующий TVPlayer (см. CarShell.tsx) — второго
   видеоплеера здесь нет.
=========================================================== */
import { useEffect, useMemo } from 'react';
import { Clapperboard, Play } from 'lucide-react';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl, type ServerMovie } from '@/film/filmApi';
import type { TVPlayerSource } from '@/interface/tv/TVPlayer';
import { CAR_GLASS, CAR_GLASS_BORDER, CAR_BLUR } from './CarShell';

const cover = (m: ServerMovie) => (m.hasPoster ? posterUrl(m.id) : undefined);

const Card = ({ m, onPlay }: { m: ServerMovie; onPlay: () => void }) => (
  <button type="button" onClick={onPlay} className="shrink-0 text-left transition-transform active:scale-95" style={{ width: 168 }}>
    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl"
      style={{ background: cover(m) ? `center/cover no-repeat url(${cover(m)})` : 'linear-gradient(160deg,#2b2440,#12101f)' }}>
      {!cover(m) && <div className="grid h-full w-full place-items-center"><Clapperboard size={28} color="rgba(255,255,255,0.35)" /></div>}
      <div className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.55)' }}>
        <Play size={16} color="#fff" fill="#fff" />
      </div>
    </div>
    <p className="mt-2 truncate text-[15px] font-bold text-white">{m.title}</p>
    {m.year && <p className="truncate text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{m.year}</p>}
  </button>
);

const Row = ({ title, items, onPlay }: { title: string; items: ServerMovie[]; onPlay: (id: string) => void }) => (
  <section>
    <p className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.45)' }}>{title}</p>
    <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
      {items.map(m => <Card key={m.id} m={m} onPlay={() => onPlay(m.id)} />)}
    </div>
  </section>
);

export const CarCinema = ({ onPlay }: { onPlay: (source: TVPlayerSource) => void }) => {
  const catalog = useFilmStore(s => s.catalog);
  const saved = useFilmStore(s => s.saved);
  const continueWatching = useFilmStore(s => s.continueWatching);
  const loaded = useFilmStore(s => s.loaded);
  const needsPrime = useFilmStore(s => s.needsPrime);
  const load = useFilmStore(s => s.load);

  useEffect(() => { void load(); }, [load]);

  const play = (id: string) => onPlay({ kind: 'movie', id });

  const fresh = useMemo(() => [...catalog].slice(0, 20), [catalog]);

  if (loaded && needsPrime) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Clapperboard size={40} color="rgba(255,255,255,0.35)" />
        <p className="text-[16px] font-bold text-white">Sky Film доступен с Prime</p>
      </div>
    );
  }

  if (loaded && catalog.length === 0 && continueWatching.length === 0 && saved.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Clapperboard size={40} color="rgba(255,255,255,0.35)" />
        <p className="text-[16px] font-bold text-white">Фильмов пока нет</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {continueWatching.length > 0 && (
        <div className="rounded-3xl p-4" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
          <Row title="Продолжить просмотр" items={continueWatching} onPlay={play} />
        </div>
      )}
      {saved.length > 0 && (
        <div className="rounded-3xl p-4" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
          <Row title="Сохранённое" items={saved} onPlay={play} />
        </div>
      )}
      {fresh.length > 0 && (
        <div className="rounded-3xl p-4" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
          <Row title="Каталог" items={fresh} onPlay={play} />
        </div>
      )}
    </div>
  );
};
