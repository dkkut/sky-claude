/* ===============================================================
   SKY PETS + SKY SKIN MARKET — разговор с сервером.

   Ни одна проверка отсюда не заменяет серверную: прогрессия, кулдауны
   ухода, редкость, Pet Coins и покупки считает только сервер
   (server/pets.mjs, server/petEconomy.mjs, server/skinMarket.mjs) —
   этот файл живёт в браузере и только вызывает готовые ручки
   (server/routes/pets.mjs). Клиент никогда не присылает XP, уровень,
   характеристики или результат кулдауна — только «я нажал покормить».
=============================================================== */
import { apiCall } from '@/core/auth/api';

const enc = encodeURIComponent;
const post = <T>(path: string, body: unknown = {}) => apiCall<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown = {}) => apiCall<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string) => apiCall<T>(path, { method: 'DELETE' });

/* ─── Типы: каталог/питомцы ──────────────────────────────────────── */

export type PetRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'secret';
export type PetStage = 'baby' | 'young' | 'adult' | 'special';
export type PetMood = 'idle' | 'happy' | 'excited' | 'sleepy' | 'love' | 'angry';
export type CareAction = 'feed' | 'play' | 'pet' | 'sleep' | 'walk' | 'toy';
export type PetAvailability = 'starter' | 'shop' | 'event' | 'achievement';

export interface PetType {
  id: string;
  name: string;
  species: string;
  description: string;
  color: string;
  rarity: PetRarity;
  pricePetCoins: number | null;
  availableFrom: PetAvailability;
  status?: 'active' | 'retired';
}

export interface PetInstance {
  id: string;
  typeId: string;
  type?: PetType;
  name: string;
  rarity: PetRarity;
  level: number;
  xp: number;
  stage: PetStage;
  stageHistory?: { stage: PetStage; level: number; at: string }[];
  mood: PetMood;
  happiness: number;
  energy: number;
  hunger: number;
  loyalty: number;
  intelligence: number;
  luck: number;
  isActive: boolean;
  acquisitionSource: string;
  acquiredAt?: string;
}

export const apiPetTypes = () => apiCall<{ types: PetType[] }>('/api/pets/types');
export const apiMyPets = () => apiCall<{ pets: PetInstance[] }>('/api/pets/mine');
export const apiCreatePet = (typeId: string, makeActive = false) =>
  post<{ pet: PetInstance } | { error: string }>('/api/pets', { typeId, makeActive });

export const apiSetActivePet = (petId: string) => post<{ pet: PetInstance }>(`/api/pets/${enc(petId)}/active`);
export const apiRenamePet = (petId: string, name: string) => post<{ pet: PetInstance }>(`/api/pets/${enc(petId)}/rename`, { name });
export const apiCareForPet = (petId: string, action: CareAction) =>
  post<{ pet: PetInstance; coinsEarned: number; leveledUp: boolean } | { error: string; remainingSeconds?: number }>(
    `/api/pets/${enc(petId)}/care`, { action },
  );
export const apiEvolvePet = (petId: string) => post<{ pet: PetInstance } | { error: string }>(`/api/pets/${enc(petId)}/evolve`);

/* ─── Видимость питомца в профиле/чатах ──────────────────────────── */

export interface PetVisibility {
  showInProfile: boolean;
  showNearMessages: boolean;
  showInChats: boolean;
  hiddenEntirely: boolean;
}
export const apiPetVisibility = () => apiCall<PetVisibility>('/api/pets/visibility');
export const apiSetPetVisibility = (patch: Partial<PetVisibility>) => post<PetVisibility>('/api/pets/visibility', patch);

/* ─── Кошелёк Pet Coins / достижения / задания / события ─────────── */

export interface PetWallet { balance: number }
export const apiPetWallet = () => apiCall<PetWallet>('/api/pets/wallet');

export interface PetLedgerEntry {
  id: string;
  type: string;
  amount: number;
  descr: string;
  ref?: string;
  createdAt: string;
}
export const apiPetLedger = (limit = 50) => apiCall<{ transactions: PetLedgerEntry[] }>(`/api/pets/wallet/ledger?limit=${limit}`);

export interface PetAchievement {
  id: string;
  title: string;
  description: string;
  goal: number;
  rewardXp: number;
  rewardCoins: number;
  rewardItemId: string | null;
  progress: number;
  unlockedAt: string | null;
}
export const apiPetAchievements = () => apiCall<{ achievements: PetAchievement[] }>('/api/pets/achievements');
export const apiClaimAchievement = (achievementId: string) =>
  post<{ ok: true } | { error: string }>(`/api/pets/achievements/${enc(achievementId)}/claim`);

export interface PetQuest {
  id: string;
  title: string;
  description: string;
  goal: number;
  progress: number;
  rewardXp: number;
  rewardCoins: number;
  rewardItemId: string | null;
  completedAt: string | null;
  claimedAt: string | null;
}
export const apiPetQuests = () => apiCall<{ quests: PetQuest[] }>('/api/pets/quests');
export const apiClaimQuest = (userQuestId: string) =>
  post<{ ok: true } | { error: string }>(`/api/pets/quests/${enc(userQuestId)}/claim`);

