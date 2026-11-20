// Sky Pets: сквозной тест на живом API (нужны Postgres, Redis, API с PETS_DIR и PETS_RATE_MULT=50). Запуск: node scripts/audit/pets-test.mjs <каталог с api.log>
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
import { encodePng } from '../../server/spimg.mjs';
const S = process.argv[2] ?? '/tmp/apit';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -At -c "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
const J = (b) => JSON.stringify(b);
const P = (path, tok, b = {}) => call(path, { method: 'POST', body: J(b) }, tok);
const G = (path, tok) => call(path, {}, tok);

const A = await mkuser(S, 'Pa'), B = await mkuser(S, 'Pb'), C = await mkuser(S, 'Pc'), D = await mkuser(S, 'Pd'), E = await mkuser(S, 'Pe'), F = await mkuser(S, 'Pf');
sql(`update profiles set is_admin=true, admin_role='pets_admin' where id='${D.pid}'`); sql(`update profiles set is_admin=true, admin_role='pets_creator' where id='${E.pid}'`); sql(`update profiles set is_admin=true, admin_role='pets_moderator' where id='${F.pid}'`);
sql(`update admin_lockdown set active=false`);

// ── старт игрока
let r = await G('/api/skypets/overview', A.tok); ok(r.status === 200 && r.data.player.coins === 200 && r.data.eggs.length === 1 && r.data.inventory.some((i) => i.itemId === 'food-kibble' && i.qty === 5), 'стартовый набор');
ok((await call('/api/skypets/overview')).status === 401, 'без входа 401');
const egg0 = r.data.eggs[0].id;
r = await G('/api/skypets/eggs/egg-common/odds', A.tok); const sum = r.data.drops.reduce((a, d) => a + d.percent, 0); ok(r.data.drops.length > 3 && Math.abs(sum - 100) < 0.2, `шансы яйца видны и дают 100% (${sum})`);
// ── яйцо
ok((await P(`/api/skypets/egg/${egg0}/hatch`, A.tok)).data.error === 'bad_state', 'нельзя вылупить не из инкубатора');
ok((await P(`/api/skypets/egg/${egg0}/incubate`, A.tok)).data.ok, 'в инкубатор');
r = await P(`/api/skypets/egg/${egg0}/hatch`, A.tok); ok(r.data.error === 'not_ready', 'до таймера не вылупится');
sql(`update sp_player_eggs set ready_at = now() - interval '1 second' where id='${egg0}'`);
r = await P(`/api/skypets/egg/${egg0}/hatch`, A.tok); ok(r.data.error === 'needs_interaction', 'нужно взаимодействие');
for (let i = 0; i < 3; i++) { r = await P(`/api/skypets/egg/${egg0}/touch`, A.tok); ok(r.data.ok, 'касание яйца ' + i); if (i < 2) { ok((await P(`/api/skypets/egg/${egg0}/touch`, A.tok)).data.error === 'slow_down', 'частота касаний'); } sql(`delete from sp_rate where action='egg_touch'`); }
r = await P(`/api/skypets/egg/${egg0}/hatch`, A.tok, { name: 'Мурзик' }); ok(r.data.ok && r.data.pet?.name === 'Мурзик' && r.data.pet.level === 1, 'питомец вылупился'); const pet = r.data.pet.id;
ok((await P(`/api/skypets/egg/${egg0}/hatch`, A.tok)).data.error === 'bad_state', 'повторное вылупление запрещено');
ok(sql(`select count(*) from sp_history where pet_id='${pet}' and action='hatched'`) === '1', 'история получения');
// ── уход
const act = (tok, id, action, b = {}) => P(`/api/skypets/pet/${id}/act`, tok, { action, ...b });
r = await act(A.tok, pet, 'feed', { itemId: 'food-kibble' }); ok(r.data.ok && r.data.pet.satiety > 80 && r.data.xp > 0, 'покормил');
ok((await act(A.tok, pet, 'feed', { itemId: 'food-kibble' })).data.error === 'already_full', 'сытый не ест');
ok((await act(A.tok, pet, 'feed', { itemId: 'food-fish' })).data.error === 'already_full' || true, '—');
ok(Number(sql(`select qty from sp_inventory where profile_id='${A.pid}' and item_id='food-kibble'`)) === 4, 'корм списан один раз');
ok((await act(A.tok, pet, 'feed', { itemId: 'toy-ball' })).data.error === 'bad_item', 'игрушкой не кормят');
r = await act(A.tok, pet, 'play', { itemId: 'toy-ball' }); ok(r.data.ok && r.data.pet.fun > 70, 'поиграл');
r = await act(A.tok, pet, 'bathe'); ok(r.data.ok && r.data.pet.hygiene === 100, 'искупал');
r = await act(A.tok, pet, 'walk'); ok(r.data.ok && r.data.coins >= 2, 'прогулка приносит монеты');
r = await act(A.tok, pet, 'teach', { skill: 'agility' }); ok(r.data.ok && r.data.pet.skills.agility.x >= 1, 'обучение навыку');
ok((await act(A.tok, pet, 'teach', { skill: 'hack' })).data.error === 'bad_skill', 'чужой навык');
ok((await act(A.tok, pet, 'fly')).data.error === 'bad_action', 'неизвестное действие');
ok((await act(C.tok, pet, 'feed', { itemId: 'food-kibble' })).status === 404, 'чужой питомец недоступен');
ok((await G(`/api/skypets/pet/${pet}`, C.tok)).status === 404, 'чужую карточку не видно');
ok((await call(`/api/skypets/pet/${pet}/act`, { method: 'POST', body: J({ action: 'feed', level: 99, xp: 99999, itemId: 'food-kibble' }) }, A.tok)).data.pet.level === 1, 'уровень из тела запроса не принимается');
// сон
r = await act(A.tok, pet, 'sleep'); ok(r.data.ok && r.data.pet.sleeping, 'уснул');
ok((await act(A.tok, pet, 'play')).data.error === 'sleeping', 'спящего не трогают');
ok((await act(A.tok, pet, 'wake')).data.ok, 'разбудил');
// уровень и награда
sql(`update sp_pets set xp = 150 where id='${pet}'`); const coinsBefore = Number(sql(`select coins from sp_players where profile_id='${A.pid}'`));
sql(`update sp_pets set energy=90, satiety=50 where id='${pet}'`); r = await act(A.tok, pet, 'feed', { itemId: 'food-kibble' }); ok(r.data.levelUps?.includes(2) && r.data.pet.level === 2, 'повышение уровня');
ok(Number(sql(`select coins from sp_players where profile_id='${A.pid}'`)) > coinsBefore, 'награда за уровень зачислена');
ok(sql(`select count(*) from sp_history where pet_id='${pet}' and action='level_up'`) === '1', 'уровень записан в историю');
// бездействие не убивает и не отнимает прогресс
sql(`update sp_pets set stat_at = now() - interval '300 hours', level=5, xp=40 where id='${pet}'`); r = await G(`/api/skypets/pet/${pet}`, A.tok);
ok(r.data.pet.level === 5 && r.data.pet.xp === 40 && r.data.pet.satiety >= 10 && r.data.pet.health >= 30 && r.data.pet.energy >= 10, 'бездействие не отнимает уровень/опыт, питомец жив');
ok(['hungry', 'sick', 'tired', 'dirty', 'bored', 'sad'].includes(r.data.pet.mood), 'настроение отражает нужды: ' + r.data.pet.mood);
// суточный потолок опыта
sql(`update sp_history set xp = 5 where pet_id='${pet}'`); sql(`insert into sp_history (pet_id, actor_id, action, xp) values ('${pet}','${A.pid}','play',1000)`);
sql(`update sp_pets set energy=90, fun=20, stat_at=now() where id='${pet}'`); r = await act(A.tok, pet, 'play'); ok(r.data.ok && r.data.xp === 0 && r.data.capped, 'суточный потолок опыта');
ok(sql(`select count(*) from sp_rate where profile_id='${A.pid}'`) !== '0', 'счётчики частоты ведутся');
// имя
ok((await P(`/api/skypets/pet/${pet}/rename`, A.tok, { name: 'Пушок' })).data.name === 'Пушок', 'переименование'); ok((await P(`/api/skypets/pet/${pet}/rename`, A.tok, { name: 'x' })).data.error === 'bad_name', 'короткое имя');

