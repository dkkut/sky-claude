// Sky Gifts: покупка NFT-подарков (у платформы и на маркете) и обычных подарков — атомарность, гонки, повторы, откат, диагностика владения.
//   API с OWNER_USERNAME=ownertest и достаточно высокими RATE_LIMIT. (. env.sh; node scripts/audit/gifts-buy-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
import { mintPrice } from '../../server/nftgenesis.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const j = (o) => JSON.stringify(o ?? {});
const post = (p, b, u) => call(p, { method: 'POST', body: j(b) }, u.tok);
const bal = (u) => Number(q(`select coalesce((select balance from wallet_accounts where user_id='${u.pid}'),0)`));
const pts = (u) => Number(q(`select coalesce((select points from wallet_accounts where user_id='${u.pid}'),0)`));
const fund = (u, rub = 0, points = 0) => q(`insert into wallet_accounts (user_id, balance, points) values ('${u.pid}', ${rub}, ${points}) on conflict (user_id) do update set balance=${rub}, points=${points}`);
const owner = (n) => q(`select owner_id from nft_ownership where nft_id='gift-${n}'`);
// Подарки, которые точно ещё у Sky Mint: ищем свободные номера (прогоны оставляют следы)
const freeIds = (() => { const taken = new Set(q(`select nft_id from nft_ownership`).split('\n').filter(Boolean)); const out = []; for (let n = 84; n >= 1 && out.length < 12; n -= 1) if (!taken.has(`gift-${n}`)) out.push(n); return out; })();
const next = () => freeIds.shift();

const A = await mkuser(S, 'gba'); const B = await mkuser(S, 'gbb'); const C = await mkuser(S, 'gbc');

