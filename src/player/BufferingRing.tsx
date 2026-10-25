import { usePlayerStore } from './playerStore';

/** Кольцо загрузки песни: показывается на месте значка «пауза», пока файл ещё не заиграл. */
export const useBuffering = () => usePlayerStore(s => s.buffering && s.isPlaying);

export const BufferingRing = ({ size = 20, color = '#fff' }: { size?: number; color?: string }) => (
  <span role="status" aria-label="Загрузка" className="sky-spin inline-block rounded-full"
    style={{ width: size, height: size, border: `${Math.max(2, Math.round(size / 9))}px solid ${color}33`, borderTopColor: color }}/>
);

/** Затемнение с кольцом поверх обложки («логотипа» песни), пока файл грузится. Родителю нужен position: relative/absolute и overflow hidden. */
export const CoverBuffering = ({ size = 18, round }: { size?: number; round?: string }) => {
  const on = useBuffering();
  if (!on) return null;
  return (
    <span className="absolute inset-0 z-10 grid place-items-center" style={{ background: 'rgba(0,0,0,0.5)', borderRadius: round }}>
      <BufferingRing size={size}/>
    </span>
  );
};
