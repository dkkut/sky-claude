/* ===========================================================
   SKY TV — сериалы: список и страница сериала (сезоны, серии).
   Данные — тот же сервер, что у телефона и ПК (`/api/film/series*`).
=========================================================== */
import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { TVCard } from './TVCard';
import { TVFocusable } from './TVFocusable';
import { tvFocusManager } from './focusManager';
import { useTVRestoreState } from './tvNavStore';
import { posterUrl, type ServerMovie } from '@/film/filmApi';
import { apiSeriesCatalog, apiSeries, type ServerSeries, type SeriesFull } from '@/film/seriesApi';

export const TVSeriesHub = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const { lastFocusedId } = useTVRestoreState();
  const [list, setList] = useState<ServerSeries[] | null>(null);
  useEffect(() => { let a = true; void apiSeriesCatalog().then(l => { if (a) setList(l); }); return () => { a = false; }; }, []);
  useEffect(() => { if (list?.length) tvFocusManager.focusDefault(lastFocusedId); }, [list]);
  if (list === null) return <div className="flex h-full items-center justify-center text-xl" style={{ color: 'var(--t3)' }}>Загрузка…</div>;
  if (!list.length) return <div className="flex h-full flex-col items-center justify-center gap-2"><p className="text-xl font-bold" style={{ color: 'var(--t1)' }}>Сериалов пока нет</p></div>;
  return (
    <div className="px-10 pt-6 pb-10 flex flex-wrap gap-x-5 gap-y-7">
      {list.map((s, i) => (
        <TVCard key={s.id} id={`ser-${s.id}`} title={s.title} subtitle={`${s.seasons} сез. · ${s.episodes} сер.`}
          imageUrl={s.posterMovieId ? posterUrl(s.posterMovieId) : undefined}
          onEnter={() => onOpen(s.id)} autoFocusPriority={i === 0 ? 0 : undefined}/>
      ))}
    </div>
  );
};

export const TVSeriesDetail = ({ seriesId, onPlay }: { seriesId: string; onPlay: (episodeId: string) => void }) => {
  const [data, setData] = useState<SeriesFull | null | undefined>(undefined);
  const [season, setSeason] = useState(0);
  const { lastFocusedId } = useTVRestoreState();
  useEffect(() => {
    let a = true;
    void apiSeries(seriesId).then(d => {
      if (!a) return;
      setData(d);
      const idx = d?.resume ? d.seasons.findIndex(s => s.episodes.some(e => e.id === d.resume!.episodeId)) : 0;
      setSeason(Math.max(0, idx));
    });
    return () => { a = false; };
  }, [seriesId]);
  useEffect(() => { if (data) tvFocusManager.focusDefault(lastFocusedId); }, [data]);

  if (data === undefined) return <div className="flex h-full items-center justify-center text-xl" style={{ color: 'var(--t3)' }}>Загрузка…</div>;
  if (!data) return <div className="flex h-full items-center justify-center text-xl" style={{ color: 'var(--t1)' }}>Сериал не найден</div>;
  const s = data.series, cur = data.seasons[season];
  const resumeEp = data.resume?.episodeId;
  const first: ServerMovie | undefined = data.seasons[0]?.episodes[0];
  return (
    <div className="px-10 pt-8 pb-12">
      <h1 className="text-[40px] font-extrabold" style={{ color: 'var(--t1)' }} translate="no">{s.title}</h1>
      <p className="mt-1 text-[18px]" style={{ color: 'var(--t3)' }}>{[s.genre, s.year, `${s.seasons} сез.`, `${s.episodes} сер.`].filter(Boolean).join(' · ')}</p>
      {s.description && <p className="mt-3 max-w-[900px] text-[18px]" style={{ color: 'var(--t2)' }} translate="no">{s.description}</p>}
      {(resumeEp || first) && (
        <div className="mt-5">
          <TVFocusable id="ser-play" autoFocusPriority={0} onEnter={() => onPlay(resumeEp ?? first!.id)}>
            {({ focused }) => (
              <div className="inline-flex items-center gap-3 rounded-2xl px-7 py-4 text-[22px] font-bold text-white" style={{ background: 'var(--accent)', boxShadow: focused ? '0 0 0 4px #b3a7ff' : 'none' }}>
                <Play size={24} fill="#fff"/> {data.resume && !data.resume.fresh ? 'Продолжить' : 'Смотреть'}
              </div>
            )}
          </TVFocusable>
        </div>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        {data.seasons.map((se, i) => (
          <TVFocusable key={se.id} id={`ser-season-${se.id}`} onEnter={() => setSeason(i)}>
            {({ focused }) => (
              <div className="rounded-full px-5 py-2 text-[18px] font-bold" style={{ background: i === season ? 'var(--accent)' : 'rgba(255,255,255,0.1)', color: '#fff', boxShadow: focused ? '0 0 0 3px #b3a7ff' : 'none' }}>
                {se.title || `Сезон ${se.number}`}
              </div>
            )}
          </TVFocusable>
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-3 max-w-[1000px]">
        {cur?.episodes.map(e => (
          <TVFocusable key={e.id} id={`ser-ep-${e.id}`} onEnter={() => onPlay(e.id)}>
            {({ focused }) => (
              <div className="flex items-center gap-4 rounded-2xl px-5 py-3 text-[20px]" style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', boxShadow: focused ? '0 0 0 3px #b3a7ff' : 'none' }}>
                <span className="w-10 font-bold" style={{ color: 'var(--t3)' }}>{e.epNo ?? ''}</span>
                <span className="flex-1" translate="no">{e.title}</span>
                {e.id === resumeEp && <span className="text-[16px]" style={{ color: 'var(--accent)' }}>{data.resume?.fresh ? 'Начать' : 'Продолжить'}</span>}
              </div>
            )}
          </TVFocusable>
        ))}
        {!cur?.episodes.length && <p className="text-[18px]" style={{ color: 'var(--t3)' }}>В сезоне пока нет серий</p>}
      </div>
    </div>
  );
};
