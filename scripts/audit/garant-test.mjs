import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql ${process.env.TEST_DATABASE_URL || 'postgres://sky:sky@127.0.0.1/sky'} -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let pass = 0, fail = 0; const ok = (c, m, x = '') => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m, x); } };
const sel = await mkuser(S, 'gts'), buy = await mkuser(S, 'gtb'), adm = await mkuser(S, 'gta'), out = await mkuser(S, 'gto');
q(`update profiles set is_admin=true, admin_role='super_admin' where id='${adm.pid}'`);
for (const u of [sel, buy, adm, out]) await call('/api/wallet', {}, u.tok);
const bal = (u, col = 'balance') => Number(q(`select ${col} from wallet_accounts where user_id='${u.pid}'`));
const P = (path, tok, body = {}) => call(path, { method: 'POST', body: JSON.stringify(body) }, tok);
const mkDeal = async (payType = 'rubles', price = 500) => {
  const r = await P('/api/garant/deals', sel.tok, { buyerId: buy.pid, itemType: 'item', itemName: 'Test', title: 'T', price, payType });
  const id = r.data.deal?.id; if (!id) throw new Error('deal: ' + r.text);
  await P(`/api/garant/deals/${id}/deposit-seller`, sel.tok);
  const d = await P(`/api/garant/deals/${id}/deposit-buyer`, buy.tok);
  if (d.status !== 200) throw new Error('deposit-buyer: ' + d.text);
  return id;
};
q(`update wallet_accounts set balance=100000, points=100000 where user_id='${buy.pid}'`);
q(`insert into garant_subscriptions(profile_id,status,until) values ('${sel.pid}','active', now() + interval '30 days')`);

// 1. чужой и сторонний
let id = await mkDeal();
let r = await P(`/api/garant/deals/${id}/confirm-buyer`, out.tok); ok(r.status === 404, 'посторонний не подтверждает за покупателя');
r = await P(`/api/garant/deals/${id}/confirm-buyer`, sel.tok); ok(r.status === 404, 'продавец не подтверждает за покупателя');
r = await P(`/api/garant/deals/${id}/cancel`, sel.tok); ok(r.status >= 400, 'после эскроу обычная отмена закрыта', String(r.status));
r = await call(`/api/garant/admin/deals/${id}`, {}, out.tok); ok(r.status === 403, 'обычный пользователь не открывает админский вид');
r = await P(`/api/garant/admin/deals/${id}/force-cancel`, out.tok); ok(r.status === 403, 'обычный пользователь не отменяет принудительно');

// 2. гонка двойных подтверждений -> продавцу ровно одна выплата
const s0 = bal(sel);
const rs = await Promise.all([P(`/api/garant/deals/${id}/confirm-buyer`, buy.tok), P(`/api/garant/deals/${id}/confirm-buyer`, buy.tok), P(`/api/garant/deals/${id}/confirm-seller`, sel.tok), P(`/api/garant/deals/${id}/confirm-seller`, sel.tok)]);
const st = q(`select status from garant_deals where id='${id}'`);
ok(st === 'completed' && bal(sel) === s0 + 500, `гонка подтверждений: статус ${st}, продавцу +${bal(sel) - s0} (ждём +500)`, rs.map((x) => x.status).join(','));

// 3. гонка решения спора: 6 параллельных seller_wins
id = await mkDeal();
r = await P(`/api/garant/deals/${id}/dispute`, buy.tok, { reason: 'не пришло' }); ok(r.status === 200, 'спор открыт');
const s1 = bal(sel), b1 = bal(buy);
const rr = await Promise.all(Array.from({ length: 6 }, () => P(`/api/garant/admin/deals/${id}/resolve`, adm.tok, { winner: 'seller_wins', note: 'n' })));
ok(bal(sel) === s1 + 500, `параллельные решения «в пользу продавца»: продавцу +${bal(sel) - s1} (ждём +500)`, rr.map((x) => x.status).join(','));

// 4. гонка противоположных решений: деньги не должны уйти обоим
id = await mkDeal();
await P(`/api/garant/deals/${id}/dispute`, buy.tok, { reason: 'x' });
const s2 = bal(sel), b2 = bal(buy);
await Promise.all([P(`/api/garant/admin/deals/${id}/resolve`, adm.tok, { winner: 'seller_wins', note: 'n' }), P(`/api/garant/admin/deals/${id}/resolve`, adm.tok, { winner: 'buyer_wins', note: 'n' }), P(`/api/garant/admin/deals/${id}/resolve`, adm.tok, { winner: 'cancelled', note: 'n' })]);
const gotS = bal(sel) - s2, gotB = bal(buy) - b2; // покупатель уже заплатил 500 в mkDeal; возврат = +500 относительно b2
ok((gotS === 500 && gotB === 0) || (gotS === 0 && gotB === 500), `противоположные решения: продавцу +${gotS}, покупателю +${gotB} (деньги уходят одной стороне)`);

// 5. двойная принудительная отмена -> один возврат
id = await mkDeal();
const b3 = bal(buy);
await Promise.all(Array.from({ length: 5 }, () => P(`/api/garant/admin/deals/${id}/force-cancel`, adm.tok)));
ok(bal(buy) === b3 + 500, `параллельные force-cancel: покупателю вернулось +${bal(buy) - b3} (ждём +500)`);

// 6. баллы
id = await mkDeal('points', 300);
const sp = bal(sel, 'points'); await P(`/api/garant/deals/${id}/dispute`, buy.tok, { reason: 'p' });
await Promise.all(Array.from({ length: 4 }, () => P(`/api/garant/admin/deals/${id}/resolve`, adm.tok, { winner: 'seller_wins', note: 'n' })));
ok(bal(sel, 'points') === sp + 300, `баллы: продавцу +${bal(sel, 'points') - sp} (ждём +300)`);
console.log(`\nИТОГО: ${pass} ok, ${fail} FAIL`);
