// Модуль 5: «Партнёры» — каталог, проверка и подтверждение, журнал, скрытые данные (server/partners.mjs, routes/partners.mjs).
// API: OWNER_USERNAME=ptnowner ADMIN_GATE=off. (. env.sh; node scripts/audit/partners-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const put = (p, b, u) => call(p, { method: 'PUT', body: JSON.stringify(b ?? {}) }, u?.tok);
const get = (p, u) => call(p, {}, u?.tok);
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const staff = async (tag, role) => { const u = await mkuser(S, tag); q(`update profiles set is_admin=true, admin_role='${role}' where id='${u.pid}'`); return u; };
const step = async (u) => { q(`update admin_step_up set used_at = now() where actor_id='${u.pid}' and used_at is null`); await post('/api/admin/partners/step-up', {}, u); await sleep(1300); return codeOf(u.email); };
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

q(`update profiles set username='old'||substr(id,1,8) where lower(username)='ptnowner'`);
const OWN = await mkuser(S, 'ptnOwn'); q(`update profiles set username='ptnowner' where id='${OWN.pid}'`);
const USR = await mkuser(S, 'ptnUsr'); const ED = await staff('ptnEd', 'partners_manager'); const AP = await staff('ptnAp', 'partners_approver'); const SA = await staff('ptnSa', 'super_admin');
q(`delete from partner_log; delete from partners`);

t('человек видит пустой каталог', (await get('/api/partners', USR)).data.partners.length === 0);
t('админка партнёров людям закрыта', (await get('/api/admin/partners', USR)).status === 403);
const good = { name: 'Тест-партнёр', category: 'shop', website: 'https://example.com/shop', description: 'Магазин электроники для участников Sky, проверка описания.', conditions: 'Скидка по коду до конца месяца.', contact: 'manager@example.com, +7 900 000-00-00', startsAt: day(-1), endsAt: day(30), offers: [{ title: 'Скидка 10%', terms: 'На всё', promoCode: 'SKY10', endsAt: day(10) }, { title: 'Старая акция', terms: '', promoCode: '', endsAt: day(-2) }], sort: 5 };
let r = await post('/api/admin/partners', { ...good, website: 'http://example.com' }, ED);
t('сайт только по https', r.status === 400 && r.data.field === 'website', JSON.stringify(r.data));
t('адрес с логином и паролем отклоняется', (await post('/api/admin/partners', { ...good, website: 'https://user:pw@example.com' }, ED)).status === 400);
t('неверная категория отклоняется', (await post('/api/admin/partners', { ...good, category: 'x' }, ED)).data.field === 'category');
t('срок окончания раньше начала отклоняется', (await post('/api/admin/partners', { ...good, startsAt: day(5), endsAt: day(1) }, ED)).data.field === 'dates');
t('промокод с пробелами отклоняется', (await post('/api/admin/partners', { ...good, offers: [{ title: 'Акция', promoCode: 'A B' }] }, ED)).data.field === 'offers');
r = await post('/api/admin/partners', good, ED);
const P = r.data.id; t('редактор создаёт черновик', r.status === 200 && r.data.status === 'draft' && /^ptn-/.test(P), JSON.stringify(r.data));
t('черновик людям не виден', (await get('/api/partners', USR)).data.partners.length === 0);
t('контакты в базе зашифрованы', !q(`select contact_enc from partners where id='${P}'`).includes('manager@example.com') && q(`select contact_enc from partners where id='${P}'`).length > 20);

t('обычный редактор не подтверждает (403)', (await post(`/api/admin/partners/${P}/approve`, {}, ED)).status === 403);
r = await post(`/api/admin/partners/${P}/submit`, {}, ED);
t('отправка на проверку', r.status === 200 && r.data.status === 'review', JSON.stringify(r.data));
t('на проверке людям не виден', (await get('/api/partners', USR)).data.partners.length === 0);
t('super_admin без права подтверждения не подтверждает', (await post(`/api/admin/partners/${P}/approve`, { stepUpCode: '000000' }, SA)).status === 403);
t('уполномоченный: без кода личности — 401', (await post(`/api/admin/partners/${P}/approve`, {}, AP)).status === 401);
r = await post(`/api/admin/partners/${P}/approve`, { stepUpCode: await step(AP) }, AP);
t('уполномоченный подтверждает (с кодом)', r.status === 200 && r.data.status === 'active', JSON.stringify(r.data));

let pub = await get('/api/partners', USR);
const one = pub.data.partners[0];
t('человек видит подтверждённого партнёра', pub.data.partners.length === 1 && one.name === 'Тест-партнёр' && one.categoryLabel === 'Магазины');
t('публичные данные без внутренних полей', !('status' in one) && !('contact' in one) && !JSON.stringify(pub.data).includes('manager@example.com') && !JSON.stringify(pub.data).includes('createdBy'), JSON.stringify(one));
t('истёкшая акция скрыта, действующая показана', one.offers.length === 1 && one.offers[0].promoCode === 'SKY10');
const adm = await get('/api/admin/partners', ED);
t('администрация видит контакты', adm.data.partners[0].contact.includes('manager@example.com') && adm.data.partners[0].status === 'active');

// сроки
q(`update partners set ends_at = current_date - 1 where id='${P}'`);
t('срок истёк — партнёр скрыт', (await get('/api/partners', USR)).data.partners.length === 0);
q(`update partners set ends_at = current_date + 30, starts_at = current_date + 3 where id='${P}'`);
t('сотрудничество ещё не началось — скрыт', (await get('/api/partners', USR)).data.partners.length === 0);
q(`update partners set starts_at = current_date - 1 where id='${P}'`);
t('в срок — снова виден', (await get('/api/partners', USR)).data.partners.length === 1);