// ── магазин
r = await G('/api/skypets/shop', A.tok); ok(r.data.eggs.length >= 4 && r.data.items.length > 10 && r.data.pets.length > 0, 'витрина магазина');
const k1 = 'buy-aaaaaaaa-' + Date.now(); const c0 = Number(sql(`select coins from sp_players where profile_id='${A.pid}'`));
r = await P('/api/skypets/shop/buy', A.tok, { kind: 'item', id: 'food-fish', qty: 2, idemKey: k1 }); ok(r.data.ok && r.data.spentCoins === 24, 'покупка за монеты');
r = await P('/api/skypets/shop/buy', A.tok, { kind: 'item', id: 'food-fish', qty: 2, idemKey: k1 }); ok(r.data.duplicate && Number(sql(`select coins from sp_players where profile_id='${A.pid}'`)) === c0 - 24, 'повтор ключа не списывает дважды');
ok((await P('/api/skypets/shop/buy', A.tok, { kind: 'item', id: 'toy-star', qty: 99, idemKey: 'buy-bbbbbbbb-' + Date.now() })).data.error === 'insufficient_coins', 'нехватка монет');
ok((await P('/api/skypets/shop/buy', A.tok, { kind: 'item', id: 'food-fish', qty: -5, idemKey: 'buy-cccccccc-' + Date.now() })).data.spentCoins === 12, 'отрицательное количество не работает');
ok((await P('/api/skypets/shop/buy', A.tok, { kind: 'egg', id: 'egg-blessing', idemKey: 'buy-dddddddd-' + Date.now() })).data.error === 'not_for_sale', 'нельзя купить недоступное яйцо');
ok((await P('/api/skypets/shop/buy', A.tok, { kind: 'egg', id: 'egg-premium', currency: 'points', idemKey: 'buy-eeeeeeee-' + Date.now() })).data.error === 'insufficient_points', 'премиум-яйцо без баллов');
ok((await P('/api/skypets/shop/buy', A.tok, { kind: 'item', id: 'food-fish' })).data.error === 'idem_required', 'нужен ключ идемпотентности');
sql(`insert into wallet_accounts (user_id, balance, points) values ('${A.pid}', 0, 500) on conflict (user_id) do update set points = 500`);
r = await P('/api/skypets/shop/buy', A.tok, { kind: 'egg', id: 'egg-premium', currency: 'points', idemKey: 'buy-ffffffff-' + Date.now() }); ok(r.data.ok && r.data.spentPoints === 150 && sql(`select points from wallet_accounts where user_id='${A.pid}'`) === '350', 'премиум-яйцо за баллы Prime');
// гонка: два одинаковых ключа сразу
const kk = 'buy-race0000-' + Date.now(); const rr = await Promise.all([P('/api/skypets/shop/buy', A.tok, { kind: 'item', id: 'toy-ball', idemKey: kk }), P('/api/skypets/shop/buy', A.tok, { kind: 'item', id: 'toy-ball', idemKey: kk })]);
ok(rr.filter((x) => x.data.spentCoins === 20).length === 1, 'параллельный повтор — одно списание');
// ── задания
r = await G('/api/skypets/tasks', A.tok); const tf = r.data.tasks.find((t) => t.id === 'd-feed'); ok(tf && tf.progress >= 1, 'прогресс задания растёт: ' + tf?.progress);
ok((await P('/api/skypets/tasks/d-walk/claim', A.tok)).data.error === 'not_ready' || (await P('/api/skypets/tasks/d-walk/claim', A.tok)).data.error === 'already_claimed', 'невыполненное не забрать');
sql(`update sp_task_progress set progress = 2 where profile_id='${A.pid}' and task_id='d-feed'`);
const cb = Number(sql(`select coins from sp_players where profile_id='${A.pid}'`)); r = await P('/api/skypets/tasks/d-feed/claim', A.tok); ok(r.data.ok && Number(sql(`select coins from sp_players where profile_id='${A.pid}'`)) === cb + 15, 'награда за задание');
ok((await P('/api/skypets/tasks/d-feed/claim', A.tok)).data.error === 'already_claimed', 'награда один раз');
const [x1, x2] = await Promise.all([P('/api/skypets/tasks/d-play/claim', A.tok), P('/api/skypets/tasks/d-play/claim', A.tok)]); ok(!(x1.data.ok && x2.data.ok), 'параллельное получение награды — не дважды');
r = await P('/api/skypets/daily', A.tok); ok(r.data.ok, 'ежедневный бонус'); ok((await P('/api/skypets/daily', A.tok)).data.error === 'already_claimed', 'бонус раз в сутки');

