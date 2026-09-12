/**
 * Сколько заявок на подкасты ждёт решения — для значка на вкладке
 * админ-панели.
 *
 * Отдельным файлом от самой панели: рядом с компонентами он ломает
 * быструю перерисовку при правке, а нужен он в другом модуле.
 *
 * Очередь сервер отдаёт только администратору, поэтому у обычного
 * человека здесь всегда ноль — и это не показное сокрытие, а отказ
 * сервера.
 */
import { useState, useEffect } from 'react';
import { apiModerationQueue } from './podcastApi';

export const usePodcastPendingCount = () => {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    void apiModerationQueue().then((q) => { if (alive) setN(q?.length ?? 0); });
    return () => { alive = false; };
  }, []);
  return n;
};