// правки
const cur = (await get('/api/admin/partners', ED)).data.partners[0];
r = await put(`/api/admin/partners/${P}`, { ...good, sort: 1, startsAt: cur.startsAt, endsAt: cur.endsAt }, ED);
t('правка только порядка не снимает с показа', r.status === 200 && r.data.status === 'active', JSON.stringify(r.data));
r = await put(`/api/admin/partners/${P}`, { ...good, description: 'Новое описание партнёра, которое нужно подтвердить заново.', sort: 1, startsAt: cur.startsAt, endsAt: cur.endsAt }, ED);
t('правка содержания возвращает на проверку', r.status === 200 && r.data.status === 'review' && r.data.changed.includes('description'), JSON.stringify(r.data));
t('и партнёр исчезает у людей до подтверждения', (await get('/api/partners', USR)).data.partners.length === 0);
// подтверждение своей правки запрещено (кроме владельца)
q(`update partners set updated_by='${AP.pid}' where id='${P}'`);
r = await post(`/api/admin/partners/${P}/approve`, { stepUpCode: await step(AP) }, AP);
t('нельзя подтвердить собственную правку', r.status === 403 && r.data.error === 'self_approval', JSON.stringify(r.data));
q(`update partners set updated_by='${ED.pid}' where id='${P}'`);
r = await post(`/api/admin/partners/${P}/return`, { reason: '' }, AP);
t('возврат на доработку требует причину', r.status === 400);
r = await post(`/api/admin/partners/${P}/return`, { reason: 'Уточните описание' }, AP);
t('возврат на доработку', r.status === 200 && r.data.status === 'draft');
await post(`/api/admin/partners/${P}/submit`, {}, ED);
r = await post(`/api/admin/partners/${P}/approve`, { stepUpCode: await step(AP) }, AP);
t('повторное подтверждение', r.status === 200);

// логотип
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
r = await put(`/api/admin/partners/${P}/logo`, { dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }, ED);
t('SVG-логотип запрещён', r.status === 400 && r.data.error === 'bad_logo');
r = await put(`/api/admin/partners/${P}/logo`, { dataUrl: `data:image/jpeg;base64,${PNG}` }, ED);
t('тип не совпадает с содержимым — отказ', r.status === 400);
r = await put(`/api/admin/partners/${P}/logo`, { dataUrl: `data:image/png;base64,${PNG}` }, ED);
t('логотип загружается (опубликованный партнёр уходит на проверку)', r.status === 200 && r.data.status === 'review', JSON.stringify(r.data));
const lg = await fetch('http://127.0.0.1:8080/api/partners/' + P + '/logo', { headers: { authorization: `Bearer ${USR.tok}` } });
t('на проверке логотип людям не отдаётся', lg.status === 404);
const lgS = await fetch('http://127.0.0.1:8080/api/partners/' + P + '/logo', { headers: { authorization: `Bearer ${ED.tok}` } });
t('сотруднику отдаётся', lgS.status === 200 && lgS.headers.get('content-type') === 'image/png' && lgS.headers.get('x-content-type-options') === 'nosniff');
await post(`/api/admin/partners/${P}/approve`, { stepUpCode: await step(OWN) }, OWN);
t('владелец подтверждает (и свою правку тоже)', (await get('/api/partners', USR)).data.partners.length === 1);
const lgU = await fetch('http://127.0.0.1:8080/api/partners/' + P + '/logo', { headers: { authorization: `Bearer ${USR.tok}` } });
t('логотип подтверждённого партнёра виден человеку', lgU.status === 200 && (await lgU.arrayBuffer()).byteLength > 20);
t('в публичном списке отмечен логотип', (await get('/api/partners', USR)).data.partners[0].hasLogo === true);

// приостановка, возобновление, архив
r = await post(`/api/admin/partners/${P}/suspend`, { reason: '', stepUpCode: await step(AP) }, AP);
t('приостановка требует причину', r.status === 400);
r = await post(`/api/admin/partners/${P}/suspend`, { reason: 'Проверка условий', stepUpCode: await step(AP) }, AP);
t('приостановка скрывает партнёра', r.status === 200 && (await get('/api/partners', USR)).data.partners.length === 0);
t('редактор не возобновляет', (await post(`/api/admin/partners/${P}/resume`, {}, ED)).status === 403);
r = await post(`/api/admin/partners/${P}/resume`, { stepUpCode: await step(AP) }, AP);
t('возобновление возвращает в каталог', r.status === 200 && (await get('/api/partners', USR)).data.partners.length === 1);
r = await post(`/api/admin/partners/${P}/archive`, { reason: 'Сотрудничество завершено', stepUpCode: await step(AP) }, AP);
t('архив скрывает партнёра', r.status === 200 && (await get('/api/partners', USR)).data.partners.length === 0);
t('архивного править нельзя', (await put(`/api/admin/partners/${P}`, good, ED)).data.error === 'archived');

// журнал
const lg2 = (await get(`/api/admin/partners/${P}/log`, ED)).data.log;
const acts = lg2.map((x) => x.action);
t('журнал: создание, правки, подтверждения, логотип, приостановка, архив', ['create', 'update', 'submit', 'approve', 'return', 'logo', 'suspend', 'resume', 'archive'].every((a) => acts.includes(a)), acts.join());
t('в журнале видно, кто действовал', lg2.every((x) => x.actor));
t('журнал не содержит внутренних контактов', !JSON.stringify(lg2).includes('manager@example.com'));
t('действия попали и в журнал администрации', Number(q(`select count(*) from admin_log where type like 'partner_%'`)) >= 8);

console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
