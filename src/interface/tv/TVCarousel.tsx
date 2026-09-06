/* ===========================================================
   SKY TV — TVCarousel
   Горизонтальный ряд контента. Автоскролл к сфокусированной карточке,
   и ограничение числа одновременно отрисованных карточек (пункт 12 ТЗ —
   производительность на слабых Smart TV) через простое окно рендера.
=========================================================== */
import { useEffect, useRef, useState } from 'react';
import { tvFocusManager } from './focusManager';

const RENDER_WINDOW = 14; // сколько карточек реально держим в DOM за раз

interface TVCarouselProps<T> {
  title: string;
  items: T[];
  getId: (item: T) => string;
  renderItem: (item: T, autoFocusPriority?: number) => React.ReactNode;
  rowAutoFocusPriority?: number; // приоритет для первой карточки этого ряда
}

export function TVCarousel<T>({ title, items, getId, renderItem, rowAutoFocusPriority }: TVCarouselProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [windowStart, setWindowStart] = useState(0);

  /* Отслеживаем, какая карточка ЭТОГО ряда сейчас в фокусе, чтобы
     проскроллить к ней и, при необходимости, сдвинуть окно рендера. */
  useEffect(() => {
    const ids = new Set(items.map(getId));
    const check = () => {
      const focusedId = tvFocusManager.getFocusedId();
      if (!focusedId || !ids.has(focusedId)) return;
      const idx = items.findIndex(it => getId(it) === focusedId);
      if (idx < 0) return;
      // держим окно рендера вокруг текущего фокуса
      setWindowStart(w => {
        if (idx < w) return Math.max(0, idx - 2);
        if (idx > w + RENDER_WINDOW - 3) return Math.max(0, idx - RENDER_WINDOW + 3);
        return w;
      });
      const el = trackRef.current?.querySelector<HTMLElement>(`[data-tv-focusable="${focusedId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    };
    const unsub = tvFocusManager.subscribe(check);
    return () => { unsub(); };
  }, [items, getId]);

  if (items.length === 0) return null;
  const visible = items.slice(windowStart, windowStart + RENDER_WINDOW);

  return (
    <div className="mb-8">
      <p className="mb-3 px-1 text-[20px] font-extrabold" style={{ color: 'var(--t1)' }}>{title}</p>
      <div ref={trackRef} className="flex gap-4 overflow-x-hidden px-1" style={{ scrollBehavior: 'smooth' }}>
        {windowStart > 0 && <div className="shrink-0" style={{ width: 1 }}/>}
        {visible.map((item, i) => (
          <div key={getId(item)}>
            {renderItem(item, windowStart + i === 0 ? rowAutoFocusPriority : undefined)}
          </div>
        ))}
      </div>
    </div>
  );
}
