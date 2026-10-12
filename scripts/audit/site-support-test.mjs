// Тех. поддержка с лендинга: тикет в основной очереди, статус по коду+почте, ответ на почту.
//   (. env.sh; node scripts/audit/site-support-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
let n = 0; const ip = () => `198.51.100.${(++n % 250) + 1}`;
const post = (p, b, tok) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}), headers: { 'x-real-ip': ip() } }, tok);
const mailTo = (email) => { const log = readFileSync(S + '/api.log', 'utf8'); const k = log.lastIndexOf(email + ' |'); return k < 0 ? '' : log.slice(k, k + 900); };
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);
const own = await mkuser(S, 'spown'); q(`update profiles set username='ownertest' where id='${own.pid}'`);
const email = `guest${Date.now()}@example.com`;
const base = { email, topic: 'bug', platform: 'android', version: '4.0.1', username: '@vasya', subject: 'Не открывается чат', body: 'После обновления чат не открывается, пишет ошибку сети.' };

t('без почты — отказ', (await post('/api/site/support', { ...base, email: 'x' })).data.error === 'bad_email');
t('неизвестная тема — отказ', (await post('/api/site/support', { ...base, topic: 'zzz' })).data.error === 'bad_topic');
t('короткий текст — отказ', (await post('/api/site/support', { ...base, body: 'мало' })).data.error === 'text_too_short');
const bots = Number(q(`select count(*) from support_tickets where source='site'`));
t('ловушка для ботов: ответ «успех», тикета нет', (await post('/api/site/support', { ...base, website: 'spam' })).data.code === 'SUP-0000-0000' && Number(q(`select count(*) from support_tickets where source='site'`)) === bots);

let r = await post('/api/site/support', base);
const code = r.data.code;
t('обращение принято, выдан номер SUP-…', r.status === 200 && /^SUP-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), JSON.stringify(r.data));
t('письмо-подтверждение ушло', /SUP-/.test(mailTo(email)));
const row = q(`select id||'|'||coalesce(author_id,'NULL')||'|'||source||'|'||kind from support_tickets where guest_code='${code}'`).split('|');
t('это настоящий тикет основной поддержки: без автора, source=site, вид «ошибка»', row[1] === 'NULL' && row[2] === 'site' && row[3] === 'bug', row.join('|'));
t('почта и текст в базе не открытым текстом', q(`select count(*) from support_tickets t join support_messages m on m.ticket_id=t.id where t.guest_code='${code}' and (t.guest_email like '%${email}%' or m.body like '%чат не открывается%')`) === '0');

// Очередь поддержки в админке
r = await call('/api/support/queue', {}, own.tok);
const item = (r.data.tickets ?? []).find((x) => x.id === row[0]);
t('тикет виден сотруднику в общей очереди с пометкой «с сайта» и почтой', !!item && item.source === 'site' && item.guestEmail === email && item.subject.startsWith('[Сайт]'), JSON.stringify(item ?? r.data).slice(0, 200));
r = await call(`/api/support/ticket/${row[0]}`, {}, own.tok);
t('сотрудник читает первое сообщение с данными (платформа, версия, ник)', /Платформа: android, версия 4\.0\.1/.test(r.data.ticket.messages[0].body) && /vasya/.test(r.data.ticket.messages[0].body), r.data.ticket?.messages?.[0]?.body?.slice(0, 120));

// Статус по коду + почте
t('чужая почта — «не найдено»', (await post('/api/site/support/check', { code, email: 'other@example.com' })).status === 404);
t('неверный код — «не найдено»', (await post('/api/site/support/check', { code: 'SUP-AAAA-AAAA', email })).status === 404);
r = await post('/api/site/support/check', { code, email });
t('по коду и почте виден статус «Принято» и одно сообщение', r.data.ok && r.data.status === 'open' && r.data.messages.length === 1);

// Ответ поддержки → на сайте и на почте
await call(`/api/support/ticket/${row[0]}/reply`, { method: 'POST', body: JSON.stringify({ body: 'Здравствуйте! Обновите приложение до 4.0.2 и войдите заново.' }) }, own.tok);
await new Promise((x) => setTimeout(x, 500));
r = await post('/api/site/support/check', { code, email });
t('ответ поддержки виден на сайте, статус «В работе»', r.data.status === 'in_progress' && r.data.messages.some((m) => m.fromStaff && /4\.0\.2/.test(m.body)));
t('ответ поддержки продублирован на почту', /4\.0\.2/.test(mailTo(email)) && new RegExp(code).test(mailTo(email)), mailTo(email).slice(0, 200));

// Ответ человека с сайта
r = await post('/api/site/support/reply', { code, email, body: 'Помогло, спасибо!' });
t('человек отвечает с сайта', r.status === 200 && r.data.ok);
r = await post('/api/site/support/reply', { code, email: 'other@example.com', body: 'Чужой ответ' });
t('с чужой почтой ответить нельзя', r.status === 404);
r = await post('/api/site/support/check', { code, email });
t('ответ человека виден в переписке', r.data.messages.some((m) => !m.fromStaff && /Помогло/.test(m.body)));

// Закрытие
await call(`/api/support/ticket/${row[0]}/status`, { method: 'POST', body: JSON.stringify({ status: 'closed' }) }, own.tok);
r = await post('/api/site/support/reply', { code, email, body: 'ещё вопрос' });
t('в закрытом обращении ответ отклоняется', r.status === 409 && r.data.error === 'closed', JSON.stringify(r.data));

// Предел на почту
let last = 0; for (let i = 0; i < 6; i++) last = (await post('/api/site/support', { ...base, subject: 'повтор ' + i })).status;
t('не больше 5 обращений в сутки с одной почты', last === 429, String(last));

// Обычные обращения из приложения не пострадали
const usr = await mkuser(S, 'spusr');
r = await call('/api/support/tickets', { method: 'POST', body: JSON.stringify({ subject: 'Из приложения', body: 'Обычное обращение из приложения.', kind: 'question' }) }, usr.tok);
t('обращение из приложения по-прежнему создаётся (author = профиль)', r.status === 200 && (r.data.ticket?.source ?? 'app') === 'app' && !!r.data.ticket?.authorId, JSON.stringify(r.data).slice(0, 160));
r = await call('/api/support/tickets', {}, usr.tok);
t('человек видит только свои тикеты, не гостевые', (r.data.tickets ?? []).every((x) => x.source !== 'site'));
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
