// Удаление аккаунта с восстановлением 30 дней, окончательная очистка, экспорт (HTTP + прямой вызов уборки).
// Запуск: (. env.sh; node scripts/audit/accountdeletion-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const freshCode = async (email, path, u) => { q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${email}'`); await post(path, {}, u); await sleep(1300); return codeOf(email); };
const skyOf = (u) => q(`select sky_id from profiles where id='${u.pid}'`);
const ACK = { wallet: true, prime: true, understood: true };

const A = await mkuser(S, 'delA'); const B = await mkuser(S, 'delB'); const skyA = skyOf(A);
// данные человека
q(`insert into wallet_accounts (user_id, balance, points) values ('${A.pid}', 150, 20) on conflict (user_id) do update set balance=150, points=20`);
q(`insert into wallet_transactions (id, user_id, type, amount, descr) values ('wt-del-${Date.now()}','${A.pid}','topup',150,'тест')`);
q(`insert into music_tracks (id, owner_id, title, artist, status, mime, bytes) values ('trk-del-${Date.now()}','${A.pid}','Моя песня','Я','published','audio/mpeg',10)`);
const trackId = q(`select id from music_tracks where owner_id='${A.pid}'`);
q(`insert into music_favorites (user_id, track_id) values ('${A.pid}','${trackId}')`);
q(`insert into follows (follower_id, following_id) values ('${A.pid}','${B.pid}')`);

let r = await call('/api/skyid/deletion/preview', {}, A.tok);
t('последствия показаны: баланс, контент, сообщения', r.status === 200 && r.data.warnings.some((w) => w.code === 'wallet') && r.data.counts.tracks === 1 && r.data.canRequest === true, JSON.stringify(r.data).slice(0, 300));
r = await call('/api/skyid/deletion/preview', {}, undefined);
t('без входа — 401', r.status === 401);

r = await post('/api/skyid/deletion/request', { scope: 'account', ack: ACK }, A);
t('без кода подтверждения — отказ', r.status === 400 && r.data.error === 'email_code_required', JSON.stringify(r.data));
r = await post('/api/skyid/deletion/request', { scope: 'account', ack: { understood: true } }, A);
t('баланс без явного согласия — отказ', r.data.error === 'ack_wallet_required', JSON.stringify(r.data));
r = await post('/api/skyid/deletion/request', { scope: 'account', ack: ACK, emailCode: '000000' }, A);
t('неверный код — отказ', r.status === 401 && r.data.error === 'invalid_code', JSON.stringify(r.data));

// блокер: владелец семьи
const fam = await post('/api/family', { name: 'Тест' }, A);
r = await call('/api/skyid/deletion/preview', {}, A.tok);
t('семья-владелец мешает удалению', r.data.blockers?.some((b) => b.code === 'family'), JSON.stringify(r.data.blockers));
r = await post('/api/skyid/deletion/request', { scope: 'account', ack: ACK, emailCode: '123456' }, A);
t('запрос при препятствии — blocked', r.status === 409 && r.data.error === 'blocked', JSON.stringify(r.data));
const famId = fam.data?.data?.family?.id ?? fam.data?.family?.id;
await call(`/api/family/${famId}`, { method: 'DELETE' }, A.tok);

// чужой профиль в запросе профиля
r = await call(`/api/skyid/deletion/preview?scope=profile&profileId=${B.pid}`, {}, A.tok);
t('чужой профиль — not_found', r.status === 404);
r = await call(`/api/skyid/deletion/preview?scope=profile&profileId=${A.pid}`, {}, A.tok);
t('единственный профиль нельзя удалить отдельно', r.data.error === 'last_profile', JSON.stringify(r.data));

// успешный запрос
let code = await freshCode(A.email, '/api/skyid/deletion/code', A);
r = await post('/api/skyid/deletion/request', { scope: 'account', ack: ACK, emailCode: code }, A);
t('удаление запрошено, срок 30 дней', r.status === 200 && r.data.retentionDays === 30 && Math.round((new Date(r.data.purgeAt) - Date.now()) / 864e5) >= 29, JSON.stringify(r.data));
const delId = r.data.id;
r = await call('/api/skyid/deletion', {}, A.tok);
t('сессии отозваны — старый токен не работает', r.status === 401, r.status);
t('данные на месте до окончания срока', q(`select count(*) from music_tracks where owner_id='${A.pid}'`) === '1' && q(`select balance from wallet_accounts where user_id='${A.pid}'`) === '150');
t('манифест записан и зашифрован', q(`select length(data_enc) > 20 and data_enc not like '%${A.email}%' from account_deletion_manifests where deletion_id='${delId}'`) === 't');
t('профиль помечен', q(`select deletion_purge_at is not null from profiles where id='${A.pid}'`) === 't');

// вход закрыт
q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${A.email}'`);
await post('/api/auth/email/start', { email: A.email }); await sleep(1300);
r = await post('/api/auth/email/verify', { email: A.email, code: codeOf(A.email) });
t('вход в удаляемый аккаунт закрыт (423)', r.status === 423 && r.data.error === 'account_deletion_pending', JSON.stringify(r.data));

