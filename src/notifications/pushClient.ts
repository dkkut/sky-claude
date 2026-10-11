/**
 * Пуш-уведомления при закрытом приложении (клиентская часть).
 *
 * Сайт, ПК и PWA — Web Push через service worker (public/sw.js): ключ
 * сервера берётся из /api/push/key, подписка уходит на /api/push/subscribe.
 * Приложение Android — Firebase Cloud Messaging через @capacitor/push-notifications:
 * токен устройства отправляется туда же. Windows-приложение уведомляет через
 * Windows, пока живёт в трее (electron/main.cjs). Если сервер ключей не знает
 * (VAPID/FCM не настроены), всё остаётся как было: внутри приложения.
 */
import { apiCall } from '@/core/auth/api';
import { NATIVE_APP } from '@/core/nativeApp';

export type PushResult = 'ok' | 'denied' | 'unsupported' | 'not_configured' | 'error';

interface PushKey { web: boolean; fcm: boolean; key: string }

const urlB64 = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
};

const isAndroidApp = () => NATIVE_APP && /Android/i.test(navigator.userAgent);
export const webPushSupported = () =>
  !NATIVE_APP && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const fetchKey = async (): Promise<PushKey | null> => {
  const r = await apiCall<PushKey>('/api/push/key');
  return r.ok && r.data ? r.data : null;
};

const subscribeWeb = async (askPermission: boolean): Promise<PushResult> => {
  if (!webPushSupported()) return 'unsupported';
  const k = await fetchKey();
  if (!k?.web || !k.key) return 'not_configured';
  if (Notification.permission === 'default' && askPermission) await Notification.requestPermission();
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'denied';
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(k.key) });
    const j = sub.toJSON();
    const r = await apiCall('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ kind: 'web', endpoint: j.endpoint, keys: j.keys }) });
    return r.ok ? 'ok' : 'error';
  } catch { return 'error'; }
};

let nativeDone = false;
const subscribeNative = async (askPermission: boolean): Promise<PushResult> => {
  const k = await fetchKey();
  if (!k?.fcm) return 'not_configured';
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' && askPermission) perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return 'denied';
    if (!nativeDone) {
      nativeDone = true;
      await PushNotifications.addListener('registration', (t) => {
        void apiCall('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ kind: 'fcm', token: t.value }) });
      });
      await PushNotifications.addListener('registrationError', () => { nativeDone = false; });
      await PushNotifications.createChannel({ id: 'sky', name: 'Sky', importance: 4, visibility: 1 }).catch(() => {});
    }
    await PushNotifications.register();
    return 'ok';
  } catch { return 'error'; }
};

/** Включить пуши: спросить разрешение и подписать это устройство. */
export const enablePush = (): Promise<PushResult> =>
  (isAndroidApp() ? subscribeNative(true) : subscribeWeb(true));

/** Тихо обновить подписку при входе, если разрешение уже выдано. */
export const syncPush = async (): Promise<void> => {
  if (isAndroidApp()) { await subscribeNative(false); return; }
  if (webPushSupported() && Notification.permission === 'granted') await subscribeWeb(false);
};

/** Отписать это устройство. */
export const disablePush = async (): Promise<void> => {
  if (!webPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await apiCall('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
  } catch { /* отписка не критична */ }
};

export const PUSH_TEXT: Record<PushResult, string> = {
  ok: 'Пуш-уведомления включены',
  denied: 'Разрешение не выдано. Включите уведомления для Sky в настройках браузера или телефона.',
  unsupported: 'Это устройство не поддерживает пуши. На iPhone добавьте Sky на экран «Домой».',
  not_configured: 'Пуши на сервере ещё не настроены администратором.',
  error: 'Не удалось включить пуши. Попробуйте ещё раз.',
};
