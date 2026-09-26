/* ===========================================================
   SKY CAR MODE — Кино (черновик, работа приостановлена).
   Экран ещё предстоит собрать на useFilmStore (@/film/serverStore):
   continueWatching/saved, открытие через уже существующий TVPlayer
   (см. CarShell.tsx) — без второго видеоплеера.
=========================================================== */
import type { TVPlayerSource } from '@/interface/tv/TVPlayer';

export const CarCinema = (_props: { onPlay: (source: TVPlayerSource) => void }) => (
  <div className="flex h-full items-center justify-center">
    <p className="text-[15px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Экран в разработке</p>
  </div>
);
