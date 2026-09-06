/* ===========================================================
   SKY TV — общая сетка каталога (Фильмы / Избранное)
=========================================================== */
import { useEffect } from 'react';
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

export const TVCatalogGrid = ({ items, onOpen, emptyTitle, emptySub }: TVCatalogGridProps) => {
  const { lastFocusedId } = useTVRestoreState();
  useEffect(() => { tvFocusManager.focusDefault(lastFocusedId); }, []);

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
      {items.map((it, i) => (
        <TVCard key={it.id} id={`grid-${it.id}`} title={it.title} subtitle={it.subtitle} imageUrl={it.imageUrl} rating={it.rating}
          onEnter={() => onOpen(it.id)} autoFocusPriority={i === 0 ? 0 : undefined}/>
      ))}
    </div>
  );
};