/* ═══ NFT у платформы ═══ */
{
  const n = next(); const price = mintPrice(`gift-${n}`);
  fund(A, price + 100);
  const r = await post(`/api/gifts/nft/gift-${n}/buy`, { price: 1, ownerId: 'x' }, A);   // цену и владельца клиент подставить не может
  t('NFT у платформы: успешная покупка', r.status === 200 && r.data.ok && r.data.price === price, j(r.data));
  t('NFT у платформы: списана цена каталога, а не присланная клиентом', bal(A) === 100);
  t('NFT у платформы: владелец — покупатель, не подставленный клиентом', owner(n) === A.pid);
  const h = await call(`/api/gifts/nft/gift-${n}/history`, {}, A.tok);
  t('NFT у платформы: в истории продажа Sky Mint → покупатель с ценой', h.data.provenance.some((p) => p.type === 'sale' && p.toId === A.pid && p.price === price && p.fromId === 'sky-mint'), j(h.data).slice(0, 200));
  const again = await post(`/api/gifts/nft/gift-${n}/buy`, {}, A);
  t('NFT: повторный запрос — «недоступно», деньги не списываются второй раз', again.status === 409 && again.data.error === 'unavailable' && bal(A) === 100, j(again.data));
  const other = await post(`/api/gifts/nft/gift-${n}/buy`, {}, B);
  t('NFT: чужой подарок купить у платформы нельзя', other.status === 409 && owner(n) === A.pid);
}
{
  const n = next(); const price = mintPrice(`gift-${n}`);
  fund(B, price - 1);
  const r = await post(`/api/gifts/nft/gift-${n}/buy`, {}, B);
  t('NFT: недостаточно средств — отказ, баланс и владелец не изменились', r.status === 402 && r.data.error === 'insufficient_funds' && bal(B) === price - 1 && owner(n) === '', j(r.data));
  t('NFT: несуществующий id — 404', (await post('/api/gifts/nft/gift-9999/buy', {}, B)).status === 404);
  t('NFT: без входа — 401', (await call(`/api/gifts/nft/gift-${n}/buy`, { method: 'POST', body: '{}' })).status === 401);
}
{
  // две одновременные покупки ОДНОГО подарка разными людьми
  const n = next(); const price = mintPrice(`gift-${n}`);
  fund(A, price * 3); fund(B, price * 3);
  const [r1, r2] = await Promise.all([post(`/api/gifts/nft/gift-${n}/buy`, {}, A), post(`/api/gifts/nft/gift-${n}/buy`, {}, B)]);
  const wins = [r1, r2].filter((r) => r.status === 200).length;
  t('NFT: гонка двух покупателей — ровно один победитель', wins === 1, `${r1.status} ${r2.status}`);
  t('NFT: гонка — списан только победитель, проигравший не потерял ничего', (bal(A) === price * 3) !== (bal(B) === price * 3) && Math.min(bal(A), bal(B)) === price * 2 && Math.max(bal(A), bal(B)) === price * 3, `${bal(A)} ${bal(B)}`);
  t('NFT: гонка — владелец ровно один и совпадает с победителем', [A.pid, B.pid].includes(owner(n)) && (owner(n) === A.pid ? r1.status === 200 : r2.status === 200));
}
{
  // пять одновременных запросов одного человека
  const n = next(); const price = mintPrice(`gift-${n}`);
  fund(C, price * 10);
  const rs = await Promise.all(Array.from({ length: 5 }, () => post(`/api/gifts/nft/gift-${n}/buy`, {}, C)));
  t('NFT: пять параллельных «двойных нажатий» — одна покупка', rs.filter((r) => r.status === 200).length === 1 && bal(C) === price * 9, rs.map((r) => r.status).join());
  t('NFT: пять параллельных — в истории ровно одна продажа', Number(q(`select count(*) from nft_provenance where nft_id='gift-${n}' and type='sale'`)) === 1);
}
{
  // сбой базы посреди покупки: списание и передача откатываются вместе
  const n = next(); const price = mintPrice(`gift-${n}`);
  fund(B, price + 7);
  q(`create or replace function tmp_fail_prov() returns trigger as $$ begin if NEW.to_id = '${B.pid}' and NEW.type = 'sale' then raise exception 'test failure'; end if; return NEW; end $$ language plpgsql`);
  q(`drop trigger if exists tmp_fail_prov_t on nft_provenance`);
  q(`create trigger tmp_fail_prov_t before insert on nft_provenance for each row execute function tmp_fail_prov()`);
  const r = await post(`/api/gifts/nft/gift-${n}/buy`, {}, B);
  q(`drop trigger if exists tmp_fail_prov_t on nft_provenance`);
  t('NFT: сбой базы при выдаче — ошибка сервера, но деньги НЕ потеряны', r.status >= 500 && bal(B) === price + 7, `${r.status} ${bal(B)}`);
  t('NFT: сбой базы — владелец не изменился, «призрачной» записи нет', owner(n) === '' && Number(q(`select count(*) from wallet_transactions where user_id='${B.pid}' and type='nft_purchase' and ref like 'mint:gift-${n}:%'`)) === 0);
  const ok2 = await post(`/api/gifts/nft/gift-${n}/buy`, {}, B);
  t('NFT: после сбоя покупка проходит нормально', ok2.status === 200 && bal(B) === 7, j(ok2.data));
}
{
  // передача и право собственности
  const n = next(); const price = mintPrice(`gift-${n}`);
  fund(A, price); await post(`/api/gifts/nft/gift-${n}/buy`, {}, A);
  t('передача: не владелец передать не может', (await post(`/api/gifts/nft/gift-${n}/transfer`, { recipientId: C.pid }, B)).data.error === 'not_owner');
  t('передача: самому себе нельзя', (await post(`/api/gifts/nft/gift-${n}/transfer`, { recipientId: A.pid }, A)).data.error === 'self_transfer');
  t('передача: несуществующему получателю нельзя', (await post(`/api/gifts/nft/gift-${n}/transfer`, { recipientId: 'acc-nope' }, A)).data.error === 'recipient_not_found');
  const [x, y] = await Promise.all([post(`/api/gifts/nft/gift-${n}/transfer`, { recipientId: B.pid }, A), post(`/api/gifts/nft/gift-${n}/transfer`, { recipientId: C.pid }, A)]);
  t('передача: два одновременных перевода одного подарка — один победитель', [x, y].filter((r) => r.status === 200).length === 1, `${x.status} ${y.status}`);
}

