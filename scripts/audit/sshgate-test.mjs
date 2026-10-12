// Подтверждение входа по SSH владельцем (server/sshgate.mjs + scripts/ssh-gate.sh).
// Нужен API с SSH_GATE_SECRET (от 24 знаков), OWNER_USERNAME=sshowner и DOMAIN:
//   bash restart.sh SSH_GATE_SECRET=sshgate-secret-0123456789abcdef OWNER_USERNAME=sshowner DOMAIN=localhost:4173
//   (. env.sh; SSH_GATE_SECRET=sshgate-secret-0123456789abcdef node scripts/audit/sshgate-test.mjs <каталог с api.log>)
import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const KEY = process.env.SSH_GATE_SECRET;
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { generateSecret, currentTotp } = await import('../../server/totp.mjs');
const { encryptSecret } = await import('../../server/crypto.mjs');
const { signSshRequest } = await import('../../server/sshgate.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => call(p, { method: 'POST', body: JSON.stringify(b) });
const linkFromLog = () => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(/ssh-verify\?t=([A-Za-z0-9_-]+)/g)]; return m.length ? m[m.length - 1][1] : null; };
const signed = (over = {}, key = KEY) => { const f = { ts: String(Math.floor(Date.now() / 1000)), user: 'root', host: 'sky-test', rhost: '203.0.113.7', tty: 'ssh', ...over }; return { ...f, sig: signSshRequest(key, f) }; };

q(`update profiles set username='old'||substr(id,1,8) where lower(username)='sshowner'`);
const own = await mkuser(S, 'sshOwn');
q(`update profiles set username='sshowner' where id='${own.pid}'`);
const secret = generateSecret();

let r = await post('/api/ssh-gate/request', signed());
t('владелец без аутентификатора: вход закрыт', r.status === 400 && r.data.error === 'two_factor_required', JSON.stringify(r.data));
q(`update sky_ids set two_factor_enabled=true, two_factor_secret='${encryptSecret(secret)}' where id=(select sky_id from profiles where id='${own.pid}')`);

r = await post('/api/ssh-gate/request', signed({}, 'wrong-secret-0123456789abcdefgh'));
t('чужая подпись отклонена', r.status === 403 && r.data.error === 'bad_signature', JSON.stringify(r.data));
r = await post('/api/ssh-gate/request', signed({ ts: String(Math.floor(Date.now() / 1000) - 3600) }));
t('устаревшая подпись отклонена', r.status === 403, JSON.stringify(r.data));
const f = signed(); f.user = 'admin';
r = await post('/api/ssh-gate/request', f);
t('подмена поля ломает подпись', r.status === 403);

r = await post('/api/ssh-gate/request', signed());
t('запрос принят', r.status === 200 && r.data.ok && r.data.id && r.data.poll, JSON.stringify(r.data));
const { id, poll } = r.data;
await sleep(800);
const token = linkFromLog();
t('письмо со ссылкой отправлено владельцу', Boolean(token) && readFileSync(S + '/api.log', 'utf8').includes(own.email));
r = await post('/api/ssh-gate/poll', { id, poll });
t('пока не подтверждено — ждём', r.data.status === 'pending', JSON.stringify(r.data));
r = await post('/api/ssh-gate/poll', { id, poll: 'x'.repeat(30) });
t('опрос с чужим ключом ничего не даёт', r.data.status === 'unknown');
r = await call(`/api/ssh-gate/link?t=${token}`);
t('страница ссылки: пользователь, адрес', r.status === 200 && /root@sky-test/.test(r.data.device) && r.data.ip === '203.0.113.7' && r.data.owner === true, JSON.stringify(r.data));
r = await call(`/api/ssh-gate/link?t=${'x'.repeat(40)}`);
t('чужая ссылка недействительна', r.status === 404);
r = await post('/api/ssh-gate/confirm', { t: token, code: '000000' });
t('неверный код: попытки считаются', r.status === 400 && r.data.error === 'bad_code' && r.data.left === 2, JSON.stringify(r.data));
r = await post('/api/ssh-gate/poll', { id, poll });
t('после неверного кода всё ещё закрыто', r.data.status === 'pending');
r = await post('/api/ssh-gate/confirm', { t: token, code: currentTotp(secret) });
t('верный код подтверждает вход', r.status === 200 && r.data.ok, JSON.stringify(r.data));
r = await post('/api/ssh-gate/poll', { id, poll });
t('скрипт получает «approved»', r.data.status === 'approved', JSON.stringify(r.data));
r = await post('/api/ssh-gate/poll', { id, poll });
t('подтверждение выдаётся один раз', r.data.status === 'denied', JSON.stringify(r.data));
r = await post('/api/ssh-gate/confirm', { t: token, code: currentTotp(secret) });
t('ссылка одноразовая', r.status === 404);

// три неверных кода — запрос гаснет
r = await post('/api/ssh-gate/request', signed()); await sleep(800);
const tok2 = linkFromLog(); const p2 = r.data;
for (let i = 0; i < 3; i++) r = await post('/api/ssh-gate/confirm', { t: tok2, code: '111111' });
t('три неверных кода: запрос погашен', r.data.error === 'code_exhausted', JSON.stringify(r.data));
r = await post('/api/ssh-gate/poll', { id: p2.id, poll: p2.poll });
t('и вход закрыт', r.data.status === 'denied');