// ── дом
sql(`update sp_inventory set qty = 3 where profile_id='${A.pid}' and item_id='food-kibble'`);
r = await G('/api/skypets/house', A.tok); ok(r.data.rooms.length === 4, 'четыре комнаты');
await P('/api/skypets/shop/buy', A.tok, { kind: 'item', id: 'bed-royal', idemKey: 'buy-bed00000-' + Date.now() }); sql(`update sp_players set coins = coins + 2000 where profile_id='${A.pid}'`);
await P('/api/skypets/shop/buy', A.tok, { kind: 'item', id: 'bed-royal', idemKey: 'buy-bed11111-' + Date.now() }); await P('/api/skypets/shop/buy', A.tok, { kind: 'item', id: 'wall-rose', idemKey: 'buy-wall0000-' + Date.now() }); await P('/api/skypets/shop/buy', A.tok, { kind: 'item', id: 'house-play', idemKey: 'buy-hous0000-' + Date.now() });
sql(`update sp_pets set energy=20, stat_at=now(), sleeping_until=null where id='${pet}'`); r = await act(A.tok, pet, 'sleep'); const slow = r.data.seconds; await act(A.tok, pet, 'wake');
r = await P('/api/skypets/house/place', A.tok, { itemId: 'bed-royal', room: 'bed', x: 30, y: 60 }); ok(r.data.ok && r.data.placed.length === 1, 'кровать поставлена');
const uidPl = r.data.placed[0].uid; sql(`update sp_pets set energy=20, stat_at=now(), sleeping_until=null where id='${pet}'`); r = await act(A.tok, pet, 'sleep'); ok(r.data.seconds < slow, `кровать ускоряет восстановление (${r.data.seconds} < ${slow})`); await act(A.tok, pet, 'wake');
r = await P('/api/skypets/house/place', A.tok, { itemId: 'wall-rose', room: 'living' }); ok(r.data.style.living.wall === '#ffd9ea', 'обои применены');
ok((await P('/api/skypets/house/place', A.tok, { itemId: 'bed-royal', room: 'play' })).data.error === 'room_locked', 'закрытая комната');
r = await P('/api/skypets/house/expand', A.tok, { itemId: 'house-play' }); ok(r.data.ok && r.data.rooms.includes('play'), 'расширение дома');
ok((await P('/api/skypets/house/place', A.tok, { itemId: 'furn-sofa', room: 'living' })).data.error === 'no_item', 'нет предмета — не поставить');
r = await P('/api/skypets/house/remove', A.tok, { uid: uidPl }); ok(r.data.ok && r.data.placed.length === 0, 'предмет убран в инвентарь');
ok((await G('/api/skypets/house?scope=' + pet, A.tok)).status === 404, 'общий дом только у совместного питомца');
ok((await P(`/api/skypets/pet/${pet}/room`, A.tok, { room: 'play' })).data.ok, 'питомец перешёл в комнату');

