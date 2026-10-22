// Sky Sandbox (server/sandbox.mjs, routes/sandbox.mjs). Часть 1 — чистая логика, часть 2 — API с «поддельным раннером».
// API: OWNER_USERNAME=sbxowner ADMIN_GATE=off SANDBOX_SECRET=sandbox-secret-0123456789abcdef (без SANDBOX_ALLOW_LOCAL_PUBLISH).
// Запуск: . env.sh; SANDBOX_SECRET=… node scripts/audit/sandbox-test.mjs <каталог с api.log>
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const SECRET = process.env.SANDBOX_SECRET ?? 'sandbox-secret-0123456789abcdef';
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 240) : JSON.stringify(x).slice(0, 240)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Часть 1: чистая логика ── */
process.env.SANDBOX_ALLOW_LOCAL_PUBLISH = '';
const sb = await import('../../server/sandbox.mjs');
const okc = (id) => ({ id, title: id, status: 'ok', detail: '', ms: 1, log: '' });
const full = sb.REQUIRED.map(okc);
t('verdict: всё ok и изоляция → passed', sb.verdictOf(full, { mode: 'isolated' }).status === 'passed');
t('verdict: без изоляции не выше «замечаний»', sb.verdictOf(full, { mode: 'local' }).status === 'warnings');
t('verdict: сокращённый профиль не выше «замечаний»', sb.verdictOf(full, { mode: 'isolated', profile: 'quick' }).status === 'warnings');
t('verdict: fail → failed', sb.verdictOf([...full.slice(1), { ...full[0], status: 'fail' }], { mode: 'isolated' }).status === 'failed');
t('verdict: нет обязательной проверки → failed', sb.verdictOf(full.slice(1), { mode: 'isolated' }).status === 'failed');
t('verdict: warn → warnings', sb.verdictOf([...full.slice(1), { ...full[0], status: 'warn' }], { mode: 'isolated' }).status === 'warnings');
t('verdict: skip → warnings', sb.verdictOf([...full.slice(1), { ...full[0], status: 'skip' }], { mode: 'isolated' }).status === 'warnings');
t('verdict: пустой отчёт → failed', sb.verdictOf([], { mode: 'isolated' }).status === 'failed');
t('подписи статусов', sb.statusLabel('passed') === 'Проверка пройдена' && sb.statusLabel('warnings') === 'Есть замечания' && sb.statusLabel('failed') === 'Проверка не пройдена' && sb.statusLabel('error') === 'Проверка не пройдена');
let c = sb.analyzeChange(['src/a.tsx', 'server/transfer.mjs']); t('обычные файлы — не критично', !c.critical && !c.hasMigrations);
c = sb.analyzeChange(['server/migrations/198_x.sql']); t('миграция — критично', c.critical && c.hasMigrations);
t('ядро входа/денег — критично', sb.analyzeChange(['server/wallet.mjs']).critical && sb.analyzeChange(['server/crypto.mjs']).critical && sb.analyzeChange(['server/adminsec.mjs']).critical);
t('compose, nginx, deploy — критично', sb.analyzeChange(['docker-compose.yml']).critical && sb.analyzeChange(['nginx/templates/sky.conf.template']).critical && sb.analyzeChange(['scripts/deploy-local.sh']).critical);
t('сам Sandbox — критично', sb.analyzeChange(['sandbox/runner.mjs']).critical);
t('destructiveSql: DROP/TRUNCATE/RENAME', sb.destructiveSql('DROP TABLE x;') && sb.destructiveSql('truncate foo') && sb.destructiveSql('ALTER TABLE a RENAME COLUMN b TO c'));
t('destructiveSql: DELETE без WHERE', sb.destructiveSql('DELETE FROM a;') && !sb.destructiveSql('DELETE FROM a WHERE x=1;'));
t('destructiveSql: добавление безопасно, комментарии игнорируются', !sb.destructiveSql('CREATE TABLE IF NOT EXISTS a(id int); ALTER TABLE a ADD COLUMN b int; -- DROP TABLE a'));
t('scrub: строки подключения, ключи, Bearer', !/pass/.test(sb.scrubText('postgres://u:pass@h/db')) && !/sk-abcdefghijklmnop1234/.test(sb.scrubText('key sk-abcdefghijklmnop1234')) && !/eyJhbGciOiJ/.test(sb.scrubText('Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')));
t('scrub: имя=значение для секретов', !/hunter2/.test(sb.scrubText('JWT_SECRET=hunter2 and DB_PASSWORD: hunter2')));
t('scrub: приватный ключ', !/MIIE/.test(sb.scrubText('-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----')));
const SHA = 'a'.repeat(40), now = Date.now();
const mk = (o = {}) => ({ id: 'sbx-1', sha: SHA, status: 'passed', mode: 'isolated', profile: 'full', critical: false, requested_by: 'p1', finished_at: new Date(now - 1000).toISOString(), ...o });
t('gate: passed + sha → ok', sb.publishGate(mk(), { sha: SHA, actorId: 'p2', now }).ok === true);
t('gate: чужой sha', sb.publishGate(mk(), { sha: 'b'.repeat(40), actorId: 'p2', now }).error === 'sha_mismatch');
t('gate: failed нельзя', sb.publishGate(mk({ status: 'failed' }), { sha: SHA, actorId: 'p2', now }).error === 'not_publishable');
t('gate: error нельзя', sb.publishGate(mk({ status: 'error' }), { sha: SHA, actorId: 'p2', now }).error === 'not_publishable');
t('gate: в очереди нельзя', sb.publishGate(mk({ status: 'queued' }), { sha: SHA, actorId: 'p2', now }).error === 'not_checked');
t('gate: без изоляции нельзя', sb.publishGate(mk({ mode: 'local', status: 'warnings' }), { sha: SHA, acceptWarnings: true, actorId: 'p2', now }).error === 'isolation_required');
t('gate: короткий профиль нельзя', sb.publishGate(mk({ profile: 'quick' }), { sha: SHA, actorId: 'p2', now }).error === 'isolation_required');
t('gate: замечания только с подтверждением', sb.publishGate(mk({ status: 'warnings' }), { sha: SHA, actorId: 'p2', now }).error === 'warnings_not_accepted' && sb.publishGate(mk({ status: 'warnings' }), { sha: SHA, acceptWarnings: true, actorId: 'p2', now }).ok);
t('gate: устаревший отчёт', sb.publishGate(mk({ finished_at: new Date(now - 30 * 3600e3).toISOString() }), { sha: SHA, actorId: 'p2', now }).error === 'report_stale');
t('gate: критичное — только владелец', sb.publishGate(mk({ critical: true }), { sha: SHA, actorId: 'p2', now }).error === 'owner_required' && sb.publishGate(mk({ critical: true }), { sha: SHA, actorId: 'p2', actorIsOwner: true, now }).ok);
t('gate: сам себе не одобряет, владелец может', sb.publishGate(mk(), { sha: SHA, actorId: 'p1', now }).error === 'self_approval' && sb.publishGate(mk(), { sha: SHA, actorId: 'p1', actorIsOwner: true, now }).ok);
t('gate: нет сборки', sb.publishGate(null, { sha: SHA }).error === 'build_not_found');
t('rollbackPlan', sb.rollbackPlan({ hasMigrations: true, destructive: false }).auto && !sb.rollbackPlan({ hasMigrations: true, destructive: true }).auto && sb.rollbackPlan({ hasMigrations: true, destructive: true }).how === 'db_restore');

