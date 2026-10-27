import { apiCall } from '@/core/auth/api';

export interface AdminTokenState { admin: boolean; required?: boolean; has?: boolean; last4?: string | null; createdAt?: string | null; lastUsedAt?: string | null; blockedFor?: number; unlocked?: boolean; unlockMinutes?: number }
const A = '/api/skyid/admin-token';
export const adminTokenApi = {
  state: () => apiCall<AdminTokenState>(A),
  issue: (code: string) => apiCall<{ token: string; last4: string }>(`${A}/issue`, { method: 'POST', body: JSON.stringify({ code }) }),
  revoke: (code: string) => apiCall(`${A}/revoke`, { method: 'POST', body: JSON.stringify({ code }) }),
  unlock: (token: string) => apiCall<{ minutes: number; left?: number; retryAfter?: number }>(`${A}/unlock`, { method: 'POST', body: JSON.stringify({ token }) }),
  lock: () => apiCall(`${A}/lock`, { method: 'POST', body: '{}' }),
};

export const TOKEN_ERR: Record<string, string> = {
  admin_token_required: 'Введите токен администратора.',
  admin_token_invalid: 'Токен не подошёл.',
  admin_token_missing: 'Токен ещё не создан. Создайте его в Профиль → Sky ID → «Токен администратора».',
  admin_token_blocked: 'Слишком много неверных токенов — подождите.',
  bad_code: 'Код из аутентификатора не подошёл.',
  two_factor_required: 'Сначала включите аутентификатор в Sky ID.',
  too_many_requests: 'Слишком часто. Попробуйте позже.',
  not_allowed: 'Доступно только администратору.',
};
