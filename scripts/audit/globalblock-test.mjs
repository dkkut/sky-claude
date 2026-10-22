// Глобальная блокировка (server/globalblock.mjs): связь по устройству, защита владельца, обжалование, снятие.
// API: OWNER_USERNAME=gbowner ADMIN_GATE=off. (node scripts/audit/globalblock-test.mjs <каталог с api.log>; DATABASE_URL — адрес базы)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call } from './lib.mjs';
const S = process.argv[2];
const DB = process.env.DATABASE_URL ?? 'postgres://sky:sky@127.0.0.1/sky';
const q = (s) => execSync(`psql "${DB}" -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ipn = 0;
const hdr = (dev, ip) => ({ headers: { 'x-real-ip': ip ?? `198.51.100.${(++ipn % 200) + 1}`, ...(dev ? { 'x-sky-device': dev } : {}), 'user-agent': 'gb-test' } });
const post = (p, b, tok, dev, ip) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}), ...hdr(dev, ip) }, tok);
const get = (p, tok) => call(p, {}, tok);
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const login = async (email, dev) => {
  q(`delete from verification_codes where destination='${email}'`);
  await post('/api/auth/email/start', { email }, null, dev); await sleep(1300);
  return post('/api/auth/email/verify', { email, code: codeOf(email) }, null, dev);
};
const mk = async (tag, dev, username) => {
  const email = `${tag}${Date.now()}@example.com`;
  let r = await login(email, dev); let tok = r.data.accessToken;
  const uname = username ?? tag + Date.now().toString(36);
  r = await post('/api/skyid/profiles', { name: tag, username: uname, acceptLegal: true }, tok, dev);
  if (!r.data.profile) { console.log('mk fail', tag, r.status, JSON.stringify(r.data).slice(0, 200)); process.exit(2); }
  const pid = r.data.profile.id;
  r = await post(`/api/skyid/profiles/${pid}/select`, {}, tok, dev); tok = r.data.accessToken ?? tok;
  return { email, tok, pid, uname, sky: q(`select sky_id from profiles where id='${pid}'`) };
};
const step = async (u) => { q(`update admin_step_up set used_at = now() where actor_id='${u.pid}' and used_at is null`); await post('/api/admin/global-blocks/step-up', {}, u.tok); await sleep(1300); return codeOf(u.email); };

q("update profiles set username = 'old' || substr(id, 5, 8) where username = 'gbowner'");
const DEV1 = 'device-shared-aaaaaaaaaaaa', DEV2 = 'device-other-bbbbbbbbbbbbb';
const OWN = await mk('gbo', DEV2); q(`update profiles set username='gbowner' where id='${OWN.pid}'`); OWN.uname = 'gbowner';
const A = await mk('gba', DEV1), B = await mk('gbb', DEV1), C = await mk('gbc', DEV2);
const M = await mk('gbm', DEV2);
q(`update profiles set is_admin = true, admin_role = 'global_block_admin' where id = '${M.pid}'`);
const X = await mk('gbx', DEV2);      // обычный человек без прав

t('без права список недоступен', (await get('/api/admin/global-blocks', X.tok)).status === 403);
t('роль global_block_admin видит список', (await get('/api/admin/global-blocks', M.tok)).status === 200);

let r = await post('/api/admin/global-blocks', { target: '@' + A.uname, reason: 'Мошенничество', confirm: true }, OWN.tok);
t('без кода подтверждения — отказ', r.status === 400 && r.data.error === 'step_up_required', JSON.stringify(r.data));
r = await post('/api/admin/global-blocks', { target: '@' + A.uname, reason: 'x', confirm: true, code: '000000' }, OWN.tok);
t('короткая причина — отказ', r.data.error === 'reason_required');
r = await post('/api/admin/global-blocks', { target: '@' + OWN.uname, reason: 'Проверка защиты', confirm: true, code: await step(OWN) }, OWN.tok);
t('владельца заблокировать нельзя', r.data.error === 'owner_protected', JSON.stringify(r.data));
r = await post('/api/admin/global-blocks', { target: '@' + A.uname, reason: 'Мошенничество с оплатой', publicReason: 'Нарушение правил сервиса', confirm: true, code: await step(OWN) }, OWN.tok);
t('блокировка создана', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
const G = r.data.groupId; const accs = (r.data.accounts ?? []).map((a) => a.skyId);
t('в группе A и B (общее устройство)', accs.includes(A.sky) && accs.includes(B.sky), accs.join());
t('C (другое устройство) не затронут', !accs.includes(C.sky));
t('владелец и администратор не в группе', !accs.includes(OWN.sky) && !accs.includes(M.sky));

let x = await get('/api/wallet', A.tok);
t('старая сессия A закрыта (сессии отозваны: 401)', x.status === 401 || (x.status === 403 && x.data.global === true), `${x.status} ${JSON.stringify(x.data).slice(0, 160)}`);
r = await login(A.email, DEV1);
t('вход A отклонён: 423 globally_blocked', r.status === 423 && r.data.error === 'globally_blocked' && r.data.reason === 'Нарушение правил сервиса' && !!r.data.appealToken, `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
const tokA = r.data.appealToken;
r = await login(B.email, DEV1);
t('вход B (то же устройство) отклонён', r.status === 423 && r.data.error === 'globally_blocked', `${r.status}`);
const tokB = r.data.appealToken;
r = await login(C.email, DEV2);
t('вход C (другое устройство) проходит', r.status === 200 && !!r.data.accessToken, `${r.status}`);
const E = `gbe${Date.now()}@example.com`;
r = await login(E, DEV1);
t('новый Sky ID с блокированного устройства сразу блокируется', r.status === 423, `${r.status}`);
t('…и входит в группу', q(`select count(*) from sky_ids where blocked_reason = 'global:${G}'`) >= 3);
r = await login(OWN.email, DEV1);
t('владелец с блокированного устройства входит (неприкосновенен)', r.status === 200, `${r.status}`);
r = await login(M.email, DEV1);
t('администратор «по связи» не блокируется', r.status === 200, `${r.status}`);

// обжалование
r = await post('/api/blocked/status', { token: 'мусор' });
t('плохой токен статуса — bad_token', r.data.error === 'bad_token');
r = await post('/api/blocked/status', { token: tokA });
t('статус: блокировка активна, причина для человека', r.data.block?.active === true && r.data.block.reason === 'Нарушение правил сервиса' && r.data.appeal === null, JSON.stringify(r.data));
r = await post('/api/blocked/appeal', { token: tokA, message: 'коротко' });
t('короткая апелляция — отказ', r.data.error === 'message_too_short');
r = await post('/api/blocked/appeal', { token: tokA, message: 'Я не нарушал правила, аккаунтом пользовалась семья, прошу проверить.' });
t('апелляция принята', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
r = await post('/api/blocked/appeal', { token: tokA, message: 'Повторная попытка, прошу проверить ещё раз внимательно.' });
t('вторая открытая апелляция — appeal_pending', r.data.error === 'appeal_pending');
await post('/api/blocked/appeal', { token: tokB, message: 'Я — вторая учётная запись на том же устройстве, к нарушению не причастна.' });

r = await get('/api/admin/global-blocks/appeals?status=pending', M.tok);
const apA = r.data.appeals?.find((a) => a.account.includes(A.uname)); const apB = r.data.appeals?.find((a) => a.account.includes(B.uname));
t('очередь апелляций видна администратору', r.status === 200 && !!apA && !!apB, JSON.stringify(r.data).slice(0, 200));
r = await post(`/api/admin/global-blocks/appeals/${apA.id}/decide`, { decision: 'accept', reason: 'Проверили, нарушения нет', code: '000000' }, M.tok);
t('решение без настоящего кода — отказ', r.status !== 200);
r = await post(`/api/admin/global-blocks/appeals/${apA.id}/decide`, { decision: 'accept', reason: 'Проверили, нарушения нет', code: await step(M) }, M.tok);
t('апелляция A принята', r.status === 200, JSON.stringify(r.data));
r = await login(A.email, DEV1);
t('A снова входит с того же устройства (исключение)', r.status === 200, `${r.status} ${JSON.stringify(r.data).slice(0, 100)}`);
r = await login(B.email, DEV1);
t('B по-прежнему заблокирован', r.status === 423);
r = await post(`/api/admin/global-blocks/appeals/${apB.id}/decide`, { decision: 'reject', reason: 'Связь с нарушителем подтверждена', code: await step(M) }, M.tok);
t('апелляция B отклонена', r.status === 200);
r = await post('/api/blocked/status', { token: tokB });
t('статус B: апелляция отклонена с ответом', r.data.appeal?.status === 'rejected' && r.data.appeal.decision.includes('подтверждена'), JSON.stringify(r.data).slice(0, 200));

// администратор, создавший блокировку, не решает апелляции по ней
q(`update profiles set admin_role = 'global_block_admin', is_admin = true where id = '${M.pid}'`);
r = await post('/api/admin/global-blocks', { target: '@' + C.uname, reason: 'Проверка самого себя', confirm: true, scope: { devices: false, contacts: false }, code: await step(M) }, M.tok);
t('M создаёт блокировку C', r.status === 200, JSON.stringify(r.data));
const G2 = r.data.groupId;
r = await login(C.email, DEV2); const tokC = r.data.appealToken;
await post('/api/blocked/appeal', { token: tokC, message: 'Прошу снять блокировку: я не нарушал правила сервиса.' });
const apC = (await get('/api/admin/global-blocks/appeals?status=pending', M.tok)).data.appeals.find((a) => a.account.includes(C.uname));
r = await post(`/api/admin/global-blocks/appeals/${apC.id}/decide`, { decision: 'accept', reason: 'Сам снимаю', code: await step(M) }, M.tok);
t('кто блокировал, не решает апелляцию (self_review)', r.data.error === 'self_review', JSON.stringify(r.data));
r = await post(`/api/admin/global-blocks/${G2}/revoke`, { reason: 'Ошибочная блокировка', code: await step(OWN) }, OWN.tok);
t('владелец снимает блокировку C', r.status === 200);

// снятие группы
r = await get(`/api/admin/global-blocks/${G}`, OWN.tok);
t('карточка группы: идентификаторы замаскированы, без сырых значений', r.status === 200 && r.data.identifiers.every((i) => !i.label.includes(A.email) && !i.label.includes(DEV1)), JSON.stringify(r.data).slice(0, 200));
r = await post(`/api/admin/global-blocks/${G}/revoke`, { reason: 'Проверка снятия', code: await step(OWN) }, OWN.tok);
t('группа снята владельцем', r.status === 200, JSON.stringify(r.data));
r = await login(B.email, DEV1);
t('после снятия B входит', r.status === 200, `${r.status}`);
r = await login(E, DEV1);
t('после снятия E входит', r.status === 200, `${r.status}`);
t('в базе нет активных блокировок группы', q(`select count(*) from global_blocks where group_id = '${G}' and revoked_at is null`) === '0');
t('в базе нет сырых устройств/адресов/почт в global_blocks', q(`select count(*) from global_blocks where value_hash like '%@%' or value_hash like '%${DEV1}%'`) === '0');
t('журнал администрации ведётся', Number(q(`select count(*) from admin_log where type like 'global_block%'`)) >= 5, q(`select count(*) from admin_log where type like 'global_block%'`));

console.log(`\n${ok} ok, ${bad} fail`);
process.exit(bad ? 1 : 0);
