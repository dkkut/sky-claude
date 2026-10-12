/* Лента вкладок админки со стрелками: на узком окне часть вкладок уходит за край, и без стрелок их не найти.
   Стрелка видна только в ту сторону, куда ещё можно прокрутить; колесо мыши тоже листает ленту вбок. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const arrow = {
  background: 'var(--bg-l3)', color: 'var(--t1)', border: '1px solid var(--border)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
} as const;

export const ScrollTabs = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => {
  const box = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);

  const measure = useCallback(() => {
    const el = box.current; if (!el) return;
    setLeft(el.scrollLeft > 4);
    setRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    measure();
    const el = box.current; if (!el) return undefined;
    const ro = new ResizeObserver(measure); ro.observe(el);
    const mo = new MutationObserver(measure); mo.observe(el, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', measure); };
  }, [measure]);

  const go = (dir: -1 | 1) => {
    const el = box.current; if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.6), behavior: 'smooth' });
  };
  const onWheel = (e: React.WheelEvent) => {
    const el = box.current;
    if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY;
  };

  return (
    <div className="relative">
      <div ref={box} onScroll={measure} onWheel={onWheel}
        className={`flex gap-1 overflow-x-auto ${className}`} style={{ scrollbarWidth: 'none' }}>
        {children}
      </div>
      {left && (
        <button type="button" aria-label="Прокрутить влево" onClick={() => go(-1)}
          className="absolute left-0 top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full" style={arrow}>
          <ChevronLeft size={15} />
        </button>
      )}
      {right && (
        <button type="button" aria-label="Прокрутить вправо" onClick={() => go(1)}
          className="absolute right-0 top-1/2 z-10 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full" style={arrow}>
          <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
};
