/* ===========================================================
   PC Quick Actions — вкладка «Кино и подкасты».
   У видео нет места в узкой панели overlay, поэтому это не плеер, а
   быстрый доступ: список «продолжить», клик — основное окно
   поднимается на передний план (там уже открыть сам фильм/выпуск).
=========================================================== */
import { useEffect, useState } from 'react';
import { Clapperboard, ExternalLink } from 'lucide-react';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl, type ServerMovie } from '@/film/filmApi';
import { apiContinue, epCoverUrl, type Episode } from '@/podcasts/podcastApi';

const Row = ({ cover, title, sub }: { cover?: string; title: string; sub: string }) => (
  <div className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left">
    <div className="h-10 w-10 shrink-0 rounded-lg overflow-hidden grid place-items-center"
      style={{ background: cover ? `center/cover no-repeat url(${cover})` : 'linear-gradient(160deg,#2b2440,#12101f)' }}>
      {!cover && <Clapperboard size={16} color="rgba(255,255,255,0.35)" />}
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[13px] font-bold text-white">{title}</p>
      <p className="truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>{sub}</p>
    </div>
    <ExternalLink size={14} color="rgba(255,255,255,0.35)" />
  </div>
);

export const QuickActionsWatch = () => {
  const continueWatching = useFilmStore(s => s.continueWatching);
  const loadFilm = useFilmStore(s => s.load);
  const [episodes, setEpisodes] = useState<Episode[]>([]);

  useEffect(() => {
    void loadFilm();
    void apiContinue().then(setEpisodes);
  }, [loadFilm]);

  const openMain = () => window.sky?.quickActions.focusMain();

  if (continueWatching.length === 0 && episodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Clapperboard size={32} color="rgba(255,255,255,0.3)" />
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Продолжить пока нечего</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-2">
      {continueWatching.length > 0 && (
        <section className="mb-3">
          <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>Продолжить просмотр</p>
          {continueWatching.slice(0, 5).map((m: ServerMovie) => (
            <button key={m.id} type="button" onClick={openMain} className="block w-full">
              <Row cover={m.hasPoster ? posterUrl(m.id) : undefined} title={m.title} sub={m.year ? String(m.year) : 'Кино'} />
            </button>
          ))}
        </section>
      )}
      {episodes.length > 0 && (
        <section>
          <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>Продолжить прослушивание</p>
          {episodes.slice(0, 5).map(ep => (
            <button key={ep.id} type="button" onClick={openMain} className="block w-full">
              <Row cover={ep.hasCover ? epCoverUrl(ep.id) : undefined} title={ep.title} sub={ep.podcastTitle ?? 'Подкаст'} />
            </button>
          ))}
        </section>
      )}
      <p className="px-2 pt-2 text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>Открывает Sky на весь экран — смотреть и слушать здесь негде.</p>
    </div>
  );
};
