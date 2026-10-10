/**
 * Отслеживание посылок: разговор с сервером (server/tracking.mjs).
 * Источники — СДЭК, Почта России и зарубежные службы через 17TRACK;
 * здесь только вызовы и типы, ничего не решается на клиенте.
 */
import { apiCall } from '@/core/auth/api';

const enc = encodeURIComponent;

export type ParcelStatus =
  | 'created' | 'in_transit' | 'out_for_delivery' | 'ready_for_pickup'
  | 'delivered' | 'exception' | 'returned' | 'unknown';

export interface ParcelEvent { time: string; text: string; location?: string; carrier?: string }

export interface Parcel {
  provider: string;
  number: string;
  status: ParcelStatus;
  statusText: string;
  carrierName: string;
  events: ParcelEvent[];
}

export interface TrackingProvider { code: string; title: string; region: 'ru' | 'intl'; live: boolean }

export interface OrderTracking {
  tracking: { provider: string; providerTitle: string; number: string; url: string | null; updatedAt: string } | null;
  parcel?: Parcel | null;
  parcelError?: string | null;
  stale?: boolean;
  live?: boolean;
  canEdit: boolean;
}

export interface Lookup {
  parcel: Parcel | null;
  error: string | null;
  url: string | null;
  live: boolean;
  stale: boolean;
}

export const apiTrackingProviders = () =>
  apiCall<{ providers: TrackingProvider[] }>('/api/tracking/providers');

export const apiTrackingLookup = (provider: string, number: string) =>
  apiCall<Lookup>(`/api/tracking/lookup?provider=${enc(provider)}&number=${enc(number)}`);

export const apiOrderTracking = (orderId: string) =>
  apiCall<OrderTracking>(`/api/tracking/orders/${enc(orderId)}`);

export const apiSetOrderTracking = (orderId: string, provider: string, number: string) =>
  apiCall<{ ok: true }>(`/api/tracking/orders/${enc(orderId)}`, {
    method: 'PUT', body: JSON.stringify({ provider, number }),
  });

export const apiClearOrderTracking = (orderId: string) =>
  apiCall<{ ok: true }>(`/api/tracking/orders/${enc(orderId)}`, { method: 'DELETE' });
