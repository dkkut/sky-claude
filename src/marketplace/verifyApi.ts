import { apiCall, apiBlob } from '@/core/auth/api';
import type { TaxKind, VerificationState, ModerationStatus, Product } from './types';

/* Клиент проверки продавцов, документов, модерации и жалоб. Ничего тут не
   решается: подтверждённый статус, допуск и отметки приходят с сервера. */

type Res<T> = { ok: true; data: T } | { ok: false; error?: string; reason?: string; data?: any };

const req = async <T>(path: string, init?: RequestInit): Promise<Res<T>> => {
  const r = await apiCall<T>(path, init);
  return r.ok
    ? { ok: true, data: r.data as T }
    : { ok: false, error: r.error, reason: r.reason, data: r.data as any };
};
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body ?? {}) });
const enc = encodeURIComponent;
const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export type AppStatus = 'draft' | 'submitted' | 'in_review' | 'needs_changes' | 'approved' | 'rejected';

export interface DocView {
  id: string; type: string; typeLabel: string; label: string; mime: string; bytes: number;
  status: 'pending' | 'accepted' | 'rejected'; comment: string; createdAt: string;
}

export interface FormField {
  key: string; label: string; required: boolean; max?: number; type?: string;
}

export interface VerifyConfig {
  kinds: { key: TaxKind; label: string; fields: FormField[]; docs: { type: string; label: string }[] }[];
  activities: { key: string; label: string }[];
  categories: string[];
  docTypes: Record<string, string>;
}

export interface ApplicationView {
  id: string; kind: TaxKind; kindLabel: string; requestType: 'initial' | 'change'; status: AppStatus;
  activities: string[]; categories: string[]; activityDescription: string;
  fields?: Record<string, string | boolean>; uncertain?: boolean; sellerCountry: string; innTail: string;
  missing: string[]; adminComment: string; rejectReason: string; isCurrent: boolean; revision: number;
  submittedAt: string | null; decidedAt: string | null; createdAt: string;
  requiredDocs: { type: string; label: string }[]; docs: DocView[];
}

export interface HistoryEvent {
  action: string; from: string | null; to: string | null; comment: string; by: string; at: string; appId?: string | null;
}

export interface MyVerification {
  seller?: null;
  profileId: string;
  verification: VerificationState;
  shopStatus: 'pending' | 'active' | 'suspended';
  suspendReason: string;
  taxKind: TaxKind | null;
  capabilities: null | {
    kind: TaxKind;
    activities: { key: string; label: string; allowedForStatus: boolean; approved: boolean; reason?: string }[];
    pvz: boolean;
  };
  application: ApplicationView | null;
  current: ApplicationView | null;
  history: HistoryEvent[];
}

export const apiVerifyConfig = () => req<VerifyConfig>('/api/market/verification/config');
export const apiMyVerification = () => req<MyVerification>('/api/market/verification');
export const apiSaveApplication = (b: {
  kind: TaxKind; activities: string[]; categories: string[]; activityDescription: string;
  fields: Record<string, string | boolean>; uncertain?: boolean; sellerCountry?: string;
}) => req<{ application: ApplicationView }>('/api/market/verification/application', json('PUT', b));
export const apiSubmitApplication = () =>
  req<{ application: ApplicationView }>('/api/market/verification/application/submit', json('POST', {}));
export const apiStartChange = () => req<MyVerification>('/api/market/verification/change', json('POST', {}));

/* — Документы — */

