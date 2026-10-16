/* ===============================================================
   SKY FAMILY — разговор с сервером.

   Ни одна проверка отсюда не заменяет серверную: этот файл живёт в
   браузере. Роль, владелец, лимит участников, цена и срок Sky Prime
   Family решает только сервер (server/family.mjs) — здесь только вызовы.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export type ServerFamilyRole = 'owner' | 'adult' | 'teen' | 'child' | 'guest';
export type ServerFamilyStatus = 'active' | 'closed' | 'suspended';
export type InvitationStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';

export interface ServerFamily {
  id: string;
  name: string;
  ownerId: string;
  status: ServerFamilyStatus;
  memberLimit: number;
  adultLimit: number;
  primeUntil: string | null;
  createdAt?: string;
}

export interface ServerFamilyMember {
  id: string;
  familyId: string;
  profileId: string | null;
  name: string;
  username?: string;
  role: ServerFamilyRole;
  status: 'active' | 'left' | 'removed';
  permissions: Record<string, boolean>;
  joinedAt?: string;
}

export interface FamilyInvitation {
  id: string;
  familyId: string;
  familyName?: string;
  senderId: string;
  senderName?: string;
  recipientId: string;
  role: ServerFamilyRole;
  status: InvitationStatus;
  createdAt?: string;
  expiresAt?: string;
}

export interface MyFamilyData {
  family: ServerFamily;
  members: ServerFamilyMember[];
  me: ServerFamilyMember;
  /** Только у владельца: приглашения, которые он разослал и которые ещё не решены. */
  pendingInvitations?: FamilyInvitation[];
}

export interface FamilyNotification {
  id: string;
  familyId: string | null;
  kind: string;
  text: string;
  read: boolean;
  createdAt?: string;
}

const enc = encodeURIComponent;
const post = <T>(path: string, body: unknown = {}) => apiCall<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown = {}) => apiCall<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string) => apiCall<T>(path, { method: 'DELETE' });

export const apiMyFamily = () => apiCall<{ data: MyFamilyData | null }>('/api/family/me');

export const apiCreateFamily = (name: string) => post<{ data: MyFamilyData }>('/api/family', { name });

export const apiCloseFamily = (familyId: string) => del<{ ok: true }>(`/api/family/${enc(familyId)}`);

export const apiMyInvitations = () => apiCall<{ invitations: FamilyInvitation[] }>('/api/family/invitations');

export const apiInviteMember = (familyId: string, recipientId: string, role: 'adult' | 'teen' | 'guest') =>
  post<{ invitation: FamilyInvitation }>(`/api/family/${enc(familyId)}/invite`, { recipientId, role });

export const apiCancelInvitation = (invitationId: string) =>
  del<{ ok: true }>(`/api/family/invitations/${enc(invitationId)}`);

export const apiAcceptInvitation = (invitationId: string) =>
  post<{ data: MyFamilyData }>(`/api/family/invitations/${enc(invitationId)}/accept`);

export const apiRejectInvitation = (invitationId: string) =>
  post<{ ok: true }>(`/api/family/invitations/${enc(invitationId)}/reject`);

export const apiAddPlaceholderMember = (familyId: string, name: string, role: 'child' | 'teen') =>
  post<{ member: ServerFamilyMember }>(`/api/family/${enc(familyId)}/placeholder`, { name, role });

export const apiRemoveMember = (familyId: string, memberId: string) =>
  del<{ ok: true }>(`/api/family/${enc(familyId)}/members/${enc(memberId)}`);

export const apiUpdateMember = (familyId: string, memberId: string, patchBody: { role?: string; permissions?: Record<string, boolean> }) =>
  patch<{ member: ServerFamilyMember }>(`/api/family/${enc(familyId)}/members/${enc(memberId)}`, patchBody);

export const apiLeaveFamily = () => post<{ ok: true }>('/api/family/leave');

export const apiTransferOwnership = (familyId: string, memberId: string) =>
  post<{ ok: true }>(`/api/family/${enc(familyId)}/transfer`, { memberId });

export interface FamilyPrimePlan { id: string; label: string; price: number; days: number }
export const FAMILY_PRIME_PLAN_IDS = ['month', 'year'] as const;

export const apiPurchaseFamilyPrime = (familyId: string, planId: string) =>
  post<{ family: ServerFamily; balance: number }>(`/api/family/${enc(familyId)}/prime`, { planId });

export const apiFamilyNotifications = () =>
  apiCall<{ items: FamilyNotification[] }>('/api/family/notifications');
export const apiReadFamilyNotification = (id: string) =>
  post<{ ok: boolean }>('/api/family/notifications/read', { id });

/* ─── Админка ─────────────────────────────────────────────────────── */

export interface AdminFamilyRow extends ServerFamily {
  ownerName: string;
  ownerUsername: string;
  memberCount: number;
}

export const apiAdminListFamilies = (params: { q?: string; limit?: number } = {}) => {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.limit) qs.set('limit', String(params.limit));
  const s = qs.toString();
  return apiCall<{ items: AdminFamilyRow[] }>(`/api/family/admin/list${s ? `?${s}` : ''}`);
};

export interface AdminFamilyDetail {
  family: ServerFamily;
  members: ServerFamilyMember[];
  invitations: FamilyInvitation[];
  log: { id: string; actorId: string | null; action: string; targetId: string | null; detail: unknown; createdAt?: string }[];
}

export const apiAdminFamilyDetail = (familyId: string) =>
  apiCall<AdminFamilyDetail>(`/api/family/admin/${enc(familyId)}`);

export const apiAdminSetFamilyStatus = (familyId: string, status: 'active' | 'suspended') =>
  post<{ family: ServerFamily }>(`/api/family/admin/${enc(familyId)}/status`, { status });

export interface FamilyWalletData {
  balance: number; turnover: number;
  transactions: Array<{ id: string; memberId: string | null; memberName: string; kind: 'topup' | 'withdraw' | 'goal_contribute' | 'spend'; amount: number; desc: string; createdAt: string }>;
}
export const apiFamilyWallet = (familyId: string) => apiCall<FamilyWalletData>(`/api/family/${enc(familyId)}/wallet`);
export const apiFamilyWalletOp = (familyId: string, op: 'topup' | 'withdraw' | 'contribute', body: { amount: number; desc?: string; toProfileId?: string; idemKey?: string }) =>
  post<FamilyWalletData>(`/api/family/${enc(familyId)}/wallet-${op}`, { ...body, idemKey: body.idemKey ?? crypto.randomUUID() });
