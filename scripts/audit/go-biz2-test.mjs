// Sky GO Business, этап 8: выгрузка CSV, финансовый отчёт, пакет заказов, повтор заказа, изоляция организаций.
// Запуск: API с ADMIN_GATE=off GO_RATE_MULT=20 RATE_LIMIT_PER_MINUTE=5000 (. env.sh; node scripts/audit/go-biz2-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
import { csvCell } from '../../server/gobizreports.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { validInn, validOgrn } = await import('../../server/sellerrules.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 220) : JSON.stringify(x).slice(0, 220)); } };
const G = (path, o, tok) => call('/api/go' + path, o, tok);
const J = (b) => ({ method: 'POST', body: JSON.stringify(b) });
const gen = (len, fn) => { for (let i = 0; i < 100000; i += 1) { const s = String(Math.floor(Math.random() * 10 ** len)).padStart(len, '0'); if (fn(s)) return s; } throw new Error('gen'); };
const inn10 = () => gen(10, (s) => validInn(s, { length: 10 })); const ogrn = () => gen(13, validOgrn);
const CITY = 'Москва';

t('CSV: формулы и кавычки обезврежены', csvCell('=1+1') === "'=1+1" && csvCell('+7 999') === "'+7 999" && csvCell('a"b') === '"a""b"' && csvCell('a,b') === '"a,b"' && csvCell('a\nb') === 'a b' && csvCell(null) === '');

const A = await mkuser(S, 'b2Adm'); q(`update profiles set is_admin=true, admin_role='super_admin' where id='${A.pid}'`);
const O = await mkuser(S, 'b2Own'); const O2 = await mkuser(S, 'b2Own2'); const M = await mkuser(S, 'b2Mgr'); const X = await mkuser(S, 'b2Str');
for (const u of [O, O2]) q(`update profiles set date_of_birth='1990-05-05' where id='${u.pid}'`);
const uname = (u) => q(`select username from profiles where id='${u.pid}'`);
const company = async (u, brand) => {
  const r = await G('/executors', J({ role: 'company', legalForm: 'ooo', city: CITY, fields: { orgName: `ООО «${brand}»`, inn: inn10(), ogrn: ogrn(), orgPhone: '+74951234567', orgEmail: 'o@example.com', repName: 'Сидоров С.С.', repPosition: 'Директор', repIsHead: true }, extra: { brand } }), u.tok);
  await G(`/executors/${r.data.id}/submit`, J({}), u.tok);
  await call(`/api/admin/go/applications/${r.data.id}/decide`, J({ action: 'approve', note: '' }), A.tok);
  q(`insert into wallet_accounts(user_id,balance) values ('${u.pid}',500) on conflict (user_id) do update set balance = wallet_accounts.balance + 500`);
  await G('/subscription/company/buy', J({}), u.tok);
  return (await G('/workspaces', {}, u.tok)).data.orgs[0]?.id;
};
const ORG = await company(O, 'Бизнес-Два'); const ORG2 = await company(O2, 'Чужая-Орг');
t('две организации созданы', Boolean(ORG) && Boolean(ORG2) && ORG !== ORG2);
let r = await G(`/org/${ORG}/members/invite`, J({ username: uname(M), role: 'manager' }), O.tok); await G(`/org/invites/${ORG}/respond`, J({ accept: true }), M.tok);

const P1 = { address: 'Тверская 1', lat: 55.76, lng: 37.62 }; const P2 = { address: 'Арбат 10', lat: 55.75, lng: 37.59 };
const ord = (extra = {}) => ({ city: CITY, from: P1, to: P2, size: 's', parcel: { description: 'Документы', weightKg: 1, size: 's' }, recipient: { name: 'Получатель', phone: '+79990000002' }, sender: { name: 'Отправитель', phone: '+79990000001' }, assignMode: 'manual', ...extra });

