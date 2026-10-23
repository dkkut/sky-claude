#!/usr/bin/env node
/**
 * Sky Control — страница восстановления экосистемы на ХОСТЕ, вне Docker (работает, даже когда api/web/БД упали).
 *
 *   sky-control --serve            сервер (его запускает systemd)
 *   sky-control --setup            первый запуск: выдать токен владельца и секрет аутентификатора (показываются ОДИН раз)
 *   sky-control --new-token        выдать новый токен (прежний перестаёт работать)
 *   sky-control --new-totp         выдать новый секрет аутентификатора
 *   sky-control --cli <команда> [причина]   то же, что кнопки страницы (для аварийного пользователя skyrescue)
 *
 * Вход: долгий токен владельца + код аутентификатора. В файле лежит только SHA-256 токена; секрет аутентификатора — отдельный от Sky ID
 * (иначе для входа понадобилась бы работающая база). Ошибки входа: 5 с одного адреса — блок 15 минут, 30 всего за час — общий блок.
 * Опасные действия (остановка SSH, окно без подтверждения SSH, новый токен) требуют СВЕЖИЙ код ещё раз.
 * Никакой оболочки: только закрытый список действий, команды запускаются без shell, параметры — числа и слова из списков.
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateSecret, verifyTotp, otpauthUri } from './totp.mjs';

const E = process.env;
const APP = E.APP_DIR || '/opt/sky';
const ETC = E.CONTROL_ETC_DIR || '/etc/sky-control';
const STATE = E.CONTROL_STATE_DIR || '/var/lib/sky-control';
const LOG = E.CONTROL_LOG || '/var/log/sky-control.log';
const SSH_OFF = E.CONTROL_SSH_OFF_FILE || '/etc/sky-ssh-gate.off';
const BIND = E.CONTROL_BIND || '127.0.0.1';
const PORT = Number(E.CONTROL_PORT || 8099);
const DOCKER = E.CONTROL_CMD_DOCKER || 'docker';
const SYSTEMCTL = E.CONTROL_CMD_SYSTEMCTL || 'systemctl';
const JOURNAL = E.CONTROL_CMD_JOURNALCTL || 'journalctl';
const ALLOW = (E.CONTROL_ALLOW_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => Date.now();
const clip = (s, n) => String(s ?? '').slice(0, n);

/* ─── файлы ─── */
const ensure = (d) => { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return ''; } };
const writeSecret = (f, v) => { ensure(path.dirname(f)); fs.writeFileSync(f, `${v}\n`, { mode: 0o600 }); fs.chmodSync(f, 0o600); };
const TOKEN_FILE = path.join(ETC, 'token.sha256');
const TOTP_FILE = path.join(ETC, 'totp.secret');
const BYPASS_FILE = path.join(STATE, 'ssh-bypass.json');
const audit = (o) => { try { ensure(path.dirname(LOG)); fs.appendFileSync(LOG, `${JSON.stringify({ t: new Date().toISOString(), ...o })}\n`, { mode: 0o600 }); } catch { /* журнал не должен ронять сервис */ } };

/* ─── запуск команд (без shell) ─── */
const run = (cmd, args, { input, timeout = 60_000, cwd } = {}) => new Promise((resolve) => {
  const p = execFile(cmd, args, { timeout, cwd, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C.UTF-8' } }, (err, stdout, stderr) => {
    resolve({ ok: !err, code: err?.code ?? 0, out: String(stdout || ''), err: String(stderr || '') });
  });
  if (input != null) p.stdin?.end(input);
});
const compose = (args, o = {}) => run(DOCKER, ['compose', ...args], { cwd: fs.existsSync(APP) ? APP : undefined, ...o });
/** SQL через psql внутри контейнера БД; параметры — только psql-переменными (:'name'), строк в SQL не склеиваем. */
const sql = (text, vars = {}, { json = false } = {}) => compose([
  'exec', '-T', 'postgres', 'psql', '-U', E.CONTROL_PG_USER || 'sky', '-d', E.CONTROL_PG_DB || 'sky', '-v', 'ON_ERROR_STOP=1', '-qAt',
  ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]), '-f', '-',
], { input: text, timeout: 30_000 }).then((r) => (json && r.ok ? { ...r, json: (() => { try { return JSON.parse(r.out.trim().split('\n').pop()); } catch { return null; } })() } : r));

