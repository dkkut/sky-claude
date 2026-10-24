import { usePlayerStore } from './playerStore';

/** Кольцо загрузки песни: показывается на месте значка «пауза», пока файл ещё не заиграл. */
export const useBuffering = () => usePlayerStore(s => s.buffering && s.isPlaying);

export const BufferingRing = ({ size = 20, color = '#fff' }: { size?: number; color?: string }) => (
  <span role="status" aria-label="Загрузка" className="sky-spin inline-block rounded-full"
    style={{ width: size, height: size, border: `${Math.max(2, Math.round(size / 9))}px solid ${color}33`, borderTopColor: color }}/>
);
