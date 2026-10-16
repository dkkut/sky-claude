// Рубильник и журнал входа по SSH (server/routes/sshadmin.mjs). API: SSH_GATE_SECRET, OWNER_USERNAME=sshowner, DOMAIN (см. sshgate-test.mjs).
//   (. env.sh; SSH_GATE_SECRET=... node scripts/audit/sshgate2-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2]; const KEY = process.env.SSH_GATE_SECRET;
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { signSshRequest } = await import('../../server/sshgate.mjs');
const { generateSecret, currentTotp } = await import('../../server/totp.mjs');
const { encryptSecret } = await import('../../server/crypto.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const codeOf = (email) => [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))].pop()?.[1];
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const signed = (over = {}, key = KEY) => { const f = { ts: String(Math.floor(Date.now() / 1000)), user: 'root', host: 'sky-test', rhost: '203.0.113.8', tty: 'ssh', ...over }; return { ...f, sig: signSshRequest(key, f) }; };
const step = async (u) => { const r = await post('/api/admin/ssh/step-up', {}, u); return r.status === 200 ? currentTotp(SECRET) : null; };

q(`update profiles set username='old'||substr(id,1,8) where lower(username)='sshowner'`);
const own = await mkuser(S, 'sshOwn2'); const usr = await mkuser(S, 'sshUsr2');
q(`update profiles set username='sshowner' where id='${own.pid}'`);
q(`update sky_ids set email_verified = true where email in ('${own.email}','${usr.email}')`);

const SECRET = generateSecret();
q(`update sky_ids set two_factor_enabled=true, two_factor_secret='${encryptSecret(SECRET)}' where id=(select sky_id from profiles where id='${own.pid}')`);


let r = await call('/api/admin/ssh', {}, usr.tok);
t('обычный человек журнал не видит', r.status === 403, r.status);
r = await call('/api/admin/ssh', {}, own.tok);
t('владелец видит состояние и журнал', r.status === 200 && r.data.state && Array.isArray(r.data.requests), JSON.stringify(r.data).slice(0, 120));
t('по умолчанию входы не приостановлены', r.data.state.paused === false);

r = await post('/api/admin/ssh/pause', { reason: 'x' }, own);
t('без подтверждения личности рубильник не работает', r.status === 401, r.status);
r = await post('/api/admin/ssh/step-up', {}, usr);
t('не владелец не может начать подтверждение', r.status === 403);

// запрос до паузы: ждёт
r = await post('/api/ssh-gate/request', signed());
t('до паузы запрос принят', r.status === 200 && r.data.ok, JSON.stringify(r.data));
const pend = r.data;

const code = await step(own);
r = await post('/api/admin/ssh/pause', { reason: 'проверка', stepUpCode: code }, own);
t('владелец закрывает новые входы', r.status === 200 && !r.data.error, JSON.stringify(r.data));
r = await post('/api/ssh-gate/poll', { id: pend.id, poll: pend.poll });
t('ожидавший запрос отклонён', r.data.status === 'denied', JSON.stringify(r.data));
r = await post('/api/ssh-gate/request', signed());
t('новый запрос при паузе — 423', r.status === 423 && r.data.error === 'paused', JSON.stringify(r.data));
r = await call('/api/admin/ssh', {}, own.tok);
t('состояние: приостановлено с причиной', r.data.state.paused === true && r.data.state.reason === 'проверка', JSON.stringify(r.data.state));
t('в журнале админки запись о паузе', Number(q(`select count(*) from admin_log where type='ssh_gate_pause'`)) >= 1);
t('попытка при паузе записана', Number(q(`select count(*) from admin_log where type='ssh_gate_blocked'`)) >= 1);

r = await post('/api/ssh-gate/request', signed({}, 'wrong-secret-0123456789abcdefgh'));
t('чужая подпись по-прежнему отклоняется', r.status === 403);
t('неверная подпись записана в журнал', Number(q(`select count(*) from admin_log where type='ssh_gate_bad_signature'`)) >= 1);

const code2 = await step(own);
r = await post('/api/admin/ssh/resume', { stepUpCode: code2 }, own);
t('владелец снова разрешает входы', r.status === 200 && !r.data.error, JSON.stringify(r.data));
r = await post('/api/ssh-gate/request', signed());
t('после снятия паузы запросы принимаются (с подтверждением)', r.status === 200 && r.data.ok, JSON.stringify(r.data));
r = await post('/api/admin/ssh/resume', { stepUpCode: code2 }, own);
t('код подтверждения одноразовый', r.status === 401, r.status);
// ── прежнее письмо «подтвердите вход» (ssh-login-hook.sh): страница /ssh-confirm с двумя кнопками ──
//   API нужен с SSH_CONFIRM_TOKEN_PATH=<dir>/ssh-confirm-token SSH_CONFIRM_DONE_PATH=<dir>/done SHUTDOWN_SIGNAL_PATH=<dir>/shutdown
{
  const dir = process.env.CTL_DIR;
  const tok = 'a'.repeat(64);
  const get = (p) => call(p);
  r = await get('/api/ssh-gate/legacy?token=' + tok);
  t('старая ссылка: без токена от хука — недействительна', r.status === 404);
  writeFileSync(`${dir}/ssh-confirm-token`, tok + '\n');
  r = await get('/api/ssh-gate/legacy?token=' + tok);
  t('старая ссылка: страница видит действующий токен и срок', r.status === 200 && r.data.secondsLeft > 500, JSON.stringify(r.data));
  r = await get('/api/ssh-gate/legacy?token=' + 'b'.repeat(64));
  t('старая ссылка: чужой токен не принимается', r.status === 404);
  r = await post('/api/ssh-gate/legacy/confirm', { token: tok });
  t('кнопка «Это я»: подтверждает', r.status === 200 && existsSync(`${dir}/done`) && !existsSync(`${dir}/ssh-confirm-token`), JSON.stringify(r.data));
  r = await post('/api/ssh-gate/legacy/confirm', { token: tok });
  t('повторное подтверждение невозможно', r.status === 404);
  rmSync(`${dir}/done`, { force: true });
  writeFileSync(`${dir}/ssh-confirm-token`, tok + '\n');
  r = await post('/api/ssh-gate/legacy/deny', { token: 'c'.repeat(64) });
  t('«Это не я» с чужим токеном ничего не делает', r.status === 404 && !existsSync(`${dir}/shutdown`));
  r = await post('/api/ssh-gate/legacy/deny', { token: tok });
  t('кнопка «Это не я»: сигнал на выключение и аварийный режим', r.status === 200 && existsSync(`${dir}/shutdown`) && q(`select active from admin_lockdown where id`) === 't', JSON.stringify(r.data));
  q(`update admin_lockdown set active=false where id`); rmSync(`${dir}/shutdown`, { force: true });
}
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
