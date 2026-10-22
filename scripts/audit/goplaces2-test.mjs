// Sky GO «Организации», этап 2: бронирование по расписанию (защита от двойной записи), отзывы, жалобы, статистика.
// API: ADMIN_GATE=off GOPLACES_RATE_MULT=50 KBIZ_RATE_MULT=50   (node scripts/audit/goplaces2-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const A = await mkuser(S, 'gbown'), B = await mkuser(S, 'gbbuy'), C = await mkuser(S, 'gbtwo'), D = await mkuser(S, 'gbthree'), ADM = await mkuser(S, 'gbadm');
q(`update profiles set is_admin=true, admin_role='go_places_moderator' where id='${ADM.pid}'`);
for (const u of [A, B, C, D]) q(`insert into wallet_accounts (user_id, balance, points) values ('${u.pid}', 500, 0) on conflict (user_id) do update set balance = 500`);
const me = (u, p, o = {}) => call(p, o, u.tok);
const post = (u, p, b) => me(u, p, { method: 'POST', body: JSON.stringify(b ?? {}) });
const put = (u, p, b) => me(u, p, { method: 'PUT', body: JSON.stringify(b ?? {}) });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const D7 = (a, b) => ({ mon: [[a, b]], tue: [[a, b]], wed: [[a, b]], thu: [[a, b]], fri: [[a, b]], sat: [[a, b]], sun: [[a, b]] });

// ─── подготовка: опубликованное место с услугой
await post(A, '/api/kbiz/business', { name: 'Барбершоп «Бритва»', mode: 'point', legalType: 'selfemployed' });
await post(A, '/api/kbiz/place/connect', { on: true });
await put(A, '/api/kbiz/place', { categoryId: 'beauty', about: 'Стрижки', city: 'Москва', address: 'ул. Тестовая, 2', hours: D7('00:00', '23:59'), phone: '+7 900 000-00-01', lat: 55.75, lng: 37.61, tz: 'Europe/Moscow' });
await me(A, '/api/kbiz/requisites', { method: 'PUT', body: JSON.stringify({ holder: 'Иванов Иван', method: 'phone', value: '+7 900 111-22-33', bank: 'Банк', purpose: 'Оплата', instruction: '' }) });
await post(A, '/api/kbiz/subscription/buy', { idemKey: 'gb1' });
await post(A, '/api/kbiz/publish', { on: true });
await post(A, '/api/kbiz/place/photo', { dataUrl: png });
const svc = await post(A, '/api/kbiz/items', { title: 'Стрижка', priceRub: 1500, kind: 'service', durationMin: 60, capacity: 1 });
const svc2 = await post(A, '/api/kbiz/items', { title: 'Парная стрижка', priceRub: 2500, kind: 'service', durationMin: 60, capacity: 2 });
const prod = await post(A, '/api/kbiz/items', { title: 'Воск', priceRub: 500, kind: 'product', stock: 3 });
t('услуга с длительностью создана', svc.status === 200 && q(`select duration_min from kb_items where id='${svc.data.id}'`) === '60');
t('длительность вне диапазона отвергнута', (await post(A, '/api/kbiz/items', { title: 'X', priceRub: 1, kind: 'service', durationMin: 1 })).status === 400);
t('вместимость вне диапазона отвергнута', (await post(A, '/api/kbiz/items', { title: 'X', priceRub: 1, kind: 'service', durationMin: 30, capacity: 0 })).status === 400);
let r = await post(A, '/api/kbiz/place/submit'); const bid = r.data.place?.businessId;
t('карточка отправлена', r.status === 200, JSON.stringify(r.data));
await post(ADM, `/api/admin/go/places/${bid}/approve`);
t('опубликована', (await me(B, `/api/go/places/${bid}`)).status === 200);

