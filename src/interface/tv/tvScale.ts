import { useEffect, useState } from 'react';

/** Коэффициент масштаба TV-интерфейса: рассчитан на 1600×900 CSS-пикселей, дальше подстраивается под экран. */
export const useTvScale = () => {
  const calc = () => Math.max(0.75, Math.min(1.7, Math.min(window.innerWidth / 1600, window.innerHeight / 900)));
  const [k, setK] = useState(calc);
  useEffect(() => {
    const on = () => setK(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return k;
};
