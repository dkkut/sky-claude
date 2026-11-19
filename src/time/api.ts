import { apiCall } from '@/core/auth/api';

export interface Peer { id: string; name: string; username: string }
export interface Capsule {
  id: string; status: 'sealed' | 'opened'; openAt: string; openedAt?: string | null; createdAt: string;
  locked: boolean; toSelf: boolean; fromMe: boolean; forMe: boolean; peer: Peer;
  /** Только у вскрытых. */
  title?: string; text?: string;
}
export interface CapsuleList { sealed: Capsule[]; opened: Capsule[]; limits: { sealed: number; textMax: number } }
export interface BalanceSettings { tracking: boolean; dailyTotal: number | null; limits: Record<string, number>; quietFrom: number | null; quietTo: number | null; tzOffset: number }
export interface UsageReport {
  days: number; total: number; previous: number; avgPerActiveDay: number; todayTotal: number;
  today: Record<string, number>;
  byDay: { day: string; seconds: number }[]; byModule: { module: string; seconds: number }[];
}
export interface ThisDayItem { kind: 'registered' | 'post' | 'friend' | 'music' | 'capsule'; year: number; title: string; text?: string; peer?: Peer }

export const timeApi = {
  capsules: () => apiCall<CapsuleList>('/api/time/capsules'),
  createCapsule: (b: { text: string; title?: string; openAt: string; to?: string; locked?: boolean }) =>
    apiCall<{ ok: boolean }>('/api/time/capsules', { method: 'POST', body: JSON.stringify(b) }),
  cancelCapsule: (id: string) => apiCall<{ ok: boolean }>(`/api/time/capsules/${id}/cancel`, { method: 'POST', body: '{}' }),
  balance: () => apiCall<BalanceSettings>('/api/time/balance'),
  saveBalance: (b: Partial<BalanceSettings>) => apiCall<BalanceSettings>('/api/time/balance', { method: 'PUT', body: JSON.stringify(b) }),
  report: (days = 7) => apiCall<UsageReport>(`/api/time/report?days=${days}`),
  clearUsage: () => apiCall<{ ok: boolean }>('/api/time/usage', { method: 'DELETE' }),
  sendUsage: (entries: { module: string; seconds: number }[]) =>
    apiCall<{ ok: boolean }>('/api/time/usage', { method: 'POST', body: JSON.stringify({ entries }) }),
  today: (date: string) => apiCall<{ date: string; items: ThisDayItem[] }>(`/api/time/today?date=${date}`),
};
