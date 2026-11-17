/** Проверка обновлений и верификация бота: платформы, магазины, обязательность, минимальная сборка, права, подделка отметок. Модуль на Postgres `skytest`. */
process.env.OWNER_USERNAME = 'updowner';
const U = await import('../../server/appupdate.mjs');
const M = await import('../../server/skymarks.mjs');
const AV = await import('../../server/appversion.mjs');
const Bot = await import('../../server/skybot.mjs');
const { query } = await import('../../server/db.mjs');
let ok = 0, bad = 0; const t = (n, c) => { c ? ok++ : (bad++, console.log('FAIL', n)); };
const sfx = Date.now().toString(36);
const mk = async (tag, { username, admin = false } = {}) => { const i = `acc-up${tag}${sfx}`; await query('INSERT INTO sky_ids (id, email) VALUES ($1,$2)', [`sky-${i}`, `${i}@t.test`]); await query('INSERT INTO profiles (id, username, name, sky_id, is_admin) VALUES ($1,$2,$3,$4,$5)', [i, username ?? `u${tag}${sfx}`, `Имя ${tag}`, `sky-${i}`, admin]); return { id: i }; };
await query("DELETE FROM profiles WHERE username = 'updowner'");
const OW = await mk('o', { username: 'updowner' }), ADM = await mk('a', { admin: true }), USR = await mk('u');
await query(`UPDATE app_update_settings SET latest_version='', latest_build=0, min_build=0, mandatory=FALSE, stores='{}'::jsonb,
  message_ru='Доступно обновление. Обновите Sky в магазинах приложений или на странице "Обновления"', message_en='An update is available. Update Sky in app stores or on the "Updates" page',
  forced_ru='Эта версия Sky больше не поддерживается. Обновите приложение, чтобы продолжить', forced_en='This version of Sky is no longer supported. Update the app to continue' WHERE id`);
await U.syncGate();

// проверка: ничего не настроено
let c = await U.check({ platform: 'android', build: 100 });
t('no settings → no update', !c.updateAvailable && c.supported && !c.mandatory);
// права
t('user cannot read admin', (await U.adminGet(USR.id)).error === 'not_allowed');
t('user cannot save', (await U.adminSave(USR.id, { latestBuild: 9 })).error === 'not_allowed');
// настройка версии и магазинов администратором (право site)
let r = await U.adminSave(ADM.id, { latestVersion: '5.2.0', latestBuild: 50200, stores: { googleplay: 'https://play.google.com/store/apps/details?id=online.sky', appstore: 'https://apps.apple.com/app/id123', microsoft: 'https://apps.microsoft.com/detail/xyz' } });
t('admin saves version & stores', r.ok && r.settings.latestBuild === 50200);
t('unsupported store rejected', (await U.adminSave(ADM.id, { stores: { huaweiX: 'https://example.com' } })).error === 'unsupported_store');
t('foreign host rejected for store', (await U.adminSave(ADM.id, { stores: { googleplay: 'https://evil.example/play' } })).error === 'bad_store_url');
t('http rejected', (await U.adminSave(ADM.id, { stores: { appstore: 'http://apps.apple.com/app/1' } })).error === 'bad_store_url');
t('credentials/port rejected', (await U.adminSave(ADM.id, { stores: { appstore: 'https://u:p@apps.apple.com/app/1' } })).error === 'bad_store_url' && (await U.adminSave(ADM.id, { stores: { appstore: 'https://apps.apple.com:8443/app/1' } })).error === 'bad_store_url');
t('short text rejected', (await U.adminSave(ADM.id, { messageRu: 'ок' })).error === 'text_required');
// определение обновления по платформам
c = await U.check({ platform: 'android', build: 50100 });
t('android: update available, text default', c.updateAvailable && c.supported && !c.mandatory && /Доступно обновление/.test(c.message) && c.message.includes('"Обновления"'));
t('android: only play store (no apple/microsoft)', c.stores.length === 1 && c.stores[0].id === 'googleplay');
c = await U.check({ platform: 'ios', build: 50100 });
t('ios: only app store', c.stores.length === 1 && c.stores[0].id === 'appstore');
c = await U.check({ platform: 'windows', build: 50100 });
t('windows: only microsoft', c.stores.length === 1 && c.stores[0].id === 'microsoft');
t('up to date: no update', !(await U.check({ platform: 'android', build: 50200 })).updateAvailable);
c = await U.check({ platform: 'web', build: 1 });
t('web: never updates, no stores', !c.updateAvailable && !c.stores.length);
t('macos/linux: no store links even if update', (await U.check({ platform: 'macos', build: 50100 })).stores.length === 0 && (await U.check({ platform: 'linux', build: 50100 })).stores.length === 0);
t('unknown platform → web', (await U.check({ platform: 'gamecube', build: 1 })).platform === 'web');
t('english text', /An update is available/.test((await U.check({ platform: 'android', build: 50100, lang: 'en' })).message));
// текст через админку
t('admin edits text', (await U.adminSave(ADM.id, { messageRu: 'Вышла новая версия Sky — обновитесь' })).ok && (await U.check({ platform: 'android', build: 50100 })).message === 'Вышла новая версия Sky — обновитесь');
// защита: обязательное обновление и минимальная сборка
t('admin cannot force', (await U.adminSave(ADM.id, { mandatory: true }, { codeOk: true })).error === 'owner_only');
t('admin cannot set min build', (await U.adminSave(ADM.id, { minBuild: 50000 }, { codeOk: true })).error === 'owner_only');
t('owner needs code', (await U.adminSave(OW.id, { minBuild: 50000 })).error === 'code_required');
t('min above latest rejected', (await U.adminSave(OW.id, { minBuild: 60000 }, { codeOk: true })).error === 'min_above_latest');
await query("UPDATE app_update_settings SET latest_build = 0 WHERE id"); await U.syncGate();
t('min needs latest', (await U.adminSave(OW.id, { minBuild: 100 }, { codeOk: true })).error === 'latest_required');
await U.adminSave(ADM.id, { latestBuild: 50200 });
r = await U.adminSave(OW.id, { minBuild: 50150, mandatory: true }, { codeOk: true });
t('owner sets min build + mandatory', r.ok && r.settings.minBuild === 50150 && r.settings.mandatory);
c = await U.check({ platform: 'android', build: 50100 });
t('below min: unsupported + mandatory + forced text', !c.supported && c.mandatory && /не поддерживается/.test(c.message));
c = await U.check({ platform: 'android', build: 50160 });
t('mandatory flag forces update for any older build', c.updateAvailable && c.mandatory);
// шлюз API использует минимальную сборку
const reqOld = { headers: { 'x-sky-client': 'app', 'x-sky-build': '50100' } }, reqNew = { headers: { 'x-sky-client': 'app', 'x-sky-build': '50200' } }, reqWeb = { headers: {} };
t('gate: old app blocked, new ok, web untouched', AV.isOutdatedApp(reqOld) && !AV.isOutdatedApp(reqNew) && !AV.isOutdatedApp(reqWeb));
t('gate: reason uses admin forced text', /не поддерживается/.test(AV.outdatedReason(reqOld)));
await U.adminSave(OW.id, { minBuild: 0, mandatory: false }, { codeOk: true });
t('gate released', !AV.isOutdatedApp(reqOld));
// подделка ссылок в БД: запись, не прошедшая проверку, наружу не выходит
await query(`UPDATE app_update_settings SET stores = '{"googleplay":"https://evil.example/x","appstore":"https://apps.apple.com/app/id1"}'::jsonb WHERE id`);
c = await U.check({ platform: 'android', build: 50100 }); await U.settings(true);
t('tampered store link not served', c.stores.length === 0 || c.stores.every((s) => s.url.startsWith('https://play.google.com/')));

