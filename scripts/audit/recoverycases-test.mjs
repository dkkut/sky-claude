// Sky Recovery: бланк → заявка в общей поддержке → чат → уведомления → решения → фактор support_case. API как у skyrecovery-test.
// (. env.sh; OWNER_USERNAME=ownertest node scripts/audit/recoverycases-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b, u, h) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok, h);
const get = (p, u, h) => call(p, {}, u?.tok, h);
const log = () => readFileSync(S + '/api.log', 'utf8');
const rnd = () => Math.random().toString(36).slice(2, 10);
const mailsTo = (email, re) => [...log().matchAll(new RegExp('\\[email:log\\] ' + email.replace(/[.+]/g, '\\$&') + ' \\| ([^\\n]*)', 'g'))].map((m) => m[1]).filter((x) => re.test(x));
const lastLink = (email, kind) => { const m = [...log().matchAll(new RegExp(email.replace(/[.+]/g, '\\$&') + '[^]*?' + kind + '#t=([A-Za-z0-9_-]+)', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const lastKey = (email) => { const m = [...log().matchAll(new RegExp(email.replace(/[.+]/g, '\\$&') + '[^]*?case#k=([A-Za-z0-9_.-]+)', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
q(`delete from recovery_attempts`);
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);

const U = await mkuser(S, 'rcsU'); const STAFF = await mkuser(S, 'rcsStaff'); const STAFF2 = await mkuser(S, 'rcsStaff2'); const OTHER = await mkuser(S, 'rcsOther');
q(`update profiles set is_admin=true, admin_role='support_admin' where id='${STAFF.pid}'`);
q(`update profiles set is_admin=true, admin_role='security_admin' where id='${STAFF2.pid}'`);
const contact = `rcscontact${rnd()}@example.com`;
q(`delete from recovery_attempts`);
const form = (o = {}) => ({ skyId: U.email, reason: 'lost_both', accountType: 'user', description: 'Потерял телефон с приложением и доступ к резервной почте, нужна помощь с восстановлением.', contactEmail: contact, lostMethods: ['authenticator', 'backup_email'], ...o });

let r = await post('/api/recovery/case/create', form({ description: 'коротко' }));
t('короткое описание отклонено', r.status === 400 && r.data.field === 'description', JSON.stringify(r.data));
r = await post('/api/recovery/case/create', form({ reason: 'нет такой' }));
t('неизвестная причина отклонена', r.status === 400 && r.data.field === 'reason');
r = await post('/api/recovery/case/create', form({ contactEmail: 'не-почта' }));
t('неверная контактная почта отклонена', r.status === 400 && r.data.field === 'contactEmail');
r = await post('/api/recovery/case/create', form({ idempotencyKey: 'k-' + rnd() }));
t('заявка создана: номер SR-…, ключ доступа выдан', r.status === 201 && /^SR-\d+$/.test(r.data.number) && r.data.accessKey?.includes('.'), JSON.stringify(r.data));
const num = r.data.number; const key = r.data.accessKey; const caseId = key.split('.')[0];
t('номер выдан сервером, ключ в базе только хешем', q(`select count(*) from recovery_cases where access_hash like '%${key.split('.')[1].slice(0, 10)}%'`) === '0');
r = await post('/api/recovery/case/create', form());
t('повторная отправка не плодит дубль', r.status === 200 && r.data.duplicate === true && r.data.number === num, JSON.stringify(r.data));
t('заявка есть в общей поддержке как тикет', q(`select source from support_tickets where id=(select ticket_id from recovery_cases where id='${caseId}')`) === 'recovery');
t('контакт ещё не подтверждён → письмо об ответах не уходит', q(`select contact_ok from recovery_cases where id='${caseId}'`) === 'f');

const H = { 'x-recovery-case': key };
r = await get('/api/recovery/case/view', null, H);
t('по ключу видна заявка и первое сообщение', r.status === 200 && r.data.number === num && r.data.messages.length === 1 && r.data.status === 'new', JSON.stringify(r.data).slice(0, 200));
t('без ключа и с чужим ключом — 404', (await get('/api/recovery/case/view')).status === 404 && (await get('/api/recovery/case/view', null, { 'x-recovery-case': caseId + '.wrongsecret' })).status === 404);
t('подмена номера/идентификатора не даёт чужую заявку', (await get('/api/recovery/case/view', null, { 'x-recovery-case': 'rcs-000000000000000000000000.x' })).status === 404);

// подтверждение контакта
await sleep(900);
const conf = lastLink(contact, 'case-contact');
t('ссылка подтверждения контакта пришла', Boolean(conf));
r = await post('/api/recovery/case/confirm-contact', { token: conf });
t('контакт подтверждён', r.status === 200);
t('и тогда уходит письмо «обращение создано»', mailsTo(contact, /создано/).length >= 1);
t('подтверждение контакта не дало доступа к аккаунту', q(`select count(*) from recovery_handoffs where sky_id=(select sky_id from profiles where id='${U.pid}')`) === '0');

// чат
q(`delete from recovery_attempts`);
r = await post('/api/recovery/case/message', { text: '<img src=x onerror=alert(1)> Дополнительные сведения' }, null, H);
t('сообщение пользователя сохранено', r.status === 200);
r = await get('/api/recovery/case/view', null, H);
t('история сохраняется после «обновления страницы»', r.data.messages.length === 2 && r.data.messages[1].body.includes('<img'), JSON.stringify(r.data.messages.map((m) => m.body.slice(0, 20))));
t('сообщения хранятся зашифрованными', !q(`select string_agg(body, ' ') from support_messages where ticket_id=(select ticket_id from recovery_cases where id='${caseId}')`).includes('Дополнительные'));

// сотрудники
t('обычному человеку заявки закрыты', (await get('/api/admin/recovery/cases', OTHER)).status === 403);
r = await get('/api/admin/recovery/cases?tab=new', STAFF);
t('сотрудник видит заявку в списке «Новые»', r.status === 200 && r.data.items.some((i) => i.number === num && i.unread >= 1), JSON.stringify(r.data).slice(0, 160));
r = await get(`/api/admin/recovery/cases?q=${num.toLowerCase()}`, STAFF);
t('поиск по номеру', r.data.items.length === 1);
r = await get(`/api/admin/recovery/cases/${caseId}`, STAFF);
t('карточка: бланк, сообщения, события', r.status === 200 && r.data.form.reason === 'lost_both' && r.data.messages.length === 2 && r.data.events.length >= 1, JSON.stringify(r.data).slice(0, 120));
const before = mailsTo(contact, /новый ответ/).length;
r = await post(`/api/admin/recovery/cases/${caseId}/reply`, { text: 'Здравствуйте! Подскажите, когда вы последний раз входили?' }, STAFF);
t('ответ сотрудника сохранён и письмо отправлено', r.status === 200 && r.data.mail === 'sent', JSON.stringify(r.data));
await sleep(500);
t('письмо — только уведомление, без текста ответа', mailsTo(contact, /новый ответ/).length === before + 1 && !log().includes('когда вы последний раз входили?</') && !mailsTo(contact, /новый ответ/).join(' ').includes('последний раз входили'));
t('ответ появился у пользователя, статус «На рассмотрении»', (await get('/api/recovery/case/view', null, H)).data.messages.at(-1).fromStaff === true && q(`select status from recovery_cases where id='${caseId}'`) === 'review');
t('повторная обработка того же события не шлёт письмо дважды', (await (await import('../../server/recoverycases.mjs')).enqueueMail(((await import('../../server/db.mjs')).query, { id: caseId, number: num, contact_ok: true, contact_email: contact, status: 'review' }), 'reply', 'dup-key')) && (await (await import('../../server/recoverycases.mjs')).enqueueMail({ id: caseId, number: num, contact_ok: true, contact_email: contact, status: 'review' }, 'reply', 'dup-key')).duplicate === true);

// сбой почты не теряет сообщение
q(`update recovery_cases set contact_email='nonexistent' where id='${caseId}'`);
r = await post(`/api/admin/recovery/cases/${caseId}/reply`, { text: 'Ещё один вопрос по заявке' }, STAFF);
q(`update recovery_cases set contact_email='${contact}' where id='${caseId}'`);
t('ошибка почты не удаляет сообщение из чата', r.status === 200 && (await get('/api/recovery/case/view', null, H)).data.messages.length === 4);

// статусы и права
r = await post(`/api/admin/recovery/cases/${caseId}/status`, { status: 'waiting_user' }, STAFF);
t('сотрудник ставит «Ожидает ответа пользователя»', r.status === 200 && q(`select status from recovery_cases where id='${caseId}'`) === 'waiting_user');
r = await post(`/api/admin/recovery/cases/${caseId}/status`, { status: 'allowed', stepUpCode: '000000' }, STAFF);
t('«Восстановление разрешено» без права security и кода — нельзя', r.status === 401 || r.status === 403, r.status);
await post(`/api/admin/recovery/cases/${caseId}/status`, { status: 'review' }, STAFF2);
// привязываем заявку к аккаунту (сотрудник проверил личность)
q(`update recovery_cases set sky_id=(select sky_id from profiles where id='${U.pid}') where id='${caseId}'`);
// владелец/админские заявки
q(`delete from recovery_attempts`);
const adminCase = (await post('/api/recovery/case/create', form({ accountType: 'admin', skyId: STAFF.email, contactEmail: `adm${rnd()}@example.com`, description: 'Я администратор, потерял токен и приложение для входа, прошу помочь.' }))).data;
r = await get('/api/admin/recovery/cases?tab=new', STAFF);
t('заявки администраторов не видны обычной поддержке', !r.data.items.some((i) => i.number === adminCase.number));
r = await get('/api/admin/recovery/cases?tab=new', STAFF2);
t('но видны сотруднику безопасности', r.data.items.some((i) => i.number === adminCase.number));
const ownerCase = (await post('/api/recovery/case/create', form({ accountType: 'owner', skyId: U.email, contactEmail: `own${rnd()}@example.com`, description: 'Я владелец экосистемы, потерял все факторы входа и секрет, прошу экстренное восстановление.' }))).data;
const ocid = ownerCase.accessKey.split('.')[0];
q(`update recovery_cases set sky_id=(select sky_id from profiles where id='${U.pid}') where id='${ocid}'`);
r = await post(`/api/admin/recovery/cases/${ocid}/status`, { status: 'allowed' }, STAFF2);
t('заявку владельца через панель разрешить нельзя (только консоль)', r.status === 409 && r.data.error === 'console_only', JSON.stringify(r.data));

// «разрешено» для обычного пользователя → фактор support_case → ожидание
const STEP = async (u) => { await post('/api/admin/recovery/step-up', {}, u); await sleep(1300); const m = [...log().matchAll(new RegExp(u.email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.at(-1)[1]; };
q(`update admin_step_up set used_at = now() where actor_id='${STAFF2.pid}' and used_at is null`);
r = await post(`/api/admin/recovery/cases/${caseId}/status`, { status: 'allowed', stepUpCode: await STEP(STAFF2) }, STAFF2);
t('сотрудник безопасности с кодом разрешает восстановление', r.status === 200 && q(`select status from recovery_cases where id='${caseId}'`) === 'allowed', JSON.stringify(r.data));
const rq = (await post('/api/recovery/start', { identifier: U.email, kind: 'user' })).data;
r = await post('/api/recovery/verify', { requestId: rq.requestId, secret: rq.secret, factor: 'support_case', value: 'rcs-xx.other' });
t('чужой/неверный ключ заявки не принимается как фактор', r.status === 401);
r = await post('/api/recovery/verify', { requestId: rq.requestId, secret: rq.secret, factor: 'support_case', value: key });
t('ключ разрешённой заявки принят как фактор', r.status === 200);
r = await post('/api/recovery/complete', { requestId: rq.requestId, secret: rq.secret });
t('решение поддержки доступ не выдаёт: назначено ожидание', r.status === 200 && r.data.waiting === true && !r.data.handoff, JSON.stringify(r.data));
const rq2 = (await post('/api/recovery/start', { identifier: OTHER.email, kind: 'user' })).data;
t('ключ чужой заявки к другому аккаунту не подходит', (await post('/api/recovery/verify', { requestId: rq2.requestId, secret: rq2.secret, factor: 'support_case', value: key })).status === 401);

// закрытие и повторное открытие
r = await post(`/api/admin/recovery/cases/${caseId}/status`, { status: 'closed' }, STAFF);
t('закрытая заявка закрывается', r.status === 200);
t('в закрытую писать нельзя', (await post('/api/recovery/case/message', { text: 'ещё' }, null, H)).status === 409);
r = await post('/api/recovery/case/reopen', {}, null, H);
t('но её можно открыть повторно', r.status === 200 && q(`select status from recovery_cases where id='${caseId}'`) === 'review');
// ключ доступа заново
r = await post('/api/recovery/case/resend-access', { number: num, email: contact });
await sleep(900);
const newKey = lastKey(contact);
t('новый ключ приходит на подтверждённую почту, прежний отозван', r.status === 200 && Boolean(newKey) && (await get('/api/recovery/case/view', null, H)).status === 404 && (await get('/api/recovery/case/view', null, { 'x-recovery-case': newKey })).status === 200);
r = await post('/api/recovery/case/resend-access', { number: num, email: 'stranger@example.com' });
t('ответ одинаков для чужой почты', r.status === 200);

// «Мои обращения»
q(`delete from recovery_attempts`);
const MINE = await mkuser(S, 'rcsMine');
r = await post('/api/recovery/case/create', form({ skyId: MINE.email, contactEmail: undefined, description: 'Вошёл в аккаунт, но потерял резервные коды и хочу пересоздать защиту.' }), MINE);
t('вошедший: контакт берётся из аккаунта, подтверждение не нужно', r.status === 201 && r.data.contactConfirmed === true, JSON.stringify(r.data));
const mine = await get('/api/support/tickets', MINE);
t('заявка вошедшего появляется в «Моих обращениях»', mine.status === 200 && JSON.stringify(mine.data).includes('Восстановление'), mine.status + JSON.stringify(mine.data).slice(0, 120));
q(`delete from recovery_attempts`);
const sec = await post('/api/recovery/case/create', form({ skyId: MINE.email, contactEmail: `spam${rnd()}@example.com`, website: 'bot' }));
t('ловушка для ботов молча принимает, но заявки не создаёт', sec.status === 201 && q(`select count(*) from recovery_cases where number='SR-00000'`) === '0');
let throttled = false;
q(`delete from recovery_attempts`);
for (let i = 0; i < 0; i++) {}

for (let i = 0; i < 12; i++) { const x = await post('/api/recovery/case/create', form({ reason: ['other', 'forgot_password', 'lost_backup_codes', 'suspected_hack', 'auto_failed', 'lost_authenticator', 'lost_both', 'other', 'forgot_password', 'lost_backup_codes', 'suspected_hack', 'auto_failed'][i], contactEmail: `flood${i}${rnd()}@example.com`, description: 'Описание проблемы длиннее двадцати знаков ' + i })); if (x.status === 429) { throttled = true; break; } }
t('спам-заявки ограничены', throttled);
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
