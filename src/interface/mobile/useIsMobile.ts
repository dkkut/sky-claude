import { useEffect, useState } from 'react';

// Узкое окно ИЛИ сенсорное устройство без мыши (телефон/планшет) любой ориентации:
// при повороте ширина телефона выходит за 860px, и раньше открывалась ПК-версия.
const QUERY = '(max-width: 860px), (hover: none) and (pointer: coarse) and (max-width: 1400px)';

/** Определяет мобильный/планшетный формфактор по ширине вьюпорта.
 *  860px — работает и для «больших» смартфонов в альбомной ориентации,
 *  и для маленьких планшетов, не ломая ПК-раскладку на реальных десктопах. */
export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(QUERY).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
};

/** Груба эвристика «это touch-устройство», не привязанная к ширине —
 *  полезно, когда нужно включить touch-жесты даже на широком планшете. */
export const isTouchDevice = () =>
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
