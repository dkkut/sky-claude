// Верификация: заявка → решение → отметка, права, самопроверка, причины, история, критерии, «Официальный».
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const staff = async (tag, role) => { const u = await mkuser(S, tag); q(`update profiles set is_admin=true, admin_role='${role}' where id='${u.pid}'`); return u; };

q(`update profiles set username='old'||substr(id,1,8) where lower(username)='verowner'`);
const GC = 'chat-ver-' + Date.now().toString(36);
const OWN = await mkuser(S, 'verOwn'); q(`update profiles set username='verowner' where id='${OWN.pid}'`);
const U = await mkuser(S, 'verUser'); const V = await mkuser(S, 'verOther');
const ST = await staff('verStaff', 'verification_admin'); const NO = await staff('verNoRight', 'support_admin');
q(`update verification_settings set min_account_days=0, min_members=2, min_videos=1, retry_days=14, enabled=true, require_email=true`);
q(`update sky_ids set email_verified=true where id in (select sky_id from profiles where id in ('${U.pid}','${V.pid}','${ST.pid}'))`);

let r = await call('/api/verification/mine', {}, U.tok);
t('человек видит свои объекты и критерии', r.status === 200 && r.data.subjects[0].type === 'user' && r.data.criteriaText.length > 10 && r.data.subjects[0].eligible === true, JSON.stringify(r.data).slice(0, 200));

r = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'user', note: 'коротко' }) }, U.tok);
t('заявка без пояснения — отказ', r.status === 400 && r.data.error === 'note_required', JSON.stringify(r.data));
r = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'user', subjectId: V.pid, note: 'Это мой аккаунт, подтверждаю ссылками' }) }, U.tok);
t('нельзя просить отметку для чужого аккаунта', r.status === 403 && r.data.error === 'not_owner' || r.status === 400, JSON.stringify(r.data));
r = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'official', note: 'пожалуйста дайте официальный' }) }, U.tok);
t('«Официальный» по заявке не выдаётся', r.status === 400 && r.data.error === 'bad_type');
r = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'user', note: 'Это мой аккаунт, ссылки приложены', links: ['https://example.com/me', 'http://plain.example', 'javascript:alert(1)'] }) }, U.tok);
t('заявка создана', r.status === 200 && r.data.ok, JSON.stringify(r.data));
const VID = r.data.id;
r = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'user', note: 'Это мой аккаунт, ссылки приложены' }) }, U.tok);
t('вторая заявка на тот же объект — 409', r.status === 409 && r.data.error === 'already_pending');
t('ссылки: только https, остальное отброшено', (await call(`/api/admin/verification/${VID}`, {}, ST.tok)).data.item.links.join() === 'https://example.com/me');

// права
r = await call('/api/admin/verification', {}, U.tok);
t('обычный человек очередь не видит', r.status === 403);
r = await call('/api/admin/verification', {}, NO.tok);
t('сотрудник без права verification очередь не видит', r.status === 403);
r = await call('/api/admin/verification', {}, ST.tok);
t('сотрудник видит очередь и счётчики', r.status === 200 && r.data.items.some((i) => i.id === VID) && r.data.stats.pending >= 1);
r = await call(`/api/admin/verification/${VID}/decide`, { method: 'POST', body: JSON.stringify({ approve: true }) }, U.tok);
t('присвоить отметку себе нельзя (обычный человек)', r.status === 403);

// отметка до решения
r = await call(`/api/verification/marks?type=user&ids=${U.pid}`, {}, V.tok);
t('до решения отметки нет', !r.data.marks[U.pid]);
// отказ требует причину
r = await call(`/api/admin/verification/${VID}/decide`, { method: 'POST', body: JSON.stringify({ approve: false }) }, ST.tok);
t('отказ без причины — 400', r.status === 400 && r.data.error === 'reason_required');
r = await call(`/api/admin/verification/${VID}/decide`, { method: 'POST', body: JSON.stringify({ approve: false, reason: 'Недостаточно подтверждений' }) }, ST.tok);
t('отказ с причиной', r.status === 200 && r.data.status === 'rejected');
r = await call('/api/verification/mine', {}, U.tok);
t('заявитель видит причину отказа', r.data.subjects[0].current.status === 'rejected' && r.data.subjects[0].current.reason === 'Недостаточно подтверждений', JSON.stringify(r.data.subjects[0].current));
r = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'user', note: 'Повторная заявка с новыми ссылками' }) }, U.tok);
t('повтор сразу после отказа — подождать', r.status === 429 && r.data.error === 'retry_later', JSON.stringify(r.data));
q(`update verifications set decided_at = now() - interval '15 days' where id='${VID}'`);
r = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'user', note: 'Повторная заявка с новыми ссылками' }) }, U.tok);
t('после срока повтор разрешён', r.status === 200, JSON.stringify(r.data));
const VID2 = r.data.id;

// сотрудник не решает по себе
const rs = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'user', note: 'Я сотрудник, прошу отметку для себя' }) }, ST.tok);
r = await call(`/api/admin/verification/${rs.data.id}/decide`, { method: 'POST', body: JSON.stringify({ approve: true }) }, ST.tok);
t('сотрудник не одобряет заявку на себя', rs.status === 200 && r.status === 403 && r.data.error === 'self_review', JSON.stringify(r.data));

