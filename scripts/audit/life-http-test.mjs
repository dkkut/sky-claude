// Sky Life через HTTP: доступ, изоляция (IDOR), файлы, лимиты, права администрации.
// API: OWNER_USERNAME=lifeowner ADMIN_GATE=off ADMIN_TOKEN=off EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test RATE_LIMIT_PER_MINUTE=5000 LIFE_DIR=/tmp/life-http; запуск: node scripts/audit/life-http-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2]; let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const q = (s) => execSync(`psql postgres://sky:sky@localhost:5432/skytest -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const J = (o) => ({ method: 'POST', body: JSON.stringify(o) }); const P = (o) => ({ method: 'PUT', body: JSON.stringify(o) });
const a = await mkuser(S, 'LhA'); const b = await mkuser(S, 'LhB'); const adm = await mkuser(S, 'LhAdm'); q(`UPDATE profiles SET is_admin = true WHERE id = '${adm.pid}'`);

t('без входа 401', (await call('/api/life/home')).status === 401 && (await call('/api/admin/life/queue')).status === 401);
const h0 = await call('/api/life/home', {}, a.tok); t('главная работает у нового человека', h0.status === 200 && h0.data.stats.total === 0, h0.text.slice(0, 200));
const g = await call('/api/life/items', J({ kind: 'goal', title: 'Секретная цель', description: 'приватное', extra: { goalType: 'finance' } }), a.tok); t('создание цели', g.status === 200 && g.data.item.id, g.text);
const id = g.data.item.id;
t('чужой: чтение/правка/удаление записи — 404', (await call(`/api/life/items/${id}`, {}, b.tok)).status === 404 && (await call(`/api/life/items/${id}`, P({ title: 'x' }), b.tok)).status === 404 && (await call(`/api/life/items/${id}`, { method: 'DELETE' }, b.tok)).status === 404);
t('чужой не видит в списках, обзоре и экспорте', (await call('/api/life/items', {}, b.tok)).data.total === 0 && !(await call('/api/life/goals', {}, b.tok)).text.includes('Секретная') && !(await call('/api/life/export', {}, b.tok)).text.includes('Секретная'));
t('подмена owner/id в теле игнорируется', await (async () => { const r = await call('/api/life/items', J({ kind: 'task', title: 'x', owner_id: b.pid, ownerId: b.pid }), a.tok); return r.status === 200 && q(`SELECT owner_id FROM life_items WHERE id = '${r.data.item.id}'`) === a.pid; })());
t('SQL-мусор в параметрах не роняет', (await call(`/api/life/items?kind=goal'%3Bdrop&category=%27%20OR%201%3D1&q=%25`, {}, a.tok)).status === 200 && (await call(`/api/life/items/..%2F..%2Fetc`, {}, a.tok)).status === 404);
t('пароль отклоняется на сервере', (await call('/api/life/items', J({ kind: 'important', title: 'Банк', description: 'мой пароль 12345' }), a.tok)).status === 422);
const bad1 = await fetch(`${B}/api/life/items`, { method: 'POST', headers: { authorization: `Bearer ${a.tok}`, 'content-type': 'application/json' }, body: '{плохой json' }); t('кривой JSON — 4xx', bad1.status >= 400 && bad1.status < 500);

