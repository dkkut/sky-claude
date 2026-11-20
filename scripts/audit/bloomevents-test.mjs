// Bloom: мероприятия + цветочные магазины Market через HTTP
// API: OWNER_USERNAME=lifeowner ADMIN_GATE=off ADMIN_TOKEN=off EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test RATE_LIMIT_PER_MINUTE=5000; запуск: node scripts/audit/bloomevents-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2]; let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const q = (s) => execSync(`psql postgres://sky:sky@localhost:5432/skytest -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const J = (o, m = 'POST') => ({ method: m, body: JSON.stringify(o) });
const O = await mkuser(S, 'EvO'), A = await mkuser(S, 'EvA'), B = await mkuser(S, 'EvB'), C = await mkuser(S, 'EvC'), ADM = await mkuser(S, 'EvAdm');
q(`UPDATE profiles SET is_admin = true WHERE id = '${ADM.pid}'`);
q(`UPDATE admin_lockdown SET active = false`);  // самозащита от шума теста не должна закрывать панель
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString();

t('без входа 401', (await call('/api/bloom/events')).status === 401);
t('валидация: короткое название, нет места, прошлое, плохая ссылка, плохие места', (await call('/api/bloom/events', J({ title: 'ab', place: 'x', startsAt: day(1) }), O.tok)).data.error === 'bad_title'
  && (await call('/api/bloom/events', J({ title: 'Встреча', startsAt: day(1) }), O.tok)).data.error === 'place_required'
  && (await call('/api/bloom/events', J({ title: 'Встреча', place: 'x', startsAt: day(-2) }), O.tok)).data.error === 'start_in_past'
  && (await call('/api/bloom/events', J({ title: 'Встреча', onlineUrl: 'http://x.com', startsAt: day(1) }), O.tok)).data.error === 'bad_link'
  && (await call('/api/bloom/events', J({ title: 'Встреча', place: 'x', capacity: 0, startsAt: day(1) }), O.tok)).data.error === 'bad_capacity'
  && (await call('/api/bloom/events', J({ title: 'Встреча', place: 'x', startsAt: day(1), endsAt: day(30) }), O.tok)).data.error === 'bad_end');
