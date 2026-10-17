/**
 * Опрос, который не работает в скрытой вкладке (экономия запросов и батареи).
 * `setInterval(visibleTick(fn), ms)`: пока вкладка скрыта, тики пропускаются; как только она снова видна,
 * пропущенные функции вызываются один раз — данные обновляются сразу, а не через полный период.
 */
const missed = new Set<() => void>();
let bound = false;
const bind = () => {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const list = [...missed]; missed.clear();
    for (const f of list) { try { f(); } catch { /* опрос не должен ронять остальные */ } }
  });
};
export const visibleTick = (fn: () => unknown): (() => void) => {
  bind();
  const run = () => { void fn(); };
  return () => { if (typeof document !== 'undefined' && document.hidden) { missed.add(run); return; } run(); };
};
