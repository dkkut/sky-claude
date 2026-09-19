/**
 * Sky Gifts: разговор с сервером.
 *
 * Цену, медиа-версию, владельца NFT и срок Prime всегда решает сервер —
 * здесь только запрос и разбор ответа. Идентификатор идемпотентности
 * генерируется один раз на попытку и переиспользуется при повторе
 * (двойной тап, обрыв сети) — так повтор не создаёт второй заказ и не
 * списывает деньги дважды.
 */
import { apiCall } from '@/core/auth/api';
import type { SentGift, GiftRarity } from './store';

const RARITIES: GiftRarity[] = ['common', 'rare', 'epic', 'legendary', 'unique'];
const asRarity = (r: string): GiftRarity => (RARITIES.includes(r as GiftRarity) ? (r as GiftRarity) : 'common');

export interface GiftCatalogItem {
  id: string;
  name: string;
  description: string;
  emoji: string;
  pricePoints: number;
  gradient: string;
  mediaId: string | null;
  thumbMediaId: string | null;
  rarity: string;
  seasonal: boolean;
  active: boolean;
  sortOrder: number;
}

export interface GiftInstance {
  id: string;
  giftCatalogId: string;
  name: string;
  emoji: string;
  gradient: string;
  rarity: string;
  mediaId: string | null;
  thumbMediaId: string | null;
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  chatId: string | null;
  caption: string;
  savedToProfile: boolean;
  createdAt: string;
}

export interface PrimeTier { days: number; price: number }

export type PrimeGiftStatus = 'new' | 'activated' | 'unavailable';

export interface PrimeGiftInstance {
  id: string;
  senderId: string;
  recipientId: string;
  days: number;
  theme: string;
  mediaId: string | null;
  thumbMediaId: string | null;
  message: string;
  chatId: string | null;
  status: PrimeGiftStatus;
  unavailableReason: string | null;
  activatedAt: string | null;
  createdAt: string;
}

export interface NftOwner { id: string; name: string; since: string | null; transferred: boolean }
export interface NftProvenanceEntry {
  id: string; type: 'genesis' | 'transfer'; fromId: string | null; fromName: string | null;
  toId: string; toName: string; operationId: string; source: string; at: string;
}
export interface GiftNotification {
  id: string; kind: string; title: string; body: string; refId: string | null; read: boolean; createdAt: string;
}

const ERRORS: Record<string, string> = {
  not_found: 'Не найдено',
  not_allowed: 'Недостаточно прав',
  recipient_not_found: 'Такого человека нет',
  invalid_recipient: 'Нельзя отправить самому себе',
  insufficient_points: 'Недостаточно баллов Прайма',
  insufficient_funds: 'Недостаточно средств',
  not_owner: 'Этот подарок вам не принадлежит',
  self_transfer: 'Нельзя передать самому себе',
  invalid_plan: 'Такого срока подписки нет',
  already_activated: 'Уже получено',
  unavailable: 'Подарок недоступен',
  chat_unavailable: 'Этот человек закрыл приём новых сообщений',
  not_accepting: 'Этот человек закрыл приём новых сообщений',
  too_many_requests: 'Слишком часто. Попробуйте чуть позже',
  too_large: 'Файл слишком большой',
  unsupported_media: 'Неподдерживаемый формат файла',
};
export const giftErrorText = (code?: string) => ERRORS[code ?? ''] ?? 'Не получилось';

