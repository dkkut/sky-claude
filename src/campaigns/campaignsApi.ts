/**
 * Мероприятия: разговор с сервером.
 *
 * Второй, самостоятельный смысл слова «мероприятия» — не путать с
 * билетами Sky Tickets. Здесь — маркетинговая кампания с наградой за
 * выполненное условие (первая: подтверждённые просмотры → Sky Prime).
 *
 * Всё решает сервер: уровень награды, число подтверждённых просмотров,
 * право на выдачу. Этот файл только спрашивает и показывает ответ.
 */
import { apiCall } from '@/core/auth/api';
import { shareOrigin } from '@/core/nativeApp';

export type CampaignStatus = 'active' | 'suspicious' | 'blocked';
export type GrantStatus = 'pending' | 'approved' | 'rejected' | 'granted' | 'failed';

export interface Campaign {
  id: string;
  title: string;
  description: string;
  conditions: string;
  rewardKind: 'prime';
  hasCover: boolean;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  archived: boolean;
  createdAt?: string;
}

export interface CampaignLevel {
  id: string;
  campaignId: string;
  viewsThreshold: number;
  rewardDays: number;
  sortOrder: number;
  active: boolean;
}

export interface CampaignDetail extends Campaign {
  levels: CampaignLevel[];
}

export interface RewardGrant {
  id: string;
  levelId: string;
  viewsThreshold: number;
  rewardDays: number;
  viewsAtRequest: number;
  status: GrantStatus;
  ticketId: string | null;
  grantedAt: string | null;
  createdAt: string;
}

export interface Participation {
  id: string;
  campaignId: string;
  videoUrl: string;
  status: CampaignStatus;
  views: number;
  currentLevel: CampaignLevel | null;
  nextLevel: CampaignLevel | null;
  levels: CampaignLevel[];
  grants: RewardGrant[];
  createdAt: string;
}

const ERRORS: Record<string, string> = {
  not_found: 'Не найдено',
  not_allowed: 'Недостаточно прав',
  blocked: 'Участие заблокировано',
  no_level_reached: 'Пока не набрано просмотров ни на один уровень',
  already_requested: 'Награда за этот уровень уже запрошена',
  bad_title: 'Заполните название',
  bad_starts_at: 'Некорректная дата начала',
  bad_ends_at: 'Некорректная дата окончания',
  bad_window: 'Дата начала должна быть раньше даты окончания',
  bad_views: 'Порог просмотров должен быть целым положительным числом',
  bad_days: 'Награда — от 1 до 90 дней',
  threshold_taken: 'Такой порог просмотров уже есть в шкале',
  too_many_levels: 'В шкале уже достаточно уровней',
  has_grants: 'По этому уровню уже есть выданные награды — удалить нельзя',
  too_large: 'Файл слишком большой',
  unsupported_image: 'Неподдерживаемый формат картинки',
  too_many_requests: 'Слишком часто. Попробуйте чуть позже',
};

export const campaignErrorText = (code?: string) => ERRORS[code ?? ''] ?? 'Не получилось';

/* ─── Участник ─────────────────────────────────────────────────────────── */

export const apiCampaigns = async () => {
  const r = await apiCall<{ campaigns: Campaign[] }>('/api/campaigns');
  return r.ok ? (r.data?.campaigns ?? []) : null;
};

export const apiCampaignDetail = async (id: string) => {
  const r = await apiCall<{ campaign: CampaignDetail }>(`/api/campaigns/${encodeURIComponent(id)}`);
  return r.ok ? (r.data?.campaign ?? null) : null;
};

export const apiCampaignJoin = async (id: string, videoUrl?: string) => {
  const r = await apiCall<{ id: string; link: string; alreadyJoined?: boolean }>(
    `/api/campaigns/${encodeURIComponent(id)}/join`, { method: 'POST', body: JSON.stringify({ videoUrl }) });
  if (r.ok) return { ok: true as const, id: r.data?.id ?? '', link: r.data?.link ?? '', alreadyJoined: Boolean(r.data?.alreadyJoined) };
  return { ok: false as const, reason: campaignErrorText(r.error) };
};

export const apiCampaignMine = async (id: string) => {
  const r = await apiCall<{ participation: Participation | null }>(`/api/campaigns/${encodeURIComponent(id)}/mine`);
  return r.ok ? (r.data?.participation ?? null) : null;
};

export const apiParticipationLink = async (participationId: string) => {
  const r = await apiCall<{ link: string }>(`/api/campaigns/participations/${encodeURIComponent(participationId)}/link`);
  if (r.ok) return { ok: true as const, link: r.data?.link ?? '' };
  return { ok: false as const, reason: campaignErrorText(r.error) };
};

export const apiRegenerateLink = async (participationId: string) => {
  const r = await apiCall<{ link: string }>(
    `/api/campaigns/participations/${encodeURIComponent(participationId)}/link/regenerate`, { method: 'POST' });
  if (r.ok) return { ok: true as const, link: r.data?.link ?? '' };
  return { ok: false as const, reason: campaignErrorText(r.error) };
};

export const apiRequestReward = async (participationId: string) => {
  const r = await apiCall<{ id: string; ticketId: string; rewardDays: number }>(
    `/api/campaigns/participations/${encodeURIComponent(participationId)}/request-reward`, { method: 'POST' });
  if (r.ok) return { ok: true as const, id: r.data?.id ?? '', ticketId: r.data?.ticketId ?? '', rewardDays: r.data?.rewardDays ?? 0 };
  return { ok: false as const, reason: campaignErrorText(r.error) };
};