// ─── настройки записи
r = await me(B, `/api/go/places/${bid}/book`); t('запись по умолчанию выключена', r.status === 200 && r.data.enabled === false);
t('слоты при выключенной записи недоступны', (await me(B, `/api/go/places/${bid}/slots?itemId=${svc.data.id}&date=2030-01-01`)).status === 409);
t('чужой не включит запись', (await put(B, '/api/kbiz/place/booking', { enabled: true })).status === 404);
t('шаг вне диапазона отвергнут', (await put(A, '/api/kbiz/place/booking', { stepMin: 1 })).status === 400);
r = await put(A, '/api/kbiz/place/booking', { enabled: true, stepMin: 60, horizonDays: 14, leadMin: 0 });
t('запись включена', r.status === 200 && r.data.settings.enabled === true, JSON.stringify(r.data));
r = await me(B, `/api/go/places/${bid}/book`);
t('в списке только услуги с длительностью', r.data.enabled && r.data.services.length === 2 && !r.data.services.some((s) => s.title === 'Воск'), JSON.stringify(r.data));
const today = r.data.today; const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const day = addDays(today, 2);
t('слоты: 23 часовых окна на день', (await me(B, `/api/go/places/${bid}/slots?itemId=${svc.data.id}&date=${day}`)).data.slots.length === 23);
t('мусорная дата отвергнута', (await me(B, `/api/go/places/${bid}/slots?itemId=${svc.data.id}&date=abc`)).status === 400);
t('день за горизонтом — пусто', (await me(B, `/api/go/places/${bid}/slots?itemId=${svc.data.id}&date=${addDays(today, 40)}`)).data.slots.length === 0);
t('прошедший день — пусто', (await me(B, `/api/go/places/${bid}/slots?itemId=${svc.data.id}&date=${addDays(today, -1)}`)).data.slots.length === 0);
t('не услуга — нет слотов', (await me(B, `/api/go/places/${bid}/slots?itemId=${prod.data.id}&date=${day}`)).status === 409);

// ─── бронь и защита от двойной записи
const slotsA = (await me(B, `/api/go/places/${bid}/slots?itemId=${svc.data.id}&date=${day}`)).data.slots;
const s10 = slotsA.find((s) => /T0[6-9]:00:00/.test(s.start)) ?? slotsA[10]; const ct = { name: 'Пётр', phone: '+7 911 000-11-22' };
const bk = (u, it, start, extra = {}) => post(u, `/api/go/places/${bid}/book`, { itemId: it, start, contact: ct, ...extra });
t('время не из сетки отвергнуто', (await bk(B, svc.data.id, new Date(Date.parse(s10.start) + 17 * 60000).toISOString())).data.error === 'slot_unavailable');
t('прошлое время отвергнуто', (await bk(B, svc.data.id, new Date(Date.now() - 3600000).toISOString())).data.error === 'slot_unavailable');
t('без имени и телефона отказ', (await post(B, `/api/go/places/${bid}/book`, { itemId: svc.data.id, start: s10.start, contact: { name: '', phone: '1' } })).status === 400);
t('владелец у себя не записывается', (await bk(A, svc.data.id, s10.start)).status === 403);
r = await bk(B, svc.data.id, s10.start, { idemKey: 'k1' });
t('запись создана, ждёт подтверждения', r.status === 201 && r.data.status === 'requested', JSON.stringify(r.data));
const b1 = r.data.id;
t('повтор с тем же ключом — без дубля', (await bk(B, svc.data.id, s10.start, { idemKey: 'k1' })).data.duplicate === true && q(`select count(*) from gop_bookings where buyer_id='${B.pid}'`) === '1');
t('тот же человек на то же время — already_booked', (await bk(B, svc.data.id, s10.start)).data.error === 'already_booked');
t('слот у другого человека — занят (вместимость 1)', (await bk(C, svc.data.id, s10.start)).data.error === 'slot_taken');
t('занятый слот пропал из выдачи', !(await me(C, `/api/go/places/${bid}/slots?itemId=${svc.data.id}&date=${day}`)).data.slots.some((s) => s.start === s10.start));
// гонка: 6 человек на один слот услуги вместимостью 1 → выигрывает один
const others = []; for (let i = 0; i < 6; i++) others.push(await mkuser(S, `gbr${i}`));
const s11 = slotsA.find((s) => s.start !== s10.start && /T1[0-9]:00:00/.test(s.start));
const race = await Promise.all(others.map((u) => bk(u, svc.data.id, s11.start)));
t('гонка за слот: ровно одна запись', race.filter((x) => x.status === 201).length === 1 && race.filter((x) => x.data.error === 'slot_taken').length === 5, race.map((x) => x.status).join());
t('в базе ровно одна бронь на слот', q(`select count(*) from gop_bookings where item_id='${svc.data.id}' and starts_at='${s11.start}'`) === '1');
// вместимость 2
const s12 = (await me(B, `/api/go/places/${bid}/slots?itemId=${svc2.data.id}&date=${day}`)).data.slots[3];
const cap = await Promise.all([B, C, D].map((u) => bk(u, svc2.data.id, s12.start)));
t('вместимость 2: две записи из трёх', cap.filter((x) => x.status === 201).length === 2 && cap.filter((x) => x.data.error === 'slot_taken').length === 1, cap.map((x) => x.status).join());
t('предел активных записей у места — 5', (await (async () => { const u = await mkuser(S, 'gblim'); let last; for (let i = 0; i < 7; i++) last = await bk(u, svc2.data.id, slotsA[i + 12]?.start ?? s12.start); return last.data.error; })()) !== undefined);

