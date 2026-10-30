// Запасной вход шлюза SSH без API и почты (scripts/ssh-gate.sh: local_fallback), файл отключения со сроком, самопроверка.
// Без БД и API: недоступный API = закрытый порт, «ответы Sky» — крошечный http-сервер. Запуск: node scripts/audit/sshgate-local-test.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { generateSecret, currentTotp } from '../../server/totp.mjs';

let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const dir = mkdtempSync(join(tmpdir(), 'sshgate-local-'));
const SECRET = generateSecret();
const key = 'test-secret-0123456789abcdefgh';

let reply = null;
const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { const r = reply ?? { status: 404, body: '{}' }; res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(r.body); }); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

const base = (over = {}) => ({ ...process.env, SKY_GATE_CONF: join(dir, 'c.conf'), SKY_GATE_OFF: join(dir, 'off'), SKY_GATE_TTY: join(dir, 'tty.txt'), SKY_GATE_MARK: join(dir, 'mark'),
  SKY_GATE_REUSE: join(dir, 'reuse'), SKY_GATE_TOTP: join(dir, 'totp'), SKY_GATE_TOTP_FAIL: join(dir, 'fail'), SKY_GATE_TOTP_LAST: join(dir, 'last'),
  PAM_TYPE: 'open_session', PAM_SERVICE: 'sshd', PAM_USER: 'root', PAM_RHOST: '198.51.100.9', PAM_TTY: 'ssh', ...over });
const conf = (api, extra = '') => writeFileSync(join(dir, 'c.conf'), `SKY_API=${api}\nSKY_SECRET=${key}\nSKY_TIMEOUT=4\nSKY_REUSE_SEC=0\n${extra}`);
const run = (input, env = {}) => new Promise((res) => {
  writeFileSync(join(dir, 'tty.txt'), input);
  const p = spawn('bash', ['scripts/ssh-gate.sh'], { env: base(env), stdio: 'ignore' });
  p.on('exit', (c) => res(c));
});
const tty = () => readFileSync(join(dir, 'tty.txt'), 'utf8');
const reset = () => { for (const f of ['fail', 'last', 'off', 'mark']) rmSync(join(dir, f), { force: true }); };
const DEAD = 'http://127.0.0.1:1';

try { execFileSync('bash', ['scripts/ssh-gate.sh', '--selftest'], { stdio: 'pipe' }); t('--selftest проходит (вектор RFC 6238)', true); } catch (e) { t('--selftest проходит', false, String(e.stdout)); }

reset(); conf(DEAD);
t('API недоступен, запасного кода нет — вход закрыт', (await run('@n\nSKA-X\n')) === 1);

writeFileSync(join(dir, 'totp'), SECRET + '\n');
reset(); conf(DEAD);
t('API недоступен + верный код — пускает (режим token)', (await run(`@n\nSKA-X\n${currentTotp(SECRET)}\n`)) === 0, tty());
t('вход записан для хука (отметка)', existsSync(join(dir, 'mark')));
t('на терминале сказано про запасной код', tty().includes('Запасной вход'));
t('тот же код второй раз не принимается (повтор)', (await run(`@n\nSKA-X\n${currentTotp(SECRET)}\n000000\n000000\n`)) === 1);

reset();
t('неверный код ×3 — закрыто', (await run('@n\nSKA-X\n111111\n222222\n333333\n')) === 1);
await run('@n\nSKA-X\n111111\n222222\n333333\n');
t('после 5 неверных вход закрыт, даже с верным кодом', (await run(`@n\nSKA-X\n${currentTotp(SECRET)}\n`)) === 1);
t('в блоке сказано про 15 минут', tty().includes('15 минут'));

conf(`http://127.0.0.1:${port}`, 'SKY_MODE=owner\n');
reset(); reply = { status: 503, body: '{"error":"email_failed"}' };
t('owner: письмо не ушло + верный код — пускает', (await run(`${currentTotp(SECRET)}\n`)) === 0, tty());
reset(); reply = { status: 423, body: '{"error":"paused"}' };
t('owner: рубильник закрыт — запасной код НЕ обходит', (await run(`${currentTotp(SECRET)}\n`)) === 1 && !tty().includes('Запасной вход'));
reset(); reply = { status: 403, body: '{"error":"bad_signature"}' };
t('owner: неверная подпись — запасной код не предлагается', (await run(`${currentTotp(SECRET)}\n`)) === 1 && !tty().includes('Запасной вход'));
reset(); reply = { status: 502, body: '<html>Bad gateway</html>' };
t('owner: nginx отдал HTML 502 (API лежит) — запасной код предлагается', (await run(`${currentTotp(SECRET)}\n`)) === 0);

reset(); conf(DEAD);
writeFileSync(join(dir, 'off'), '');
t('пустой файл отключения — пускает (бессрочно)', (await run('')) === 0);
writeFileSync(join(dir, 'off'), String(Math.floor(Date.now() / 1000) + 600));
t('срок в будущем — пускает', (await run('')) === 0);
writeFileSync(join(dir, 'off'), String(Math.floor(Date.now() / 1000) - 5));
t('срок вышел — шлюз включён (вход закрыт)', (await run('@n\nSKA-X\n')) === 1);
t('просроченный файл отключения удалён', !existsSync(join(dir, 'off')));

srv.close(); rmSync(dir, { recursive: true, force: true });
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
