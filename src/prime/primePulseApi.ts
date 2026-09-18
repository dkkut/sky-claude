/**
 * Prime Pulse: разговор с сервером.
 *
 * Прежде это были десять строк, зашитых в компонент: одна кнопка
 * «Активировать» ничего не делала, а промокод был одинаковой строкой
 * для всех. Теперь предложения приходят с сервера, а код при
 * погашении — свой, настоящий, выданный один раз этому человеку.
 */
import { apiCall } from '@/core/auth/api';

export type PulseCategory = 'game' | 'service' | 'promo' | 'fun';

export interface PulseOffer {
  id: string;
  category: PulseCategory;
  title: string;
  description: string;
  brand: string;
  valueLabel: string;
  color: [string, string];
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
  maxPerUser: number;
  createdAt?: string;
  /** Только в ленте подписчика: сколько раз он уже погасил. */
  myRedemptions?: number;
  /** Только в очереди администратора. */
  redeemedCount?: number;
}

export interface PulseRedemption {
  id: string;
  code: string;
  redeemedAt: string;
  offerId: string;
  title: string;
  brand: string;
  valueLabel: string;
}

const ERRORS: Record<string, string> = {
  prime_required: 'Доступно только участникам Sky Prime',
  already_redeemed: 'Вы уже получили это предложение',
  not_found: 'Предложение недоступно',
  not_allowed: 'Недостаточно прав',
  bad_category: 'Неизвестная категория',
  bad_title: 'Заполните название',
  bad_value: 'Заполните значение предложения',
  bad_color: 'Некорректный цвет',
  bad_window: 'Дата начала должна быть раньше даты окончания',
  has_redemptions: 'Нельзя удалить — предложение уже кто-то погасил',
  rate_limited: 'Слишком часто. Попробуйте чуть позже',
};

export const pulseErrorText = (code?: string) => ERRORS[code ?? ''] ?? 'Не получилось';

export const apiPulseOffers = async () => {
  const r = await apiCall<{ offers: PulseOffer[] }>('/api/prime-pulse/offers');
  return r.ok ? (r.data?.offers ?? []) : null;
};

export const apiPulseMine = async () => {
  const r = await apiCall<{ redemptions: PulseRedemption[] }>('/api/prime-pulse/mine');
  return r.ok ? (r.data?.redemptions ?? []) : null;
};

export const apiPulseRedeem = async (offerId: string) => {
  const r = await apiCall<{ id: string; code: string }>(
    `/api/prime-pulse/offers/${encodeURIComponent(offerId)}/redeem`, { method: 'POST' });
  if (r.ok) return { ok: true as const, code: r.data?.code ?? '' };
  return { ok: false as const, reason: pulseErrorText(r.error) };
};

/* ─── Администрирование (право content) ──────────────────────────────── */

export interface PulseOfferInput {
  category: PulseCategory;
  title: string;
  description?: string;
  brand?: string;
  valueLabel: string;
  color1?: string;
  color2?: string;
  startsAt?: string | null;
  expiresAt?: string | null;
  maxPerUser?: number;
}

export const apiPulseAdminOffers = async () => {
  const r = await apiCall<{ offers: PulseOffer[] }>('/api/prime-pulse/admin/offers');
  return r.ok ? (r.data?.offers ?? []) : null;
};

export const apiPulseCreateOffer = async (input: PulseOfferInput) => {
  const r = await apiCall<{ id: string }>('/api/prime-pulse/admin/offers',
    { method: 'POST', body: JSON.stringify(input) });
  if (r.ok) return { ok: true as const, id: r.data?.id ?? '' };
  return { ok: false as const, reason: pulseErrorText(r.error) };
};

export const apiPulseUpdateOffer = async (id: string, input: PulseOfferInput) => {
  const r = await apiCall(`/api/prime-pulse/admin/offers/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) });
  return r.ok ? { ok: true as const } : { ok: false as const, reason: pulseErrorText(r.error) };
};

export const apiPulseSetActive = async (id: string, on: boolean) => {
  const r = await apiCall(`/api/prime-pulse/admin/offers/${encodeURIComponent(id)}/active`,
    { method: 'POST', body: JSON.stringify({ on }) });
  return r.ok;
};

export const apiPulseDeleteOffer = async (id: string) => {
  const r = await apiCall(`/api/prime-pulse/admin/offers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (r.ok) return { ok: true as const };
  return { ok: false as const, reason: pulseErrorText(r.error) };
};
