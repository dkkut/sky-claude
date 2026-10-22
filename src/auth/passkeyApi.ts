/** Ключи доступа (WebAuthn): запросы к серверу и обёртка над navigator.credentials. Сервер — server/passkeys.mjs. */
import { apiCall } from '@/core/auth/api';

export interface PasskeyInfo { id: string; name: string; icon: string; status: 'active' | 'frozen'; createdAt: string; lastUsedAt: string | null }
export interface PasskeyList { keys: PasskeyInfo[]; icons: string[]; twoFactorEnabled: boolean; max: number }

const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; u.forEach((c) => { s += String.fromCharCode(c); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = (s: string) => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};

/** Ключ доступа работает только в браузере: в .apk/.exe WebView привязан к другому адресу, и ключ сайта там не сработает. */
export const inNativeShell = () => typeof window !== 'undefined' && (Boolean((window as any).Capacitor?.isNativePlatform?.()) || Boolean((window as any).sky?.secureStorage));
export const passkeysAvailable = () => typeof window !== 'undefined' && window.isSecureContext && 'PublicKeyCredential' in window && !inNativeShell();

const REASONS: Record<string, string> = {
  two_factor_required_setup: 'Сначала включите аутентификатор (Профиль → Sky ID → Безопасность) — без него ключ доступа не создаётся и не работает.',
  invalid_code: 'Неверный код аутентификатора.', too_many_attempts: 'Слишком много попыток. Подождите минуту.',
  too_many_keys: 'Достигнут предел ключей.', key_frozen: 'Этот ключ заморожен. Разморозьте его в Профиль → Sky ID.',
  unknown_key: 'Этот ключ удалён из Sky ID.', challenge_expired: 'Время вышло, попробуйте ещё раз.', cannot_add: 'Не удалось добавить ключ.',
};
export const passkeyReason = (r?: string) => (r && REASONS[r]) || r || 'Не удалось. Попробуйте ещё раз.';
const cancelled = (e: unknown) => ['NotAllowedError', 'AbortError'].includes((e as Error)?.name);

export const apiPasskeys = () => apiCall<PasskeyList>('/api/skyid/passkeys');
export const apiPasskeyUpdate = (id: string, p: { name?: string; icon?: string }) => apiCall(`/api/skyid/passkeys/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(p) });
export const apiPasskeyFreeze = (id: string, freeze: boolean, twoFactorCode: string) =>
  apiCall(`/api/skyid/passkeys/${encodeURIComponent(id)}/${freeze ? 'freeze' : 'unfreeze'}`, { method: 'POST', body: JSON.stringify({ twoFactorCode }) });
export const apiPasskeyDelete = (id: string, twoFactorCode: string) =>
  apiCall(`/api/skyid/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ twoFactorCode }) });

/** Создать ключ: сначала код аутентификатора (сервер выдаёт вызов только после него), затем Face ID / отпечаток. */
export const createPasskey = async (twoFactorCode: string, name: string, icon: string): Promise<{ ok: boolean; reason?: string }> => {
  const b = await apiCall<any>('/api/skyid/passkeys/register/begin', { method: 'POST', body: JSON.stringify({ twoFactorCode }) });
  if (!b.ok || !b.data) return { ok: false, reason: passkeyReason(b.data?.error ?? b.reason) };
  const pk = b.data.publicKey;
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({ publicKey: {
      ...pk, challenge: fromB64u(pk.challenge), user: { ...pk.user, id: fromB64u(pk.user.id) },
      excludeCredentials: (pk.excludeCredentials ?? []).map((c: any) => ({ ...c, id: fromB64u(c.id) })),
    } })) as PublicKeyCredential;
  } catch (e) { return { ok: false, reason: cancelled(e) ? 'Создание ключа отменено.' : 'Устройство не смогло создать ключ.' }; }
  const r = cred.response as AuthenticatorAttestationResponse;
  const f = await apiCall<any>('/api/skyid/passkeys/register/finish', { method: 'POST', body: JSON.stringify({
    challengeId: b.data.challengeId, name, icon,
    credential: { id: cred.id, response: { clientDataJSON: b64u(r.clientDataJSON), attestationObject: b64u(r.attestationObject), transports: r.getTransports?.() ?? [] } },
  }) });
  return f.ok ? { ok: true } : { ok: false, reason: passkeyReason(f.data?.error ?? f.reason) };
};

/** Вход: Face ID / отпечаток → ответ сервера (нужен код аутентификатора, сессии ещё нет). */
export const signInWithPasskey = async (): Promise<{ ok: true; data: any } | { ok: false; reason: string }> => {
  const b = await apiCall<any>('/api/auth/passkey/begin', { method: 'POST', body: '{}' });
  if (!b.ok || !b.data) return { ok: false, reason: passkeyReason(b.reason) };
  const pk = b.data.publicKey;
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.get({ publicKey: { ...pk, challenge: fromB64u(pk.challenge), allowCredentials: [] } })) as PublicKeyCredential;
  } catch (e) { return { ok: false, reason: cancelled(e) ? '' : 'Устройство не смогло подтвердить ключ.' }; }
  const r = cred.response as AuthenticatorAssertionResponse;
  const f = await apiCall<any>('/api/auth/passkey/finish', { method: 'POST', body: JSON.stringify({
    challengeId: b.data.challengeId,
    credential: { id: cred.id, response: { clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature) } },
  }) });
  if (!f.ok || !f.data) return { ok: false, reason: passkeyReason(f.data?.error ?? f.reason) };
  return { ok: true, data: f.data };
};
