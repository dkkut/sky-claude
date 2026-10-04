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
