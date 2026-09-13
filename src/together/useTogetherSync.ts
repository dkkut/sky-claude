/**
 * Держать плеер в строю с остальными.
 *
 * Один механизм на оба вида сессии. Кино и музыка отличаются только
 * ручкой (PlayerHandle), которую сюда передают: сам порядок сверки,
 * поправка на часы и способ догонять — общие. Второго такого механизма
 * в проекте нет и заводить его не нужно.
 *
 * Что происходит по кругу:
 *
 *   1. Четыре раза в секунду сверяемся с плеером и, если разошлись,
 *      подтягиваем — скоростью при малом расхождении, перемоткой при
 *      большом. Подробности выбора — в correctOnce.
 *
 *   2. Раз в десять секунд спрашиваем сервер, где полагается быть.
 *      Это и есть «периодическая пересинхронизация»: без неё
 *      расхождение копилось бы у того, чей плеер подтормаживает, и
 *      исправлялось бы только при следующем нажатии кнопки.
 *
 *   3. Сменился номер записи в очереди — переключаем запись у плеера.
 */
import { useEffect, useRef } from 'react';
import {
  useTogetherStore, sendTogether, correctOnce, TICK_MS, RESYNC_MS,
  type PlayerHandle,
} from './togetherState';

export const useTogetherSync = (sessionId: string | null, handle: PlayerHandle | null, enabled = true) => {
  /* Ручка держится в ref: она пересоздаётся на каждой отрисовке, и без
     этого таймеры перезапускались бы по четыре раза в секунду. */
  const handleRef = useRef<PlayerHandle | null>(handle);
  handleRef.current = handle;

  const lastIndex = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    /* Первым делом — сверка: она же измеряет расхождение часов, и до
       неё все расчёты позиции идут с нулевой поправкой. */
    sendTogether(sessionId, 'sync');

    const tick = window.setInterval(() => {
      const h = handleRef.current;
      const { playback, skewMs } = useTogetherStore.getState();
      if (!h || !playback) return;
      if (playback.status !== 'live') return;

      /* Смена записи в очереди. Сначала переключаем, потом выравниваем
         позицию: иначе перемотка уйдёт в ещё не открытый файл. */
      const idx = playback.queueIndex;
      const want = playback.queue[idx]?.id ?? null;
      const now = h.currentId?.() ?? null;
      if (want && (lastIndex.current !== idx || (now !== null && now !== want))) {
        lastIndex.current = idx;
        h.setTrack?.(idx, want);
        return;
      }

      correctOnce(h, playback, skewMs);
    }, TICK_MS);

    const resync = window.setInterval(() => sendTogether(sessionId, 'sync'), RESYNC_MS);

    /* Вернулись на вкладку — сверяемся немедленно. Пока вкладка была
       в фоне, браузер придерживал таймеры, и расхождение накопилось. */
    const onVisible = () => { if (!document.hidden) sendTogether(sessionId, 'sync'); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(tick);
      clearInterval(resync);
      document.removeEventListener('visibilitychange', onVisible);
      /* Скорость возвращаем свою: подтянутая под чужой строй скорость
         не должна остаться в обычном плеере после выхода. */
      handleRef.current?.setRate(1);
    };
  }, [sessionId, enabled]);
};
