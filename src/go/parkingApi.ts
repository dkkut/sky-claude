/** Sky GO → Парковки: клиент API (/api/parking/*). Деньги и сроки считает сервер; тут только показ. */
import { apiCall } from '@/core/auth/api';

export interface PkTariff { id: string; kind: 'hourly' | 'daily' | 'flat'; priceRub: number; freeMinutes: number; minMinutes: number; maxMinutes: number; minCostRub?: number; active: boolean }
export interface PkLot { acceptsPayment?: boolean; id: string; orgId: string; title: string; city: string; address: string; lat: number | null; lng: number | null; spacesTotal: number; description: string; hours: string; status: string; rejectReason?: string; closed?: boolean; closedReason?: string; tariffs: PkTariff[] }
export interface PkVehicle { id: string; plate: string; label: string }
export interface PkPayment { id: string; kind: 'start' | 'extend'; amountRub: number; status: 'pending' | 'paid' | 'refunded' | 'cancelled'; payVia?: string; payUrl?: string; payBy?: string; refund: string | null; at: string }
export interface PkSessionPage { sessions: PkSession[]; total: number; hasMore: boolean }
export interface PkSession { id: string; lotId: string; lotTitle: string; address: string; status: 'awaiting_payment' | 'active' | 'ended' | 'cancelled'; payBy?: string | null; startsAt: string; endsAt: string; paidRub: number; secondsLeft: number; plate: string; tariff: { kind?: string; priceRub?: number; maxMinutes?: number }; payments?: PkPayment[] }
export interface PkStaff { profileId: string; role: string; username: string; name: string; lotIds: string[] | null; perms: string[] }
export interface PkMoney { confirmedRub: number; confirmedCount: number; refundedRub: number; pendingRub: number }
export interface PkDashboard { role: string; lots: { total: number; byStatus: Record<string, number>; open: number; closed: number }; activeSessions: number; users: { total: number; last30: number }; money: { day: PkMoney; week: PkMoney; month: PkMoney }; days: { day: string; sessions: number; rub: number }[]; recent: { id: number; action: string; title: string | null; at: string }[]; errors: { at: string; scope: string; code: string; message: string }[]; pendingRefunds: number; note: string }
export interface PkPay { id: string; kind: string; amountRub: number; status: 'pending' | 'paid' | 'refunded' | 'cancelled'; payVia: string; at: string; minutes: number; sessionId: string; lotId: string; lotTitle: string; refund: string | null }
export interface PkAuditEvent { id: number; action: string; detail: Record<string, unknown>; at: string; lotId: string | null; actor: string | null }
export interface PkOrg { id: string; name: string; status: string; suspendReason: string; role: 'owner' | 'admin' | 'moderator'; lots: number }
export interface PkRefund { id: string; lotTitle: string; amountRub: number; reason: string; status: string; note: string; at: string; own: boolean }

export const KIND_LABEL: Record<PkTariff['kind'], string> = { hourly: 'Почасовой', daily: 'Посуточный', flat: 'Разовый' };
export const LOT_STATUS: Record<string, string> = { draft: 'Черновик', review: 'На проверке', approved: 'Опубликована', rejected: 'Отклонена', suspended: 'Приостановлена', archived: 'В архиве' };
export const tariffText = (t: PkTariff) => t.kind === 'hourly' ? `${t.priceRub} ₽/час${t.freeMinutes ? `, первые ${t.freeMinutes} мин бесплатно` : ''}` : t.kind === 'daily' ? `${t.priceRub} ₽/сутки` : `${t.priceRub} ₽ за въезд`;