/* ═══ Маркет (лоты) ═══ */
{
  const n = next(); const price = mintPrice(`gift-${n}`);
  fund(A, price); await post(`/api/gifts/nft/gift-${n}/buy`, {}, A);
  const lst = await post(`/api/gifts/nft/gift-${n}/listing`, { type: 'fixed', price: 500, durationH: 24 }, A);
  t('маркет: владелец выставляет лот', lst.status === 200 || lst.status === 201, j(lst.data));
  const id = lst.data.listing?.id;
  t('маркет: не владелец выставить не может', (await post(`/api/gifts/nft/gift-${n}/listing`, { type: 'fixed', price: 500, durationH: 24 }, B)).data.error === 'not_owner');
  fund(B, 499);
  const poor = await post(`/api/gifts/nft/listing/${id}/buy`, {}, B);
  t('маркет: не хватает денег — отказ, лот остаётся, владелец прежний', poor.status === 402 && q(`select status from nft_listings where id='${id}'`) === 'active' && owner(n) === A.pid && bal(B) === 499, j(poor.data));
  t('маркет: продавец не может купить свой лот', (await post(`/api/gifts/nft/listing/${id}/buy`, {}, A)).data.error === 'self_transfer');
  fund(B, 2000); fund(C, 2000);
  const [r1, r2] = await Promise.all([post(`/api/gifts/nft/listing/${id}/buy`, {}, B), post(`/api/gifts/nft/listing/${id}/buy`, {}, C)]);
  t('маркет: гонка двух покупателей лота — один победитель', [r1, r2].filter((r) => r.status === 200).length === 1, `${r1.status} ${r2.status}`);
  const win = r1.status === 200 ? B : C; const lose = r1.status === 200 ? C : B;
  t('маркет: списан только победитель, цена лота, проигравший цел', bal(win) === 1500 && bal(lose) === 2000, `${bal(win)} ${bal(lose)}`);
  t('маркет: владелец сменился, лот продан', owner(n) === win.pid && q(`select status from nft_listings where id='${id}'`) === 'sold');
  t('маркет: повторная покупка проданного лота — недоступно', (await post(`/api/gifts/nft/listing/${id}/buy`, {}, lose)).data.error === 'unavailable');
}
{
  // протухший лот: подарок ушёл в обход маркета
  const n = next(); const price = mintPrice(`gift-${n}`);
  fund(A, price); await post(`/api/gifts/nft/gift-${n}/buy`, {}, A);
  const lst = await post(`/api/gifts/nft/gift-${n}/listing`, { type: 'fixed', price: 300, durationH: 24 }, A);
  await post(`/api/gifts/nft/gift-${n}/transfer`, { recipientId: C.pid }, A);
  fund(B, 1000);
  const r = await post(`/api/gifts/nft/listing/${lst.data.listing.id}/buy`, {}, B);
  t('маркет: лот, чей подарок уже передан, не продаётся; деньги целы', r.data.error === 'unavailable' && bal(B) === 1000 && owner(n) === C.pid, j(r.data));
}