export interface PetEventReward {
  id: string;
  metric: string;
  goal: number;
  rewardXp: number;
  rewardCoins: number;
  rewardItemId: string | null;
  progress: number;
  claimedAt: string | null;
}
export interface PetEvent {
  id: string;
  name: string;
  description: string;
  endsAt: string;
  rewards: PetEventReward[];
}
export const apiPetEvents = () => apiCall<{ events: PetEvent[] }>('/api/pets/events');
export const apiClaimEventReward = (rewardId: string) =>
  post<{ ok: true } | { error: string }>(`/api/pets/events/${enc(rewardId)}/claim`);

/* ─── Sky Skin Market ─────────────────────────────────────────────── */

export type SkinItemType = 'skin' | 'outfit' | 'headwear' | 'accessory' | 'aura' | 'effect' | 'animation' | 'background' | 'trail' | 'emote';
export type SkinAvailability = 'unlimited' | 'limited' | 'event' | 'exclusive';

export interface SkinItem {
  id: string;
  name: string;
  description: string;
  itemType: SkinItemType;
  petTypeId: string | null;
  rarity: PetRarity;
  availability: SkinAvailability;
  supply: number | null;
  remaining: number | null;
  soldOut: boolean;
  pricePetCoins: number | null;
  priceSkyMoneyKopecks: number | null;
  collectionId: string | null;
  eventId: string | null;
  previewUrl?: string;
  modelUrl?: string;
  animations?: unknown;
  effects?: unknown;
  releasedAt: string;
  status: 'active' | 'retired';
  owned: boolean;
  instanceNumber?: number;
}

export interface SkinMarketFilters {
  q?: string;
  itemType?: SkinItemType;
  rarity?: PetRarity;
  availability?: SkinAvailability;
  petTypeId?: string;
  sort?: 'trending' | 'new';
}

export const apiSkinMarketItems = (filters: SkinMarketFilters = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, String(v));
  const s = qs.toString();
  return apiCall<{ items: SkinItem[] }>(`/api/pets/market/items${s ? `?${s}` : ''}`);
};
export const apiSkinItem = (itemId: string) => apiCall<{ item: SkinItem }>(`/api/pets/market/items/${enc(itemId)}`);

export interface SkinInventoryEntry {
  inventoryId: string;
  itemId: string;
  name: string;
  itemType: SkinItemType;
  rarity: PetRarity;
  availability: SkinAvailability;
  instanceNumber: number | null;
  supply: number | null;
  petTypeId: string | null;
  previewUrl?: string;
  modelUrl?: string;
  animations?: unknown;
  effects?: unknown;
  acquiredVia: string;
  acquiredAt: string;
}
export const apiMySkins = () => apiCall<{ skins: SkinInventoryEntry[] }>('/api/pets/market/mine');

/** idempotencyKey обязателен сервером (защита от повторной оплаты по
 *  двойному клику/повтору сети) — генерируем случайную строку на попытку. */
export const newIdempotencyKey = () => {
  try { return crypto.randomUUID().replace(/-/g, ''); }
  catch { return `k${Date.now()}${Math.random().toString(36).slice(2)}`; }
};

export const apiPurchaseSkinItem = (itemId: string, opts: { idempotencyKey: string; currency?: 'pet_coins' | 'sky_money' }) =>
  post<{ ok: true; itemId: string; instanceNumber: number | null } | { error: string }>(
    `/api/pets/market/items/${enc(itemId)}/purchase`, { idempotencyKey: opts.idempotencyKey, currency: opts.currency },
  );

export interface PetEquipment {
  single: Record<string, string>;
  multi: Record<string, { position: number; itemId: string }[]>;
}
export const apiPetEquipment = (petId: string) => apiCall<PetEquipment>(`/api/pets/${enc(petId)}/equipment`);
export const apiEquipItem = (petId: string, itemId: string, position?: number) =>
  post<{ ok: true } | { error: string }>(`/api/pets/${enc(petId)}/equip`, { itemId, position });
export const apiUnequipSlot = (petId: string, slot: string, position?: number) =>
  post<{ ok: true } | { error: string }>(`/api/pets/${enc(petId)}/unequip`, { slot, position });

/** Заготовка вторичного P2P-рынка — создание/отмена листинга без покупки. */
export const apiCreateSkinListing = (inventoryId: string, pricePetCoins: number) =>
  post<{ id: string } | { error: string }>('/api/pets/market/listings', { inventoryId, pricePetCoins });
export const apiCancelSkinListing = (listingId: string) =>
  del<{ ok: true } | { error: string }>(`/api/pets/market/listings/${enc(listingId)}`);

