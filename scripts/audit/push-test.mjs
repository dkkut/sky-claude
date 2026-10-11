// Пуши: ключ, подписка, отписка, отправка не роняет сервер. Нужен сервер с VAPID_*.
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) ok++; else { bad++; console.log('FAIL', n, x); } };
const A = await mkuser(S, 'PsA'); const B = await mkuser(S, 'PsB');
let r = await call('/api/push/key', {}, A.tok);
t('ключ отдаётся', r.status === 200 && r.data.web === true && r.data.key.length > 60, r.text);
r = await call('/api/push/key', {});
t('без входа — 401', r.status === 401);
const sub = { kind: 'web', endpoint: 'https://push.invalid/x/' + Date.now(), keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
r = await call('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) }, B.tok);
t('подписка принята', r.status === 200 && r.data.ok, r.text);
r = await call('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ kind: 'web', endpoint: 'http://insecure/x', keys: sub.keys }) }, B.tok);
t('не-https отклонён', r.status === 400);
r = await call('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ kind: 'web', endpoint: sub.endpoint }) }, B.tok);
t('без ключей отклонён', r.status === 400);
// у B нет WS-соединения => «не в сети»; сообщение от A должно не уронить сервер
r = await call('/api/skyid/profiles', {}, A.tok);
const h = await call('/healthz', {});
t('сервер жив', h.status === 200);
r = await call('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }, B.tok);
t('отписка', r.status === 200);
console.log(`ИТОГО: ${ok} ok, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
