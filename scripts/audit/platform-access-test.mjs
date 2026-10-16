// Доступ владельца при «Технических/Аварийных работах» и закрытая панель (аварийный режим админки).
//   API с ADMIN_GATE=off, OWNER_USERNAME=ownertest. (. env.sh; node scripts/audit/platform-access-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (o) => JSON.stringify(o ?? {});
const codeOf = (email) => [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))].pop()?.[1];
// Вход БЕЗ выбора профиля — ровно то состояние сессии, в котором раньше всё ломалось
const login = async (tag) => {
  const email = `${tag}${Date.now()}@example.com`;
  await call('/api/auth/email/start', { method: 'POST', body: j({ email }) }); await sleep(1500);
  const v = await call('/api/auth/email/verify', { method: 'POST', body: j({ email, code: codeOf(email) }) });
  return { email, tok: v.data.accessToken, status: v.status };
};
const withProfile = async (u, name, username) => {
  const r = await call('/api/skyid/profiles', { method: 'POST', body: j({ name, username, acceptLegal: true }) }, u.tok);
  if (!r.data.profile) console.log('PROFILE', r.status, j(r.data).slice(0, 200), !!u.tok, u.status);
  return r.data.profile?.id;
};
const select = async (u, pid) => (await call(`/api/skyid/profiles/${pid}/select`, { method: 'POST', body: '{}' }, u.tok));
const setMode = (kind, on) => q(`update platform_${kind} set active=${on}, reason='тест' where id`);
const lock = (on) => q(`update admin_lockdown set active=${on}, reason='тест' where id`);
q(`update platform_maintenance set active=false where id`); q(`update platform_shutdown set active=false where id`); q(`update admin_lockdown set active=false where id`);
const ids = {};
q(`update profiles set username='old'||substr(md5(random()::text),1,6) where lower(username)='ownertest'`);

// Участники: владелец, администратор, обычный человек. У каждого профиль создан заранее, а сессия — новая и без выбранного профиля.
for (const [k, tag, uname] of [['owner', 'paown', 'ownertest'], ['admin', 'paadm', null], ['user', 'paplain', null]]) {
  const u = await login(tag); const pid = await withProfile(u, `PA ${k}`, `${tag}${Date.now().toString(36)}`);
  if (uname) q(`update profiles set username='${uname}' where id='${pid}'`);
  if (k === 'admin') q(`update profiles set is_admin=true, admin_role='super_admin' where id='${pid}'`);
  // Второй профиль: при одном профиле сессия выбирает его сама, а баг проявлялся на шаге «выбор профиля»
  if (k !== 'user') await withProfile(u, `PA ${k} 2`, `${tag}b${Date.now().toString(36)}`);
  ids[k] = { email: u.email, pid };
}
const fresh = async (k) => { q(`update verification_codes set created_at = created_at - interval '3 minutes' where destination='${ids[k].email}'`); await call('/api/auth/email/start', { method: 'POST', body: j({ email: ids[k].email }) }); await sleep(1700); const v = await call('/api/auth/email/verify', { method: 'POST', body: j({ email: ids[k].email, code: codeOf(ids[k].email) }) }); return v.data.accessToken; };

/* ═══ Модуль 1: технические работы ═══ */
setMode('maintenance', true);
{
  const tok = { owner: await fresh('owner'), admin: await fresh('admin'), user: await fresh('user') };
  t('техработы: владелец входит (вход открыт)', Boolean(tok.owner));
  let r = await call('/api/skyid/profiles', {}, tok.owner);
  t('техработы: владелец без выбранного профиля видит список профилей (раньше 503 «бесконечные техработы»)', r.status === 200, `${r.status} ${j(r.data).slice(0, 100)}`);
  r = await call('/api/wallet', {}, tok.owner);
  t('техработы: профиль не выбран — остальные разделы закрыты даже для владельца (проход только на /api/skyid)', r.status === 503, String(r.status));
  r = await select({ tok: tok.owner }, ids.owner.pid);
  t('техработы: владелец выбирает профиль', r.status === 200 && Boolean(r.data.accessToken), `${r.status} ${j(r.data).slice(0, 100)}`);
  tok.ownerP = r.data.accessToken;
  r = await call('/api/skyid/profiles', {}, tok.admin);
  t('техработы: администратор без выбранного профиля тоже проходит на /api/skyid', r.status === 200, String(r.status));
  r = await call('/api/skyid/profiles', {}, tok.user);
  t('техработы: обычный человек получает «технические работы»', r.status === 503 && r.data.error === 'platform_maintenance', `${r.status}`);
  r = await call('/api/skyid/pin', {}, tok.owner);
  t('техработы: экран PIN при смене IP не блокируется режимом работ', r.status !== 503, String(r.status));
  r = await call('/api/platform/status', {}, tok.ownerP);
  t('статус: владельцу bypass=true, заглушка не нужна', r.data.maintenance.active === true && r.data.bypass === true, j(r.data).slice(0, 100));
  r = await call('/api/platform/status', {}, tok.user);
  t('статус: обычному человеку bypass=false', r.data.bypass === false);
  r = await call('/api/platform/status');
  t('статус: аноним — bypass=false', r.data.bypass === false);
  r = await call('/api/admin/analytics/overview', {}, tok.ownerP);
  t('техработы: владелец работает с админкой', r.status === 200, String(r.status));
  // истечение/обрыв сессии
  const second = await fresh('admin');
  const rv = await call('/api/auth/devices/revoke-all', { method: 'POST', body: '{}' }, second);   // завершает ДРУГИЕ сессии
  t('сессия: после выхода токен не принимается даже в режиме работ', [401, 503].includes((await call('/api/skyid/profiles', {}, tok.admin)).status) && (await call('/api/admin/analytics/overview', {}, tok.admin)).status !== 200, String(rv.status));
  t('сессия: подделанный токен — 401/503, не доступ', [401, 503].includes((await call('/api/skyid/profiles', {}, 'x.y.z')).status));
}
setMode('maintenance', false);