/* пакет */
r = await G(`/org/${ORG}/orders/batch`, J({ orders: [] }), O.tok); t('пустой пакет отклонён', r.status === 400 && r.data.error === 'batch_empty', JSON.stringify(r.data));
r = await G(`/org/${ORG}/orders/batch`, J({ orders: Array.from({ length: 51 }, () => ord()) }), O.tok); t('пакет больше 50 отклонён', r.status === 400 && r.data.error === 'batch_too_large', JSON.stringify(r.data));
const key = `bk-${Date.now()}`;
const rows = [ord({ parcel: { description: '=ВЫЗОВ()', weightKg: 1, size: 's' } }), ord({ recipient: { name: 'Х', phone: '123' } }), ord(), 'мусор', ord({ to: { address: 'Пустая точка' } })];
r = await G(`/org/${ORG}/orders/batch`, J({ batchKey: key, orders: rows }), O.tok);
t('пакет: годные строки созданы, плохие отклонены по отдельности', r.status === 201 && r.data.created === 2 && r.data.failed === 3 && r.data.results[0].ok && !r.data.results[1].ok && r.data.results[2].ok && r.data.results[3].error === 'bad_row', JSON.stringify(r.data).slice(0, 300));
const created = r.data.results.filter((x) => x.ok).map((x) => x.orderId);
r = await G(`/org/${ORG}/orders/batch`, J({ batchKey: key, orders: rows }), O.tok);
t('повтор того же пакета не создаёт заказы заново', r.data.results.filter((x) => x.ok).every((x) => x.duplicate) && Number(q(`select count(*) from go_orders where org_id='${ORG}'`)) === 2, JSON.stringify(r.data).slice(0, 200));
r = await G(`/org/${ORG}/orders/batch`, J({ orders: [ord()] }), X.tok); t('посторонний пакет создать не может', r.status === 404);
r = await G(`/org/${ORG}/orders/batch`, J({ orders: [ord()] }), M.tok); t('менеджер может создавать пакеты', r.status === 201 && r.data.created === 1, JSON.stringify(r.data).slice(0, 160));
t('все заказы пакета принадлежат своей организации', Number(q(`select count(*) from go_orders where org_id='${ORG}'`)) === 3 && Number(q(`select count(*) from go_orders where org_id='${ORG2}'`)) === 0);

/* выгрузка */
const raw = async (path, tok) => { const x = await fetch('http://127.0.0.1:8080/api/go' + path, { headers: { authorization: `Bearer ${tok}` } }); return { status: x.status, text: await x.text(), type: x.headers.get('content-type'), disp: x.headers.get('content-disposition') }; };
let e = await raw(`/org/${ORG}/orders/export`, O.tok);
t('выгрузка CSV: владелец получает файл', e.status === 200 && /text\/csv/.test(e.type) && /attachment/.test(e.disp) && e.text.split('\r\n').length >= 4, e.text.slice(0, 100));
t('в CSV описание-формула экранировано', e.text.includes("'=ВЫЗОВ()") && !/,=ВЫЗОВ/.test(e.text));
e = await raw(`/org/${ORG}/orders/export`, M.tok); t('менеджер тоже выгружает', e.status === 200);
e = await raw(`/org/${ORG}/orders/export`, X.tok); t('посторонний выгрузить не может', e.status === 404);
e = await raw(`/org/${ORG}/orders/export`, O2.tok); t('владелец ДРУГОЙ организации тоже', e.status === 404);
e = await raw(`/org/${ORG2}/orders/export`, O2.tok); t('своя выгрузка другой организации не содержит чужих заказов', e.status === 200 && e.text.split('\r\n').filter(Boolean).length === 1, e.text.slice(0, 80));
e = await raw(`/org/${ORG}/orders/export?from=2999-01-01&to=2999-12-31`, O.tok); t('период без заказов — только заголовок', e.status === 200 && e.text.split('\r\n').filter(Boolean).length === 1);
t('выгрузка записана в журнал организации', Number(q(`select count(*) from go_org_audit where org_id='${ORG}' and action='orders_export'`)) >= 2);

/* повтор заказа */
r = await G(`/org/${ORG}/orders/${created[0]}/repeat`, J({}), M.tok); t('повтор заказа создаёт новый заказ', r.status === 201 && r.data.orderId && r.data.orderId !== created[0], JSON.stringify(r.data));
r = await G(`/org/${ORG2}/orders/${created[0]}/repeat`, J({}), O2.tok); t('повторить чужой заказ нельзя (not_found)', r.status === 404, JSON.stringify(r.data));
r = await G(`/org/${ORG}/orders/${created[0]}/repeat`, J({}), X.tok); t('посторонний повторить не может', r.status === 404);

/* финансовый отчёт */
q(`update go_orders set status='paid', completed_at=now() where id='${created[0]}'`);
q(`update go_orders set status='awaiting_payment' where id='${created[1]}'`);
r = await G(`/org/${ORG}/finance?days=30`, {}, O.tok);
t('финотчёт: оплаченные и ожидающие считаются раздельно, валюта, пояснение', r.status === 200 && r.data.currency === 'RUB' && r.data.paid.orders === 1 && r.data.paid.rub > 0 && r.data.awaiting.orders === 1 && r.data.byDay.length === 1 && /не принимает деньги/.test(r.data.note), JSON.stringify(r.data).slice(0, 300));
r = await G(`/org/${ORG}/finance`, {}, M.tok); t('менеджер финотчёт не видит (только владелец и администратор)', r.status === 403);
r = await G(`/org/${ORG}/finance`, {}, O2.tok); t('чужой владелец — not_found', r.status === 404);
console.log(bad ? `\nПРОВАЛЕНО: ok=${ok} fail=${bad}` : `\nВсе проверки пройдены: ok=${ok} fail=0`);
process.exit(bad ? 1 : 0);