// верификация
await Bot.sendSkyBotText?.call?.(null);
const BOT = 'acc-skybot-official';
await query("INSERT INTO profiles (id, sky_id, username, name, is_bot) VALUES ($1, NULL, 'sky_bot', 'Sky', TRUE) ON CONFLICT DO NOTHING", [BOT]);
await query("DELETE FROM verifications WHERE subject_id = $1", [BOT]);
t('bot marked official even without a DB row (server constant)', (await M.marksFor('user', [BOT, USR.id]))[BOT] === 'official' && !(await M.marksFor('user', [BOT, USR.id]))[USR.id]);
// пользователь не может включить отметку сам
t('user cannot grant official', (await M.grantOfficial(USR.id, { subjectType: 'user', subjectId: USR.id, reason: 'сам себе поставлю' })).error === 'owner_only');
t('admin cannot grant official', (await M.grantOfficial(ADM.id, { subjectType: 'user', subjectId: USR.id, reason: 'поставлю по знакомству' })).error === 'owner_only');
t('user cannot decide own request', (await M.decide(USR.id, 'ver-x', { approve: true })).error === 'not_allowed');
t('user cannot revoke', (await M.revoke(USR.id, 'ver-x', 'reason long')).error === 'not_allowed');
t('user cannot read queue', (await M.adminQueue(USR.id, {})).error === 'not_allowed');
t('user cannot change settings', (await M.saveSettings(USR.id, { enabled: false })).error === 'not_allowed');
t('request with no mark for self → pending only', (await query("SELECT count(*)::int n FROM verifications WHERE subject_id = $1 AND status='approved'", [USR.id])).rows[0].n === 0);
const og = await M.grantOfficial(OW.id, { subjectType: 'user', subjectId: USR.id, reason: 'официальный аккаунт партнёра' });
t('owner grants official', og.ok && (await M.marksFor('user', [USR.id]))[USR.id] === 'official');
t('official revoke owner only', (await M.revoke(ADM.id, og.id, 'снимаю отметку')).error === 'owner_only' && (await M.revoke(OW.id, og.id, 'снимаю отметку')).ok);
t('after revoke no mark', !(await M.marksFor('user', [USR.id]))[USR.id]);
// файл клиента: все отметки синие
import fs from 'node:fs';
const marks = fs.readFileSync(new URL('../../src/verification/marks.tsx', import.meta.url), 'utf8');
t('client: single blue colour, no amber', /MARK_BLUE = '#1d9bf0'/.test(marks) && !/amber/.test(marks) && /color: MARK_BLUE/.test(marks));
t('client: badge in bloom, chat list, chat messages, profile', ['src/bloom/components/PostCard.tsx', 'src/messenger/ChatList.tsx', 'src/messenger/ChatWindow.tsx', 'src/profile/viewer/sections/ProfileHero.tsx'].every((f) => /VerifiedBadge/.test(fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'))));
console.log(`appupdate/verification: ${ok} ok, ${bad} failed`); process.exit(bad ? 1 : 0);
