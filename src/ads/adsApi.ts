/* ===============================================================
   SKY ADS — разговор с сервером (server/ads.mjs, routes/ads.mjs).

   Ничего здесь не решается: цена, право показывать рекламу этому
   человеку, регион, Prime, статус кампании — решает только сервер.
   Этот файл только зовёт ручки и приводит ответ к клиентским типам.
=============================================================== */
import { apiCall, uploadUrl } from '@/core/auth/api';
import { NATIVE_APP, MEDIA_BY_URL } from '@/core/nativeApp';
import type { AdCampaign, AdPlacement, AdFormat } from './store';

/**
 * Тег <img>/<video> не шлёт Authorization — сервер узнаёт по куке.
 *
 * В родном приложении страница и API — разные origin, и кука
 * SameSite=Strict туда не доедет. Поэтому там же пропуск подставляется
 * в адрес строкой (?t=), а адрес становится абсолютным (uploadUrl) —
 * см. musicApi.ts::withMediaTicket, тот же приём.
 */
let mediaTicket: string | null = null;

export const apiAdsTicket = async () => {
  const r = await apiCall<{ ticket?: string }>('/api/ads/ticket', { method: 'POST', body: '{}' });
  if (r.ok && r.data?.ticket) mediaTicket = r.data.ticket;
  return r.ok;
};

export const adMediaUrl = (mediaId: string) => {
  const url = uploadUrl(`/api/ads/media/${encodeURIComponent(mediaId)}`);
  if (!MEDIA_BY_URL || !mediaTicket) return url;
  return `${url}?t=${encodeURIComponent(mediaTicket)}`;
};

export interface UploadedAdMedia { mediaId: string; mime: string; kind: 'image' | 'video'; bytes: number }

export const apiUploadAdMedia = async (file: File): Promise<UploadedAdMedia | null> => {
  const r = await apiCall<UploadedAdMedia>('/api/ads/media', {
    method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  return r.ok ? r.data ?? null : null;
};

/* ═══ Рекламодатель ═════════════════════════════════════════ */

export interface CreateCampaignInput {
  title: string;
  description?: string;
  placement: AdPlacement;
  format: AdFormat;
  mediaId?: string;
  linkUrl?: string;
  durationDays: number;
  dailyLimit: number;
  targetRegions?: string[];
  startDate?: string;
}

export const apiCreateCampaign = async (input: CreateCampaignInput) => {
  const r = await apiCall<{ campaign: AdCampaign }>('/api/ads/campaigns', {
    method: 'POST', body: JSON.stringify(input),
  });
  return r.ok && r.data ? { ok: true as const, campaign: r.data.campaign } : { ok: false as const, error: r.error, reason: r.reason };
};

export const apiMyCampaigns = async (): Promise<AdCampaign[]> => {
  const r = await apiCall<{ items: AdCampaign[] }>('/api/ads/campaigns');
  return r.ok ? r.data?.items ?? [] : [];
};

export interface CampaignEvent { id: string; kind: string; actorName?: string; actorUsername?: string; detail: string; createdAt: string }
export interface CampaignDetail {
  campaign: AdCampaign;
  statsByRegion: { region: string; impressions: number }[];
  statsByDay: { day: string; impressions: number }[];
  events: CampaignEvent[];
}

export const apiCampaignDetail = async (id: string): Promise<CampaignDetail | null> => {
  const r = await apiCall<CampaignDetail>(`/api/ads/campaigns/${encodeURIComponent(id)}`);
  return r.ok ? r.data ?? null : null;
};

export const apiPauseCampaign = async (id: string) => {
  const r = await apiCall(`/api/ads/campaigns/${encodeURIComponent(id)}/pause`, { method: 'POST', body: '{}' });
  return r.ok;
};
export const apiResumeCampaign = async (id: string) => {
  const r = await apiCall(`/api/ads/campaigns/${encodeURIComponent(id)}/resume`, { method: 'POST', body: '{}' });
  return r.ok;
};
export const apiCancelCampaign = async (id: string) => {
  const r = await apiCall(`/api/ads/campaigns/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' });
  return r.ok;
};
export const apiReportCampaign = async (id: string, reason: string) => {
  const r = await apiCall(`/api/ads/campaigns/${encodeURIComponent(id)}/report`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
  return r.ok;
};

/* ═══ Показ рекламы ═══════════════════════════════════════════ */

export interface ServedAd {
  campaignId: string;
  title: string;
  description: string;
  mediaUrl?: string;
  format: AdFormat;
  linkUrl?: string;
}

export const apiServeAd = async (placement: AdPlacement): Promise<ServedAd | null> => {
  const r = await apiCall<{ ad: ServedAd | null }>(`/api/ads/serve?placement=${encodeURIComponent(placement)}`);
  return r.ok ? r.data?.ad ?? null : null;
};

export const apiRecordImpression = async (campaignId: string, placement: AdPlacement): Promise<string | null> => {
  const r = await apiCall<{ impressionId: string }>('/api/ads/impression', {
    method: 'POST', body: JSON.stringify({ campaignId, placement }),
  });
  return r.ok ? r.data?.impressionId ?? null : null;
};

export const apiRecordClick = async (
  campaignId: string, impressionId: string, placement: AdPlacement,
): Promise<string | null> => {
  const r = await apiCall<{ ok: true; linkUrl?: string }>('/api/ads/click', {
    method: 'POST', body: JSON.stringify({ campaignId, impressionId, placement }),
  });
  return r.ok ? r.data?.linkUrl ?? null : null;
};

/* ═══ Уведомления рекламодателю ═══════════════════════════════ */

export interface AdEvent { id: string; kind: string; title: string; campaignId: string; detail: string; createdAt: string }

export const apiAdEvents = async (sinceMs: number): Promise<{ events: AdEvent[]; now: number }> => {
  const r = await apiCall<{ events: AdEvent[]; now: number }>(`/api/ads/events?since=${sinceMs}`);
  return r.ok && r.data ? r.data : { events: [], now: Date.now() };
};

/* ═══ Админка ═══════════════════════════════════════════════════
   Право проверяет сервер (RBAC 'content') — здесь только вызовы. */

export interface AdminAdCampaign extends AdCampaign { advertiserName: string; advertiserUsername: string }

export const apiAdminCampaigns = async (
  opts: { status?: string; q?: string; limit?: number } = {},
): Promise<AdminAdCampaign[]> => {
  const p = new URLSearchParams();
  if (opts.status) p.set('status', opts.status);
  if (opts.q) p.set('q', opts.q);
  if (opts.limit) p.set('limit', String(opts.limit));
  const qs = p.toString();
  const r = await apiCall<{ items: AdminAdCampaign[] }>(`/api/ads/admin/campaigns${qs ? `?${qs}` : ''}`);
  return r.ok ? r.data?.items ?? [] : [];
};

export type AdminAction = 'approve' | 'reject' | 'pause' | 'resume' | 'complete' | 'cancel';

export const apiAdminAction = async (id: string, action: AdminAction, reason?: string) => {
  const r = await apiCall(`/api/ads/admin/campaigns/${encodeURIComponent(id)}/${action}`, {
    method: 'POST', body: JSON.stringify(reason ? { reason } : {}),
  });
  return r.ok;
};
