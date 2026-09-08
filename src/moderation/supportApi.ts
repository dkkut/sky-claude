/**
 * Обращения в поддержку.
 *
 * Ходят по обычному HTTP, а не через хаб мессенджера: заблокированного
 * в хаб не пускают, а обжаловать блокировку он должен иметь
 * возможность. Это же делает обращения доступными с экрана блокировки,
 * из которого выхода в приложение нет.
 */
import { apiCall } from '@/core/auth/api';

export type TicketStatus = 'open' | 'in_progress' | 'waiting' | 'closed';
export type TicketKind = 'question' | 'bug' | 'idea' | 'report' | 'appeal';

export interface SupportMessage {
  id: string;
  authorId?: string;
  fromStaff: boolean;
  body: string;
  createdAt: string;
}

export interface SupportEvent {
  id: string;
  actorId?: string;
  type: string;
  detail: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  authorId: string;
  subject: string;
  kind: TicketKind;
  status: TicketStatus;
  assigneeId?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  messages?: SupportMessage[];
  events?: SupportEvent[];
}

export interface Restrictions {
  bannedUntil?: string;
  mutedUntil?: string;
  spamUntil?: string;
}

/** Что сейчас запрещено — решает сервер, здесь только показ. */
export const apiRestrictions = async (): Promise<Restrictions> => {
  const r = await apiCall<{ restrictions: Restrictions }>('/api/support/status');
  return r.ok ? (r.data?.restrictions ?? {}) : {};
};

export const apiSupportTickets = async (): Promise<SupportTicket[] | null> => {
  const r = await apiCall<{ tickets: SupportTicket[] }>('/api/support/tickets');
  return r.ok ? (r.data?.tickets ?? []) : null;
};

export const apiReadTicket = async (id: string): Promise<SupportTicket | null> => {
  const r = await apiCall<{ ticket: SupportTicket }>(`/api/support/ticket/${id}`);
  return r.ok ? (r.data?.ticket ?? null) : null;
};

/** Понятные слова вместо кодов отказа. */
const REASONS: Record<string, string> = {
  empty:    'Напишите, что случилось',
  too_many: 'Слишком много обращений за короткое время',
  closed:   'Обращение закрыто',
  not_allowed: 'Недостаточно прав',
  not_admin:   'Ответственным можно назначить только администратора',
  not_found:   'Обращение не найдено',
};

const explain = (error?: string, fallback?: string) =>
  REASONS[error ?? ''] ?? fallback ?? 'Не получилось';

export const apiCreateTicket = async (
  body: { subject?: string; body: string; kind?: TicketKind },
): Promise<{ ok: boolean; ticket?: SupportTicket; reason?: string }> => {
  const r = await apiCall<{ ticket: SupportTicket }>('/api/support/tickets',
    { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, reason: explain(r.error, r.reason) };
  return { ok: true, ticket: r.data?.ticket };
};

export const apiReplyTicket = async (
  id: string, body: string,
): Promise<{ ok: boolean; ticket?: SupportTicket; reason?: string }> => {
  const r = await apiCall<{ ticket: SupportTicket }>(`/api/support/ticket/${id}/reply`,
    { method: 'POST', body: JSON.stringify({ body }) });
  if (!r.ok) return { ok: false, reason: explain(r.error, r.reason) };
  return { ok: true, ticket: r.data?.ticket };
};

/* ─── Для тех, кто разбирает обращения ─────────────────────────────────── */

export const apiSupportQueue = async (
  opts: { status?: TicketStatus; mine?: boolean } = {},
): Promise<SupportTicket[] | null> => {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.mine) params.set('mine', '1');
  const q = params.toString();
  const r = await apiCall<{ tickets: SupportTicket[] }>(
    `/api/support/queue${q ? `?${q}` : ''}`);
  return r.ok ? (r.data?.tickets ?? []) : null;
};

export const apiSupportAdmins = async (): Promise<{ id: string; name: string; username: string }[] | null> => {
  const r = await apiCall<{ admins: { id: string; name: string; username: string }[] }>(
    '/api/support/admins');
  return r.ok ? (r.data?.admins ?? []) : null;
};

export const apiAssignTicket = async (
  id: string, assigneeId: string | null,
): Promise<{ ok: boolean; ticket?: SupportTicket; reason?: string }> => {
  const r = await apiCall<{ ticket: SupportTicket }>(`/api/support/ticket/${id}/assign`,
    { method: 'POST', body: JSON.stringify({ assigneeId }) });
  if (!r.ok) return { ok: false, reason: explain(r.error, r.reason) };
  return { ok: true, ticket: r.data?.ticket };
};

export const apiTicketStatus = async (
  id: string, status: TicketStatus,
): Promise<{ ok: boolean; ticket?: SupportTicket; reason?: string }> => {
  const r = await apiCall<{ ticket: SupportTicket }>(`/api/support/ticket/${id}/status`,
    { method: 'POST', body: JSON.stringify({ status }) });
  if (!r.ok) return { ok: false, reason: explain(r.error, r.reason) };
  return { ok: true, ticket: r.data?.ticket };
};