r = await call(`/api/admin/verification/${VID2}/decide`, { method: 'POST', body: JSON.stringify({ approve: true }) }, ST.tok);
t('одобрение', r.status === 200 && r.data.status === 'approved');
r = await call(`/api/admin/verification/${VID2}/decide`, { method: 'POST', body: JSON.stringify({ approve: false, reason: 'передумал' }) }, ST.tok);
t('повторное решение — 409', r.status === 409);
r = await call(`/api/verification/marks?type=user&ids=${U.pid},${V.pid}`, {}, V.tok);
t('отметка видна всем, только у подтверждённого', r.data.marks[U.pid] === 'verified' && !r.data.marks[V.pid], JSON.stringify(r.data));
r = await call(`/api/verification/marks?type=chat_group&ids=${U.pid}`, {}, V.tok);
t('отметки других типов не смешиваются', !r.data.marks[U.pid]);
r = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'user', note: 'ещё одна заявка не нужна' }) }, U.tok);
t('уже подтверждённый — 409', r.status === 409 && r.data.error === 'already_verified');

// история и журнал
r = await call(`/api/admin/verification/${VID2}`, {}, ST.tok);
t('история: заявка и решение', r.data.history.map((h) => h.event).join() === 'requested,approved', JSON.stringify(r.data.history));
t('решения попали в журнал администрации', Number(q(`select count(*) from admin_log where type like 'verification_%'`)) >= 2);
t('уведомление заявителю', Number(q(`select count(*) from gift_notifications where user_id='${U.pid}' and kind='verification'`)) >= 2);

// снятие
r = await call(`/api/admin/verification/${VID2}/revoke`, { method: 'POST', body: JSON.stringify({}) }, ST.tok);
t('снятие без причины — 400', r.status === 400);
r = await call(`/api/admin/verification/${VID2}/revoke`, { method: 'POST', body: JSON.stringify({ reason: 'Нарушение правил' }) }, ST.tok);
t('снятие с причиной', r.status === 200);
r = await call(`/api/verification/marks?type=user&ids=${U.pid}`, {}, V.tok);
t('после снятия отметки нет', !r.data.marks[U.pid]);

// группа
const g = await call('/api/skyid/profiles', {}, U.tok); // прогрев
q(`insert into chats (id,type,name,owner_id) values ('${GC}','group','x','${U.pid}')`);
q(`insert into chat_members (chat_id,user_id) values ('${GC}','${U.pid}')`);
r = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'chat_group', subjectId: GC, note: 'Группа сообщества, подтверждаю владение' }) }, U.tok);
t('группа с 1 участником не проходит минимум (2)', r.status === 400 && r.data.error === 'not_eligible' && /участников/.test(r.data.problems.join()), JSON.stringify(r.data));
q(`insert into chat_members (chat_id,user_id) values ('${GC}','${V.pid}')`);
r = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'chat_group', subjectId: GC, note: 'Группа сообщества, подтверждаю владение' }) }, V.tok);
t('участник группы, не владелец, заявку не подаёт', r.status === 403 && r.data.error === 'not_owner', JSON.stringify(r.data));
r = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'chat_group', subjectId: GC, note: 'Группа сообщества, подтверждаю владение' }) }, U.tok);
t('владелец группы подаёт заявку', r.status === 200, JSON.stringify(r.data));
r = await call(`/api/admin/verification/${r.data.id}/decide`, { method: 'POST', body: JSON.stringify({ approve: true }) }, ST.tok);
r = await call(`/api/verification/marks?type=chat_group&ids=${GC}`, {}, V.tok);
t('отметка у группы', r.data.marks[GC] === 'verified');

// «Официальный»
r = await call('/api/admin/verification/official', { method: 'POST', body: JSON.stringify({ subjectType: 'user', subjectId: V.pid, reason: 'Служба поддержки Sky' }) }, ST.tok);
t('сотрудник «Официальный» не ставит', r.status === 403 && r.data.error === 'owner_only', JSON.stringify(r.data));
r = await call('/api/admin/verification/official', { method: 'POST', body: JSON.stringify({ subjectType: 'user', subjectId: V.pid }) }, OWN.tok);
t('владелец: без причины нельзя', r.status === 400 && r.data.error === 'reason_required', JSON.stringify(r.data));
r = await call('/api/admin/verification/official', { method: 'POST', body: JSON.stringify({ subjectType: 'user', subjectId: V.pid, reason: 'Служба поддержки Sky' }) }, OWN.tok);
t('владелец ставит «Официальный»', r.status === 200, JSON.stringify(r.data));
r = await call(`/api/verification/marks?type=user&ids=${V.pid}`, {}, U.tok);
t('отметка «official»', r.data.marks[V.pid] === 'official');
const offId = q(`select id from verifications where subject_id='${V.pid}' and mark='official' and status='approved'`);
r = await call(`/api/admin/verification/${offId}/revoke`, { method: 'POST', body: JSON.stringify({ reason: 'Больше не нужна' }) }, ST.tok);
t('«Официальный» снимает только владелец', r.status === 403 && r.data.error === 'owner_only');

// критерии и закрытие приёма
r = await call('/api/admin/verification/settings', { method: 'PUT', body: JSON.stringify({ enabled: false, criteriaText: 'Новые критерии' }) }, ST.tok);
t('критерии и приём правятся', r.status === 200 && r.data.settings.enabled === false && r.data.settings.criteriaText === 'Новые критерии');
r = await call('/api/verification/request', { method: 'POST', body: JSON.stringify({ type: 'video_channel', note: 'Мой видеоканал, прошу отметку' }) }, V.tok);
t('приём закрыт — заявки не принимаются', r.status === 400 && r.data.error === 'closed', JSON.stringify(r.data));
r = await call('/api/admin/verification/settings', { method: 'PUT', body: JSON.stringify({ enabled: true }) }, U.tok);
t('настройки обычному человеку недоступны', r.status === 403);
q(`update verification_settings set enabled=true, min_account_days=30, min_members=10, min_videos=3, criteria_text='Аккаунт настоящий и ведётся владельцем.'`);
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
