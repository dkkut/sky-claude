/**
 * Сколько книг ждёт проверки — для значка на вкладке админ-панели.
 *
 * Очередь сервер отдаёт только администратору с правом content,
 * поэтому у обычного человека здесь всегда ноль — это не сокрытие
 * на клиенте, а отказ сервера.
 */
import { useState, useEffect } from 'react';
import { apiModerationQueue } from './booksApi';

export const useBookPendingCount = () => {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    void apiModerationQueue().then((q) => { if (alive) setN(q?.length ?? 0); });
    return () => { alive = false; };
  }, []);
  return n;
};