/** Публичный переход по ссылке — тот, что кликает зритель ролика. Не требует входа. */
export const campaignLinkUrl = (link: string) => `${shareOrigin()}/api/campaigns/r/${encodeURIComponent(link)}`;

export const campaignCoverUrl = (id: string) => `/api/campaigns/${encodeURIComponent(id)}/cover`;

/* ─── Администрирование (право campaigns) ────────────────────────────── */

export interface CampaignInput {
  title: string;
  description?: string;
  conditions?: string;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface AdminParticipant {
  id: string;
  profileId: string;
  username: string;
  skyId: string;
  videoUrl: string;
  status: CampaignStatus;
  suspiciousReason: string;
  views: number;
  createdAt: string;
}

export interface AdminGrant {
  id: string;
  participationId: string;
  profileId: string;
  username: string;
  skyId: string;
  campaignId: string;
  campaignTitle: string;
  viewsThreshold: number;
  viewsAtRequest: number;
  rewardDays: number;
  status: GrantStatus;
  ticketId: string | null;
  pendingActionId: string | null;
  grantedAt: string | null;
  createdAt: string;
}

export const apiAdminCampaigns = async () => {
  const r = await apiCall<{ campaigns: Campaign[] }>('/api/campaigns/admin');
  return r.ok ? (r.data?.campaigns ?? []) : null;
};

export const apiAdminCreateCampaign = async (input: CampaignInput) => {
  const r = await apiCall<{ id: string }>('/api/campaigns/admin', { method: 'POST', body: JSON.stringify(input) });
  if (r.ok) return { ok: true as const, id: r.data?.id ?? '' };
  return { ok: false as const, reason: campaignErrorText(r.error) };
};

export const apiAdminUpdateCampaign = async (id: string, input: CampaignInput) => {
  const r = await apiCall(`/api/campaigns/admin/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
  return r.ok ? { ok: true as const } : { ok: false as const, reason: campaignErrorText(r.error) };
};

export const apiAdminSetCampaignActive = async (id: string, on: boolean) => {
  const r = await apiCall(`/api/campaigns/admin/${encodeURIComponent(id)}/active`, { method: 'POST', body: JSON.stringify({ on }) });
  return r.ok;
};

export const apiAdminArchiveCampaign = async (id: string) => {
  const r = await apiCall(`/api/campaigns/admin/${encodeURIComponent(id)}/archive`, { method: 'POST' });
  return r.ok;
};

export const apiAdminUploadCover = async (id: string, file: File) => {
  const r = await apiCall(`/api/campaigns/admin/${encodeURIComponent(id)}/cover`,
    { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  return r.ok ? { ok: true as const } : { ok: false as const, reason: campaignErrorText(r.error) };
};

export const apiAdminParticipants = async (campaignId: string) => {
  const r = await apiCall<{ participants: AdminParticipant[] }>(`/api/campaigns/admin/${encodeURIComponent(campaignId)}/participants`);
  return r.ok ? (r.data?.participants ?? []) : null;
};

export const apiAdminLevels = async (campaignId: string) => {
  const r = await apiCall<{ levels: CampaignLevel[] }>(`/api/campaigns/admin/${encodeURIComponent(campaignId)}/levels`);
  return r.ok ? (r.data?.levels ?? []) : null;
};

export interface LevelInput {
  viewsThreshold: number;
  rewardDays: number;
  sortOrder?: number;
}

export const apiAdminCreateLevel = async (campaignId: string, input: LevelInput) => {
  const r = await apiCall<{ id: string }>(`/api/campaigns/admin/${encodeURIComponent(campaignId)}/levels`,
    { method: 'POST', body: JSON.stringify(input) });
  if (r.ok) return { ok: true as const, id: r.data?.id ?? '' };
  return { ok: false as const, reason: campaignErrorText(r.error) };
};

export const apiAdminUpdateLevel = async (campaignId: string, levelId: string, input: LevelInput) => {
  const r = await apiCall(`/api/campaigns/admin/${encodeURIComponent(campaignId)}/levels/${encodeURIComponent(levelId)}`,
    { method: 'PATCH', body: JSON.stringify(input) });
  return r.ok ? { ok: true as const } : { ok: false as const, reason: campaignErrorText(r.error) };
};

export const apiAdminSetLevelActive = async (campaignId: string, levelId: string, on: boolean) => {
  const r = await apiCall(`/api/campaigns/admin/${encodeURIComponent(campaignId)}/levels/${encodeURIComponent(levelId)}/active`,
    { method: 'POST', body: JSON.stringify({ on }) });
  return r.ok;
};

export const apiAdminDeleteLevel = async (campaignId: string, levelId: string) => {
  const r = await apiCall(`/api/campaigns/admin/${encodeURIComponent(campaignId)}/levels/${encodeURIComponent(levelId)}`,
    { method: 'DELETE' });
  return r.ok ? { ok: true as const } : { ok: false as const, reason: campaignErrorText(r.error) };
};

export const apiAdminGrants = async (opts: { status?: string; campaignId?: string } = {}) => {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.campaignId) params.set('campaignId', opts.campaignId);
  const qs = params.toString();
  const r = await apiCall<{ grants: AdminGrant[] }>(`/api/campaigns/admin/grants${qs ? `?${qs}` : ''}`);
  return r.ok ? (r.data?.grants ?? []) : null;
};

export const apiAdminRejectGrant = async (grantId: string, reason: string) => {
  const r = await apiCall(`/api/campaigns/admin/grants/${encodeURIComponent(grantId)}/reject`,
    { method: 'POST', body: JSON.stringify({ reason }) });
  return r.ok ? { ok: true as const } : { ok: false as const, reason: campaignErrorText(r.error) };
};
