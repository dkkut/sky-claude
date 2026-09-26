/* ===========================================================
   SKY TV — Библиотека
   Того, что реально сохранено и продолжается — с тех же ручек,
   что и десктопная src/library/libraryData.ts (реальные избранное/
   история/«продолжить»/полка четырёх модулей, ничего не выдумано).

   Музыка и подкасты запускаются прямо здесь — через тот же
   usePlayerStore/usePodcastPlayer, что и остальной Sky TV: свой
   элемент <audio> здесь не заводится. Кино (Sky Film) уходит в
   плеер TVShell тем же путём, что и из каталога/поиска.

   Книги (Sky Books) на самом ТВ читать/слушать пока негде — на
   телевизоре нет экрана книжного плеера (текст+аудиокнига), заводить
   его здесь ради одной карточки было бы отдельной большой фичей.
   Поэтому книги показаны как есть (что на полке), но не как
   TVFocusable — пульт их просто не видит, там нечего нажимать,
   вместо тупика. Прочитать/дослушать можно с телефона или сайта.
=========================================================== */
import { useEffect, useMemo } from 'react';
import { BookmarkCheck, BookOpen } from 'lucide-react';
import { useLibraryItems, type ContentItem, type LibKind } from '@/library/libraryData';
import { TVCarousel } from './TVCarousel';
import { TVCard } from './TVCard';
import { tvFocusManager } from './focusManager';
import { useTVRestoreState } from './tvNavStore';

const KIND_LABEL: Record<LibKind, string> = { music: 'Музыка', video: 'Кино', podcast: 'Подкасты', book: 'Книги' };

interface TVLibraryProps { onPlayMovie: (movieId: string) => void }

export const TVLibrary = ({ onPlayMovie }: TVLibraryProps) => {
  const { items, loading, play } = useLibraryItems();
  const { lastFocusedId } = useTVRestoreState();

  useEffect(() => { tvFocusManager.focusDefault(lastFocusedId); }, [items]);

  const continuing = useMemo(() => items.filter(i => i.progress != null && i.progress > 0 && i.progress < 1).slice(0, 14), [items]);
  const byKind = (k: LibKind) => items.filter(i => i.type === k);
  const music = useMemo(() => byKind('music'), [items]);
  const podcasts = useMemo(() => byKind('podcast'), [items]);
  const videos = useMemo(() => byKind('video'), [items]);
  const books = useMemo(() => byKind('book'), [items]);

  const open = (item: ContentItem) => {
    if (item.type === 'video') { onPlayMovie(item.realId); return; }
    play(item);
  };

  if (loading && items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <BookmarkCheck size={40} color="var(--t3)"/>
        <p className="text-xl font-bold" style={{ color: 'var(--t1)' }}>Загружаем библиотеку…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <BookmarkCheck size={40} color="var(--t3)"/>
        <p className="text-xl font-bold" style={{ color: 'var(--t1)' }}>Библиотека пока пуста</p>
        <p className="text-sm" style={{ color: 'var(--t3)' }}>Сохранённое и «продолжить» появятся здесь</p>
      </div>
    );
  }

  const card = (i: ContentItem, aspect: 'wide' | 'poster', prefix: string, p?: number) => (
    <TVCard key={i.id} id={`${prefix}-${i.id}`} title={i.title} subtitle={i.subtitle ?? KIND_LABEL[i.type]}
      imageUrl={i.coverUrl} aspect={aspect} onEnter={() => open(i)} autoFocusPriority={p}/>
  );

  return (
    <div className="px-10 pt-6 pb-10">
      {continuing.length > 0 && (
        <TVCarousel title="Продолжить" items={continuing} getId={i => i.id} rowAutoFocusPriority={0}
          renderItem={(i, p) => card(i, i.type === 'video' ? 'wide' : 'poster', 'cont', p)}/>
      )}
      {music.length > 0 && (
        <TVCarousel title="Музыка" items={music} getId={i => i.id}
          rowAutoFocusPriority={continuing.length === 0 ? 0 : undefined}
          renderItem={(i, p) => card(i, 'poster', 'mus', p)}/>
      )}
      {podcasts.length > 0 && (
        <TVCarousel title="Подкасты" items={podcasts} getId={i => i.id}
          renderItem={(i, p) => card(i, 'poster', 'pod', p)}/>
      )}
      {videos.length > 0 && (
        <TVCarousel title="Кино" items={videos} getId={i => i.id}
          renderItem={(i, p) => card(i, 'wide', 'vid', p)}/>
      )}
      {books.length > 0 && (
        <div className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <p className="text-[18px] font-bold" style={{ color: 'var(--t1)' }}>Книги</p>
            <span className="text-[13px]" style={{ color: 'var(--t3)' }}>· читать и слушать можно с телефона или сайта</span>
          </div>
          <div className="flex gap-5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {books.map(b => (
              <div key={b.id} className="shrink-0" style={{ width: 160, opacity: 0.75 }}>
                <div className="mb-2 overflow-hidden rounded-xl" style={{ aspectRatio: '2/3', background: `linear-gradient(135deg,${b.coverGrad[0]},${b.coverGrad[1]})` }}>
                  {b.coverUrl
                    ? <img src={b.coverUrl} alt="" className="h-full w-full object-cover"/>
                    : <div className="grid h-full w-full place-items-center"><BookOpen size={28} color="rgba(255,255,255,0.7)"/></div>}
                </div>
                <p className="truncate text-[14px] font-semibold" style={{ color: 'var(--t1)' }}>{b.title}</p>
                <p className="truncate text-[12px]" style={{ color: 'var(--t3)' }}>{b.subtitle}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