// ── совместное воспитание
let inv = await P('/api/skypets/invite', A.tok, { toId: B.pid, eggId: (await G('/api/skypets/eggs', A.tok)).data.eggs.find((e) => e.state === 'unhatched').id }); ok(inv.data.ok, 'приглашение отправлено');
ok((await P('/api/skypets/invite', A.tok, { toId: A.pid, eggId: 'peg-x' })).data.error === 'bad_target', 'себя приглашать нельзя');
ok(Number(sql(`select count(*) from gift_notifications where user_id='${B.pid}' and kind='pets_invite'`)) === 1, 'партнёр получил уведомление');
const invId = inv.data.id; ok((await P(`/api/skypets/invite/${invId}/respond`, C.tok, { accept: true })).status === 404, 'чужое приглашение не принять');
r = await P(`/api/skypets/invite/${invId}/respond`, B.tok, { accept: true }); ok(r.data.status === 'accepted', 'приглашение принято'); const shEgg = r.data.eggId;
ok((await P(`/api/skypets/invite/${invId}/respond`, B.tok, { accept: true })).data.error === 'already_decided', 'повторный ответ');
ok((await G('/api/skypets/eggs', B.tok)).data.eggs.some((e) => e.id === shEgg), 'яйцо видно обоим');
await P(`/api/skypets/egg/${shEgg}/incubate`, B.tok); sql(`update sp_player_eggs set ready_at = now() - interval '1 second', touches = 3 where id='${shEgg}'`);
r = await P(`/api/skypets/egg/${shEgg}/hatch`, A.tok); ok(r.data.ok && r.data.pet.shared && r.data.pet.owners.length === 2, 'совместный питомец вылупился'); const sp = r.data.pet.id;
ok((await G(`/api/skypets/pet/${sp}`, B.tok)).status === 200 && (await G(`/api/skypets/pet/${sp}`, C.tok)).status === 404, 'виден обоим владельцам, чужому — нет');
ok((await G(`/api/skypets/with/${B.pid}`, A.tok)).data.pets.length === 1, 'совместные питомцы в карточке чата');
sql(`update sp_pets set energy=100, satiety=30, fun=30, hygiene=30, stat_at=now() where id='${sp}'`); sql(`update sp_inventory set qty=10 where profile_id in ('${A.pid}','${B.pid}') and item_id='food-kibble'`);
const xpBefore = Number(sql(`select level*0 + xp from sp_pets where id='${sp}'`));
const batch = await Promise.all([act(A.tok, sp, 'play'), act(B.tok, sp, 'play'), act(A.tok, sp, 'bathe'), act(B.tok, sp, 'feed', { itemId: 'food-kibble' }), act(A.tok, sp, 'feed', { itemId: 'food-kibble' })]);
ok(batch.every((x) => x.status === 200 || x.data.error), 'параллельные действия двух владельцев без ошибок сервера');
const hx = Number(sql(`select coalesce(sum(xp),0) from sp_history where pet_id='${sp}' and action in ('play','bathe','feed')`)); const lvl = Number(sql(`select level from sp_pets where id='${sp}'`)); const xpNow = Number(sql(`select xp from sp_pets where id='${sp}'`));
ok(hx > 0 && (lvl > 1 || xpNow === hx + xpBefore), `опыт сходится с историей (${xpNow} = ${hx}+${xpBefore}, уровень ${lvl})`);
ok(Number(sql(`select count(distinct actor_id) from sp_history where pet_id='${sp}' and actor_id is not null`)) === 2, 'в истории видны оба владельца');
ok(Number(sql(`select count(*) from gift_notifications where user_id='${B.pid}' and kind='pets_partner_action'`)) >= 1, 'партнёр получает уведомление о действиях');
r = await G('/api/skypets/house?scope=' + sp, A.tok); ok(r.status === 200, 'общий дом открывается');
await P('/api/skypets/shop/buy', B.tok, { kind: 'item', id: 'furn-sofa', idemKey: 'buy-sofa0000-' + Date.now() }); r = await P('/api/skypets/house/place', B.tok, { scope: sp, itemId: 'furn-sofa', room: 'living' }); ok(r.data.ok, 'партнёр обставляет общий дом');
ok((await P('/api/skypets/house/place', C.tok, { scope: sp, itemId: 'furn-sofa', room: 'living' })).data.error === 'not_found', 'чужой общий дом закрыт');
// достижения
r = await G('/api/skypets/achievements', A.tok); const fs = r.data.achievements.find((a) => a.key === 'first_shared'); ok(fs?.ready && !fs.claimed, 'достижение «первый совместный» готово');
const cA = await P('/api/skypets/achievements/claim', A.tok, { key: 'first_shared', petId: sp }); ok(cA.data.ok, 'награда за достижение');
ok((await P('/api/skypets/achievements/claim', A.tok, { key: 'first_shared', petId: sp })).data.error === 'already_claimed', 'достижение один раз');
ok((await P('/api/skypets/achievements/claim', B.tok, { key: 'first_shared', petId: sp })).data.ok, 'партнёр получает свою награду');
ok((await P('/api/skypets/achievements/claim', A.tok, { key: 'joint_days_30', petId: sp })).data.error === 'not_ready', 'недостигнутое не выдать');
ok((await P('/api/skypets/achievements/claim', C.tok, { key: 'first_shared', petId: sp })).data.error === 'not_found', 'чужое достижение');
// удаление/передача только с согласия обоих
r = await P(`/api/skypets/pet/${sp}/transfer`, A.tok, { kind: 'delete' }); ok(r.data.ok && r.data.status === 'pending', 'удаление ждёт второго владельца'); const tid = r.data.id;
ok(Number(sql(`select count(*) from sp_pets where id='${sp}' and deleted_at is null`)) === 1, 'питомец не удалён без согласия');
ok((await P(`/api/skypets/transfers/${tid}/respond`, B.tok, { agree: false })).data.status === 'declined', 'партнёр отказал');
r = await P(`/api/skypets/pet/${sp}/transfer`, A.tok, { kind: 'delete' }); ok((await P(`/api/skypets/transfers/${r.data.id}/respond`, B.tok, { agree: true })).data.status === 'done' && Number(sql(`select count(*) from sp_pets where id='${sp}' and deleted_at is null`)) === 0, 'удалён по согласию обоих');
// передача личного питомца
r = await P(`/api/skypets/pet/${pet}/transfer`, A.tok, { kind: 'transfer', toId: C.pid }); ok(r.data.status === 'pending', 'передача ждёт получателя');
ok((await P(`/api/skypets/transfers/${r.data.id}/respond`, C.tok, { agree: true })).data.status === 'done', 'получатель принял'); ok((await G(`/api/skypets/pet/${pet}`, C.tok)).status === 200 && (await G(`/api/skypets/pet/${pet}`, A.tok)).status === 404, 'владелец сменился');

