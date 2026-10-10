import { apiCall, uploadUrl } from '@/core/auth/api';
import { NATIVE_APP } from '@/core/nativeApp';
import { apiMarketTicket, getMarketMediaTicket } from '@/marketplace/marketApi';

/* Клиент Sky Blox. Ничего тут не решается: видимость, цены, права и
   деньги определяет сервер, клиент только показывает ответы. */

export type Res<T> = { ok: true; data: T } | { ok: false; error?: string; reason?: string; data?: any };

const req = async <T>(path: string, init?: RequestInit): Promise<Res<T>> => {
  const r = await apiCall<T>(path, init);
  return r.ok ? { ok: true, data: r.data as T } : { ok: false, error: r.error, reason: r.reason, data: r.data as any };
};
const j = (method: string, body?: unknown): RequestInit => ({ method, body: JSON.stringify(body ?? {}) });
const enc = encodeURIComponent;
const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const ensureBloxMedia = () => apiMarketTicket();
export const bloxImageUrl = (id: string) => {
  const url = uploadUrl(`/api/blox/images/${enc(id)}`);
  const t = getMarketMediaTicket();
  return NATIVE_APP && t ? `${url}?t=${enc(t)}` : url;
};

export type Status = 'draft' | 'pending' | 'needs_changes' | 'approved' | 'published' | 'hidden' | 'blocked' | 'archived';

export interface Place {
  id: string; gameId: string; title: string; description: string; category: string; maxPlayers: number; minAge: number;
  isMain: boolean; launches: number; coverId: string | null; shotIds: string[]; entryPath?: string;
  moderationStatus?: Status; moderationReason?: string; autoFindings?: Finding[]; submittedAt?: string | null;
}
export interface Finding { severity: 'low' | 'medium' | 'high'; code: string; message: string }
export interface ConnCheck { name: string; ok: boolean; message: string; fix?: string }
export interface Game {
  id: string; slug: string; title: string; description: string; category: string; tags: string[]; developerId: string;
  developerName?: string; rating: number | null; ratingCount: number; launches: number; visitors: number; favorites: number;
  version: string; coverId: string | null; shotIds: string[]; publishedAt: string | null; favorite?: boolean; own?: boolean;
  places?: Place[]; lastPlayedAt?: string;
  hostingType?: string; clientUrl?: string; serverUrl?: string; keyId?: string; connStatus?: 'unconfigured' | 'checking' | 'ok' | 'failed';
  connCheckedAt?: string | null; connError?: string; connChecks?: ConnCheck[]; moderationStatus?: Status; moderationReason?: string;
  autoFindings?: Finding[]; createdAt?: string; submittedAt?: string | null; advice?: string[];
}
export interface Info {
  categories: string[]; hostingTypes: Record<string, string>; supportedFormats: string[]; unsupportedFormats: string[];
  reportReasons: string[]; termsVersion: string; commissionPercent: number; holdDays: number; minPayoutPoints: number;
  payoutsEnabled: boolean; maxUploadBytes: number; publicOrigin: string;
}
export interface Review { id: string; rating: number; body: string; author: string; at: string }
export interface Product { id: string; gameId: string; sku: string; title: string; description: string; price: number; kind: 'consumable' | 'durable'; active: boolean; owned?: number }
export interface Purchase { id: string; gameId: string; productId: string; sku: string; title: string; gameTitle: string; price: number; status: string; createdAt: string; expiresAt: string | null; paidAt: string | null; refundedAt: string | null; refundReason?: string }
export interface Developer { displayName: string; status: 'active' | 'suspended'; trustLevel: number; termsVersion: string; suspendReason: string }