const body = (b: unknown) => JSON.stringify(b ?? {});
const P = '/api/parking';
export const newIdem = () => `pk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const pk = {
  lots: (city: string) => apiCall<{ lots: PkLot[] }>(`${P}/lots?city=${encodeURIComponent(city)}`),
  quote: (lotId: string, tariffId: string, minutes: number) => apiCall<{ costRub: number; minutes: number }>(`${P}/lots/${lotId}/quote?tariffId=${tariffId}&minutes=${minutes}`),
  vehicles: () => apiCall<{ vehicles: PkVehicle[] }>(`${P}/vehicles`),
  addVehicle: (plate: string, label: string) => apiCall<{ id: string }>(`${P}/vehicles`, { method: 'POST', body: body({ plate, label }) }),
  delVehicle: (id: string) => apiCall(`${P}/vehicles/${id}`, { method: 'DELETE' }),
  sessions: () => apiCall<{ sessions: PkSession[] }>(`${P}/sessions`),
  start: (b: { lotId: string; tariffId: string; minutes: number; vehicleId: string; idemKey: string }) => apiCall<{ sessionId: string; amountRub: number; pending?: boolean; payUrl?: string; payBy?: string }>(`${P}/sessions`, { method: 'POST', body: body(b) }),
  extendQuote: (id: string, minutes: number) => apiCall<{ costRub: number }>(`${P}/sessions/${id}/extend-quote?minutes=${minutes}`),
  extend: (id: string, minutes: number, idemKey: string) => apiCall<{ amountRub: number; pending?: boolean; payUrl?: string; payBy?: string }>(`${P}/sessions/${id}/extend`, { method: 'POST', body: body({ minutes, idemKey }) }),
  refund: (paymentId: string, reason: string) => apiCall(`${P}/payments/${paymentId}/refund`, { method: 'POST', body: body({ reason }) }),
  report: (lotId: string, reason: string, note: string) => apiCall(`${P}/lots/${lotId}/report`, { method: 'POST', body: body({ reason, note }) }),
  orgs: () => apiCall<{ orgs: PkOrg[] }>(`${P}/orgs`),
  createOrg: (name: string) => apiCall<{ id: string }>(`${P}/orgs`, { method: 'POST', body: body({ name }) }),
  orgLots: (org: string) => apiCall<{ role: string; lots: PkLot[] }>(`${P}/orgs/${org}/lots`),
  createLot: (org: string, b: unknown) => apiCall<{ id: string }>(`${P}/orgs/${org}/lots`, { method: 'POST', body: body(b) }),
  saveLot: (id: string, b: unknown) => apiCall<{ status: string }>(`${P}/my/lots/${id}`, { method: 'PUT', body: body(b) }),
  submitLot: (id: string) => apiCall(`${P}/my/lots/${id}/submit`, { method: 'POST', body: '{}' }),
  archiveLot: (id: string) => apiCall(`${P}/my/lots/${id}/archive`, { method: 'POST', body: '{}' }),
  addTariff: (lot: string, b: unknown) => apiCall(`${P}/my/lots/${lot}/tariffs`, { method: 'POST', body: body(b) }),
  delTariff: (lot: string, id: string) => apiCall(`${P}/my/lots/${lot}/tariffs/${id}`, { method: 'DELETE' }),
  staff: (org: string) => apiCall<{ staff: { profileId: string; role: string; username: string; name: string }[] }>(`${P}/orgs/${org}/staff`),
  addStaff: (org: string, username: string, role: string) => apiCall(`${P}/orgs/${org}/staff`, { method: 'POST', body: body({ username, role }) }),
  delStaff: (org: string, id: string) => apiCall(`${P}/orgs/${org}/staff/${id}`, { method: 'DELETE' }),
  orgSessions: (org: string) => apiCall<{ sessions: PkSession[]; totals: { paidRub: number; refundedRub: number; note: string } }>(`${P}/orgs/${org}/sessions`),
  orgRefunds: (org: string) => apiCall<{ refunds: PkRefund[] }>(`${P}/orgs/${org}/refunds`),
  decideRefund: (id: string, action: 'approve' | 'reject', note: string) => apiCall(`${P}/refunds/${id}/${action}`, { method: 'POST', body: body({ note }) }),
  updateVehicle: (id: string, b: { plate?: string; label?: string }) => apiCall(`${P}/vehicles/${id}`, { method: 'PUT', body: body(b) }),
  sessionsPage: (limit: number, offset: number) => apiCall<PkSessionPage>(`${P}/sessions?limit=${limit}&offset=${offset}`),
  lotsFiltered: (org: string, f: Record<string, string>) => apiCall<{ role: string; acceptsPayment: boolean; total: number; lots: PkLot[] }>(`${P}/orgs/${org}/lots?${new URLSearchParams(f).toString()}`),
  submitWith: (id: string, fields: unknown) => apiCall<{ ok?: boolean; already?: boolean; missing?: string[]; hint?: string }>(`${P}/my/lots/${id}/submit`, { method: 'POST', body: body({ fields }) }),
  closeLot: (id: string, reason: string) => apiCall(`${P}/my/lots/${id}/close`, { method: 'POST', body: body({ reason }) }),
  reopenLot: (id: string) => apiCall(`${P}/my/lots/${id}/reopen`, { method: 'POST', body: '{}' }),
  updateTariff: (lot: string, id: string, b: unknown) => apiCall(`${P}/my/lots/${lot}/tariffs/${id}`, { method: 'PUT', body: body(b) }),
  dashboard: (org: string) => apiCall<PkDashboard>(`${P}/orgs/${org}/dashboard`),
  payments: (org: string, f: Record<string, string>) => apiCall<{ total: number; totals: { confirmedRub: number; refundedRub: number; pendingRub: number }; payments: PkPay[]; note: string }>(`${P}/orgs/${org}/payments?${new URLSearchParams(f).toString()}`),
  paymentsCsvUrl: (org: string, f: Record<string, string>) => `${P}/orgs/${org}/payments?${new URLSearchParams({ ...f, format: 'csv' }).toString()}`,
  audit: (org: string, offset = 0) => apiCall<{ events: PkAuditEvent[] }>(`${P}/orgs/${org}/audit?limit=50&offset=${offset}`),
  staffFull: (org: string) => apiCall<{ staff: PkStaff[] }>(`${P}/orgs/${org}/staff`),
  addStaffScoped: (org: string, b: { username: string; role: string; lotIds?: string[] | null; perms?: string[] }) => apiCall(`${P}/orgs/${org}/staff`, { method: 'POST', body: body(b) }),
  updateStaff: (org: string, id: string, b: { lotIds: string[] | null; perms: string[] }) => apiCall(`${P}/orgs/${org}/staff/${id}`, { method: 'PUT', body: body(b) }),
  orgSessionsFiltered: (org: string, f: Record<string, string>) => apiCall<{ sessions: PkSession[]; totals: { paidRub: number; refundedRub: number; note: string } }>(`${P}/orgs/${org}/sessions?${new URLSearchParams(f).toString()}`),
  lotEvents: (lot: string) => apiCall<{ events: { id: number; action: string; detail: Record<string, unknown>; at: string }[] }>(`${P}/my/lots/${lot}/events`),
};
