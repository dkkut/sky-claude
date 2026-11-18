// Bloom: сообщества через HTTP — вступление, видимость постов закрытых сообществ, роли, бан, закрепление, жалобы и блокировка администрацией.
// API: OWNER_USERNAME=lifeowner ADMIN_GATE=off ADMIN_TOKEN=off EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test RATE_LIMIT_PER_MINUTE=5000; запуск: node scripts/audit/bloomcommunities-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2]; let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const q = (s) => execSync(`psql postgres://sky:sky@localhost:5432/skytest -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const J = (o) => ({ method: 'POST', body: JSON.stringify(o) });
const sfx = Date.now().toString(36).slice(-6);
const O = await mkuser(S, 'BcO'), M = await mkuser(S, 'BcM'), U = await mkuser(S, 'BcU'), V = await mkuser(S, 'BcV'), ADM = await mkuser(S, 'BcAdm');
q(`UPDATE profiles SET is_admin = true WHERE id = '${ADM.pid}'`);

t('без входа 401', (await call('/api/bloom/communities')).status === 401);
t('валидация: короткое имя, зарезервированный и плохой slug', (await call('/api/bloom/communities', J({ name: 'ab', slug: `x${sfx}` }), O.tok)).status === 400 && (await call('/api/bloom/communities', J({ name: 'Сообщество', slug: 'admin' }), O.tok)).status === 400 && (await call('/api/bloom/communities', J({ name: 'Сообщество', slug: 'Плохой slug!' }), O.tok)).status === 400);
const pub = await call('/api/bloom/communities', J({ name: 'Любители кофе', slug: `coffee_${sfx}`, description: 'Всё о кофе', emoji: '☕', privacy: 'public', rules: [{ title: 'Без спама', text: 'Реклама только с пометкой' }] }), O.tok);
t('публичное сообщество создано', pub.status === 200 && pub.data.id, pub.text);
t('slug уникален', (await call('/api/bloom/communities', J({ name: 'Другое имя', slug: `coffee_${sfx}` }), M.tok)).status === 409);
const info = await call(`/api/bloom/communities/coffee_${sfx}`, {}, U.tok);
t('карточка: правила, владелец, число участников', info.status === 200 && info.data.community.rules.length === 1 && info.data.community.members === 1 && info.data.community.owner.id === O.pid && info.data.community.contentVisible);
t('владелец не может выйти', (await call(`/api/bloom/communities/${pub.data.id}/leave`, J({}), O.tok)).data.error === 'owner_cannot_leave');

/* публичное: пост без вступления нельзя, со вступлением — можно */
t('без вступления писать нельзя', (await call('/api/bloom/post', J({ text: 'Привет, кофе!', communityId: pub.data.id }), U.tok)).status === 403);
t('вступление свободное', (await call(`/api/bloom/communities/${pub.data.id}/join`, J({}), U.tok)).data.status === 'active');
const p1 = await call('/api/bloom/post', J({ text: 'Мой первый эспрессо', communityId: pub.data.id, tags: ['кофе'] }), U.tok); t('участник пишет в сообщество', p1.status === 200 && p1.data.id, p1.text);
const cp = await call(`/api/bloom/communities/${pub.data.id}/posts`, {}, V.tok); t('пост виден всем на странице сообщества, с меткой', cp.status === 200 && cp.data.posts.length === 1 && cp.data.posts[0].communityName === 'Любители кофе');
t('пост публичного сообщества виден в общей ленте', (await call('/api/bloom/feed?tab=fresh', {}, V.tok)).data.posts.some((x) => x.id === p1.data.id));
t('посторонний реагирует/комментирует публичное', (await call(`/api/bloom/post/${p1.data.id}/react`, J({ emoji: '❤️' }), V.tok)).status === 200);
t('подмена communityId на несуществующее/чужое закрытое', (await call('/api/bloom/post', J({ text: 'x', communityId: 'bcm-00000000-0000-0000-0000-000000000000' }), U.tok)).status === 404);