// восстановление
r = await post('/api/auth/deletion/restore/start', { identifier: 'nobody@example.com' });
t('ответ одинаков для несуществующего адреса', r.status === 200 && r.data.ok === true);
q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${A.email}'`);
r = await post('/api/auth/deletion/restore/start', { identifier: A.email }); await sleep(1300);
r = await post('/api/auth/deletion/restore/finish', { identifier: A.email, emailCode: '000000' });
t('восстановление с неверным кодом — отказ', r.status === 401, JSON.stringify(r.data));
r = await post('/api/auth/deletion/restore/finish', { identifier: A.email, emailCode: codeOf(A.email) });
t('восстановление с кодом почты', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
t('аккаунт снова активен', q(`select deletion_purge_at is null from sky_ids where id='${skyA}'`) === 't' && q(`select status from account_deletions where id='${delId}'`) === 'cancelled');
q(`update verification_codes set created_at = created_at - interval '5 minutes' where destination = '${A.email}'`);
await post('/api/auth/email/start', { email: A.email }); await sleep(1300);
r = await post('/api/auth/email/verify', { email: A.email, code: codeOf(A.email) });
t('вход после восстановления работает', r.status === 200 && !!r.data.accessToken, r.status);
A.tok = r.data.accessToken;
const sel = await post(`/api/skyid/profiles/${A.pid}/select`, {}, A); if (sel.data.accessToken) A.tok = sel.data.accessToken;

// экспорт
code = await freshCode(A.email, '/api/skyid/export/code', A);
r = await post('/api/skyid/export', { emailCode: code }, A);
const dump = JSON.stringify(r.data);
t('экспорт отдаёт данные человека', r.status === 200 && r.data.data.music.uploads.length === 1 && r.data.data.walletTransactions.length >= 1, dump.slice(0, 200));
t('в экспорте нет секретов', !/password_hash|two_factor_secret|ip_pin_hash|token/i.test(dump));
r = await post('/api/skyid/export', { emailCode: '000000' }, A);
t('экспорт без верного кода — отказ', r.status === 401);

// удаление профиля (второй профиль)
const p2 = await post('/api/skyid/profiles', { name: 'Второй', username: 'second' + Date.now().toString(36), acceptLegal: true }, A);
const pid2 = p2.data.profile?.id;
code = await freshCode(A.email, '/api/skyid/deletion/code', A);
r = await post('/api/skyid/deletion/request', { scope: 'profile', profileId: pid2, ack: { understood: true }, emailCode: code }, A);
t('удаление отдельного профиля запрошено', r.status === 200 && r.data.scope === 'profile', JSON.stringify(r.data));
t('другие профили целы', q(`select deletion_purge_at is null from profiles where id='${A.pid}'`) === 't');
r = await post(`/api/skyid/profiles/${pid2}/select`, {}, A);
t('профиль в ожидании выбрать нельзя', r.status === 404 || r.status === 403, r.status);
code = await freshCode(A.email, '/api/skyid/deletion/code', A);
r = await post('/api/skyid/deletion/cancel-profile', { profileId: pid2, emailCode: code }, A);
t('отмена удаления профиля с кодом', r.status === 200 && q(`select deletion_purge_at is null from profiles where id='${pid2}'`) === 't', JSON.stringify(r.data));

// администратор не удаляет себя
q(`update profiles set is_admin=true where id='${B.pid}'`);
r = await call('/api/skyid/deletion/preview', {}, B.tok);
t('права администратора мешают удалению', r.data.blockers?.some((b) => b.code === 'admin'), JSON.stringify(r.data.blockers));
q(`update profiles set is_admin=false where id='${B.pid}'`);

// окончательная очистка
code = await freshCode(A.email, '/api/skyid/deletion/code', A);
r = await post('/api/skyid/deletion/request', { scope: 'account', ack: ACK, emailCode: code }, A);
const delId2 = r.data.id;
await (await import('../../server/sessions.mjs')).connectRedis();
const { purgeDue } = await import('../../server/accountdeletion.mjs');
t('до срока уборка ничего не трогает', (await purgeDue()) === 0 || q(`select count(*) from music_tracks where owner_id='${A.pid}'`) === '1');
q(`update account_deletions set purge_at = now() - interval '1 minute' where id='${delId2}'`);
const n = await purgeDue();
t('по истечении срока очистка выполнена', n >= 1 && q(`select status from account_deletions where id='${delId2}'`) === 'completed', n);
t('контент удалён', q(`select count(*) from music_tracks where owner_id='${A.pid}'`) === '0');
t('личные связи удалены', q(`select count(*) from music_favorites where user_id='${A.pid}'`) === '0' && q(`select count(*) from follows where follower_id='${A.pid}'`) === '0');
t('профиль обезличен', q(`select name from profiles where id='${A.pid}'`) === 'Удалённый пользователь' && q(`select username like 'deleted-%' from profiles where id='${A.pid}'`) === 't' && q(`select avatar is null and bio is null from profiles where id='${A.pid}'`) === 't');
t('контакты Sky ID стёрты', q(`select email is null and phone like 'deleted:%' and deleted_at is not null from sky_ids where id='${skyA}'`) === 't');
t('финансовая запись сохранена (обезличенно)', q(`select count(*) from wallet_transactions where user_id='${A.pid}'`) !== '0');
t('манифест стёрт', q(`select data_enc = '' and purged_at is not null from account_deletion_manifests where deletion_id='${delId2}'`) === 't');
t('повторный запуск безопасен', (await purgeDue()) === 0);
// каждая запись реестра указывает на существующие таблицы/столбцы
const { PERSONAL } = await import('../../server/accountdeletion.mjs');
const missing = PERSONAL.filter(([tb, col]) => q(`select count(*) from information_schema.columns where table_name='${tb}' and column_name='${col}'`) === '0');
t('реестр очистки: все таблицы и столбцы существуют', missing.length === 0, JSON.stringify(missing));
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