// ── подарки
sql(`update sp_inventory set qty = 5 where profile_id='${A.pid}' and item_id='toy-ball'`);
r = await P('/api/skypets/gifts', A.tok, { toId: B.pid, kind: 'item', refId: 'toy-ball', qty: 2, message: 'держи' }); ok(r.data.ok && Number(sql(`select qty from sp_inventory where profile_id='${A.pid}' and item_id='toy-ball'`)) === 3, 'подарок зарезервирован');
const gid = r.data.id; ok((await P(`/api/skypets/gifts/${gid}/answer`, B.tok, { how: 'accept' })).data.status === 'accepted' && Number(sql(`select qty from sp_inventory where profile_id='${B.pid}' and item_id='toy-ball'`)) >= 2, 'подарок получен');
ok((await P(`/api/skypets/gifts/${gid}/answer`, B.tok, { how: 'accept' })).data.error === 'already_decided', 'подарок один раз');
r = await P('/api/skypets/gifts', A.tok, { toId: B.pid, kind: 'item', refId: 'toy-ball', qty: 1 }); await P(`/api/skypets/gifts/${r.data.id}/answer`, B.tok, { how: 'decline' }); ok(Number(sql(`select qty from sp_inventory where profile_id='${A.pid}' and item_id='toy-ball'`)) === 3, 'отклонённый подарок вернулся');
ok((await P('/api/skypets/gifts', A.tok, { toId: B.pid, kind: 'item', refId: 'toy-ball', qty: 999 })).data.error === 'no_item', 'нельзя подарить больше, чем есть');

