// Sky Storage: каждый вход в управление подтверждает владелец (режим every_login). Запуск: . env.sh; node scripts/audit/storage-everylogin-test.mjs <каталог с api.log>
// Проверяется ядро проверки подключения напрямую (skystorageaccess.evaluateConnection) на реальной базе.
import { execSync } from 'node:child_process';
import { mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const X = await import('../../server/skystorageaccess.mjs');
const { loadState } = await import('../../server/skystoragestate.mjs');
const setMode = async (mode, extra = {}) => { q(`update storage_state set settings = settings || '${JSON.stringify({ approvalScope: mode, approvalTimeoutMin: 10, approvalValidMin: 480, ...extra })}'::jsonb`); await loadState(true); };
const req = (dev, ua = 'TestUA/1') => ({ headers: { 'x-sky-device': dev, 'user-agent': ua, 'x-real-ip': '10.1.2.3' }, socket: { remoteAddress: '10.1.2.3' } });
const U = await mkuser(S, 'elOwn');
q(`delete from storage_connections`);
q(`update storage_state set emergency='{"active":false}'::jsonb, restrictions='[]'::jsonb`);
const DEV = 'device-aaaaaaaaaaaaaaaaaaaa';

await setMode('every_login');
let r = await X.evaluateConnection(U.pid, req(DEV), 'sess-1');
t('every_login: первый вход (даже владельца) ждёт подтверждения, начальной «загрузки» нет', r.allowed === false && r.status === 'pending' && !r.bootstrap, JSON.stringify(r));
const row1 = q(`select id||'|'||status||'|'||(mailed_at is not null) from storage_connections where profile_id='${U.pid}'`).split('|');
t('письмо владельцу уходит сразу, как при входе по SSH', row1[1] === 'pending' && row1[2] === 'true', row1.join('|'));
r = await X.evaluateConnection(U.pid, req(DEV), 'sess-1');
t('повторное обращение не плодит запросов', r.status === 'pending' && q(`select count(*) from storage_connections where profile_id='${U.pid}'`) === '1');
const d1 = await X.decideInPanel(U.pid, row1[0], true, {});
t('владелец подтвердил', d1.ok === true);
r = await X.evaluateConnection(U.pid, req(DEV), 'sess-1');
t('та же сессия после подтверждения допущена', r.allowed === true);

r = await X.evaluateConnection(U.pid, req(DEV), 'sess-2');
t('НОВАЯ сессия на том же устройстве снова ждёт подтверждения', r.allowed === false && r.status === 'pending', JSON.stringify(r));
t('прежнее подтверждение закрыто (superseded), живое — только одно', q(`select count(*) from storage_connections where profile_id='${U.pid}' and status='approved'`) === '0' && q(`select count(*) from storage_connections where profile_id='${U.pid}' and decided_via='superseded'`) === '1');
const row2 = q(`select id from storage_connections where profile_id='${U.pid}' and status='pending'`);
t('устройство знакомое — «нового устройства» среди причин нет (сессию при отказе не отзываем)', !q(`select risk_reasons::text from storage_connections where id='${row2}'`).includes('новое устройство'));
t('первая попытка с неизвестного устройства помечена «новое устройство»', q(`select risk_reasons::text from storage_connections where id='${row1[0]}'`).includes('новое устройство'));
t('сессия новой попытки запомнена', q(`select session_id from storage_connections where id='${row2}'`) === 'sess-2');
r = await X.evaluateConnection(U.pid, req(DEV), 'sess-3');
t('параллельная сессия присоединяется к тому же запросу, дубликата нет', r.status === 'pending' && q(`select count(*) from storage_connections where profile_id='${U.pid}' and status='pending'`) === '1' && q(`select session_id from storage_connections where id='${row2}'`) === 'sess-3');
await X.decideInPanel(U.pid, row2, true, {});
r = await X.evaluateConnection(U.pid, req(DEV), 'sess-3'); t('подтверждённая сессия допущена', r.allowed === true);
r = await X.evaluateConnection(U.pid, req(DEV), 'sess-2'); t('прежняя сессия без подтверждения — нет доступа', r.allowed === false);

// срок действия подтверждения
q(`update storage_connections set decided_at = now() - interval '9 hours' where profile_id='${U.pid}' and status='approved'`);
r = await X.evaluateConnection(U.pid, req(DEV), 'sess-3');
t('подтверждение старше срока (8 ч) недействительно — нужен новый запрос', r.allowed === false && r.status === 'pending', JSON.stringify(r));
const row4 = q(`select id from storage_connections where profile_id='${U.pid}' and status='pending'`);
// отказ
const dn = await X.decideInPanel(U.pid, row4, false, {});
t('отказ владельца записан', dn.ok === true && q(`select status from storage_connections where id='${row4}'`) === 'denied');
r = await X.evaluateConnection(U.pid, req(DEV), 'sess-3');
t('после отказа вход снова запрашивается, а не открывается', r.allowed === false);

// просрочка
const row5 = q(`select id from storage_connections where profile_id='${U.pid}' and status='pending'`);
q(`update storage_connections set expires_at = now() - interval '1 minute' where id='${row5}'`);
const sw = await X.sweepConnections();
t('молчание владельца = отказ: просроченный запрос закрыт', sw.expired >= 1 && q(`select status from storage_connections where id='${row5}'`) === 'expired');

// режим «только новое устройство»: подтверждение не привязано к сессии
q(`delete from storage_connections`);
await setMode('admin');
r = await X.evaluateConnection(U.pid, req(DEV), 'sess-a');
const ra = q(`select id from storage_connections where profile_id='${U.pid}'`);
await X.decideInPanel(U.pid, ra, true, {});
r = await X.evaluateConnection(U.pid, req(DEV), 'sess-b');
t('admin: подтверждённое устройство допущено и с новой сессией (прежнее поведение)', r.allowed === true);

// off
q(`delete from storage_connections`);
await setMode('off');
r = await X.evaluateConnection(U.pid, req(DEV), 'sess-x');
t('off: подтверждение не требуется', r.allowed === true && r.policy === 'off');
await setMode('every_login');
console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
