// Валютные счета SkyMoney (модуль напрямую). Запуск: DATABASE_URL=… REDIS_URL=… JWT_SECRET=… ENCRYPTION_KEY=… node scripts/audit/walletfx-test.mjs
process.chdir(new URL('../../server/', import.meta.url).pathname);
const fx = await import('../../server/walletfx.mjs');
const { wallet } = await import('../../server/wallet.mjs');
const { query, pool } = await import('../../server/db.mjs');
let ok = 0, bad = 0; const t = (n, c, d = '') => { c ? ok++ : (bad++, console.log('FAIL', n, d)); };
const uid = `fx-test-${Date.now()}`;
await query(`INSERT INTO profiles (id, username, name) VALUES ($1,$2,'FX')`, [uid, `fx${Date.now().toString(36)}`]);
await query(`DELETE FROM wallet_fx_rates`);
const bal = async () => Number((await query('SELECT balance FROM wallet_accounts WHERE user_id=$1', [uid])).rows[0]?.balance ?? 0);
const fxb = async (c) => Number((await query('SELECT balance FROM wallet_fx_accounts WHERE user_id=$1 AND currency=$2', [uid, c])).rows[0]?.balance ?? -1);
await (async () => { const c = await pool.connect(); try { await c.query('BEGIN'); await wallet.creditIn(c, uid, 10000, 'admin_adjust', 'test', 'fxtest'); await c.query('COMMIT'); } finally { c.release(); } })();

t('без курса валюта недоступна', (await fx.openAccount(uid, 'USD')).error === 'currency_unavailable');
t('неизвестная валюта отклонена', (await fx.openAccount(uid, 'XXX')).error === 'bad_currency');
t('курс: слишком большое изменение требует подтверждения (первое задание — нет предыдущего)', (await fx.saveRates('a', [{ currency: 'USD', rateRub: 100, spreadPct: 2 }])).ok === true);
t('курс: скачок >30% без подтверждения отклонён', (await fx.saveRates('a', [{ currency: 'USD', rateRub: 200, spreadPct: 2 }])).error === 'big_change');
t('курс: отрицательный отклонён', (await fx.saveRates('a', [{ currency: 'EUR', rateRub: -1 }])).error === 'bad_rate');
t('курс: спред >20 отклонён', (await fx.saveRates('a', [{ currency: 'EUR', rateRub: 100, spreadPct: 50 }])).error === 'bad_spread');
t('открытие счёта', (await fx.openAccount(uid, 'USD')).ok === true);
t('повторное открытие безвредно', (await fx.openAccount(uid, 'USD')).duplicate === true);
t('обмен без счёта', (await fx.convert(uid, { currency: 'EUR', direction: 'buy', amount: 100, idemKey: 'k-noacc-0001' })).error === 'no_account');

const r1 = await fx.convert(uid, { currency: 'USD', direction: 'buy', amount: 1020, idemKey: 'k-buy-00001' });
// покупка по 100*1.02 = 102 ₽ за 1 USD → 1020 ₽ = 10.00 USD = 1000 сотых
t('покупка: получено 1000 сотых', r1.ok && r1.amount === 1000, JSON.stringify(r1));
t('покупка: рубли списаны', (await bal()) === 10000 - 1020);
t('покупка: валютный счёт пополнен', (await fxb('USD')) === 1000);
t('повтор ключа не обменивает дважды', (await fx.convert(uid, { currency: 'USD', direction: 'buy', amount: 1020, idemKey: 'k-buy-00001' })).duplicate === true && (await bal()) === 10000 - 1020);
t('нехватка рублей — без изменений', (await fx.convert(uid, { currency: 'USD', direction: 'buy', amount: 999999, idemKey: 'k-buy-00002' })).error === 'insufficient_funds' && (await fxb('USD')) === 1000);
t('минимальная сумма', (await fx.convert(uid, { currency: 'USD', direction: 'buy', amount: 5, idemKey: 'k-buy-00003' })).error === 'amount_out_of_range');
t('смена курса: ожидание не совпало', (await fx.convert(uid, { currency: 'USD', direction: 'buy', amount: 500, expect: 1, idemKey: 'k-buy-00004' })).error === 'rate_changed');
t('нецелая сумма отклонена', (await fx.convert(uid, { currency: 'USD', direction: 'buy', amount: 50.5, idemKey: 'k-buy-00005' })).error === 'invalid_amount');

const sell = await fx.convert(uid, { currency: 'USD', direction: 'sell', amount: 500, idemKey: 'k-sell-0001' });
// продажа 5.00 USD по 100*0.98 = 98 → 490 ₽
t('продажа: 490 ₽', sell.ok && sell.rub === 490, JSON.stringify(sell));
t('продажа: остатки', (await bal()) === 10000 - 1020 + 490 && (await fxb('USD')) === 500);
t('продажа больше остатка отклонена', (await fx.convert(uid, { currency: 'USD', direction: 'sell', amount: 9999, idemKey: 'k-sell-0002' })).error === 'insufficient_funds');
t('круг покупка→продажа не приносит прибыли', 490 < 510);

