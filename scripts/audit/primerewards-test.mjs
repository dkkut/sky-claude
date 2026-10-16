// Модули 3–4: кэшбэк Prime Points и серверный каталог наград (server/primecashback.mjs, primerewards.mjs).
// API: ADMIN_GATE=off. (. env.sh; node scripts/audit/primerewards-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { pool } = await import('../../server/db.mjs');
const { scheduleCashbackIn, releaseDueCashback } = await import('../../server/primecashback.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const put = (p, b, u) => call(p, { method: 'PUT', body: JSON.stringify(b ?? {}) }, u?.tok);
const get = (p, u) => call(p, {}, u?.tok);
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };

const ADM = await mkuser(S, 'primeAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${ADM.pid}'`);
const step = async () => { q(`update admin_step_up set used_at = now() where actor_id='${ADM.pid}' and used_at is null`); await post('/api/admin/prime/step-up', {}, ADM); await sleep(1300); return codeOf(ADM.email); };
const BUY = await mkuser(S, 'primeBuy'); const SEL = await mkuser(S, 'primeSel'); const NOP = await mkuser(S, 'primeNop');
const points = (u) => Number(q(`select coalesce((select points from wallet_accounts where user_id='${u.pid}'),0)`));
const give = (u, n) => q(`insert into wallet_accounts (user_id, balance, points) values ('${u.pid}', 0, ${n}) on conflict (user_id) do update set points = ${n}`);
const primeOn = (u) => q(`insert into prime_subscriptions (id, profile_id, status, plan, expires_at) values ('prime-t-${u.pid.slice(-6)}', '${u.pid}', 'active', 'standard', now() + interval '30 days') on conflict do nothing`);
primeOn(BUY); q(`update profiles set is_prime=true where id='${BUY.pid}'`);
q(`delete from prime_cashback`); q(`delete from prime_rewards`);

// ── права ──
t('обычный человек админку Prime не видит', (await get('/api/admin/prime', BUY)).status === 403);
t('изменение без подтверждения личности отклонено', (await put('/api/admin/prime/cashback/settings', { settings: { primePercent: 5 } }, ADM)).status === 401);
let r = await put('/api/admin/prime/cashback/settings', { settings: { primePercent: 3, basePercent: 0, minOrderRub: 300, maxPointsPerOrder: 500, maxPointsPerMonth: 700, maxPointsPerSellerMonth: 600, holdDays: 7, enabled: true }, stepUpCode: await step() }, ADM);
t('настройки кэшбэка сохраняются (с кодом)', r.status === 200 && r.data.settings.maxPointsPerMonth === 700, JSON.stringify(r.data));
r = await put('/api/admin/prime/cashback/settings', { settings: { primePercent: 99 }, stepUpCode: await step() }, ADM);
t('процент вне допустимого отклоняется', r.status === 400 && r.data.field === 'primePercent');

// ── кэшбэк (запись внутри транзакции завершения заказа) ──
const sched = async (o) => { const c = await pool.connect(); try { await c.query('BEGIN'); const x = await scheduleCashbackIn(c, o); await c.query('COMMIT'); return x; } finally { c.release(); } };
const ord = (n, kop, b = BUY, s = SEL) => ({ id: `mo-test-${n}-${Date.now()}`, buyer_id: b.pid, seller_id: s.pid, total_kop: kop });
let x = await sched(ord(1, 20000));
t('заказ ниже минимума — кэшбэка нет', x.skipped === 'below_min', JSON.stringify(x));
x = await sched(ord(2, 100000, SEL, SEL));
t('сам себе — кэшбэка нет', x.skipped === 'self');
x = await sched(ord(3, 100000, NOP, SEL));
t('не Prime при базовой ставке 0 — кэшбэка нет', x.skipped === 'no_rate', JSON.stringify(x));
const o4 = ord(4, 1000000);        // 10 000 ₽ × 3% = 300
x = await sched(o4);
t('Prime: 3% от 10 000 ₽ = 300 баллов, статус «ожидает»', x.points === 300 && q(`select status from prime_cashback where order_id='${o4.id}'`) === 'pending', JSON.stringify(x));
x = await sched(o4);
t('повтор по тому же заказу не создаёт второй кэшбэк', x.skipped === 'duplicate' && q(`select count(*) from prime_cashback where order_id='${o4.id}'`) === '1');
const before = points(BUY);
t('до срока баллы не зачислены', points(BUY) === before && (await releaseDueCashback()) === 0);
x = await sched(ord(5, 2000000));
t('предел на продавца в месяц (600) режет начисление до 300', x.points === 300, JSON.stringify(x));
x = await sched(ord(6, 2000000));
t('когда лимит исчерпан — кэшбэка нет', x.skipped === 'limit', JSON.stringify(x));
const cid = q(`select id from prime_cashback where order_id like 'mo-test-5-%'`);
r = await post(`/api/admin/prime/cashback/${cid}/cancel`, { reason: 'сговор', stepUpCode: await step() }, ADM);
t('сотрудник отменяет ожидающий кэшбэк (причина, код)', r.status === 200 && q(`select status from prime_cashback where id='${cid}'`) === 'cancelled', JSON.stringify(r.data));
q(`update prime_cashback set release_at = now() - interval '1 minute' where status='pending'`);
const paid = await releaseDueCashback();
t('по сроку зачисляется ровно одна запись (отменённая — нет)', paid === 1 && points(BUY) === before + 300, `${paid} ${points(BUY)}`);
t('операция кошелька типа cashback с ref заказа', q(`select count(*) from wallet_transactions where user_id='${BUY.pid}' and type='cashback' and ref='cashback:${o4.id}'`) === '1');
t('повторный запуск не зачисляет второй раз', (await releaseDueCashback()) === 0 && points(BUY) === before + 300);
const [a, b2] = await Promise.all([releaseDueCashback(), releaseDueCashback()]);
t('параллельные запуски не задваивают', a + b2 === 0 && points(BUY) === before + 300);
r = await get('/api/prime/cashback', BUY);
t('человек видит правила и историю', r.status === 200 && r.data.paidPoints === 300 && r.data.rules.primePercent === 3, JSON.stringify(r.data).slice(0, 160));

// ── каталог наград ──
t('каталог пуст, пока администрация ничего не создала', (await get('/api/prime/rewards', BUY)).data.rewards.length === 0);
r = await post('/api/admin/prime/rewards', { title: 'Prime +30 дней', description: 'Дни к подписке', cost: 100, kind: 'prime_days', valueDays: 30, stock: 2, perUserLimit: 1, active: true, stepUpCode: await step() }, ADM);
const R1 = r.data.id; t('награда создаётся', r.status === 200 && /^rwd-/.test(R1), JSON.stringify(r.data));
r = await post('/api/admin/prime/rewards', { title: 'Футболка', cost: 50, kind: 'manual', stock: 5, active: true, stepUpCode: await step() }, ADM);
const R2 = r.data.id;
r = await post('/api/admin/prime/rewards', { title: 'Платина', cost: 10, kind: 'manual', minTier: 'platinum', active: true, stepUpCode: await step() }, ADM);
const R3 = r.data.id;
r = await post('/api/admin/prime/rewards', { title: 'Ошибка', cost: -5, kind: 'prime_days', stepUpCode: await step() }, ADM);
t('некорректная награда отклоняется', r.status === 400);
give(NOP, 150); give(SEL, 0);
const lst = await get('/api/prime/rewards', NOP);
t('человек видит только активные награды', lst.data.rewards.length === 3, JSON.stringify(lst.data.rewards.map((x) => x.title)));
r = await post('/api/prime/rewards/redeem', { rewardId: R1, idemKey: 'key-aaaa-0001' }, SEL);
t('не хватает баллов — 402, ничего не списано', r.status === 402 && points(SEL) === 0, JSON.stringify(r.data));
r = await post('/api/prime/rewards/redeem', { rewardId: R1 }, NOP);
t('без ключа идемпотентности обмен невозможен', r.status === 400);
r = await post('/api/prime/rewards/redeem', { rewardId: R1, idemKey: 'key-aaaa-0002' }, NOP);
t('Prime-награда выдаётся сразу', r.status === 200 && r.data.redemption.status === 'done' && points(NOP) === 50, JSON.stringify(r.data));
t('Prime действительно включён', q(`select count(*) from prime_subscriptions where profile_id='${NOP.pid}' and status='active' and expires_at > now() + interval '29 days'`) === '1');
r = await post('/api/prime/rewards/redeem', { rewardId: R1, idemKey: 'key-aaaa-0002' }, NOP);
t('повтор с тем же ключом не списывает снова', r.status === 200 && r.data.duplicate === true && points(NOP) === 50);
give(NOP, 500);
r = await post('/api/prime/rewards/redeem', { rewardId: R1, idemKey: 'key-aaaa-0003' }, NOP);
t('лимит на человека (1)', r.status === 409 && r.data.error === 'limit_reached', JSON.stringify(r.data));
r = await post('/api/prime/rewards/redeem', { rewardId: R3, idemKey: 'key-aaaa-0004' }, NOP);
t('награда по уровню закрыта для новичка', r.status === 403 && r.data.error === 'tier_too_low', JSON.stringify(r.data));
r = await post('/api/prime/rewards/redeem', { rewardId: R2, idemKey: 'key-aaaa-0005' }, NOP);
t('ручная награда ждёт сотрудника, баллы списаны', r.status === 200 && r.data.redemption.status === 'pending_manual' && points(NOP) === 450, JSON.stringify(r.data));
const rid = r.data.redemption.id;
const qd = await get('/api/admin/prime', ADM);
t('в очереди администрации видна заявка', qd.data.queue.some((z) => z.id === rid));
r = await post(`/api/admin/prime/redemptions/${rid}/reject`, { note: '', stepUpCode: await step() }, ADM);
t('отказ требует причину', r.status === 400 && r.data.error === 'reason_required');
r = await post(`/api/admin/prime/redemptions/${rid}/reject`, { note: 'нет в наличии', stepUpCode: await step() }, ADM);
t('отказ возвращает баллы и остаток', r.status === 200 && points(NOP) === 500 && q(`select stock from prime_rewards where id='${R2}'`) === '5', JSON.stringify(r.data));
r = await post(`/api/admin/prime/redemptions/${rid}/reject`, { note: 'ещё раз', stepUpCode: await step() }, ADM);
t('повторное решение невозможно (баллы не возвращаются дважды)', r.status === 409 && points(NOP) === 500);
r = await post('/api/prime/rewards/redeem', { rewardId: R2, idemKey: 'key-aaaa-0006' }, NOP);
r = await post(`/api/admin/prime/redemptions/${r.data.redemption.id}/approve`, { note: 'выдано', stepUpCode: await step() }, ADM);
t('одобрение отмечает награду выданной', r.status === 200);

// гонка: остаток 1, шесть покупателей одновременно
r = await post('/api/admin/prime/rewards', { title: 'Редкая', cost: 10, kind: 'manual', stock: 1, active: true, stepUpCode: await step() }, ADM);
const R4 = r.data.id; const racers = [];
for (let i = 0; i < 6; i++) { const u = await mkuser(S, 'primeRace' + i); give(u, 100); racers.push(u); }
const res = await Promise.all(racers.map((u, i) => post('/api/prime/rewards/redeem', { rewardId: R4, idemKey: `race-key-${i}-0000` }, u)));
const wins = res.filter((x) => x.status === 200).length;
t('гонка за последний экземпляр: выигрывает ровно один', wins === 1 && q(`select stock from prime_rewards where id='${R4}'`) === '0', res.map((x) => x.status).join());
t('у проигравших баллы целы', racers.filter((u, i) => res[i].status !== 200).every((u) => points(u) === 100));
// параллельные одинаковые запросы с одним ключом
give(SEL, 300); r = await post('/api/admin/prime/rewards', { title: 'Много', cost: 40, kind: 'manual', active: true, stepUpCode: await step() }, ADM); const R5 = r.data.id;
const same = await Promise.all([1, 2, 3, 4].map(() => post('/api/prime/rewards/redeem', { rewardId: R5, idemKey: 'same-key-0000-1' }, SEL)));
t('четыре одинаковых запроса — одно списание', points(SEL) === 260 && q(`select count(*) from prime_redemptions where profile_id='${SEL.pid}' and reward_id='${R5}'`) === '1', `${points(SEL)} ${same.map((x) => x.status)}`);
t('в базе нет отрицательных баллов', Number(q(`select count(*) from wallet_accounts where points < 0`)) === 0);

console.log(`\n${ok} ok, ${bad} fail`); await pool.end(); process.exit(bad ? 1 : 0);
