// Sky Control: опечатка в токене не сжигает верный код; пробелы вокруг токена; без docker (подставные команды).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { currentTotp } = await import('../../control/totp.mjs');
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const D = mkdtempSync(join(tmpdir(), 'ctl2-')); const bin = join(D, 'bin'); mkdirSync(bin);
writeFileSync(join(bin, 'docker'), '#!/bin/bash\nexit 0\n'); chmodSync(join(bin, 'docker'), 0o755);
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CONTROL_ETC_DIR: join(D, 'etc'), CONTROL_STATE_DIR: join(D, 'state'), CONTROL_LOG: join(D, 'ctl.log'),
  CONTROL_PORT: '18097', CONTROL_NO_MAIL: '1', CONTROL_EMAIL: 'off', CONTROL_CMD_DOCKER: join(bin, 'docker'), APP_DIR: D };
const r0 = spawnSync('node', ['control/sky-control.mjs', '--setup'], { env, encoding: 'utf8' });
const token = (r0.stdout.match(/skc-[A-Za-z0-9_-]{40,}/) || [])[0]; const secret = (r0.stdout.match(/Секрет аутентификатора[^\n]*\n\s+([A-Z2-7]{16,})/) || [])[1];
const srv = spawn('node', ['control/sky-control.mjs', '--serve'], { env, stdio: 'ignore' });
for (let i = 0; i < 30; i++) { try { if ((await fetch('http://127.0.0.1:18097/healthz')).ok) break; } catch { await sleep(200); } }
const login = async (tok, code) => { const res = await fetch('http://127.0.0.1:18097/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ctl': '1' }, body: JSON.stringify({ token: tok, code }) }); return res.status; };
try {
  const c = currentTotp(secret);
  t('опечатка в токене → отказ', await login('skc-wrong-' + 'x'.repeat(30), c) === 401);
  t('тот же код с верным токеном после опечатки принят', await login(token, c) === 200);
  t('и только один раз (повтор того же кода отклонён)', await login(token, c) === 401);
  const c2 = currentTotp(secret, Date.now() + 30000);
  t('пробел и перенос вокруг токена не мешают', await login(' ' + token + '\n', c2) === 200);
} finally { srv.kill(); }
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
