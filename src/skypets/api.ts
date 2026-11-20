import { apiCall, apiBlob } from '@/core/auth/api';

export type Art = { shape?: string; c1?: string; c2?: string; c3?: string; icon?: string; dots?: string[] };
export type View = { scale?: number; x?: number; y?: number; mask?: string };
export type Species = { id: string; name: string; category: string; rarity: string; art: Art; imageId?: string | null; view?: View; maxLevel: number; season?: string | null };
export type Owner = { id: string; name?: string; username?: string };
export type Pet = {
  id: string; name: string; speciesId: string; species: Species | null; skin: { id: string; name: string; rarity: string; art: Art; imageId?: string | null; view?: View } | null;
  level: number; xp: number; xpNeed: number; character: string; shared: boolean; room: string;
  energy: number; satiety: number; health: number; hygiene: number; fun: number; sleeping: boolean; sleepingUntil?: string | null;
  mood: string; needs: string[]; skills: Record<string, { l: number; x: number }>; accessories: { slot: string; itemId: string }[]; source: string; bornAt: string; owners: Owner[]; canEvolve: boolean; favorite?: boolean;
};
export type Egg = { id: string; eggId: string; name: string; kind: string; rarity: string; art: Art; imageId?: string | null; state: string; readyAt?: string | null; touches: number; needTouches: number; hatchSeconds: number; ready: boolean; secondsLeft: number | null; ownerId: string; partnerId?: string | null; owner?: Owner; partner?: Owner | null; source: string };
export type Item = { id: string; kind: string; name: string; rarity: string; art: Art; imageId?: string | null; effect: Record<string, any> };
export type InvRow = { itemId: string; qty: number; item: Item | null };
export type Invite = { id: string; direction: 'in' | 'out'; from: Owner; to: Owner; egg: { id: string; name: string; art: Art }; createdAt: string };
export type Overview = { player: { coins: number; visitPolicy: string; notify: string; dailyAvailable: boolean }; pets: Pet[]; eggs: Egg[]; inventory: InvRow[]; invites: Invite[]; pending: { gifts: number; transfers: number }; season: string };
export type House = { id: string; scope: string; name: string; rooms: string[]; style: Record<string, { wall?: string; floor?: string }>; placed: { uid: string; itemId: string; room: string; x: number; y: number }[]; limit: number; bonuses: Record<string, any> };

