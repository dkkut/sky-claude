// «Обновления» в админке: загрузка файла приложения и «Разослать уведомление об обновлении» (server/sitecms.mjs, право `site`).
//   (. env.sh; SITE_DIR=<каталог>; API с OWNER_USERNAME=ownertest ADMIN_GATE=off; node scripts/audit/updates-notice-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const post = (p, b, tok) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, tok);

q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
const own = await mkuser(S, 'updown'); q(`update profiles set username='ownertest' where id='${own.pid}'`);
const usr = await mkuser(S, 'updusr');
const other = await mkuser(S, 'updoth');
q(`delete from notify_broadcasts where reason like 'app_update%'`);

let r = await call('/api/admin/site/updates/last', {}, usr.tok);
t('обычному человеку «последняя рассылка» закрыта', r.status === 403);
r = await post('/api/admin/site/updates/notify', { version: '5.1.0', confirm: true }, usr.tok);
t('обычный человек не может разослать', r.status === 403);
r = await post('/api/admin/site/updates/notify', { version: '5.1.0' }, own.tok);
t('без подтверждения — отказ', r.status === 400 && r.data.error === 'confirm_required');
r = await post('/api/admin/site/updates/notify', { confirm: true }, own.tok);
t('без версии — отказ', r.status === 400 && r.data.error === 'version_required');

// файл приложения: отдельный список «Обновления» (не лендинг)
const buf = Buffer.alloc(200000, 3);
const upl = (tok, name = 'sky-5.1.0.apk', pl = 'android') => fetch(B + `/api/admin/site/app-updates/${pl}/file?name=${name}`, { method: 'POST', body: buf, headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${tok}` } });
t('обычный человек файл загрузить не может', (await upl(usr.tok)).status === 403);
t('чужой тип файла отклоняется', (await upl(own.tok, 'virus.sh')).status === 400);
t('неизвестная платформа — 404', (await upl(own.tok, 'a.apk', 'beos')).status === 404);
const up = await upl(own.tok);
t('файл .apk загружен', up.status === 200);
r = await call('/api/admin/site/app-updates/android', { method: 'PUT', body: JSON.stringify({ version: '5.1.0', notes: 'Новые «Обновления»' }) }, own.tok);
t('версия и «что нового» сохранены', r.status === 200);
r = await call('/api/site/app-updates');
const a = r.data.items.find((d) => d.platform === 'android');
t('в окне «Обновления» у людей: версия, описание, файл', a?.version === '5.1.0' && a.notes.includes('Обновления') && a.file?.name === 'sky-5.1.0.apk' && a.href, JSON.stringify(a));
t('платформы без файла в окне не показываются', !r.data.items.some((d) => d.platform === 'windows'));
const dl = await fetch(B + a.href);
t('файл скачивается без входа, размер совпадает', dl.status === 200 && (await dl.arrayBuffer()).byteLength === 200000);
const rg = await fetch(B + a.href, { headers: { range: 'bytes=0-99' } });
t('докачка по Range работает', rg.status === 206);
r = await call('/api/site/public');
t('скачивание на лендинге не затронуто', !r.data.downloads.some((d) => d.file?.name === 'sky-5.1.0.apk'));
r = await call('/api/admin/site/app-updates', {}, own.tok);
t('админ видит хеш и счётчик скачиваний', r.data.items.find((d) => d.platform === 'android')?.file?.downloads >= 1);

r = await post('/api/admin/site/updates/notify', { version: '5.1.0', text: 'Новые «Обновления» и исправления.', confirm: true }, own.tok);
t('рассылка создана', r.status === 200 && r.data.id, JSON.stringify(r.data));
await new Promise((x) => setTimeout(x, 2500));
const row = q(`select audience_type, status, title from notify_broadcasts where id='${r.data.id}'`);
t('аудитория — все, заголовок с версией', row.startsWith('all|') && row.includes('Sky 5.1.0'), row);
const got = (tok) => call('/api/notify/events', {}, tok);
const e1 = await got(usr.tok), e2 = await got(other.tok);
const has = (x) => JSON.stringify(x.data).includes('Sky 5.1.0');
t('уведомление получили разные люди', has(e1) && has(e2), JSON.stringify(e1.data).slice(0, 200));
r = await post('/api/admin/site/updates/notify', { version: '5.1.0', confirm: true }, own.tok);
t('повтор сразу — 429 (защита от двойного нажатия)', r.status === 429 && r.data.error === 'too_soon');
r = await call('/api/admin/site/updates/last', {}, own.tok);
t('«последняя рассылка» показывается', r.status === 200 && r.data.last?.title.includes('5.1.0'));
r = await call('/api/admin/site/app-updates/android/file', { method: 'DELETE' }, own.tok);
t('файл можно удалить, платформа пропадает из окна', r.status === 200 && !(await call('/api/site/app-updates')).data.items.some((d) => d.platform === 'android'));
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
