import { apiCall } from '@/core/auth/api';

export type CalSource = 'event' | 'capsule' | 'life' | 'ticket' | 'booking' | 'parking' | 'trip';
export interface CalItem {
  id: string; source: CalSource; ref: string; title?: string | null; notes?: string; start: string; end: string | null; allDay: boolean; color: string;
  repeat?: string; remindMin?: number | null; mine?: boolean; ownerName?: string; invite?: 'pending' | 'accepted' | 'declined'; going?: number;
  toSelf?: boolean; what?: string; state?: string; place?: string | null; qty?: number;
}
export interface CalEventInput { title: string; notes?: string; start: string; end?: string | null; allDay?: boolean; repeat?: string; remindMin?: number | null; color?: string }
export interface Guest { id: string; name: string; username: string; status: 'pending' | 'accepted' | 'declined' }
export interface PendingInvite { id: string; title: string; start: string; ownerName: string }

export const calApi = {
  range: (from: Date, to: Date) => apiCall<{ items: CalItem[]; unavailable: string[] }>(`/api/cal/range?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
  create: (b: CalEventInput) => apiCall<{ ok: boolean; id: string }>('/api/cal/events', { method: 'POST', body: JSON.stringify(b) }),
  update: (id: string, b: Partial<CalEventInput>) => apiCall<{ ok: boolean }>(`/api/cal/events/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  remove: (id: string) => apiCall<{ ok: boolean; left?: boolean }>(`/api/cal/events/${id}`, { method: 'DELETE' }),
  guests: (id: string) => apiCall<{ guests: Guest[] }>(`/api/cal/events/${id}/guests`),
  invite: (id: string, ids: string[]) => apiCall<{ ok: boolean; sent: number }>(`/api/cal/events/${id}/invite`, { method: 'POST', body: JSON.stringify({ ids }) }),
  respond: (id: string, accept: boolean) => apiCall<{ ok: boolean }>(`/api/cal/events/${id}/respond`, { method: 'POST', body: JSON.stringify({ accept }) }),
  invites: () => apiCall<{ invites: PendingInvite[] }>('/api/cal/invites'),
};
