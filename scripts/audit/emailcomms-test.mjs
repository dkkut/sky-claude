// Email-коммуникации (модуль напрямую). Запуск: DATABASE_URL=… REDIS_URL=… JWT_SECRET=… ENCRYPTION_KEY=… EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test node scripts/audit/emailcomms-test.mjs
process.chdir(new URL('../../server/', import.meta.url).pathname);
const ec = await import('../../server/emailcomms.mjs');
const tpl = await import('../../server/emailtpl.mjs');
const { query, pool } = await import('../../server/db.mjs');
let ok = 0, bad = 0; const t = (n, c, d = '') => { c ? ok++ : (bad++, console.log('FAIL', n, d)); };
const sfx = Date.now().toString(36);
const mk = async (tag, { email = true, verified = true } = {}) => {
  const sid = `sid-${tag}-${sfx}`, pid = `pf-${tag}-${sfx}`;
  await query(`INSERT INTO sky_ids (id, email, email_verified) VALUES ($1,$2,$3)`, [sid, email ? `${tag}-${sfx}@example.com` : null, verified]);
  await query(`INSERT INTO profiles (id, username, name, sky_id) VALUES ($1,$2,$3,$4)`, [pid, `u${tag}${sfx}`, `Имя <b>${tag}</b>`, sid]);
  return { sid, pid };
};
const drain = async () => { for (let i = 0; i < 40; i++) { await ec.processOutbox(); const r = await query(`SELECT count(*)::int n FROM email_outbox WHERE status IN ('pending','sending') AND next_attempt_at <= now() + interval '1 second'`); if (!r.rows[0].n) return; await new Promise((x) => setTimeout(x, 150)); } };
const A = await mk('a'); const B = await mk('b'); const C = await mk('c', { verified: false });
await query(`DELETE FROM email_outbox`); await query(`DELETE FROM email_settings`); settingsReset: await query(`SELECT 1`);
await ec.saveSettings('t', { timezone: 'Europe/Moscow' });

/* ── отрисовка ── */
const evil = '<script>alert(1)</script>"><img src=x onerror=1>';
const n = tpl.renderNewsletter({ title: evil, subtitle: evil, body: `Привет {username}\n\n• ${evil}`, cards: [{ title: evil, text: evil }], cta: { label: 'Go', url: 'javascript:alert(1)' }, imageUrl: 'http://x/y.png' }, { username: evil, appUrl: 'https://sky.test/', unsubUrl: 'https://sky.test/u', messageId: 'm1' });
t('рассылка: нет сырого <script>', !n.html.includes('<script') && !/onerror=1[^&]/.test(n.html.replace(/&quot;/g, '"')) && !n.html.includes('<img src=x'));
t('рассылка: javascript: ссылка не вставлена', !n.html.includes('javascript:'));
t('рассылка: http-картинка не вставлена', !n.html.includes('http://x/y.png'));
t('рассылка: есть футер и отписка', n.html.includes('Sky — твоя экосистема.') && n.html.includes('Отписаться') && n.text.includes('Отписаться'));
t('рассылка: есть текстовая версия', n.text.length > 40 && !/<(table|td|div|style)/.test(n.text));
const pr = tpl.renderPrime({ title: 'T', body: 'до {expiration_date} {nope} {days_remaining}', cta: { label: 'Продлить' } }, { username: 'X', subscription_name: 'Sky Prime', expiration_date: '1 января', days_remaining: '3 дня', renewal_amount: '399 ₽', renewal_link: 'https://sky.test/p' }, { appUrl: 'https://sky.test/', messageId: 'm2' });
t('Prime: переменные подставлены, чужие остаются', pr.html.includes('до 1 января') && pr.html.includes('{nope}'));
t('Prime: нет отписки (служебное)', !pr.html.includes('Отписаться') && pr.html.includes('служебное'));
const mn = tpl.renderMoney({ title: 'Баланс пополнен', body: 'b' }, { username: 'X', amount: '1 500', currency: '₽', transaction_id: 'SK-1', payment_method: 'СБП', commission: '0 ₽', total_amount: '1 500 ₽', transaction_date: 'д' }, { appUrl: 'https://sky.test/', messageId: 'm3', receiptUrl: 'https://sky.test/r', operationUrl: 'https://sky.test/o' });
t('Money: сумма, номер, кнопка', mn.html.includes('1 500') && mn.html.includes('SK-1') && mn.html.includes('Посмотреть операцию'));
t('Money: честно «не кассовый чек», без отписки', mn.html.includes('не кассовый чек') && !mn.html.includes('Отписаться'));
t('все письма на таблицах и с UTF-8', [n, pr, mn].every((x) => x.html.includes('<table') && x.html.includes('charset="utf-8"')));

