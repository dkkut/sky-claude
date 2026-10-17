// Единые права Prime: /api/entitlements, согласованность с закрытым контентом, запрет оформления на ТВ/консоли/в машине.
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };

const U = await mkuser(S, 'entUser');
let r = await call('/api/entitlements', {}, U.tok);
t('без подписки: prime.active=false, сервисы закрыты', r.status === 200 && r.data.prime.active === false && Object.values(r.data.services).every((v) => v === false), JSON.stringify(r.data));
t('все пять сервисов перечислены', Object.keys(r.data.services).sort().join() === 'books,code,film,music,podcasts');
t('на обычном устройстве покупка разрешена', r.data.purchaseAllowedHere === true && r.data.surface === 'phone_or_desktop');
r = await call('/api/film/catalog', {}, U.tok);
t('закрытый контент закрывает сервер (film 403 prime_required)', r.status === 403 && r.data.error === 'prime_required');
r = await call('/api/entitlements', {}, null);
t('без входа — 401', r.status === 401);

q(`insert into prime_subscriptions(id,profile_id,status,plan,expires_at) values ('prime-ent-${U.pid}','${U.pid}','active','standard', now() + interval '10 days')`);
r = await call('/api/entitlements', {}, U.tok);
t('с подпиской: активна, срок есть, все сервисы открыты', r.data.prime.active === true && r.data.prime.expiresAt && Object.values(r.data.services).every(Boolean), JSON.stringify(r.data));
r = await call('/api/film/catalog', {}, U.tok);
t('и контент открыт (согласовано с правами)', r.status === 200);

for (const mode of ['tv', 'console', 'car']) {
  r = await call('/api/entitlements', {}, U.tok, { 'X-Sky-Mode': mode });
  t(`${mode}: сервер сообщает, что оформлять здесь нельзя`, r.data.surface === mode && r.data.purchaseAllowedHere === false);
  r = await call('/api/skyid/prime/grant', { method: 'POST', body: JSON.stringify({ days: 30 }) }, U.tok, { 'X-Sky-Mode': mode });
  t(`${mode}: оформление Prime отклонено`, r.status === 403 && r.data.error === 'purchase_not_on_device', JSON.stringify(r.data));
  r = await call('/api/skyid/prime/revoke', { method: 'POST', body: '{}' }, U.tok, { 'X-Sky-Mode': mode });
  t(`${mode}: отмена Prime отклонена`, r.status === 403 && r.data.error === 'purchase_not_on_device');
}
r = await call('/api/entitlements', {}, U.tok);
t('подписка после попыток с устройств не тронута', r.data.prime.active === true);
r = await call('/api/skyid/prime/grant', { method: 'POST', body: JSON.stringify({ days: 30 }) }, U.tok);
t('на телефоне/ПК оформление идёт обычным путём (не device-отказ)', r.error !== 'purchase_not_on_device' && r.data?.error !== 'purchase_not_on_device', JSON.stringify(r.data));
r = await call('/api/skyid/prime/grant', { method: 'POST', body: JSON.stringify({ days: 30 }) }, U.tok, { 'X-Sky-Mode': 'phone' });
t('произвольное значение режима устройством не считается', r.data?.error !== 'purchase_not_on_device');

// истечение — все устройства видят сразу
q(`update prime_subscriptions set expires_at = now() - interval '1 minute' where profile_id='${U.pid}'`);
r = await call('/api/entitlements', {}, U.tok);
t('срок истёк — права сняты сразу', r.data.prime.active === false);
r = await call('/api/film/catalog', {}, U.tok);
t('и контент снова закрыт', r.status === 403);
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
