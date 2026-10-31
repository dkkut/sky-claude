// Отдельный пароль кошелька SkyMoney (модуль напрямую). Запуск: DATABASE_URL=… REDIS_URL=… JWT_SECRET=… ENCRYPTION_KEY=… node scripts/audit/moneypass-test.mjs
process.chdir(new URL('../../server/', import.meta.url).pathname);
const m = await import('../../server/moneypass.mjs');
const { query } = await import('../../server/db.mjs');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}`); };
await query(`CREATE TABLE IF NOT EXISTS money_password (sky_id TEXT PRIMARY KEY, hash TEXT NOT NULL, fails INT NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
const id = `mp-test-${Date.now()}`;
t('пароля нет — проверка проходит', (await m.checkWalletPassword(id, '')).ok === true && !(await m.hasWalletPassword(id)));
t('короткий пароль отклонён', (await m.setWalletPassword(id, { next: '123' })).error === 'weak_wallet_password');
t('пароль задан', (await m.setWalletPassword(id, { next: 'кошелёк-1' })).ok === true && await m.hasWalletPassword(id));
t('в базе нет самого пароля', !JSON.stringify((await query('SELECT * FROM money_password WHERE sky_id=$1', [id])).rows[0]).includes('кошелёк-1'));
t('верный пароль проходит', (await m.checkWalletPassword(id, 'кошелёк-1')).ok === true);
t('пустой пароль не проходит', (await m.checkWalletPassword(id, '')).error === 'wallet_password_required');
t('неверный пароль не проходит', (await m.checkWalletPassword(id, 'не тот')).error === 'invalid_wallet_password');
t('смена без текущего отклонена', (await m.setWalletPassword(id, { next: 'новый-пароль' })).ok === false);
t('смена с текущим работает', (await m.setWalletPassword(id, { current: 'кошелёк-1', next: 'новый-пароль' })).ok === true);
t('старый пароль больше не подходит', (await m.checkWalletPassword(id, 'кошелёк-1')).ok === false);
t('удаление без текущего отклонено', (await m.removeWalletPassword(id, { current: 'x' })).ok === false && await m.hasWalletPassword(id));
// перебор
let last; for (let i = 0; i < 5; i++) last = await m.checkWalletPassword(id, 'bad' + i);
t('5 неверных подряд — пауза', last.error === 'too_many_attempts' && last.retryAfter > 800);
t('во время паузы верный пароль не принимается', (await m.checkWalletPassword(id, 'новый-пароль')).error === 'too_many_attempts');
t('сброс по коду личности снимает паузу и задаёт новый', (await m.resetWalletPassword(id, 'сброшен-1')).ok === true && (await m.checkWalletPassword(id, 'сброшен-1')).ok === true);
t('сброс со слабым паролем отклонён', (await m.resetWalletPassword(id, 'ab')).error === 'weak_wallet_password');
t('сброс без нового пароля убирает защиту', (await m.resetWalletPassword(id, null)).hasPassword === false && !(await m.hasWalletPassword(id)));
await m.setWalletPassword(id, { next: 'ещё-пароль' });
t('удаление с текущим работает', (await m.removeWalletPassword(id, { current: 'ещё-пароль' })).ok === true && !(await m.hasWalletPassword(id)));
await query('DELETE FROM money_password WHERE sky_id=$1', [id]);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
