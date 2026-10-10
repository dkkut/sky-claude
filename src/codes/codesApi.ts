import { apiCall, apiText } from '@/core/auth/api';

type Res<T> = { ok: true; data: T } | { ok: false; error?: string; data?: { retryAfter?: number } };

const req = async <T>(path: string, init?: RequestInit): Promise<Res<T>> => {
  const r = await apiCall<T>(path, init);
  return r.ok ? { ok: true, data: r.data as T } : { ok: false, error: r.error, data: r.data as { retryAfter?: number } | undefined };
};

/* Клиент Sky Codes. Здесь ничего не решается: что именно получит
   человек, сервер определяет сам по коду, клиент только показывает. */

export type RewardType = 'balance' | 'points' | 'prime' | 'item' | 'discount';

export interface Reward {
  type: RewardType;
  amount: number;
  days: number;
  item: string | null;
  percent: number;
}

export interface RedeemOk {
  ok: true;
  redemptionId: string;
  reward: Reward;
  title: string;
  couponUntil?: string;
}

export interface Redemption {
  id: string;
  title: string;
  hint: string;
  redeemedAt: string;
  reward: Reward;
  result: 'ok';
}

export interface Coupon {
  id: string;
  percent: number;
  appliesTo: 'prime';
  expiresAt: string;
  createdAt: string;
}

export const apiRedeemCode = (code: string) =>
  req<RedeemOk>('/api/codes/redeem', { method: 'POST', body: JSON.stringify({ code }) });

export const apiCodeHistory = () => req<{ items: Redemption[] }>('/api/codes/history');
export const apiCodeCoupons = () => req<{ items: Coupon[] }>('/api/codes/coupons');

/* ─── Админка ─────────────────────────────────────────────────────── */

export interface BatchStats { total: number; active: number; revoked: number; uses: number; exhausted: number }

export interface Batch {
  id: string;
  title: string;
  note: string;
  reward: Reward;
  maxUses: number;
  expiresAt: string | null;
  count: number;
  boundProfileId: string | null;
  boundUsername: string | null;
  createdByName: string | null;
  createdAt: string;
  stats?: BatchStats;
}

export interface CodeRow {
  id: string;
  hint: string;
  status: 'active' | 'revoked';
  uses: number;
  maxUses: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface AdminRedemption extends Redemption {
  profileId: string;
  username: string | null;
  name: string | null;
}

export interface CodeLogRow {
  id: string;
  type: string;
  result: string;
  detail: string;
  actorName: string | null;
  actorUsername: string | null;
  createdAt: string;
}

export interface CreateBatchInput {
  title: string;
  note?: string;
  rewardType: RewardType;
  amount?: number;
  days?: number;
  item?: string;
  percent?: number;
  count: number;
  maxUses: number;
  expiresAt?: string;
  boundTo?: string;
  customCode?: string;
  stepUpCode: string;
}

export const apiCodesStepUp = () =>
  req<{ ok: boolean; method?: 'app' | 'email' }>('/api/admin/codes/step-up', { method: 'POST', body: '{}' });

export const apiCreateBatch = (b: CreateBatchInput) =>
  req<{ ok: true; batch: { id: string; title: string; count: number; maxUses: number }; codes: string[] }>(
    '/api/admin/codes/batches', { method: 'POST', body: JSON.stringify(b) });

export const apiBatches = () => req<{ items: Batch[] }>('/api/admin/codes/batches');

export const apiBatchCodes = (id: string, status?: string) =>
  req<{ batch: Batch; items: CodeRow[]; total: number }>(
    `/api/admin/codes/batches/${id}/codes${status ? `?status=${status}` : ''}`);

export const apiRevokeCode = (id: string, reason: string) =>
  req<{ ok: true }>(`/api/admin/codes/codes/${id}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) });

export const apiRevokeBatch = (id: string, reason: string) =>
  req<{ ok: true; revoked: number }>(`/api/admin/codes/batches/${id}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) });

export const apiCodeRedemptions = () => req<{ items: AdminRedemption[] }>('/api/admin/codes/redemptions?limit=100');
export const apiCodeLog = () => req<{ items: CodeLogRow[] }>('/api/admin/codes/log');
export const apiCodeItems = () => req<{ items: { id: string; category: string }[] }>('/api/admin/codes/items');

/** CSV серии (без открытых кодов — только хвост, статус, использование). */
export const apiExportBatch = async (id: string) => {
  const r = await apiText(`/api/admin/codes/batches/${id}/export`);
  if (!r.ok) return { ok: false as const, status: r.status };
  downloadText(`sky-codes-${id.slice(4, 12)}.csv`, r.text);
  return { ok: true as const };
};

export const rewardText = (r: Reward): string => {
  switch (r.type) {
    case 'balance':  return `+${r.amount.toLocaleString('ru-RU')} ₽ на баланс`;
    case 'points':   return `+${r.amount.toLocaleString('ru-RU')} баллов`;
    case 'prime':    return `Sky Prime на ${r.days} дн.`;
    case 'item':     return `Предмет: ${r.item}`;
    case 'discount': return `Скидка ${r.percent}% на Prime`;
  }
};

export const downloadText = (name: string, text: string, mime = 'text/csv;charset=utf-8') => {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
