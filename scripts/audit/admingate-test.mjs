// Двухэтапный вход в админку (server/admingate.mjs): ссылка на почту + код аутентификатора + «Это не я».
// Нужен API с ADMIN_GATE=on и OWNER_USERNAME=gateowner:
//   bash restart.sh ADMIN_GATE=on OWNER_USERNAME=gateowner ; (. env.sh; node scripts/audit/admingate-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { generateSecret, currentTotp } = await import('../../server/totp.mjs');
const { encryptSecret } = await import('../../server/crypto.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };

const withTotp = (u) => { const secret = generateSecret(); q(`update sky_ids set two_factor_enabled=true, two_factor_secret='${encryptSecret(secret)}' where id=(select sky_id from profiles where id='${u.pid}')`); return secret; };
const linkFromLog = (email) => { const log = readFileSync(S + '/api.log', 'utf8'); const m = [...log.matchAll(new RegExp(`admin-verify\\?t=([A-Za-z0-9_-]+)`, 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const { sessionStore, connectRedis, closeRedis } = await import('../../server/sessions.mjs');
await connectRedis();
const { issueTokens } = await import('../../server/routes/auth.mjs');
// Вторая сессия того же человека (другое устройство): создаём напрямую, письмо с кодом входа не нужно.
const newSession = async (u) => {
  const skyId = q(`select sky_id from profiles where id='${u.pid}'`);
  const id = 'sess-' + Math.random().toString(36).slice(2);
  await sessionStore.put({ id, userId: skyId, profileId: u.pid }, 3600);
  return issueTokens(skyId, id, u.pid).body.accessToken;
};

const adm = await mkuser(S, 'gtAdm'); const own = await mkuser(S, 'gtOwn', 'gateowner' + Date.now().toString(36).slice(-0));
// владелец: ник задаётся в окружении сервера (gateowner) — если такой уже занят, берём существующего нельзя, поэтому проверяем наличие
q(`update profiles set username='gateowner' where id='${own.pid}' and not exists (select 1 from profiles where lower(username)='gateowner')`);
const ownerOk = q(`select username from profiles where id='${own.pid}'`) === 'gateowner';
const oth = await mkuser(S, 'gtOth');
q(`update profiles set is_admin=true, admin_role='super_admin' where id='${adm.pid}'`);
const admSecret = withTotp(adm); const ownSecret = withTotp(own);

let r = await call('/api/admin/content/queue', {}, adm.tok);
t('шлюз закрыт: права администратора не работают', r.status === 403, JSON.stringify(r.data));
r = await call('/api/admin/gate', {}, adm.tok);
t('статус: админ, не открыт, пройти можно', r.data.admin && !r.data.open && r.data.canPass, JSON.stringify(r.data));
r = await call('/api/admin/gate', {}, oth.tok);
t('не администратор: admin=false', r.data.admin === false);
r = await call('/api/admin/gate/request', { method: 'POST' }, oth.tok);
t('не администратору ссылка не высылается', r.status === 403);
t('и письмо ему не уходило', !readFileSync(S + '/api.log', 'utf8').includes(oth.email + ' | admin') );

r = await call('/api/admin/gate/request', { method: 'POST', headers: { origin: 'http://localhost:4173' } }, adm.tok);
t('ссылка запрошена', r.status === 200 && r.data.ok, JSON.stringify(r.data));
await new Promise((x) => setTimeout(x, 800));
const token = linkFromLog(adm.email);
t('ссылка есть в письме', Boolean(token));
r = await call(`/api/admin/gate/link?t=${token}`);
t('страница ссылки: время и устройство', r.status === 200 && r.data.requestedAt && 'device' in r.data, JSON.stringify(r.data));
r = await call(`/api/admin/gate/link?t=${'x'.repeat(40)}`);
t('чужая ссылка недействительна', r.status === 404);

r = await call('/api/admin/gate/confirm', { method: 'POST', body: JSON.stringify({ t: token, code: '000000' }) });
t('неверный код отклонён, попытки считаются', r.status === 400 && r.data.error === 'bad_code' && r.data.left === 2, JSON.stringify(r.data));
r = await call('/api/admin/content/queue', {}, adm.tok);
t('после неверного кода всё ещё закрыто', r.status === 403);
r = await call('/api/admin/gate/confirm', { method: 'POST', body: JSON.stringify({ t: token, code: currentTotp(admSecret) }) });
t('верный код открывает шлюз', r.status === 200 && r.data.ok, JSON.stringify(r.data));
await new Promise((x) => setTimeout(x, 6000));  // память шлюза живёт секунды
r = await call('/api/admin/content/queue', {}, adm.tok);
t('права работают', r.status === 200, JSON.stringify(r.data));
r = await call('/api/admin/gate/confirm', { method: 'POST', body: JSON.stringify({ t: token, code: currentTotp(admSecret) }) });
t('ссылка одноразовая', r.status === 404);

// другая сессия того же человека — снова закрыто
const tok2 = await newSession(adm);
r = await call('/api/admin/content/queue', {}, tok2);
t('шлюз привязан к сессии: новая сессия закрыта', r.status === 403, JSON.stringify(r.data));

// три неверных кода убивают ссылку
await call('/api/admin/gate/request', { method: 'POST', headers: { origin: 'http://localhost:4173' } }, tok2);
await new Promise((x) => setTimeout(x, 800));
const tk2 = linkFromLog(adm.email);
for (let i = 0; i < 3; i++) await call('/api/admin/gate/confirm', { method: 'POST', body: JSON.stringify({ t: tk2, code: '111111' }) });
r = await call('/api/admin/gate/confirm', { method: 'POST', body: JSON.stringify({ t: tk2, code: currentTotp(admSecret) }) });
t('после трёх неверных ссылка мертва даже с верным кодом', r.status === 404, JSON.stringify(r.data));

// «Это не я»: обычный админ — аварийные работы можно, выключить сервер нельзя
await call('/api/admin/gate/request', { method: 'POST', headers: { origin: 'http://localhost:4173' } }, tok2);
await new Promise((x) => setTimeout(x, 800));
const tk3 = linkFromLog(adm.email);
r = await call('/api/admin/gate/panic', { method: 'POST', body: JSON.stringify({ t: tk3, action: 'shutdown' }) });
t('администратор не может выключить сервер', r.status === 403 && r.data.error === 'owner_only', JSON.stringify(r.data));
r = await call('/api/admin/gate/panic', { method: 'POST', body: JSON.stringify({ t: tk3, action: 'lockdown' }) });
t('аварийные работы включены', r.status === 200 && q('select active from admin_lockdown') === 't', JSON.stringify(r.data));
r = await call('/api/skyid/profiles', {}, tok2);
t('сессии того, кто нажал «Это не я», закрыты', r.status === 401, String(r.status));
q(`update admin_lockdown set active=false`);

// снятому с админки ничего не приходит
const adm2 = await mkuser(S, 'gtAdm2'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${adm2.pid}'`); withTotp(adm2);
await call('/api/admin/gate/request', { method: 'POST', headers: { origin: 'http://localhost:4173' } }, adm2.tok);
await new Promise((x) => setTimeout(x, 800));
const tk4 = linkFromLog(adm2.email);
q(`update profiles set is_admin=false where id='${adm2.pid}'`);
r = await call(`/api/admin/gate/link?t=${tk4}`);
t('снятому с админки старая ссылка не работает', r.status === 404);
r = await call('/api/admin/gate/request', { method: 'POST', headers: { origin: 'http://localhost:4173' } }, adm2.tok);
t('и новую ссылку ему не высылают', r.status === 403);

if (ownerOk) {
  const ot = own.tok;
  await call('/api/admin/gate/request', { method: 'POST', headers: { origin: 'http://localhost:4173' } }, ot);
  await new Promise((x) => setTimeout(x, 800));
  const tk5 = linkFromLog(own.email);
  r = await call('/api/admin/gate/panic', { method: 'POST', body: JSON.stringify({ t: tk5, action: 'shutdown' }) });
  t('владелец выключает сервер', r.status === 200 && q('select active from platform_shutdown') === 't', JSON.stringify(r.data));
  r = await call('/api/platform/status');
  q(`update platform_shutdown set active=false`); q(`update admin_lockdown set active=false`);
} else console.log('пропуск проверок владельца: ник gateowner занят (перезапустите API с OWNER_USERNAME=gateowner на чистой базе)');
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
await closeRedis().catch(() => {});
process.exit(bad ? 1 : 0);
