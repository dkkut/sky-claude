// Sky Control (control/sky-control.mjs): вход токен+TOTP, блокировки, действия, окно SSH, CLI. Без docker: подставные docker/systemctl.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
const { currentTotp } = await import('../../control/totp.mjs');
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const D = mkdtempSync(join(tmpdir(), 'ctl-')); const bin = join(D, 'bin'); mkdirSync(bin);
const calls = join(D, 'calls.log');
const fake = (name, body) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
fake('docker', `echo "DOCKER $*" >> ${calls}; IN=""; case "$*" in *"-f -"*) IN=$(cat);; esac; echo "STDIN: $IN" >> ${calls}
case "$*" in *"ps -a"*) printf 'api\\trunning\\tUp 2 hours\\nweb\\trunning\\tUp 2 hours\\n';; *"json_build_object"*|*"-f -"*) case "$IN" in *json_build_object*) echo '{"shutdown":false,"maintenance":true,"lockdown":true,"defenseLevel":2,"defenseEnabled":true,"sshGatePaused":false,"ipBlocks":3,"heldAccounts":1}';; *) echo ok;; esac;; *logs*) echo "line1 password=supersecretvalue token=abcdef123456 ok";; esac`);
fake('systemctl', `echo "SYSTEMCTL $*" >> ${calls}; case "$1" in is-active) echo active;; esac`);
fake('journalctl', 'echo journal-line');
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CONTROL_ETC_DIR: join(D, 'etc'), CONTROL_STATE_DIR: join(D, 'state'), CONTROL_LOG: join(D, 'ctl.log'), CONTROL_SSH_OFF_FILE: join(D, 'ssh-gate.off'),
  CONTROL_PORT: '18099', CONTROL_NO_MAIL: '1', CONTROL_CMD_DOCKER: join(bin, 'docker'), CONTROL_CMD_SYSTEMCTL: join(bin, 'systemctl'), CONTROL_CMD_JOURNALCTL: join(bin, 'journalctl'), APP_DIR: D };
const ctl = (...a) => spawnSync('node', ['control/sky-control.mjs', ...a], { env, encoding: 'utf8' });

let r = ctl('--setup'); const token = (r.stdout.match(/skc-[A-Za-z0-9_-]{40,}/) || [])[0]; const secret = (r.stdout.match(/Секрет аутентификатора[^\n]*\n\s+([A-Z2-7]{16,})/) || [])[1];
t('setup выдал токен и секрет', Boolean(token && secret), r.stdout + r.stderr);
t('на диске только хеш токена (0600)', !readFileSync(join(D, 'etc/token.sha256'), 'utf8').includes(token) && (spawnSync('stat', ['-c', '%a', join(D, 'etc/token.sha256')], { encoding: 'utf8' }).stdout.trim() === '600'));
t('повторный setup отказывает', ctl('--setup').status === 1);

