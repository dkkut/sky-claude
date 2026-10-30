/** Валютные счета SkyMoney (сервер — server/walletfx.mjs). Курсы задаёт администрация; суммы валюты — в сотых долях. */
import { apiCall } from '@/core/auth/api';

export interface FxCurrency { code: string; name: string; symbol: string; available: boolean; mid?: number; buy?: number; sell?: number }
export interface FxAccount { currency: string; balance: number; openedAt: string }
export interface FxTransfer { id: string; currency: string; direction: 'buy' | 'sell'; rub: number; amount: number; rate: number; createdAt: string }
export interface FxAnalytics { points: { t: number; rate: number }[]; change1d: number | null; change30d: number | null; min: number; max: number }
export interface FxOverview { max: number; minRub: number; maxRub: number; currencies: FxCurrency[]; accounts: FxAccount[]; history: FxTransfer[]; analytics: Record<string, FxAnalytics> }

export const fxOverview = () => apiCall<FxOverview>('/api/wallet/fx');
export const fxOpen = (currency: string) => apiCall('/api/wallet/fx/open', { method: 'POST', body: JSON.stringify({ currency }) });
export const fxClose = (currency: string) => apiCall('/api/wallet/fx/close', { method: 'POST', body: JSON.stringify({ currency }) });
export const fxConvert = (b: { currency: string; direction: 'buy' | 'sell'; amount: number; expect: number; idemKey: string }) =>
  apiCall<{ ok: boolean; rub: number; amount: number; price: number; receive?: number }>('/api/wallet/fx/convert', { method: 'POST', body: JSON.stringify(b) });

/** Расчёт для показа: то же, что считает сервер (там и решается окончательно). */
export const quoteFx = (c: FxCurrency, direction: 'buy' | 'sell', amount: number) => {
  if (!c.buy || !c.sell || amount <= 0) return 0;
  return direction === 'buy' ? Math.floor((amount * 100) / c.buy) : Math.floor((amount / 100) * c.sell);
};
export const fmtCur = (cents: number, symbol: string) => `${symbol}${(cents / 100).toLocaleString('ru', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Линия курса по истории (SVG-точки); меньше двух точек — null (рисовать нечего). */
export const sparkPoints = (pts: { rate: number }[], w: number, h: number) => {
  if (pts.length < 2) return null;
  const v = pts.map((p) => p.rate); const max = Math.max(...v); const min = Math.min(...v);
  return v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`).join(' ');
};
export const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('ru', { maximumFractionDigits: 2 })} %`);