/* ── Часть 2: API ── */
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const get = (p, u) => call(p, {}, u?.tok);
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const staff = async (tag, role) => { const u = await mkuser(S, tag); q(`update profiles set is_admin=true, admin_role='${role}' where id='${u.pid}'`); return u; };
const step = async (u) => { q(`update admin_step_up set used_at = now() where actor_id='${u.pid}' and used_at is null`); await post('/api/admin/sandbox/step-up', {}, u); await sleep(1300); return codeOf(u.email); };
const runner = async (method, path, body, o = {}) => {
  const raw = body === undefined ? '' : JSON.stringify(body); const ts = o.ts ?? Math.floor(Date.now() / 1000);
  const nonce = o.nonce ?? crypto.randomBytes(12).toString('hex');
  const sig = o.sig ?? crypto.createHmac('sha256', o.secret ?? SECRET).update(`${ts}\n${nonce}\n${method}\n${path}\n${crypto.createHash('sha256').update(raw).digest('hex')}`).digest('hex');
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', 'x-sbx-ts': String(ts), 'x-sbx-nonce': nonce, 'x-sbx-sig': sig }, body: raw || undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const claim = (caps = ['check']) => runner('POST', '/api/sandbox/runner/claim', { runner: 'test', caps });
const done = (id, checks, extra = {}) => runner('POST', `/api/sandbox/runner/build/${id}/result`, { checks, mode: 'isolated', changedFiles: ['src/x.tsx'], ...extra });
const hex = () => crypto.randomBytes(20).toString('hex');
const drain = async () => { for (let i = 0; i < 12; i++) { const j = (await claim(['check', 'deploy'])).data.job; if (!j) break; if (j.build) await runner('POST', `/api/sandbox/runner/build/${j.build.id}/result`, { error: 'drain' }); else await runner('POST', `/api/sandbox/runner/pub/${j.publication.id}/result`, { outcome: 'failed', note: 'drain' }); } };

q(`update profiles set username='old'||substr(id,1,8) where lower(username)='sbxowner'`);
const OWN = await mkuser(S, 'sbxOwn'); q(`update profiles set username='sbxowner' where id='${OWN.pid}'`);
const USR = await mkuser(S, 'sbxUsr'), VW = await staff('sbxVw', 'sandbox_admin'), PB = await staff('sbxPb', 'sandbox_publisher'), PB2 = await staff('sbxPb2', 'sandbox_publisher'), SA = await staff('sbxSa', 'super_admin');
q(`delete from sandbox_publications; delete from sandbox_builds`);
await drain();

/* доступ */
t('без входа — 401', (await get('/api/admin/sandbox')).status === 401);
t('обычному человеку — 403', (await get('/api/admin/sandbox', USR)).status === 403);
t('sandbox_admin видит обзор', (await get('/api/admin/sandbox', VW)).status === 200);
let r = await get('/api/admin/sandbox', VW); t('обзор: нет секретов и canPublish=false', r.data.canPublish === false && !/SANDBOX_SECRET|sandbox-secret/.test(JSON.stringify(r.data)));
t('super_admin видит, но публиковать не может (право не входит)', (await get('/api/admin/sandbox', SA)).data.canPublish === false);
t('super_admin: step-up на публикацию закрыт', (await post('/api/admin/sandbox/step-up', {}, SA)).status === 403);
t('sandbox_admin: публикация закрыта', (await post('/api/admin/sandbox/publish', { buildId: 'x', sha: SHA, stepUpCode: '000000' }, VW)).status === 403);

/* раннер: подпись */
r = await runner('POST', '/api/sandbox/runner/claim', {}, { sig: 'f'.repeat(64) }); t('раннер: неверная подпись — 403', r.status === 403 && r.data.error === 'bad_signature', r);
r = await runner('POST', '/api/sandbox/runner/claim', {}, { secret: 'другой-секрет-0123456789abcdef' }); t('раннер: чужой секрет — 403', r.status === 403);
r = await runner('POST', '/api/sandbox/runner/claim', {}, { ts: Math.floor(Date.now() / 1000) - 600 }); t('раннер: просроченное время — 403', r.status === 403 && r.data.error === 'bad_time', r);
r = await fetch(B + '/api/sandbox/runner/claim', { method: 'POST', body: '{}' }); t('раннер: без заголовков — 403', r.status === 403);
const ts0 = Math.floor(Date.now() / 1000), raw0 = JSON.stringify({ runner: 't', caps: ['check'] }), N0 = crypto.randomBytes(12).toString('hex'), sig0 = crypto.createHmac('sha256', SECRET).update(`${ts0}\n${N0}\nPOST\n/api/sandbox/runner/claim\n${crypto.createHash('sha256').update(raw0).digest('hex')}`).digest('hex');
const go = () => fetch(B + '/api/sandbox/runner/claim', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sbx-ts': String(ts0), 'x-sbx-nonce': N0, 'x-sbx-sig': sig0 }, body: raw0 });
t('раннер: верная подпись принимается', (await go()).status === 200); t('раннер: повтор той же подписи — отказ', (await go()).status === 403);
r = await runner('POST', '/api/sandbox/runner/claim', { runner: 't', caps: ['check'], pad: 'x'.repeat(600_000) }).catch(() => ({ status: 0 })); t('раннер: огромное тело — 413 или обрыв', r.status === 413 || r.status === 0, r.status);
r = await runner('POST', '/api/sandbox/runner/nothing', {}); t('раннер: неизвестный путь — 404', r.status === 404);
t('раннер: подпись не заменяет вход в админку', (await call('/api/admin/sandbox', {}, undefined, { 'x-sbx-ts': '1', 'x-sbx-sig': 'x' })).status === 401);

/* сборки */
r = await post('/api/admin/sandbox/builds', { sha: 'abc' }, VW); t('плохой sha — 400', r.status === 400 && r.data.error === 'bad_sha');
r = await post('/api/admin/sandbox/builds', { sha: 'A'.repeat(40).toLowerCase() + 'z' }, VW); t('sha с мусором — 400', r.status === 400);
r = await post('/api/admin/sandbox/builds', { sha: 'a;b'.padEnd(40, 'a') }, VW); t('sha с символами оболочки — 400', r.status === 400);
r = await post('/api/admin/sandbox/builds', { sha: SHA }, USR); t('человек не создаёт сборку', r.status === 403);
const b1 = (await post('/api/admin/sandbox/builds', { sha: hex(), ref: 'main', note: 'тест' }, PB)); t('сборка создана', b1.status === 201 && /^sbx-/.test(b1.data.id), b1.data);
r = await claim(['check']); t('раннер берёт задание проверки', r.data.job?.kind === 'check' && r.data.job.build.id === b1.data.id, r.data);
t('повторно то же задание не выдаётся', !(await claim(['check'])).data.job);
r = await get(`/api/admin/sandbox/builds/${b1.data.id}`, VW); t('статус «выполняется»', r.data.status === 'running');
r = await runner('POST', `/api/sandbox/runner/build/${b1.data.id}/progress`, { checks: [okc('checkout')] }); t('прогресс принимается', r.status === 200);
t('прогресс виден в отчёте', (await get(`/api/admin/sandbox/builds/${b1.data.id}`, VW)).data.report.checks?.length === 1);
const leaky = { ...okc('secrets'), detail: 'DATABASE_URL=postgres://sky:hunter2@db/sky token sk-abcdefghijklmnop1234', log: 'JWT_SECRET=hunter2' };
r = await done(b1.data.id, [...sb.REQUIRED.filter((i) => i !== 'secrets').map(okc), leaky], { status: 'passed', verdict: 'passed' });
t('результат принят, вердикт считает сервер: passed', r.data.status === 'passed', r.data);
const rep = await get(`/api/admin/sandbox/builds/${b1.data.id}`, VW);
t('в отчёте нет секретов', !/hunter2|sk-abcdefghijklmnop1234/.test(JSON.stringify(rep.data)), JSON.stringify(rep.data.report.checks.find((c) => c.id === 'secrets')));
t('метка «Проверка пройдена»', rep.data.label === 'Проверка пройдена' && rep.data.mode === 'isolated' && rep.data.counts.ok === sb.REQUIRED.length);
t('повторный результат отклоняется', (await done(b1.data.id, full)).status === 409);

const mkBuild = async (user, checks, extra = {}) => { const id = (await post('/api/admin/sandbox/builds', { sha: hex() }, user)).data.id; const j = (await claim(['check'])).data.job; await done(j.build.id, checks, extra); return { id: j.build.id, sha: j.build.sha, ok: j.build.id === id }; };
const bFail = await mkBuild(PB, [...full.slice(1), { ...full[0], status: 'fail', detail: 'сломано' }]);
t('упавшая проверка → «Проверка не пройдена»', (await get(`/api/admin/sandbox/builds/${bFail.id}`, VW)).data.status === 'failed');
const bMiss = await mkBuild(PB, full.slice(2));
t('нет обязательных проверок → не пройдена', (await get(`/api/admin/sandbox/builds/${bMiss.id}`, VW)).data.status === 'failed');
const bLocal = await mkBuild(PB, full, { mode: 'local' });
t('без изоляции → «Есть замечания»', (await get(`/api/admin/sandbox/builds/${bLocal.id}`, VW)).data.status === 'warnings');
const bWarn = await mkBuild(PB, [...full.slice(1), { ...full[0], status: 'warn', detail: 'high: 2' }]);
t('предупреждение → «Есть замечания»', (await get(`/api/admin/sandbox/builds/${bWarn.id}`, VW)).data.status === 'warnings');
const bCrit = await mkBuild(PB, full, { changedFiles: ['server/migrations/198_a.sql', 'server/wallet.mjs'] });
const cb = (await get(`/api/admin/sandbox/builds/${bCrit.id}`, VW)).data; t('миграции и ядро → критично', cb.critical && cb.has_migrations && cb.critical_reasons.length >= 2, cb);
const bDes = await mkBuild(PB, full, { changedFiles: ['server/migrations/199_b.sql'], destructive: true });
const bErr = (await post('/api/admin/sandbox/builds', { sha: hex() }, PB)).data.id; const jE = (await claim(['check'])).data.job; await runner('POST', `/api/sandbox/runner/build/${jE.build.id}/result`, { error: 'docker упал' });
t('падение раннера → «Проверка не пройдена» с причиной', (await get(`/api/admin/sandbox/builds/${jE.build.id}`, VW)).data.status === 'error');
const bOk = await mkBuild(PB, full); const bOk2 = await mkBuild(PB, full);

/* повторный запуск / отмена */
r = await post(`/api/admin/sandbox/builds/${bFail.id}/rerun`, {}, VW); t('повторный запуск создаёт новую сборку на тот же sha', r.status === 200 || r.status === 201, r.data);
const rr = (await get('/api/admin/sandbox', VW)).data.builds.find((b) => b.rerun_of === bFail.id); t('новая сборка ссылается на прежнюю', rr && rr.sha === bFail.sha && rr.status === 'queued', rr);
r = await post(`/api/admin/sandbox/builds/${rr.id}/cancel`, {}, VW); t('отмена очереди', r.status === 200); t('отменённую нельзя взять', !(await claim()).data.job);
t('отмена завершённой невозможна', (await post(`/api/admin/sandbox/builds/${bOk.id}/cancel`, {}, VW)).status === 400);
for (let i = 0; i < 6; i++) await post('/api/admin/sandbox/builds', { sha: hex() }, VW);
r = await post('/api/admin/sandbox/builds', { sha: hex() }, VW); t('очередь ограничена (5)', r.status === 400 && r.data.error === 'queue_full', r.data);
await drain();

/* публикация */
const pub = (u, b) => post('/api/admin/sandbox/publish', b, u);
r = await pub(PB, { buildId: bFail.id, sha: bFail.sha, stepUpCode: await step(PB) }); t('упавшую сборку публиковать нельзя', r.data.error === 'not_publishable', r.data);
r = await pub(PB, { buildId: bLocal.id, sha: bLocal.sha, acceptWarnings: true, stepUpCode: await step(PB) }); t('сборку без изоляции публиковать нельзя', r.data.error === 'isolation_required', r.data);
r = await pub(PB, { buildId: bOk.id, sha: 'c'.repeat(40), stepUpCode: await step(PB) }); t('чужой sha отклонён', r.data.error === 'sha_mismatch', r.data);
r = await pub(PB, { buildId: bOk.id, sha: bOk.sha, stepUpCode: '000000' }); t('неверный код подтверждения — 401', r.status === 401, r);
r = await pub(PB, { buildId: bOk.id, sha: bOk.sha }); t('без кода — отказ', r.status === 401 || r.status === 400, r.status);
r = await pub(PB, { buildId: bOk.id, sha: bOk.sha, stepUpCode: await step(PB) }); t('автор сборки не одобряет сам', r.data.error === 'self_approval', r.data);
r = await pub(PB2, { buildId: bWarn.id, sha: bWarn.sha, stepUpCode: await step(PB2) }); t('замечания без подтверждения — отказ', r.data.error === 'warnings_not_accepted', r.data);
r = await pub(PB2, { buildId: bCrit.id, sha: bCrit.sha, stepUpCode: await step(PB2) }); t('критичное: не владелец — отказ', r.data.error === 'owner_required', r.data);
q(`update sandbox_builds set finished_at = now() - interval '2 days' where id='${bOk2.id}'`);
r = await pub(PB2, { buildId: bOk2.id, sha: bOk2.sha, stepUpCode: await step(PB2) }); t('устаревший отчёт — отказ', r.data.error === 'report_stale', r.data);
r = await pub(PB2, { buildId: bOk.id, sha: bOk.sha, note: 'релиз', stepUpCode: await step(PB2) }); t('чистая сборка одобрена другим сотрудником', r.status === 201 && /^pub-/.test(r.data.id), r.data);
const P1 = r.data.id;
r = await pub(PB2, { buildId: bWarn.id, sha: bWarn.sha, acceptWarnings: true, stepUpCode: await step(PB2) }); t('вторая публикация одновременно — отказ', r.data.error === 'publication_in_progress', r.data);
t('в очереди публикации — раннер без прав deploy её не берёт', !(await claim(['check'])).data.job);
r = await claim(['check', 'deploy']); t('раннер с deploy берёт публикацию', r.data.job?.kind === 'deploy' && r.data.job.publication.id === P1 && r.data.job.publication.sha === bOk.sha, r.data);
const prev = hex();
r = await runner('POST', `/api/sandbox/runner/pub/${P1}/progress`, { steps: [{ id: 'backup', title: 'Копия', status: 'ok', detail: 'DB_PASSWORD=hunter2 ok' }], prevSha: prev, backupRef: '/var/backups/sky/x.sql.gz.age' }); t('прогресс публикации', r.status === 200);
r = await runner('POST', `/api/sandbox/runner/pub/${P1}/result`, { outcome: 'deployed', note: 'Опубликовано', steps: [{ id: 'health', title: 'Здоровье', status: 'ok' }], health: { healthz: 200 } }); t('публикация завершена', r.data.status === 'deployed', r.data);
let ov = (await get('/api/admin/sandbox', VW)).data; const pp = ov.publications.find((p) => p.id === P1);
t('в обзоре: публикация, прежняя версия, копия; секретов нет', pp.status === 'deployed' && pp.prev_sha === prev && pp.backup_ref && !/hunter2/.test(JSON.stringify(ov)), pp);
t('lastDeployed указывает на публикацию', ov.lastDeployed?.id === P1);

/* критичное — владелец; предупреждения — с подтверждением */
r = await pub(OWN, { buildId: bCrit.id, sha: bCrit.sha, stepUpCode: await step(OWN) }); t('владелец одобряет критичную сборку', r.status === 201 && r.data.critical === true && r.data.plan.auto === true, r.data);
const P2 = r.data.id;
const j2 = (await claim(['deploy'])).data.job; await runner('POST', `/api/sandbox/runner/pub/${P2}/result`, { outcome: 'failed', note: 'проверка не прошла', prevSha: prev, steps: [] });
t('сбой публикации записан', (await get('/api/admin/sandbox', VW)).data.publications.find((p) => p.id === P2).status === 'failed' && j2.publication.id === P2);

/* откат */
r = await post(`/api/admin/sandbox/publications/${P2}/rollback`, { stepUpCode: await step(PB2) }, PB2); t('откат: схема менялась — не владелец отказ', r.data.error === 'owner_required', r.data);
r = await post(`/api/admin/sandbox/publications/${P2}/rollback`, { stepUpCode: await step(OWN) }, OWN); t('откат: нужно подтвердить схему', r.data.error === 'confirm_schema', r.data);
r = await post(`/api/admin/sandbox/publications/${P2}/rollback`, { confirmSchema: true, stepUpCode: await step(OWN) }, OWN); t('откат кода запрошен владельцем', r.status === 201 && r.data.sha === prev && r.data.plan.how === 'code', r.data);
const R1 = r.data.id; const jr = (await claim(['deploy'])).data.job; t('раннер получает задание отката', jr.kind === 'rollback' && jr.publication.sha === prev);
await runner('POST', `/api/sandbox/runner/pub/${R1}/result`, { outcome: 'deployed', note: 'откат' });
r = await post(`/api/admin/sandbox/publications/${P1}/rollback`, { stepUpCode: await step(OWN) }, OWN); t('откат устаревшей публикации (после неё выходили другие) отказан', ['newer_deployed', 'nothing_to_roll_back'].includes(r.data.error), r.data);
/* разрушающая миграция */
const bD = await mkBuild(PB, full, { changedFiles: ['server/migrations/199_b.sql'], destructive: true });
r = await pub(OWN, { buildId: bD.id, sha: bD.sha, stepUpCode: await step(OWN) }); t('разрушающая миграция: план без автооткатa', r.status === 201 && r.data.plan.auto === false && r.data.plan.how === 'db_restore', r.data);
const PD = r.data.id; await claim(['deploy']); await runner('POST', `/api/sandbox/runner/pub/${PD}/result`, { outcome: 'failed', note: 'x', prevSha: prev });
r = await post(`/api/admin/sandbox/publications/${PD}/rollback`, { confirmSchema: true, stepUpCode: await step(OWN) }, OWN); t('откат кода после разрушающей миграции отказан → восстановление из копии', r.data.error === 'manual_restore_required', r.data);
/* отмена публикации до старта */
const bC = await mkBuild(PB, full); r = await pub(PB2, { buildId: bC.id, sha: bC.sha, stepUpCode: await step(PB2) });
t('публикацию можно отменить до начала', (await post(`/api/admin/sandbox/publications/${r.data.id}/cancel`, {}, PB2)).status === 200);
t('результат без запуска раннером отклоняется', (await runner('POST', `/api/sandbox/runner/pub/${r.data.id}/result`, { outcome: 'deployed' })).status === 409);

/* журнал */
const logs = q(`select string_agg(distinct type, ',') from admin_log where type like 'sandbox_%'`);
t('действия записаны в журнал администрации', ['sandbox_build', 'sandbox_rerun', 'sandbox_publish_approve', 'sandbox_rollback', 'sandbox_cancel'].every((k) => logs.includes(k)), logs);
t('результат публикации раннера — в журнале', /sandbox_publication_deployed/.test(logs) && /sandbox_publication_failed/.test(logs), logs);
const sec = q(`select count(*) from admin_log where detail ilike '%hunter2%'`); t('в журнале нет секретов', sec === '0');
console.log(`\nSandbox: ${ok} ok, ${bad} FAIL`); process.exit(bad ? 1 : 0);
