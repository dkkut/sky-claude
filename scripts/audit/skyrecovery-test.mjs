// Sky Recovery: резервная почта, сценарии user/admin/owner, токен администратора, секрет владельца, ожидание, отмена, повторы, перебор.
// API: ADMIN_GATE=off OWNER_USERNAME=ownertest RECOVERY_EMAIL_WAIT_SEC=3 RECOVERY_OWNER_WAIT_SEC=3 DOMAIN=sky.test
// (. env.sh; OWNER_USERNAME=ownertest node scripts/audit/skyrecovery-test.mjs <каталог с api.log>) — владелец нужен и самому тесту (импорт модулей)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
const { generateSecret, currentTotp } = await import('../../server/totp.mjs');
const { encryptSecret } = await import('../../server/crypto.mjs');
const radmin = await import('../../server/recoveryadmin.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const log = () => readFileSync(S + '/api.log', 'utf8');
const last = (re) => { const m = [...log().matchAll(re)]; return m.length ? m[m.length - 1][1] : null; };
const codeTo = (email) => last(new RegExp(email.replace(/[.+]/g, '\\$&') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'));
const linkTo = (email, kind) => last(new RegExp(email.replace(/[.+]/g, '\\$&') + '[^]*?' + kind + '#t=([A-Za-z0-9_-]+)', 'g'));
const skyOf = (u) => q(`select sky_id from profiles where id='${u.pid}'`);
const withTotp = (u) => { const secret = generateSecret(); q(`update sky_ids set two_factor_enabled=true, two_factor_method='app', two_factor_secret='${encryptSecret(secret)}' where id='${skyOf(u)}'`); return secret; };
const rnd = () => Math.random().toString(36).slice(2, 10);
const mailbox = (tag) => `rcv${tag}${rnd()}@example.com`;
q(`delete from recovery_attempts`);
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);

// Привязка резервной почты через настоящие ручки (без 2FA — код на основную почту).
const bindBackup = async (u, email) => {
  q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${u.email}'`);
  await post('/api/skyid/recovery/guard-code', {}, u); await sleep(1200);
  let r = await post('/api/skyid/recovery/backup-email', { email, guardCode: codeTo(u.email) }, u);
  if (r.status !== 200) return r;
  await sleep(1000);
  const token = linkTo(email, 'confirm-email');
  const c = await post('/api/recovery/confirm-email', { token });
  q(`update sky_backup_emails set usable_after = now() - interval '1 minute' where sky_id='${skyOf(u)}'`);
  return { ...c, token };
};
const startReq = async (identifier, kind = 'user') => (await post('/api/recovery/start', { identifier, kind })).data;
const sendMail = (rq) => post('/api/recovery/email/send', { requestId: rq.requestId, secret: rq.secret });
const verify = (rq, factor, value) => post('/api/recovery/verify', { requestId: rq.requestId, secret: rq.secret, factor, value });
const complete = (rq, extra = {}) => post('/api/recovery/complete', { requestId: rq.requestId, secret: rq.secret, ...extra });

/* ── резервная почта ── */
const U = await mkuser(S, 'rcvU'); const skyU = skyOf(U);
let r = await call('/api/skyid/recovery', {}, U.tok);
t('сводка: резервной почты нет, есть история', r.status === 200 && r.data.backupEmail === null && Array.isArray(r.data.history), JSON.stringify(r.data).slice(0, 160));
r = await post('/api/skyid/recovery/backup-email', { email: mailbox('x') }, U);
t('смена резервной почты без доказательства отклонена', r.status === 400 && r.data.error === 'guard_code_required', JSON.stringify(r.data));
await post('/api/skyid/recovery/guard-code', {}, U); await sleep(1200);
r = await post('/api/skyid/recovery/backup-email', { email: U.email, guardCode: codeTo(U.email) }, U);
t('резервная почта не может совпадать с основной', r.status === 409 && r.data.error === 'same_as_primary', JSON.stringify(r.data));
const bkU = mailbox('bk');
const bound = await bindBackup(U, bkU);
t('ссылка подтверждения ставит адрес', bound.status === 200 && bound.data.ok, JSON.stringify(bound));
t('ссылка одноразовая', (await post('/api/recovery/confirm-email', { token: bound.token })).status === 404);
t('в базе нет исходной ссылки (только хеш)', q(`select count(*) from sky_backup_emails where pending_hash like '%${(bound.token ?? 'zz').slice(0, 12)}%'`) === '0');
const V = await mkuser(S, 'rcvV');
q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${V.email}'`);
await post('/api/skyid/recovery/guard-code', {}, V); await sleep(1200);
r = await post('/api/skyid/recovery/backup-email', { email: bkU, guardCode: codeTo(V.email) }, V);
await sleep(800);
const dup = await post('/api/recovery/confirm-email', { token: linkTo(bkU, 'confirm-email') });
t('один адрес нельзя сделать резервным у двух аккаунтов', r.status === 200 && dup.status === 409 && dup.data.error === 'email_unavailable', JSON.stringify([r.status, dup.data]));

/* ── пользователь: нейтральность и перебор ── */
const known = await startReq(U.email); const unknown = await startReq(`nobody${rnd()}@example.com`);
t('ответ одинаков для существующего и несуществующего аккаунта', JSON.stringify(Object.keys(known).sort()) === JSON.stringify(Object.keys(unknown).sort()) && known.message === unknown.message);
r = await verify(unknown, 'email', '123456');
const r2 = await verify(known, 'email', '123456');
t('неверный фактор отвечает одинаково у обоих', r.status === 401 && r2.status === 401 && JSON.stringify(r.data) === JSON.stringify(r2.data));
t('письмо запрашивается без раскрытия, ушло ли оно', (await sendMail(unknown)).status === 200 && (await sendMail(known)).status === 200);
r = await complete(known);
t('без факторов завершить нельзя', r.status === 409 && r.data.error === 'not_enough_factors', JSON.stringify(r.data));

/* ── пользователь: почта → ожидание → отмена ── */
await sleep(1300);
const rq1 = await startReq(U.email);
await sendMail(rq1); await sleep(1300);
r = await verify(rq1, 'email', codeTo(bkU));
t('код с резервной почты принят', r.status === 200 && r.data.factor === 'email', JSON.stringify(r.data));
t('тот же код второй раз не принимается', (await verify(rq1, 'email', codeTo(bkU))).status === 401);
r = await complete(rq1);
t('одна почта: доступ не открывается, назначено ожидание', r.status === 200 && r.data.waiting === true && !r.data.handoff, JSON.stringify(r.data));
const cancelTok = linkTo(U.email, 'cancel') ?? linkTo(bkU, 'cancel');
t('ссылка отмены пришла', Boolean(cancelTok));
r = await post('/api/recovery/cancel', { token: cancelTok });
t('отмена по ссылке закрывает запрос', r.status === 200 && q(`select status from recovery_requests where id='${rq1.requestId}'`) === 'cancelled');
t('отменённый запрос завершить нельзя', (await complete(rq1)).status === 401);

/* ── пользователь: почта → ожидание → завершение, сессии отзываются, handoff одноразовый ── */
q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${bkU}'`);
const rq2 = await startReq(U.email);
await sendMail(rq2); await sleep(1300);
await verify(rq2, 'email', codeTo(bkU));
await complete(rq2);
const finTok = linkTo(U.email, 'finish') ?? linkTo(bkU, 'finish');
r = await post('/api/recovery/finish', { token: finTok, code: '000000' });
t('до окончания ожидания завершить нельзя', r.status === 409 && r.data.error === 'not_ready', JSON.stringify(r.data));
await sleep(3500);
q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${bkU}'`);
await post('/api/recovery/finish/send-code', { token: finTok }); await sleep(1300);
r = await post('/api/recovery/finish', { token: finTok, code: '111111' });
t('неверный код при завершении отклонён', r.status === 401);
const [f1, f2] = await Promise.all([1, 2].map(() => post('/api/recovery/finish', { token: finTok, code: codeTo(bkU) })));
const wins = [f1, f2].filter((x) => x.status === 200);
t('параллельное завершение даёт ровно один успех', wins.length === 1, JSON.stringify([f1.status, f2.status]));
const hand = wins[0]?.data.handoff;
t('вместо сессии выдан одноразовый код передачи', Boolean(hand) && !wins[0].data.session);
t('прежняя сессия отозвана', (await call('/api/skyid/recovery', {}, U.tok)).status === 401);
const ex = await post('/api/recovery/handoff', { code: hand });
t('обмен кода даёт рабочую сессию', ex.status === 200 && ex.data.session?.accessToken || ex.data.session?.token || ex.status === 200, JSON.stringify(ex.data).slice(0, 120));
const tokNew = ex.data.session?.accessToken ?? ex.data.accessToken;
t('повторный обмен отклонён', (await post('/api/recovery/handoff', { code: hand })).status === 401);
t('новая сессия работает', (await call('/api/skyid/recovery', {}, tokNew)).status === 200);

/* ── пользователь с 2FA: почта + приложение → сразу ── */
const W = await mkuser(S, 'rcvW'); const secW = withTotp(W);
const bkW = mailbox('bkw'); q(`insert into sky_backup_emails (sky_id, email, verified_at, usable_after) values ('${skyOf(W)}','${bkW}', now(), now() - interval '1 minute')`);
const rqW = await startReq(W.email);
await sendMail(rqW); await sleep(1300);
await verify(rqW, 'email', codeTo(bkW));
r = await complete(rqW);
t('2FA включена: одной почты мало (ожидание, второй фактор будет сброшен)', r.status === 200 && r.data.waiting === true, JSON.stringify(r.data));
const rqW2 = await startReq(W.email);
await sendMail(rqW2); await sleep(1300);
t('неверный код приложения отклонён', (await verify(rqW2, 'totp', '000000')).status === 401);
await verify(rqW2, 'email', codeTo(bkW)); await verify(rqW2, 'totp', currentTotp(secW));
r = await complete(rqW2);
t('почта + приложение: доступ сразу, 2FA не сбрасывается', r.status === 200 && Boolean(r.data.handoff) && q(`select two_factor_enabled from sky_ids where id='${skyOf(W)}'`) === 't', JSON.stringify(r.data));
t('история восстановления записана без секретов', Number(q(`select count(*) from recovery_history where sky_id='${skyOf(W)}'`)) >= 3 && Number(q(`select count(*) from recovery_history where detail like '%${(r.data.handoff ?? 'zz').slice(0, 10)}%'`)) === 0);

/* ── только приложение (потеряна почта): аккаунт не открывается, можно сменить резервную почту ── */
const X = await mkuser(S, 'rcvX'); const secX = withTotp(X);
const rqX = await startReq(X.email);
await verify(rqX, 'totp', currentTotp(secX));
r = await complete(rqX);
t('одно приложение не открывает аккаунт', r.status === 409 && r.data.error === 'limited_only', JSON.stringify(r.data));
const newBk = mailbox('nbk');
r = await post('/api/recovery/backup-email', { requestId: rqX.requestId, secret: rqX.secret, email: newBk });
t('но позволяет начать замену резервной почты', r.status === 200, JSON.stringify(r.data));
await sleep(900);
const cx = await post('/api/recovery/confirm-email', { token: linkTo(newBk, 'confirm-email') });
t('новый адрес подтверждён, но 24 часа не годится для восстановления', cx.status === 200 && q(`select (usable_after > now()) from sky_backup_emails where sky_id='${skyOf(X)}'`) === 't');
const rqX2 = await startReq(X.email); await sendMail(rqX2); await sleep(900);
t('код на только что добавленный адрес не отправляется', (await verify(rqX2, 'email', codeTo(newBk) ?? '000000')).status === 401);

/* ── администратор ── */
const A = await mkuser(S, 'rcvA'); const B = await mkuser(S, 'rcvB'); const secA = withTotp(A);
for (const a of [A, B]) q(`update profiles set is_admin=true, admin_role='super_admin' where id='${a.pid}'`);
await radmin.issueAdminToken(A.pid, null, 'issued'); await radmin.issueAdminToken(B.pid, null, 'issued');
const st = await radmin.adminTokenState(A.pid);
t('токен создан и ждёт показа; в базе только хеш', st.exists && st.pendingReveal && q(`select count(*) from recovery_admin_tokens where profile_id='${A.pid}' and sealed is not null`) === '1');
const shownA = await radmin.revealOnce(A.pid); const shownB = await radmin.revealOnce(B.pid);
t('значение показывается один раз', shownA.ok && /^SKYADM-/.test(shownA.token) && (await radmin.revealOnce(A.pid)).error === 'nothing_to_show');
t('после показа открытого значения нигде нет', q(`select count(*) from recovery_admin_tokens where profile_id='${A.pid}' and sealed is not null`) === '0' && !JSON.stringify(q(`select token_hash from recovery_admin_tokens where profile_id='${A.pid}'`)).includes(shownA.token));
const rqA = await startReq(A.email, 'admin');
r = await verify(rqA, 'admin_token', shownB.token);
t('токен другого администратора не подходит', r.status === 401);
r = await verify(rqA, 'admin_token', shownA.token);
t('свой токен принят', r.status === 200);
r = await complete(rqA);
t('один токен доступ не открывает', r.status === 409 && r.data.error === 'not_enough_factors', JSON.stringify(r.data));
await verify(rqA, 'totp', currentTotp(secA));
r = await complete(rqA);
t('токен + приложение: восстановление разрешено (ссылка передачи)', r.status === 200 && Boolean(r.data.handoff), JSON.stringify(r.data));
t('роль администратора не изменилась', q(`select admin_role from profiles where id='${A.pid}'`) === 'super_admin');
t('использованный токен заменён новым (виден только владельцу после проверки)', (await radmin.adminTokenState(A.pid)).pendingReveal === true && !(await radmin.verifyAdminToken(skyOf(A), shownA.token)));
await radmin.revokeAdminToken(null, B.pid, 'проверка отзыва токена');
const rqB = await startReq(B.email, 'admin');
t('отозванный токен не работает', (await verify(rqB, 'admin_token', shownB.token)).status === 401);
const rqPlain = await startReq(U.email, 'admin');
t('обычный аккаунт не становится администратором через сценарий', (await verify(rqPlain, 'admin_token', shownA.token)).status === 401);
r = await call('/api/skyid/recovery', {}, A.tok);
q(`update profiles set is_admin=false, admin_role=null where id='${B.pid}'`);
t('снятая роль: токен больше не принимается', !(await radmin.verifyAdminToken(skyOf(B), shownB.token)));

/* ── владелец ── */
q(`delete from recovery_attempts`);
const C = await mkuser(S, 'rcvC'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${C.pid}'`);
const O = await mkuser(S, 'rcvO'); q(`update profiles set username='ownertest' where id='${O.pid}'`);
const bkO = mailbox('bko'); q(`insert into sky_backup_emails (sky_id, email, verified_at, usable_after) values ('${skyOf(O)}','${bkO}', now(), now() - interval '1 minute')`);
r = await post('/api/skyid/recovery/owner-secret', { secret: 'x', stepUpCode: '000000' }, C);
t('администратор не может задать секрет владельца', r.status === 403);
r = await radmin.setOwnerSecret(O.pid, 'коротко1');
t('слабый секрет владельца отклонён', r.error === 'weak_secret');
const OSEC = 'Тайна владельца 2026 — Sky#Kut 77';
r = await radmin.setOwnerSecret(O.pid, OSEC);
t('секрет владельца задан; в базе только хеш', r.ok && !q(`select secret_hash from recovery_owner_secrets where profile_id='${O.pid}'`).includes('Тайна'));
const rqAO = await startReq(A.email, 'owner');
await verify(rqAO, 'admin_token', 'SKYADM-AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD');
t('токен администратора не восстанавливает владельца', (await complete(rqAO)).status !== 200);
const rqO = await startReq(O.email, 'owner');
await sendMail(rqO); await sleep(1300);
await verify(rqO, 'email', codeTo(bkO));
r = await complete(rqO);
t('одна почта не восстанавливает владельца', r.status === 409 && r.data.error === 'not_enough_factors', JSON.stringify(r.data));
t('неверный секрет владельца отклонён', (await verify(rqO, 'owner_secret', 'Неверный секрет 1234567890 тест')).status === 401);
r = await verify(rqO, 'owner_secret', OSEC);
t('секрет владельца принят', r.status === 200);
r = await complete(rqO);
t('секрет + почта: обязательное ожидание', r.status === 200 && r.data.waiting === true && !r.data.handoff, JSON.stringify(r.data));
const finO = linkTo(O.email, 'finish') ?? linkTo(bkO, 'finish');
await sleep(3500);
q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${bkO}'`);
await post('/api/recovery/finish/send-code', { token: finO }); await sleep(1300);
r = await post('/api/recovery/finish', { token: finO, code: codeTo(bkO), ownerSecret: 'Не тот секрет 1234567890 тест' });
t('завершение владельца без верного секрета невозможно', r.status === 401);
q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${bkO}'`);
await post('/api/recovery/finish/send-code', { token: finO }); await sleep(1300);
r = await post('/api/recovery/finish', { token: finO, code: codeTo(bkO), ownerSecret: OSEC });
t('владелец: секрет + почта + ожидание → передача сессии', r.status === 200 && Boolean(r.data.handoff), JSON.stringify(r.data));
t('роль владельца и права не изменились', q(`select lower(username) from profiles where id='${O.pid}'`) === 'ownertest');

/* ── перебор ── */
q(`delete from recovery_attempts`);
const brute = await startReq(`brute${rnd()}@example.com`);
let blocked = false;
for (let i = 0; i < 16; i++) { const x = await verify(brute, 'totp', '000000'); if (x.status === 429) { blocked = true; break; } }
t('перебор факторов упирается в предел', blocked);
let throttled = false;
for (let i = 0; i < 14; i++) { const x = await post('/api/recovery/start', { identifier: `flood${i}${rnd()}@example.com` }); if (x.status === 429) { throttled = true; break; } }
t('массовые запросы с одного адреса ограничены', throttled);

/* ── секреты не попали в журналы ── */
const dump = q(`select string_agg(coalesce(detail::text,'') || coalesce(reason,'') || coalesce(target_id,''), ' ') from sky_events where at > now() - interval '10 minutes'`);
t('токены и секреты не попали в журнал событий', ![shownA.token, OSEC, hand].some((v) => v && dump.includes(v)));
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
