import { validateSession, type SessionState } from '@/core/auth/session';

export const shouldRefreshToken = (session: SessionState): boolean => {
  const expiresInMs = new Date(session.expiresAt).getTime() - Date.now();
  return expiresInMs < 5 * 60 * 1000;
};

export const getSessionHealth = (session: SessionState) => ({
  valid: validateSession(session),
  shouldRefresh: shouldRefreshToken(session),
});