/* ── токены ── */
const ut = ec.unsubToken(A.sid);
t('токен отписки проверяется', ec.verifyUnsubToken(ut) === A.sid);
t('подделанный токен отвергается', ec.verifyUnsubToken(ut.slice(0, -2) + 'zz') === null && ec.verifyUnsubToken('x') === null);

/* ── шаблоны ── */
const list = await ec.listTemplates();
t('шаблоны по умолчанию созданы (7)', list.length >= 7);
t('шаблон: плохая ссылка отклонена', (await ec.saveTemplate('t', 'newsletter_default', { content: { cta: { label: 'x', url: 'http://bad' } } })).error === 'bad_url');
t('шаблон: правка сохраняется', (await ec.saveTemplate('t', 'newsletter_default', { subject: 'Тема X' })).template.subject === 'Тема X');
t('предпросмотр рассылки', (await ec.preview({ templateKey: 'newsletter_default' })).html.includes('<table'));
t('предпросмотр денег помечен примером', (await ec.preview({ templateKey: 'money_topup' })).example === true);

/* ── адресная отправка: рассылка ── */
const m1 = await ec.manualSend('t', { kind: 'newsletter', profileIds: [A.pid, C.pid, 'nope'], content: { title: 'Привет', body: 'Текст' } });
t('адресная: A в очереди', m1.results[0].status === 'queued', JSON.stringify(m1));
t('адресная: без подтверждённой почты — ошибка', m1.results[1].reason === 'no_verified_email');
t('адресная: несуществующий — ошибка', m1.results[2].reason === 'not_found');
await drain();
let row = (await query(`SELECT * FROM email_outbox WHERE profile_id=$1`, [A.pid])).rows[0];
t('отправлено (режим log)', row?.status === 'sent', JSON.stringify(row));
t('в журнале только маска адреса', row.email_mask.includes('•') && !row.email_mask.includes(`a-${sfx}@`));
t('журнал: кто отправил', row.manual && row.created_by === 't');

/* ── отписка действует только на рекламные ── */
t('отписка записана', (await ec.unsubscribe(ut)).ok === true);
await ec.manualSend('t', { kind: 'newsletter', profileIds: [A.pid], content: { title: 'Ещё', body: 'x' } });
await drain();
row = (await query(`SELECT * FROM email_outbox WHERE profile_id=$1 ORDER BY created_at DESC LIMIT 1`, [A.pid])).rows[0];
t('после отписки рассылка пропущена', row.status === 'skipped' && row.last_error === 'unsubscribed', JSON.stringify(row));

