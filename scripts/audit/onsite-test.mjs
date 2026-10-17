// Sky Market «На месте»: объявления, радиус (город/область/страна), заявки, бронь, код встречи, итог, отзывы, жалобы, уборка. API с ADMIN_GATE=off ONSITE_RATE_MULT=20 RATE_LIMIT_PER_MINUTE=5000
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const O = (path, o, tok) => call('/api/onsite' + path, o, tok);
const J = (b, m = 'POST') => ({ method: m, body: JSON.stringify(b) });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const photo = (id, tok, body = PNG) => call(`/api/onsite/my/listings/${id}/photos`, { method: 'POST', body, headers: { 'content-type': 'application/octet-stream' } }, tok);
const tag = Date.now().toString(36);

const A = await mkuser(S, 'osAdm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const SL = await mkuser(S, 'osSel'); const B1 = await mkuser(S, 'osBuy1'); const B2 = await mkuser(S, 'osBuy2'); const X = await mkuser(S, 'osOth');
const inH = (h) => new Date(Date.now() + h * 3600000).toISOString();
const mk = async (extra = {}) => {
  const r = await O('/my/listings', J({ title: `Велосипед ${tag}`, descr: 'Хорошее состояние', category: 'sport', condition: 'used', priceRub: 5000, scope: 'city', country: 'RU', city: 'Казань', region: 'Татарстан', area: 'Вахитовский', ...extra }, 'PUT'), SL.tok);
  return r;
};

/* Метаданные и проверка полей */
let r = await O('/meta', {}, B1.tok); t('мета: категории и честное примечание «Sky деньги не принимает»', r.status === 200 && r.data.categories.includes('sport') && /не принимает деньги/.test(r.data.note));
for (const [n, patch, code] of [['короткое название', { title: 'ab' }, 'title_required'], ['неверная категория', { category: 'weapons' }, 'bad_category'], ['отрицательная цена', { priceRub: -5 }, 'bad_price'], ['неверный радиус', { scope: 'planet' }, 'bad_scope'], ['нет города', { city: '' }, 'city_required'], ['область для «по области»', { scope: 'region', region: '' }, 'region_required']]) {
  r = await mk(patch); t(`отклонено: ${n}`, r.status === 400 && r.data.error === code, JSON.stringify(r.data));
}
r = await mk(); const L1 = r.data.id; t('черновик создан', r.status === 200 && /^os-/.test(L1), JSON.stringify(r.data));
r = await O('/my/listings/' + L1 + '/publish', J({}), SL.tok); t('без фото публиковать нельзя', r.status === 400 && r.data.error === 'photo_required');
r = await photo(L1, X.tok); t('чужое объявление — фото добавить нельзя', r.status === 404);
r = await photo(L1, SL.tok, Buffer.from('это не картинка, просто текст длиннее шестнадцати байт')); t('не картинка отклонена', r.status === 400 && r.data.error === 'unsupported_type');
r = await photo(L1, SL.tok); const P1 = r.data.id; t('фото добавлено (PNG по сигнатуре)', r.status === 201 && /^osp-/.test(P1), JSON.stringify(r.data));
r = await O('/listings/' + L1, {}, B1.tok); t('черновик покупателю не виден', r.status === 404);
r = await O('/my/listings/' + L1 + '/publish', J({}), SL.tok); t('опубликовано', r.status === 200 && r.data.status === 'published');
r = await call('/api/onsite/photos/' + P1, {}, B1.tok); t('фото опубликованного объявления доступно покупателю', r.status === 200);
r = await O('/listings/' + L1, {}, B1.tok); t('страница: цена, продавец, рейтинг без выдуманных отзывов', r.status === 200 && r.data.listing.priceRub === 5000 && r.data.listing.seller.reviews === 0 && r.data.listing.seller.avg === null && r.data.listing.photos.length === 1, JSON.stringify(r.data).slice(0, 200));

/* Радиус: город / область / страна */
const L2 = (await mk({ title: `Диван ${tag}`, category: 'furniture', scope: 'region', city: 'Набережные Челны', region: 'Татарстан', priceRub: 3000 })).data.id; await photo(L2, SL.tok); await O('/my/listings/' + L2 + '/publish', J({}), SL.tok);
const L3 = (await mk({ title: `Гитара ${tag}`, category: 'hobby', scope: 'country', city: 'Москва', region: 'Москва', priceRub: 12000 })).data.id; await photo(L3, SL.tok); await O('/my/listings/' + L3 + '/publish', J({}), SL.tok);
const ids = async (qs) => (await O('/listings?' + qs + `&q=${tag}`, {}, B1.tok)).data.items.map((i) => i.id);
let got = await ids('country=RU&city=Казань&region=Татарстан&reach=city'); t('«мой город»: только объявления из Казани', got.length === 1 && got[0] === L1, got.join());
got = await ids('country=RU&city=Казань&region=Татарстан&reach=region'); t('«+ область»: Казань + область-объявление из Челнов (продавец готов по области)', got.includes(L1) && got.includes(L2) && !got.includes(L3), got.join());
got = await ids('country=RU&city=Казань&region=Татарстан&reach=country'); t('«+ вся страна»: добавляется объявление «по стране» из Москвы', got.includes(L1) && got.includes(L2) && got.includes(L3), got.join());
got = await ids('country=RU&city=Самара&region=Самарская&reach=country'); t('другой город и область: видно только то, что продавец готов привезти по стране', got.length === 1 && got[0] === L3, got.join());
got = await ids('country=RU&city=Самара&region=Самарская&reach=city'); t('чужой город, «мой город» — пусто', got.length === 0);
got = await ids('country=KZ&city=Алматы&region=&reach=country'); t('другая страна — пусто', got.length === 0);
got = (await O('/listings?country=RU&city=Казань&region=Татарстан&reach=country&category=hobby&q=' + tag, {}, B1.tok)).data.items.map((i) => i.id); t('фильтр по категории', got.length === 0 || got.every((x) => x === L3));
let items = (await O(`/listings?country=RU&city=Казань&region=Татарстан&reach=country&q=${tag}&sort=cheap`, {}, B1.tok)).data.items; t('сортировка «дешёвые»', items[0].priceRub <= items[items.length - 1].priceRub);
items = (await O(`/listings?country=RU&city=Казань&region=Татарстан&reach=country&q=${tag}&min=4000&max=6000`, {}, B1.tok)).data.items; t('фильтр по цене', items.length === 1 && items[0].id === L1);
items = (await O(`/listings?country=RU&city=Казань&region=Татарстан&reach=country&q=${tag}`, {}, SL.tok)).data.items; t('продавец в каталоге своих объявлений не видит', items.length === 0);
r = await O('/listings?q=%25%27%3B--', {}, B1.tok); t('мусор в поиске безопасен', r.status === 200);

/* Заявка → бронь → код → итог */
r = await O(`/listings/${L1}/deals`, J({ note: 'Когда можно посмотреть?' }), SL.tok); t('свою вещь смотреть нельзя', r.status === 400 && r.data.error === 'own_listing');
r = await O(`/listings/${L1}/deals`, J({ note: 'Когда можно посмотреть?' }), B1.tok); const D1 = r.data.id; t('заявка на осмотр отправлена', r.status === 201 && /^od-/.test(D1), JSON.stringify(r.data));
r = await O(`/listings/${L1}/deals`, J({}), B1.tok); t('вторая заявка того же человека — конфликт', r.status === 409 && r.data.error === 'deal_exists');
r = await O(`/listings/${L1}/deals`, J({}), B2.tok); const D2 = r.data.id; t('заявка второго покупателя', r.status === 201);
t('продавцу пришло уведомление', Number(q(`select count(*) from go_notified where user_id='${SL.pid}' and key like 'od-%:requested'`)) >= 2);
r = await O(`/deals/${D1}`, {}, X.tok); t('чужая встреча недоступна', r.status === 404);
r = await O(`/deals/${D1}/accept`, J({ meetAt: inH(5), place: 'ТЦ Мега' }), B1.tok); t('покупатель принять за продавца не может', r.status === 404);
r = await O(`/deals/${D1}/accept`, J({ meetAt: 'вчера', place: 'ТЦ Мега' }), SL.tok); t('время мусором отклонено', r.status === 400 && r.data.error === 'bad_time');
r = await O(`/deals/${D1}/accept`, J({ meetAt: new Date(Date.now() - 3600000).toISOString(), place: 'ТЦ Мега' }), SL.tok); t('время в прошлом отклонено', r.data.error === 'bad_time');
r = await O(`/deals/${D1}/accept`, J({ meetAt: inH(5), place: '' }), SL.tok); t('без места отклонено', r.data.error === 'place_required');
r = await O(`/deals/${D1}/accept`, J({ meetAt: inH(5), place: 'ТЦ Мега, вход №2' }), SL.tok); t('продавец принял и назначил встречу', r.status === 200, JSON.stringify(r.data));
t('объявление забронировано, заявка второго отклонена', q(`select status from onsite_listings where id='${L1}'`) === 'reserved' && q(`select status from onsite_deals where id='${D2}'`) === 'declined');
r = await O(`/deals/${D1}/accept`, J({ meetAt: inH(5), place: 'ТЦ Мега' }), SL.tok); t('повторное принятие невозможно', r.status === 409);
r = await O(`/deals/${D1}`, {}, B1.tok); const code = r.data.deal.meetCode; t('покупатель видит 4-значный код встречи', /^\d{4}$/.test(code ?? ''), JSON.stringify(r.data.deal).slice(0, 200));
r = await O(`/deals/${D1}`, {}, SL.tok); t('продавец кода не видит', r.data.deal.meetCode === null || r.data.deal.meetCode === undefined);
t('в базе код только хешем и в запечатанном виде', !q(`select code_hash||code_enc from onsite_deals where id='${D1}'`).includes(code));
const wrong = code === '0000' ? '1111' : '0000';
for (let i = 0; i < 4; i += 1) { r = await O(`/deals/${D1}/confirm`, J({ code: wrong }), SL.tok); if (i === 0) t('неверный код отклонён', r.status === 400 && r.data.error === 'bad_code', JSON.stringify(r.data)); }
r = await O(`/deals/${D1}/confirm`, J({ code }), B1.tok); t('покупатель подтвердить за продавца не может', r.status === 404);
r = await O(`/deals/${D1}/confirm`, J({ code }), SL.tok); t('верный код после 4 ошибок ещё принимается', r.status === 200, JSON.stringify(r.data));
r = await O(`/deals/${D1}/done`, J({}), SL.tok); t('продавец подтвердил сделку — ждём покупателя', r.status === 200 && r.data.waiting === true, JSON.stringify(r.data));
r = await O(`/deals/${D1}/review`, J({ rating: 5 }), B1.tok); t('отзыв до завершения нельзя', r.status === 409);
r = await O(`/deals/${D1}/done`, J({}), B1.tok); t('покупатель подтвердил — сделка состоялась', r.status === 200 && r.data.status === 'completed');
t('объявление продано', q(`select status from onsite_listings where id='${L1}'`) === 'sold');
r = await O(`/deals/${D1}/review`, J({ rating: 9 }), B1.tok); t('оценка вне 1–5 отклонена', r.status === 400 && r.data.error === 'bad_rating');
r = await O(`/deals/${D1}/review`, J({ rating: 5, text: 'Всё как в описании' }), B1.tok); t('отзыв покупателя', r.status === 200);
r = await O(`/deals/${D1}/review`, J({ rating: 1 }), B1.tok); t('второй отзыв нельзя', r.status === 409);
r = await O(`/deals/${D1}/review`, J({ rating: 4 }), SL.tok); t('отзыв продавца о покупателе', r.status === 200);
r = await O(`/listings/${L2}`, {}, B1.tok); t('рейтинг продавца считается по настоящим отзывам (1 отзыв, 5.0)', r.data.listing.seller.reviews === 1 && r.data.listing.seller.avg === 5 && r.data.listing.seller.completedDeals === 1, JSON.stringify(r.data.listing.seller));

/* Блокировка кода после 5 ошибок, отмена, провал осмотра */
r = await O(`/listings/${L2}/deals`, J({}), B1.tok); const D3 = r.data.id;
await O(`/deals/${D3}/accept`, J({ meetAt: inH(3), place: 'Метро' }), SL.tok);
for (let i = 0; i < 5; i += 1) await O(`/deals/${D3}/confirm`, J({ code: '9999' === (await O(`/deals/${D3}`, {}, B1.tok)).data.deal.meetCode ? '8888' : '9999' }), SL.tok);
r = await O(`/deals/${D3}/confirm`, J({ code: '1234' }), SL.tok); t('после 5 ошибок ввод кода закрыт', r.status === 423 && r.data.error === 'code_locked', JSON.stringify(r.data));
r = await O(`/deals/${D3}/cancel`, J({ note: 'не получилось' }), B1.tok); t('покупатель отменяет встречу — объявление снова в продаже', r.status === 200 && q(`select status from onsite_listings where id='${L2}'`) === 'published');
r = await O(`/deals/${D3}/message`, J({ text: 'привет' }), B1.tok); t('в закрытой встрече писать нельзя', r.status >= 400);
r = await O(`/listings/${L2}/deals`, J({}), B2.tok); const D4 = r.data.id;
await O(`/deals/${D4}/accept`, J({ meetAt: inH(2), place: 'Кафе' }), SL.tok);
const c4 = (await O(`/deals/${D4}`, {}, B2.tok)).data.deal.meetCode;
await O(`/deals/${D4}/confirm`, J({ code: c4 }), SL.tok);
r = await O(`/deals/${D4}/fail`, J({}), B2.tok); t('«не подошло» без причины невозможно', r.status === 400 && r.data.error === 'note_required');
r = await O(`/deals/${D4}/fail`, J({ note: 'Не работает коробка' }), B2.tok); t('осмотр не устроил: встреча закрыта, объявление в продаже', r.status === 200 && r.data.status === 'failed' && q(`select status from onsite_listings where id='${L2}'`) === 'published');
r = await O(`/deals/${D4}/done`, J({}), SL.tok); t('после провала подтвердить сделку нельзя', r.status === 409);

/* Переписка */
r = await O(`/listings/${L3}/deals`, J({}), B1.tok); const D5 = r.data.id;
r = await O(`/deals/${D5}/message`, J({ text: '   ' }), B1.tok); t('пустое сообщение отклонено', r.status === 400);
r = await O(`/deals/${D5}/message`, J({ text: 'Здравствуйте, гитара ещё продаётся?' }), B1.tok); t('сообщение отправлено', r.status === 200);
r = await O(`/deals/${D5}`, {}, SL.tok); t('продавец видит сообщение, а оно «не моё»', r.data.messages.some((m) => !m.mine && /гитара/.test(m.text)));
r = await O(`/deals/${D5}/decline`, J({ note: 'Уже продана' }), SL.tok); t('продавец отклонил заявку', r.status === 200);

/* Жалобы и модерация */
r = await O(`/listings/${L3}/report`, J({ reason: 'bogus' }), B1.tok); t('неверная причина жалобы отклонена', r.status === 400);
r = await O(`/listings/${L3}/report`, J({ reason: 'forbidden', text: 'Продают запрещённое' }), B1.tok); t('жалоба отправлена', r.status === 201);
r = await O(`/listings/${L3}/report`, J({ reason: 'fraud' }), B1.tok); t('повторная жалоба того же человека — отказ', r.status === 409);
r = await O(`/listings/${L3}/report`, J({ reason: 'fraud' }), SL.tok); t('на своё жаловаться нельзя', r.status === 400);
r = await call('/api/admin/onsite/reports', {}, X.tok); t('обычный человек очередь не видит', r.status === 403);
r = await call('/api/admin/onsite/reports', {}, A.tok); const rep = r.data.items.find((x) => x.listingId === L3); t('сотрудник видит жалобу', r.status === 200 && rep?.reason === 'forbidden' && rep.seller, JSON.stringify(r.data).slice(0, 200));
r = await call(`/api/admin/onsite/reports/${rep.id}/decide`, J({ action: 'remove', note: '' }), A.tok); t('решение без причины невозможно', r.status === 400 && r.data.error === 'note_required');
const D6 = (await O(`/listings/${L3}/deals`, J({}), B2.tok)).data.id;
r = await call(`/api/admin/onsite/reports/${rep.id}/decide`, J({ action: 'remove', note: 'Запрещённый товар по правилам' }), A.tok); t('объявление снято модерацией', r.status === 200 && q(`select status from onsite_listings where id='${L3}'`) === 'removed');
t('связанные встречи отменены, покупателю ушло уведомление', q(`select status from onsite_deals where id='${D6}'`) === 'cancelled' && Number(q(`select count(*) from go_notified where user_id='${B2.pid}' and key='${D6}:mod'`)) === 1);
t('продавец уведомлён с причиной', Number(q(`select count(*) from go_notified where user_id='${SL.pid}' and key='${rep.id}:removed'`)) === 1);
r = await O(`/listings/${L3}`, {}, B1.tok); t('снятое объявление недоступно', r.status === 404);
r = await O('/my/listings', {}, SL.tok); t('у продавца снятое объявление не показывается в списке', !r.data.items.some((i) => i.id === L3));
r = await call(`/api/admin/onsite/reports/${rep.id}/decide`, J({ action: 'dismiss', note: 'повторное решение' }), A.tok); t('повторное решение по жалобе невозможно', r.status === 409 || r.status === 400);

/* Управление объявлением */
r = await O(`/my/listings/${L1}`, { method: 'DELETE' }, SL.tok); t('проданное объявление удалить можно (нет живых встреч)', r.status === 200);
const L4 = (await mk({ title: `Лыжи ${tag}` })).data.id; await photo(L4, SL.tok); await O('/my/listings/' + L4 + '/publish', J({}), SL.tok);
const D7 = (await O(`/listings/${L4}/deals`, J({}), B1.tok)).data.id;
r = await O('/my/listings/' + L4 + '/close', J({}), SL.tok); t('снятие объявления отменяет заявки', r.status === 200 && q(`select status from onsite_deals where id='${D7}'`) === 'cancelled');
r = await O('/my/listings/' + L4 + '/publish', J({}), SL.tok); t('снятое можно опубликовать снова', r.status === 200);
r = await O(`/my/listings/${L4}/photos/${(await O('/listings/' + L4, {}, B1.tok)).data.listing.photos[0]}`, { method: 'DELETE' }, SL.tok); t('удаление последнего фото возвращает объявление в черновик', r.status === 200 && q(`select status from onsite_listings where id='${L4}'`) === 'draft');

/* Уборка: просрочки */
const L5 = (await mk({ title: `Стол ${tag}`, category: 'furniture' })).data.id; await photo(L5, SL.tok); await O('/my/listings/' + L5 + '/publish', J({}), SL.tok);
const D8 = (await O(`/listings/${L5}/deals`, J({}), B1.tok)).data.id;
q(`update onsite_deals set created_at = now() - interval '49 hours' where id='${D8}'`);
const { sweepOnsite } = await import('../../server/onsite.mjs');
let sw = await sweepOnsite(); t('заявка без ответа 48 часов истекает', q(`select status from onsite_deals where id='${D8}'`) === 'expired' && sw.expired >= 1);
const D9 = (await O(`/listings/${L5}/deals`, J({}), B1.tok)).data.id;
await O(`/deals/${D9}/accept`, J({ meetAt: inH(1), place: 'Двор' }), SL.tok);
q(`update onsite_deals set meet_at = now() - interval '25 hours' where id='${D9}'`);
sw = await sweepOnsite(); t('встреча прошла, код так и не подтвердили — бронь снята', q(`select status from onsite_deals where id='${D9}'`) === 'expired' && q(`select status from onsite_listings where id='${L5}'`) === 'published');
const D10 = (await O(`/listings/${L5}/deals`, J({}), B2.tok)).data.id;
await O(`/deals/${D10}/accept`, J({ meetAt: inH(1), place: 'Двор' }), SL.tok);
const c10 = (await O(`/deals/${D10}`, {}, B2.tok)).data.deal.meetCode; await O(`/deals/${D10}/confirm`, J({ code: c10 }), SL.tok); await O(`/deals/${D10}/done`, J({}), SL.tok);
q(`update onsite_deals set updated_at = now() - interval '73 hours' where id='${D10}'`);
sw = await sweepOnsite(); t('продавец подтвердил, покупатель молчит 72 часа — сделка закрыта', q(`select status from onsite_deals where id='${D10}'`) === 'completed' && q(`select status from onsite_listings where id='${L5}'`) === 'sold');

console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