export const sp = async <T = any>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> => {
  const r: any = await apiCall(`/api/skypets${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { ok: r.ok ?? (r.status >= 200 && r.status < 300), status: r.status, data: (r.data ?? {}) as any };
};
export const adm = async <T = any>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown) => {
  const r: any = await apiCall(`/api/admin/skypets${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { ok: r.ok ?? (r.status >= 200 && r.status < 300), status: r.status, data: (r.data ?? {}) as T & { error?: string } };
};

const cache = new Map<string, string>();
export const imageUrl = async (id: string, thumb = false): Promise<string | null> => {
  const key = `${id}${thumb ? '-t' : ''}`; const hit = cache.get(key); if (hit) return hit;
  const r = await apiBlob(`/api/skypets/img/${key}`); if (!r.ok || !r.blob) return null;
  const u = URL.createObjectURL(r.blob); cache.set(key, u); return u;
};
export const forgetImage = (id: string) => { for (const k of [id, `${id}-t`]) { const u = cache.get(k); if (u) { URL.revokeObjectURL(u); cache.delete(k); } } };

export const ERR: Record<string, string> = {
  not_found: 'Не найдено', forbidden: 'Нет прав', private: 'Дом закрыт хозяином', not_allowed: 'Этому человеку нельзя', slow_down: 'Не так быстро — попробуйте чуть позже',
  insufficient_coins: 'Не хватает монет', insufficient_points: 'Не хватает баллов', sleeping: 'Питомец спит', too_tired: 'Питомец устал — пусть отдохнёт', too_hungry: 'Питомец голоден',
  already_full: 'Питомец сыт', already_clean: 'Питомец чистый', already_healthy: 'Питомец здоров', not_sleepy: 'Не хочет спать', no_item: 'Нет такого предмета в инвентаре', bad_item: 'Этот предмет сюда не подходит',
  level_too_low: 'Уровень питомца ещё мал', not_ready: 'Ещё не готово', needs_interaction: 'Нужно ещё потрогать яйцо', incubator_full: 'Инкубатор занят (до 3 яиц)', room_locked: 'Комната ещё закрыта', house_full: 'В доме нет места',
  already_claimed: 'Уже получено', already_decided: 'Уже решено', already_invited: 'Приглашение уже отправлено', too_many_invites: 'Слишком много приглашений', name_not_allowed: 'Такое имя нельзя', bad_name: 'Имя слишком короткое',
  not_for_sale: 'Сейчас не продаётся', out_of_season: 'Не сезон', already_owned: 'Уже куплено', rate_limited: 'Слишком часто', background_not_transparent: 'Нужна прозрачность: уберите фон', bad_format: 'Нужен PNG или WebP',
  file_blocked: 'Файл не принят проверкой', file_too_large: 'Файл больше 2 МБ', image_too_small: 'Картинка слишком маленькая', image_too_large: 'Картинка больше 2048 px', self_review: 'Свой материал решает другой человек',
  reason_required: 'Нужна причина (от 5 знаков)', no_image: 'Добавьте картинку или оформление', no_drops: 'Добавьте хотя бы одного питомца в яйцо', bad_state: 'Сейчас так нельзя', not_approved: 'Материал ещё не одобрен',
};
export const errText = (e?: string) => (e ? ERR[e] ?? 'Не получилось' : 'Не получилось');
export const RARITY: Record<string, { name: string; color: string }> = { common: { name: 'Обычный', color: '#9aa4b2' }, rare: { name: 'Редкий', color: '#4aa3ff' }, epic: { name: 'Эпический', color: '#a45cf0' }, legendary: { name: 'Легендарный', color: '#ffb02e' } };
export const MOOD: Record<string, string> = { happy: 'Радуется', calm: 'Спокоен', sad: 'Грустит', hungry: 'Голоден', tired: 'Устал', dirty: 'Хочет мыться', bored: 'Скучает', sick: 'Заболел', sleeping: 'Спит' };
export const CATEGORY: Record<string, string> = { cats: 'Коты', dogs: 'Собаки', rabbits: 'Кролики', bears: 'Медведи', pandas: 'Панды', foxes: 'Лисы', frogs: 'Лягушки', birds: 'Птицы', dragons: 'Драконы', fantasy: 'Фэнтези', space: 'Космос', seasonal: 'Сезонные', exclusive: 'Эксклюзив' };
export const ROOM: Record<string, string> = { living: 'Гостиная', kitchen: 'Кухня', bath: 'Ванная', bed: 'Спальня', play: 'Игровая', garden: 'Сад' };
export const CHARACTER: Record<string, string> = { calm: 'Спокойный', playful: 'Игривый', curious: 'Любопытный', shy: 'Застенчивый', brave: 'Смелый', sleepy: 'Соня', greedy: 'Сластёна' };
export const SKILL: Record<string, string> = { agility: 'Ловкость', intellect: 'Ум', charm: 'Обаяние', strength: 'Сила' };
export const ACTION_LABEL: Record<string, string> = { hatched: 'Вылупился', feed: 'Покормили', play: 'Поиграли', bathe: 'Искупали', sleep: 'Уложили спать', heal: 'Вылечили', walk: 'Прогулка', teach: 'Учили', photo: 'Фото', rename: 'Переименовали', skin: 'Сменили скин', level_up: 'Новый уровень', evolve: 'Эволюция', play_together: 'Игра с гостем', transferred: 'Передан', bought: 'Куплен', deleted: 'Удалён' };
