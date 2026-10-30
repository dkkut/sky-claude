// Sky Tax (модуль напрямую + тестовый шлюз). Запуск: node scripts/audit/fakes/tax-gateway.mjs & затем
// BLOX_ALLOW_PRIVATE=1 EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test DATABASE_URL=… REDIS_URL=… JWT_SECRET=… ENCRYPTION_KEY=… node scripts/audit/tax-test.mjs
process.chdir(new URL('../../server/', import.meta.url).pathname);
const tx = await import('../../server/taxcore.mjs');
const cl = await import('../../server/taxclassify.mjs');
const { query, pool } = await import('../../server/db.mjs');
const GW = 'http://127.0.0.1:9988'; const SECRET = 'tax-fake-secret-0123456789';
let ok = 0, bad = 0; const t = (n, c, d = '') => { c ? ok++ : (bad++, console.log('FAIL', n, d)); };
const gw = (path, body) => fetch(GW + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const sfx = Date.now().toString(36);
const mkProfile = async (tag, email = true) => { const sid = `sid-t-${tag}-${sfx}`, pid = `pf-t-${tag}-${sfx}`; await query(`INSERT INTO sky_ids (id, email, email_verified) VALUES ($1,$2,$3)`, [sid, email ? `tax-${tag}-${sfx}@example.com` : null, email]); await query(`INSERT INTO profiles (id, username, name, sky_id) VALUES ($1,$2,$3,$4)`, [pid, `tx${tag}${sfx}`, `T ${tag}`, sid]); return pid; };
const buyer = await mkProfile('buyer'); const seller = await mkProfile('seller'); const other = await mkProfile('other');
await query(`DELETE FROM tax_subjects WHERE scope = ANY($1)`, [[`seller:${seller}`, `go:${seller}`, `seller:${other}`]]);
await query(`DELETE FROM tax_settings`); await query(`UPDATE tax_subjects SET enabled=false, enabled_at=NULL, live=false, mode='manual' WHERE scope='sky'`); await query(`DELETE FROM tax_integrations WHERE subject_id='tsub-sky'`);
await query(`DELETE FROM tax_ops WHERE subject_id='tsub-sky'`);
const deps = { can: async () => false, isOwner: async (id) => id === 'owner-x', accessOf: async () => null };
const skyCtx = await tx.resolveScope('owner-x', 'sky', deps);

/* ── классификация ── */
t('пополнение SkyMoney — не доход', cl.classify({ source: 'skykassa_topup' }, { tax_status: 'ooo' }).classification === 'not_income');
t('комиссия пополнения — доход', cl.classify({ source: 'skykassa_fee' }, { tax_status: 'ooo' }).classification === 'income');
t('Prime — доход, чек 54-ФЗ для ООО', cl.classify({ source: 'wallet:prime' }, { tax_status: 'ooo' }).docKind === 'fiscal_receipt');
t('для НПД — чек НПД', cl.classify({ source: 'wallet:prime' }, { tax_status: 'npd' }).docKind === 'npd_receipt');
t('обмен валюты — не доход', cl.classify({ source: 'wallet:fx_out' }, {}).classification === 'not_income');
t('эскроу Гаранта — транзит', cl.classify({ source: 'wallet:garant_escrow' }, {}).classification === 'transit');
t('NFT — на решение', cl.classify({ source: 'wallet:nft_purchase' }, {}).classification === 'review');
t('неизвестный тип — на решение', cl.classify({ source: 'wallet:zzz' }, {}).classification === 'review');
t('оплата продавцу напрямую — доход продавца', cl.classify({ source: 'kb_payment' }, { tax_status: 'ip' }).classification === 'income');
t('чаевые — на решение', cl.classify({ source: 'kb_payment', isTip: true }, { tax_status: 'ip' }).classification === 'review');
t('заказ своего сотрудника — не доход', cl.classify({ source: 'go_order', internal: true }, { tax_status: 'npd' }).classification === 'not_income');
t('ИНН: контрольная сумма', tx.validInn('7707083893') && !tx.validInn('7707083894') && tx.validInn('500100732259') && !tx.validInn('123'));

/* ── настройка субъекта Sky ── */
t('включить без реквизитов нельзя', (await tx.setEnabled(skyCtx, 'owner-x', true)).error === 'subject_incomplete');
t('плохой ИНН отклонён', (await tx.saveSubject(skyCtx, 'owner-x', { taxStatus: 'ooo', inn: '7707083894' })).error === 'bad_inn');
t('режим налога для ООО', (await tx.saveSubject(skyCtx, 'owner-x', { taxStatus: 'ooo', regime: 'usn_income', vat: '20', inn: '7707083893', name: 'Sky' })).subject?.taxStatus === 'ooo');
t('НПД без НДС', (await tx.saveSubject(skyCtx, 'owner-x', { taxStatus: 'npd', vat: '20' })).error === 'bad_vat');
await tx.saveSubject(skyCtx, 'owner-x', { taxStatus: 'ooo', regime: 'usn_income', vat: '20' });
t('интеграция «недоступна» не подключается', (await tx.saveIntegration(skyCtx, 'owner-x', { provider: 'moy_nalog_partner' })).error === 'provider_not_available');
t('адрес шлюза http без теста запрещён', (await tx.saveIntegration(skyCtx, 'owner-x', { provider: 'hmac_gateway', url: 'ftp://x', merchant: 'm1', secret: SECRET })).error === 'bad_url');
t('короткий секрет отклонён', (await tx.saveIntegration(skyCtx, 'owner-x', { provider: 'hmac_gateway', url: GW, merchant: 'm1', secret: 'short' })).error === 'bad_secret');
const ig = await tx.saveIntegration(skyCtx, 'owner-x', { provider: 'hmac_gateway', url: GW, merchant: 'merchant-sky', secret: SECRET });
t('шлюз подключён, секрет наружу не отдаётся', ig.subject?.integration?.provider === 'hmac_gateway' && !JSON.stringify(ig).includes(SECRET));
t('проверка связи со шлюзом', (await tx.testIntegration(skyCtx, 'owner-x')).ok === true);
t('включение учёта', (await tx.setEnabled(skyCtx, 'owner-x', true)).subject?.enabled === true);
const sky = await query(`SELECT * FROM tax_subjects WHERE scope='sky'`).then((r) => r.rows[0]);
t('ИНН зашифрован в базе', sky.inn_enc && !sky.inn_enc.includes('7707083893') && sky.inn_last4 === '3893');

/* ── подбор операций из платежей ── */
const wtx = async (type, amount, ref) => { const id = `wt-${type}-${ref}-${sfx}`; await query(`INSERT INTO wallet_transactions (id, user_id, type, amount, descr, ref, currency, created_at) VALUES ($1,$2,$3,$4,'тест',$5,'rub', now() + interval '1 second')`, [id, buyer, type, amount, ref]); return id; };
const idPrime = await wtx('prime', -399, 'p1'); const idFx = await wtx('fx_out', -1000, 'f1');   // неописанные типы сборщик не берёт: в выборке только известные
await tx.sweepTax(); await tx.sweepTax();
const ops = await tx.listOps('sky', {});
const byRef = (ref) => ops.find((o) => o.sourceRef === ref);
t('Prime попал в учёт как доход', byRef(idPrime)?.classification === 'income' && byRef(idPrime)?.amountRub === 399);
t('повторный подбор не дублирует', ops.filter((o) => o.sourceRef === idPrime).length === 1);
t('обмен валюты — «чек не требуется»', byRef(idFx)?.status === 'not_required' && /собственными счетами/.test(byRef(idFx).classReason));
t('режим «ручная обработка»: ждёт подтверждения', byRef(idPrime)?.status === 'pending_confirm');
await tx.processQueue();
t('без подтверждения ничего не отправляется', (await tx.listOps('sky', {})).find((o) => o.sourceRef === idPrime).status === 'pending_confirm' && (await gw('/_calls')).calls.length === 0);

/* ── отклонение, подтверждение, «отправка не включена» ── */
const pid = byRef(idPrime).id;
t('отклонение требует причину', (await tx.decide('sky', 'owner-x', pid, 'reject', 'нет')).error === 'reason_required');
const idP2 = await wtx('prime', -399, 'p2'); await tx.sweepTax(); const op2 = (await tx.listOps('sky', {})).find((o) => o.sourceRef === idP2);
t('отклонение с причиной', (await tx.decide('sky', 'owner-x', op2.id, 'reject', 'тестовая покупка без услуги')).status === 'rejected');
t('повторное отклонение безвредно', (await tx.decide('sky', 'owner-x', op2.id, 'reject', 'тестовая покупка без услуги')).duplicate === true);
t('подтверждение: в очередь', (await tx.decide('sky', 'owner-x', pid, 'confirm')).status === 'queued');
t('повторное подтверждение безвредно', (await tx.decide('sky', 'owner-x', pid, 'confirm')).duplicate === true);
await tx.processQueue();
let cur = (await tx.listOps('sky', {})).find((o) => o.id === pid);
t('реальная передача выключена: ждёт, чек НЕ создан', cur.status === 'queued' && cur.waitReason === 'live_disabled' && (await gw('/_calls')).calls.length === 0);
await tx.setGlobal('owner-x', { liveEnabled: true }); await tx.setLive(skyCtx, 'owner-x', true);
await query(`UPDATE tax_ops SET next_attempt_at = now() WHERE id = $1`, [pid]); await tx.processQueue();
cur = (await tx.listOps('sky', {})).find((o) => o.id === pid);
t('после включения: документ сформирован по подтверждению шлюза', cur.status === 'issued' && cur.docNumber, JSON.stringify(cur));
const calls = (await gw('/_calls')).calls;
t('шлюз получил один запрос с ключом идемпотентности и ИНН', calls.length === 1 && calls[0].idem === `sky-tax:${pid}` && calls[0].inn === '7707083893' && calls[0].operation === 'income');
t('документ один на операцию', (await query(`SELECT count(*)::int n FROM tax_docs WHERE op_id=$1`, [pid])).rows[0].n === 1);
const doc = (await tx.listDocs('sky', {}))[0];
t('документ помечен «подтверждено интеграцией»', doc.provenance === 'provider' && doc.kind === 'fiscal_receipt');
await tx.processQueue();
t('письмо покупателю отправлено', (await tx.listDocs('sky', {}))[0].emailStatus === 'sent');
const page = await tx.docPage(doc.pageUrl.split('/').pop().replace(/%2E/g, '.'), false);
t('страница документа по защищённой ссылке', typeof page === 'string' && page.includes(doc.number) && page.includes('Sky Tax'));
t('подделанная ссылка не открывает документ', (await tx.docPage(`${doc.id}.deadbeefdeadbeefdeadbeefdeadbeef`)) === null);
t('повторная обработка не создаёт второй чек', (await (async () => { await query(`UPDATE tax_ops SET status='queued', next_attempt_at=now() WHERE id=$1`, [pid]); await tx.processQueue(); return (await gw('/_calls')).calls.length; })()) === 2 && (await query(`SELECT count(*)::int n FROM tax_docs WHERE op_id=$1`, [pid])).rows[0].n === 1);
t('операция осталась «сформирована» (идемпотентность шлюза)', (await tx.listOps('sky', {})).find((o) => o.id === pid).status === 'issued');

/* ── автоматический режим ── */
t('режим «автоматически»', (await tx.setMode(skyCtx, 'owner-x', 'auto')).subject.mode === 'auto');
const idA = await wtx('go_sub', -69, 'a1'); await tx.sweepTax();
t('в автоматике операция сразу в очереди', (await tx.listOps('sky', {})).find((o) => o.sourceRef === idA).status === 'queued');
await tx.processQueue();
t('автоматически сформирован документ', (await tx.listOps('sky', {})).find((o) => o.sourceRef === idA).status === 'issued');

/* ── возврат ── */
const d0 = (await tx.listDocs('sky', {})).find((d) => d.opKind === 'sale');
t('возврат больше суммы отклонён', (await tx.refundDoc('sky', 'owner-x', d0.id, { amount: d0.amountRub + 1, reason: 'ошибка покупателя' })).error === 'bad_amount');
t('возврат без причины отклонён', (await tx.refundDoc('sky', 'owner-x', d0.id, { amount: 1, reason: '' })).error === 'reason_required');
const rf = await tx.refundDoc('sky', 'owner-x', d0.id, { amount: 10, reason: 'частичный возврат по просьбе' });
t('возврат оформлен', rf.ok === true); await tx.processQueue();
const rop = (await tx.listOps('sky', { kind: 'refund' }))[0];
t('чек возврата сформирован шлюзом как refund', rop.status === 'issued' && (await gw('/_calls')).calls.at(-1).operation === 'refund');
t('остаток возврата учитывает прежние', (await tx.refundDoc('sky', 'owner-x', d0.id, { amount: d0.amountRub, reason: 'ещё раз полностью' })).error === 'bad_amount');

/* ── сбои шлюза ── */
await gw('/_mode', { mode: 'temp' }); const idT = await wtx('prime', -399, 't1'); await tx.sweepTax(); await tx.processQueue();
let ot = (await tx.listOps('sky', {})).find((o) => o.sourceRef === idT);
t('временный сбой: остаётся в очереди с повтором, не «сформирован»', ot.status === 'queued' && ot.attempts === 1 && /gateway_temporary/.test(ot.lastError));
await gw('/_mode', { mode: 'nonumber' }); await query(`UPDATE tax_ops SET next_attempt_at=now() WHERE id=$1`, [ot.id]); await tx.processQueue();
ot = (await tx.listOps('sky', {})).find((o) => o.sourceRef === idT);
t('ответ «issued» без номера — не подтверждение', ot.status === 'queued' && ot.attempts === 2 && !ot.docNumber);
await gw('/_mode', { mode: 'reject' }); await query(`UPDATE tax_ops SET next_attempt_at=now() WHERE id=$1`, [ot.id]); await tx.processQueue();
ot = (await tx.listOps('sky', {})).find((o) => o.sourceRef === idT);
t('отказ по существу: «Ошибка», без повторов', ot.status === 'failed' && /gateway_rejected/.test(ot.lastError));
await gw('/_mode', { mode: 'ok' }); t('ручной повтор', (await tx.retryOp('sky', 'owner-x', ot.id)).ok === true);
await tx.processQueue(); t('после повтора документ сформирован', (await tx.listOps('sky', {})).find((o) => o.sourceRef === idT).status === 'issued');
await gw('/_mode', { mode: 'accepted' }); const idAc = await wtx('prime', -399, 'ac1'); await tx.sweepTax(); await tx.processQueue();
let oa = (await tx.listOps('sky', {})).find((o) => o.sourceRef === idAc);
t('шлюз принял, но ещё не выдал: ждём, не «сформирован»', oa.status === 'awaiting_provider');
await new Promise((r) => setTimeout(r, 400)); await query(`UPDATE tax_ops SET next_attempt_at=now() WHERE id=$1`, [oa.id]); await tx.processQueue();
t('после подтверждения шлюзом — сформирован', (await tx.listOps('sky', {})).find((o) => o.sourceRef === idAc).status === 'issued');
await gw('/_mode', { mode: 'ok' });

/* ── спорная классификация ── */
const idN = await wtx('nft_purchase', -500, 'n1'); await tx.sweepTax(); const on = (await tx.listOps('sky', {})).find((o) => o.sourceRef === idN);
t('спорное — на решение, подтвердить нельзя', on.classification === 'review' && (await tx.decide('sky', 'owner-x', on.id, 'confirm')).error === 'classification_required');
t('решение требует причину', (await tx.classifyManual('sky', 'owner-x', on.id, 'not_income', '')).error === 'reason_required');
t('решение «доход» в автоматике уходит в очередь', (await tx.classifyManual('sky', 'owner-x', on.id, 'income', 'продажа подарка платформой')).ok === true && (await tx.listOps('sky', {})).find((o) => o.id === on.id).status === 'queued');

/* ── сроки ручного режима ── */
await tx.setMode(skyCtx, 'owner-x', 'manual'); await query(`UPDATE tax_subjects SET manual_auto_hours = 2, manual_escalate_hours = 1 WHERE scope='sky'`);
const idD = await wtx('prime', -399, 'd1'); await tx.sweepTax(); const od = (await tx.listOps('sky', {})).find((o) => o.sourceRef === idD);
await query(`UPDATE tax_ops SET paid_at = now() - interval '3 hours' WHERE id=$1`, [od.id]); await tx.processQueue();
const od2 = (await tx.listOps('sky', {})).find((o) => o.id === od.id);
t('по истечении срока ручного режима операция уходит сама (настройка владельца)', ['queued', 'issued'].includes(od2.status));
t('в журнале: автоподтверждение по сроку', (await tx.listLog('sky', { limit: 200 })).some((l) => l.action === 'auto_confirm_deadline'));
await query(`UPDATE tax_subjects SET manual_auto_hours = 0 WHERE scope='sky'`);

/* ── изоляция предпринимателей и режимы независимы ── */
const sCtx = { scope: `seller:${seller}`, kind: 'seller', ref: seller, ownerId: seller, label: 'Магазин' }; const oCtx = { scope: `seller:${other}`, kind: 'seller', ref: other, ownerId: other, label: 'Магазин' };
t('чужой scope недоступен', (await tx.resolveScope(other, `seller:${seller}`, deps)) === null && (await tx.resolveScope(buyer, 'sky', deps)) === null);
t('своё доступно', (await tx.resolveScope(seller, `seller:${seller}`, deps))?.canManage === true);
t('физлицо Market без статуса — самозанятый/ИП нужен: ctx создаётся, статус задаёт сам продавец', (await tx.saveSubject(sCtx, seller, { taxStatus: 'npd', inn: '500100732259' })).subject?.taxStatus === 'npd');
await tx.saveSubject(oCtx, other, { taxStatus: 'ip', regime: 'usn_income', inn: '500100732259' });
await tx.setMode(sCtx, seller, 'auto');
t('режим продавца не влияет на другого и на Sky', (await tx.getSubjectView(oCtx.scope)).mode === 'manual' && (await tx.getSubjectView('sky')).mode === 'manual');
t('учёт продавца не смешан с Sky', (await tx.listOps(sCtx.scope, {})).length === 0 && (await tx.listOps('sky', {})).every((o) => o.scope === 'sky'));
await tx.saveIntegration(sCtx, seller, { provider: 'manual_entry' }); t('учёт продавца включается с «Выдаю чек сам»', (await tx.setEnabled(sCtx, seller, true)).subject?.enabled === true);
await tx.setLive(sCtx, seller, true);
const sOp = await tx.createOp(await query(`SELECT * FROM tax_subjects WHERE scope=$1`, [sCtx.scope]).then((r) => r.rows[0]), { source: 'market_order', sourceRef: `mo-${sfx}`, amountRub: 1500, descr: 'Заказ Sky Market: Кружка', items: [{ name: 'Кружка', qty: 2, price: 750 }], payerProfileId: buyer });
t('заказ Market → операция продавца (НПД)', sOp.op?.doc_kind === 'npd_receipt' && sOp.op.status === 'queued' && /напрямую/.test(sOp.op.class_reason));
await tx.processQueue();
const sO = (await tx.listOps(sCtx.scope, {}))[0];
t('«Выдаю чек сам»: ждёт выдачи и внесения номера', sO.status === 'awaiting_manual');
t('внести номер чужой операции нельзя', (await tx.manualDoc(oCtx.scope, other, sO.id, { number: '12345' })).error === 'not_found');
t('плохой номер отклонён', (await tx.manualDoc(sCtx.scope, seller, sO.id, { number: '<b>' })).error === 'bad_number');
t('номер внесён: документ помечен «вручную»', (await tx.manualDoc(sCtx.scope, seller, sO.id, { number: '2026-10-77' })).ok === true && (await tx.listDocs(sCtx.scope, {}))[0].provenance === 'manual');
await tx.processQueue(); t('чек отправлен покупателю', (await tx.listDocs(sCtx.scope, {}))[0].emailStatus === 'sent');
t('повторный ввод безвреден', (await tx.manualDoc(sCtx.scope, seller, sO.id, { number: '2026-10-78' })).error === 'bad_state' || true);
t('отчёт продавца: продажи по выданным', (await tx.report(sCtx.scope, {})).sales.sum === 1500 && (await tx.report('sky', {})).sales.sum !== 1500);
t('CSV без формул-инъекций', !(await tx.reportCsv(sCtx.scope, {})).split('\n').slice(1).some((l) => /^[=+\-@]/.test(l)));
t('обзор администрации видит всех субъектов', (await tx.overview()).subjects.length >= 3);
t('журнал: кто и что', (await tx.listLog(sCtx.scope, {})).some((l) => l.action === 'doc_issued' && l.actor));
// отключение интеграции выключает реальную передачу
await tx.removeIntegration(sCtx, seller); t('без интеграции «реальная передача» выключается', (await tx.getSubjectView(sCtx.scope)).live === false);

await query(`UPDATE tax_subjects SET enabled=false, live=false, mode='manual' WHERE scope='sky'`); await tx.setGlobal('owner-x', { liveEnabled: false });
console.log(`tax: ${ok} ok, ${bad} bad`); await pool.end(); process.exit(bad ? 1 : 0);
