/**
 * Кабинет владельца и сотрудника пункта выдачи: разговор с сервером.
 *
 * Права решает сервер (server/pvzops.mjs) — отсюда лишь уходят запросы.
 * Код получения, состояние ячейки и роль отсюда не отправляются как
 * готовое решение: сервер сам знает, что выдавать, а что — только
 * показывать. Поставки (несколько заказов одним разом), приёмка по QR
 * и комиссия владельца — в pvzShipmentsApi.ts, тот же принцип.
 */
import { apiCall } from '@/core/auth/api';

const enc = encodeURIComponent;
const post = <T>(path: string, body: unknown = {}) =>
  apiCall<T>(path, { method: 'POST', body: JSON.stringify(body) });

export type PvzRole = 'read_only' | 'employee' | 'manager' | 'owner';
export type PvzOwnerStatus = 'pending_activation' | 'active' | 'suspended';

export interface PvzMembership {
  pvzId: string;
  role: PvzRole;
  title: string;
  city: string;
  address: string;
  staffClosed: boolean;
  ownerStatus: PvzOwnerStatus;
}

export interface PvzOverview {
  id: string;
  title: string;
  city: string;
  address: string;
  phone: string;
  workFrom: string;
  workTo: string;
  holdDays: number;
  active: boolean;
  staffClosed: boolean;
  staffClosedReason: string;
  hasOwner: boolean;
  ownerStatus: PvzOwnerStatus;
  myRole: PvzRole;
  cellCount: number;
  waitingOrders: { id: string; title: string; pickupUntil: string | null }[];
}

export interface PvzCell {
  id: string;
  pvzId: string;
  number: string;
  size: 'S' | 'M' | 'L' | 'XL';
  status: 'FREE' | 'RESERVED' | 'OCCUPIED' | 'BLOCKED' | 'MAINTENANCE';
  hasKey: boolean;
  currentOrderId: string | null;
  blockReason: string;
  updatedAt: string;
}

export interface PvzStaffMember {
  id: string;
  profileId: string;
  name: string;
  username: string;
  role: PvzRole;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt: string | null;
}

export interface PvzAuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  suspicious: boolean;
  createdAt: string;
}

export interface PvzCommission {
  id: string;
  orderId: string;
  pvzId: string;
  pvzTitle: string;
  orderTitle: string;
  orderAmountKop: number;
  percent: number;
  amountKop: number;
  status: 'accrued' | 'declared_paid' | 'disputed' | 'cancelled';
  declaredPaidAt: string | null;
  createdAt: string;
}

export interface PvzConfig {
  subscriptionPrice: number;
  commissionPercent: number;
  roles: PvzRole[];
}

/* ─── Мои точки, создание, подписка, настройки ───────────────────────── */

export const apiPvzMine = () => apiCall<{ pvzs: PvzMembership[] }>('/api/pvz/mine');
export const apiPvzConfig = () => apiCall<PvzConfig>('/api/pvz/config');

export const apiPvzCreate = (input: {
  title: string; city: string; address: string; phone?: string;
  workFrom?: string; workTo?: string; holdDays?: number; cellCount?: number;
}) => apiCall<{ id: string; price: number }>('/api/pvz', { method: 'POST', body: JSON.stringify(input) });

export const apiPvzActivate = (pvzId: string) =>
  post<{ ok: true; balance: number }>(`/api/pvz/${enc(pvzId)}/activate`);

export const apiPvzOverview = (pvzId: string) => apiCall<{ pvz: PvzOverview }>(`/api/pvz/${enc(pvzId)}`);

export const apiPvzSetClosed = (pvzId: string, closed: boolean, reason?: string) =>
  post<{ ok: true }>(`/api/pvz/${enc(pvzId)}/closed`, { closed, reason });

export const apiPvzUpdateSettings = (pvzId: string, patch: {
  phone?: string; workFrom?: string; workTo?: string; holdDays?: number;
}) => post<{ ok: true }>(`/api/pvz/${enc(pvzId)}/settings`, patch);

/* ─── Сотрудники ──────────────────────────────────────────────────────── */

export const apiPvzStaff = (pvzId: string) => apiCall<{ staff: PvzStaffMember[] }>(`/api/pvz/${enc(pvzId)}/staff`);
export const apiPvzAddStaff = (pvzId: string, profileId: string, role: PvzRole) =>
  post<{ id: string }>(`/api/pvz/${enc(pvzId)}/staff`, { profileId, role });
export const apiPvzRevokeStaff = (pvzId: string, staffId: string) =>
  post<{ ok: true }>(`/api/pvz/${enc(pvzId)}/staff/${enc(staffId)}/revoke`);

/* ─── Ячейки ──────────────────────────────────────────────────────────── */

export const apiPvzCells = (pvzId: string) => apiCall<{ cells: PvzCell[] }>(`/api/pvz/${enc(pvzId)}/cells`);
export const apiPvzAddCell = (pvzId: string, number: string, size: PvzCell['size'], hasKey: boolean) =>
  post<{ id: string }>(`/api/pvz/${enc(pvzId)}/cells`, { number, size, hasKey });
export const apiPvzCellStatus = (pvzId: string, cellId: string, status: 'FREE' | 'BLOCKED' | 'MAINTENANCE', reason?: string) =>
  post<{ ok: true }>(`/api/pvz/${enc(pvzId)}/cells/${enc(cellId)}/status`, { status, reason });

/* ─── Выдача заказа покупателю ────────────────────────────────────────── */

export const apiPvzIssueOrder = (pvzId: string, orderId: string, proof: string) =>
  post<{ order: unknown }>(`/api/pvz/${enc(pvzId)}/orders/${enc(orderId)}/issue`, { qr: proof });

/* ─── QR заказа — продавец печатает на коробку ───────────────────────── */

export const apiOrderQr = (orderId: string) =>
  apiCall<{ orderId: string; token: string; payload: string }>(`/api/pvz/orders/${enc(orderId)}/qr`);
export const apiOrderQrRegenerate = (orderId: string) =>
  post<{ orderId: string; token: string; payload: string }>(`/api/pvz/orders/${enc(orderId)}/qr`);

/* ─── Комиссия владельцу точки ────────────────────────────────────────── */

export const apiPvzCommissionsOwner = () => apiCall<{ commissions: PvzCommission[] }>('/api/pvz/commissions/owner');
export const apiPvzCommissionsSeller = () => apiCall<{ commissions: PvzCommission[] }>('/api/pvz/commissions/seller');
export const apiPvzCommissionPaid = (commissionId: string) =>
  post<{ ok: true }>(`/api/pvz/commissions/${enc(commissionId)}/paid`);
export const apiPvzCommissionDispute = (commissionId: string) =>
  post<{ ok: true }>(`/api/pvz/commissions/${enc(commissionId)}/dispute`);

/* ─── Журнал ──────────────────────────────────────────────────────────── */

export const apiPvzAudit = (pvzId: string) => apiCall<{ entries: PvzAuditEntry[] }>(`/api/pvz/${enc(pvzId)}/audit`);