/** Путь для стриминга медиа скина (превью/модель) — отдельный раздел
 *  авторизован токеном как и всё API, поэтому прямой <img src> не
 *  сработает: смотри usePetMedia в petMedia.ts. */
export const petMediaPath = (mediaId: string) => `/api/pets/market/media/${enc(mediaId)}`;

/* ─── Админка: питомцы + скины (право content) ───────────────────── */

export const apiAdminCreatePetType = (input: {
  name: string; species: string; description?: string; color?: string;
  rarity?: PetRarity; availableFrom?: PetAvailability; pricePetCoins?: number;
}) => post<{ id: string } | { error: string }>('/api/pets/admin/types', input);

export const apiAdminRetirePetType = (typeId: string) => post<{ ok: true }>(`/api/pets/admin/types/${enc(typeId)}/retire`);

export interface PetEconomyStats { generated: number; spent: number; burned: number; circulating: number }
export const apiAdminEconomyStats = () => apiCall<PetEconomyStats>('/api/pets/admin/economy');

/** Выдача Pet Coins администратором — ВСЕГДА заявка (двуключевая
 *  очередь владельца), не прямое начисление: см. createPendingAction в
 *  server/routes/pets.mjs. Ответ не значит «выдано», значит «отправлено
 *  на подтверждение». */
export const apiAdminGrantPetCoins = (profileId: string, amount: number, reason: string) =>
  post<{ id: string } | { error: string }>('/api/pets/admin/economy/grant', { profileId, amount, reason });

export const apiAdminListSkinItems = () => apiCall<{ items: SkinItem[] }>('/api/pets/admin/market/items');

export const apiAdminCreateSkinItem = (input: {
  name: string; description?: string; itemType: SkinItemType; rarity: PetRarity; availability: SkinAvailability;
  supply?: number; petTypeId?: string; pricePetCoins?: number; priceSkyMoneyKopecks?: number;
  collectionId?: string; eventId?: string;
  previewMediaId?: string; previewMime?: string; modelMediaId?: string; modelMime?: string;
}) => post<{ id: string } | { error: string }>('/api/pets/admin/market/items', input);

export const apiAdminUpdateSkinItem = (itemId: string, patchBody: {
  name?: string; description?: string; pricePetCoins?: number | null; priceSkyMoneyKopecks?: number | null; supply?: number;
}) => patch<{ ok: true; locked: boolean } | { error: string }>(`/api/pets/admin/market/items/${enc(itemId)}`, patchBody);

export const apiAdminRetireSkinItem = (itemId: string) => post<{ ok: true }>(`/api/pets/admin/market/items/${enc(itemId)}/retire`);

/** Превью-картинка скина — отдельно от остальных полей: шлётся не JSON,
 *  а байтами файла (см. server/routes/pets.mjs). */
export const apiAdminUploadSkinPreview = (itemId: string, file: Blob) =>
  apiCall<{ ok: true; mediaId: string } | { error: string }>(`/api/pets/admin/market/items/${enc(itemId)}/preview`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });

export interface SkinSaleOwner { username: string; name: string; instanceNumber: number | null; acquiredVia: string; acquiredAt: string }
export const apiAdminSkinItemSales = (itemId: string) => apiCall<{ owners: SkinSaleOwner[] }>(`/api/pets/admin/market/items/${enc(itemId)}/sales`);

/* ─── Уход: подпись/эффекты действий — тот же конфиг, что и на сервере
   (server/pets.mjs::CARE_CFG), только для подписи кнопок в интерфейсе.
   Кулдаун и эффект на характеристики всегда решает сервер — здесь это
   не более чем текст кнопки. ──────────────────────────────────────── */
export const CARE_ACTION_LABEL: Record<CareAction, string> = {
  feed: 'Покормить', play: 'Поиграть', pet: 'Погладить', sleep: 'Уложить спать', walk: 'Погулять', toy: 'Игрушка',
};
export const CARE_ACTION_EMOJI: Record<CareAction, string> = {
  feed: '🍖', play: '🎾', pet: '🫶', sleep: '🌙', walk: '🐾', toy: '🧸',
};
/** Кулдауны секунд — зеркало server/pets.mjs::CARE_CFG, только для
 *  отображения локального отсчёта между запросами; сервер всё равно
 *  проверит сам и вернёт {error:'cooldown', remainingSeconds}. */
export const CARE_ACTION_COOLDOWN: Record<CareAction, number> = {
  feed: 300, play: 480, pet: 120, sleep: 1200, walk: 600, toy: 480,
};

export const PET_RARITY_LABEL: Record<PetRarity, string> = {
  common: 'Обычный', uncommon: 'Необычный', rare: 'Редкий', epic: 'Эпический',
  legendary: 'Легендарный', mythic: 'Мифический', secret: 'Секретный',
};
export const PET_RARITY_COLOR: Record<PetRarity, string> = {
  common: '#8a8a96', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7',
  legendary: '#f59e0b', mythic: '#ec4899', secret: '#0f172a',
};
