/**
 * Доступ к ЧУЖИМ данным по угаданному идентификатору (IDOR/BOLA), аудит 2026-11.
 * Два обычных пользователя: A владеет ресурсами, B пытается ими воспользоваться. Всё — прямые запросы к API.
 * Нужны API на :8080 и psql к его базе. Запуск: node scripts/audit/idor-test.mjs <scratchpad>
 */
import { execFileSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2] ?? '.';
const sql = (q) => execFileSync('psql', [process.env.DATABASE_URL, '-tAc', q], { encoding: 'utf8' }).trim();
let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) ok++; else { bad++; console.log('FAIL', n, i); } };
const denied = (r) => r.status === 403 || r.status === 404 || r.status === 401;

const A = await mkuser(S, 'IdorA'), B = await mkuser(S, 'IdorB');
const sid = (u) => { const t = u.tok.split('.')[1]; return JSON.parse(Buffer.from(t, 'base64url').toString()).sid; };

/* ── Профили ── */
let r = await call(`/api/skyid/profiles/${A.pid}`, { method: 'PATCH', body: JSON.stringify({ name: 'Взломан' }) }, B.tok);
check('PATCH чужого профиля отклонён', denied(r), `${r.status} ${r.text.slice(0, 80)}`);
check('имя чужого профиля не изменилось', sql(`select name from profiles where id='${A.pid}'`) !== 'Взломан');
r = await call(`/api/skyid/profiles/${A.pid}/select`, { method: 'POST', body: '{}' }, B.tok);
check('выбор чужого профиля отклонён', denied(r), String(r.status));
r = await call(`/api/skyid/profiles/${A.pid}`, { method: 'DELETE' }, B.tok);
check('удаление чужого профиля невозможно', denied(r) || r.status === 405, String(r.status));
check('профиль A на месте', Number(sql(`select count(*) from profiles where id='${A.pid}' and deleted_at is null`)) === 1);

/* ── Сессии устройств ── */
const sA = sid(A);
r = await call(`/api/auth/devices/${sA}/revoke`, { method: 'POST', body: '{}' }, B.tok);
check('завершить чужую сессию нельзя (404 как для несуществующей)', r.status === 404, String(r.status));
const ghost = await call(`/api/auth/devices/zzzzzzzzzzzz-0000/revoke`, { method: 'POST', body: '{}' }, B.tok);
check('ответ на чужую и несуществующую сессию одинаков', ghost.status === r.status && JSON.stringify(ghost.data) === JSON.stringify(r.data));
r = await call('/api/auth/session', {}, A.tok);
check('сессия A жива', r.status === 200, String(r.status));
r = await call('/api/auth/devices', {}, B.tok);
check('список устройств B не содержит сессию A', r.status === 200 && !JSON.stringify(r.data).includes(sA));

/* ── Поддержка ── */
r = await call('/api/support/tickets', { method: 'POST', body: JSON.stringify({ subject: 'секрет A', body: 'приватный текст обращения A' }) }, A.tok);
const tid = r.data?.ticket?.id ?? r.data?.id;
check('тикет A создан', Boolean(tid), JSON.stringify(r.data).slice(0, 100));
r = await call(`/api/support/ticket/${tid}`, {}, B.tok);
check('чтение чужого тикета отклонено', denied(r) && !r.text.includes('приватный'), `${r.status} ${r.text.slice(0, 60)}`);
r = await call(`/api/support/ticket/${tid}/reply`, { method: 'POST', body: JSON.stringify({ body: 'вторжение' }) }, B.tok);
check('ответ в чужой тикет отклонён', denied(r) || r.status === 400, String(r.status));
r = await call(`/api/support/ticket/${tid}/status`, { method: 'POST', body: JSON.stringify({ status: 'closed' }) }, B.tok);
check('смена статуса чужого тикета отклонена', denied(r) || r.status === 400, String(r.status));
r = await call(`/api/support/ticket/${tid}/assign`, { method: 'POST', body: JSON.stringify({ assigneeId: B.pid }) }, B.tok);
check('назначение на себя чужого тикета отклонено', denied(r) || r.status === 400, String(r.status));
check('в тикете A нет сообщений B', Number(sql(`select count(*) from support_messages where ticket_id='${tid}' and author_id='${B.pid}'`)) === 0);
r = await call('/api/support/tickets', {}, B.tok);
check('список тикетов B не содержит тикет A', !JSON.stringify(r.data).includes(tid));
r = await call(`/api/support/ticket/${tid}`, {}, A.tok);
check('сам A тикет читает', r.status === 200);

/* ── Кошелёк: владелец берётся из токена, не из тела ── */
sql(`insert into wallet_accounts(user_id,balance) values('${A.pid}',1000) on conflict (user_id) do update set balance=1000`);
sql(`insert into wallet_accounts(user_id,balance) values('${B.pid}',1000) on conflict (user_id) do update set balance=1000`);
r = await call('/api/wallet/spend', { method: 'POST', body: JSON.stringify({ amount: 100, type: 'market', userId: A.pid, profileId: A.pid, user_id: A.pid }) }, B.tok);
const bal = (p) => Number(sql(`select balance from wallet_accounts where user_id='${p}'`));
check('списание с подменой userId бьёт только по B', bal(A.pid) === 1000 && bal(B.pid) === 900, `A=${bal(A.pid)} B=${bal(B.pid)}`);
r = await call('/api/wallet/balance', {}, B.tok);
check('кошелёк B показывает баланс B', r.data?.balance === 900, JSON.stringify(r.data).slice(0, 80));
r = await call(`/api/wallet/balance?userId=${A.pid}`, {}, B.tok);
check('параметр userId в запросе кошелька игнорируется', r.data?.balance === 900);

/* ── Возможность читать через подмену заголовков профиля ── */
r = await call('/api/wallet/balance', {}, B.tok, { 'x-profile-id': A.pid, 'x-user-id': A.pid });
check('заголовки подмены профиля игнорируются', r.data?.balance === 900);

console.log(`${ok} ok, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
