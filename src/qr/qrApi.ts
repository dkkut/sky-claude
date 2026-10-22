/** Sky QR: запросы к серверу (server/skyqr.mjs). */
import { apiCall } from '@/core/auth/api';

export interface QrFields { bio: boolean; links: boolean; status: boolean; country: boolean }
export interface MyQr { exists: boolean; code?: string; url?: string; enabled?: boolean; fields: QrFields; scans?: number; rotatedAt?: string | null }
export interface QrCard {
  profile: { id: string; name: string; username: string; avatar: string | null };
  shared: { bio?: string; links?: string[]; status?: string; country?: string };
  self: boolean;
  friend: 'none' | 'friends' | 'pending_in' | 'pending_out';
}

const REASON: Record<string, string> = {
  not_found: 'Такого кода нет или он отозван. Попросите человека показать актуальный QR.',
  rate_limited: 'Слишком много попыток. Подождите немного.', try_again: 'Не получилось, повторите.',
};
export const qrReason = (r: { error?: string; reason?: string }) => REASON[r.error ?? ''] ?? r.reason ?? 'Не получилось. Повторите.';

export const apiMyQr = () => apiCall<MyQr>('/api/qr/me');
export const apiSaveMyQr = (b: { enabled?: boolean; fields?: Partial<QrFields> }) => apiCall<MyQr>('/api/qr/me', { method: 'POST', body: JSON.stringify(b) });
export const apiRotateQr = () => apiCall<MyQr>('/api/qr/me/rotate', { method: 'POST', body: '{}' });
export const apiRevokeQr = () => apiCall<MyQr>('/api/qr/me/revoke', { method: 'POST', body: '{}' });
export const apiQrCard = (code: string) => apiCall<QrCard>(`/api/qr/card/${encodeURIComponent(code)}`);
export const apiQrUser = (username: string) => apiCall<QrCard>(`/api/qr/user/${encodeURIComponent(username)}`);

/** Код из текста QR или ссылки (`…/?qr=КОД`); чужие ссылки и мусор не принимаются. */
export const codeFromText = (text: string): string | null => {
  const s = String(text ?? '').trim();
  const m = /[?&]qr=([A-Za-z0-9]{12})(?:$|[&#])/.exec(s);
  const c = (m ? m[1] : s).toUpperCase();
  return /^[A-HJ-KM-NP-Z2-9]{12}$/.test(c) ? c : null;
};

/* ── Ссылка ?qr=КОД из камеры телефона / браузера: запоминаем до входа, адрес чистим ── */
const KEY = 'sky:qr:incoming';
export const captureQr = () => {
  try {
    const u = new URL(window.location.href);
    const c = u.searchParams.get('qr'); if (!c) return;
    const code = codeFromText(`?qr=${c}`);
    if (code) sessionStorage.setItem(KEY, code);
    u.searchParams.delete('qr');
    window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`);
  } catch { /* без хранилища код просто не запомнится */ }
};
export const takeIncomingQr = (): string | null => { try { const v = sessionStorage.getItem(KEY); if (v) sessionStorage.removeItem(KEY); return v; } catch { return null; } };