/* — игрок — */
export const apiInfo = () => req<Info>('/api/blox/info');
export const apiHome = () => req<{ popular: Game[]; new: Game[]; recommended: Game[] }>('/api/blox/home');
export const apiCatalog = (q: { q?: string; category?: string; sort?: string; offset?: number }) => req<{ items: Game[] }>(`/api/blox/catalog${qs({ ...q, limit: 24 })}`);
export const apiGame = (id: string) => req<{ game: Game }>(`/api/blox/games/${enc(id)}`);
export const apiReviews = (id: string) => req<{ items: Review[] }>(`/api/blox/games/${enc(id)}/reviews`);
export const apiReview = (id: string, b: { rating: number; body: string }) => req<{ ok: true }>(`/api/blox/games/${enc(id)}/review`, j('POST', b));
export const apiFavorite = (id: string, on: boolean) => req<{ ok: true }>(`/api/blox/games/${enc(id)}/favorite`, { method: on ? 'POST' : 'DELETE' });
export const apiFavorites = () => req<{ items: Game[] }>('/api/blox/favorites');
export const apiHistory = () => req<{ items: Game[] }>('/api/blox/history');
export const apiMe = () => req<{ name: string; played: number; favorites: number; reviews: number; purchases: number }>('/api/blox/me');
export interface Launch { url: string; origin: string; token: string; expiresAt: string; user: { displayName: string; playerId: string }; gameId: string; placeId: string; gameTitle: string }
export const apiLaunch = (placeId: string) => req<Launch>(`/api/blox/places/${enc(placeId)}/launch`, j('POST'));
export const apiReport = (b: { targetType: 'game' | 'place' | 'developer' | 'review'; targetId: string; reason: string; details?: string }) => req<{ ok: true }>('/api/blox/reports', j('POST', b));
export const apiAppeal = (b: { subjectType: 'game' | 'place' | 'developer'; subjectId: string; text: string }) => req<{ ok: true }>('/api/blox/appeals', j('POST', b));
export const apiMyAppeals = () => req<{ items: { id: string; subjectType: string; subjectId: string; text: string; status: string; decision: string; at: string }[] }>('/api/blox/appeals');

/* — покупки — */
export const apiShop = (id: string) => req<{ sellable: boolean; items: Product[] }>(`/api/blox/games/${enc(id)}/shop`);
export const apiBuy = (id: string, sku: string, idempotencyKey: string) => req<{ purchaseId: string; status: string; price: number; title: string }>(`/api/blox/games/${enc(id)}/shop/buy`, j('POST', { sku, idempotencyKey }));
export const apiPending = () => req<{ items: Purchase[] }>('/api/blox/purchases/pending');
export const apiPurchases = () => req<{ items: Purchase[] }>('/api/blox/purchases');
export const apiEntitlements = () => req<{ items: { quantity: number; sku: string; title: string; kind: string; gameId: string; gameTitle: string }[] }>('/api/blox/entitlements');
export const apiConfirm = (id: string, price: number) => req<{ ok: true; status: string; points: number; price: number }>(`/api/blox/purchases/${enc(id)}/confirm`, j('POST', { price }));
export const apiCancelIntent = (id: string) => req<{ ok: true }>(`/api/blox/purchases/${enc(id)}/cancel`, j('POST'));