// «Это не я»: только отклонить
r = await post('/api/ssh-gate/request', signed()); await sleep(800);
const tok3 = linkFromLog(); const p3 = r.data;
r = await post('/api/ssh-gate/panic', { t: tok3, action: 'deny' });
t('«Это не я» → отклонить вход', r.status === 200 && r.data.ok, JSON.stringify(r.data));
r = await post('/api/ssh-gate/poll', { id: p3.id, poll: p3.poll });
t('вход отклонён', r.data.status === 'denied');
// «Это не я»: аварийные работы
r = await post('/api/ssh-gate/request', signed()); await sleep(800);
const tok4 = linkFromLog(); const p4 = r.data;
r = await post('/api/ssh-gate/panic', { t: tok4, action: 'bogus' });
t('неизвестное действие не принимается', r.status === 400);
r = await post('/api/ssh-gate/panic', { t: tok4, action: 'lockdown' });
t('аварийные работы включены', r.status === 200 && r.data.ok, JSON.stringify(r.data));
t('панель закрыта (admin_lockdown)', q(`select active from admin_lockdown where id`) === 't');
q(`update admin_lockdown set active=false where id`);
r = await post('/api/ssh-gate/poll', { id: p4.id, poll: p4.poll });
t('вход отклонён', r.data.status === 'denied');

// просрочка
r = await post('/api/ssh-gate/request', signed()); await sleep(800);
const tok5 = linkFromLog(); const p5 = r.data;
q(`update ssh_gate_requests set expires_at = now() - interval '1 minute' where id='${p5.id}'`);
r = await call(`/api/ssh-gate/link?t=${tok5}`);
t('просроченная ссылка недействительна', r.status === 404);
r = await post('/api/ssh-gate/poll', { id: p5.id, poll: p5.poll });
t('просроченный запрос: вход закрыт', r.data.status === 'expired', JSON.stringify(r.data));

// не владелец не получает письма и права
t('в базе нет запросов не от владельца', q(`select count(*) from ssh_gate_requests where profile_id <> '${own.pid}'`) === '0');
t('токены и ключи опроса — только хеши', q(`select count(*) from ssh_gate_requests where token_hash = '${token}' or poll_hash = '${poll}'`) === '0');

// ── скрипт PAM ──────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'sshgate-'));
const conf = (over = '') => { writeFileSync(join(dir, 'c.conf'), `SKY_API=http://127.0.0.1:8080\nSKY_SECRET=${KEY}\nSKY_TIMEOUT=25\n${over}`); };
const run = (env = {}) => new Promise((res) => {
  const p = spawn('bash', ['scripts/ssh-gate.sh'], { env: { ...process.env, SKY_GATE_CONF: join(dir, 'c.conf'), SKY_GATE_OFF: join(dir, 'off'), PAM_TYPE: 'open_session', PAM_SERVICE: 'sshd', PAM_USER: 'root', PAM_RHOST: '198.51.100.9', PAM_TTY: 'ssh', ...env }, stdio: 'ignore' });
  p.on('exit', (c) => res(c));
});
const before = () => (readFileSync(S + '/api.log', 'utf8').match(/ssh-verify\?t=/g) || []).length;
const waitLink = async (n) => { for (let i = 0; i < 40; i++) { if (before() > n) return linkFromLog(); await sleep(500); } return null; };

conf(); let n0 = before();
let proc = run(); let tk = await waitLink(n0);
t('скрипт: письмо пришло', Boolean(tk));
await post('/api/ssh-gate/confirm', { t: tk, code: currentTotp(secret) });
t('скрипт: после подтверждения владельцем пускает (exit 0)', (await proc) === 0);

n0 = before(); proc = run(); tk = await waitLink(n0);
await post('/api/ssh-gate/panic', { t: tk, action: 'deny' });
t('скрипт: после «Это не я» не пускает (exit 1)', (await proc) === 1);

conf('SKY_TIMEOUT=4'); n0 = before();
t('скрипт: без подтверждения за таймаут не пускает', (await run()) === 1);

conf(); writeFileSync(join(dir, 'c.conf'), `SKY_API=http://127.0.0.1:8080\nSKY_SECRET=wrong-secret-0123456789abcdefgh\nSKY_TIMEOUT=5\n`);
t('скрипт: неверный секрет — вход закрыт', (await run()) === 1);
writeFileSync(join(dir, 'c.conf'), `SKY_API=http://127.0.0.1:1\nSKY_SECRET=${KEY}\nSKY_TIMEOUT=5\n`);
t('скрипт: API недоступен — вход закрыт по умолчанию', (await run()) === 1);
writeFileSync(join(dir, 'c.conf'), `SKY_API=http://127.0.0.1:1\nSKY_SECRET=${KEY}\nSKY_TIMEOUT=5\nSKY_FAILOPEN=1\n`);
t('скрипт: SKY_FAILOPEN=1 пускает, если API недоступен', (await run()) === 0);
t('скрипт: не sshd и не open_session — не мешает', (await run({ PAM_SERVICE: 'login' })) === 0 && (await run({ PAM_TYPE: 'close_session' })) === 0);
writeFileSync(join(dir, 'c.conf'), `SKY_API=http://127.0.0.1:1\nSKY_SECRET=${KEY}\n`); writeFileSync(join(dir, 'off'), '');
t('скрипт: аварийный файл отключает шлюз', (await run()) === 0);
t('скрипт: конфига нет — вход закрыт', (await run({ SKY_GATE_CONF: join(dir, 'none'), SKY_GATE_OFF: join(dir, 'none2') })) === 1);

console.log(`\nИТОГО: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
