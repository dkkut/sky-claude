// Запасной вход шлюза SSH без API и почты (scripts/ssh-gate.sh: local_fallback), файл отключения со сроком, самопроверка.
// Без БД и API: недоступный API = закрытый порт, «ответы Sky» — крошечный http-сервер. Запуск: node scripts/audit/sshgate-local-test.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { generateSecret, currentTotp } from '../../server/totp.mjs';

let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const dir = mkdtempSync(join(tmpdir(), 'sshgate-local-'));
const SECRET = generateSecret();
const key = 'test-secret-0123456789abcdefgh';

let reply = null; let byPath = null; const seen = [];
const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { seen.push(req.url); const r = (byPath && byPath(req.url)) ?? reply ?? { status: 404, body: '{}' }; res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(r.body); }); });
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

// Режим both: токен принят → ждём подтверждения владельца (poll), иначе вход закрыт.
conf(`http://127.0.0.1:${port}`, 'SKY_MODE=both\n');
reset(); seen.length = 0;
let polls = 0;
byPath = (u) => u.endsWith('/login') ? { status: 200, body: '{"ok":true,"id":"ssh-1","poll":"p1"}' } : u.endsWith('/poll') ? { status: 200, body: `{"status":"${++polls >= 2 ? 'approved' : 'pending'}"}` } : null;
t('both: владелец подтвердил — пускает', (await run('')) === 0, tty());
t('both: в терминале НЕ спрашивают ник и токен (одна страница)', !/ник|Токен администратора/i.test(tty().replace(/Токен администратора и кодом/g, '')) && tty().includes('Ничего вводить здесь не нужно'), tty());
t('both: без терминала вовсе (scp/sftp) — тоже работает', (await run('', { SKY_GATE_TTY: '' })) === 0);
t('both: опрошено подтверждение владельца', seen.some((u) => u.endsWith('/poll')));
t('both: сторож отмены не нужен (запрос watch не шёл)', !seen.some((u) => u.endsWith('/watch')));
reset(); seen.length = 0;
byPath = (u) => u.endsWith('/login') ? { status: 200, body: '{"ok":true,"id":"ssh-1","poll":"p1"}' } : u.endsWith('/poll') ? { status: 200, body: '{"status":"denied"}' } : null;
t('both: владелец отказал — вход закрыт', (await run('')) === 1);
reset(); byPath = (u) => u.endsWith('/login') ? { status: 401, body: '{"error":"denied"}' } : null;
t('both: отказ сервера — закрыто, до владельца не доходит', (await run('')) === 1);
reset(); byPath = (u) => u.endsWith('/login') ? { status: 503, body: '{"error":"email_failed"}' } : null;
writeFileSync(join(dir, 'totp'), SECRET + '\n');
t('both: письмо не ушло + верный запасной код — пускает', (await run(`${currentTotp(SECRET)}\n`)) === 0, tty());
byPath = null;

// PAM_TTY=ssh (как отдаёт настоящий sshd): терминал ищется по процессу «sshd: USER@pts/N» этого соединения.
const py = spawn('python3', ['-c', 'import pty,os,time; m,s=pty.openpty(); print(os.ttyname(s),flush=True); time.sleep(40)'], { stdio: ['ignore', 'pipe', 'ignore'] });
const pts = (await new Promise((r) => py.stdout.once('data', (d) => r(String(d).trim())))); 
const bindir = join(dir, 'bin'); mkdirSync(bindir, { recursive: true });
const PSLOG = join(dir, 'log.txt');
writeFileSync(join(bindir, 'ps'), `#!/bin/bash\nfor a in "$@"; do [ "$a" = "-p" ] && { echo 1; exit 0; }; done\necho "9999 ${process.pid} sshd: root@${pts.replace('/dev/', '')}"\n`, { mode: 0o755 });
writeFileSync(join(bindir, 'logger'), `#!/bin/bash\necho "$*" >> "${PSLOG}"\n`, { mode: 0o755 });
conf(`http://127.0.0.1:${port}`, 'SKY_MODE=both\n'); reset(); rmSync(PSLOG, { force: true });
byPath = (u) => u.endsWith('/login') ? { status: 200, body: '{"ok":true,"id":"ssh-1","poll":"p1"}' } : u.endsWith('/poll') ? { status: 200, body: '{"status":"approved"}' } : null;
t('PAM_TTY=ssh: терминал найден по процессу sshd, вход проходит', (await run('', { SKY_GATE_TTY: '', PATH: `${bindir}:${process.env.PATH}`, PAM_TTY: 'ssh' })) === 0);
t('в журнале сказано, какой терминал найден', existsSync(PSLOG) && readFileSync(PSLOG, 'utf8').includes(`терминал найден по процессу sshd: ${pts}`), existsSync(PSLOG) ? readFileSync(PSLOG, 'utf8') : 'нет журнала');
py.kill();

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
