/**
 * Пуш-уведомления при закрытом приложении.
 *
 * Два канала: Web Push (сайт, ПК, PWA; VAPID-ключи) и Firebase Cloud Messaging
 * (приложение Android; сервисный аккаунт). Шлём только тем, кого сейчас нет в
 * сети (нет живого WebSocket): у кого приложение открыто, уведомление и так
 * показывает само приложение. Текст пуша — короткий; полные данные приложение
 * берёт само после открытия.
 *
 * Без ключей модуль молча ничего не делает: отсутствие настройки не должно
 * ронять ни сообщение, ни платёж. Любая ошибка доставки — только в журнал.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import webpush from 'web-push';
import { query } from './db.mjs';
import { config } from './config.mjs';

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** Ссылка из пуша — только свой маршрут приложения. */
const safeUrl = (u) => (/^\/[a-zA-Z0-9/_?=&#-]{0,200}$/.test(String(u ?? '')) ? String(u) : '/');

let vapidReady = false;
if (config.vapidPublicKey && config.vapidPrivateKey) {
  try {
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
    vapidReady = true;
  } catch (e) { console.error('[push] ключи VAPID не приняты:', e.message); }
}

export const webPushEnabled = () => vapidReady;
export const publicKey = () => (vapidReady ? config.vapidPublicKey : '');

/* ─── FCM (HTTP v1) без сторонних библиотек ───────────────────────── */
let fcm = null;
if (config.fcmServiceAccount) {
  try {
    const raw = config.fcmServiceAccount.trim().startsWith('{')
      ? config.fcmServiceAccount : readFileSync(config.fcmServiceAccount, 'utf8');
    const j = JSON.parse(raw);
    if (j.client_email && j.private_key && j.project_id) fcm = j;
  } catch (e) { console.error('[push] FCM_SERVICE_ACCOUNT_JSON не прочитан:', e.message); }
}
export const fcmEnabled = () => Boolean(fcm);

let fcmToken = { value: '', exp: 0 };
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const fcmAccessToken = async () => {
  if (fcmToken.value && fcmToken.exp > Date.now() + 60_000) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({ iss: fcm.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(fcm.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`oauth ${r.status}`);
  fcmToken = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return fcmToken.value;
};

const sendFcm = async (token, p) => {
  const access = await fcmAccessToken();
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${fcm.project_id}/messages:send`, {
    method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { token, notification: { title: p.title, body: p.body },
      data: { url: p.url, tag: p.tag ?? '' }, android: { priority: p.urgent ? 'HIGH' : 'NORMAL', notification: { channel_id: 'sky', tag: p.tag || undefined } } } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (r.status === 404 || r.status === 400 || r.status === 403) {
    const j = await r.json().catch(() => ({}));
    const code = j?.error?.details?.[0]?.errorCode ?? j?.error?.status;
    if (code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT' || r.status === 404) return 'gone';
  }
  return r.ok ? 'ok' : 'fail';
};

/* ─── Подписки ────────────────────────────────────────────────────── */

export const saveSubscription = async (profileId, sub, ua) => {
  const kind = sub?.kind === 'fcm' ? 'fcm' : 'web';
  const endpoint = text(kind === 'fcm' ? sub.token : sub.endpoint, 1000);
  if (!endpoint) return { error: 'bad_subscription' };
  if (kind === 'web') {
    if (!/^https:\/\//.test(endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return { error: 'bad_subscription' };
  }
  await query(
    `INSERT INTO push_subscriptions (id, profile_id, kind, endpoint, p256dh, auth, ua)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (endpoint) DO UPDATE SET profile_id = EXCLUDED.profile_id, p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth, ua = EXCLUDED.ua`,
    [`ps-${crypto.randomUUID()}`, profileId, kind, endpoint, sub.keys?.p256dh ?? null, sub.keys?.auth ?? null, text(ua, 200)]);
  /* Не больше 10 устройств на человека: самые старые уходят. */
  await query(
    `DELETE FROM push_subscriptions WHERE profile_id = $1 AND id NOT IN
       (SELECT id FROM push_subscriptions WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 10)`, [profileId]);
  return { ok: true };
};

export const removeSubscription = async (profileId, endpoint) => {
  await query('DELETE FROM push_subscriptions WHERE profile_id = $1 AND endpoint = $2', [profileId, text(endpoint, 1000)]);
  return { ok: true };
};

/* ─── Отправка ────────────────────────────────────────────────────── */

let isOnlineProbe = () => false;
/** signal.mjs сообщает, как узнать, есть ли у человека живое соединение. */
export const setOnlineProbe = (fn) => { isOnlineProbe = fn; };

/**
 * Кому из людей сообщение дойдёт ПРЯМО СЕЙЧАС: у них открыт Sky (живое соединение) либо есть подписка на пуши
 * при настроенных ключах. Для кода входа: показывать его «на устройствах» имеет смысл только им.
 */
export const reachableNow = async (userIds) => {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  const live = ids.filter((id) => isOnlineProbe(id));
  const rest = ids.filter((id) => !isOnlineProbe(id));
  if (!rest.length || (!vapidReady && !fcm)) return live;
  try {
    const { rows } = await query('SELECT DISTINCT profile_id FROM push_subscriptions WHERE profile_id = ANY($1::text[])', [rest]);
    return [...live, ...rows.map((r) => r.profile_id)];
  } catch { return live; }
};

/**
 * Отправить пуш людям, которых нет в сети. payload: { title, body, url, tag, urgent }.
 * Возвращает число доставленных; ошибки не бросает.
 */
export const pushToOffline = async (userIds, payload) => {
  if (!vapidReady && !fcm) return 0;
  try {
    const ids = [...new Set((userIds ?? []).filter(Boolean))].filter((id) => !isOnlineProbe(id));
    if (!ids.length) return 0;
    const { rows } = await query(
      'SELECT id, profile_id, kind, endpoint, p256dh, auth FROM push_subscriptions WHERE profile_id = ANY($1::text[])', [ids]);
    const p = { title: text(payload.title, 80) || 'Sky', body: text(payload.body, 160), url: safeUrl(payload.url),
      tag: text(payload.tag, 60), urgent: payload.urgent === true };
    let sent = 0;
    await Promise.all(rows.map(async (s) => {
      try {
        let res = 'fail';
        if (s.kind === 'web' && vapidReady) {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify(p), { TTL: 86_400, urgency: p.urgent ? 'high' : 'normal', timeout: 10_000 });
            res = 'ok';
          } catch (e) { res = e.statusCode === 404 || e.statusCode === 410 ? 'gone' : 'fail'; }
        } else if (s.kind === 'fcm' && fcm) {
          res = await sendFcm(s.endpoint, p);
        }
        if (res === 'ok') { sent += 1; await query('UPDATE push_subscriptions SET last_ok_at = now() WHERE id = $1', [s.id]); }
        if (res === 'gone') await query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
      } catch (e) { console.error('[push] доставка:', e.message); }
    }));
    return sent;
  } catch (e) { console.error('[push]', e.message); return 0; }
};