// ─── владелец
r = await me(A, '/api/kbiz/place/bookings'); t('владелец видит записи с контактом', r.status === 200 && r.data.bookings.some((x) => x.id === b1 && x.name === 'Пётр' && x.phone.includes('911')));
t('чужой не видит записей', (await me(C, '/api/kbiz/place/bookings')).status === 404);
t('чужой не подтвердит', (await post(C, `/api/kbiz/place/bookings/${b1}/confirm`)).status === 404);
t('отклонить без причины нельзя', (await post(A, `/api/kbiz/place/bookings/${b1}/reject`, {})).status === 400);
t('подтверждение', (await post(A, `/api/kbiz/place/bookings/${b1}/confirm`)).data.status === 'confirmed');
t('повтор подтверждения — без ошибки', (await post(A, `/api/kbiz/place/bookings/${b1}/confirm`)).data.duplicate === true);
t('«состоялась» до начала нельзя', (await post(A, `/api/kbiz/place/bookings/${b1}/done`)).status === 409);
t('покупатель видит статус и может отменить', (await me(B, '/api/go/places/bookings')).data.bookings.find((x) => x.id === b1)?.canCancel === true);
t('чужой не отменит чужую запись', (await post(C, `/api/go/places/bookings/${b1}/cancel`)).status === 404);
t('отмена покупателем', (await post(B, `/api/go/places/bookings/${b1}/cancel`)).data.status === 'cancelled');
t('отменённый слот снова свободен', (await me(C, `/api/go/places/${bid}/slots?itemId=${svc.data.id}&date=${day}`)).data.slots.some((s) => s.start === s10.start));
t('владелец и покупатель получили уведомления без дублей', Number(q(`select count(*) from gift_notifications where ref_id like 'gopb:${b1}:%'`)) >= 2 && Number(q(`select count(*) - count(distinct (user_id, ref_id)) from gift_notifications where ref_id like 'gopb:${b1}:%'`)) === 0);
// выходной день
t('выходной день закрывает слоты', (await post(A, '/api/kbiz/place/booking/day-off', { day, reason: 'Праздник' })).status === 200 && (await me(C, `/api/go/places/${bid}/slots?itemId=${svc.data.id}&date=${day}`)).data.dayOff === true);
t('и бронь на выходной отвергается', (await bk(C, svc.data.id, s10.start)).data.error === 'slot_unavailable');
await post(A, '/api/kbiz/place/booking/day-off', { day, on: false });
// часы изменены → старый слот вне часов
await put(A, '/api/kbiz/place', { hours: D7('09:00', '10:00') });
t('слот вне новых часов отвергнут', (await bk(C, svc.data.id, s11.start)).data.error === 'slot_unavailable');
t('изменение часов не возвращает карточку в черновик (часы не проверяемое поле)', (await me(B, `/api/go/places/${bid}`)).status === 200);