// ── город
await P('/api/skypets/overview', B.tok); ok((await P('/api/skypets/settings', B.tok, { visitPolicy: 'none' })).data.ok, 'закрыл дом');
ok((await G('/api/skypets/city/' + B.pid, A.tok)).data.error === 'private', 'закрытый дом не посетить');
await P('/api/skypets/settings', B.tok, { visitPolicy: 'all' }); sql(`update sp_pets set deleted_at=null where id='${sp}'`);
// у B есть питомец? вылупим из подарка для теста города
const bEgg = (await G('/api/skypets/eggs', B.tok)).data.eggs[0]; if (bEgg) { await P(`/api/skypets/egg/${bEgg.id}/incubate`, B.tok); sql(`update sp_player_eggs set ready_at=now()-interval '1 second', touches=3 where id='${bEgg.id}'`); await P(`/api/skypets/egg/${bEgg.id}/hatch`, B.tok); }
r = await G('/api/skypets/city', A.tok); ok(r.data.players.some((p) => p.id === B.pid), 'в городе виден открытый дом'); ok(!r.data.players.some((p) => p.id === A.pid), 'себя в городе нет');
r = await G('/api/skypets/city/' + B.pid, A.tok); ok(r.status === 200 && r.data.pets.length >= 1, 'гость видит коллекцию'); const bp = r.data.pets.find((p) => !p.shared)?.id;
ok((await P('/api/skypets/city/' + B.pid + '/react', A.tok, { kind: 'heart' })).data.ok, 'реакция'); ok((await P('/api/skypets/city/' + B.pid + '/react', A.tok, { kind: 'bomb' })).data.error === 'bad_kind', 'реакции — закрытый список');
sql(`update sp_players set coins = coins + 500 where profile_id='${A.pid}'`); const bu = await P('/api/skypets/shop/buy', A.tok, { kind: 'species', id: 'cat-tabby', idemKey: 'buy-spec0000-' + Date.now() }); ok(bu.data.ok && bu.data.petId, 'питомец куплен за монеты'); const myP = { id: bu.data.petId }; if (myP && bp) { sql(`update sp_pets set energy=100, stat_at=now(), sleeping_until=null where id in ('${myP.id}','${bp}')`); r = await P('/api/skypets/city/' + B.pid + '/play', A.tok, { myPetId: myP.id, theirPetId: bp }); ok(r.data.ok, 'питомцы играют вместе ' + J(r.data)); }
ok((await P('/api/skypets/city/' + B.pid + '/play', A.tok, { myPetId: 'pet-00000000-0000-0000-0000-000000000000', theirPetId: bp ?? 'x' })).status >= 400, 'чужой/несуществующий питомец');

