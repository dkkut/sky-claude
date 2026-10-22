/** Украшения сезонной темы: несколько медленно падающих (или поднимающихся) значков поверх интерфейса. Не ловит нажатия. */
import { useMemo } from 'react';
import { useSettings } from './store';
import { resolveSeason, SEASONS } from './seasons';

const COUNT = 14;

export function SeasonLayer() {
  const { season, seasonDecor, animationsOn } = useSettings((s) => s.settings);
  const id = resolveSeason(season);
  const flakes = useMemo(() => {
    if (!id) return [];
    const p = SEASONS[id].particles;
    // детерминированно, без Math.random: рендер не «прыгает» при обновлении
    return Array.from({ length: COUNT }, (_, i) => ({
      ch: p[i % p.length], x: `${(i * 37 + 11) % 97}%`, s: `${12 + ((i * 7) % 12)}px`,
      d: `${16 + ((i * 5) % 14)}s`, delay: `-${(i * 3) % 20}s`, sway: `${((i % 5) - 2) * 16}px`,
    }));
  }, [id]);
  if (!id || !seasonDecor || !animationsOn || document.documentElement.dataset.forceDark === '1') return null;
  return (
    <div className="sky-season-layer" aria-hidden="true" data-rise={SEASONS[id].rise ? '1' : ''} translate="no">
      {flakes.map((f, i) => (
        <span key={i} className="sky-flake" style={{ ['--x' as string]: f.x, ['--s' as string]: f.s, ['--d' as string]: f.d, ['--delay' as string]: f.delay, ['--sway' as string]: f.sway }}>{f.ch}</span>
      ))}
    </div>
  );
}