/* файлы */
const upload = (tok, qs, buf, name) => fetch(`${B}/api/life/files/upload?${qs}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/octet-stream' }, body: buf });
const pdf = Buffer.from('%PDF-1.4\nтестовый файл\n%%EOF');
const up = await upload(a.tok, `itemId=${id}`, pdf, 'договор.pdf'); const upj = await up.json(); t('загрузка файла', up.status === 200 && upj.id, JSON.stringify(upj));
t('чужая запись — загрузить нельзя', (await upload(b.tok, `itemId=${id}`, pdf, 'x.pdf')).status === 404);
t('вредоносное отклонено', (await upload(a.tok, `itemId=${id}`, Buffer.from('MZ\x90\x00This program cannot be run in DOS mode'), 'a.pdf')).status >= 400 && (await upload(a.tok, `itemId=${id}`, pdf, 'a.exe')).status === 415);
const dl = await fetch(`${B}/api/life/files/${upj.id}`, { headers: { authorization: `Bearer ${a.tok}` } }); const buf = Buffer.from(await dl.arrayBuffer());
t('владелец скачивает и получает исходный файл', dl.status === 200 && buf.equals(pdf) && dl.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(dl.headers.get('content-security-policy')));
t('чужой и админ не скачают', (await fetch(`${B}/api/life/files/${upj.id}`, { headers: { authorization: `Bearer ${b.tok}` } })).status === 404 && (await fetch(`${B}/api/life/files/${upj.id}`, { headers: { authorization: `Bearer ${adm.tok}` } })).status === 404 && (await fetch(`${B}/api/life/files/${upj.id}`)).status === 401);
t('чужой не удалит файл', (await call(`/api/life/files/${upj.id}`, { method: 'DELETE' }, b.tok)).status === 404);

/* права администрации */
for (const p of ['/api/admin/life/queue', '/api/admin/life/settings', '/api/admin/life/stats', '/api/admin/life/logs']) t(`обычному нельзя ${p}`, (await call(p, {}, a.tok)).status === 403);
t('обычный не меняет настройки/категории/ограничения', (await call('/api/admin/life/settings', P({ free_items: 1 }), a.tok)).status === 403 && (await call('/api/admin/life/categories', J({ name: 'x' }), a.tok)).status === 403 && (await call('/api/admin/life/restrict', J({ profileId: b.pid, reason: 'причина причина' }), a.tok)).status === 403);
const st = await call('/api/admin/life/stats', {}, adm.tok); t('админ видит только числа', st.status === 200 && typeof st.data.items === 'number' && !st.text.includes('Секретная'), st.text.slice(0, 200));
const qd = await call('/api/admin/life/queue', {}, adm.tok); t('очередь админа не содержит личных записей', qd.status === 200 && !qd.text.includes('Секретная') && !qd.text.includes('приватное'));
t('админ не читает чужую запись через пользовательскую ручку', (await call(`/api/life/items/${id}`, {}, adm.tok)).status === 404);
t('настройки админом сохраняются и действуют', (await call('/api/admin/life/settings', P({ free_items: 2 }), adm.tok)).status === 200);
const c1 = await call('/api/life/items', J({ kind: 'task', title: 'c1' }), b.tok); const c2 = await call('/api/life/items', J({ kind: 'task', title: 'c2' }), b.tok); const c3 = await call('/api/life/items', J({ kind: 'task', title: 'c3' }), b.tok);
t('лимит применяется на сервере (402)', c1.status === 200 && c2.status === 200 && c3.status === 402 && c3.data.error === 'limit_reached', c3.text);
t('при лимите чтение/выгрузка/удаление работают', (await call('/api/life/items', {}, b.tok)).status === 200 && (await call('/api/life/export', {}, b.tok)).status === 200 && (await call(`/api/life/items/${c1.data.item.id}`, { method: 'DELETE' }, b.tok)).status === 200);
await call('/api/admin/life/settings', P({ free_items: 300 }), adm.tok);

/* деловые публикации: контакт и скрытое */
await call('/api/life/biz/profile', P({ name: 'Анна', country: 'Россия', city: 'Москва', industries: ['food'], skills: ['маркетинг'], contact: '@anna', publish: true }), a.tok);
const ps = await call('/api/life/biz/posts', J({ kind: 'investor_ask', title: 'Ищу инвестора в кофейню', description: 'Сеть кофеен у метро, ищем инвестора для первой точки в Москве.', stage: 'mvp', industry: ['food'], city: 'Москва', amountNeeded: 3000000, hidden: ['amountNeeded'], contact: 'anna@example.com', submit: true }), a.tok);
t('публикация отправлена на проверку', ps.status === 200 && ps.data.status === 'pending', ps.text);
t('на проверке не видна людям', !(await call('/api/life/biz/search?tab=investees', {}, b.tok)).text.includes('кофейню'));
const dec = await call(`/api/admin/life/post/${ps.data.id}/decide`, J({ action: 'approve' }), adm.tok); t('модератор одобряет', dec.status === 200, dec.text);
const sr = await call('/api/life/biz/search?tab=investees', {}, b.tok); t('после одобрения видна, без скрытого и контакта', sr.status === 200 && sr.data.posts.length === 1 && !sr.text.includes('3000000') && !sr.text.includes('anna@example.com'), sr.text.slice(0, 300));
const det = await call(`/api/life/biz/posts/${ps.data.id}`, {}, b.tok); t('карточка не раскрывает контакт', !det.text.includes('anna@example.com') && !det.text.includes('3000000') && det.data.post.notice);
t('черновик чужого не виден', await (async () => { const d = await call('/api/life/biz/posts', J({ kind: 'partner', title: 'Черновик партнёра' }), a.tok); return (await call(`/api/life/biz/posts/${d.data.id}`, {}, b.tok)).status === 404; })());
t('предложение, контакт закрыт до решения автора', await (async () => { const p = await call(`/api/life/biz/posts/${ps.data.id}/proposal`, J({ message: 'Здравствуйте! Хочу обсудить инвестицию в проект.' }), b.tok); if (p.status !== 200) return false; const d2 = await call(`/api/life/biz/posts/${ps.data.id}`, {}, b.tok); return !d2.text.includes('anna@example.com'); })());
const inbox = await call('/api/life/biz/proposals?box=in', {}, a.tok); const pid = inbox.data.proposals[0].id;
t('чужой не принимает и не видит предложение', (await call(`/api/life/biz/proposals/${pid}/accept`, J({}), adm.tok)).status === 404 && (await call(`/api/life/biz/proposals/${pid}/history`, {}, adm.tok)).status === 404 && (await call(`/api/life/biz/proposals/${pid}/accept`, J({}), b.tok)).status === 403);
t('принятие и раскрытие контакта — только автором', (await call(`/api/life/biz/proposals/${pid}/accept`, J({}), a.tok)).status === 200 && (await call(`/api/life/biz/proposals/${pid}/share`, J({ contact: true }), b.tok)).status === 404 && (await call(`/api/life/biz/proposals/${pid}/share`, J({ contact: true, finance: true }), a.tok)).status === 200);
const d3 = await call(`/api/life/biz/posts/${ps.data.id}`, {}, b.tok); t('после решения автора контакт и финансы открыты', d3.data.post.contact === 'anna@example.com' && d3.data.post.finance.amountNeeded === 3000000, d3.text.slice(0, 300));
t('жалоба и ограничение', (await call(`/api/life/biz/posts/${ps.data.id}/report`, J({ reason: 'scam' }), b.tok)).status === 200 && (await call('/api/admin/life/restrict', J({ profileId: a.pid, days: 1, reason: 'Подозрение на мошенничество' }), adm.tok)).status === 200 && (await call('/api/life/biz/posts', J({ kind: 'partner', title: 'Ещё одна публикация', summary: 'x'.repeat(40), contact: 'c', submit: true }), a.tok)).status === 403);
t('ограниченный сохраняет доступ к своим личным данным', (await call(`/api/life/items/${id}`, {}, a.tok)).status === 200 && (await call('/api/life/export', {}, a.tok)).status === 200);
console.log(`ok ${ok}, fail ${bad}`); process.exit(bad ? 1 : 0);
