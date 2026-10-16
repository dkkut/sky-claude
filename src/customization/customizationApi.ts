/**
 * Маркет кастомизации — серверная сторона владения/экипировки/покупки.
 * Внешний вид предметов остаётся в src/customization/catalog/*.ts —
 * здесь только цена и факт владения, то, чему нельзя жить в
 * localStorage, как было раньше (см. CLAUDE.md о «реальности» фич).
 */
import { apiCall } from '@/core/auth/api';
import type { ItemCategory } from './types';

export interface CatalogPrice {
  id: string;
  category: ItemCategory;
  pricePoints: number;
}

export interface InventoryRow {
  itemId: string;
  acquiredVia: 'purchase' | 'admin_grant';
  acquiredAt: string;
}

export type EquippedMap = Partial<Record<ItemCategory, string>>;

export const apiCustomizationCatalog = async (): Promise<CatalogPrice[]> => {
  const r = await apiCall<{ catalog: CatalogPrice[] }>('/api/customization/catalog');
  return r.ok && r.data ? r.data.catalog : [];
};

export const apiMyCustomization = async (): Promise<{ inventory: InventoryRow[]; equipped: EquippedMap } | null> => {
  const r = await apiCall<{ inventory: InventoryRow[]; equipped: EquippedMap }>('/api/customization/mine');
  return r.ok && r.data ? r.data : null;
};

/** Что надето у других людей (рамка, баннер, тема) — витринные данные, видны всем. */
export const apiPeersCustomization = async (ids: string[]): Promise<Record<string, EquippedMap> | null> => {
  const r = await apiCall<{ equipped: Record<string, EquippedMap> }>(`/api/customization/of?ids=${ids.map(encodeURIComponent).join(',')}`);
  return r.ok && r.data ? r.data.equipped : null;
};

export const apiEquipCustomization = async (category: ItemCategory, itemId: string | null) => {
  const r = await apiCall<{ ok: true }>('/api/customization/equip',
    { method: 'POST', body: JSON.stringify({ category, itemId }) });
  return r.ok ? { ok: true as const } : { ok: false as const, error: r.error, reason: r.reason };
};

const idemKey = () => `cust-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const apiBuyCustomization = async (itemId: string) => {
  const r = await apiCall<{ ok: true; itemId: string; category: ItemCategory; pricePoints: number }>(
    '/api/customization/buy', { method: 'POST', body: JSON.stringify({ itemId, idempotencyKey: idemKey() }) });
  return r.ok && r.data ? { ok: true as const, data: r.data } : { ok: false as const, error: r.error, reason: r.reason };
};

/* ─── Админка — тот же каталог, что на витрине, с ценой/активностью/
   признаком «уже продавался», как у Sky Skin Market. ─── */

export interface AdminCatalogItem {
  id: string;
  category: ItemCategory;
  pricePoints: number;
  active: boolean;
  locked: boolean;
  owners: number;
}

export const apiAdminCustomizationCatalog = async (): Promise<AdminCatalogItem[]> => {
  const r = await apiCall<{ items: AdminCatalogItem[] }>('/api/customization/admin/catalog');
  return r.ok && r.data ? r.data.items : [];
};

export const apiAdminSetCustomizationPrice = async (itemId: string, pricePoints: number) => {
  const r = await apiCall<{ ok: true }>(`/api/customization/admin/catalog/${encodeURIComponent(itemId)}/price`,
    { method: 'POST', body: JSON.stringify({ pricePoints }) });
  return r.ok ? { ok: true as const } : { ok: false as const, error: r.error, reason: r.reason };
};

export const apiAdminSetCustomizationActive = async (itemId: string, active: boolean) => {
  const r = await apiCall<{ ok: true }>(`/api/customization/admin/catalog/${encodeURIComponent(itemId)}/active`,
    { method: 'POST', body: JSON.stringify({ active }) });
  return r.ok ? { ok: true as const } : { ok: false as const, error: r.error, reason: r.reason };
};

export const apiAdminGrantCustomization = async (profileId: string, itemId: string) => {
  const r = await apiCall<{ ok: true }>('/api/customization/admin/grant',
    { method: 'POST', body: JSON.stringify({ profileId, itemId }) });
  return r.ok ? { ok: true as const } : { ok: false as const, error: r.error, reason: r.reason };
};