export const apiUploadDoc = async (
  file: File, p: { scope: 'application' | 'product' | 'pvz'; refId: string; type: string },
): Promise<Res<{ id: string }>> => {
  const r = await apiCall<{ id: string }>(
    `/api/market/docs${qs({ scope: p.scope, refId: p.refId, type: p.type, label: file.name.slice(0, 100) })}`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
  return r.ok ? { ok: true, data: r.data as { id: string } } : { ok: false, error: r.error, reason: r.reason, data: r.data };
};
export const apiListDocs = (scope: string, refId: string) =>
  req<{ items: DocView[] }>(`/api/market/docs${qs({ scope, refId })}`);
export const apiDeleteDoc = (id: string) => req<{ ok: true }>(`/api/market/docs/${enc(id)}`, { method: 'DELETE' });

/** Просмотр документа: файл приходит с токеном и открывается как blob в новой вкладке. */
export const openDoc = async (id: string): Promise<boolean> => {
  const w = window.open('', '_blank');
  const r = await apiBlob(`/api/market/docs/${enc(id)}/file`);
  if (!r.ok || !r.blob || !w) { w?.close(); return false; }
  w.location.href = URL.createObjectURL(r.blob);
  return true;
};

/* — Товар — */

export interface Blocker { code: string; message: string }
export interface ListingCheck {
  ok: boolean; blockers: Blocker[]; review: Blocker[]; requiredDocs: string[]; missingDocs: string[]; autoPublish: boolean;
}
export const apiListingCheck = (id: string) => req<{ check: ListingCheck }>(`/api/market/products/${enc(id)}/check`);
export const apiSubmitProduct = (id: string) =>
  req<{ product: Product; check: ListingCheck }>(`/api/market/products/${enc(id)}/submit`, json('POST', {}));
export const apiProductHistory = (id: string) =>
  req<{ items: { action: string; from: string | null; to: string | null; reason: string; by: string; at: string }[] }>(
    `/api/market/products/${enc(id)}/history`);

/* — Жалобы и апелляции — */

export const REPORT_REASONS: Record<string, string> = {
  prohibited: 'Запрещённый товар', counterfeit: 'Подделка', misleading: 'Вводящее в заблуждение описание',
  wrong_origin: 'Неверно указано происхождение или отправка', scam: 'Мошенничество',
  abusive: 'Оскорбительное содержимое', other: 'Другое',
};
export const apiReport = (b: { targetType: 'product' | 'shop'; targetId: string; reason: string; details?: string }) =>
  req<{ ok: true; id: string }>('/api/market/reports', json('POST', b));
export interface MyReport { id: string; targetType: string; targetId: string; reason: string; status: string; resolution: string; createdAt: string }
export const apiReportsAboutMe = () => req<{ items: MyReport[] }>('/api/market/reports/about-me');
export interface Appeal { id: string; subjectType: string; subjectId: string; text: string; status: string; decision: string; createdAt: string }
export const apiAppeal = (b: { subjectType: 'product' | 'application' | 'shop'; subjectId: string; text: string }) =>
  req<{ ok: true }>('/api/market/appeals', json('POST', b));
export const apiMyAppeals = () => req<{ items: Appeal[] }>('/api/market/appeals');

/* — ПВЗ — */

export interface PvzApplicationView {
  id: string; status: AppStatus; title: string; city: string; address: string; phone: string; contactName: string;
  premises: { ownership?: string; areaM2?: number; note?: string }; notes: string; missing: string[];
  adminComment: string; rejectReason: string; pvzId: string | null; requiredDocs: { type: string; label: string }[]; docs: DocView[];
  submittedAt: string | null;
}
export interface MyPvzApplication {
  eligible: boolean; kind: TaxKind | null; reason?: string; items: PvzApplicationView[];
  history: { action: string; from: string | null; to: string | null; comment: string; at: string }[];
}
export const apiMyPvzApplication = () => req<MyPvzApplication>('/api/pvz/application');
export const apiSavePvzApplication = (b: Record<string, unknown>) =>
  req<{ application: PvzApplicationView }>('/api/pvz/application', json('PUT', b));
export const apiSubmitPvzApplication = () =>
  req<{ application: PvzApplicationView }>('/api/pvz/application/submit', json('POST', {}));

/* ─── Администрация ───────────────────────────────────────────────── */

export interface AdminAppRow {
  id: string; profileId: string; kind: TaxKind; kindLabel: string; requestType: 'initial' | 'change'; status: AppStatus;
  innTail: string; activities: string[]; shopName: string; sellerVerification: VerificationState; name: string;
  username: string; submittedAt: string | null;
}
export const apiAdminApplications = (status = 'submitted', kind?: string) =>
  req<{ items: AdminAppRow[] }>(`/api/market/verify/applications${qs({ status, kind })}`);
export interface AdminAppDetail {
  application: ApplicationView; profileId: string;
  seller: { shopName: string; verification: VerificationState; status: string; taxKind: TaxKind | null; name: string; username: string } | null;
  earlier: { id: string; kind: TaxKind; status: AppStatus; requestType: string; decidedAt: string | null; isCurrent: boolean }[];
  history: HistoryEvent[];
}
export const apiAdminApplication = (id: string) => req<AdminAppDetail>(`/api/market/verify/applications/${enc(id)}`);
export const apiAdminAppAction = (id: string, action: string, b: { comment?: string; missing?: string[] }) =>
  req<{ ok: true; status: string }>(`/api/market/verify/applications/${enc(id)}/${action}`, json('POST', b));
export const apiAdminReviewDoc = (id: string, accept: boolean, comment?: string) =>
  req<{ ok: true }>(`/api/market/verify/docs/${enc(id)}/review`, json('POST', { accept, comment }));
export const apiAdminSellerAction = (profileId: string, action: 'suspend' | 'reinstate' | 'reverify', reason: string) =>
  req<{ ok: true }>(`/api/market/verify/sellers/${enc(profileId)}/${action}`, json('POST', { reason }));

export interface SellerAdminRow {
  id: string; shopName: string; status: string; verification: string; taxKind: string | null; suspended: boolean;
  suspendReason: string; suspendedAt: string | null; owner: string; username: string; products: number;
}
export interface PvzPointAdminRow {
  id: string; title: string; city: string; address: string; active: boolean; staffClosed: boolean; blocked: boolean;
  blockReason: string; blockedAt: string | null; ownerId: string | null; ownerStatus: string | null; owner: string | null; username: string | null;
}
export const apiAdminSellers = (q = '', status = 'all') => req<{ items: SellerAdminRow[] }>(`/api/market/verify/sellers${qs({ q, status })}`);
export const apiAdminPvzPoints = (q = '', status = 'all') => req<{ items: PvzPointAdminRow[] }>(`/api/market/verify/pvz-points${qs({ q, status })}`);
export const apiAdminPvzPointAction = (id: string, action: 'block' | 'unblock', reason: string) =>
  req<{ ok: true }>(`/api/market/verify/pvz-points/${enc(id)}/${action}`, json('POST', { reason }));

export interface ModRow {
  id: string; title: string; sellerId: string; shopName: string; status: ModerationStatus; category: string;
  marketType: string; originCountry: string | null; shipFromCountry: string | null; foreign: boolean; submittedAt: string | null;
}
export const apiModerationQueue = (status = 'pending', foreign?: boolean, q?: string) =>
  req<{ items: ModRow[] }>(`/api/market/moderation/products${qs({ status, foreign: foreign ? 'true' : undefined, q })}`);
export interface ModDetail {
  product: Product; sellerShop: string; sellerTaxKind: TaxKind | null; sellerVerification: VerificationState;
  verdict: ListingCheck; docs: DocView[]; openReports: number;
  history: { action: string; from: string | null; to: string | null; reason: string; by: string; at: string }[];
}
export const apiModerationDetail = (id: string) => req<ModDetail>(`/api/market/moderation/products/${enc(id)}`);
export const apiModerate = (id: string, action: string, reason?: string) =>
  req<{ ok: true; status: string }>(`/api/market/moderation/products/${enc(id)}/${action}`, json('POST', { reason }));

export interface ReportRow {
  id: string; targetType: string; targetId: string; reason: string; details: string; status: string; resolution: string;
  shopName: string | null; productTitle: string | null; sellerId: string; openSame: number; createdAt: string;
}
export const apiAdminReports = (status = 'open') => req<{ items: ReportRow[] }>(`/api/market/moderation/reports${qs({ status })}`);
export const apiResolveReport = (id: string, outcome: string, resolution: string, apply?: string) =>
  req<{ ok: true }>(`/api/market/moderation/reports/${enc(id)}/resolve`, json('POST', { outcome, resolution, apply }));
export interface AdminAppeal extends Appeal { sellerId: string; shopName: string }
export const apiAdminAppeals = (status = 'open') => req<{ items: AdminAppeal[] }>(`/api/market/moderation/appeals${qs({ status })}`);
export const apiDecideAppeal = (id: string, accept: boolean, decision: string) =>
  req<{ ok: true }>(`/api/market/moderation/appeals/${enc(id)}/decide`, json('POST', { accept, decision }));

export interface RulesOverview {
  kinds: TaxKind[]; docTypes: Record<string, string>;
  categories: { key: string; base: any; effective: { disabled: boolean; allowedKinds: TaxKind[]; docsWhenNew: string[]; markingPossible: boolean; manualReview: boolean }; override: any }[];
  settings: { premoderation: 'risky' | 'all'; individualMaxProducts: number };
  hardRules: string[];
}
export const apiRules = () => req<RulesOverview>('/api/market/rules');
export const apiSetCategoryRule = (cat: string, b: Record<string, unknown>) =>
  req<{ ok: true }>(`/api/market/rules/category/${enc(cat)}`, json('PUT', b));
export const apiSetSetting = (key: string, value: unknown) =>
  req<{ ok: true }>('/api/market/rules/settings', json('PUT', { key, value }));

export interface PvzAppRow {
  id: string; status: AppStatus; title: string; city: string; address: string; shopName: string; taxKind: TaxKind | null;
  name: string; username: string; submittedAt: string | null; profileId: string;
}
export const apiAdminPvzApps = (status = 'submitted') => req<{ items: PvzAppRow[] }>(`/api/market/pvz-applications${qs({ status })}`);
export const apiAdminPvzApp = (id: string) =>
  req<{ application: PvzApplicationView; applicantKind: TaxKind | null; applicantVerification: string | null; history: MyPvzApplication['history'] }>(`/api/market/pvz-applications/${enc(id)}`);
export const apiAdminPvzAction = (id: string, action: string, b: { comment?: string; missing?: string[] }) =>
  req<{ ok: true; status: string }>(`/api/market/pvz-applications/${enc(id)}/${action}`, json('POST', b));