const mask = (s) => String(s)
  .replace(/((?:token|secret|password|passwd|authorization|api[_-]?key|jwt)[\w-]*["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi, '$1***')
  .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, 'Bearer ***')
  .replace(/\b(?:sk|skc|SKYD|dx|xoxb)[_-][A-Za-z0-9_-]{16,}/g, '***');

/* ─── уведомление владельцу (как у watchdog/rescue: одноразовый контейнер api) ─── */
const notifyTo = () => { const m = readText('/etc/sky-watchdog.env').match(/^WATCHDOG_EMAIL_TO=(.+)$/m); return (m?.[1] || E.WATCHDOG_EMAIL_TO || '').replace(/["']/g, '').trim(); };
const note = (text) => {
  const to = notifyTo(); if (!to || E.CONTROL_NO_MAIL === '1') return;
  void compose(['run', '--rm', '--no-deps', '-T', 'api', 'node', 'scripts/notify-mail.mjs', to, 'Sky Control: действие владельца', text], { timeout: 90_000 });
};

/* ─── действия ─── */
const need = (cond, code) => { if (!cond) { const e = new Error(code); e.code = code; throw e; } };
const reasonOf = (r) => { const s = clip(r, 200).trim(); need(s.length >= 5, 'reason_required'); return s; };

const sshUnit = async () => {
  for (const u of ['ssh', 'sshd']) { const r = await run(SYSTEMCTL, ['is-active', u]); if (r.out.trim() === 'active') return { unit: u, active: true }; }
  for (const u of ['ssh', 'sshd']) { const r = await run(SYSTEMCTL, ['cat', u]); if (r.ok) return { unit: u, active: false }; }
  return { unit: 'ssh', active: false };
};

const bypassState = () => { try { const j = JSON.parse(fs.readFileSync(BYPASS_FILE, 'utf8')); return j.until > now() ? j : null; } catch { return null; } };
const bypassOn = (minutes, who) => {
  const m = Math.max(5, Math.min(60, Number(minutes) || 15)); const until = now() + m * 60_000;
  ensure(STATE); fs.writeFileSync(BYPASS_FILE, JSON.stringify({ until, by: who }), { mode: 0o600 });
  fs.writeFileSync(SSH_OFF, `sky-control until ${new Date(until).toISOString()}\n`, { mode: 0o600 });
  return { until: new Date(until).toISOString(), minutes: m };
};
const bypassOff = () => { try { fs.rmSync(SSH_OFF, { force: true }); } catch { /* */ } try { fs.rmSync(BYPASS_FILE, { force: true }); } catch { /* */ } return { ok: true }; };
const bypassTick = () => { try { if (fs.existsSync(BYPASS_FILE) && !bypassState()) { bypassOff(); audit({ ev: 'ssh_bypass_expired' }); } } catch { /* */ } };

const SQL_EMERGENCY_OFF = `
UPDATE platform_shutdown SET active = FALSE, reason = :'reason', set_at = now() WHERE id;
UPDATE platform_maintenance SET active = FALSE, reason = :'reason', set_at = now() WHERE id;
UPDATE admin_lockdown SET active = FALSE, reason = :'reason', set_at = now() WHERE id;
UPDATE defense_level SET level = 0, until = NULL, lockdown_by_us = FALSE, reason = :'reason', set_at = now() WHERE id;
UPDATE defense_settings SET data = COALESCE(data, '{}'::jsonb) || '{"enabled": false}'::jsonb WHERE id;
DELETE FROM defense_ip_blocks;
SELECT 'ok';`;
const SQL_DEFENSE_ON = `UPDATE defense_settings SET data = COALESCE(data, '{}'::jsonb) || '{"enabled": true}'::jsonb WHERE id; SELECT 'ok';`;
const SQL_UNLOCK = `
UPDATE admin_lockdown SET active = FALSE, reason = :'reason', set_at = now() WHERE id;
UPDATE defense_level SET level = 0, until = NULL, lockdown_by_us = FALSE, reason = :'reason', set_at = now() WHERE id;
DELETE FROM defense_ip_blocks;
UPDATE sky_ids SET blocked_until = NULL, blocked_reason = '' WHERE blocked_reason LIKE 'defense:%';
SELECT 'ok';`;
const SQL_GATE = (paused) => `UPDATE ssh_gate_state SET paused = ${paused ? 'TRUE' : 'FALSE'}, reason = :'reason', set_at = now() WHERE id; SELECT 'ok';`;
const SQL_STATUS = `SELECT json_build_object(
 'shutdown', (SELECT active FROM platform_shutdown WHERE id), 'maintenance', (SELECT active FROM platform_maintenance WHERE id),
 'lockdown', (SELECT active FROM admin_lockdown WHERE id), 'defenseLevel', (SELECT level FROM defense_level WHERE id),
 'defenseEnabled', COALESCE((SELECT (data->>'enabled')::boolean FROM defense_settings WHERE id), TRUE),
 'sshGatePaused', (SELECT paused FROM ssh_gate_state WHERE id), 'ipBlocks', (SELECT count(*) FROM defense_ip_blocks WHERE expires_at > now()),
 'heldAccounts', (SELECT count(*) FROM sky_ids WHERE blocked_reason LIKE 'defense:%'));`;

const sqlAct = async (text, reason, who) => {
  const r = await sql(text, { reason: `${clip(reason, 180)} [${who}]` });
  need(r.ok, 'db_unavailable'); return { ok: true };
};

const sessions = new Map();
export const ACTIONS = {
  async status() {
    const [ps, unit, db] = await Promise.all([compose(['ps', '-a', '--format', '{{.Service}}\t{{.State}}\t{{.Status}}'], { timeout: 20_000 }), sshUnit(), sql(SQL_STATUS, {}, { json: true })]);
    const services = ps.ok ? ps.out.trim().split('\n').filter(Boolean).map((l) => { const [service, state, status] = l.split('\t'); return { service, state, status }; }) : null;
    return { services, ssh: { ...unit, bypass: bypassState(), gatePaused: db.json?.sshGatePaused ?? null }, db: db.ok ? db.json : null, dbOk: db.ok, now: new Date().toISOString() };
  },
  async 'emergencies-off'({ reason, who }) { reasonOf(reason); const r = await sqlAct(SQL_EMERGENCY_OFF, reason, who); note(`Отключены самозащита, аварийные/технические работы и закрытая панель. Причина: ${reason}. Кто: ${who}.`); return r; },
  async 'defense-off'({ reason, who }) { reasonOf(reason); return sqlAct(SQL_EMERGENCY_OFF, reason, who); },
  async 'defense-on'({ who }) { const r = await sql(SQL_DEFENSE_ON); need(r.ok, 'db_unavailable'); note(`Самозащита снова включена (${who}).`); return { ok: true }; },
  async unlock({ reason, who }) { reasonOf(reason); const r = await sqlAct(SQL_UNLOCK, reason, who); note(`Сняты блокировки самозащиты (${who}). Причина: ${reason}.`); return r; },
  async 'gate-pause'({ reason, who }) { reasonOf(reason); return sqlAct(SQL_GATE(true), reason, who); },
  async 'gate-resume'({ reason, who }) { return sqlAct(SQL_GATE(false), reason && String(reason).length >= 5 ? reason : 'возобновление подтверждений', who); },
  async 'ssh-start'({ who }) { const u = await sshUnit(); const r = await run(SYSTEMCTL, ['start', u.unit]); need(r.ok, 'systemctl_failed'); note(`SSH запущен (${who}).`); return { ok: true }; },
  async 'ssh-stop'({ who }) { const u = await sshUnit(); const r = await run(SYSTEMCTL, ['stop', u.unit]); need(r.ok, 'systemctl_failed'); note(`SSH остановлен (${who}). Открытые сессии остаются.`); return { ok: true }; },
  async 'ssh-bypass'({ minutes, reason, who }) { reasonOf(reason); const b = bypassOn(minutes, who); note(`ОКНО БЕЗ ПОДТВЕРЖДЕНИЯ SSH до ${b.until} (${who}). Причина: ${reason}.`); return b; },
  async 'ssh-bypass-off'() { return bypassOff(); },
  async restart({ target, who }) {
    need(['api', 'web', 'all'].includes(target), 'bad_target');
    const r = await compose(target === 'all' ? ['restart'] : ['restart', target], { timeout: 180_000 }); need(r.ok, 'compose_failed');
    note(`Перезапуск ${target} (${who}).`); return { ok: true };
  },
  async up({ who }) { const r = await compose(['up', '-d'], { timeout: 300_000 }); need(r.ok, 'compose_failed'); note(`docker compose up -d (${who}).`); return { ok: true }; },
  async logs({ source, lines }) {
    const n = Math.max(20, Math.min(500, Number(lines) || 120));
    const SRC = {
      api: () => compose(['logs', '--no-color', '--tail', String(n), 'api']), web: () => compose(['logs', '--no-color', '--tail', String(n), 'web']),
      postgres: () => compose(['logs', '--no-color', '--tail', String(n), 'postgres']), redis: () => compose(['logs', '--no-color', '--tail', String(n), 'redis']),
      ssh: () => run(JOURNAL, ['-u', 'ssh', '-u', 'sshd', '-n', String(n), '--no-pager']), rescue: () => run(JOURNAL, ['-t', 'sky-rescue', '-n', String(n), '--no-pager']),
      guard: () => run('tail', ['-n', String(n), '/var/log/sky-guard.log']), watchdog: () => run('tail', ['-n', String(n), '/var/log/sky-watchdog.log']),
      control: () => run('tail', ['-n', String(n), LOG]),
    };
    need(Object.hasOwn(SRC, source), 'bad_source'); const r = await SRC[source]();
    return { text: mask((r.out || r.err || '').slice(-200_000)), ok: r.ok };
  },
  async 'new-token'({ who }) { const t = `skc-${crypto.randomBytes(32).toString('base64url')}`; writeSecret(TOKEN_FILE, sha(t)); sessions.clear(); note(`Выдан новый токен Sky Control (${who}).`); return { token: t }; },
};
const DANGEROUS = new Set(['ssh-stop', 'ssh-bypass', 'new-token']);

/* ─── вход ─── */
const fails = new Map(); let globalFails = []; let globalLockUntil = 0; const usedCodes = new Map();
const SESSION_MS = 20 * 60_000;
const ipOk = (ip) => !ALLOW.length || ALLOW.includes(ip);
const lockedFor = (ip) => { const f = fails.get(ip); return f && f.until > now() ? f.until : 0; };
const registerFail = (ip) => {
  const f = fails.get(ip) ?? { n: 0, until: 0 }; f.n += 1; if (f.n >= 5) { f.until = now() + 15 * 60_000; f.n = 0; } fails.set(ip, f);
  globalFails = globalFails.filter((t) => now() - t < 3600_000); globalFails.push(now()); if (globalFails.length >= 30) { globalLockUntil = now() + 15 * 60_000; globalFails = []; }
};
const codeFresh = (code) => { const k = String(code).replace(/\D/g, ''); for (const [c, t] of usedCodes) if (now() - t > 120_000) usedCodes.delete(c); return !usedCodes.has(k); };
const checkCode = (code) => {
  const secret = readText(TOTP_FILE); if (!secret) return false; if (!codeFresh(code)) return false;
  if (!verifyTotp(secret, code)) return false; usedCodes.set(String(code).replace(/\D/g, ''), now()); return true;
};
const checkToken = (token) => {
  const want = readText(TOKEN_FILE); if (!want || !/^[0-9a-f]{64}$/.test(want)) return false;
  const a = Buffer.from(sha(token)); const b = Buffer.from(want); return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/* ─── HTTP ─── */
const send = (res, code, body, type = 'application/json', extra = {}) => {
  res.writeHead(code, {
    'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", ...extra,
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((resolve, reject) => {
  let n = 0; const c = [];
  req.on('data', (d) => { n += d.length; if (n > 16 * 1024) { reject(new Error('large')); req.destroy(); } else c.push(d); });
  req.on('end', () => { try { resolve(c.length ? JSON.parse(Buffer.concat(c).toString('utf8')) : {}); } catch { reject(new Error('json')); } });
  req.on('error', reject);
});
const cookieOf = (req) => (String(req.headers.cookie || '').match(/(?:^|;\s*)sky_ctl=([A-Za-z0-9_-]{20,80})/) || [])[1] || '';
const sessionOf = (req) => { const id = cookieOf(req); const s = id && sessions.get(id); if (!s || s.exp < now()) { if (id) sessions.delete(id); return null; } s.exp = now() + SESSION_MS; return s; };
const peer = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

/* ─── страница ─── */
const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sky Control</title>
<style>
:root{--bg:#0a0b12;--l1:#13141e;--l2:#1c1e2b;--b:#2b2e40;--t:#eceef7;--t2:#a2a7c0;--a:#7c5cff;--r:#ef4444;--g:#22c55e;--y:#f59e0b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:14px/1.45 system-ui,sans-serif;padding:16px;max-width:880px;margin-inline:auto}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:0 0 8px}.card{background:var(--l1);border:1px solid var(--b);border-radius:14px;padding:14px;margin:12px 0}
input,select{width:100%;background:var(--l2);border:1px solid var(--b);color:var(--t);border-radius:10px;padding:9px 11px;font:inherit}
button{background:var(--a);color:#fff;border:0;border-radius:10px;padding:8px 13px;font:inherit;font-weight:700;cursor:pointer;margin:3px 3px 3px 0}button.s{background:var(--l2);color:var(--t)}button.d{background:rgba(239,68,68,.18);color:var(--r)}button:disabled{opacity:.4}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;background:var(--l2)}.ok{color:var(--g)}.bad{color:var(--r)}.warn{color:var(--y)}
pre{background:#07080d;border:1px solid var(--b);border-radius:10px;padding:10px;overflow:auto;max-height:420px;font-size:12px;white-space:pre-wrap;word-break:break-all}.muted{color:var(--t2);font-size:12px}
</style></head><body>
<h1>Sky Control</h1><div class="muted">Восстановление экосистемы · работает на сервере вне Docker</div>
<div id="login" class="card"><h2>Вход</h2><input id="tok" type="password" autocomplete="off" placeholder="Токен владельца"><div style="height:8px"></div><input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="Код из аутентификатора"><div style="height:8px"></div><button id="go">Войти</button><div id="lerr" class="bad"></div></div>
<div id="app" hidden>
<div class="card"><div class="row"><h2 style="margin:0">Состояние</h2><button class="s" id="ref">Обновить</button><button class="s" id="out">Выйти</button></div><div id="st" class="muted">…</div></div>
<div class="card"><h2>Аварийные срабатывания</h2><div class="muted">Снимает «Аварийные» и «Технические работы», закрытую панель, уровень самозащиты и блокировки адресов, выключает автоматику самозащиты. Журналы не удаляются.</div>
<input id="r1" placeholder="Причина (от 5 знаков)" style="margin:8px 0"><button id="eoff">Отключить аварийные срабатывания</button><button class="s" id="unlock">Только снять блокировки</button><button class="s" id="don">Включить самозащиту обратно</button></div>
<div class="card"><h2>SSH</h2><div class="muted">Остановка закрывает НОВЫЕ подключения (открытые остаются). Окно без подтверждения отключает защиту входа по SSH на время и само закрывается.</div>
<div class="row"><button id="s1">Запустить SSH</button><button class="d" id="s0">Остановить SSH</button><button class="s" id="g1">Приостановить подтверждения</button><button class="s" id="g0">Возобновить подтверждения</button></div>
<div class="row" style="margin-top:6px"><select id="bm" style="width:110px"><option>15</option><option>30</option><option>60</option><option>5</option></select><span class="muted">минут</span><button class="d" id="bp">Экстренный доступ (окно без подтверждения)</button><button class="s" id="bpo">Закрыть окно</button></div></div>
<div class="card"><h2>Сервисы</h2><button class="s" id="ra">Перезапустить api</button><button class="s" id="rw">Перезапустить web</button><button class="s" id="rall">Перезапустить всё</button><button class="s" id="up">Поднять упавшие</button></div>
<div class="card"><h2>Журналы</h2><div class="row"><select id="src" style="width:170px"><option value="api">api</option><option value="web">web (nginx)</option><option value="postgres">postgres</option><option value="redis">redis</option><option value="ssh">sshd</option><option value="rescue">аварийный вход</option><option value="guard">сторож хоста</option><option value="watchdog">watchdog</option><option value="control">Sky Control</option></select><select id="ln" style="width:100px"><option>120</option><option>300</option><option>500</option></select><button id="lg">Показать</button></div><pre id="log" hidden></pre></div>
<div class="card"><h2>Токен владельца</h2><div class="muted">Новый токен показывается один раз; прежний сразу перестаёт работать.</div><button class="d" id="nt">Выдать новый токен</button><pre id="ntv" hidden></pre></div>
<div id="dlg" class="card" hidden style="border-color:var(--a)"><h2 id="dt"></h2><div id="dd" class="muted"></div><input id="dc" inputmode="numeric" autocomplete="one-time-code" placeholder="Новый код из аутентификатора" style="margin:8px 0"><input id="dr" placeholder="Причина (от 5 знаков)" hidden style="margin-bottom:8px"><button id="dok">Подтвердить</button><button class="s" id="dno">Отмена</button></div>
<div id="msg" class="muted"></div></div>
<script>
const $=(i)=>document.getElementById(i);const H={'Content-Type':'application/json','X-Ctl':'1'};
const api=async(p,b)=>{const r=await fetch(p,b?{method:'POST',headers:H,body:JSON.stringify(b)}:{});let j={};try{j=await r.json()}catch(e){}return{ok:r.ok,s:r.status,j}};
const ERR={bad_credentials:'Неверный токен или код.',locked:'Слишком много попыток — подождите.',reason_required:'Нужна причина (от 5 знаков).',fresh_code_required:'Нужен свежий код (дождитесь следующего).',db_unavailable:'База недоступна — действие не выполнено.',systemctl_failed:'systemctl не сработал.',compose_failed:'docker compose не сработал.',unauthorized:'Сессия истекла — войдите снова.'};
const say=(t,bad)=>{$('msg').textContent=t;$('msg').className=bad?'bad':'ok'};const E=(r)=>ERR[r.j.error]||('Ошибка: '+(r.j.error||r.s));
const pill=(t,c)=>{const s=document.createElement('span');s.className='pill '+(c||'');s.textContent=t;return s};
async function status(){const r=await api('/api/status');if(!r.ok){if(r.s===401){$('app').hidden=true;$('login').hidden=false}return}
const j=r.j,st=$('st');st.textContent='';const add=(t,c)=>{st.appendChild(pill(t,c));st.appendChild(document.createTextNode(' '))};
(j.services||[]).forEach(s=>add(s.service+': '+s.state,s.state==='running'?'ok':'bad'));if(!j.services)add('docker недоступен','bad');
add('SSH: '+(j.ssh.active?'работает':'остановлен'),j.ssh.active?'ok':'warn');if(j.ssh.gatePaused)add('подтверждения SSH приостановлены','warn');if(j.ssh.bypass)add('ОКНО БЕЗ ПОДТВЕРЖДЕНИЯ до '+new Date(j.ssh.bypass.until).toLocaleTimeString(),'bad');
if(j.db){add('самозащита: '+(j.db.defenseEnabled?'включена':'выключена'),j.db.defenseEnabled?'ok':'warn');add('уровень: '+j.db.defenseLevel,j.db.defenseLevel?'bad':'ok');if(j.db.shutdown)add('СЕРВЕР ВЫКЛЮЧЕН','bad');if(j.db.maintenance)add('технические работы','warn');if(j.db.lockdown)add('панель закрыта','warn');add('блокировок адресов: '+j.db.ipBlocks);add('замороженных аккаунтов: '+j.db.heldAccounts)}else add('база недоступна','bad')}
let pend=null;const ask=(title,desc,fn,reason)=>{pend=fn;$('dt').textContent=title;$('dd').textContent=desc;$('dc').value='';$('dr').hidden=!reason;$('dr').value='';$('dlg').hidden=false;$('dc').focus()};
async function act(body,okMsg){const r=await api('/api/act',body);say(r.ok?okMsg:E(r),!r.ok);status();return r}
$('go').onclick=async()=>{const r=await api('/api/login',{token:$('tok').value,code:$('code').value});$('tok').value='';$('code').value='';if(r.ok){$('login').hidden=true;$('app').hidden=false;$('lerr').textContent='';status()}else $('lerr').textContent=E(r)};
$('ref').onclick=status;$('out').onclick=async()=>{await api('/api/logout',{});location.reload()};
$('eoff').onclick=()=>act({action:'emergencies-off',reason:$('r1').value},'Аварийные срабатывания отключены (действует в течение ~10 с).');
$('unlock').onclick=()=>act({action:'unlock',reason:$('r1').value},'Блокировки сняты.');$('don').onclick=()=>act({action:'defense-on'},'Самозащита включена.');
$('s1').onclick=()=>act({action:'ssh-start'},'SSH запущен.');$('g1').onclick=()=>act({action:'gate-pause',reason:$('r1').value||''},'Подтверждения SSH приостановлены.');$('g0').onclick=()=>act({action:'gate-resume'},'Подтверждения SSH возобновлены.');
$('s0').onclick=()=>ask('Остановить SSH','Новые подключения будут невозможны, пока не запустите снова.',(c)=>act({action:'ssh-stop',confirm:true,code:c},'SSH остановлен.'));
$('bp').onclick=()=>ask('Экстренный доступ к SSH','На выбранное время вход по SSH не будет требовать подтверждения владельца. Окно закроется само; владелец получит письмо.',(c,r)=>act({action:'ssh-bypass',confirm:true,code:c,minutes:Number($('bm').value),reason:r},'Окно открыто.'),true);
$('bpo').onclick=()=>act({action:'ssh-bypass-off'},'Окно закрыто.');
$('ra').onclick=()=>act({action:'restart',target:'api'},'api перезапущен.');$('rw').onclick=()=>act({action:'restart',target:'web'},'web перезапущен.');$('rall').onclick=()=>act({action:'restart',target:'all'},'Всё перезапущено.');$('up').onclick=()=>act({action:'up'},'Готово.');
$('lg').onclick=async()=>{const r=await api('/api/act',{action:'logs',source:$('src').value,lines:Number($('ln').value)});const l=$('log');l.hidden=false;l.textContent=r.ok?(r.j.text||'(пусто)'):E(r);l.scrollTop=l.scrollHeight};
$('nt').onclick=()=>ask('Новый токен','Прежний токен перестанет работать, сессии будут закрыты.',async(c)=>{const r=await api('/api/act',{action:'new-token',confirm:true,code:c});if(r.ok){$('ntv').hidden=false;$('ntv').textContent=r.j.token+'\\n\\nСохраните сейчас — повторно не покажется. Нужно войти заново.'}else say(E(r),true)});
$('dok').onclick=async()=>{const f=pend;const c=$('dc').value,r=$('dr').value;$('dlg').hidden=true;pend=null;if(f)await f(c,r)};$('dno').onclick=()=>{$('dlg').hidden=true;pend=null};
setInterval(()=>{if(!document.hidden&&!$('app').hidden)status()},20000);
</script></body></html>`;

export const handler = async (req, res) => {
  const ip = peer(req); const url = new URL(req.url || '/', 'http://x'); const p = url.pathname;
  if (!ipOk(ip)) { audit({ ev: 'ip_denied', ip }); return send(res, 403, { error: 'forbidden' }); }
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, PAGE, 'text/html');
  if (req.method === 'GET' && p === '/healthz') return send(res, 200, 'ok', 'text/plain');
  try {
    if (req.method === 'POST' && p === '/api/login') {
      if (req.headers['x-ctl'] !== '1') return send(res, 400, { error: 'bad_request' });
      const until = Math.max(lockedFor(ip), globalLockUntil > now() ? globalLockUntil : 0);
      if (until) return send(res, 429, { error: 'locked', retryInSec: Math.ceil((until - now()) / 1000) });
      const b = await readBody(req);
      // оба фактора проверяются всегда, ответ не говорит, какой неверен
      const okT = checkToken(String(b.token || '')); const okC = checkCode(String(b.code || ''));
      if (!(okT && okC)) { registerFail(ip); audit({ ev: 'login_fail', ip }); await new Promise((r) => setTimeout(r, 600)); return send(res, 401, { error: 'bad_credentials' }); }
      fails.delete(ip); const id = crypto.randomBytes(32).toString('base64url'); sessions.set(id, { exp: now() + SESSION_MS, ip });
      audit({ ev: 'login_ok', ip }); note(`Вход в Sky Control с адреса ${ip}.`);
      return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': `sky_ctl=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${req.socket.encrypted ? '; Secure' : ''}` });
    }
    const s = sessionOf(req);
    if (!s) return send(res, 401, { error: 'unauthorized' });
    if (req.method === 'POST' && p === '/api/logout') { sessions.delete(cookieOf(req)); return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': 'sky_ctl=; Max-Age=0; Path=/' }); }
    if (req.method === 'GET' && p === '/api/status') return send(res, 200, await ACTIONS.status());
    if (req.method === 'POST' && p === '/api/act') {
      if (req.headers['x-ctl'] !== '1') return send(res, 400, { error: 'bad_request' });
      const b = await readBody(req); const name = String(b.action || '');
      if (!Object.hasOwn(ACTIONS, name) || name === 'status') return send(res, 400, { error: 'bad_action' });
      if (DANGEROUS.has(name)) {
        if (b.confirm !== true) return send(res, 400, { error: 'confirm_required' });
        if (!checkCode(String(b.code || ''))) { registerFail(ip); audit({ ev: 'fresh_code_fail', ip, action: name }); return send(res, 401, { error: 'fresh_code_required' }); }
      }
      const who = `control:${ip}`;
      try {
        const r = await ACTIONS[name]({ ...b, who });
        audit({ ev: 'action', action: name, ip, ok: true, reason: clip(b.reason, 120) });
        return send(res, 200, { ok: true, ...(r || {}) });
      } catch (e) { audit({ ev: 'action', action: name, ip, ok: false, err: e.code || e.message }); return send(res, 400, { error: e.code || 'failed' }); }
    }
    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    if (e.message === 'json' || e.message === 'large') return send(res, 400, { error: 'bad_request' });
    audit({ ev: 'error', err: clip(e.message, 100) }); return send(res, 500, { error: 'server_error' });
  }
};

/* ─── CLI ─── */
const setup = () => {
  if (readText(TOKEN_FILE)) { console.error('Уже настроено. Новый токен: --new-token, новый секрет аутентификатора: --new-totp'); process.exit(1); }
  const token = `skc-${crypto.randomBytes(32).toString('base64url')}`; writeSecret(TOKEN_FILE, sha(token));
  const secret = generateSecret(); writeSecret(TOTP_FILE, secret);
  console.log(`\nТОКЕН ВЛАДЕЛЬЦА (показан один раз, на сервере остаётся только хеш):\n  ${token}\n\nСекрет аутентификатора (добавьте в приложение):\n  ${secret}\n  ${otpauthUri(secret, 'sky-control', 'Sky Control')}\n`);
};
const CLI_ALLOWED = ['status', 'emergencies-off', 'defense-off', 'defense-on', 'unlock', 'gate-pause', 'gate-resume', 'ssh-start', 'ssh-bypass-off'];
const main = async () => {
  const [a, b, c] = process.argv.slice(2);
  if (a === '--setup') return setup();
  if (a === '--new-token') { const t = `skc-${crypto.randomBytes(32).toString('base64url')}`; writeSecret(TOKEN_FILE, sha(t)); console.log(`Новый токен (один раз):\n  ${t}`); return undefined; }
  if (a === '--new-totp') { const s = generateSecret(); writeSecret(TOTP_FILE, s); console.log(`Новый секрет аутентификатора:\n  ${s}\n  ${otpauthUri(s, 'sky-control', 'Sky Control')}`); return undefined; }
  if (a === '--cli') {
    const name = String(b || ''); const who = `cli:${clip(c || 'local', 60)}`; const reason = c && String(c).length >= 5 ? String(c) : `аварийный вход ${clip(c, 60)}`;
    if (name === 'new-token') { const r = await ACTIONS['new-token']({ who }); console.log(`Новый токен (один раз):\n  ${r.token}`); audit({ ev: 'cli', action: name, who }); return undefined; }
    if (!CLI_ALLOWED.includes(name)) { console.error(`Допустимо: ${CLI_ALLOWED.join(' ')} new-token`); process.exit(2); }
    try { const r = await ACTIONS[name]({ reason, who }); audit({ ev: 'cli', action: name, who, ok: true }); console.log(JSON.stringify(r, null, 2)); } catch (e) { audit({ ev: 'cli', action: name, who, ok: false, err: e.code }); console.error(`Не вышло: ${e.code || e.message}`); process.exit(1); }
    return undefined;
  }
  if (a !== '--serve') { console.error('sky-control --serve | --setup | --new-token | --new-totp | --cli <команда> [причина]'); process.exit(2); }
  if (!readText(TOKEN_FILE) || !readText(TOTP_FILE)) { console.error('Не настроено: sky-control --setup'); process.exit(1); }
  const cert = E.CONTROL_TLS_CERT; const key = E.CONTROL_TLS_KEY;
  const srv = cert && key ? https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key), minVersion: 'TLSv1.2' }, handler) : http.createServer(handler);
  srv.requestTimeout = 60_000; srv.headersTimeout = 20_000;
  setInterval(bypassTick, 15_000).unref(); bypassTick();
  // Сертификат продлевает контейнер certbot (раз в ~60 дней): раз в час перечитываем файлы и подменяем контекст без перезапуска.
  if (cert && key) {
    let seen = `${fs.statSync(cert).mtimeMs}:${fs.statSync(key).mtimeMs}`;
    setInterval(() => { try { const cur = `${fs.statSync(cert).mtimeMs}:${fs.statSync(key).mtimeMs}`; if (cur !== seen) { srv.setSecureContext({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }); seen = cur; audit({ ev: 'tls_reloaded' }); } } catch (e) { audit({ ev: 'tls_reload_failed', err: clip(e.message, 80) }); } }, 3600_000).unref();
  }
  srv.listen(PORT, BIND, () => console.log(`[sky-control] ${cert ? 'https' : 'http'}://${BIND}:${PORT}${cert ? '' : ' (без TLS — только localhost/туннель)'}`));
  return undefined;
};
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