/* ── Prime: актуальное состояние ── */
t('Prime без подписки отклонён', (await ec.manualSend('t', { kind: 'prime', templateKey: 'prime_3d', profileIds: [B.pid] })).results[0].reason === 'no_active_subscription');
const exp = new Date(Date.now() + 3 * 864e5);
await query(`INSERT INTO prime_subscriptions (id, profile_id, status, plan, expires_at) VALUES ($1,$2,'active','standard',$3)`, [`ps-${sfx}`, B.pid, exp]);
const pm = await ec.manualSend('t', { kind: 'prime', templateKey: 'prime_3d', profileIds: [B.pid] });
t('Prime с подпиской в очереди', pm.results[0].status === 'queued');
await drain();
row = (await query(`SELECT * FROM email_outbox WHERE profile_id=$1 AND kind='prime' ORDER BY created_at DESC LIMIT 1`, [B.pid])).rows[0];
t('Prime отправлено (письмо служебное — отписка не мешает)', row.status === 'sent', JSON.stringify(row));
// автоматика: выключена по умолчанию
t('автоматика Prime выключена по умолчанию', (await ec.sweepPrime()) === 0);
await ec.saveSettings('t', { primeAuto: true });
t('daysLeft: корзины', ec.primeBucket(7) === 7 && ec.primeBucket(4) === 7 && ec.primeBucket(3) === 3 && ec.primeBucket(2) === 3 && ec.primeBucket(1) === 1 && ec.primeBucket(0) === 0 && ec.primeBucket(8) === null && ec.primeBucket(-1) === null);
const q1 = await ec.sweepPrime(); const q2 = await ec.sweepPrime();
t('автоматика Prime ставит письмо и не дублирует', q1 >= 1 && q2 === 0, `${q1}/${q2}`);
// подписка продлена до отправки → письмо устарело и пропускается
await query(`DELETE FROM email_outbox WHERE profile_id=$1`, [B.pid]);
await ec.sweepPrime();
await query(`UPDATE prime_subscriptions SET expires_at = now() + interval '40 days' WHERE profile_id=$1`, [B.pid]);
await drain();
row = (await query(`SELECT * FROM email_outbox WHERE profile_id=$1 AND kind='prime' ORDER BY created_at DESC LIMIT 1`, [B.pid])).rows[0];
t('устаревшее напоминание не уходит', row.status === 'skipped', JSON.stringify(row));
// бессрочная подписка — не уведомляем
await query(`UPDATE prime_subscriptions SET expires_at = NULL WHERE profile_id=$1`, [B.pid]);
t('бессрочная: ручная отправка отклонена', (await ec.manualSend('t', { kind: 'prime', templateKey: 'prime_3d', profileIds: [B.pid] })).results[0].reason === 'lifetime');

/* ── SkyMoney: только реальный зачисленный платёж ── */
t('деньги: выдуманный платёж отклонён', (await ec.manualSend('t', { kind: 'money', profileIds: [B.pid], paymentId: 'fake' })).results[0].reason === 'payment_not_credited');
const pid = `pay-${sfx}`;
await query(`INSERT INTO skykassa_payments (id, number, user_id, amount, fee, total, destination, status, method_title, expires_at, credited_at) VALUES ($1,$2,$3,1500,0,1500,'balance','completed','СБП', now()+interval '1 day', now())`, [pid, `SK-T${sfx}`.slice(0, 14).toUpperCase(), B.pid]);
t('деньги: платёж без записи о зачислении отклонён', (await ec.manualSend('t', { kind: 'money', profileIds: [B.pid], paymentId: pid })).results[0].reason === 'payment_not_credited');
await query(`INSERT INTO skykassa_credits (payment_id, user_id, amount, destination, wallet_ref) VALUES ($1,$2,1500,'balance','x')`, [pid, B.pid]);
t('деньги: чужой платёж отклонён', (await ec.manualSend('t', { kind: 'money', profileIds: [A.pid], paymentId: pid })).results[0].reason === 'payment_not_credited');
const mr = await ec.manualSend('t', { kind: 'money', profileIds: [B.pid], paymentId: pid });
t('деньги: реальное зачисление в очереди', mr.results[0].status === 'queued', JSON.stringify(mr));
t('деньги: несколько получателей запрещены', (await ec.manualSend('t', { kind: 'money', profileIds: [A.pid, B.pid], paymentId: pid })).error === 'money_single_recipient');
await drain();
row = (await query(`SELECT * FROM email_outbox WHERE kind='money' AND profile_id=$1 ORDER BY created_at DESC LIMIT 1`, [B.pid])).rows[0];
t('деньги отправлено', row.status === 'sent', JSON.stringify(row));
const rd = await ec.receiptData(`${pid}.${ec.receiptToken(pid).split('.').pop()}`);
t('квитанция по токену из реальных данных', rd && rd.amount.replace(/\s/g, '').includes('1500') && rd.number.startsWith('SK-'));
t('квитанция: подделанный токен', (await ec.receiptData(`${pid}.deadbeef`)) === null);
// автоматика денег
await ec.saveSettings('t', { moneyAuto: true });
const pid2 = `pay2-${sfx}`;
await query(`INSERT INTO skykassa_payments (id, number, user_id, amount, fee, total, destination, status, method_title, expires_at, credited_at) VALUES ($1,$2,$3,700,0,700,'balance','completed','СБП', now()+interval '1 day', now())`, [pid2, `SK-U${sfx}`.slice(0, 14).toUpperCase(), B.pid]);
await query(`INSERT INTO skykassa_credits (payment_id, user_id, amount, destination, wallet_ref) VALUES ($1,$2,700,'balance','x')`, [pid2, B.pid]);
const s1 = await ec.sweepMoney(); const s2 = await ec.sweepMoney();
t('автоматика денег: только после включения, без дублей', s1 === 1 && s2 === 0, `${s1}/${s2}`);

