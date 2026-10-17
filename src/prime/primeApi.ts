/** Sky Prime: кэшбэк и каталог наград — разговор с сервером (server/primecashback.mjs, primerewards.mjs). */
import { apiCall } from '@/core/auth/api';

export interface Reward {
  id: string; title: string; description: string; cost: number; kind: 'prime_days' | 'manual';
  valueDays: number | null; stock: number | null; perUserLimit: number | null; minTier: string | null; active: boolean; sort: number;
  taken?: number; tierLocked?: boolean; soldOut?: boolean;
}
export interface Redemption { id: string; rewardId: string; title: string; cost: number; status: 'done' | 'pending_manual' | 'rejected_refunded' | 'failed_refunded'; note: string; createdAt: string }
export interface CashbackRule { id: string; title: string; triggerLabel: string; tabLabel: string | null; kind: 'percent' | 'fixed'; percent: number; fixedPoints: number; minAmountRub: number; maxPointsEvent: number; perUserDayEvents: number; primeOnly: boolean; holdDays: number; endsAt: string | null }
export interface CashbackInfo {
  adminRules?: CashbackRule[];
  rules: { enabled: boolean; primePercent: number; basePercent: number; minOrderRub: number; maxPointsPerOrder: number; holdDays: number; maxPointsPerMonth: number };
  pendingPoints: number; paidPoints: number;
  items: { id: string; orderId: string; points: number; percent: number; status: 'pending' | 'paid' | 'cancelled'; releaseAt: string; createdAt: string }[];
}

export const apiPrimeRewards = () => apiCall<{ lifetime: number; rewards: Reward[]; redemptions: Redemption[] }>('/api/prime/rewards');
export const apiPrimeCashback = () => apiCall<CashbackInfo>('/api/prime/cashback');
/** Ключ идемпотентности создаётся один раз на нажатие: повтор запроса (сеть, двойной клик) второй раз не спишет. */
export const apiPrimeRedeem = (rewardId: string, idemKey: string) =>
  apiCall<{ ok: true; duplicate?: boolean; redemption?: { id: string; status: string; title: string; cost: number; note?: string } }>(
    '/api/prime/rewards/redeem', { method: 'POST', body: JSON.stringify({ rewardId, idemKey }) });
export const newIdemKey = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export const REDEEM_ERR: Record<string, string> = {
  insufficient_points: 'Недостаточно баллов', sold_out: 'Награда закончилась', limit_reached: 'Вы уже получили эту награду максимально возможное число раз',
  tier_too_low: 'Награда доступна с более высокого уровня', not_found: 'Награда недоступна', too_many_requests: 'Слишком часто, подождите минуту',
};

/** Вкладки Extras, за пользование которыми администрация может начислять баллы → ключ вкладки в правилах. */
const VISIT_TABS: Record<string, string> = { music: 'music', movies: 'film', tv: 'tv', podcasts: 'podcasts', books: 'books', ai: 'ai', prime: 'prime', market: 'market', go: 'go', blox: 'blox', nftgifts: 'gifts', family: 'family', pulse: 'pulse', garant: 'garant', partners: 'partners', musicians: 'artists' };
export const visitKeyOf = (extrasTab: string) => VISIT_TABS[extrasTab] ?? null;
export const apiCashbackVisit = (tab: string) => apiCall<{ ok: true; granted: { points: number; title: string; status: string }[] }>('/api/prime/cashback/visit', { method: 'POST', body: JSON.stringify({ tab }) });
