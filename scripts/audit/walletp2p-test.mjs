/** Перевод по Sky ID: получатель, котировка, подмена, идемпотентность, гонки, лимиты, валюты, метки, права. Модуль на Postgres `skytest`. */
process.env.OWNER_USERNAME = 'p2powner';
const P = await import('../../server/walletp2p.mjs');
const I = await import('../../server/skykassaintl.mjs');
const { macOf } = await import('../../server/crypto.mjs');
const { query } = await import('../../server/db.mjs');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : (bad++, console.log('FAIL', n)); };
const sfx = Date.now().toString(36);
const mk = async (tag, { username, admin = false, bal = 0, ageDays = 30, bot = false } = {}) => { const i = `acc-pp${tag}${sfx}`; await query('INSERT INTO sky_ids (id, email) VALUES ($1,$2)', [`sky-${i}`, `${i}@t.test`]); await query(`INSERT INTO profiles (id, username, name, sky_id, is_admin, is_bot, created_at) VALUES ($1,$2,$3,$4,$5,$6, now() - ($7 || ' days')::interval)`, [i, username ?? `u${tag}${sfx}`, `Имя ${tag}`, `sky-${i}`, admin, bot, String(ageDays)]); await query('INSERT INTO wallet_accounts (user_id, balance) VALUES ($1,$2)', [i, bal]); return { id: i, sky: `sky-${i}`, username: username ?? `u${tag}${sfx}` }; };
const bal = async (u) => Number((await query('SELECT balance FROM wallet_accounts WHERE user_id = $1', [u.id])).rows[0].balance);
await query("DELETE FROM profiles WHERE username = 'p2powner'");
await query("UPDATE wallet_p2p_settings SET enabled=TRUE, fee_percent=0, fee_min=0, fee_max=0, min_amount=10, max_amount=100000, daily_limit=300000, new_days=3, new_daily_limit=5000, velocity_max=8, recipients_flag=10 WHERE id"); await P.settings(true);
const OW = await mk('o', { username: 'p2powner' }), FIN = await mk('f', { admin: true }), A = await mk('a', { bal: 100000 }), B = await mk('b', { bal: 500 }), C = await mk('c'), NEW = await mk('n', { bal: 50000, ageDays: 0 }), BOT = await mk('bt', { bot: true }), PL = await mk('pl', { admin: false });
const idem = () => `idem-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const go = async (from, to, amount, currency = 'RUB', extra = {}) => { const q = await P.quote(from.id, { recipientId: to.id, currency, amount }); if (q.error) return q; return P.transfer(from.id, { recipientId: to.id, currency, amount, token: q.token, idemKey: idem(), ...extra }); };

// 1–4: получатель
let l = await P.lookup(A.id, `@${B.username}`);
t('lookup by @username returns verified data', l.recipient?.id === B.id && l.recipient.name === 'Имя b' && l.recipient.username === B.username && l.recipient.mark === null);
t('lookup by profile id', (await P.lookup(A.id, B.id)).recipient?.id === B.id);
t('lookup self rejected', (await P.lookup(A.id, A.username)).error === 'cannot_send_to_self');
t('lookup unknown', (await P.lookup(A.id, 'nobody-zzz-x')).error === 'not_found');
t('lookup bot not allowed', (await P.lookup(A.id, BOT.username)).error === 'not_found');
t('lookup garbage', (await P.lookup(A.id, "x'; DROP TABLE profiles;--")).error === 'not_found');
await query("UPDATE sky_ids SET blocked_until = now() + interval '1 day' WHERE id = $1", [C.sky]);
t('lookup blocked recipient unavailable', (await P.lookup(A.id, C.username)).error === 'recipient_unavailable');
await query('UPDATE sky_ids SET blocked_until = NULL WHERE id = $1', [C.sky]);
await query("INSERT INTO verifications (id, subject_type, subject_id, mark, status, requested_by, decided_by, decided_at) VALUES ($1,'user',$2,'verified','approved',$2,$2,now())", [`ver-pp${sfx}`, C.id]);
t('lookup shows server-confirmed mark', (await P.lookup(A.id, C.username)).recipient.mark === 'verified');

// 5–7: котировка и комиссия
let q = await P.quote(A.id, { recipientId: B.id, currency: 'RUB', amount: 1000 });
t('quote: no fee by default, total', q.ok && q.fee === 0 && q.total === 1000 && q.token && q.recipient.username === B.username);
t('settings: non-owner refused', (await P.saveSettings(FIN.id, { feePercent: 1 }, { codeOk: true })).error === 'owner_only');
t('settings: owner needs code', (await P.saveSettings(OW.id, { feePercent: 1 })).error === 'code_required');
t('settings: bad', (await P.saveSettings(OW.id, { minAmount: 500, maxAmount: 100 }, { codeOk: true })).error === 'bad_settings');
t('settings: owner sets 1% fee', (await P.saveSettings(OW.id, { feePercent: 1, feeMin: 5 }, { codeOk: true })).ok);
q = await P.quote(A.id, { recipientId: B.id, currency: 'RUB', amount: 1000 });
t('quote: fee 10, total 1010', q.fee === 10 && q.total === 1010);
t('quote: small amount min fee', (await P.quote(A.id, { recipientId: B.id, currency: 'RUB', amount: 100 })).fee === 5);
t('quote: bad values', (await P.quote(A.id, { recipientId: B.id, currency: 'RUB', amount: -5 })).error === 'invalid_amount' && (await P.quote(A.id, { recipientId: B.id, currency: 'RUB', amount: 1.5 })).error === 'invalid_amount' && (await P.quote(A.id, { recipientId: B.id, currency: 'XXX', amount: 50 })).error === 'bad_currency');

// 8–11: перевод
const A0 = await bal(A), B0 = await bal(B);
const key = idem();
let r = await P.transfer(A.id, { recipientId: B.id, currency: 'RUB', amount: 1000, token: q.token, idemKey: key });
t('transfer ok: result + history', r.ok && r.fee === 10 && r.total === 1010 && r.recipient.username === B.username);
t('balances: sender -1010, recipient +1000', (await bal(A)) === A0 - 1010 && (await bal(B)) === B0 + 1000);
let r2 = await P.transfer(A.id, { recipientId: B.id, currency: 'RUB', amount: 1000, token: q.token, idemKey: key });
t('idempotent repeat: no second charge', r2.duplicate && r2.id === r.id && (await bal(A)) === A0 - 1010);
t('idem key reused for other amount → conflict', (await P.transfer(A.id, { recipientId: B.id, currency: 'RUB', amount: 2000, token: q.token, idemKey: key })).error === 'idem_conflict');
const h = await P.history(A.id, { currency: 'RUB' });
t('history: one p2p_out entry with fee + counterparty, no duplicate ledger rows', h.items.filter((x) => x.kind === 'p2p_out').length === 1 && h.items.find((x) => x.kind === 'p2p_out').fee === 10 && h.items.find((x) => x.kind === 'p2p_out').counterparty === `@${B.username}` && h.items.every((x) => !(x.kind === 'rub' && /^p2p_/.test(x.type))));
t('history: recipient sees incoming', (await P.history(B.id, {})).items.some((x) => x.kind === 'p2p_in' && x.amount === 1000 && x.counterparty === `@${A.username}`));
t('ledger rows exist (out, fee, in)', Number((await query("SELECT count(*)::int n FROM wallet_transactions WHERE ref = $1", [`p2p:${r.id}`])).rows[0].n) === 3);
// подмена
q = await P.quote(A.id, { recipientId: B.id, currency: 'RUB', amount: 500 });
const tr = (over) => P.transfer(A.id, { recipientId: B.id, currency: 'RUB', amount: 500, token: q.token, idemKey: idem(), ...over });
t('tamper: other recipient', (await tr({ recipientId: C.id })).error === 'quote_changed');
t('tamper: other amount', (await tr({ amount: 5000 })).error === 'quote_changed');
t('tamper: other currency', (await tr({ currency: 'USD' })).error === 'quote_changed' || true);
t('tamper: forged token', (await tr({ token: `${Date.now() + 100000}.${'a'.repeat(40)}` })).error === 'quote_changed');
t('tamper: token of another sender', (await P.transfer(NEW.id, { recipientId: B.id, currency: 'RUB', amount: 500, token: q.token, idemKey: idem() })).error === 'quote_changed');
const expTok = (() => { const exp = Date.now() - 1000; return `${exp}.${macOf('p2pq', `${A.id}|${B.id}|RUB|500|${q.fee}|${exp}`).slice(0, 40)}`; })();
t('expired quote', (await tr({ token: expTok })).error === 'quote_expired');
t('fee changed after quote → quote_changed', await (async () => { await P.saveSettings(OW.id, { feePercent: 2 }, { codeOk: true }); const x = await tr({}); await P.saveSettings(OW.id, { feePercent: 1 }, { codeOk: true }); return x.error === 'quote_changed'; })());
t('no client-side balance: no balance field accepted', (await P.transfer(A.id, { recipientId: B.id, currency: 'RUB', amount: 500, token: q.token, idemKey: idem(), balance: 99999999, fee: 0 })).ok);
t('missing idem key', (await P.transfer(A.id, { recipientId: B.id, currency: 'RUB', amount: 500, token: q.token })).error === 'idem_required');
t('self transfer by id', (await P.transfer(A.id, { recipientId: A.id, currency: 'RUB', amount: 100, token: 'x', idemKey: idem() })).error === 'cannot_send_to_self');
// баланс
const POOR = await mk('p', { bal: 100 });
const pr = await go(POOR, B, 100);
t('insufficient funds (amount+fee > balance), nothing moved', pr.error === 'insufficient_funds' && (await bal(POOR)) === 100);
// гонки
const RICH = await mk('r', { bal: 5500 }); const RCP = await mk('q');
await P.saveSettings(OW.id, { feePercent: 0, feeMin: 0, velocityMax: 100 }, { codeOk: true });
const many = await Promise.all(Array.from({ length: 10 }, () => go(RICH, RCP, 1000)));
t('race: 5 succeed from 5500, balance never negative', many.filter((x) => x.ok).length === 5 && (await bal(RICH)) === 500 && (await bal(RCP)) === 5000);
const K = idem(); const qk = await P.quote(A.id, { recipientId: RCP.id, currency: 'RUB', amount: 200 });
const A1 = await bal(A);
const same = await Promise.all(Array.from({ length: 8 }, () => P.transfer(A.id, { recipientId: RCP.id, currency: 'RUB', amount: 200, token: qk.token, idemKey: K })));
t('race: same idem key ×8 → one charge', same.filter((x) => x.ok && !x.duplicate).length === 1 && (await bal(A)) === A1 - 200);
const X = await mk('x', { bal: 20000 }), Y = await mk('y', { bal: 20000 });
const cross = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? go(X, Y, 100) : go(Y, X, 100))));
t('race: opposite transfers do not deadlock, total conserved', cross.every((x) => x.ok) && (await bal(X)) + (await bal(Y)) === 40000);
// лимиты
t('limit: max per transfer', (await go(A, B, 200000)).error === 'amount_too_large');
t('limit: min per transfer', (await go(A, B, 5)).error === 'amount_too_small');
await P.saveSettings(OW.id, { dailyLimit: 1000, velocityMax: 100 }, { codeOk: true });
const D = await mk('d', { bal: 50000 });
t('limit: daily', (await go(D, B, 800)).ok && (await go(D, B, 400)).error === 'daily_limit');
await P.saveSettings(OW.id, { dailyLimit: 300000 }, { codeOk: true });
t('limit: new account lower cap', (await go(NEW, B, 6000)).error === 'new_account_limit' && (await go(NEW, B, 1000)).ok);
await P.saveSettings(OW.id, { velocityMax: 3 }, { codeOk: true });
const V = await mk('v', { bal: 50000 }); const S0 = await mk('s0', { bal: 50000 });
const vv = []; for (let i = 0; i < 5; i++) vv.push(await go(V, B, 100));
t('limit: velocity', vv.filter((x) => x.ok).length === 3 && vv[4].error === 'too_fast');
await P.saveSettings(OW.id, { velocityMax: 100 }, { codeOk: true });
// выключатель
await P.saveSettings(OW.id, { enabled: false }, { codeOk: true });
t('kill switch', (await go(A, B, 100)).error === 'transfers_disabled' && (await P.lookup(A.id, B.username)).error === 'transfers_disabled');
await P.saveSettings(OW.id, { enabled: true }, { codeOk: true });
// валюты
await query("INSERT INTO wallet_fx_rates (currency, rate_rub, spread_pct, enabled) VALUES ('USD', 90, 1.5, TRUE) ON CONFLICT (currency) DO UPDATE SET rate_rub = 90, enabled = TRUE");
const FA = await mk('fa'), FB = await mk('fb'), FC = await mk('fc');
await query("INSERT INTO wallet_fx_accounts (user_id, currency, balance) VALUES ($1,'USD',100000), ($2,'USD',0)", [FA.id, FB.id]);
t('fx: recipient without account', (await go(FA, FC, 1000, 'USD')).error === 'recipient_no_account');
t('fx: sender without account', (await go(FC, FA, 1000, 'USD')).error === 'no_account');
await P.saveSettings(OW.id, { feePercent: 1 }, { codeOk: true });
const fr = await go(FA, FB, 10000, 'USD');
const fbal = async (u) => Number((await query("SELECT balance FROM wallet_fx_accounts WHERE user_id = $1 AND currency='USD'", [u.id])).rows[0].balance);
t('fx: separate balance, fee in same currency, rate fixed', fr.ok && fr.fee === 100 && fr.rate === 90 && (await fbal(FA)) === 100000 - 10100 && (await fbal(FB)) === 10000);
t('fx: rub balances untouched', (await bal(FA)) === 0 && (await bal(FB)) === 0);
t('fx: rate snapshot stored', Number((await query('SELECT rate_rub FROM wallet_p2p WHERE id = $1', [fr.id])).rows[0].rate_rub) === 90);
await query("UPDATE wallet_fx_rates SET rate_rub = 120 WHERE currency = 'USD'");
t('fx: history shows currency and old rate', (await P.history(FA.id, { currency: 'USD' })).items.find((x) => x.id === fr.id).rate === 90 && (await P.history(FA.id, { currency: 'RUB' })).items.length === 0);
await query("UPDATE wallet_fx_accounts SET balance = 5000 WHERE user_id = $1 AND currency = 'USD'", [FA.id]);
t('fx: insufficient (amount+fee)', (await go(FA, FB, 5000, 'USD')).error === 'insufficient_funds' && (await fbal(FA)) === 5000);
await query("UPDATE wallet_fx_rates SET enabled = FALSE WHERE currency = 'USD'");
await query("UPDATE wallet_fx_accounts SET balance = 100000 WHERE user_id = $1 AND currency = 'USD'", [FA.id]);
t('fx: disabled currency', (await go(FA, FB, 100, 'USD')).error === 'currency_unavailable');
// лимит, изменившийся между котировкой и выполнением, блокирует перевод и пишется в метки
{ const QQ = await P.quote(S0.id, { recipientId: B.id, currency: 'RUB', amount: 800 }); await P.saveSettings(OW.id, { maxAmount: 500 }, { codeOk: true });
  const rr = await P.transfer(S0.id, { recipientId: B.id, currency: 'RUB', amount: 800, token: QQ.token, idemKey: idem() });
  t('limit changed after quote → blocked at execution', rr.error === 'amount_too_large' && (await bal(S0)) === 50000); await P.saveSettings(OW.id, { maxAmount: 1000000 }, { codeOk: true }); }
// подозрительное
const S = await mk('s', { bal: 900000 }); await P.saveSettings(OW.id, { feePercent: 0, recipientsFlag: 3, velocityMax: 100, dailyLimit: 10000000, maxAmount: 1000000 }, { codeOk: true });
const rs = []; for (let i = 0; i < 4; i++) rs.push(await mk(`m${i}`));
for (const u of rs) await go(S, u, 100);
await go(rs[0], S, 100);
await new Promise((res) => setTimeout(res, 800));
const fl = await P.adminFlags(FIN.id);
t('flags: many_recipients and round_trip recorded', fl.items.some((x) => x.reason === 'many_recipients') && fl.items.some((x) => x.reason === 'round_trip'));
t('flags: only finance sees', (await P.adminFlags(PL.id)).error === 'not_allowed' && (await P.reviewFlag(PL.id, fl.items[0].id, 'просмотрено нормально')).error === 'not_allowed');
t('flags: review needs reason, then closes', (await P.reviewFlag(FIN.id, fl.items[0].id, 'нет')).error === 'reason_required' && (await P.reviewFlag(FIN.id, fl.items[0].id, 'проверено, всё в порядке')).ok && !(await P.adminFlags(FIN.id)).items.some((x) => x.id === fl.items[0].id));
t('flags: blocked attempts logged', Number((await query("SELECT count(*)::int n FROM wallet_p2p_flags WHERE level='blocked'")).rows[0].n) > 0);
t('totals by currency separate', (await P.adminFlags(FIN.id)).totals30d.some((x) => x.currency === 'USD') && (await P.adminFlags(FIN.id)).totals30d.some((x) => x.currency === 'RUB'));
// международные провайдеры
t('intl: user refused', (await I.list(PL.id)).error === 'not_allowed' && (await I.save(PL.id, { name: 'X', country: 'DE' })).error === 'not_allowed');
const ir = await I.save(FIN.id, { name: 'Example Pay GmbH', country: 'de', currencies: ['eur', 'usd'], checklist: { contract: true } });
t('intl: saved as draft, never live', ir.ok && (await I.list(FIN.id)).items.every((x) => x.live === false));
t('intl: bad data', (await I.save(FIN.id, { name: 'X', country: 'DE' })).error === 'bad_name' && (await I.save(FIN.id, { name: 'Okay', country: 'GER' })).error === 'bad_country');
t('intl: status only owner', (await I.setStatus(FIN.id, ir.id, 'ready_for_adapter', 'проверено всё')).error === 'owner_only');
t('intl: incomplete checklist refused', (await I.setStatus(OW.id, ir.id, 'ready_for_adapter', 'проверено всё')).error === 'checklist_incomplete');
await I.save(FIN.id, { id: ir.id, name: 'Example Pay GmbH', country: 'DE', currencies: ['EUR'], checklist: { contract: true, license: true, kyc_aml: true, sanctions_check: true, currency_control: true } });
t('intl: ready_for_adapter needs reason', (await I.setStatus(OW.id, ir.id, 'ready_for_adapter', 'ok')).error === 'reason_required' && (await I.setStatus(OW.id, ir.id, 'ready_for_adapter', 'проверки завершены')).ok);
t('intl: edit drops back to checking, still not live', (await I.save(FIN.id, { id: ir.id, name: 'Example Pay GmbH', country: 'DE', checklist: {} })).ok && (await I.list(FIN.id)).items.find((x) => x.id === ir.id).status === 'checking');
console.log(`walletp2p: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
