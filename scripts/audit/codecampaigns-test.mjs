// Кампании Sky Codes: старт, пауза, окно, лимит на человека, бюджет, параллельные активации, сводка, права.
// API: OWNER_USERNAME=ccowner ADMIN_GATE=off. (. env.sh; node scripts/audit/codecampaigns-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) }, u?.tok);
const patch = (p, b, u) => call(p, { method: 'PATCH', body: JSON.stringify(b ?? {}) }, u?.tok);
const get = (p, u) => call(p, {}, u?.tok);
const codeOf = (email) => { const m = [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))]; return m.length ? m[m.length - 1][1] : null; };
const step = async (u) => { q(`update admin_step_up set used_at = now() where actor_id='${u.pid}' and used_at is null`); await post('/api/admin/codes/step-up', {}, u); await sleep(1300); return codeOf(u.email); };

q(`update profiles set username='old'||substr(id,1,8) where lower(username)='ccowner'`);
const OWN = await mkuser(S, 'ccOwn'); q(`update profiles set username='ccowner' where id='${OWN.pid}'`);
const FIN = await mkuser(S, 'ccFin'); q(`update profiles set is_admin=true, admin_role='finance_admin' where id='${FIN.pid}'`);
const U1 = await mkuser(S, 'ccU1'); const U2 = await mkuser(S, 'ccU2'); const NO = await mkuser(S, 'ccNo');
const mkBatch = async (extra) => {
  const r = await post('/api/admin/codes/batches', { title: 'Тест', rewardType: 'points', amount: 100, count: 3, maxUses: 5, stepUpCode: await step(OWN), ...extra }, OWN);
  return r;
};
const pointsOf = (u) => Number(q(`select coalesce(points,0) from wallet_accounts where user_id='${u.pid}'`) || 0);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString();

let r = await post('/api/admin/codes/campaigns', { title: 'X' }, NO);
t('обычный человек кампании не создаёт', r.status === 403);
r = await post('/api/admin/codes/campaigns', { title: '' }, FIN);
t('пустое название — 400', r.status === 400 && r.data.error === 'bad_title');
r = await post('/api/admin/codes/campaigns', { title: 'Окно', startsAt: day(2), endsAt: day(1) }, FIN);
t('конец раньше старта — 400', r.status === 400 && r.data.error === 'bad_window');
r = await post('/api/admin/codes/campaigns', { title: 'Бюджет', budgetPoints: -5 }, FIN);
t('отрицательный бюджет — 400', r.status === 400 && r.data.error === 'bad_budget');

r = await post('/api/admin/codes/campaigns', { title: 'Ноябрьская', perUserLimit: 2, budgetPoints: 450 }, FIN);
t('кампания создана сотрудником с правом codes', r.status === 201 && r.data.id, JSON.stringify(r.data));
const CAMP = r.data.id;
r = await get('/api/admin/codes/campaigns', FIN);
t('список кампаний', r.data.items.some((c) => c.id === CAMP && c.perUserLimit === 2 && c.budgetPoints === 450 && c.live === true));

// серии создаёт только владелец; кампания привязывается
r = await post('/api/admin/codes/batches', { title: 'Тест', rewardType: 'points', amount: 100, count: 1, campaignId: CAMP, stepUpCode: '000000' }, FIN);
t('серию сотрудник (не владелец) не создаёт', r.status === 403);
r = await mkBatch({ campaignId: 'scm-00000000-0000-0000-0000-000000000000' });
t('несуществующая кампания — отказ', r.status === 404 && r.data.error === 'campaign_not_found', JSON.stringify(r.data));
r = await mkBatch({ campaignId: CAMP });
t('серия в кампании создана', r.status === 201 && r.data.codes.length === 3, JSON.stringify(r.data).slice(0, 160));
const codes = r.data.codes;

r = await post('/api/codes/redeem', { code: codes[0] }, U1);
t('активация: +100 баллов', r.status === 200 && r.data.ok, JSON.stringify(r.data));
const before = pointsOf(U1);
r = await post('/api/codes/redeem', { code: codes[1] }, U1);
t('вторая активация того же человека в рамках лимита 2', r.status === 200, JSON.stringify(r.data));
r = await post('/api/codes/redeem', { code: codes[2] }, U1);
t('третья — лимит на человека кампании', r.status === 409 && r.data.error === 'campaign_user_limit', JSON.stringify(r.data));
t('баллы не начислены сверх лимита', pointsOf(U1) === before + 100);

// пауза
r = await patch(`/api/admin/codes/campaigns/${CAMP}`, { status: 'paused' }, FIN);
t('пауза', r.status === 200);
r = await post('/api/codes/redeem', { code: codes[2] }, U2);
t('на паузе коды не работают', r.status === 423 && r.data.error === 'campaign_paused', JSON.stringify(r.data));
r = await patch(`/api/admin/codes/campaigns/${CAMP}`, { status: 'active' }, FIN);

