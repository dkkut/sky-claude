// Курьер: отклонённая заявка возвращается на рассмотрение, когда паспорт подтверждён (HTTP, API на :8080).
// Запуск: node scripts/audit/courier-reapply-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const adm = await mkuser(S, 'crAdm'); const u = await mkuser(S, 'crUser');
q(`update profiles set is_admin=true, admin_role='super_admin' where id='${adm.pid}'`);
const J = (o) => ({ method: 'POST', body: JSON.stringify(o) });

let r = await call('/api/logistics/courier/me', J({ name: 'Тест Курьер', vehicle: 'foot', cityId: 'msk' }), u.tok);
const cid = r.data?.courier?.id;
t('заявка курьера создана', !!cid, JSON.stringify(r.data));
r = await call(`/api/logistics/admin/couriers/${cid}/decide`, J({ approve: false, reason: 'тест' }), adm.tok);
t('администратор отклонил', r.status === 200 && r.data.courier.status === 'rejected', JSON.stringify(r.data));
r = await call('/api/logistics/courier/birthdate', J({ dateOfBirth: '1995-05-05' }), u.tok);
t('дата рождения', r.status === 200, JSON.stringify(r.data));
r = await call('/api/logistics/courier/verification', J({ fullName: 'Иванов Иван' }), u.tok);
const vid = r.data?.verification?.id;
t('заявка на паспорт', r.status === 201 && !!vid, JSON.stringify(r.data));
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF\0'), Buffer.alloc(2048, 1), Buffer.from([0xff, 0xd9])]);
r = await call(`/api/logistics/courier/verification/${vid}/doc`, { method: 'POST', body: jpeg, headers: { 'content-type': 'image/jpeg' } }, u.tok);
t('скан приложен', r.status < 300, JSON.stringify(r.data));
r = await call(`/api/logistics/admin/verification/${vid}/decide`, J({ approve: true }), adm.tok);
t('паспорт подтверждён', r.status === 200 && r.data.verification.status === 'verified', JSON.stringify(r.data));
r = await call('/api/logistics/courier/me', {}, u.tok);
t('старое отклонение снято: заявка снова на рассмотрении', r.data?.courier?.status === 'pending' && !r.data.courier.statusReason, JSON.stringify(r.data));
r = await call(`/api/logistics/admin/couriers/${cid}/decide`, J({ approve: true }), adm.tok);
t('администратор одобрил', r.status === 200 && r.data.courier.status === 'approved', JSON.stringify(r.data));
// отклонённого без подтверждённого паспорта по-прежнему одобрить нельзя
const u2 = await mkuser(S, 'crUser2');
r = await call('/api/logistics/courier/me', J({ name: 'Второй', vehicle: 'foot', cityId: 'msk' }), u2.tok);
const c2 = r.data?.courier?.id;
await call(`/api/logistics/admin/couriers/${c2}/decide`, J({ approve: false, reason: 'нет' }), adm.tok);
r = await call(`/api/logistics/admin/couriers/${c2}/decide`, J({ approve: true }), adm.tok);
t('без паспорта одобрить нельзя', r.status >= 400 && ['passport_unverified', 'underage'].includes(r.data.error), JSON.stringify(r.data));
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
