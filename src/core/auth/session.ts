export interface SessionState {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  twoFactorVerified: boolean;
}

export const validateSession = (session: SessionState): boolean => {
  return new Date(session.expiresAt).getTime() > Date.now() && session.twoFactorVerified;
};