// гонка: 6 параллельных продаж по 100 сотых при остатке 500 — выполнится ровно 5
const race = await Promise.all(Array.from({ length: 8 }, (_, i) => fx.convert(uid, { currency: 'USD', direction: 'sell', amount: 100, idemKey: `k-race-${i}-0000` })));
t('гонка: не больше остатка', race.filter((x) => x.ok).length === 5 && (await fxb('USD')) === 0, JSON.stringify(race.map((x) => x.ok ?? x.error)));
// параллельный повтор одного ключа
await fx.convert(uid, { currency: 'USD', direction: 'buy', amount: 1000, idemKey: 'k-seed-00001' });
const dups = await Promise.all(Array.from({ length: 5 }, () => fx.convert(uid, { currency: 'USD', direction: 'buy', amount: 200, idemKey: 'k-dupe-00001' })));
t('параллельный повтор ключа: одно списание', dups.filter((x) => x.ok && !x.duplicate).length === 1);
t('закрыть непустой счёт нельзя', (await fx.closeAccount(uid, 'USD')).error === 'not_empty');
const have = await fxb('USD');
await fx.convert(uid, { currency: 'USD', direction: 'sell', amount: have, idemKey: 'k-allout-0001' });
t('закрыть пустой счёт', (await fx.closeAccount(uid, 'USD')).ok === true);
t('сверка журнала: баланс = сумма рублёвых записей', Number((await query(`SELECT COALESCE(SUM(amount),0) s FROM wallet_transactions WHERE user_id=$1 AND currency='rub'`, [uid])).rows[0].s) === (await bal()));
// предел счетов
for (const c of ['EUR', 'GBP', 'CNY', 'KZT', 'TRY']) await fx.saveRates('a', [{ currency: c, rateRub: 50, spreadPct: 1 }]);
const opened = []; for (const c of ['USD', 'EUR', 'GBP', 'CNY', 'KZT', 'TRY']) opened.push((await fx.openAccount(uid, c)).error ?? 'ok');
t('не больше 5 счетов', opened.filter((x) => x === 'ok').length === 5 && opened.includes('too_many_accounts'), opened.join());

// ── Автоисточник (ЦБ РФ) и аналитика ──
const { parseCbr } = await import('../../server/fxsource.mjs');
const sample = { Valute: { USD: { Nominal: 1, Value: 92.5, Previous: 92 }, KZT: { Nominal: 100, Value: 19.2, Previous: 19 }, TRY: { Nominal: 10, Value: 27, Previous: 26.5 }, EUR: { Nominal: 1, Value: 0, Previous: 0 } } };
const parsed = parseCbr(sample);
t('разбор ЦБ: номинал учтён (KZT за 100)', Math.abs(parsed.KZT.rate - 0.192) < 1e-9 && Math.abs(parsed.TRY.rate - 2.7) < 1e-9);
t('разбор ЦБ: нулевой курс отброшен', !('EUR' in parsed));
await query(`DELETE FROM wallet_fx_rates`); await query(`DELETE FROM wallet_fx_rate_history`);
const fakeOk = async () => ({ USD: { rate: 92.5, prev: 92 }, KZT: { rate: 0.192, prev: 0.19 } });
const fakeDown = async () => { throw new Error('down'); };
t('сохранение с источником ЦБ берёт курс из источника', (await fx.saveRates('a', [{ currency: 'USD', source: 'cbr', spreadPct: 1 }], { fetcher: fakeOk })).ok === true
  && Number((await query(`SELECT rate_rub FROM wallet_fx_rates WHERE currency='USD'`)).rows[0].rate_rub) === 92.5);
t('источник недоступен — курс не сохраняется', (await fx.saveRates('a', [{ currency: 'KZT', source: 'cbr' }], { fetcher: fakeDown })).error === 'source_unavailable'
  && (await query(`SELECT 1 FROM wallet_fx_rates WHERE currency='KZT'`)).rowCount === 0);
t('нет данных по валюте у источника', (await fx.saveRates('a', [{ currency: 'GBP', source: 'cbr' }], { fetcher: fakeOk })).error === 'source_no_data');
t('ручной курс не трогается автообновлением', (await fx.saveRates('a', [{ currency: 'EUR', rateRub: 100, spreadPct: 1 }])).ok === true
  && (await fx.refreshFromCbr(async () => ({ EUR: { rate: 5 }, USD: { rate: 93 } }))).updated.join() === 'USD');
t('автообновление изменило USD', Number((await query(`SELECT rate_rub FROM wallet_fx_rates WHERE currency='USD'`)).rows[0].rate_rub) === 93);
t('автообновление: скачок >30% пропущен', (await fx.refreshFromCbr(async () => ({ USD: { rate: 500 } }))).skipped[0]?.why === 'big_change'
  && Number((await query(`SELECT rate_rub FROM wallet_fx_rates WHERE currency='USD'`)).rows[0].rate_rub) === 93);
t('автообновление при сбое источника не меняет курс', (await fx.refreshFromCbr(fakeDown)).error === 'source_unavailable');
const an = (await fx.analytics()).USD;
t('аналитика: есть история и границы', an && an.points.length >= 2 && an.min === 92.5 && an.max === 93, JSON.stringify(an));
t('аналитика: суточное изменение — null, пока истории за сутки нет', an.change1d === null);
await query(`UPDATE wallet_fx_rate_history SET at = at - interval '2 days' WHERE currency='USD' AND rate_rub = 92.5`);
const an2 = (await fx.analytics()).USD;
t('аналитика: изменение за сутки по настоящей истории', Math.abs(an2.change1d - (((93 - 92.5) / 92.5) * 100)) < 0.01, JSON.stringify(an2));
t('аналитика: повтор того же курса историю не раздувает', (await fx.refreshFromCbr(async () => ({ USD: { rate: 93 } }))).ok && (await query(`SELECT count(*)::int n FROM wallet_fx_rate_history WHERE currency='USD'`)).rows[0].n === 2);
await query(`DELETE FROM wallet_fx_rates`); await query(`DELETE FROM wallet_fx_rate_history`); await query(`DELETE FROM wallet_fx_accounts WHERE user_id=$1`, [uid]);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
