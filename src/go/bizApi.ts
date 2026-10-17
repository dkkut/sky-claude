/** Sky GO: бизнес и рабочее пространство исполнителя — клиент API (server/goorg.mjs, server/gowork.mjs). Права и статусы решает сервер. */
import { apiCall } from '@/core/auth/api';
import type { GoOrder } from './api';

const j = (b: unknown) => JSON.stringify(b ?? {});
const get = <T>(p: string) => apiCall<T>(p);
const post = <T>(p: string, b?: unknown) => apiCall<T>(p, { method: 'POST', body: j(b) });
const patch = <T>(p: string, b?: unknown) => apiCall<T>(p, { method: 'PATCH', body: j(b) });
const del = <T>(p: string) => apiCall<T>(p, { method: 'DELETE' });
const qs = (o: Record<string, string | number | undefined | null>) => {
  const s = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  return s ? `?${s}` : '';
};

export type OrgRole = 'owner' | 'admin' | 'manager' | 'driver' | 'courier';
export const ORG_ROLE_LABEL: Record<OrgRole, string> = { owner: 'Владелец', admin: 'Администратор', manager: 'Менеджер', driver: 'Водитель', courier: 'Курьер' };
export type AssignMode = 'manual' | 'auto' | 'pool';
export const ASSIGN_LABEL: Record<AssignMode, string> = { manual: 'Вручную (диспетчер)', auto: 'Автоматически среди команды', pool: 'Всем курьерам Sky GO' };

export interface Workspaces {
  orgs: { id: string; name: string; role: OrgRole; roleLabel: string; status: string; suspended: boolean; staff: boolean }[];
  invites: { orgId: string; orgName: string; role: OrgRole; roleLabel: string; at: string; by: { name: string; username: string } | null }[];
}
export interface Dashboard {
  counts: { searching: number; assigned_ok: number; assigned_wait: number; to_pickup: number; delivering: number; awaiting_pay: number; dispute: number; problems: number; done_today: number; cancelled_today: number; created_today: number; done_30: number; cancelled_30: number; openProblems: number };
  avgDeliveryMinutes: number | null; avgSample: number; team: { online: number; total: number };
  attention: OrgOrderCard[]; map: { orderId: string; status: string; executor: string; lat: number; lng: number; updatedAt: string; to: string }[];
  org: { name: string; role: OrgRole; suspended: boolean; assignMode: AssignMode };
}
export interface OrgOrderCard {
  id: string; status: string; priceRub: number; city: string; createdAt: string; updatedAt: string; completedAt: string | null; scenario?: string;
  from?: string; to?: string; km?: number; minutes?: number; parcel?: string; recipient?: string;
  executor: { id: string; name: string; username: string } | null; internal: boolean; accepted: boolean | null; poolOpen: boolean; problemOpen: boolean; createdBy: string | null;
  needsAttention: null | 'problem' | 'dispute' | 'no_executor' | 'late';
}
export interface Member {
  profileId: string; name: string; username: string; avatar: string | null; role: OrgRole; roleLabel: string; status: 'invited' | 'active' | 'suspended';
  joinedAt: string | null; ready: boolean; courierStatus: string; online: boolean; activeOrders: number; doneOrders: number; self: boolean;
}
export interface OrgSettings {
  org: { id: string; name: string; city: string; phone?: string; assignMode: AssignMode; suspended: boolean; createdAt: string };
  myRole: OrgRole; verification: { status: string; legalForm?: string }; points: { id: string; title: string; address: string; located: boolean }[]; canEdit: boolean;
}
export interface OrgOrderDetail {
  order: GoOrder & { orgId: string; internal: boolean; poolOpen: boolean; accepted: boolean | null; createdBy: string | null; attention: string | null; executorLocation: { lat: number; lng: number; updatedAt: string } | null };
  notes: { id: string; author: string; toExecutor: boolean; body: string; at: string }[];
  problems: { id: string; kind: string; note: string; hasPhoto: boolean; state: 'open' | 'resolved'; resolution?: string; at: string; resolvedAt: string | null }[];
  can: { assign: boolean; cancel: boolean; openPool: boolean; note: boolean; resolveProblem: boolean }; myRole: OrgRole;
}

export interface WorkOrder extends GoOrder {
  internal: boolean; needsAccept: boolean; orgName: string | null;
  problems: { id: string; kind: string; label: string; state: string; at: string }[];
  dispatcherNotes: { body: string; at: string }[];
}
export interface WorkState {
  role: 'courier' | 'taxi_driver'; serverTime: string;
  executor: { status: string; city: string; transport: string | null } | null;
  access: { pool: boolean; assigned: boolean; poolError?: string; assignedError?: string };
  subscription: { active: boolean; expiresAt: string | null; expired: boolean };
  presence: { online: boolean; lat: number | null; lng: number | null; updatedAt: string | null };
  shiftStartedAt: string | null; doneToday: number;
  orders: WorkOrder[]; offers: any[]; offersError?: string; orgs: { id: string; name: string; role: OrgRole }[];
}
export interface WorkStop { key: string; orderId: string; type: 'pickup' | 'dropoff'; address: string; lat: number; lng: number; distanceM?: number | null; durationS?: number | null }
export interface WorkRoute { stops: WorkStop[]; empty?: boolean; noPoints?: boolean; locationRequired?: boolean; distanceM?: number; durationS?: number; polyline?: string; estimated?: boolean; mapError?: string }
export interface WorkHistory {
  orders: { id: string; status: string; scenario: string | null; priceRub: number; from?: string; to?: string; km: number | null; kmEstimated: boolean; internal: boolean; org: string | null; at: string; minutes: number | null }[];
  stats: { done: number; cancelled: number; disputes: number; problemsReported: number; avgMinutes: number | null; kmRoute: number; kmEstimatedOrders: number; receivedRub: number; receivedOrders: number; shiftHours30: number };
  shifts: { startedAt: string; endedAt: string | null }[]; notes: { rating: null; earnings: string };
}

