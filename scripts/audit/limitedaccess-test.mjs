// Ограниченный доступ на неподтверждённом устройстве: настройка, ограниченная сессия, подтверждение с доверенного устройства, «доступ утерян».
// API: ADMIN_GATE=off OWNER_USERNAME=ownertest RECOVERY_RATE_MULT=20 DOMAIN=sky.test  (node scripts/audit/limitedaccess-test.mjs <каталог с api.log>)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const require = createRequire(new URL('../../server/', import.meta.url));
const WebSocket = require('ws');
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2, 10);
const dev = () => 'dev' + rnd() + rnd() + rnd();
const log = () => readFileSync(S + '/api.log', 'utf8');
const last = (re) => { const m = [...log().matchAll(re)]; return m.length ? m[m.length - 1][1] : null; };
const codeTo = (email) => last(new RegExp(email.replace(/[.+]/g, '\\$&') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'));
const linkTo = (email, kind) => last(new RegExp(email.replace(/[.+]/g, '\\$&') + '[^]*?' + kind + '#t=([A-Za-z0-9_-]+)', 'g'));
const as = (d) => ({ 'x-sky-device': d });
const api = (p, method, body, tok, d) => call(p, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, tok, d ? as(d) : {});
const q0 = () => q(`delete from recovery_attempts`);
q0();

// Вход по коду почты на устройстве d.
const login = async (email, d) => {
  q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${email}'`);
  await api('/api/auth/email/start', 'POST', { email }, null, d); await sleep(1300);
  const r = await api('/api/auth/email/verify', 'POST', { email, code: codeTo(email) }, null, d);
  return r;
};
const U = await mkuser(S, 'lim'); const skyId = q(`select sky_id from profiles where id='${U.pid}'`);
const A = dev(), B = dev(), C = dev(), D = dev();

let r = await api('/api/skyid/limited', 'GET', undefined, U.tok, A);
t('сводка: выключено, резервной почты нет', r.status === 200 && r.data.enabled === false && r.data.canEnable === false, JSON.stringify(r.data));
r = await api('/api/skyid/limited', 'PUT', { enabled: true }, U.tok, A);
t('включить без подтверждённой резервной почты нельзя', r.status === 409 && r.data.error === 'backup_email_required', JSON.stringify(r.data));
// Привязываем резервную почту настоящими ручками.
const bk = `limbk${rnd()}@example.com`;
q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${U.email}'`);
await api('/api/skyid/recovery/guard-code', 'POST', {}, U.tok); await sleep(1300);
await api('/api/skyid/recovery/backup-email', 'POST', { email: bk, guardCode: codeTo(U.email) }, U.tok); await sleep(1000);
await api('/api/recovery/confirm-email', 'POST', { token: linkTo(bk, 'confirm-email') });
r = await api('/api/skyid/limited', 'PUT', { enabled: true }, U.tok, A);
t('резервная почта есть, но ещё в периоде ожидания — включить нельзя', r.status === 409, JSON.stringify(r.data));
q(`update sky_backup_emails set usable_after = now() - interval '1 minute' where sky_id='${skyId}'`);
r = await api('/api/skyid/limited', 'PUT', { enabled: true }, U.tok, A);
t('с годной резервной почтой настройка включается', r.status === 200 && r.data.enabled === true, JSON.stringify(r.data));
t('текущее устройство стало доверенным', q(`select count(*) from sky_trusted_devices where sky_id='${skyId}'`) === '1');

/* ── вход на неподтверждённом устройстве ── */
const lb = await login(U.email, B);
const tokB = lb.data.accessToken;
t('вход на новом устройстве даёт ограниченную сессию', lb.status === 200 && lb.data.limited === true, JSON.stringify(lb.data).slice(0, 200));
t('вход по коду НЕ сделал устройство доверенным', q(`select count(*) from sky_trusted_devices where sky_id='${skyId}'`) === '1');
const la = await login(U.email, A);
t('вход на доверенном устройстве — полный доступ', la.status === 200 && la.data.limited === false, JSON.stringify(la.data).slice(0, 120));
const tokA = la.data.accessToken;

r = await api('/api/skyid/profiles', 'GET', undefined, tokB, B);
t('ограниченная сессия: чтение разрешено', r.status === 200, r.status);
r = await api('/api/skyid/profiles', 'POST', { name: 'x', username: 'x' + rnd(), acceptLegal: true }, tokB, B);
t('ограниченная сессия: изменение закрыто (403 limited_session)', r.status === 403 && r.data.error === 'limited_session', JSON.stringify(r.data));
r = await api('/api/files/abc', 'GET', undefined, tokB, B);
t('ограниченная сессия: файлы переписки закрыты', r.status === 403 && r.data.error === 'limited_session', r.status);
r = await api('/api/auth/password/change', 'POST', { password: 'x' }, tokB, B);
t('ограниченная сессия: смена пароля закрыта', r.status === 403 && r.data.error === 'limited_session', r.status);
r = await api('/api/skyid/limited', 'PUT', { enabled: false }, tokB, B);
t('ограниченная сессия не может выключить настройку', r.status === 403, r.status);
r = await api('/api/skyid/limited/decide', 'POST', { id: 'x', approve: true }, tokB, B);
t('ограниченная сессия не может подтвердить сама себя', r.status === 403, r.status);
r = await api('/api/skyid/limited/status', 'GET', undefined, tokB, B);
t('статус ограниченной сессии: ждёт, резервная почта доступна', r.status === 200 && r.data.limited === true && r.data.status === 'pending' && r.data.canUseBackupEmail === true, JSON.stringify(r.data));

// Сокет: ни чатов, ни событий.
const wsTry = (tok) => new Promise((res) => {
  const ws = new WebSocket('ws://127.0.0.1:8081', { headers: { origin: process.env.WS_ORIGIN || 'http://localhost:4173' } });
  const ev = []; ws.on('message', (d) => { try { ev.push(JSON.parse(d).type); } catch {} });
  ws.on('open', () => { ws.send(JSON.stringify({ type: 'auth', payload: { token: tok } })); setTimeout(() => ws.send(JSON.stringify({ type: 'ping' })), 400); });
  setTimeout(() => { ws.close(); res(ev); }, 2000);
});
let ev = await wsTry(tokB);
t('сокет ограниченной сессии: «limited», без снимка чатов', ev.includes('limited') && !ev.includes('authorized') && !ev.includes('snapshot-done'), JSON.stringify(ev));
t('сокет ограниченной сессии отвечает на ping', ev.includes('pong'));
ev = await wsTry(tokA);
t('сокет полной сессии работает как раньше', ev.includes('authorized'), JSON.stringify(ev));

/* ── подтверждение с доверенного устройства ── */
r = await api('/api/skyid/limited', 'GET', undefined, tokA, A);
t('доверенное устройство видит ожидающий вход', r.status === 200 && r.data.pending.length === 1 && r.data.enabled, JSON.stringify(r.data));
const apId = r.data.pending[0].id;
t('уведомление в «Уведомлениях» создано', Number(q(`select count(*) from gift_notifications where user_id='${U.pid}' and ref_id='${apId}'`)) >= 1);
t('письмо на основную почту ушло', log().includes('Подтвердите вход с нового устройства') || log().includes('Confirm sign-in from a new device'));
r = await api('/api/skyid/limited/decide', 'POST', { id: 'нет такого', approve: true }, tokA, A);
t('чужой/несуществующий запрос — 404', r.status === 404, r.status);
const other = await mkuser(S, 'limo');
r = await api('/api/skyid/limited/decide', 'POST', { id: apId, approve: true }, other.tok, A);
t('другой аккаунт подтвердить не может', r.status === 404, r.status);
r = await api('/api/skyid/limited/decide', 'POST', { id: apId, approve: false }, tokA, A);
t('отказ завершает чужую сессию', r.status === 200 && r.data.status === 'denied', JSON.stringify(r.data));
r = await api('/api/skyid/profiles', 'GET', undefined, tokB, B);
t('после отказа сессия мертва', r.status === 401, r.status);
r = await api('/api/skyid/limited/decide', 'POST', { id: apId, approve: true }, tokA, A);
t('повторное решение — 409', r.status === 409, r.status);

const lb2 = await login(U.email, B); const tokB2 = lb2.data.accessToken;
t('новый вход на B снова ограничен', lb2.data.limited === true);
r = await api('/api/skyid/limited', 'GET', undefined, tokA, A);
r = await api('/api/skyid/limited/decide', 'POST', { id: r.data.pending[0].id, approve: true }, tokA, A);
t('подтверждение с доверенного устройства', r.status === 200 && r.data.status === 'approved', JSON.stringify(r.data));
r = await api('/api/skyid/limited/status', 'GET', undefined, tokB2, B);
t('ограниченная сессия стала полной', r.status === 200 && r.data.limited === false && r.data.status === 'approved', JSON.stringify(r.data));
r = await api('/api/skyid/profiles', 'POST', { name: 'ok', username: 'ok' + rnd(), acceptLegal: true }, tokB2, B);
t('после подтверждения изменения разрешены (не 403 limited_session)', r.status !== 403 || r.data.error !== 'limited_session', JSON.stringify(r.data));
t('устройство B стало доверенным', q(`select count(*) from sky_trusted_devices where sky_id='${skyId}'`) === '2');
const lb3 = await login(U.email, B);
t('следующий вход на B уже без ограничения', lb3.data.limited === false);

/* ── «Доступ утерян» ── */
const lc = await login(U.email, C); const tokC = lc.data.accessToken;
t('устройство C ограничено', lc.data.limited === true);
r = await api('/api/skyid/limited/lost/start', 'POST', {}, tokA, A);
t('полная сессия не использует «доступ утерян»', r.status === 409 && r.data.error === 'not_limited', JSON.stringify(r.data));
q0();
r = await api('/api/skyid/limited/lost/start', 'POST', {}, tokC, C);
t('код уходит на резервную почту (адрес замаскирован)', r.status === 200 && r.data.sentTo?.includes('***'), JSON.stringify(r.data));
await sleep(1300);
const codeBk = codeTo(bk);
t('код получен на резервную почту', /^\d{6}$/.test(codeBk ?? ''));
r = await api('/api/skyid/limited/lost/finish', 'POST', { code: '000000' }, tokC, C);
t('неверный код отклонён', r.status === 400 && r.data.error === 'invalid_code', JSON.stringify(r.data));
r = await api('/api/skyid/limited/status', 'GET', undefined, tokC, C);
t('после неверного кода сессия остаётся ограниченной', r.data.limited === true);
r = await api('/api/skyid/limited/lost/finish', 'POST', { code: codeBk }, tokC, C);
t('верный код снимает ограничение', r.status === 200 && r.data.ok, JSON.stringify(r.data));
r = await api('/api/skyid/limited/status', 'GET', undefined, tokC, C);
t('сессия C полная, запрос закрыт как approved через backup_email', r.data.limited === false && q(`select decided_via from device_approvals where sid=(select id from device_approvals order by created_at desc limit 1 offset 0) limit 1`) !== undefined);
t('решение записано: backup_email', Number(q(`select count(*) from device_approvals where sky_id='${skyId}' and decided_via='backup_email'`)) === 1);
t('устройство C стало доверенным', q(`select count(*) from sky_trusted_devices where sky_id='${skyId}'`) === '3');

// перебор «утерян»
const ld = await login(U.email, D); const tokD = ld.data.accessToken;
q0();
let n429 = 0; for (let i = 0; i < 5; i++) { const x = await api('/api/skyid/limited/lost/start', 'POST', {}, tokD, D); if (x.status === 429) n429++; await sleep(150); }
t('частые запросы кода «утерян» ограничены', n429 >= 1, n429);
q0();
for (let i = 0; i < 7; i++) r = await api('/api/skyid/limited/lost/finish', 'POST', { code: '111111' }, tokD, D);
t('перебор кода блокируется', r.status === 429, r.status);

/* ── без резервной почты «утерян» недоступен; выключение ── */
q(`delete from sky_backup_emails where sky_id='${skyId}'`); q0();
r = await api('/api/skyid/limited/lost/start', 'POST', {}, tokD, D);
t('без резервной почты «доступ утерян» недоступен', r.status === 409 && r.data.error === 'no_backup_email', JSON.stringify(r.data));
r = await api('/api/skyid/limited', 'PUT', { enabled: false }, tokA, A);
t('с доверенного устройства настройку можно выключить', r.status === 200 && r.data.enabled === false, JSON.stringify(r.data));
const le = await login(U.email, dev());
t('после выключения новое устройство ограничено не бывает', le.data.limited === false);
t('при выключенной настройке устройство, как раньше, становится доверенным по коду', Number(q(`select count(*) from sky_trusted_devices where sky_id='${skyId}'`)) === 4);

console.log(`\nитого: ${ok} ok, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
