// Путеводитель: состояние знакомства на сервере. API с ADMIN_GATE=off. (TEST_DATABASE_URL=… node scripts/audit/onboarding-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql ${process.env.TEST_DATABASE_URL || 'postgres://sky:sky@127.0.0.1/sky'} -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, JSON.stringify(x).slice(0, 240)); } };
const G = (tok) => call('/api/onboarding', {}, tok);
const A = (tok, action, extra = {}) => call('/api/onboarding', { method: 'POST', body: JSON.stringify({ action, ...extra }) }, tok);
const relogin = async (_email, pid, tok) => (await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, tok)).data.accessToken;   // новый токен той же учётной записи (состояние лежит на сервере, не в сессии)
const u = await mkuser(S, 'obA'), v = await mkuser(S, 'obB');
let r = await call('/api/onboarding'); t('без входа — 401', r.status === 401, r);
r = await G(u.tok); t('новый человек: знакомство не начиналось, показывать', r.data.status === 'not_started' && r.data.auto === true && r.data.step === 0, r.data);
r = await A(u.tok, 'bogus'); t('неизвестное действие — 400', r.status === 400, r);
r = await A(u.tok, 'start'); t('начать', r.data.status === 'started' && r.data.auto === true, r.data);
await Promise.all([1, 2, 3].map(() => A(u.tok, 'start'))); t('повторные «start» безвредны', (await G(u.tok)).data.status === 'started');
r = await A(u.tok, 'step', { step: 3 }); t('шаг 3 сохранён', r.data.step === 3, r.data);
r = await A(u.tok, 'step', { step: 1 }); t('шаг назад не откатывает прогресс', r.data.step === 3, r.data);
r = await A(u.tok, 'step', { step: 99 }); t('шаг ограничен числом шагов', r.data.step === 8, r.data);
const u2 = await relogin(u.email, u.pid, u.tok);
r = await G(u2); t('другое устройство видит тот же прогресс', r.data.status === 'started' && r.data.step === 8, r.data);
r = await G(v.tok); t('у другого человека своё состояние', r.data.status === 'not_started' && r.data.step === 0, r.data);

r = await A(u.tok, 'complete', { interest: 'nonsense' }); t('завершено; чужое «интересы» отброшено', r.data.status === 'completed' && r.data.interest === null && r.data.auto === false, r.data);
for (const a of ['start', 'step', 'skip', 'complete']) await A(u.tok, a, { step: 2, interest: 'video' });
r = await G(u.tok); t('после завершения ничто не возобновляет и не меняет итог', r.data.status === 'completed' && r.data.auto === false && r.data.interest === null, r.data);
r = await A(u.tok, 'interest', { interest: 'video' }); t('интерес можно сохранить отдельно', r.data.interest === 'video', r.data);
r = await G(u2); t('после завершения на одном устройстве другое не показывает', r.data.auto === false && r.data.status === 'completed', r.data);

// пропуск
r = await A(v.tok, 'skip'); t('пропущено — больше не показывается', r.data.status === 'skipped' && r.data.auto === false, r.data);
await A(v.tok, 'start'); await A(v.tok, 'step', { step: 4 });
r = await G(v.tok); t('пропущенное само не возобновляется', r.data.status === 'skipped' && r.data.step === 0, r.data);
r = await A(v.tok, 'restart'); t('ручной запуск работает и после пропуска', r.data.status === 'started' && r.data.step === 0 && r.data.auto === true, r.data);
r = await A(v.tok, 'complete', { interest: 'wallet' }); t('завершение с интересом', r.data.status === 'completed' && r.data.interest === 'wallet', r.data);
r = await A(v.tok, 'restart'); t('повторный ручной запуск после завершения', r.data.status === 'started', r.data);

// гонка: завершить и пропустить одновременно — итог один и стабильный
const w = await mkuser(S, 'obC'); await A(w.tok, 'start');
const [x, y] = await Promise.all([A(w.tok, 'complete'), A(w.tok, 'skip')]);
const fin = (await G(w.tok)).data.status;
t('гонка complete/skip: ровно один итог, дальше не меняется', ['completed', 'skipped'].includes(fin) && x.data.status === fin || y.data.status === fin, { fin, x: x.data, y: y.data });
await A(w.tok, 'skip'); await A(w.tok, 'complete'); t('итог гонки не меняется', (await G(w.tok)).data.status === fin);

// брошенное на середине давно — не навязывается
const z = await mkuser(S, 'obD'); await A(z.tok, 'start'); await A(z.tok, 'step', { step: 2 });
q(`update onboarding_state set updated_at = now() - interval '2 days' where sky_id = (select sky_id from profiles where id='${z.pid}')`);
r = await G(z.tok); t('брошенное больше суток назад считается пропущенным', r.data.status === 'skipped' && r.data.auto === false, r.data);

// существующие люди (без строки) — не показывать
const e = await mkuser(S, 'obE');
q(`delete from onboarding_state where sky_id = (select sky_id from profiles where id='${e.pid}')`);
r = await G(e.tok); t('человек без записи (пришёл раньше) — не показывать', r.data.status === 'none' && r.data.auto === false, r.data);
await A(e.tok, 'start'); await A(e.tok, 'step', { step: 1 }); await A(e.tok, 'complete');
r = await G(e.tok); t('действия не создают запись сами (кроме ручного запуска)', r.data.status === 'none', r.data);
r = await A(e.tok, 'restart'); t('ручной запуск создаёт запись', r.data.status === 'started', r.data);
t('в базе одна строка на Sky ID', q(`select count(*) from onboarding_state where sky_id = (select sky_id from profiles where id='${e.pid}')`) === '1');
// выход и повторный вход не сбрасывают
await call('/api/auth/logout', { method: 'POST', body: '{}' }, u.tok);
t('состояние хранится вне сессии (после выхода осталось)', q(`select status from onboarding_state where sky_id = (select sky_id from profiles where id='${u.pid}')`) === 'completed');
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
