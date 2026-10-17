// Правила кэшбэка, заданные администрацией (server/cashbackrules.mjs): создание с кодом, начисление по поводам, пределы, холд, бюджет, вкладки.
// API: ADMIN_GATE=off. (. env.sh; node scripts/audit/cashbackrules-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { pool } = await import('../../server/db.mjs');
const cb = await import('../../server/cashbackrules.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const put = (p, b, u) => call(p, { method: 'PUT', body: JSON.stringify(b ?? {}) }, u?.tok);
const get = (p, u) => call(p, {}, u?.tok);
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };

const ADM = await mkuser(S, 'cbrAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${ADM.pid}'`);
const step = async () => { q(`update admin_step_up set used_at = now() where actor_id='${ADM.pid}' and used_at is null`); await post('/api/admin/prime/step-up', {}, ADM); await sleep(1300); return codeOf(ADM.email); };
const U = await mkuser(S, 'cbrUser'); const V = await mkuser(S, 'cbrOther'); const P = await mkuser(S, 'cbrPrime');
const points = (u) => Number(q(`select coalesce((select points from wallet_accounts where user_id='${u.pid}'),0)`));
q(`insert into prime_subscriptions (id, profile_id, status, plan, expires_at) values ('prime-cbr-${P.pid.slice(-6)}', '${P.pid}', 'active', 'standard', now() + interval '30 days') on conflict do nothing`);
q(`delete from cashback_rules`);
const mk = async (b) => { const r = await post('/api/admin/prime/cashback/rules', { stepUpCode: await step(), ...b }, ADM); return r; };
const run = async (ev) => { const c = await pool.connect(); try { await c.query('BEGIN'); const x = await cb.awardIn(c, ev); await c.query('COMMIT'); return x.granted; } finally { c.release(); } };

// права и коды
t('обычный человек правил не видит', (await get('/api/admin/prime/cashback/rules', U)).status === 403);
t('создание без кода отклонено', (await post('/api/admin/prime/cashback/rules', { title: 'Такси', trigger: 'go_taxi', kind: 'percent', percent: 5 }, ADM)).status === 401);
let r = await mk({ title: 'Такси 5%', trigger: 'go_taxi', kind: 'percent', percent: 5, minAmountRub: 100, maxPointsEvent: 50, perUserDayEvents: 2, perUserMonthPoints: 80, holdDays: 0, status: 'active' });
t('правило «такси 5%» создано', r.status === 200 && r.data.id?.startsWith('cbr-'), JSON.stringify(r.data));
const taxi = r.data.id;
r = await mk({ title: 'Плохое', trigger: 'nope', kind: 'percent', percent: 5 });
t('неизвестный повод отклонён', r.status === 400 && r.data.field === 'trigger');
r = await mk({ title: 'Плохое', trigger: 'tab_visit', tab: 'xxx', kind: 'fixed', fixedPoints: 5 });
t('неизвестная вкладка отклонена', r.status === 400 && r.data.field === 'tab');
r = await mk({ title: 'Плохой процент', trigger: 'go_taxi', kind: 'percent', percent: 150 });
t('процент больше 100 отклонён', r.status === 400 && r.data.field === 'percent');
r = await mk({ title: 'Конец раньше начала', trigger: 'go_taxi', kind: 'fixed', fixedPoints: 5, startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' });
t('окно с концом раньше начала отклонено', r.status === 400 && r.data.field === 'endsAt');

// такси
let g = await run({ trigger: 'go_taxi', profileId: U.pid, counterpartyId: V.pid, amountRub: 400, ref: 'go:t1' });
t('такси 400 ₽ × 5% = 20 баллов сразу', g.length === 1 && g[0].points === 20 && points(U) === 20, JSON.stringify(g));
g = await run({ trigger: 'go_taxi', profileId: U.pid, counterpartyId: V.pid, amountRub: 400, ref: 'go:t1' });
t('повтор по тому же заказу не начисляет', g.length === 0 && points(U) === 20);
g = await run({ trigger: 'go_taxi', profileId: U.pid, counterpartyId: V.pid, amountRub: 50, ref: 'go:t2' });
t('сумма ниже минимума — ничего', g.length === 0);
g = await run({ trigger: 'go_taxi', profileId: U.pid, counterpartyId: U.pid, amountRub: 400, ref: 'go:t3' });
t('сам себе — ничего', g.length === 0);
g = await run({ trigger: 'go_taxi', profileId: U.pid, counterpartyId: V.pid, amountRub: 5000, ref: 'go:t4' });
t('потолок за раз (50) и остаток месячного предела (80−20=60 → 50)', g.length === 1 && g[0].points === 50 && points(U) === 70, JSON.stringify(g));
g = await run({ trigger: 'go_taxi', profileId: U.pid, counterpartyId: V.pid, amountRub: 5000, ref: 'go:t5' });
t('суточный предел (2) — третье не начисляется', g.length === 0 && points(U) === 70);
g = await run({ trigger: 'go_delivery', profileId: U.pid, counterpartyId: V.pid, amountRub: 5000, ref: 'go:d1' });
t('другой повод без правила — ничего', g.length === 0);

// параллельные одинаковые события
const refs = await Promise.all([1, 2, 3].map(() => run({ trigger: 'go_taxi', profileId: V.pid, counterpartyId: U.pid, amountRub: 400, ref: 'go:race' })));
t('одновременные повторы дают одно начисление', refs.flat().length === 1 && points(V) === 20, JSON.stringify(refs));

// Prime-покупка: только с Prime, с холдом, отмена при возврате
r = await mk({ title: 'Prime 10%', trigger: 'prime_purchase', kind: 'percent', percent: 10, maxPointsEvent: 1000, holdDays: 3, primeOnly: true, status: 'active' });
t('правило покупки Prime создано', r.status === 200);
r = await mk({ title: 'Еда бюджет', trigger: 'go_food', kind: 'fixed', fixedPoints: 30, holdDays: 0, budgetPoints: 50, status: 'active' });
const food = r.data.id;
await sleep(10500);   // у тестового процесса свой кэш правил (10 с)
g = await run({ trigger: 'prime_purchase', profileId: U.pid, amountRub: 1000, ref: 'prime:u1' });
t('«только Prime» не даёт тем, у кого нет Prime', g.length === 0);
g = await run({ trigger: 'prime_purchase', profileId: P.pid, amountRub: 1000, ref: 'prime:p1' });
t('с Prime: 10% от 1000 = 100 баллов, в ожидании', g.length === 1 && g[0].points === 100 && g[0].status === 'pending' && points(P) === 0, JSON.stringify(g));
t('до срока релиз ничего не зачисляет', (await cb.releaseDue()) === 0 && points(P) === 0);
q(`update cashback_grants set release_at = now() - interval '1 minute' where ref='prime:p1'`);
t('по сроку зачисляется ровно раз', (await cb.releaseDue()) === 1 && points(P) === 100 && (await cb.releaseDue()) === 0);
g = await run({ trigger: 'prime_purchase', profileId: P.pid, amountRub: 500, ref: 'prime:p2' });
t('отмена ожидающего начисления по ссылке', (await cb.cancelByRef('prime:p2', 'возврат')) === 1 && q(`select status from cashback_grants where ref='prime:p2'`) === 'cancelled' && points(P) === 100);
t('бюджет правила вернулся при отмене', Number(q(`select spent_points from cashback_rules where title='Prime 10%'`)) === 100);

// бюджет
const gs = await Promise.all([1, 2, 3].map((i) => run({ trigger: 'go_food', profileId: [U, V, P][i - 1].pid, counterpartyId: ADM.pid, amountRub: 300, ref: `go:f${i}` })));
t('общий бюджет 50 при 30 за раз: выдано одно начисление (атомарно)', gs.flat().length === 1 && Number(q(`select spent_points from cashback_rules where id='${food}'`)) === 30, JSON.stringify(gs));

// пауза и окно
r = await post(`/api/admin/prime/cashback/rules/${taxi}/status`, { status: 'paused', stepUpCode: await step() }, ADM);
t('пауза правила', r.status === 200);
await sleep(10500);
g = await run({ trigger: 'go_taxi', profileId: P.pid, counterpartyId: V.pid, amountRub: 400, ref: 'go:t9' });
t('на паузе не начисляется', g.length === 0);
r = await post(`/api/admin/prime/cashback/rules/${taxi}/status`, { status: 'ended', stepUpCode: await step() }, ADM);
r = await post(`/api/admin/prime/cashback/rules/${taxi}/status`, { status: 'active', stepUpCode: await step() }, ADM);
t('завершённое правило не возобновить', r.status === 409);

// вкладки
r = await mk({ title: 'Заходи в музыку', trigger: 'tab_visit', tab: 'music', kind: 'fixed', fixedPoints: 5, maxPointsEvent: 5, status: 'active' });
t('правило вкладки создано', r.status === 200, JSON.stringify(r.data));
await sleep(10500);
r = await post('/api/prime/cashback/visit', { tab: 'music' }, U);
t('вкладка: +5 баллов', r.status === 200 && r.data.granted?.[0]?.points === 5, JSON.stringify(r.data));
const pu = points(U);
r = await post('/api/prime/cashback/visit', { tab: 'music' }, U);
t('вкладка повторно в тот же день — ничего', r.status === 200 && r.data.granted.length === 0 && points(U) === pu);
r = await post('/api/prime/cashback/visit', { tab: 'film' }, U);
t('вкладка без правила — ничего', r.status === 200 && r.data.granted.length === 0);
r = await post('/api/prime/cashback/visit', { tab: 'hack' }, U);
t('чужой ключ вкладки отклонён', r.status === 400);


// ── реальные хуки: оплата заказа GO и покупка Prime ──
const gopay = await import('../../server/gopay.mjs');
r = await mk({ title: 'Доставка 10%', trigger: 'go_delivery', kind: 'percent', percent: 10, maxPointsEvent: 100, holdDays: 0, status: 'active' });
await sleep(10500);
const W = await mkuser(S, 'cbrW'); const X = await mkuser(S, 'cbrX');
const order = (id, internal) => {
  q(`insert into go_orders (id, kind, customer_id, executor_id, status, price_rub, data) values ('${id}','delivery','${W.pid}','${X.pid}','payment_reported',300,'${internal ? '{"internal":true}' : '{}'}')`);
  q(`insert into go_order_pay (order_id, payer_id, payee_id, amount_rub, state) values ('${id}','${W.pid}','${X.pid}',300,'reported')`);
};
order('go-cbr-1', false); order('go-cbr-2', true);
const before = points(W);
const cp = await gopay.confirmPaid(X.pid, 'go-cbr-1');
t('подтверждение оплаты доставки начисляет 10% заказчику', cp.ok && points(W) === before + 30, JSON.stringify(cp));
const cp2 = await gopay.confirmPaid(X.pid, 'go-cbr-1');
t('повторное подтверждение не начисляет второй раз', !cp2.ok && points(W) === before + 30);
await gopay.confirmPaid(X.pid, 'go-cbr-2');
t('заказ своего сотрудника организации кэшбэка не даёт', points(W) === before + 30);
await cb.cancelByRef('go:go-cbr-1', 'тест');
t('начисленное (не ожидающее) возвратом не отменяется', points(W) === before + 30);
q(`insert into wallet_accounts (user_id, balance, points) values ('${X.pid}', 1000, 0) on conflict (user_id) do update set balance = 1000`);
r = await mk({ title: 'Покупка Prime 5%', trigger: 'prime_purchase', kind: 'percent', percent: 5, maxPointsEvent: 1000, holdDays: 0, status: 'active' });
r = await post('/api/skyid/prime/grant', { days: 30 }, X);
await sleep(800);
t('покупка Prime через настоящую ручку: 5% от 399 = 19 баллов', r.status === 200 && points(X) >= 19, `${r.status} ${points(X)}`);

// публичный список и журнал
r = await get('/api/prime/cashback', U);
t('человек видит действующие правила и свои начисления', r.status === 200 && r.data.adminRules?.some((x) => x.title === 'Заходи в музыку') && r.data.grants?.length >= 2, JSON.stringify(r.data).slice(0, 200));
r = await get('/api/admin/prime/cashback/rules', ADM);
t('админ видит правила и суммы выдачи', r.status === 200 && r.data.rules.length >= 4 && r.data.meta.tabs.length > 5);
r = await get(`/api/admin/prime/cashback/grants?rule=${taxi}`, ADM);
t('журнал начислений по правилу', r.status === 200 && r.data.items.length >= 2);
t('изменения записаны в журнал администрации', Number(q(`select count(*) from admin_log where type='cashback_rule'`)) >= 5);

console.log(`\nИТОГО: ${ok} ok, ${bad} fail`);
await pool.end(); process.exit(bad ? 1 : 0);