const srv = spawn('node', ['control/sky-control.mjs', '--serve'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 30; i++) { try { if ((await fetch('http://127.0.0.1:18099/healthz')).ok) break; } catch { await sleep(200); } }
const B = 'http://127.0.0.1:18099'; let cookie = '';
const call = async (p, body, o = {}) => { const res = await fetch(B + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-ctl': '1', ...(cookie ? { cookie } : {}), ...(o.headers || {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await res.json(); } catch { /* html */ } return { s: res.status, j, h: res.headers }; };
const code = (off = 0) => currentTotp(secret, Date.now() + off * 30000);

t('без входа действия закрыты', (await call('/api/status')).s === 401 && (await call('/api/act', { action: 'restart', target: 'api' })).s === 401);
const page = await fetch(B + '/'); const html = await page.text();
t('страница отдаётся с CSP и без кэша', page.status === 200 && /Sky Control/.test(html) && /default-src 'none'/.test(page.headers.get('content-security-policy') || '') && page.headers.get('cache-control') === 'no-store');
t('токен без кода — отказ', (await call('/api/login', { token, code: '000000' })).s === 401);
t('код без токена — отказ', (await call('/api/login', { token: 'skc-wrong', code: code() })).s === 401);
t('вход без заголовка X-Ctl отклонён', (await fetch(B + '/api/login', { method: 'POST', body: JSON.stringify({ token, code: code() }) })).status === 400);
// блокировка после 5 неверных (уже 2)
for (let i = 0; i < 3; i++) await call('/api/login', { token: 'x', code: '111111' });
r = await call('/api/login', { token, code: code() });
t('после 5 ошибок вход заблокирован даже с верными данными', r.s === 429 && r.j.error === 'locked', JSON.stringify(r));
srv.kill(); await sleep(300);

// перезапуск (сбрасывает блокировки) для остального
const srv2 = spawn('node', ['control/sky-control.mjs', '--serve'], { env, stdio: 'ignore' });
for (let i = 0; i < 30; i++) { try { if ((await fetch(B + '/healthz')).ok) break; } catch { await sleep(200); } }
r = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ctl': '1' }, body: JSON.stringify({ token, code: code() }) });
cookie = (r.headers.get('set-cookie') || '').split(';')[0];
t('верный токен + код → сессия (HttpOnly, SameSite=Strict)', r.status === 200 && /HttpOnly/.test(r.headers.get('set-cookie')) && /SameSite=Strict/.test(r.headers.get('set-cookie')));
r = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ctl': '1' }, body: JSON.stringify({ token, code: code() }) });
t('тот же код повторно не принимается (защита от повтора)', r.status === 401);

r = await call('/api/status');
t('статус: сервисы, SSH, база', r.s === 200 && r.j.services?.length === 2 && r.j.ssh.active === true && r.j.db?.defenseLevel === 2 && r.j.db.lockdown === true, JSON.stringify(r.j));
r = await call('/api/act', { action: 'emergencies-off', reason: 'x' });
t('снятие аварийных без причины — отказ', r.s === 400 && r.j.error === 'reason_required');
r = await call('/api/act', { action: 'emergencies-off', reason: 'ложное срабатывание защиты' });
const log1 = readFileSync(calls, 'utf8');
t('снятие аварийных: UPDATE по режимам, уровню, блокировкам и самозащите', r.s === 200 && /platform_shutdown/.test(log1) && /platform_maintenance/.test(log1) && /admin_lockdown/.test(log1) && /defense_level/.test(log1) && /"enabled": false/.test(log1) && /DELETE FROM defense_ip_blocks/.test(log1));
t('причина передаётся psql-переменной, а не склеивается в SQL', /-v reason=ложное срабатывание защиты \[control:/.test(log1) && /reason = :'reason'/.test(log1));
r = await call('/api/act', { action: 'defense-on' }); t('включить самозащиту обратно', r.s === 200 && /"enabled": true/.test(readFileSync(calls, 'utf8')));
r = await call('/api/act', { action: 'unlock', reason: 'снятие блокировок после теста' }); t('снять блокировки (в т.ч. замороженные аккаунты)', r.s === 200 && /blocked_reason LIKE 'defense:%'/.test(readFileSync(calls, 'utf8')));
r = await call('/api/act', { action: 'gate-pause', reason: 'подтверждения мешают восстановлению' }); t('пауза подтверждений SSH', r.s === 200 && /ssh_gate_state SET paused = TRUE/.test(readFileSync(calls, 'utf8')));
r = await call('/api/act', { action: 'ssh-start' }); t('запуск SSH', r.s === 200 && /SYSTEMCTL start ssh/.test(readFileSync(calls, 'utf8')));
r = await call('/api/act', { action: 'ssh-stop' }); t('остановка SSH без подтверждения — отказ', r.s === 400 && r.j.error === 'confirm_required');
r = await call('/api/act', { action: 'ssh-stop', confirm: true, code: '123456' }); t('остановка SSH с неверным кодом — отказ', r.s === 401);
r = await call('/api/act', { action: 'ssh-stop', confirm: true, code: code(1) }); t('остановка SSH со свежим кодом', r.s === 200 && /SYSTEMCTL stop ssh/.test(readFileSync(calls, 'utf8')), JSON.stringify(r.j));
r = await call('/api/act', { action: 'ssh-bypass', confirm: true, code: code(-1), minutes: 999, reason: 'потерян доступ к подтверждению' });
t('окно SSH: срок ограничен 60 минутами, файл создан', r.s === 200 && r.j.minutes === 60 && existsSync(join(D, 'ssh-gate.off')), JSON.stringify(r.j));
r = await call('/api/status'); t('статус показывает окно', Boolean(r.j.ssh.bypass));
r = await call('/api/act', { action: 'ssh-bypass-off' }); t('окно закрыто вручную', r.s === 200 && !existsSync(join(D, 'ssh-gate.off')));
mkdirSync(join(D, 'state'), { recursive: true }); writeFileSync(join(D, 'state/ssh-bypass.json'), JSON.stringify({ until: Date.now() - 1000 })); writeFileSync(join(D, 'ssh-gate.off'), 'x');
await sleep(16000); t('просроченное окно закрывается само', !existsSync(join(D, 'ssh-gate.off')));
r = await call('/api/act', { action: 'restart', target: 'api' }); t('перезапуск api', r.s === 200 && /compose restart api/.test(readFileSync(calls, 'utf8')));
r = await call('/api/act', { action: 'restart', target: 'postgres; rm -rf /' }); t('цель перезапуска только из списка', r.s === 400);
r = await call('/api/act', { action: 'logs', source: 'api', lines: 50 }); t('журналы: секреты замаскированы', r.s === 200 && /line1/.test(r.j.text) && !/supersecretvalue|abcdef123456/.test(r.j.text), r.j.text);
r = await call('/api/act', { action: 'logs', source: '../../etc/passwd' }); t('журналы: источник только из списка', r.s === 400);
r = await call('/api/act', { action: 'rm', x: 1 }); t('неизвестное действие отклонено', r.s === 400);
await sleep(30000 - (Date.now() % 30000) + 800); r = await call('/api/act', { action: 'new-token', confirm: true, code: code(1) }); const tok2 = r.j.token;
t('новый токен выдан и сессии сброшены', r.s === 200 && /^skc-/.test(tok2) && (await call('/api/status')).s === 401);
cookie = ''; await sleep(30000); r = await call('/api/login', { token, code: code(0) }); t('прежний токен не работает', r.s === 401);
const lg = readFileSync(join(D, 'ctl.log'), 'utf8'); t('журнал действий без токенов и кодов', /login_ok/.test(lg) && !lg.includes(token) && !lg.includes(tok2));
srv2.kill();

// CLI (для skyrescue)
r = ctl('--cli', 'defense-off', 'rescue:203.0.113.5'); t('CLI defense-off работает', r.status === 0 && /ok/.test(r.stdout), r.stderr);
r = ctl('--cli', 'ssh-bypass', 'x'); t('CLI: ssh-bypass недоступен (только через страницу)', r.status === 2);
r = ctl('--cli', 'new-token', 'rescue:203.0.113.5'); t('CLI new-token выдаёт новый токен', r.status === 0 && /skc-/.test(r.stdout));
// rescue-access.sh содержит новые команды
const ra = readFileSync('scripts/rescue-access.sh', 'utf8'); t('skyrescue: новые команды в списке', /defense-off\|defense-on\|unlock\|gate-pause\|gate-resume\|ssh-start\)/.test(ra) && /control-token\)/.test(ra));
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
