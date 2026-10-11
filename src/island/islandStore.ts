/**
 * Sky Island — состояние и очередь событий.
 *
 * Машина состояний (видимая часть): hidden → compact → expanded → compact → hidden.
 * Событие живёт ttl миллисекунд (0 — пока его не снимет источник, как у
 * входящего звонка). Таймер ставит и останавливает компонент: пока человек
 * наводит курсор, касается или панель раскрыта, время не идёт.
 *
 * Очередь ограничена, одинаковые события склеиваются по mergeKey, у каждого
 * события есть приоритет; ожидание поднимает его вес, чтобы мелкие не
 * ждали вечно, а слишком старые просто выбрасываются.
 */
import { create } from 'zustand';

export type IslandKind = 'call' | 'ai' | 'message' | 'system' | 'download' | 'track' | 'media';

export const PRIORITY: Record<IslandKind, number> = {
  call: 100, ai: 90, message: 70, media: 50, system: 40, download: 35, track: 20,
};

export interface IslandAction { label: string; run: () => void; primary?: boolean }

export interface IslandEvent {
  id: string;
  kind: IslandKind;
  title: string;
  body?: string;
  /** Пользовательский текст (сообщение, имя) — не переводить. */
  userText?: boolean;
  letter?: string;
  color?: string;
  cover?: string;
  /** Миллисекунды; 0 — без автоскрытия. */
  ttl: number;
  mergeKey?: string;
  count?: number;
  onOpen?: () => void;
  actions?: IslandAction[];
  at: number;
}

export type NewIslandEvent = Omit<IslandEvent, 'id' | 'at'> & { id?: string };

export const QUEUE_MAX = 8;
export const STALE_MS = 60_000;

interface IslandState {
  current: IslandEvent | null;
  queue: IslandEvent[];
  expanded: boolean;
  /** Идёт ли взаимодействие (наведение/касание) — таймер стоит. */
  holding: boolean;
  /** Остров смонтирован в этой оболочке (в ТВ и Car его нет — там плашки показываются как обычно). */
  mounted: boolean;
  push: (e: NewIslandEvent) => void;
  /** Снять событие источника (звонок закончился и т.п.). */
  resolve: (key: string) => void;
  dismiss: (id?: string) => void;
  setExpanded: (v: boolean) => void;
  setHolding: (v: boolean) => void;
  clear: () => void;
}

let seq = 0;
const weight = (e: IslandEvent, now: number) => PRIORITY[e.kind] + Math.min(30, (now - e.at) / 2000);

export const pickNext = (queue: IslandEvent[], now = Date.now()): { next: IslandEvent | null; rest: IslandEvent[] } => {
  const fresh = queue.filter((e) => now - e.at < STALE_MS || e.ttl === 0);
  if (!fresh.length) return { next: null, rest: [] };
  let best = 0;
  for (let i = 1; i < fresh.length; i += 1) if (weight(fresh[i], now) > weight(fresh[best], now)) best = i;
  return { next: fresh[best], rest: fresh.filter((_, i) => i !== best) };
};

const sameSource = (a: IslandEvent, b: IslandEvent) => !!a.mergeKey && a.mergeKey === b.mergeKey;

export const useIslandStore = create<IslandState>((set, get) => ({
  current: null, queue: [], expanded: false, holding: false, mounted: false,

  push: (input) => {
    seq += 1;
    const ev: IslandEvent = { ...input, id: input.id ?? `ie${Date.now()}-${seq}`, at: Date.now() };
    const { current, queue } = get();

    // Тот же источник уже на экране — обновляем на месте, без мигания.
    if (current && sameSource(current, ev)) {
      set({ current: { ...ev, id: current.id, count: (current.count ?? 1) + (ev.kind === 'message' ? 1 : 0) } });
      return;
    }
    const inQueue = queue.findIndex((q) => sameSource(q, ev));
    if (inQueue >= 0) {
      const next = queue.slice();
      next[inQueue] = { ...ev, id: queue[inQueue].id, count: (queue[inQueue].count ?? 1) + (ev.kind === 'message' ? 1 : 0) };
      set({ queue: next });
      return;
    }
    if (!current) { set({ current: ev }); return; }

    // Важное вытесняет менее важное; вытесненное возвращается в очередь.
    if (PRIORITY[ev.kind] > PRIORITY[current.kind] && !(get().expanded && get().holding)) {
      set({ current: ev, expanded: false, queue: [...queue, current].slice(-QUEUE_MAX) });
      return;
    }
    let q = [...queue, ev];
    if (q.length > QUEUE_MAX) {
      const now = Date.now();
      let worst = 0;
      for (let i = 1; i < q.length; i += 1) if (weight(q[i], now) < weight(q[worst], now)) worst = i;
      q = q.filter((_, i) => i !== worst);
    }
    set({ queue: q });
  },

  resolve: (key) => {
    const { current, queue } = get();
    const rest = queue.filter((q) => q.mergeKey !== key);
    if (current?.mergeKey === key) {
      const { next, rest: r2 } = pickNext(rest);
      set({ current: next, queue: r2, expanded: false, holding: false });
    } else if (rest.length !== queue.length) set({ queue: rest });
  },

  dismiss: (id) => {
    const { current, queue } = get();
    if (id && current?.id !== id) { set({ queue: queue.filter((q) => q.id !== id) }); return; }
    const { next, rest } = pickNext(queue);
    set({ current: next, queue: rest, expanded: false, holding: false });
  },

  setExpanded: (v) => set({ expanded: v }),
  setHolding: (v) => set({ holding: v }),
  clear: () => set({ current: null, queue: [], expanded: false, holding: false }),
}));