const idemKey = () => `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/* ─── Медиа ────────────────────────────────────────────────────────── */

export const giftMediaUrl = (mediaId: string | null | undefined) =>
  mediaId ? `/api/gifts/media/${encodeURIComponent(mediaId)}` : null;

/* ─── Каталог и отправка обычного подарка ────────────────────────────── */

export const apiGiftCatalog = async (): Promise<GiftCatalogItem[]> => {
  const r = await apiCall<{ items: GiftCatalogItem[] }>('/api/gifts/catalog');
  return r.ok ? (r.data?.items ?? []) : [];
};

export const apiSendGift = async (opts: {
  giftCatalogId: string; recipientId: string; target: 'chat' | 'profile'; chatId?: string; message?: string;
}) => {
  const r = await apiCall<{ instanceId: string }>('/api/gifts/send', {
    method: 'POST', body: JSON.stringify({ ...opts, idemKey: idemKey() }),
  });
  if (r.ok) return { ok: true as const, instanceId: r.data?.instanceId ?? '' };
  return { ok: false as const, reason: giftErrorText(r.error) };
};

export const apiSaveGiftToProfile = async (instanceId: string) => {
  const r = await apiCall(`/api/gifts/instances/${encodeURIComponent(instanceId)}/save`, { method: 'POST' });
  return r.ok ? { ok: true as const } : { ok: false as const, reason: giftErrorText(r.error) };
};

export const apiGiftInstance = async (instanceId: string): Promise<GiftInstance | null> => {
  const r = await apiCall<{ instance: GiftInstance }>(`/api/gifts/instances/${encodeURIComponent(instanceId)}`);
  return r.ok ? (r.data?.instance ?? null) : null;
};

export const apiMyReceivedGifts = async (): Promise<GiftInstance[]> => {
  const r = await apiCall<{ items: GiftInstance[] }>('/api/gifts/mine/received');
  return r.ok ? (r.data?.items ?? []) : [];
};
export const apiMyProfileGifts = async (): Promise<GiftInstance[]> => {
  const r = await apiCall<{ items: GiftInstance[] }>('/api/gifts/mine/profile');
  return r.ok ? (r.data?.items ?? []) : [];
};
export const apiMySentGifts = async (): Promise<GiftInstance[]> => {
  const r = await apiCall<{ items: GiftInstance[] }>('/api/gifts/mine/sent');
  return r.ok ? (r.data?.items ?? []) : [];
};
export const apiPublicProfileGifts = async (userId: string): Promise<{ hidden: boolean; items: GiftInstance[] }> => {
  const r = await apiCall<{ hidden: boolean; items: GiftInstance[] }>(`/api/gifts/profile/${encodeURIComponent(userId)}`);
  return r.ok ? (r.data ?? { hidden: false, items: [] }) : { hidden: false, items: [] };
};

/* ─── Подарок Prime ──────────────────────────────────────────────────── */

export const apiPrimeGiftPrices = async (): Promise<PrimeTier[]> => {
  const r = await apiCall<{ tiers: PrimeTier[] }>('/api/gifts/prime/prices');
  return r.ok ? (r.data?.tiers ?? []) : [];
};

export const apiSendPrimeGift = async (opts: { recipientId: string; days: number; theme?: string; message?: string }) => {
  const r = await apiCall<{ instanceId: string }>('/api/gifts/prime/send', {
    method: 'POST', body: JSON.stringify({ ...opts, idemKey: idemKey() }),
  });
  if (r.ok) return { ok: true as const, instanceId: r.data?.instanceId ?? '' };
  return { ok: false as const, reason: giftErrorText(r.error) };
};

export const apiPrimeGiftInstance = async (instanceId: string): Promise<PrimeGiftInstance | null> => {
  const r = await apiCall<{ instance: PrimeGiftInstance }>(`/api/gifts/prime/instances/${encodeURIComponent(instanceId)}`);
  return r.ok ? (r.data?.instance ?? null) : null;
};

export const apiActivatePrimeGift = async (instanceId: string) => {
  const r = await apiCall<{ instance: PrimeGiftInstance }>(
    `/api/gifts/prime/instances/${encodeURIComponent(instanceId)}/activate`, { method: 'POST' });
  if (r.ok) return { ok: true as const, instance: r.data?.instance ?? null };
  return { ok: false as const, reason: giftErrorText(r.error), code: r.error };
};

export const apiMySentPrimeGifts = async (): Promise<PrimeGiftInstance[]> => {
  const r = await apiCall<{ items: PrimeGiftInstance[] }>('/api/gifts/prime/mine/sent');
  return r.ok ? (r.data?.items ?? []) : [];
};
export const apiMyReceivedPrimeGifts = async (): Promise<PrimeGiftInstance[]> => {
  const r = await apiCall<{ items: PrimeGiftInstance[] }>('/api/gifts/prime/mine/received');
  return r.ok ? (r.data?.items ?? []) : [];
};

/* ─── NFT: владение, история, передача ──────────────────────────────── */

export const apiNftOwner = async (nftId: string): Promise<NftOwner | null> => {
  const r = await apiCall<{ owner: NftOwner }>(`/api/gifts/nft/${encodeURIComponent(nftId)}/owner`);
  return r.ok ? (r.data?.owner ?? null) : null;
};

export const apiNftOwners = async (nftIds: string[]): Promise<Record<string, NftOwner>> => {
  if (!nftIds.length) return {};
  const r = await apiCall<{ owners: Record<string, NftOwner> }>(
    `/api/gifts/nft/owners?ids=${encodeURIComponent(nftIds.join(','))}`);
  return r.ok ? (r.data?.owners ?? {}) : {};
};

export const apiNftHistory = async (nftId: string): Promise<NftProvenanceEntry[]> => {
  const r = await apiCall<{ provenance: NftProvenanceEntry[] }>(`/api/gifts/nft/${encodeURIComponent(nftId)}/history`);
  return r.ok ? (r.data?.provenance ?? []) : [];
};

export const apiNftTransfer = async (nftId: string, recipientId: string) => {
  const r = await apiCall<{ ownerId: string; ownerName: string }>(
    `/api/gifts/nft/${encodeURIComponent(nftId)}/transfer`, { method: 'POST', body: JSON.stringify({ recipientId }) });
  if (r.ok) return { ok: true as const, ownerId: r.data?.ownerId ?? '', ownerName: r.data?.ownerName ?? '' };
  return { ok: false as const, reason: giftErrorText(r.error) };
};

export const apiNftProfile = async (userId: string): Promise<{ hidden: boolean; items: { nftId: string; since: string }[] }> => {
  const r = await apiCall<{ hidden: boolean; items: { nftId: string; since: string }[] }>(
    `/api/gifts/nft/profile/${encodeURIComponent(userId)}`);
  return r.ok ? (r.data ?? { hidden: false, items: [] }) : { hidden: false, items: [] };
};

/* ─── Уведомления ────────────────────────────────────────────────────── */

export const apiGiftNotifications = async (): Promise<GiftNotification[]> => {
  const r = await apiCall<{ notifications: GiftNotification[] }>('/api/gifts/notifications');
  return r.ok ? (r.data?.notifications ?? []) : [];
};
export const apiReadGiftNotification = async (id: string) => {
  await apiCall(`/api/gifts/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
};

