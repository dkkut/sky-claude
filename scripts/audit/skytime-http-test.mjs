// Sky Time через HTTP: вход, изоляция, запечатанное не читается, лимиты, Sky Balance, «В этот день».
// API: OWNER_USERNAME=lifeowner ADMIN_GATE=off ADMIN_TOKEN=off EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test RATE_LIMIT_PER_MINUTE=5000
// Запуск: node scripts/audit/skytime-http-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2]; let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const q = (s) => execSync(`psql postgres://sky:sky@localhost:5432/skytest -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const J = (o) => ({ method: 'POST', body: JSON.stringify(o) }); const P = (o) => ({ method: 'PUT', body: JSON.stringify(o) });
const a = await mkuser(S, 'TmA'); const b = await mkuser(S, 'TmB'); const c = await mkuser(S, 'TmC');
const [lo, hi] = [a.pid, b.pid].sort();
q(`INSERT INTO friendships (a_id,b_id,requested_by,status) VALUES ('${lo}','${hi}','${a.pid}','accepted')`);
const day = 86400000, future = (d) => new Date(Date.now() + d * day).toISOString();

t('без входа 401', (await call('/api/time/capsules')).status === 401 && (await call('/api/time/balance')).status === 401);
const e1 = await call('/api/time/capsules', J({ text: 'x', openAt: future(2) }), a.tok); t('короткий текст — отказ', e1.status === 400 && e1.data.error === 'bad_text', JSON.stringify(e1.data));
const e2 = await call('/api/time/capsules', J({ text: 'письмо', openAt: new Date(Date.now() + 60000).toISOString() }), a.tok); t('слишком скоро', e2.data.error === 'too_soon', JSON.stringify(e2.data));
const e3 = await call('/api/time/capsules', J({ text: 'письмо', openAt: future(4000) }), a.tok); t('слишком далеко', e3.data.error === 'too_far', JSON.stringify(e3.data));
const e4 = await call('/api/time/capsules', J({ text: 'письмо', openAt: future(3), to: c.pid }), a.tok); t('не другу — 403', e4.status === 403 && e4.data.error === 'not_friend', JSON.stringify(e4.data));
const ok1 = await call('/api/time/capsules', J({ text: 'Секретное письмо себе', title: 'Привет', openAt: future(5) }), a.tok); t('капсула себе создана', ok1.status === 200 && ok1.data.ok, JSON.stringify(ok1.data));
const ok2 = await call('/api/time/capsules', J({ text: 'Тебе, друг', openAt: future(7), to: b.pid, locked: true }), a.tok); t('капсула другу создана', ok2.status === 200, JSON.stringify(ok2.data));
const la = await call('/api/time/capsules', {}, a.tok);
t('автор видит запечатанные без текста', la.data.sealed.length === 2 && la.data.sealed.every((x) => x.text === undefined && x.title === undefined), JSON.stringify(la.data).slice(0, 200));
t('текст нигде в ответе не светится', !JSON.stringify(la.data).includes('Секретное') && !JSON.stringify(la.data).includes('Тебе, друг'));
const lb = await call('/api/time/capsules', {}, b.tok); t('друг видит свою, но без текста', lb.data.sealed.length === 1 && lb.data.sealed[0].text === undefined);
const lc = await call('/api/time/capsules', {}, c.tok); t('посторонний ничего не видит', lc.data.sealed.length === 0 && lc.data.opened.length === 0);
const idSelf = la.data.sealed.find((x) => x.toSelf).id, idFriend = la.data.sealed.find((x) => !x.toSelf).id;
t('чужую не отменить — 404', (await call(`/api/time/capsules/${idSelf}/cancel`, J({}), b.tok)).status === 404);
t('получатель не отменит чужую', (await call(`/api/time/capsules/${idFriend}/cancel`, J({}), b.tok)).status === 404);
t('locked не отменить — 409', (await call(`/api/time/capsules/${idFriend}/cancel`, J({}), a.tok)).status === 409);
t('своя отменяется', (await call(`/api/time/capsules/${idSelf}/cancel`, J({}), a.tok)).status === 200);
t('подмена автора в теле игнорируется', await (async () => { const r = await call('/api/time/capsules', J({ text: 'про автора', openAt: future(3), authorId: c.pid, recipientId: c.pid }), a.tok); const lc2 = await call('/api/time/capsules', {}, c.tok); return r.status === 200 && lc2.data.sealed.length === 0; })());
// вскрытие по сроку
q(`UPDATE time_capsules SET open_at = now() - interval '1 minute', created_at = now() - interval '2 days' WHERE id = '${idFriend}'`);
const lb2 = await call('/api/time/capsules', {}, b.tok); t('после срока получатель читает текст', lb2.data.opened.length === 1 && lb2.data.opened[0].text === 'Тебе, друг', JSON.stringify(lb2.data.opened));
const la2 = await call('/api/time/capsules', {}, a.tok); t('автор тоже читает вскрытую', la2.data.opened.some((x) => x.text === 'Тебе, друг'));
t('посторонний вскрытую не читает', (await call('/api/time/capsules', {}, c.tok)).data.opened.length === 0);
t('уведомление получателю', Number(q(`SELECT count(*) FROM gift_notifications WHERE user_id='${b.pid}' AND kind='capsule_open'`)) === 1);
t('в БД текст зашифрован', !q(`SELECT text_enc FROM time_capsules WHERE id='${idFriend}'`).includes('Тебе, друг'));