export const PROBLEM_KINDS: [string, string][] = [
  ['recipient_unavailable', 'Получатель недоступен'], ['wrong_address', 'Неверный адрес'], ['mismatch', 'Отправление не соответствует описанию'],
  ['damaged', 'Отправление повреждено'], ['closed', 'Точка закрыта'], ['other', 'Другое'],
];

export const bizApi = {
  workspaces: () => get<Workspaces>('/api/go/workspaces'),
  respondInvite: (orgId: string, accept: boolean) => post(`/api/go/org/invites/${orgId}/respond`, { accept }),
  dashboard: (org: string) => get<Dashboard>(`/api/go/org/${org}/dashboard`),
  settings: (org: string) => get<OrgSettings>(`/api/go/org/${org}/settings`),
  saveSettings: (org: string, b: unknown) => patch(`/api/go/org/${org}/settings`, b),
  addPoint: (org: string, b: unknown) => post<{ id: string; located: boolean }>(`/api/go/org/${org}/points`, b),
  removePoint: (org: string, id: string) => del(`/api/go/org/${org}/points/${id}`),
  members: (org: string) => get<{ myRole: OrgRole; canManage: boolean; grantable: OrgRole[]; members: Member[] }>(`/api/go/org/${org}/members`),
  invite: (org: string, username: string, role: OrgRole) => post(`/api/go/org/${org}/members/invite`, { username, role }),
  changeMember: (org: string, id: string, b: { role?: OrgRole; status?: string; confirm?: boolean }) => patch<{ released?: number }>(`/api/go/org/${org}/members/${id}`, b),
  leave: (org: string) => post(`/api/go/org/${org}/leave`),
  audit: (org: string) => get<{ log: { id: string; action: string; actor: string | null; subject: string | null; detail: Record<string, any>; at: string }[] }>(`/api/go/org/${org}/audit`),
  orders: (org: string, f: { group?: string; q?: string; sort?: string; executor?: string; offset?: number }) => get<{ orders: OrgOrderCard[]; total: number }>(`/api/go/org/${org}/orders${qs({ ...f, limit: 30 })}`),
  order: (org: string, id: string) => get<OrgOrderDetail>(`/api/go/org/${org}/orders/${id}`),
  createOrder: (org: string, b: unknown) => post<{ orderId: string; priceRub: number; assignError?: string }>(`/api/go/org/${org}/orders`, { ...(b as object), idemKey: crypto.randomUUID() }),
  repeat: (org: string, id: string) => post<{ orderId: string; priceRub: number }>(`/api/go/org/${org}/orders/${id}/repeat`),
  finance: (org: string, days = 30) => get<{ days: number; currency: string; paid: { orders: number; internalOrders: number; rub: number }; awaiting: { orders: number; rub: number }; cancelled: number; disputes: number; byDay: { day: string; orders: number; rub: number }[]; note: string }>(`/api/go/org/${org}/finance?days=${days}`),
  assign: (org: string, id: string, executorId: string) => post(`/api/go/org/${org}/orders/${id}/assign`, { executorId }),
  unassign: (org: string, id: string, reason: string) => post(`/api/go/org/${org}/orders/${id}/unassign`, { reason }),
  openPool: (org: string, id: string) => post(`/api/go/org/${org}/orders/${id}/open-pool`),
  cancel: (org: string, id: string, reason: string) => post(`/api/go/org/${org}/orders/${id}/cancel`, { reason }),
  note: (org: string, id: string, body: string, toExecutor: boolean) => post(`/api/go/org/${org}/orders/${id}/notes`, { body, toExecutor }),
  resolveProblem: (org: string, pid: string, action: string, note: string) => post(`/api/go/org/${org}/problems/${pid}/resolve`, { action, note }),

  workState: (role: 'courier' | 'taxi_driver') => get<WorkState>(`/api/go/work/state${qs({ role })}`),
  workRoute: (role: 'courier' | 'taxi_driver') => get<WorkRoute>(`/api/go/work/route${qs({ role })}`),
  workHistory: (role: 'courier' | 'taxi_driver') => get<WorkHistory>(`/api/go/work/history${qs({ role, limit: 40 })}`),
  location: (lat: number, lng: number) => post('/api/go/work/location', { lat, lng }),
  problem: (orderId: string, kind: string, note: string) => post<{ id: string }>(`/api/go/work/orders/${orderId}/problem`, { kind, note }),
  problemPhoto: (id: string, file: File) => apiCall(`/api/go/work/problems/${id}/photo`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }),
  act: (kind: 'delivery' | 'taxi', id: string, action: string, extra: { code?: string; reason?: string } = {}) =>
    post<{ duplicate?: boolean; left?: number }>(`/api/go/${kind}/orders/${id}/act`, { action, ...extra }),
  accept: (kind: 'delivery' | 'taxi', id: string) => post(`/api/go/${kind}/orders/${id}/accept`),
};

/** Ссылки на внешние навигаторы: только координаты, без ключей. */
export const navLinks = (p: { lat: number; lng: number }) => ({
  yandex: `https://yandex.ru/maps/?rtext=~${p.lat},${p.lng}&rtt=auto`,
  google: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`,
  gis: `https://2gis.ru/routeSearch/rsType/car/to/${p.lng},${p.lat}`,
});
