/**
 * Кабинет сотрудника пункта выдачи: разговор с сервером.
 *
 * Права решает сервер (server/pvzops.mjs) — отсюда лишь уходят запросы.
 * Код получения, состояние ячейки и ключа отсюда не отправляются:
 * сервер сам знает, что выдавать, а что — только показывать.
 */
import { apiCall } from '@/core/auth/api';

const enc = encodeURIComponent;
const post = <T>(path: string, body: unknown = {}) =>
  apiCall<T>(path, { method: 'POST', body: JSON.stringify(body) });

export type PvzPermission = 'view' | 'receive' | 'place' | 'issue' | 'cells' | 'keys' | 'returns' | 'admin';

export interface PvzMembership {
  pvzId: string;
  permissions: PvzPermission[];
  title: string;
  city: string;
  address: string;
  staffClosed: boolean;
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

export interface PvzKey {
  id: string;
  pvzId: string;
  cellId: string;
  status: 'AVAILABLE' | 'ISSUED' | 'LOST' | 'BLOCKED';
  currentHolderId: string | null;
  issuedAt: string | null;
  returnedAt: string | null;
  createdAt: string;
}

export interface PvzStaffMember {
  id: string;
  profileId: string;
  name: string;
  username: string;
  permissions: PvzPermission[];
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

export const apiPvzMine = () => apiCall<{ pvzs: PvzMembership[] }>('/api/pvz/mine');
export const apiPvzOverview = (pvzId: string) => apiCall<{ pvz: PvzOverview }>(`/api/pvz/${enc(pvzId)}`);
export const apiPvzSetClosed = (pvzId: string, closed: boolean, reason?: string) =>
  post<{ ok: true }>(`/api/pvz/${enc(pvzId)}/closed`, { closed, reason });

export const apiPvzStaff = (pvzId: string) => apiCall<{ staff: PvzStaffMember[] }>(`/api/pvz/${enc(pvzId)}/staff`);
export const apiPvzAddStaff = (pvzId: string, profileId: string, permissions: PvzPermission[]) =>
  post<{ id: string }>(`/api/pvz/${enc(pvzId)}/staff`, { profileId, permissions });
export const apiPvzRevokeStaff = (pvzId: string, staffId: string) =>
  post<{ ok: true }>(`/api/pvz/${enc(pvzId)}/staff/${enc(staffId)}/revoke`);

export const apiPvzCells = (pvzId: string) => apiCall<{ cells: PvzCell[] }>(`/api/pvz/${enc(pvzId)}/cells`);
export const apiPvzAddCell = (pvzId: string, number: string, size: PvzCell['size'], hasKey: boolean) =>
  post<{ id: string }>(`/api/pvz/${enc(pvzId)}/cells`, { number, size, hasKey });
export const apiPvzCellStatus = (pvzId: string, cellId: string, status: 'FREE' | 'BLOCKED' | 'MAINTENANCE', reason?: string) =>
  post<{ ok: true }>(`/api/pvz/${enc(pvzId)}/cells/${enc(cellId)}/status`, { status, reason });

export const apiPvzReceiveOrder = (pvzId: string, orderId: string) =>
  post<{ ok: true }>(`/api/pvz/${enc(pvzId)}/orders/${enc(orderId)}/receive`);
export const apiPvzPlaceOrder = (pvzId: string, orderId: string, cellId: string) =>
  post<{ ok: true }>(`/api/pvz/${enc(pvzId)}/orders/${enc(orderId)}/place`, { cellId });
export const apiPvzIssueOrder = (pvzId: string, orderId: string, code: string) =>
  post<{ order: unknown }>(`/api/pvz/${enc(pvzId)}/orders/${enc(orderId)}/issue`, { code });

export const apiPvzKeys = (pvzId: string) => apiCall<{ keys: PvzKey[] }>(`/api/pvz/${enc(pvzId)}/keys`);
export const apiPvzCreateKey = (pvzId: string, cellId: string) =>
  post<{ id: string }>(`/api/pvz/${enc(pvzId)}/keys`, { cellId });
export const apiPvzIssueKey = (pvzId: string, keyId: string, toProfileId: string) =>
  post<{ ok: true }>(`/api/pvz/${enc(pvzId)}/keys/${enc(keyId)}/issue`, { toProfileId });
export const apiPvzReturnKey = (pvzId: string, keyId: string) =>
  post<{ ok: true }>(`/api/pvz/${enc(pvzId)}/keys/${enc(keyId)}/return`);
export const apiPvzReportKeyLost = (pvzId: string, keyId: string) =>
  post<{ ok: true; cellId: string }>(`/api/pvz/${enc(pvzId)}/keys/${enc(keyId)}/lost`);

export const apiPvzAudit = (pvzId: string) => apiCall<{ entries: PvzAuditEntry[] }>(`/api/pvz/${enc(pvzId)}/audit`);