const e1 = await call('/api/bloom/events', J({ title: 'Встреча цветоводов', description: 'Обмен рассадой', place: 'Парк Горького', startsAt: day(2), capacity: 2 }), O.tok);
t('мероприятие создано', e1.status === 200 && e1.data.id, e1.text); const id = e1.data.id;
const g = await call(`/api/bloom/events/${id}`, {}, A.tok);
t('карточка видна другому: организатор, 0 идущих, не организатор', g.status === 200 && g.data.event.going === 0 && !g.data.event.isOrganizer && g.data.event.organizer.id === O.pid);
t('в ленте предстоящих', (await call('/api/bloom/events', {}, A.tok)).data.events.some((e) => e.id === id));
t('«пойду» с занятием места', (await call(`/api/bloom/events/${id}/rsvp`, J({ status: 'going' }), A.tok)).status === 200 && (await call(`/api/bloom/events/${id}`, {}, A.tok)).data.event.mine === 'going');
t('повтор «пойду» не удваивает', (await call(`/api/bloom/events/${id}/rsvp`, J({ status: 'going' }), A.tok)).status === 200 && (await call(`/api/bloom/events/${id}`, {}, B.tok)).data.event.going === 1);
t('«интересно» не занимает место', (await call(`/api/bloom/events/${id}/rsvp`, J({ status: 'interested' }), C.tok)).status === 200 && (await call(`/api/bloom/events/${id}`, {}, C.tok)).data.event.interested === 1);
/* гонка за последнее место: вместимость 2, идёт A; B и C одновременно */
const race = await Promise.all([B, C].map((u) => call(`/api/bloom/events/${id}/rsvp`, J({ status: 'going' }), u.tok)));
t('гонка за последнее место: ровно один получил', race.filter((r) => r.status === 200).length === 1 && race.filter((r) => r.data.error === 'event_full').length === 1, JSON.stringify(race.map((r) => r.data)));
t('на деле идёт 2 (число мест)', (await call(`/api/bloom/events/${id}`, {}, O.tok)).data.event.going === 2 && (await call(`/api/bloom/events/${id}`, {}, O.tok)).data.event.full === true);
t('плохой статус', (await call(`/api/bloom/events/${id}/rsvp`, J({ status: 'x' }), A.tok)).data.error === 'bad_status');
t('имена видит только организатор', (await call(`/api/bloom/events/${id}/attendees`, {}, A.tok)).status === 404 && (await call(`/api/bloom/events/${id}/attendees`, {}, O.tok)).data.attendees.length === 3);
t('чужое не правится и не отменяется', (await call(`/api/bloom/events/${id}`, J({ title: 'Взлом' }, 'PUT'), A.tok)).status === 404 && (await call(`/api/bloom/events/${id}/cancel`, J({}), A.tok)).status === 404);
t('нельзя уменьшить места ниже числа идущих', (await call(`/api/bloom/events/${id}`, J({ capacity: 1 }, 'PUT'), O.tok)).data.error === 'capacity_below_going');
t('перенос уведомляет идущих', (await call(`/api/bloom/events/${id}`, J({ startsAt: day(3) }, 'PUT'), O.tok)).status === 200 && Number(q(`SELECT count(*) FROM gift_notifications WHERE user_id='${A.pid}' AND kind='bloom_event' AND title='Мероприятие изменилось'`)) === 1);
t('выйти из события', (await call(`/api/bloom/events/${id}/rsvp`, J({ status: 'none' }), A.tok)).status === 200 && (await call(`/api/bloom/events/${id}`, {}, A.tok)).data.event.mine === null);
t('фильтр контента: блок', (await call('/api/bloom/events', J({ title: 'Куплю кокаин доставка', place: 'тут', startsAt: day(2) }), O.tok)).status === 422);
const held = await call('/api/bloom/events', J({ title: 'Вечеринка 18+ эротика', description: 'порно вечер', place: 'клуб', startsAt: day(2) }), O.tok);
if (held.data.held) {
  t('удержанное скрыто от других, видно организатору', !(await call('/api/bloom/events', {}, A.tok)).data.events.some((e) => e.id === held.data.id) && (await call(`/api/bloom/events/${held.data.id}`, {}, O.tok)).status === 200 && (await call(`/api/bloom/events/${held.data.id}`, {}, A.tok)).status === 404);
  t('на удержанное записаться нельзя', (await call(`/api/bloom/events/${held.data.id}/rsvp`, J({ status: 'going' }), A.tok)).status === 404);
}
/* сообщество */
const sfx = Date.now().toString(36).slice(-6);
const cl = await call('/api/bloom/communities', J({ name: 'Закрытый клуб цветов', slug: `fl_${sfx}`, privacy: 'closed' }), O.tok);
t('не модератор не создаёт событие сообщества', (await call('/api/bloom/events', J({ title: 'Событие клуба', place: 'x', startsAt: day(2), communityId: cl.data.id }), A.tok)).data.error === 'forbidden');
const ce = await call('/api/bloom/events', J({ title: 'Событие клуба', place: 'x', startsAt: day(2), communityId: cl.data.id }), O.tok);
t('владелец создаёт событие закрытого сообщества', ce.status === 200, ce.text);
t('чужому закрытое недоступно (прямо, в ленте, запись)', (await call(`/api/bloom/events/${ce.data.id}`, {}, A.tok)).status === 404 && !(await call('/api/bloom/events', {}, A.tok)).data.events.some((e) => e.id === ce.data.id) && (await call(`/api/bloom/events/${ce.data.id}/rsvp`, J({ status: 'going' }), A.tok)).status === 404);
await call(`/api/bloom/communities/${cl.data.id}/join`, J({}), A.tok); await call(`/api/bloom/communities/${cl.data.id}/members/${A.pid}`, J({ action: 'approve' }), O.tok);
t('после принятия участник видит и записывается', (await call(`/api/bloom/events/${ce.data.id}`, {}, A.tok)).status === 200 && (await call(`/api/bloom/events/${ce.data.id}/rsvp`, J({ status: 'going' }), A.tok)).status === 200);
t('фильтр по сообществу', (await call(`/api/bloom/events?communityId=${cl.data.id}`, {}, A.tok)).data.events.length === 1);
/* отмена */
t('отмена с причиной и уведомление идущим', (await call(`/api/bloom/events/${id}/cancel`, J({ reason: 'Дождь' }), O.tok)).status === 200 && Number(q(`SELECT count(*) FROM gift_notifications WHERE user_id='${C.pid}' AND kind='bloom_event' AND title='Мероприятие отменено'`)) === 1);
t('отменённое: запись и правка закрыты, из ленты ушло', (await call(`/api/bloom/events/${id}/rsvp`, J({ status: 'going' }), B.tok)).data.error === 'cancelled' && (await call(`/api/bloom/events/${id}`, J({ title: 'Ещё раз' }, 'PUT'), O.tok)).data.error === 'bad_state' && !(await call('/api/bloom/events', {}, A.tok)).data.events.some((e) => e.id === id));
t('повторная отмена — 409', (await call(`/api/bloom/events/${id}/cancel`, J({}), O.tok)).status === 409);
/* админ-снятие */
const e3 = await call('/api/bloom/events', J({ title: 'Событие для снятия', place: 'x', startsAt: day(4) }), O.tok);
t('снятие только с причиной и правом', (await call(`/api/admin/bloom-events/${e3.data.id}/remove`, J({ reason: 'нарушение правил' }), A.tok)).status === 403 && (await call(`/api/admin/bloom-events/${e3.data.id}/remove`, J({ reason: 'ок' }), ADM.tok)).data.error === 'reason_required');
t('админ снял — скрыто', (await call(`/api/admin/bloom-events/${e3.data.id}/remove`, J({ reason: 'нарушение правил' }), ADM.tok)).status === 200 && (await call(`/api/bloom/events/${e3.data.id}`, {}, A.tok)).status === 404);
q(`UPDATE bloom_events SET starts_at = now() + interval '30 minutes', reminded_at = NULL WHERE id = '${ce.data.id}'`);
for (let i = 0; i < 14 && q(`SELECT reminded_at IS NULL FROM bloom_events WHERE id = '${ce.data.id}'`) === 't'; i += 1) await new Promise((r) => setTimeout(r, 5000));
t('напоминание за час идущему, один раз', Number(q(`SELECT count(*) FROM gift_notifications WHERE user_id='${A.pid}' AND kind='bloom_event' AND title='Скоро мероприятие'`)) === 1);
/* цветочные магазины */
const cols = q(`SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_name = 'market_sellers'`);
t('market_sellers есть', cols.includes('shop_name'));
const sid = O.pid;
try {
  q(`INSERT INTO market_sellers (profile_id, shop_name, status, verification_status) VALUES ('${sid}', 'Тест Цветы ${sfx}', 'active', 'legacy') ON CONFLICT (profile_id) DO UPDATE SET status = 'active'`);
  q(`INSERT INTO market_products (id, seller_id, title, price_kop, category, active, moderation_status, market_type, search_text) VALUES ('mp-${crypto.randomUUID()}', '${sid}', 'Розы 25 шт', 250000, 'flowers', true, 'published', 'standard', 'розы')`);
} catch (e) { console.log('seed fail', String(e.message).slice(0, 300)); }
const fs = await call('/api/market/flower-shops', {}, A.tok);
t('цветочные магазины: список с моим магазином', fs.status === 200 && fs.data.shops.some((s) => s.id === sid && s.flowersCount === 1), fs.text.slice(0, 300));
const cat = await call('/api/market/catalog?category=flowers&sellerId=' + sid, {}, A.tok);
t('каталог по категории flowers и магазину', cat.status === 200 && cat.data.items.length === 1 && cat.data.items[0].category === 'flowers', cat.text.slice(0, 300));
q(`UPDATE market_sellers SET status = 'suspended' WHERE profile_id = '${sid}'`);
t('приостановленный магазин в списке не показывается', !(await call('/api/market/flower-shops', {}, A.tok)).data.shops.some((s) => s.id === sid));
console.log(`ok=${ok} bad=${bad}`); process.exit(bad ? 1 : 0);