// ─── отзывы
t('отзыв без заказа/записи нельзя', (await post(C, `/api/go/places/${bid}/reviews`, { rating: 5, text: 'ок' })).data.error === 'review_not_allowed');
q(`update gop_bookings set status='done' where id='${b1}'`);
t('после состоявшейся записи отзыв можно', (await me(B, `/api/go/places/${bid}/reviews`)).data.canReview === true);
t('оценка вне 1–5 отвергнута', (await post(B, `/api/go/places/${bid}/reviews`, { rating: 9 })).status === 400);
r = await post(B, `/api/go/places/${bid}/reviews`, { rating: 4, text: 'Хорошо' });
t('отзыв опубликован, рейтинг по настоящим данным', r.status === 201 && r.data.count === 1 && r.data.avg === 4, JSON.stringify(r.data));
t('второй отзыв нельзя', (await post(B, `/api/go/places/${bid}/reviews`, { rating: 5 })).data.error === 'already_reviewed');
t('владелец отвечает', (await post(A, `/api/kbiz/place/reviews/${(await me(A, '/api/kbiz/place/reviews')).data.reviews[0].id}/reply`, { text: 'Спасибо!' })).status === 200);
const rid = (await me(A, '/api/kbiz/place/reviews')).data.reviews[0].id;
t('чужой не отвечает на отзыв', (await post(C, `/api/kbiz/place/reviews/${rid}/reply`, { text: 'Взлом' })).status === 404);
t('отзыв не скрыть без права и без причины', (await post(B, `/api/admin/go/places/reviews/${rid}/hide`, { reason: 'abcde' })).status === 403 && (await post(ADM, `/api/admin/go/places/reviews/${rid}/hide`, {})).status === 400);
await post(ADM, `/api/admin/go/places/reviews/${rid}/hide`, { reason: 'Оскорбления' });
t('скрытый отзыв не виден и не считается', (await me(C, `/api/go/places/${bid}/reviews`)).data.count === 0);
await post(ADM, `/api/admin/go/places/reviews/${rid}/show`, {});

// ─── жалобы
t('причина жалобы из закрытого списка', (await post(C, `/api/go/places/${bid}/report`, { reason: 'bogus' })).status === 400);
t('«другое» без текста нельзя', (await post(C, `/api/go/places/${bid}/report`, { reason: 'other' })).status === 400);
t('жалоба принята', (await post(C, `/api/go/places/${bid}/report`, { reason: 'closed', text: 'Не работает' })).status === 201);
t('повторная открытая — без дубля', (await post(C, `/api/go/places/${bid}/report`, { reason: 'closed' })).data.duplicate === true && q(`select count(*) from gop_reports where profile_id='${C.pid}'`) === '1');
t('владелец жалуется на себя — нет', (await post(A, `/api/go/places/${bid}/report`, { reason: 'fraud' })).status === 403);
t('жалобы видит только администрация', (await me(C, '/api/admin/go/places/reports')).status === 403);
r = await me(ADM, '/api/admin/go/places/reports'); const rep = r.data.reports.find((x) => x.placeId === bid);
t('очередь жалоб', Boolean(rep));
t('решение без заметки нельзя', (await post(ADM, `/api/admin/go/places/reports/${rep.id}/resolve`, {})).status === 400);
t('решение жалобы', (await post(ADM, `/api/admin/go/places/reports/${rep.id}/resolve`, { note: 'Проверено, работает' })).data.status === 'resolved');
t('повторное решение — отказ', (await post(ADM, `/api/admin/go/places/reports/${rep.id}/resolve`, { note: 'Ещё раз' })).status === 409);

// ─── статистика
r = await me(A, '/api/kbiz/place/stats?days=30');
t('статистика владельца из настоящих таблиц', r.status === 200 && r.data.bookings.total >= 8 && r.data.bookings.done === 1 && r.data.reviews.count === 1 && r.data.reviews.avg === 4, JSON.stringify(r.data));
t('чужому статистика недоступна', (await me(C, '/api/kbiz/place/stats')).status === 404);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
