// SkyKassa Business: приём разных валют (список валют, реквизиты по валютам, выбор валюты покупателем, учёт по валютам, провайдер только в рублях).
// API: ADMIN_GATE=off ADMIN_TOKEN=off KBIZ_RATE_MULT=50 EMAIL_MODE=log ALLOW_LOG_CODES=1   (node scripts/audit/kbcurrency-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const DB = process.env.DATABASE_URL ?? 'postgres://sky:sky@127.0.0.1:5432/skytest';
const q = (s) => execSync(`psql ${DB} -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const O = await mkuser(S, 'kcO'), M = await mkuser(S, 'kcM');
q(`insert into wallet_accounts (user_id, balance, points) values ('${O.pid}', 1000, 0) on conflict (user_id) do update set balance = 1000`);
const me = (u, p, o = {}) => call(p, o, u.tok);
const post = (u, p, b) => me(u, p, { method: 'POST', body: JSON.stringify(b ?? {}) });
const put = (u, p, b) => me(u, p, { method: 'PUT', body: JSON.stringify(b ?? {}) });
const rub = { holder: 'Иванов Иван', method: 'phone', value: '+7 900 111-22-33', bank: 'Банк РФ', purpose: 'Оплата', instruction: '' };
const usd = { holder: 'Ivan Ivanov', method: 'account', value: 'US12 3456 7890 1234', bank: 'Bank USA', extra: 'SWIFT TESTUS33', purpose: '', instruction: '' };
const eur = { holder: 'Ivan Ivanov', method: 'account', value: 'DE89 3704 0044 0532 0130 00', bank: 'Bank DE', purpose: '', instruction: '' };

let r = await post(O, '/api/kbiz/business', { name: 'Валютный', mode: 'online', legalType: 'ip' });
t('бизнес создан', r.status === 200, JSON.stringify(r.data));
t('по умолчанию принимается только рубль', JSON.stringify((await me(O, '/api/kbiz/me')).data.business.currencies) === '["RUB"]');
await put(O, '/api/kbiz/requisites', rub); await post(O, '/api/kbiz/subscription/buy', { idemKey: 'c1' });

// настройки валют
t('пустой список отклоняется', (await put(O, '/api/kbiz/currencies', { currencies: [] })).status === 400);
t('неизвестная валюта отклоняется', (await put(O, '/api/kbiz/currencies', { currencies: ['RUB', 'XXX'] })).status === 400);
t('не владелец валюты менять не может', (await put(M, '/api/kbiz/currencies', { currencies: ['RUB', 'USD'] })).status === 403);
r = await put(O, '/api/kbiz/currencies', { currencies: ['rub', 'usd', 'EUR', 'USD'] });
t('владелец включил RUB, USD, EUR (регистр и дубль убраны)', r.status === 200 && JSON.stringify(r.data.currencies) === '["RUB","USD","EUR"]', JSON.stringify(r.data));

// реквизиты по валютам
t('реквизиты для неизвестной валюты — отказ', (await put(O, '/api/kbiz/requisites', { ...usd, currency: 'XXX' })).status === 400);
r = await put(O, '/api/kbiz/requisites', { ...usd, currency: 'USD' });
t('реквизиты USD сохранены', r.status === 200, JSON.stringify(r.data));
t('реквизиты USD не перезаписали рублёвые', (await me(O, '/api/kbiz/me')).data.requisites.value === rub.value);
t('кабинет отдаёт реквизиты по валютам', (await me(O, '/api/kbiz/me')).data.currencyRequisites.USD.value === usd.value);
t('в базе реквизиты USD зашифрованы', !q(`select data_enc from kb_requisites_cur where currency='USD'`).includes('US12'));
await post(O, '/api/kbiz/publish', { on: true });

// QR: валюта
t('QR в валюте без реквизитов (EUR) нельзя', (await post(O, '/api/kbiz/qr', { title: 'EUR', amountRub: 10, currency: 'EUR' })).status === 409);
t('QR в невключённой валюте (GBP) нельзя', (await post(O, '/api/kbiz/qr', { title: 'GBP', amountRub: 10, currency: 'GBP' })).status === 409);
r = await post(O, '/api/kbiz/qr', { title: 'Счёт в долларах', amountRub: 25, currency: 'USD' });
t('QR в USD создан', r.status === 200 && r.data.qr.currency === 'USD', JSON.stringify(r.data));
const pidUsd = q(`select public_id from kb_qr where id='${r.data.qr.id}'`);
r = await post(O, '/api/kbiz/qr', { title: 'Рублёвый', amountRub: 500 });
const pidRub = q(`select public_id from kb_qr where id='${r.data.qr.id}'`);
r = await post(O, '/api/kbiz/qr', { title: 'Свободная сумма' });
const pidFree = q(`select public_id from kb_qr where id='${r.data.qr.id}'`);

// публичные страницы
let pg = await call(`/api/kbiz/public/p/${pidUsd}`);
t('страница USD: валюта и реквизиты USD', pg.data.currency === 'USD' && pg.data.requisites.value === usd.value && !pg.data.currencies, JSON.stringify(pg.data));
pg = await call(`/api/kbiz/public/p/${pidRub}`);
t('страница RUB: рублёвые реквизиты', pg.data.currency === 'RUB' && pg.data.requisites.value === rub.value);
pg = await call(`/api/kbiz/public/p/${pidFree}`);
t('свободная сумма: покупателю предлагаются валюты с реквизитами (RUB, USD; EUR — без реквизитов — нет)', JSON.stringify(pg.data.currencies) === '["RUB","USD"]', JSON.stringify(pg.data.currencies));
t('свободная сумма: реквизиты по валютам', pg.data.requisitesByCurrency?.USD?.value === usd.value && pg.data.requisitesByCurrency?.RUB?.value === rub.value);

// заявки
const rep = (pid, b) => call(`/api/kbiz/public/p/${pid}/report`, { method: 'POST', body: JSON.stringify(b) });
r = await rep(pidUsd, { amountRub: 99999, currency: 'RUB' });
t('фиксированный QR: сумма и валюта берутся с сервера (присланные игнорируются)', r.status === 200 && q(`select amount_rub||currency from kb_payments where id='${r.data.id}'`) === '25USD', JSON.stringify(r.data));
const payUsd = r.data.id, keyUsd = r.data.statusKey;
t('статус покупателя отдаёт валюту', (await call(`/api/kbiz/public/status/${payUsd}?k=${encodeURIComponent(keyUsd)}`)).data?.currency === 'USD');
r = await rep(pidFree, { amountRub: 40, currency: 'usd' });
t('свободная сумма: покупатель выбрал USD', r.status === 200 && q(`select amount_rub||currency from kb_payments where id='${r.data.id}'`) === '40USD', JSON.stringify(r.data));
r = await rep(pidFree, { amountRub: 40, currency: 'EUR' });
t('свободная сумма: валюта без реквизитов отклоняется', r.status === 409 && r.data.error === 'currency_unavailable', JSON.stringify(r.data));
r = await rep(pidFree, { amountRub: 40, currency: 'GBP' });
t('свободная сумма: невключённая валюта отклоняется', r.status === 409);
r = await rep(pidFree, { amountRub: 7 });
t('свободная сумма без валюты — валюта QR (RUB)', r.status === 200 && q(`select currency from kb_payments where id='${r.data.id}'`) === 'RUB');
r = await rep(pidFree, { amountRub: 0, currency: 'USD' });
t('нулевая сумма отклоняется и в валюте', r.status === 400);

// подтверждение и учёт
r = await post(O, `/api/kbiz/payments/${payUsd}/confirm`, {});
t('владелец подтвердил оплату в USD', r.status === 200, JSON.stringify(r.data));
const ov = (await me(O, '/api/kbiz/overview')).data.stats;
const usdRow = ov.byCurrency.find((x) => x.currency === 'USD');
t('сводка по валютам: USD подтверждено 25, заявлено 65', usdRow && usdRow.confirmed === 25 && usdRow.claimed === 65 && usdRow.confirmedCount === 1, JSON.stringify(ov.byCurrency));
t('рублёвые суммы не смешиваются с долларами', ov.claimedSumRub === 7 && ov.confirmedByOwnerSumRub === 0, JSON.stringify(ov));
const an = (await me(O, '/api/kbiz/analytics?days=30')).data.analytics;
t('аналитика: byCurrency есть, рублёвая сумма только рублёвая', an.byCurrency.find((x) => x.currency === 'USD')?.confirmedSum === 25 && an.confirmedSumRub === 0, JSON.stringify(an));
const csv = (await me(O, '/api/kbiz/export.csv')).text;
t('CSV: колонки «Сумма», «Валюта», значение USD', /Сумма","Валюта|Сумма,Валюта/.test(csv) && csv.includes('USD'), csv.slice(0, 200));

// провайдер — только рубли
t('оплата у партнёра для USD — только рубли', (await call(`/api/kbiz/public/p/${pidUsd}/provider`, { method: 'POST', body: '{}' })).data?.error === 'provider_rub_only');

// публикация без реквизитов
r = await post(O, '/api/kbiz/organizations', { name: 'Только доллары', mode: 'online', legalType: 'ip' });
await put(O, '/api/kbiz/currencies', { currencies: ['USD'] });
t('публикация без реквизитов принимаемой валюты — отказ', (await post(O, '/api/kbiz/publish', { on: true })).status === 409);
await put(O, '/api/kbiz/requisites', { ...usd, currency: 'USD' });
t('реквизиты USD есть — публикация возможна', (await post(O, '/api/kbiz/publish', { on: true })).status === 200);

console.log(`\n${ok} ок, ${bad} ошибок`); process.exit(bad ? 1 : 0);
