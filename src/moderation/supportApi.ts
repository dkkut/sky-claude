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
  /** Нет у обращения с сайта (человек писал без входа в аккаунт). */
  authorId?: string;
  /** `site` — обращение с лендинга; контакт — почта (видна только сотрудникам). */
  source?: 'app' | 'site';
  guestEmail?: string;
  guestCode?: string;
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

export interface SupportStatus {
  restrictions: Restrictions;
  /** Разбирает ли этот человек обращения поддержки. */
  staff: boolean;
  /** Видит ли очередь видеообзоров складов. */
  logistics: boolean;
  /** Администратор ли вообще — вход в панель, а не право внутри неё.
      Панель сама решает, что показать: пусто и объяснение почему, если
      прав нет или просрочен второй фактор, иначе — то, что положено
      роли. */
  isAdmin: boolean;
}

/**
 * Что сейчас запрещено и кто я такой — решает сервер, здесь только
 * показ. Признаки сотрудника берутся отсюда, а не из профиля: владелец
 * является администратором по нику, и в профиле этого не видно.
 */
export const apiSupportStatus = async (): Promise<SupportStatus> => {
  const r = await apiCall<{
    restrictions: Restrictions; staff?: boolean; logistics?: boolean; isAdmin?: boolean;
  }>('/api/support/status');
  return r.ok
    ? {
      restrictions: r.data?.restrictions ?? {},
      staff: Boolean(r.data?.staff),
      logistics: Boolean(r.data?.logistics),
      isAdmin: Boolean(r.data?.isAdmin),
    }
    : { restrictions: {}, staff: false, logistics: false, isAdmin: false };
};

export const apiSupportTickets = async (): Promise<SupportTicket[] | null> => {
  const r = await apiCall<{ tickets: SupportTicket[] }>('/api/support/tickets');
  return r.ok ? (r.data?.tickets ?? []) : null;
};

export const apiReadTicket = async (id: string): Promise<SupportTicket | null> => {
  const r = await apiCall<{ ticket: SupportTicket }>(`/api/support/ticket/${id}`);
  return r.ok ? (r.data?.ticket ?? null) : null;
};

/** То же, но с причиной отказа: очередь поддержки обязана показать, почему обращение не открылось (а не «просто не нажимается»). */
export const apiReadTicketEx = async (id: string): Promise<{ ticket: SupportTicket | null; error?: string }> => {
  const r = await apiCall<{ ticket: SupportTicket }>(`/api/support/ticket/${id}`);
  if (r.ok && r.data?.ticket) return { ticket: r.data.ticket };
  return { ticket: null, error: r.ok ? 'not_found' : (r.error ?? `http_${r.status ?? 0}`) };
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
