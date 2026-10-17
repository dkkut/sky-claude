/**
 * Несколько Sky ID на одном устройстве (до 3).
 *
 * У каждого Sky ID на устройстве свой «слот» 1–3: у браузера это отдельная HttpOnly-кука (`sky_rt`, `sky_rt2`, `sky_rt3`),
 * у родного приложения — отдельный ключ в защищённом хранилище. Токены скрипту страницы по-прежнему не видны: здесь лежит только
 * безопасная «подпись» слота (почта/номер для показа, имя, аватар), чтобы нарисовать список. Номер слота уходит на сервер
 * заголовком X-Sky-Slot; сервер сам выбирает нужную куку. Слотов больше трёх нет — сервер приводит любой другой номер к первому.
 */
export const MAX_SLOTS = 3;
export type Slot = 1 | 2 | 3;
export interface SlotMeta { slot: Slot; skyId: string; label: string; name: string; avatar?: string }

const LIST = 'sky:auth:slots:v1';
const ACTIVE = 'sky:auth:slot';
const ADDING = 'sky:auth:adding';

const norm = (n: unknown): Slot => (n === 2 || n === '2' ? 2 : n === 3 || n === '3' ? 3 : 1);

export const getActiveSlot = (): Slot => { try { return norm(localStorage.getItem(ACTIVE)); } catch { return 1; } };
export const setActiveSlot = (n: Slot) => { try { localStorage.setItem(ACTIVE, String(n)); } catch { /* без хранилища остаётся первый слот */ } };

export const listSlots = (): SlotMeta[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(LIST) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x) => x && [1, 2, 3].includes(x.slot) && typeof x.skyId === 'string').map((x) => ({ slot: norm(x.slot), skyId: x.skyId, label: String(x.label ?? ''), name: String(x.name ?? ''), avatar: x.avatar || undefined })).sort((a, b) => a.slot - b.slot) : [];
  } catch { return []; }
};
const save = (l: SlotMeta[]) => { try { localStorage.setItem(LIST, JSON.stringify(l)); } catch { /* ок */ } };

/** Записать/обновить подпись слота. Тот же Sky ID в другом слоте не дублируем: старая запись заменяется. */
export const upsertSlot = (m: SlotMeta) => save([...listSlots().filter((x) => x.slot !== m.slot && x.skyId !== m.skyId), m].sort((a, b) => a.slot - b.slot));
export const removeSlot = (slot: Slot) => save(listSlots().filter((x) => x.slot !== slot));
export const freeSlot = (): Slot | null => ([1, 2, 3] as Slot[]).find((n) => !listSlots().some((x) => x.slot === n)) ?? null;

/** Ключ refresh-токена в хранилище родного приложения: у первого слота прежний, чтобы уже вошедшие не вышли после обновления. */
export const refreshKeyFor = (base: string, slot: Slot = getActiveSlot()) => (slot === 1 ? base : `${base}:${slot}`);

/** «Добавляю ещё один Sky ID»: помним, в какой слот вернуться при отмене (на время вкладки). */
export const startAdding = (prev: Slot) => { try { sessionStorage.setItem(ADDING, String(prev)); } catch { /* ок */ } };
export const addingFrom = (): Slot | null => { try { const v = sessionStorage.getItem(ADDING); return v ? norm(v) : null; } catch { return null; } };
export const stopAdding = () => { try { sessionStorage.removeItem(ADDING); } catch { /* ок */ } };
