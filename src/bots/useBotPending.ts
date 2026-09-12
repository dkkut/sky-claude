/**
 * Сколько ботов ждёт решения — для значка на вкладке админ-панели.
 *
 * Отдельным файлом от самой панели: рядом с компонентами он ломает
 * быструю перерисовку при правке, а нужен он в другом модуле.
 *
 * Очередь сервер отдаёт только администратору, поэтому у обычного
 * человека здесь всегда ноль — и это не показное сокрытие, а отказ
 * сервера.
 */
import { useState, useEffect } from 'react';
import { apiBotModerationQueue } from './botApi';

export const useBotPendingCount = () => {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    void apiBotModerationQueue().then((r) => {
      if (alive) setN(r.ok && r.data ? r.data.bots.length : 0);
    });
    return () => { alive = false; };
  }, []);
  return n;
};