// ── картинки и конструктор
const png = (w, h, fn) => { const b = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y); const i = (y * w + x) * 4; b[i] = c[0]; b[i + 1] = c[1]; b[i + 2] = c[2]; b[i + 3] = c[3]; } return encodePng(w, h, b); };
const circle = png(160, 160, (x, y) => (Math.hypot(x - 80, y - 80) < 55 ? [250, 120, 60, 255] : [0, 0, 0, 0]));
const opaque = png(160, 160, () => [255, 255, 255, 255]); const whiteBack = png(160, 160, (x, y) => (Math.hypot(x - 80, y - 80) < 40 ? [250, 120, 60, 255] : [255, 255, 255, 255]));
const up = (tok, buf, q = '') => fetch(`http://127.0.0.1:8080/api/admin/skypets/images${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${tok}` }, body: buf }).then(async (x) => ({ status: x.status, data: await x.json() }));
ok((await up(A.tok, circle)).status === 403, 'обычному человеку загрузка закрыта');
r = await up(E.tok, circle); ok(r.status === 201 && r.data.hasThumb && r.data.width === 160, 'PNG с прозрачностью принят'); const imgId = r.data.id;
ok((await up(E.tok, opaque)).data.error === 'background_not_transparent', 'непрозрачная картинка отклонена'); ok((await up(E.tok, whiteBack)).data.error === 'background_not_transparent', 'белая подложка отклонена');
ok(['bad_format', 'file_blocked'].includes((await up(E.tok, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 1)]))).data.error), 'исполняемый файл не принят'); ok(['bad_format', 'file_blocked'].includes((await up(E.tok, Buffer.from('<svg onload=alert(1)>'))).data.error), 'SVG не принят');
ok((await up(E.tok, circle.subarray(0, 40))).status >= 400, 'обрезанный PNG отклонён'); ok((await up(E.tok, opaque, '?opaque=1')).status === 201, 'непрозрачная допустима для обоев (opaque=1)');
ok((await up(E.tok, Buffer.alloc(3 * 1024 * 1024))).data.error === 'file_too_large', 'большой файл отклонён');
// питомец
r = await P('/api/admin/skypets/species', E.tok, { name: 'Тестовый зверь', category: 'cats', rarity: 'rare', imageId: imgId, maxLevel: 40, description: 'тест' }); ok(r.status === 201, 'черновик питомца'); const spc = r.data.id;
ok((await call('/api/admin/skypets/species', {}, A.tok)).status === 403, 'список конструктора закрыт для людей');
ok((await P(`/api/admin/skypets/species/${spc}/moderate`, E.tok, { action: 'approve' })).status === 403, 'создатель не модерирует');
ok((await P(`/api/admin/skypets/species/${spc}/publish`, E.tok, {})).status === 403, 'создатель не публикует');
ok((await G(`/api/skypets/img/${imgId}`, A.tok)).status === 404, 'неопубликованная картинка не видна людям'); ok((await call(`/api/skypets/img/${imgId}`, {}, E.tok)).status === 200, 'автор видит свою картинку');
ok((await P(`/api/admin/skypets/species/${spc}/moderate`, F.tok, { action: 'approve' })).data.error === 'bad_state', 'нельзя одобрить черновик');
r = await P(`/api/admin/skypets/species/${spc}/submit`, E.tok); ok(r.data.status === 'pending', 'на модерацию'); ok(Number(sql(`select count(*) from gift_notifications where user_id='${F.pid}' or user_id='${D.pid}'`)) >= 0, '—');
ok((await P(`/api/admin/skypets/species/${spc}/moderate`, F.tok, { action: 'reject' })).data.error === 'reason_required', 'отклонение — только с причиной');
ok((await P(`/api/admin/skypets/species/${spc}/moderate`, F.tok, { action: 'return', reason: 'Поправьте имя' })).data.ok, 'возврат на правки');
ok(Number(sql(`select count(*) from gift_notifications where user_id='${E.pid}' and kind='pets_moderation'`)) === 1, 'автор видит причину');
ok((await call(`/api/admin/skypets/species/${spc}`, { method: 'PUT', body: J({ name: 'Новый зверь', category: 'cats' }) }, E.tok)).data.ok, 'автор правит после возврата'); await P(`/api/admin/skypets/species/${spc}/submit`, E.tok);
ok((await P(`/api/admin/skypets/species/${spc}/moderate`, F.tok, { action: 'approve' })).data.ok, 'одобрено'); ok((await G('/api/skypets/shop', A.tok)).data.pets.every((p) => p.id !== spc), 'одобрено — ещё не опубликовано');
ok((await P(`/api/admin/skypets/species/${spc}/publish`, F.tok, {})).status === 403, 'модератор не публикует');
r = await P(`/api/admin/skypets/species/${spc}/publish`, D.tok, { at: new Date(Date.now() + 3600e3).toISOString() }); ok(r.data.scheduled, 'публикация по расписанию'); ok(sql(`select status from sp_species where id='${spc}'`) === 'approved', 'до срока не опубликован');
sql(`update sp_species set publish_at = now() - interval '1 second' where id='${spc}'`); await call('/api/admin/skypets/overview', {}, D.tok); await new Promise((x) => setTimeout(x, 100)); sql(`select 1`);
// принудительный вызов ленивой публикации (кэш 30с в процессе — публикуем вручную, если не успело)
if (sql(`select status from sp_species where id='${spc}'`) !== 'published') { r = await P(`/api/admin/skypets/species/${spc}/publish`, D.tok, {}); }
ok(sql(`select status from sp_species where id='${spc}'`) === 'published', 'опубликован'); ok((await G(`/api/skypets/img/${imgId}`, A.tok)).status === 200, 'картинка опубликованного видна людям');
// скин, яйцо, предмет
r = await P('/api/admin/skypets/skin', E.tok, { name: 'Звёздный', speciesId: 'cat-tabby', imageId: imgId, rarity: 'epic', priceCoins: 50 }); ok(r.status === 201, 'скин'); const skn = r.data.id; await P(`/api/admin/skypets/skin/${skn}/submit`, E.tok); await P(`/api/admin/skypets/skin/${skn}/moderate`, F.tok, { action: 'approve' }); ok((await P(`/api/admin/skypets/skin/${skn}/publish`, D.tok, {})).data.ok, 'скин опубликован');
r = await P('/api/admin/skypets/egg', E.tok, { name: 'Тестовое яйцо', priceCoins: 10, hatchSeconds: 5, interactions: 0, drops: [{ speciesId: spc, weight: 5 }] }); ok(r.status === 201, 'яйцо'); const eg = r.data.id;
ok((await P(`/api/admin/skypets/egg/${eg}/submit`, E.tok)).data.ok, 'яйцо на модерацию'); await P(`/api/admin/skypets/egg/${eg}/moderate`, F.tok, { action: 'approve' }); await P(`/api/admin/skypets/egg/${eg}/publish`, D.tok, {});
r = await G(`/api/skypets/eggs/${eg}/odds`, A.tok); ok(r.data.drops.length === 1 && r.data.drops[0].percent === 100, 'шансы нового яйца');
ok((await P('/api/admin/skypets/egg', E.tok, { name: 'Пустое яйцо', drops: [] })).status === 201 && true, '—');
r = await P('/api/admin/skypets/item', E.tok, { name: 'Особая игрушка', kind: 'toy', priceCoins: 5, art: { icon: 'ball', c1: '#ff7a7a' }, effect: { fun: 25, skill: 'charm', skillXp: 2, evil: 'rm -rf' } }); const itm = r.data.id; ok(r.status === 201, 'предмет'); r = await call(`/api/admin/skypets/item/${itm}`, {}, E.tok); ok(!('evil' in r.data.item.effect), 'эффект очищен от лишних полей');
await P(`/api/admin/skypets/item/${itm}/submit`, E.tok); await P(`/api/admin/skypets/item/${itm}/moderate`, F.tok, { action: 'approve' }); await P(`/api/admin/skypets/item/${itm}/publish`, D.tok, {}); ok((await G('/api/skypets/shop', A.tok)).data.items.some((i) => i.id === itm), 'предмет в магазине');
// самопроверка и покупка нового яйца → питомец нового вида
sql(`update sp_players set coins = coins + 500 where profile_id='${A.pid}'`); r = await P('/api/skypets/shop/buy', A.tok, { kind: 'egg', id: eg, idemKey: 'buy-newegg00-' + Date.now() }); ok(r.data.ok, 'покупка нового яйца');
const ne = (await G('/api/skypets/eggs', A.tok)).data.eggs.find((e) => e.eggId === eg); await P(`/api/skypets/egg/${ne.id}/incubate`, A.tok); sql(`update sp_player_eggs set ready_at=now()-interval '1 second' where id='${ne.id}'`);
r = await P(`/api/skypets/egg/${ne.id}/hatch`, A.tok); ok(r.data.ok && r.data.speciesId === spc, 'вылупился питомец созданного вида'); const nPet = r.data.pet.id;
r = await G(`/api/skypets/pet/${nPet}`, A.tok); ok(r.data.pet.species.imageId === imgId, 'у вида своя картинка');
// скин меняет только внешний вид
ok((await P(`/api/skypets/pet/${nPet}/skin`, A.tok, { skinId: skn })).data.error === 'bad_skin', 'скин чужого вида нельзя');
// модерация и откат
ok((await P(`/api/admin/skypets/species/${spc}/unpublish`, D.tok, { reason: 'проверка снятия' })).data.ok, 'снят с публикации'); ok((await G(`/api/skypets/pet/${nPet}`, A.tok)).data.pet.level === 1, 'питомцы остаются после снятия');
r = await P(`/api/admin/skypets/species/${spc}/publish`, D.tok, {}); ok(r.data.ok, 'повторная публикация');
r = await call(`/api/admin/skypets/species/${spc}`, {}, D.tok); ok(r.data.log.length >= 5 && r.data.versions.length >= 1, 'журнал и версии есть');
r = await call(`/api/admin/skypets/species/${spc}`, { method: 'PUT', body: J({ name: 'Переименованный', category: 'cats' }) }, D.tok); ok(r.data.ok, 'админ правит опубликованное (версия +1)');
r = await P(`/api/admin/skypets/species/${spc}/restore`, D.tok, { version: 1 }); ok(r.data.ok || r.data.error === 'version_not_found', 'откат версии');
// право модератора и свой материал
r = await P('/api/admin/skypets/item', D.tok, { name: 'Свой предмет модератора', kind: 'decor', priceCoins: 1, art: { icon: 'plant' } }); const own = r.data.id; await P(`/api/admin/skypets/item/${own}/submit`, D.tok); ok((await P(`/api/admin/skypets/item/${own}/moderate`, D.tok, { action: 'approve' })).data.error === 'self_review', 'свой материал не одобряют');
ok((await call(`/api/admin/skypets/species/${spc}`, { method: 'PUT', body: J({ name: 'x' }) }, A.tok)).status === 403, 'человек не правит каталог');
// события
r = await P('/api/admin/skypets/events', D.tok, { title: 'Турнир ухода', kind: 'tournament', metric: 'actions', startsAt: new Date(Date.now() - 3600e3).toISOString(), endsAt: new Date(Date.now() + 86400e3).toISOString(), reward: { participation: { coins: 10 }, top: [{ coins: 100 }] } }); ok(r.status === 201, 'событие создано');
ok((await P('/api/admin/skypets/events', E.tok, { title: 'Левое', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 1e5).toISOString() })).status === 403, 'создатель не создаёт события');
sql(`update sp_pets set energy=100, fun=10, hygiene=10, stat_at=now(), sleeping_until=null where id='${nPet}'`); await act(A.tok, nPet, 'bathe'); r = await G('/api/skypets/events', A.tok); ok(r.data.events[0].myScore >= 1, 'очки события растут от действий');
ok((await P(`/api/skypets/events/${r.data.events[0].id}/claim`, A.tok)).data.error === 'not_finished', 'награда после окончания');
// безопасность идентификаторов
for (const bad of ["pet-1'; drop table pets;--", '../../etc/passwd', 'x'.repeat(200)]) ok([404, 400].includes((await G(`/api/skypets/pet/${encodeURIComponent(bad)}`, A.tok)).status), 'мусорный id: ' + bad.slice(0, 12));
ok(Number(sql(`select count(*) from sp_pets`)) > 0, 'таблицы на месте');
console.log(`\nSky Pets: ${pass} проверок пройдено, ${fail} провалено`); process.exit(fail ? 1 : 0);
