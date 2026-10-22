import { apiCall } from '@/core/auth/api';

export interface OnboardingState { status: 'none' | 'not_started' | 'started' | 'completed' | 'skipped'; step: number; interest: string | null; auto: boolean }
export const apiOnboarding = () => apiCall<OnboardingState>('/api/onboarding');
export const apiOnboardingAct = (action: 'start' | 'step' | 'complete' | 'skip' | 'restart' | 'interest', extra: { step?: number; interest?: string } = {}) =>
  apiCall<OnboardingState>('/api/onboarding', { method: 'POST', body: JSON.stringify({ action, ...extra }) });
