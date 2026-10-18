// Кнопки админки: отключение Sky для бизнеса (modclosure 'kbiz') и баннер Sky Media. API: OWNER_USERNAME=ownertest ADMIN_GATE=off
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { c ? (ok++, console.log('ok  ', n)) : (bad++, console.log('FAIL', n, x)); };
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
const own = await mkuser(S, 'ffown'); q(`update profiles set username='ownertest' where id='${own.pid}'`);
const usr = await mkuser(S, 'ffusr'); const adm = await mkuser(S, 'ffadm');
const put = (p, b, tok) => call(p, { method: 'PUT', body: JSON.stringify(b) }, tok);
const post = (p, b, tok) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, tok);
q(`delete from closed_modules where module='kbiz'; delete from platform_flags where key='media_banner'`);

const st = async () => (await call('/api/platform/status')).data;
t('по умолчанию: баннер скрыт, kbiz открыт', (await st()).mediaBanner === false && !(await st()).closedModules?.kbiz);
// Права: без входа и обычный человек не могут
t('баннер: аноним — 401', (await put('/api/admin/media-banner', { on: true })).status === 401);
t('баннер: обычный человек — 403', (await put('/api/admin/media-banner', { on: true }, usr.tok)).status === 403);
t('kbiz: обычный человек — 403', (await put('/api/admin/modules/kbiz', { closed: true, reason: 'x y z' }, usr.tok)).status === 403);
t('баннер: после попыток всё ещё скрыт', (await st()).mediaBanner === false);
// Включение владельцем
t('баннер: неверное значение — 400', (await put('/api/admin/media-banner', { on: 'yes' }, own.tok)).status === 400);
t('баннер: владелец включает', (await put('/api/admin/media-banner', { on: true }, own.tok)).data?.on === true);
t('баннер виден в публичном статусе без входа', (await st()).mediaBanner === true);
t('баннер: запись в журнал администрации', Number(q(`select count(*) from admin_log where type='media_banner_on'`)) >= 1);
t('баннер: выключение', (await put('/api/admin/media-banner', { on: false }, own.tok)).data?.on === false && (await st()).mediaBanner === false);

// Sky для бизнеса
const biz = await post('/api/kbiz/business', { name: 'Тест', mode: 'online', legalType: 'person' }, usr.tok);
t('до отключения бизнес создаётся/читается', [200, 201, 409].includes(biz.status), JSON.stringify(biz.data));
const r = await put('/api/admin/modules/kbiz', { closed: true, reason: 'Отключено администрацией', showReason: false }, own.tok);
t('владелец отключает Sky для бизнеса', r.status === 200);
t('отключение видно людям', !!(await st()).closedModules?.kbiz);
const w = await post('/api/kbiz/business', { name: 'Ещё', mode: 'online', legalType: 'person' }, usr.tok);
t('новые операции блокируются сервером (503 module_closed)', w.status === 503 && w.data?.error === 'module_closed', JSON.stringify(w));
t('публичная страница оплаты закрыта', (await call('/api/kbiz/public/p/abcdefabcdef')).status === 503);
t('вебхук не блокируется (доводит начатые платежи)', (await call('/api/kbiz/webhook/kbz-00000000-0000-0000-0000-000000000000', { method: 'POST', body: '{}' })).status !== 503);
t('чтение кабинета владельцем остаётся', (await call('/api/kbiz/business', {}, usr.tok)).status !== 503);
t('другие модули не затронуты (кошелёк отвечает)', (await call('/api/wallet', {}, usr.tok)).status !== 503);
t('данные не удалены', Number(q(`select count(*) from kb_businesses`)) >= 0);
t('включение обратно', (await put('/api/admin/modules/kbiz', { closed: false }, own.tok)).status === 200 && !(await st()).closedModules?.kbiz);
t('после включения операции снова принимаются', (await post('/api/kbiz/business', { name: 'Тест2', mode: 'online', legalType: 'person' }, usr.tok)).status !== 503);
t('журнал: module_closed и module_opened записаны', Number(q(`select count(*) from admin_log where type in ('module_closed','module_opened')`)) >= 2);
console.log(bad ? `FAIL ${bad}` : `OK ${ok}`); process.exit(bad ? 1 : 0);