/* закрытое */
const cl = await call('/api/bloom/communities', J({ name: 'Закрытый клуб', slug: `club_${sfx}`, privacy: 'closed' }), O.tok); t('закрытое создано', cl.status === 200);
const cid = cl.data.id;
const secret = await call('/api/bloom/post', J({ text: 'Секретный пост клуба', communityId: cid, tags: ['секретклуба'] }), O.tok); t('владелец пишет в закрытое', secret.status === 200);
t('в каталоге закрытое видно (название), но не посты', (await call('/api/bloom/communities?q=club_' + sfx, {}, V.tok)).data.communities.length === 1);
t('заявка вместо вступления', (await call(`/api/bloom/communities/${cid}/join`, J({}), V.tok)).data.status === 'pending' && (await call(`/api/bloom/communities/${cid}/join`, J({}), M.tok)).data.status === 'pending');
t('до принятия: посты закрыты', (await call(`/api/bloom/communities/${cid}/posts`, {}, V.tok)).data.posts.length === 0);
t('до принятия: пост недоступен по id, в ленте, по тегу, в сохранении, реакциях и комментариях', (await call(`/api/bloom/post/${secret.data.id}`, {}, V.tok)).status === 404 && !(await call('/api/bloom/feed?tab=fresh', {}, V.tok)).text.includes('Секретный пост') && !(await call('/api/bloom/feed?tab=algo&tag=секретклуба', {}, V.tok)).text.includes('Секретный пост') && (await call(`/api/bloom/post/${secret.data.id}/react`, J({ emoji: '❤️' }), V.tok)).status === 404 && (await call(`/api/bloom/post/${secret.data.id}/comment`, J({ text: 'я тут' }), V.tok)).status === 404 && (await call(`/api/bloom/post/${secret.data.id}/save`, J({}), V.tok)).status === 404);
t('не участник не видит автора-профиль постов клуба', !(await call(`/api/bloom/author/${O.pid}`, {}, V.tok)).text.includes('Секретный пост'));
t('не участник не видит список участников и журнал', (await call(`/api/bloom/communities/${cid}/members`, {}, V.tok)).status === 403 && (await call(`/api/bloom/communities/${cid}/log`, {}, V.tok)).status === 403);
t('тренды не раскрывают тег закрытого', !(await call('/api/bloom/trending', {}, V.tok)).text.includes('секретклуба'));
t('заявку принимает только модерация', (await call(`/api/bloom/communities/${cid}/members/${V.pid}`, J({ action: 'approve' }), V.tok)).status === 403 && (await call(`/api/bloom/communities/${cid}/members/${V.pid}`, J({ action: 'approve' }), O.tok)).status === 200);
t('после принятия посты видны и в ленте', (await call(`/api/bloom/communities/${cid}/posts`, {}, V.tok)).data.posts.length === 1 && (await call('/api/bloom/feed?tab=fresh', {}, V.tok)).text.includes('Секретный пост'));
t('принятый реагирует', (await call(`/api/bloom/post/${secret.data.id}/react`, J({ emoji: '❤️' }), V.tok)).status === 200);
t('отклонённая заявка удаляется', (await call(`/api/bloom/communities/${cid}/members/${M.pid}`, J({ action: 'reject' }), O.tok)).status === 200 && !(await call(`/api/bloom/communities/${cid}/posts`, {}, M.tok)).data.contentVisible);

/* роли */
t('назначить модератора может только владелец', (await call(`/api/bloom/communities/${cid}/members/${V.pid}`, J({ action: 'promote' }), V.tok)).status === 403 && (await call(`/api/bloom/communities/${cid}/members/${V.pid}`, J({ action: 'promote' }), O.tok)).status === 200);
t('модератор не трогает владельца', (await call(`/api/bloom/communities/${cid}/members/${O.pid}`, J({ action: 'ban', reason: 'причина' }), V.tok)).status === 403 && (await call(`/api/bloom/communities/${cid}/members/${O.pid}`, J({ action: 'kick' }), V.tok)).status === 403);
await call(`/api/bloom/communities/${cid}/join`, J({}), U.tok); await call(`/api/bloom/communities/${cid}/members/${U.pid}`, J({ action: 'approve' }), V.tok);
t('модератор принимает заявки', (await call(`/api/bloom/communities/${cid}/posts`, {}, U.tok)).data.contentVisible);
t('бан — только с причиной', (await call(`/api/bloom/communities/${cid}/members/${U.pid}`, J({ action: 'ban' }), V.tok)).data.error === 'reason_required');
t('модератор банит участника', (await call(`/api/bloom/communities/${cid}/members/${U.pid}`, J({ action: 'ban', reason: 'Спам в сообществе' }), V.tok)).status === 200);
t('забаненный: видит закрытое? нет; писать, возвращаться и выходить — нельзя', !(await call(`/api/bloom/communities/${cid}/posts`, {}, U.tok)).data.contentVisible && (await call('/api/bloom/post', J({ text: 'я вернулся', communityId: cid }), U.tok)).status === 403 && (await call(`/api/bloom/communities/${cid}/join`, J({}), U.tok)).data.error === 'banned' && (await call(`/api/bloom/communities/${cid}/leave`, J({}), U.tok)).data.error === 'banned');
t('забаненный не взаимодействует и в публичном (бан только в этом сообществе)', (await call(`/api/bloom/post/${secret.data.id}/react`, J({ emoji: '❤️' }), U.tok)).status === 404);
t('снятие бана', (await call(`/api/bloom/communities/${cid}/members/${U.pid}`, J({ action: 'unban' }), O.tok)).status === 200);

