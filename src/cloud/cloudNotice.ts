/**
 * Заглушки Sky Gaming Cloud и Sky Cloud: уведомление на существующем Sky Island.
 * Свой остров не заводим — события кладутся в общую очередь (`useIslandStore`), поэтому действуют все правила острова
 * (приоритеты, склейка по mergeKey, уважение к «уменьшить анимацию», настройка «Остров / сбоку»).
 *
 * Поведение: остров появляется компактным, через ~0,6 с раскрывается, ещё через ~5 с сворачивается и сам уходит по ttl.
 * Повторить можно кнопкой на странице. Формулировки — «временно недоступно / готовим запуск», не авария.
 */
import { useEffect, useRef } from 'react';
import { useIslandStore } from '@/island/islandStore';

export type CloudService = 'gaming' | 'cloud';

/** Когда сервис запустят, достаточно сменить `live` и вместо заглушки подключить настоящий экран. */
export const CLOUD_SERVICES: Record<CloudService, { live: boolean; key: string; title: string; body: string; color: string }> = {
  gaming: { live: false, key: 'cloud:gaming', title: 'Sky Gaming Cloud', body: 'Облачный гейминг временно недоступен. Мы работаем над запуском сервиса.', color: '#8b5cf6' },
  cloud:  { live: false, key: 'cloud:cloud',  title: 'Sky Cloud',        body: 'Облачные сервисы временно недоступны. Мы готовим инфраструктуру к запуску.', color: '#4f6ef7' },
};

const OPEN_AFTER_MS = 600;
const OPEN_FOR_MS = 5000;
const TTL_MS = 9000;

export const useCloudNotice = (service: CloudService) => {
  const timers = useRef<number[]>([]);

  const show = () => {
    const s = CLOUD_SERVICES[service];
    const st = useIslandStore.getState();
    timers.current.forEach((t) => window.clearTimeout(t)); timers.current = [];
    // mergeKey: повторный показ обновляет то же событие, а не плодит дубли.
    st.push({ kind: 'system', mergeKey: s.key, title: s.title, body: s.body, color: s.color, ttl: TTL_MS });
    timers.current.push(window.setTimeout(() => {
      if (useIslandStore.getState().current?.mergeKey === s.key) useIslandStore.getState().setExpanded(true);
    }, OPEN_AFTER_MS));
    timers.current.push(window.setTimeout(() => {
      const c = useIslandStore.getState();
      if (c.current?.mergeKey === s.key && c.expanded && !c.holding) c.setExpanded(false);
    }, OPEN_AFTER_MS + OPEN_FOR_MS));
  };

  // Один раз при открытии вкладки; перерисовки страницы анимацию не запускают.
  useEffect(() => {
    show();
    const key = CLOUD_SERVICES[service].key;
    return () => { timers.current.forEach((t) => window.clearTimeout(t)); useIslandStore.getState().resolve(key); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);

  return show;
};