/* ── повторы при сбое ── */
const { config } = await import('../../server/config.mjs');
const oldMode = config.emailMode; config.emailMode = 'nonexistent';
const f = await ec.enqueue({ kind: 'newsletter', templateKey: 'newsletter_default', profileId: B.pid, payload: { content: { title: 'x', body: 'y' } }, dedupeKey: `retry-${sfx}` });
await drain();
row = (await query(`SELECT * FROM email_outbox WHERE id=$1`, [f.id])).rows[0];
t('нет провайдера: письмо в failed с причиной', row.status === 'failed' && row.last_error === 'email_not_configured', JSON.stringify(row));
config.emailMode = oldMode;

/* ── рассылка по аудитории и расписание ── */
const camp = await ec.saveCampaign('t', null, { name: 'К', subject: 'Тема', content: { title: 'Заголовок', body: 'Текст' }, audience: { mode: 'list', ids: [B.pid, C.pid, A.pid] } });
t('аудитория: без неподтверждённых и отписавшихся', (await ec.audienceCount({ mode: 'list', ids: [B.pid, C.pid, A.pid] })) === 1);
t('кампания: черновик без темы нельзя запланировать', (await ec.scheduleCampaign((await ec.saveCampaign('t', null, { name: 'x', content: {} })).id)).error === 'incomplete');
t('кампания запланирована', (await ec.scheduleCampaign(camp.id, new Date(Date.now() - 1000).toISOString())).ok === true);
await ec.tickCampaigns(); await drain(); await ec.tickCampaigns();
const cs = await ec.getCampaign(camp.id);
t('кампания разослана и завершена', cs.status === 'sent' && cs.total === 1, JSON.stringify(cs));
t('повторный запуск не дублирует', (await query(`SELECT count(*)::int n FROM email_outbox WHERE campaign_id=$1`, [camp.id])).rows[0].n === 1);

/* ── журнал, статистика, ОФД ── */
t('журнал отдаёт записи', (await ec.journal({ kind: 'money' })).length >= 1);
t('поиск пользователя по нику', (await ec.searchUsers(`ub${sfx}`)).some((x) => x.id === B.pid));
t('поиск не раскрывает адрес целиком', JSON.stringify(await ec.searchUsers(`ub${sfx}`)).includes(`b-${sfx}@`) === false);
t('статистика', (await ec.stats()).rows.length >= 1);
const ofd = await ec.ofdSummary({});
t('ОФД: платежи сегодня', ofd.entries.some((e) => e.ref.startsWith('SK-')) && ofd.topupSum >= 2200, JSON.stringify({ s: ofd.topupSum }));
t('ОФД: чеков отправлено', ofd.receiptsSent >= 1);
t('ОФД: налог считается от базы', ofd.tax === Math.round(ofd.taxBase * ofd.taxRatePct) / 100);
await query(`DELETE FROM skykassa_credits WHERE payment_id IN ($1,$2)`, [pid, pid2]); await query(`DELETE FROM skykassa_payments WHERE id IN ($1,$2)`, [pid, pid2]);
console.log(`emailcomms: ${ok} ok, ${bad} bad`); await pool.end(); process.exit(bad ? 1 : 0);