/* ═══ Обычные подарки (баллы) ═══ */
{
  const gid = `gc-${crypto.randomUUID()}`;
  q(`insert into gift_catalog (id, name, price_points, active) values ('${gid}', 'Тест-подарок', 100, true)`);
  const send = (u, rcpt, key, extra = {}) => post('/api/gifts/send', { giftCatalogId: gid, recipientId: rcpt, target: 'profile', idemKey: key, ...extra }, u);
  fund(A, 0, 50);
  let r = await send(A, B.pid, 'key-poor-0001');
  t('обычный подарок: не хватает баллов — отказ без списания и без выданного подарка', [402, 400].includes(r.status) && r.data.error === 'insufficient_points' && pts(A) === 50 && Number(q(`select count(*) from gift_instances where gift_catalog_id='${gid}'`)) === 0, j(r.data));
  fund(A, 0, 250);
  r = await send(A, B.pid, 'key-ok-00001');
  t('обычный подарок: успешная покупка и выдача', r.status === 201 && r.data.instanceId && pts(A) === 150, j(r.data));
  t('обычный подарок: заказ оплачен, экземпляр у получателя', q(`select status from gift_orders where id='${r.data.orderId}'`) === 'paid' && q(`select recipient_id from gift_instances where id='${r.data.instanceId}'`) === B.pid);
  const rep = await send(A, B.pid, 'key-ok-00001');
  t('обычный подарок: повтор с тем же ключом — тот же результат, повторного списания нет', rep.data.instanceId === r.data.instanceId && pts(A) === 150, j(rep.data));
  const par = await Promise.all(Array.from({ length: 5 }, () => send(A, C.pid, 'key-par-00001')));
  t('обычный подарок: пять параллельных запросов с одним ключом — одно списание, один подарок', pts(A) === 50 && new Set(par.map((x) => x.data.instanceId)).size === 1, par.map((x) => x.status).join());
  fund(A, 0, 100);
  const two = await Promise.all([send(A, B.pid, 'key-race-0001'), send(A, C.pid, 'key-race-0002')]);
  t('обычный подарок: баллов на один подарок, два разных запроса — один успех, второй «не хватает», баллы не уходят в минус', two.filter((x) => x.status === 201).length === 1 && pts(A) === 0, two.map((x) => `${x.status}:${x.data.error ?? ''}`).join());
  fund(A, 0, 500);
  t('обычный подарок: несуществующий получатель — отказ без списания', (await send(A, 'acc-nope', 'key-norc-0001')).data.error === 'recipient_not_found' && pts(A) === 500);
  t('обычный подарок: выключенный/несуществующий подарок — отказ', (await post('/api/gifts/send', { giftCatalogId: 'gc-00000000-0000-0000-0000-000000000000', recipientId: B.pid, target: 'profile', idemKey: 'key-nogift-01' }, A)).data.error === 'not_found');
  t('обычный подарок: без ключа идемпотентности запрос отклоняется', (await post('/api/gifts/send', { giftCatalogId: gid, recipientId: B.pid, target: 'profile' }, A)).data.error === 'idem_key_required');
  const ok3 = await send(A, B.pid, 'key-cancel-001'); const before = pts(A);
  const cn = await post(`/api/gifts/instances/${ok3.data.instanceId}/cancel`, {}, A);
  t('обычный подарок: отмена в течение трёх часов возвращает баллы ровно один раз', cn.status === 200 && pts(A) === before + 100, j(cn.data));
  t('обычный подарок: повторная отмена не возвращает баллы второй раз', (await post(`/api/gifts/instances/${ok3.data.instanceId}/cancel`, {}, A)).data.error === 'already_cancelled' && pts(A) === before + 100);
  const other = await send(A, B.pid, 'key-cancel-002');
  t('обычный подарок: чужой человек отменить не может', (await post(`/api/gifts/instances/${other.data.instanceId}/cancel`, {}, B)).data.error === 'not_allowed');
  q(`update gift_instances set created_at = now() - interval '4 hours' where id='${other.data.instanceId}'`);
  t('обычный подарок: после трёх часов отмена закрыта', (await post(`/api/gifts/instances/${other.data.instanceId}/cancel`, {}, A)).data.error === 'window_expired');
  q(`update gift_catalog set active=false where id='${gid}'`);
  t('обычный подарок: снятый с продажи подарок купить нельзя', (await send(C, B.pid, 'key-off-00001')).data.error === 'not_found');
}

/* ═══ Диагностика владения ═══ */
{
  const adm = await mkuser(S, 'gbadm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${adm.pid}'`);
  const h = await call('/api/gifts/admin/health', {}, adm.tok);
  t('диагностика: администратор видит реальные данные владения и заказов', h.status === 200 && typeof h.data.nft.mint === 'number' && Array.isArray(h.data.nft.demoOwners) && 'byStatus' in h.data.orders, j(h.data).slice(0, 150));
  t('диагностика: обычному человеку закрыта', (await call('/api/gifts/admin/health', {}, A.tok)).status === 403);
  const nn = next();
  q(`insert into nft_ownership (nft_id, owner_id, owner_name) values ('gift-${nn}', 'acc-luna', 'Luna Nova') on conflict do nothing`);
  const h2 = await call('/api/gifts/admin/health', {}, adm.tok);
  t('диагностика: остаток демонстрационного владельца виден (и ничего не удалено)', h2.data.nft.demoOwners.some((x) => x.nftId === `gift-${nn}`) && owner(nn) === 'acc-luna');
  q(`delete from nft_ownership where nft_id='gift-${nn}'`);
}
console.log(`\nИтого: ${ok} ok, ${bad} fail`);
process.exit(bad ? 1 : 0);