/* ─── Администрирование (право gifts) ───────────────────────────────── */

export const apiAdminGiftCatalog = async (): Promise<GiftCatalogItem[]> => {
  const r = await apiCall<{ items: GiftCatalogItem[] }>('/api/gifts/admin/catalog');
  return r.ok ? (r.data?.items ?? []) : [];
};

export const apiAdminCreateGift = async (data: {
  name: string; description?: string; emoji?: string; pricePoints: number; gradient?: string; rarity?: string; seasonal?: boolean;
}) => {
  const r = await apiCall<GiftCatalogItem>('/api/gifts/admin/catalog', { method: 'POST', body: JSON.stringify(data) });
  if (r.ok) return { ok: true as const, item: r.data as GiftCatalogItem };
  return { ok: false as const, reason: giftErrorText(r.error) };
};

export const apiAdminUpdateGift = async (id: string, patch: Partial<GiftCatalogItem>) => {
  const r = await apiCall<GiftCatalogItem>(`/api/gifts/admin/catalog/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });
  if (r.ok) return { ok: true as const, item: r.data as GiftCatalogItem };
  return { ok: false as const, reason: giftErrorText(r.error) };
};

export const apiAdminSetGiftActive = async (id: string, on: boolean) => {
  const r = await apiCall(`/api/gifts/admin/catalog/${encodeURIComponent(id)}/active`, {
    method: 'POST', body: JSON.stringify({ on }),
  });
  return r.ok ? { ok: true as const } : { ok: false as const, reason: giftErrorText(r.error) };
};

export const apiAdminUploadGiftMedia = async (id: string, role: 'main' | 'thumbnail', file: File) => {
  const r = await apiCall<{ mediaId: string }>(
    `/api/gifts/admin/catalog/${encodeURIComponent(id)}/media?role=${role}`,
    { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  if (r.ok) return { ok: true as const, mediaId: r.data?.mediaId ?? '' };
  return { ok: false as const, reason: giftErrorText(r.error) };
};

export const apiAdminUploadPrimeCardMedia = async (theme: string, role: 'main' | 'thumbnail', file: File) => {
  const r = await apiCall<{ mediaId: string }>(
    `/api/gifts/admin/prime-card/${encodeURIComponent(theme)}/media?role=${role}`,
    { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  if (r.ok) return { ok: true as const, mediaId: r.data?.mediaId ?? '' };
  return { ok: false as const, reason: giftErrorText(r.error) };
};

/**
 * Обёртка над уже существующим SentGift (src/gifts/store.ts), чтобы
 * настоящий экземпляр подарка с сервера можно было показать теми же
 * компонентами (GiftBubble, ProfileGiftsShowcase, MyGifts), не меняя
 * их самих.
 */
export const toSentGift = (i: GiftInstance): SentGift => {
  const [c1, c2] = (i.gradient || '').split(',');
  return {
    id: i.id, giftId: i.giftCatalogId, giftName: i.name, giftEmoji: i.emoji,
    giftRarity: asRarity(i.rarity), giftGrad: [c1 || '#1a1a1f', c2 || '#252528'],
    fromId: i.senderId, fromName: i.senderName, toId: i.recipientId, toName: i.recipientName,
    chatId: i.chatId ?? '', savedToProfile: i.savedToProfile, message: i.caption,
    sentAt: i.createdAt, price: 0,
  };
};
