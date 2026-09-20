/* ===============================================================
   Рассылки — обёртки над server/notifyBroadcast.mjs.

   /api/notify/events — то же самое «опросить новое с такого-то
   момента», что уже есть у Bloom (apiBloomEvents), просто источник
   другой: не лайки/комментарии, а рассылки из админки. Показ в
   интерфейсе — тот же useNotifStore/NotifBridge, ничего нового.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export interface BroadcastEvent {
  id: string;
  title: string;
  body: string;
  link?: string;
  createdAt: string;
}

export const apiBroadcastEvents = async (sinceMs: number): Promise<{ events: BroadcastEvent[]; now: number }> => {
  const r = await apiCall<{ events: BroadcastEvent[]; now: number }>(`/api/notify/events?since=${sinceMs}`);
  return r.ok && r.data ? r.data : { events: [], now: Date.now() };
};

/* ─── Админка ──────────────────────────────────────────────────────── */

export type AudienceType = 'all' | 'users' | 'region';
export type ScheduleKind = 'once' | 'daily' | 'weekly';
export type BroadcastStatus = 'draft' | 'scheduled' | 'processing' | 'sent' | 'cancelled' | 'failed';

export interface Broadcast {
  id: string;
  createdBy?: string;
  creatorName?: string;
  creatorUsername?: string;
  title: string;
  body: string;
  link?: string;
  audienceType: AudienceType;
  audienceUserIds: string[];
  audienceRegion?: string;
  scheduleKind: ScheduleKind;
  scheduledAt?: string;
  timezoneLabel?: string;
  status: BroadcastStatus;
  reason?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  lastError?: string;
  lastSentAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BroadcastRun {
  id: string;
  scheduledFor: string;
  status: 'processing' | 'sent' | 'failed';
  recipientsTotal: number;
  recipientsSent: number;
  recipientsFailed: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface CreateBroadcastInput {
  title: string;
  body: string;
  link?: string;
  audienceType: AudienceType;
  usernames?: string[];
  region?: string;
  scheduleKind?: ScheduleKind;
  sendNow?: boolean;
  scheduledAt?: string;
  timezoneLabel?: string;
  reason?: string;
}

export const apiAdminCreateBroadcast = (body: CreateBroadcastInput) =>
  apiCall<{ broadcast: Broadcast }>('/api/notify/admin/broadcasts', { method: 'POST', body: JSON.stringify(body) });

export const apiAdminListBroadcasts = (params: { status?: BroadcastStatus; limit?: number } = {}) => {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.limit) q.set('limit', String(params.limit));
  return apiCall<{ items: Broadcast[] }>(`/api/notify/admin/broadcasts?${q}`);
};

export const apiAdminGetBroadcast = (id: string) =>
  apiCall<{ broadcast: Broadcast; runs: BroadcastRun[] }>(`/api/notify/admin/broadcasts/${encodeURIComponent(id)}`);

export const apiAdminCancelBroadcast = (id: string, reason?: string) =>
  apiCall<{ ok: boolean }>(`/api/notify/admin/broadcasts/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
