/* ===========================================================
   SKY TV — общая сетка каталога (Фильмы / Избранное)
=========================================================== */
import { useEffect, useState } from 'react';
import { TVCard } from './TVCard';
import { tvFocusManager } from './focusManager';
import { useTVRestoreState } from './tvNavStore';

interface Item { id: string; title: string; subtitle?: string; imageUrl?: string; rating?: number }

interface TVCatalogGridProps {
  items: Item[];
  onOpen: (id: string) => void;
  emptyTitle: string;
  emptySub?: string;
}

/* Каталог у Sky Film растёт (десятки/сотни фильмов), а это плоская
   сетка, не карусель с готовым окном рендера (TVCarousel). Рендерить
   разом всё — на слабом Smart TV браузере заметно тормозит саму
   раскладку flex-wrap. Показываем страницами и подгружаем следующую,
   когда фокус пультом подходит к концу уже показанного — так же, как
   листают ленты в остальном Sky TV, просто без явной кнопки «ещё». */
const PAGE = 30;

export const TVCatalogGrid = ({ items, onOpen, emptyTitle, emptySub }: TVCatalogGridProps) => {
  const { lastFocusedId } = useTVRestoreState();
  // Если возвращаемся туда, где фокус был глубже первой страницы (Back
  // из деталей фильма посреди прокрученного каталога) — сразу открываем
  // достаточно страниц, а не откатываем на первую и «теряем» позицию.
  const [visible, setVisible] = useState(() => {
    if (!lastFocusedId) return PAGE;
    const idx = items.findIndex(it => `grid-${it.id}` === lastFocusedId);
    return idx >= 0 ? Math.min(items.length, Math.ceil((idx + 1) / PAGE) * PAGE) : PAGE;
  });
  useEffect(() => { tvFocusManager.focusDefault(lastFocusedId); }, []);
  useEffect(() => { setVisible(PAGE); }, [items]);

  useEffect(() => {
    const check = () => {
      const id = tvFocusManager.getFocusedId();
      if (!id?.startsWith('grid-')) return;
      const idx = items.findIndex(it => `grid-${it.id}` === id);
      if (idx >= 0 && idx > visible - 6) setVisible(v => Math.min(items.length, v + PAGE));
    };
    const unsub = tvFocusManager.subscribe(check);
    return () => { unsub(); };
  }, [items, visible]);

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-xl font-bold" style={{ color: 'var(--t1)' }}>{emptyTitle}</p>
        {emptySub && <p className="text-sm" style={{ color: 'var(--t3)' }}>{emptySub}</p>}
      </div>
    );
  }

  return (
    <div className="px-10 pt-6 pb-10 flex flex-wrap gap-x-5 gap-y-7">
      {items.slice(0, visible).map((it, i) => (
        <TVCard key={it.id} id={`grid-${it.id}`} title={it.title} subtitle={it.subtitle} imageUrl={it.imageUrl} rating={it.rating}
          onEnter={() => onOpen(it.id)} autoFocusPriority={i === 0 ? 0 : undefined}/>
      ))}
    </div>
  );
};