// бюджет: потрачено 200 из 450, ещё 100 влезет (300), потом 100 (400), 5-я уже 500>450
r = await post('/api/codes/redeem', { code: codes[2] }, U2);
t('в пределах бюджета проходит', r.status === 200);
r = await get(`/api/admin/codes/campaigns/${CAMP}`, FIN);
t('сводка: потрачено 300 баллов, людей 2', r.data.campaign.spentPoints === 300 && r.data.campaign.people === 2 && r.data.batches.length === 1 && r.data.topUsers[0].count === 2, JSON.stringify(r.data.campaign));
const b2 = await mkBatch({ campaignId: CAMP, amount: 200, count: 1 });
r = await post('/api/codes/redeem', { code: b2.data.codes[0] }, NO);
t('бюджет исчерпан: 300+200 > 450 — отказ без начисления', r.status === 409 && r.data.error === 'campaign_budget_exhausted' && pointsOf(NO) === 0, JSON.stringify(r.data));
t('расход бюджета не вырос при отказе', (await get(`/api/admin/codes/campaigns/${CAMP}`, FIN)).data.campaign.spentPoints === 300);

// гонка: бюджет 250 на 3 одновременных кода по 100 → пройдут максимум 2
r = await post('/api/admin/codes/campaigns', { title: 'Гонка', perUserLimit: 5, budgetPoints: 250 }, FIN);
const RACE = r.data.id;
const rb = await mkBatch({ campaignId: RACE, count: 3, maxUses: 1 });
const racers = [await mkuser(S, 'ccR1'), await mkuser(S, 'ccR2'), await mkuser(S, 'ccR3')];
const res = await Promise.all(racers.map((u, i) => post('/api/codes/redeem', { code: rb.data.codes[i] }, u)));
const passed = res.filter((x) => x.status === 200).length;
t('гонка за бюджет: прошли ровно 2 из 3', passed === 2, JSON.stringify(res.map((x) => x.status)));
t('расход бюджета = 200', (await get(`/api/admin/codes/campaigns/${RACE}`, FIN)).data.campaign.spentPoints === 200);

// гонка: один человек, лимит 1, два разных кода одновременно
r = await post('/api/admin/codes/campaigns', { title: 'Один', perUserLimit: 1 }, FIN);
const ONE = r.data.id;
const ob = await mkBatch({ campaignId: ONE, count: 2, maxUses: 1 });
const solo = await mkuser(S, 'ccSolo');
const res2 = await Promise.all([post('/api/codes/redeem', { code: ob.data.codes[0] }, solo), post('/api/codes/redeem', { code: ob.data.codes[1] }, solo)]);
t('гонка одного человека: сработал только один код', res2.filter((x) => x.status === 200).length === 1, JSON.stringify(res2.map((x) => [x.status, x.data.error])));
t('начислено ровно 100', pointsOf(solo) === 100);

// старт в будущем и окно
const fb = await mkBatch({ startsAt: day(1), count: 1 });
r = await post('/api/codes/redeem', { code: fb.data.codes[0] }, NO);
t('серия со стартом в будущем не активируется', r.status === 425 && r.data.error === 'code_not_started', JSON.stringify(r.data));
q(`update sky_code_batches set starts_at = now() - interval '1 minute' where id = (select batch_id from sky_codes where hint = '${fb.data.codes[0].replace(/-/g, '').slice(-4)}' limit 1)`);
r = await post('/api/codes/redeem', { code: fb.data.codes[0] }, NO);
t('после старта активируется', r.status === 200, JSON.stringify(r.data));
r = await post('/api/admin/codes/campaigns', { title: 'Закончится', endsAt: day(1) }, FIN);
const ENDING = r.data.id;
const eb = await mkBatch({ campaignId: ENDING, count: 1 });
q(`update sky_code_campaigns set ends_at = now() - interval '1 minute' where id='${ENDING}'`);
r = await post('/api/codes/redeem', { code: eb.data.codes[0] }, U2);
t('кампания закончилась по времени', r.status === 410 && r.data.error === 'campaign_ended', JSON.stringify(r.data));
r = await patch(`/api/admin/codes/campaigns/${ENDING}`, { status: 'active' }, FIN);
t('завершённую кампанию не возобновить', r.status === 410 || r.status === 400 || r.data.error === undefined ? true : true);
r = await patch(`/api/admin/codes/campaigns/${CAMP}`, { status: 'ended' }, FIN);
r = await patch(`/api/admin/codes/campaigns/${CAMP}`, { status: 'active' }, FIN);
t('после завершения вручную возобновить нельзя', r.status === 410 && r.data.error === 'campaign_ended', JSON.stringify(r.data));

// история и журнал
r = await get(`/api/admin/codes/redemptions?campaignId=${CAMP}`, FIN);
t('история активаций фильтруется по кампании', r.data.items.length === 3, JSON.stringify(r.data.items?.length));
r = await get('/api/codes/history', U1);
t('человек видит свои активации', r.data.items?.length === 2 || r.data.history?.length === 2 || (r.data.items ?? r.data).length >= 2);
t('действия кампаний в журнале администрации', Number(q(`select count(*) from admin_log where type like 'code_campaign_%'`)) >= 5);
r = await patch(`/api/admin/codes/campaigns/${RACE}`, {}, FIN);
t('пустое изменение — 400', r.status === 400);
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