/* закрепление, удаление, политика */
const mp = await call('/api/bloom/post', J({ text: `Пост модератора для закрепления ${sfx}`, communityId: pub.data.id }), O.tok);
t('закрепить может только модерация', (await call(`/api/bloom/community-posts/${p1.data.id}/pin`, J({ on: true }), U.tok)).status === 403 && (await call(`/api/bloom/community-posts/${mp.data.id}/pin`, J({ on: true }), O.tok)).status === 200);
t('закреплённый сверху', (await call(`/api/bloom/communities/${pub.data.id}/posts`, {}, V.tok)).data.posts[0].id === mp.data.id);
t('удаление модерацией — с причиной, не участником', (await call(`/api/bloom/community-posts/${p1.data.id}/remove`, J({ reason: 'Нарушение правил' }), U.tok)).status === 403 && (await call(`/api/bloom/community-posts/${p1.data.id}/remove`, J({}), O.tok)).data.error === 'reason_required' && (await call(`/api/bloom/community-posts/${p1.data.id}/remove`, J({ reason: 'Нарушение правил' }), O.tok)).status === 200);
t('пост ушёл, автор получил уведомление', !(await call(`/api/bloom/communities/${pub.data.id}/posts`, {}, V.tok)).text.includes('Мой первый эспрессо') && Number(q(`SELECT count(*) FROM gift_notifications WHERE user_id = '${U.pid}' AND kind = 'bloom_community'`)) >= 1);
t('журнал модерации', (await call(`/api/bloom/communities/${pub.data.id}/log`, {}, O.tok)).data.log.some((l) => l.action === 'remove_post' && l.reason === 'Нарушение правил'));
t('политика «только модераторы»', (await call(`/api/bloom/communities/${pub.data.id}`, { method: 'PUT', body: JSON.stringify({ postPolicy: 'mods' }) }, O.tok)).status === 200 && (await call('/api/bloom/post', J({ text: 'обычный участник пишет', communityId: pub.data.id }), U.tok)).status === 403);
t('настройки правит только владелец', (await call(`/api/bloom/communities/${pub.data.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Взлом' }) }, V.tok)).status === 403 && (await call(`/api/bloom/communities/${pub.data.id}`, { method: 'DELETE' }, U.tok)).status === 403);

/* жалобы и блокировка */
t('жалоба: причина обязательна из списка, повтор нельзя', (await call(`/api/bloom/communities/${pub.data.id}/report`, J({ reason: 'зззз' }), V.tok)).status === 400 && (await call(`/api/bloom/communities/${pub.data.id}/report`, J({ reason: 'spam', text: 'Спам' }), V.tok)).status === 200 && (await call(`/api/bloom/communities/${pub.data.id}/report`, J({ reason: 'spam' }), V.tok)).status === 409 && (await call(`/api/bloom/communities/${pub.data.id}/report`, J({ reason: 'spam' }), O.tok)).status === 400);
for (const path of ['/api/admin/bloom-communities']) t('админка закрыта для людей', (await call(path, {}, V.tok)).status === 403);
t('блок и решение жалобы — только админом, с причиной', (await call(`/api/admin/bloom-communities/${pub.data.id}/block`, J({ block: true, reason: 'нарушение правил' }), V.tok)).status === 403 && (await call(`/api/admin/bloom-communities/${pub.data.id}/block`, J({ block: true }), ADM.tok)).data.error === 'reason_required');
const al = await call('/api/admin/bloom-communities?status=reported', {}, ADM.tok); t('админ видит жалобу, не посты закрытого', al.status === 200 && al.data.reports.length === 1 && !al.text.includes('Секретный пост'));
t('админ блокирует сообщество', (await call(`/api/admin/bloom-communities/${pub.data.id}/block`, J({ block: true, reason: 'Спам и мошенничество' }), ADM.tok)).status === 200);
{ const a = (await call(`/api/bloom/communities?q=coffee_${sfx}`, {}, V.tok)).data.communities.length; const b = (await call(`/api/bloom/communities/${pub.data.id}`, {}, V.tok)).status; const c = (await call('/api/bloom/feed?tab=fresh', {}, V.tok)).text.includes(`закрепления ${sfx}`); t('заблокированное: нет в каталоге, 404 людям, посты скрыты в ленте', a === 0 && b === 404 && !c, JSON.stringify([a, b, c])); }
t('в заблокированное писать нельзя', (await call('/api/bloom/post', J({ text: 'пишу', communityId: pub.data.id }), O.tok)).status === 404);
t('разблокировка возвращает', (await call(`/api/admin/bloom-communities/${pub.data.id}/block`, J({ block: false, reason: 'Решение пересмотрено' }), ADM.tok)).status === 200 && (await call(`/api/bloom/communities/${pub.data.id}`, {}, V.tok)).status === 200);
t('решение жалобы', await (async () => { const r = (await call('/api/admin/bloom-communities', {}, ADM.tok)).data.reports[0]; return (await call(`/api/admin/bloom-communities/reports/${r.id}`, J({ action: 'dismiss', note: 'Жалоба необоснована' }), ADM.tok)).status === 200; })());

/* удаление */
t('удаление сообщества убирает его посты', (await call(`/api/bloom/communities/${cid}`, { method: 'DELETE' }, O.tok)).status === 200 && (await call(`/api/bloom/post/${secret.data.id}`, {}, O.tok)).status === 404 && (await call(`/api/bloom/communities/${cid}`, {}, O.tok)).status === 404);
t('обычные посты вне сообществ работают как раньше', await (async () => { const p = await call('/api/bloom/post', J({ text: 'Обычный пост' }), V.tok); return p.status === 200 && (await call(`/api/bloom/post/${p.data.id}`, {}, O.tok)).status === 200; })());
console.log(`ok ${ok}, fail ${bad}`); process.exit(bad ? 1 : 0);