/* ═══ Аварийные работы: проходит только владелец ═══ */
setMode('shutdown', true);
{
  const tok = { owner: await fresh('owner'), admin: await fresh('admin') };
  t('аварийные работы: владелец без профиля проходит на /api/skyid', (await call('/api/skyid/profiles', {}, tok.owner)).status === 200);
  t('аварийные работы: администратор (не владелец) закрыт', (await call('/api/skyid/profiles', {}, tok.admin)).status === 503);
  t('аварийные работы: вход (auth) остаётся открытым', (await call('/api/auth/email/start', { method: 'POST', body: j({ email: ids.owner.email }) })).status !== 503);
}
setMode('shutdown', false);
t('после снятия режимов все проходят', (await call('/api/skyid/profiles', {}, await fresh('user'))).status === 200);

/* ═══ Модуль 2: закрытая панель ═══ */
{
  const adm = await fresh('admin'); const admP = (await select({ tok: adm }, ids.admin.pid)).data.accessToken;
  const own = await fresh('owner'); const ownP = (await select({ tok: own }, ids.owner.pid)).data.accessToken;
  const usr = await fresh('user'); const usrP = (await select({ tok: usr }, ids.user.pid)).data.accessToken;
  const routes = ['/api/admin/analytics/overview', '/api/admin/registration', '/api/admin/modules', '/api/admin/channels'];
  const stat = async (tk) => Promise.all(routes.map(async (p) => (await call(p, {}, tk)).status));
  lock(false); await sleep(1200);
  const before = await stat(admP);
  t('панель открыта: администратор работает через HTTP API', before.every((s) => s === 200), before.join());
  lock(true); await sleep(1200);
  const after = await stat(admP);
  t('панель закрыта: администратор не получает ничего через прямые HTTP-запросы', after.every((s) => s === 403), after.join());
  t('панель закрыта: владелец продолжает работать', (await stat(ownP)).every((s) => s === 200));
  const su = await call('/api/admin/codes/step-up', { method: 'POST', body: '{}' }, admP);
  t('панель закрыта: подтверждения личности (step-up) администратору не выдаются', su.status === 403 || su.status === 401 || su.data.error === 'not_allowed', `${su.status} ${j(su.data).slice(0, 80)}`);
  t('панель закрыта: изменяющий запрос администратора отклонён', (await call('/api/admin/registration', { method: 'PUT', body: j({ enabled: true }) }, admP)).status === 403);
  t('панель закрыта: обычный человек и раньше не имел доступа', (await stat(usrP)).every((s) => s === 403));
  t('панель закрыта: вызов без токена — 401', (await call('/api/admin/modules')).status === 401);
  lock(false); await sleep(1200);
  t('панель снова открыта: права возвращаются сразу', (await stat(admP)).every((s) => s === 200));
  // снятие полномочий действует на уже выданную сессию
  q(`update profiles set is_admin=false where id='${ids.admin.pid}'`);
  t('полномочия сняты: уже выданный токен теряет доступ', (await stat(admP)).every((s) => s === 403));
  q(`update profiles set is_admin=true where id='${ids.admin.pid}'`);
}
lock(false); setMode('maintenance', false); setMode('shutdown', false);
console.log(`\nИтого: ${ok} ok, ${bad} fail`);
process.exit(bad ? 1 : 0);
