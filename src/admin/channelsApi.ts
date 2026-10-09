import { apiCall } from '@/core/auth/api';

export interface AdminChannel {
  id: string;
  type: 'channel' | 'group';
  name: string;
  username: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerUsername: string | null;
  memberCount: number;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

export type ChannelKind = 'channel' | 'group' | 'all';

export const apiAdminChannels = (opts: { q?: string; type?: ChannelKind; limit?: number; offset?: number }) => {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.type) p.set('type', opts.type);
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.offset) p.set('offset', String(opts.offset));
  return apiCall<{ total: number; items: AdminChannel[] }>(`/api/admin/channels?${p}`);
};

export const apiAdminDeleteChannel = (id: string) =>
  apiCall<{ ok: boolean }>(`/api/admin/channels/${encodeURIComponent(id)}`, { method: 'DELETE' });
