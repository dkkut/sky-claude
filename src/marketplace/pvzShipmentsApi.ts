/**
 * Поставка в ПВЗ — несколько заказов одним разом — и приёмка по QR:
 * разговор с сервером. Смотри server/pvzshipments.mjs про три уровня
 * QR (поставки / заказа / получения) — здесь только вызовы, ничего не
 * решается на клиенте.
 */
import { apiCall } from '@/core/auth/api';

const enc = encodeURIComponent;
const post = <T>(path: string, body: unknown = {}) =>
  apiCall<T>(path, { method: 'POST', body: JSON.stringify(body) });

export type ShipmentMethod = 'seller_self' | 'carrier' | 'other';
export type ShipmentStatus = 'created' | 'shipped' | 'received' | 'received_partial' | 'cancelled';
export type ShipmentItemStatus = 'expected' | 'received' | 'missing';

export interface PvzShipment {
  id: string;
  pvzId: string;
  sellerId: string;
  pvzTitle?: string;
  method: ShipmentMethod;
  carrierTitle: string;
  tracking: string;
  status: ShipmentStatus;
  expectedCount: number;
  receivedCount: number;
  shippedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
}

export interface PvzShipmentItem {
  id: string;
  shipmentId: string;
  orderId: string;
  status: ShipmentItemStatus;
  scannedAt: string | null;
  title?: string;
}

export interface PvzShipmentDetail extends PvzShipment {
  items: PvzShipmentItem[];
}

export interface PvzUnmatchedScan {
  id: string;
  shipmentId: string | null;
  orderId: string | null;
  reason: string;
  resolved: boolean;
  actorId: string | null;
  createdAt: string;
}

/* ─── Продавец: сбор и отправка поставки ─────────────────────────────── */

export const apiPvzShipmentCreate = (pvzId: string, method: ShipmentMethod, carrierTitle?: string, tracking?: string) =>
  post<{ id: string }>('/api/pvz/shipments', { pvzId, method, carrierTitle, tracking });

export const apiPvzShipmentsMine = (status?: ShipmentStatus) =>
  apiCall<{ shipments: PvzShipment[] }>(`/api/pvz/shipments/mine${status ? `?status=${enc(status)}` : ''}`);

export const apiPvzShipmentDetail = (shipmentId: string) =>
  apiCall<{ shipment: PvzShipmentDetail }>(`/api/pvz/shipments/${enc(shipmentId)}`);

export const apiPvzShipmentAddOrder = (shipmentId: string, orderId: string) =>
  post<{ ok: true }>(`/api/pvz/shipments/${enc(shipmentId)}/items`, { orderId });

export const apiPvzShipmentRemoveOrder = (shipmentId: string, orderId: string) =>
  post<{ ok: true }>(`/api/pvz/shipments/${enc(shipmentId)}/items/${enc(orderId)}/remove`);

export const apiPvzShipmentQr = (shipmentId: string) =>
  apiCall<{ shipmentId: string; token: string; payload: string }>(`/api/pvz/shipments/${enc(shipmentId)}/qr`);
export const apiPvzShipmentQrRegenerate = (shipmentId: string) =>
  post<{ shipmentId: string; token: string; payload: string }>(`/api/pvz/shipments/${enc(shipmentId)}/qr/regenerate`);

export const apiPvzShipmentDispatch = (shipmentId: string) =>
  post<{ ok: true }>(`/api/pvz/shipments/${enc(shipmentId)}/dispatch`);

/* ─── ПВЗ: приёмка поставки ───────────────────────────────────────────── */

export const apiPvzPendingShipments = (pvzId: string) =>
  apiCall<{ shipments: PvzShipment[] }>(`/api/pvz/${enc(pvzId)}/shipments/pending`);

export const apiPvzOpenShipmentByQr = (pvzId: string, qr: string) =>
  post<{ shipment: PvzShipmentDetail }>(`/api/pvz/${enc(pvzId)}/shipments/open`, { qr });

export const apiPvzScanOrder = (shipmentId: string, pvzId: string, qr: string) =>
  post<{ ok: true; orderId: string; title: string }>(
    `/api/pvz/shipments/${enc(shipmentId)}/pvz/${enc(pvzId)}/scan`, { qr });

/** Повреждённый QR — ручной ввод номера заказа, только manager+. */
export const apiPvzManualReceive = (shipmentId: string, pvzId: string, orderId: string) =>
  post<{ ok: true }>(`/api/pvz/shipments/${enc(shipmentId)}/pvz/${enc(pvzId)}/manual`, { orderId });

export const apiPvzConfirmReceipt = (shipmentId: string, pvzId: string, partial: boolean) =>
  post<{ ok: true; status: ShipmentStatus; received: number; missing: number }>(
    `/api/pvz/shipments/${enc(shipmentId)}/pvz/${enc(pvzId)}/confirm`, { partial });

/* ─── Разбор несовпадений — только manager+ ──────────────────────────── */

export const apiPvzUnmatched = (pvzId: string) =>
  apiCall<{ entries: PvzUnmatchedScan[] }>(`/api/pvz/${enc(pvzId)}/unmatched`);

export const apiPvzResolveUnmatched = (pvzId: string, id: string) =>
  post<{ ok: true }>(`/api/pvz/${enc(pvzId)}/unmatched/${enc(id)}/resolve`);