// Sky Balance
const b0 = await call('/api/time/balance', {}, a.tok); t('баланс: учёт по умолчанию выключен', b0.status === 200 && b0.data.tracking === false);
const u0 = await call('/api/time/usage', J({ entries: [{ module: 'music', seconds: 50 }] }), a.tok); t('пока выключено — не пишется', u0.data.skipped === true, JSON.stringify(u0.data));
t('плохие значения — 400', (await call('/api/time/balance', P({ tracking: true, dailyTotal: 2 }), a.tok)).status === 400 && (await call('/api/time/balance', P({ tracking: true, quietFrom: 60 }), a.tok)).status === 400);
const sv = await call('/api/time/balance', P({ tracking: true, dailyTotal: 120, limits: { music: 30, 'bad key!': 5 }, quietFrom: 1380, quietTo: 420, tzOffset: 180 }), a.tok);
t('настройки сохранены, мусорный ключ отброшен', sv.status === 200 && sv.data.limits.music === 30 && !('bad key!' in sv.data.limits), JSON.stringify(sv.data));
t('чужие настройки не видны', (await call('/api/time/balance', {}, b.tok)).data.tracking === false);
const u1 = await call('/api/time/usage', J({ entries: [{ module: 'music', seconds: 50 }, { module: 'bloom', seconds: 20 }] }), a.tok); t('учёт пишется', u1.status === 200 && !u1.data.skipped, JSON.stringify(u1.data));
await call('/api/time/usage', J({ entries: [{ module: 'music', seconds: 90 }] }), a.tok);
const big = await call('/api/time/usage', J({ entries: [{ module: 'music', seconds: 99999 }] }), a.tok);
const rep = await call('/api/time/report?days=7', {}, a.tok);
t('отчёт: сумма по настоящим данным и потолок на пачку', rep.status === 200 && rep.data.byModule.find((m) => m.module === 'music').seconds <= 50 + 90 + 120 && rep.data.byModule.find((m) => m.module === 'bloom').seconds === 20, JSON.stringify(rep.data.byModule) + JSON.stringify(big.data));
t('отчёт чужого пуст', (await call('/api/time/report?days=7', {}, b.tok)).data.total === 0);
t('очистка статистики', (await call('/api/time/usage', { method: 'DELETE' }, a.tok)).status === 200 && (await call('/api/time/report?days=7', {}, a.tok)).data.total === 0);

// В этот день
const old = '2023-' + new Date().toISOString().slice(5, 10);
q(`INSERT INTO bloom_posts (id, author_id, body, created_at) VALUES ('tp-${Date.now()}','${a.pid}','Пост прошлого',  '${old}T10:00:00Z')`);
const td = await call('/api/time/today', {}, a.tok); t('«В этот день» отдаёт пост прошлых лет', td.status === 200 && td.data.items.some((x) => x.kind === 'post' && x.year === 2023), JSON.stringify(td.data).slice(0, 300));
t('«В этот день» чужому — только его', !JSON.stringify((await call('/api/time/today', {}, c.tok)).data).includes('Пост прошлого'));
console.log(`ok ${ok}, fail ${bad}`); process.exit(bad ? 1 : 0);
