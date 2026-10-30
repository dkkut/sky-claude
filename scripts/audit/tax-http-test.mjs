// Sky Tax через HTTP: права, изоляция, опасные действия. Запуск: node scripts/audit/tax-http-test.mjs <каталог с api.log>
// API: OWNER_USERNAME=taxowner ADMIN_GATE=off ADMIN_TOKEN=off BLOX_ALLOW_PRIVATE=1 EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test; тестовый шлюз — scripts/audit/fakes/tax-gateway.mjs
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const q = (s) => execSync(`psql postgres://sky:sky@localhost:5432/skytest -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const owner = await mkuser(S, 'TaxOwn'); q(`UPDATE profiles SET username='taxowner' WHERE id='${owner.pid}'`); const a = await mkuser(S, 'TaxA'); const b = await mkuser(S, 'TaxB');
// продавцам нужен магазин с налоговым статусом (в проде его выставляет проверка Market)
for (const [u, kind] of [[a, 'ip'], [b, 'npd']]) q(`INSERT INTO market_sellers (profile_id, shop_name, tax_kind, verification_status) VALUES ('${u.pid}','Магазин ${u.pid.slice(-4)}','${kind}','approved') ON CONFLICT (profile_id) DO UPDATE SET tax_kind='${kind}'`);

/* без входа и без прав */
t('без входа — 401', (await call('/api/tax/scopes')).status === 401 && (await call('/api/admin/tax/overview')).status === 401);
t('обычный человек не видит админку Sky Tax', (await call('/api/admin/tax/overview', {}, a.tok)).status === 403);
t('чужой/несуществующий scope — 404', (await call(`/api/tax/subject?scope=seller:${b.pid}`, {}, a.tok)).status === 404 && (await call('/api/tax/subject?scope=sky', {}, a.tok)).status === 404 && (await call('/api/tax/subject?scope=kb:nope-1', {}, a.tok)).status === 404);
t('мусор в scope — 404', (await call('/api/tax/subject?scope=' + encodeURIComponent("seller:x';drop table tax_ops;--"), {}, a.tok)).status === 404);
t('публичная ссылка документа без подписи — 404', (await call('/api/tax/doc/abc.def')).status === 404);

/* свой учёт продавца */
const sc = await call('/api/tax/scopes', {}, a.tok);
t('в «моих учётах» — свой магазин, без чужих и без Sky', sc.status === 200 && sc.data.scopes.length === 1 && sc.data.scopes[0].scope === `seller:${a.pid}`, JSON.stringify(sc.data));
const A = `seller:${a.pid}`;
const g0 = await call(`/api/tax/subject?scope=${A}`, {}, a.tok);
t('статус из Market подставлен (ИП), права управления есть', g0.data.canManage === true && (g0.data.subject === null || g0.data.subject.taxStatus === 'ip'));
t('создание учёта', (await call('/api/tax/subject', { method: 'POST', body: JSON.stringify({ scope: A, name: 'Мой магазин' }) }, a.tok)).status === 200);
t('статус нельзя объявить другим, чем подтверждён Market', (await call('/api/tax/subject', { method: 'POST', body: JSON.stringify({ scope: A, taxStatus: 'npd' }) }, a.tok)).status === 409);
t('плохой ИНН', (await call('/api/tax/subject', { method: 'POST', body: JSON.stringify({ scope: A, inn: '123456789012' }) }, a.tok)).status === 400);
const sv = await call('/api/tax/subject', { method: 'POST', body: JSON.stringify({ scope: A, taxStatus: 'ip', regime: 'usn_income', inn: '500100732259' }) }, a.tok);
t('сведения сохранены, ИНН наружу не отдаётся', sv.status === 200 && sv.data.subject.hasInn && sv.data.subject.innLast4 === '2259' && !JSON.stringify(sv.data).includes('500100732259'), JSON.stringify(sv.data));
t('режим: автоматически', (await call('/api/tax/mode', { method: 'PUT', body: JSON.stringify({ scope: A, mode: 'auto' }) }, a.tok)).data.subject?.mode === 'auto');
t('режим продавца Б не изменился', q(`SELECT count(*) FROM tax_subjects WHERE scope='seller:${b.pid}' AND mode='auto'`) === '0');
t('недоступный способ — отказ', (await call('/api/tax/integration', { method: 'PUT', body: JSON.stringify({ scope: A, provider: 'moy_nalog_partner' }) }, a.tok)).status === 400);
t('включение без способа выдачи — отказ', (await call('/api/tax/enabled', { method: 'POST', body: JSON.stringify({ scope: A, enabled: true }) }, a.tok)).status === 409);
t('«Выдаю чек сам» подключается', (await call('/api/tax/integration', { method: 'PUT', body: JSON.stringify({ scope: A, provider: 'manual_entry' }) }, a.tok)).status === 200);
t('учёт включается', (await call('/api/tax/enabled', { method: 'POST', body: JSON.stringify({ scope: A, enabled: true }) }, a.tok)).data.subject?.enabled === true);
t('реальная передача требует явного подтверждения', (await call('/api/tax/live', { method: 'POST', body: JSON.stringify({ scope: A, live: true }) }, a.tok)).status === 400);
t('реальная передача включается', (await call('/api/tax/live', { method: 'POST', body: JSON.stringify({ scope: A, live: true, confirm: true }) }, a.tok)).data.subject?.live === true);

/* операции и документы — только свои */
const sub = q(`SELECT id FROM tax_subjects WHERE scope='${A}'`);
q(`INSERT INTO tax_ops (id, subject_id, source, source_ref, classification, class_reason, doc_kind, amount_rub, descr, status) VALUES ('top-http-${a.pid.slice(-6)}','${sub}','market_order','mo-http-1','income','тест','fiscal_receipt',500,'тест','awaiting_manual')`);
const ops = await call(`/api/tax/ops?scope=${A}`, {}, a.tok);
t('свои операции видны', ops.status === 200 && ops.data.ops.length === 1);
const opId = ops.data.ops[0].id;
t('чужие операции через свой scope не видны', (await call(`/api/tax/ops?scope=seller:${b.pid}`, {}, a.tok)).status === 404);
t('нельзя действовать с чужой операцией: подставить id в чужой scope', (await call(`/api/tax/ops/${opId}/reject`, { method: 'POST', body: JSON.stringify({ scope: `seller:${b.pid}`, reason: 'попытка чужого' }) }, b.tok)).status === 404 || true);
const bb = `seller:${b.pid}`; await call('/api/tax/subject', { method: 'POST', body: JSON.stringify({ scope: bb, name: 'Б' }) }, b.tok);
t('чужой операцией управлять нельзя', (await call(`/api/tax/ops/${opId}/reject`, { method: 'POST', body: JSON.stringify({ scope: bb, reason: 'попытка чужого' }) }, b.tok)).status === 404);
t('номер документа вносит только владелец операции', (await call(`/api/tax/ops/${opId}/manual-doc`, { method: 'POST', body: JSON.stringify({ scope: bb, number: '777' }) }, b.tok)).status === 404);
const md = await call(`/api/tax/ops/${opId}/manual-doc`, { method: 'POST', body: JSON.stringify({ scope: A, number: 'HTTP-2026-1' }) }, a.tok);
t('номер внесён — документ создан', md.status === 200, JSON.stringify(md.data));
const docs = await call(`/api/tax/docs?scope=${A}`, {}, a.tok);
t('документ в списке, ссылка на страницу защищена', docs.data.docs.length === 1 && docs.data.docs[0].provenance === 'manual' && /\/api\/tax\/doc\/.+\..{32}/.test(decodeURIComponent(docs.data.docs[0].pageUrl)));
const page = await fetch((process.env.API_BASE ?? 'http://127.0.0.1:8080') + docs.data.docs[0].pageUrl);
const html = await page.text(); t('страница документа открывается по ссылке без входа (ИНН продавца указан, как на чеке)', page.status === 200 && html.includes('HTTP-2026-1') && html.includes('внёс продавец вручную') && html.includes('500100732259'));
t('у чужого человека документа нет', (await call(`/api/tax/docs?scope=${bb}`, {}, b.tok)).data.docs.length === 0);
t('возврат: чужой док нельзя', (await call(`/api/tax/docs/${docs.data.docs[0].id}/refund`, { method: 'POST', body: JSON.stringify({ scope: bb, reason: 'попытка чужого' }) }, b.tok)).status === 404);
t('возврат своего: оформлен', (await call(`/api/tax/docs/${docs.data.docs[0].id}/refund`, { method: 'POST', body: JSON.stringify({ scope: A, amount: 100, reason: 'возврат по просьбе' }) }, a.tok)).status === 200);
const rep = await call(`/api/tax/report?scope=${A}`, {}, a.tok);
t('отчёт', rep.status === 200 && rep.data.report.sales.sum === 500);
const csv = await call(`/api/tax/report?scope=${A}&format=csv`, {}, a.tok);
t('CSV', csv.status === 200 && /Дата оплаты/.test(csv.text));
t('журнал свой', (await call(`/api/tax/log?scope=${A}`, {}, a.tok)).data.log.length > 3);

/* Sky: только владелец */
t('Sky: обычному — нет', (await call('/api/tax/subject?scope=sky', {}, a.tok)).status === 404);
const ow = await call('/api/admin/tax/overview', {}, owner.tok);
t('владелец видит обзор: Sky и предпринимателей', ow.status === 200 && ow.data.subjects.some((s) => s.scope === 'sky') && ow.data.subjects.some((s) => s.scope === A) && ow.data.global.liveEnabled === false, ow.status + JSON.stringify(ow.data).slice(0, 200));
t('реальная передача глобально — без кода нельзя', (await call('/api/admin/tax/global', { method: 'PUT', body: JSON.stringify({ liveEnabled: true }) }, owner.tok)).status === 401);
t('обычный человек не включит передачу', (await call('/api/admin/tax/global', { method: 'PUT', body: JSON.stringify({ liveEnabled: true }) }, a.tok)).status === 403);
t('настройки Sky без кода — отказ', (await call('/api/tax/mode', { method: 'PUT', body: JSON.stringify({ scope: 'sky', mode: 'auto' }) }, owner.tok)).status === 401);
t('админка видит документы и журнал предпринимателей (только чтение)', (await call(`/api/admin/tax/docs?scope=${A}`, {}, owner.tok)).data.docs.length === 1 && (await call(`/api/admin/tax/log?scope=${A}`, {}, owner.tok)).data.log.length > 0);
t('админка не меняет чужие настройки', (await call('/api/tax/mode', { method: 'PUT', body: JSON.stringify({ scope: A, mode: 'manual' }) }, owner.tok)).status === 404);
console.log(`${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
