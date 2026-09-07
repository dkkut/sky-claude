/**
 * Поиск людей на сервере с задержкой и отменой.
 *
 * Задержка — чтобы на каждую букву не уходил запрос; отмена — чтобы
 * ответ на «lu» не перезаписал ответ на «luna», придя позже него.
 */
import { useEffect, useState } from 'react';
import { apiSearchPeople, type DirectoryPerson } from '@/core/auth/api';

const DEBOUNCE_MS = 250;
/** Сервер всё равно не отвечает на однобуквенный запрос. */
const MIN_LEN = 2;

export const usePeopleSearch = (query: string) => {
  const [people, setPeople]   = useState<DirectoryPerson[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim().replace(/^@/, '');
    if (q.length < MIN_LEN) { setPeople([]); setLoading(false); return; }

    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      const res = await apiSearchPeople(q);
      if (!alive) return;
      setPeople(res.ok ? (res.data?.people ?? []) : []);
      setLoading(false);
    }, DEBOUNCE_MS);

    return () => { alive = false; clearTimeout(timer); };
  }, [query]);

  return { people, loading };
};