/* — кабинет разработчика — */
export const apiDeveloper = () => req<{ developer: Developer | null }>('/api/blox/developer');
export const apiBecomeDeveloper = (displayName: string) => req<{ developer: Developer }>('/api/blox/developer', j('POST', { displayName, acceptTerms: true }));
export const apiMyGames = () => req<{ items: Game[] }>('/api/blox/dev/games');
export const apiMyGame = (id: string) => req<{ game: Game }>(`/api/blox/dev/games/${enc(id)}`);
export interface GameInput { title?: string; description?: string; category?: string; tags?: string[]; hostingType?: string; clientUrl?: string; serverUrl?: string }
export const apiCreateGame = (b: GameInput) => req<{ game: Game; secret: string }>('/api/blox/dev/games', j('POST', b));
export const apiUpdateGame = (id: string, b: GameInput) => req<{ game: Game; recheck?: boolean }>(`/api/blox/dev/games/${enc(id)}`, j('PATCH', b));
export const apiRotateSecret = (id: string) => req<{ secret: string; keyId: string }>(`/api/blox/dev/games/${enc(id)}/secret/rotate`, j('POST'));
export const apiCheckConn = (id: string) => req<{ ok: boolean; checks: ConnCheck[]; advice: string[] }>(`/api/blox/dev/games/${enc(id)}/check`, j('POST'));
export const apiDisconnect = (id: string) => req<{ ok: true }>(`/api/blox/dev/games/${enc(id)}/disconnect`, j('POST'));
export const apiSubmit = (type: 'game' | 'place', id: string) => req<{ ok: true; status: string; autoFindings: Finding[] }>(`/api/blox/dev/${type === 'game' ? 'games' : 'places'}/${enc(id)}/submit`, j('POST'));
export const apiPublish = (type: 'game' | 'place', id: string, on: boolean) => req<{ ok: true; status: string }>(`/api/blox/dev/${type === 'game' ? 'games' : 'places'}/${enc(id)}/publish`, j('POST', { on }));
export const apiArchive = (type: 'game' | 'place', id: string) => req<{ ok: true }>(`/api/blox/dev/${type === 'game' ? 'games' : 'places'}/${enc(id)}`, { method: 'DELETE' });
export const apiHistoryOf = (type: 'game' | 'place', id: string) => req<{ items: { action: string; from: string | null; to: string | null; reason: string; by: string; at: string }[] }>(`/api/blox/dev/${type === 'game' ? 'games' : 'places'}/${enc(id)}/history`);
export const apiVersions = (id: string) => req<{ items: { label: string; notes: string; at: string }[] }>(`/api/blox/dev/games/${enc(id)}/versions`);
export const apiAddVersion = (id: string, label: string, notes: string) => req<{ ok: true }>(`/api/blox/dev/games/${enc(id)}/versions`, j('POST', { label, notes }));
export interface PlaceInput { title?: string; description?: string; category?: string; entryPath?: string; maxPlayers?: number; minAge?: number }
export const apiCreatePlace = (gameId: string, b: PlaceInput) => req<{ place: Place }>(`/api/blox/dev/games/${enc(gameId)}/places`, j('POST', b));
export const apiUpdatePlace = (id: string, b: PlaceInput) => req<{ place: Place; recheck?: boolean }>(`/api/blox/dev/places/${enc(id)}`, j('PATCH', b));
export const apiUploadImage = (type: 'game' | 'place', id: string, kind: 'cover' | 'shot', file: Blob) =>
  apiCall<{ ok: true }>(`/api/blox/dev/${type === 'game' ? 'games' : 'places'}/${enc(id)}/images?kind=${kind}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
export const apiDeleteImage = (id: string) => req<{ ok: true }>(`/api/blox/dev/images/${enc(id)}`, { method: 'DELETE' });
export const apiMyProducts = (gameId: string) => req<{ items: Product[] }>(`/api/blox/dev/games/${enc(gameId)}/products`);
export const apiCreateProduct = (gameId: string, b: { sku: string; title: string; description?: string; price: number; kind: string }) => req<{ product: Product }>(`/api/blox/dev/games/${enc(gameId)}/products`, j('POST', b));
export const apiUpdateProduct = (id: string, b: Partial<{ title: string; description: string; price: number; kind: string; active: boolean }>) => req<{ product: Product }>(`/api/blox/dev/products/${enc(id)}`, j('PATCH', b));
export const apiDevStats = () => req<{ items: { id: string; title: string; launches: number; launches7: number; visitors: number; favorites: number; rating: number | null; ratingCount: number; purchases: number; points: number; reports: number; reportsUpheld: number }[] }>('/api/blox/dev/stats');
export const apiDevReports = () => req<{ items: { id: string; targetType: string; reason: string; status: string; resolution: string; at: string }[] }>('/api/blox/dev/reports');

/* — финансы разработчика — */
export interface Balances { accrued: number; gross: number; commission: number; held: number; confirmed: number; reserved: number; paid: number; available: number }
export interface PayoutRow { id: string; amount: number; fee: number; net: number; feePercent: number; instant: boolean; status: string; requisitesTail: string; adminComment: string; rejectReason: string; paidAt: string | null; paidRef: string; submittedAt: string | null; createdAt: string; developerName?: string; developerId?: string; username?: string }
export interface Finance {
  balances: Balances; rules: { commissionPercent: number; payoutFeePercent: number; holdDays: number; minPayoutPoints: number; payoutsEnabled: boolean; termsVersion: string };
  earnings: { id: number; kind: string; gross: number; commission: number; amount: number; availableAt: string; held: boolean; note: string; gameTitle: string | null; at: string }[];
  payouts: PayoutRow[];
}
export interface Requisites { method: string; holder: string; account: string; bank?: string; note?: string }
export const apiFinance = () => req<Finance>('/api/blox/dev/finance');
export const apiPayoutNow = (b: { amount: number; idempotencyKey: string; acceptTerms: boolean }) => req<{ payout: PayoutRow }>('/api/blox/dev/payouts/now', j('POST', b));
export const apiPayoutDraft = (b: { amount: number; requisites: Requisites }) => req<{ payout: PayoutRow }>('/api/blox/dev/payouts', j('POST', b));
export const apiPayoutEdit = (id: string, b: { amount: number; requisites: Requisites }) => req<{ payout: PayoutRow }>(`/api/blox/dev/payouts/${enc(id)}`, j('PATCH', b));
export const apiPayoutSubmit = (id: string, idempotencyKey: string) => req<{ payout: PayoutRow }>(`/api/blox/dev/payouts/${enc(id)}/submit`, j('POST', { idempotencyKey, acceptTerms: true }));
export const apiPayoutInfo = (id: string, requisites: Requisites) => req<{ payout: PayoutRow }>(`/api/blox/dev/payouts/${enc(id)}/info`, j('POST', { requisites }));
export const apiPayoutCancel = (id: string) => req<{ ok: true }>(`/api/blox/dev/payouts/${enc(id)}/cancel`, j('POST'));
export const apiPayoutEvents = (id: string) => req<{ items: { action: string; from: string | null; to: string | null; comment: string; by: string; at: string }[] }>(`/api/blox/dev/payouts/${enc(id)}/events`);

/* ─── Администрация ─────────────────────────────────────────────── */
export const apiAdminGames = (q?: string) => req<{ items: { id: string; title: string; status: Status; connStatus: string; checkedAt: string | null; connError: string; hosting: string; clientUrl: string; serverUrl: string; launches: number; developerName: string; at: string }[] }>(`/api/blox/admin/games${qs({ q })}`);
export const apiAdminProbe = (id: string) => req<{ ok: boolean; checks: ConnCheck[] }>(`/api/blox/admin/games/${enc(id)}/probe`, j('POST'));
export const apiAdminDevelopers = () => req<{ items: { id: string; username: string; displayName: string; status: string; trustLevel: number; games: number; openReports: number; suspendReason: string; at: string }[] }>('/api/blox/admin/developers');
export const apiAdminSetDeveloper = (id: string, b: { status?: string; trustLevel?: number; reason: string }) => req<{ ok: true }>(`/api/blox/admin/developers/${enc(id)}`, j('POST', b));
export interface QueueRow { id: string; type: 'game' | 'place'; title: string; gameTitle?: string; developerName: string; status: Status; connStatus: string; submittedAt: string | null; findings: Finding[]; hosting?: string }
export const apiAdminQueue = (status: string, type: 'game' | 'place') => req<{ items: QueueRow[] }>(`/api/blox/admin/moderation${qs({ status, type })}`);
export const apiAdminModDetail = (type: 'game' | 'place', id: string) => req<{ game?: Game; place?: Place; history: { action: string; from: string | null; to: string | null; reason: string; by: string; at: string }[]; openReports?: number; note?: string }>(`/api/blox/admin/moderation/${type}/${enc(id)}`);
export const apiAdminModerate = (type: 'game' | 'place', id: string, action: string, reason?: string) => req<{ ok: true; status: string }>(`/api/blox/admin/moderation/${type}/${enc(id)}/${action}`, j('POST', { reason }));
export interface ReportRow { id: string; targetType: string; targetId: string; gameId: string | null; gameTitle: string | null; developerName: string | null; reason: string; details: string; priority: number; status: string; resolution: string; createdAt: string }
export const apiAdminReports = (status = 'open') => req<{ items: ReportRow[] }>(`/api/blox/admin/reports${qs({ status })}`);
export const apiAdminResolve = (id: string, outcome: string, resolution: string, apply?: string) => req<{ ok: true }>(`/api/blox/admin/reports/${enc(id)}/resolve`, j('POST', { outcome, resolution, apply }));
export interface AppealRow { id: string; developerName: string; subjectType: string; subjectId: string; text: string; status: string; decision: string; originalDecider: string | null; at: string }
export const apiAdminAppeals = (status = 'open') => req<{ items: AppealRow[] }>(`/api/blox/admin/appeals${qs({ status })}`);
export const apiAdminDecide = (id: string, accept: boolean, decision: string) => req<{ ok: true }>(`/api/blox/admin/appeals/${enc(id)}/decide`, j('POST', { accept, decision }));
export const apiAdminPurchases = (status?: string) => req<{ items: (Purchase & { username: string; devPoints: number | null; commissionPct: number | null })[] }>(`/api/blox/admin/purchases${qs({ status })}`);
export const apiAdminRefund = (id: string, reason: string) => req<{ ok: true }>(`/api/blox/admin/purchases/${enc(id)}/refund`, j('POST', { reason }));
export const apiAdminEarnings = () => req<{ items: { developerId: string; displayName: string; username: string; accrued: number; held: number; commission: number; gross: number }[] }>('/api/blox/admin/earnings');
export const apiAdminDevFinance = (id: string) => req<Finance>(`/api/blox/admin/developers/${enc(id)}/finance`);
export const apiAdminStepUp = () => req<{ ok?: boolean; method?: string }>('/api/blox/admin/step-up', j('POST'));
export const apiAdminAdjust = (id: string, b: { amount: number; reason: string; stepUpCode: string }) => req<{ ok: true }>(`/api/blox/admin/developers/${enc(id)}/adjust`, j('POST', b));
export const apiAdminPayouts = (status = 'review') => req<{ items: PayoutRow[] }>(`/api/blox/admin/payouts${qs({ status })}`);
export const apiAdminPayout = (id: string) => req<{ payout: PayoutRow; requisites: Requisites | null; developerId: string; balances: Balances; earnings: { kind: string; gross: number; commission: number; amount: number; availableAt: string; note: string; at: string }[]; history: { action: string; from: string | null; to: string | null; comment: string; by: string; at: string }[] }>(`/api/blox/admin/payouts/${enc(id)}`);
export const apiAdminPayoutAction = (id: string, action: string, b: { comment?: string; paidRef?: string; paidAt?: string; stepUpCode?: string }) => req<{ ok: true; status: string }>(`/api/blox/admin/payouts/${enc(id)}/${action}`, j('POST', b));
export interface LimitRow { key: string; label: string; value: number; default: number; min: number; max: number }
export const apiAdminLimits = () => req<{ items: LimitRow[] }>('/api/blox/admin/limits');
export const apiAdminSetLimit = (key: string, value: number, stepUpCode?: string) => req<{ ok: true }>('/api/blox/admin/limits', { method: 'PUT', body: JSON.stringify({ key, value, stepUpCode }) });
export interface Metrics {
  level: number; cpu: { cores: number; load1: number; load5: number; loadPerCore: number };
  memory: { machineTotal: number; machineFree: number; processRss: number; processHeapUsed: number; processHeapTotal: number };
  disk: { totalBytes: number; freeBytes: number } | null; network: { rxBytes: number; txBytes: number } | null;
  eventLoop: { meanMs: number; p99Ms: number };
  requests: { sinceStart: number; perSecond: number; errors5xx: number; errors4xx: number; medianMs: number | null; p95Ms: number | null };
  database: { ok: boolean; pingMs: number | null; pool: { total: number; idle: number; waiting: number; max: number | null } };
  jobs: { probesRunning: number; bgRunning: number }; gameServers: Record<string, number> | null; uptimeSec: number;
}
export const apiAdminMetrics = () => req<{ metrics: Metrics; warnings: { level: string; text: string }[] }>('/api/blox/admin/metrics');
export const apiAdminAudit = () => req<{ items: { id: string; type: string; result: string; target: string; actor: string | null; username: string | null; at: string }[] }>('/api/blox/admin/audit');

export const CATEGORY_LABEL: Record<string, string> = {
  action: 'Экшен', adventure: 'Приключения', puzzle: 'Головоломки', racing: 'Гонки', strategy: 'Стратегии',
  simulation: 'Симуляторы', sports: 'Спорт', social: 'Социальные', education: 'Обучение', other: 'Другое',
};
export const STATUS_LABEL: Record<Status, string> = {
  draft: 'Черновик', pending: 'На проверке', needs_changes: 'Требуются исправления', approved: 'Одобрен', published: 'Опубликован',
  hidden: 'Временно скрыт', blocked: 'Заблокирован', archived: 'В архиве',
};
export const REPORT_LABEL: Record<string, string> = {
  malware: 'Вредоносное содержимое', scam: 'Мошенничество', illegal: 'Незаконный контент', adult: 'Контент для взрослых',
  copyright: 'Нарушение авторских прав', hate: 'Оскорбления и ненависть', cheating: 'Читы и обман игроков', bug: 'Неработающая игра', other: 'Другое',
};

export interface CommissionOverview {
  balance: number; sales: number; fees: number; topups: number; paidOut: number; feePercent: number; salesPercent: number;
  items: { id: number; kind: 'payout_fee' | 'topup' | 'payout_to_user'; amount: number; reason: string; user: string | null; actor: string | null; at: string }[];
}
export const apiAdminCommission = () => req<CommissionOverview>('/api/blox/admin/commission');
export const apiAdminCommissionStepUp = () => req<{ ok?: boolean; method?: string }>('/api/blox/admin/commission/step-up', j('POST'));
export const apiAdminCommissionPayout = (b: { username: string; amount: number; reason: string; stepUpCode: string }) => req<{ ok: true; balance: number }>('/api/blox/admin/commission/payout', j('POST', b));
export const apiAdminCommissionTopup = (b: { amount: number; reason: string; stepUpCode: string }) => req<{ ok: true; balance: number }>('/api/blox/admin/commission/topup', j('POST', b));
