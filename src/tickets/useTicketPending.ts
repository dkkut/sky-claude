/**
 * Сколько мероприятий ждёт проверки — для значка на вкладке админ-панели.
 *
 * Отдельным файлом от самой панели: рядом с компонентами он ломает
 * быструю перерисовку при правке, а нужен он в другом модуле.
 *
 * Очередь сервер отдаёт только администратору, поэтому у обычного
 * человека здесь всегда ноль — и это не показное сокрытие, а отказ
 * сервера.
 */
import { useEffect, useState } from 'react';
import { apiModerationQueue } from './ticketsApi';

export const useTicketPendingCount = () => {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    void apiModerationQueue().then(list => { if (alive) setN(list.length); });
    return () => { alive = false; };
  }, []);
  return n;
};
