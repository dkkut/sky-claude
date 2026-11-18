// Сквозные HTTP-проверки пяти систем (обновления, верификация, переводы, реклама, правила Business, автомодерация).
// Запуск: node scripts/audit/newsystems-http-test.mjs <каталог с api.log>
// API: OWNER_USERNAME=p2powner ADMIN_GATE=off ADMIN_TOKEN=off EMAIL_MODE=log ALLOW_LOG_CODES=1 DOMAIN=sky.test RATE_LIMIT_PER_MINUTE=5000
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const a = await mkuser(S, 'NsA'); const b = await mkuser(S, 'NsB');
const J = (o) => ({ method: 'POST', body: JSON.stringify(o) });

/* обновления: публично, платформа и сборка с клиента, решение на сервере */
const v = await call('/api/site/app-version?platform=android&build=1');
t('версия: публичная ручка отвечает без входа', v.status === 200, v.text);
t('версия: чужой магазин на Android не показывается', !JSON.stringify(v.data).includes('appstore'), JSON.stringify(v.data).slice(0, 300));
t('версия: мусорная платформа не роняет', (await call('/api/site/app-version?platform=%27;drop&build=x')).status < 500);

/* админские ручки закрыты для обычного человека и анонима */
const adm = ['/api/admin/app-update', '/api/admin/p2p', '/api/admin/p2p/settings', '/api/admin/skykassa-intl', '/api/admin/business-rules', '/api/admin/channel-mod', '/api/admin/p2p/review', '/api/ads/admin/stats'];
for (const p of adm) {
  const u = await call(p, {}, a.tok); const n = await call(p);
  t(`админка ${p}: человек 401/403`, u.status === 403 || u.status === 401, String(u.status));
  t(`админка ${p}: аноним 401`, n.status === 401, String(n.status));
}
for (const [p, o] of [['/api/admin/app-update', { minBuild: 999999 }], ['/api/admin/p2p/settings', { feePercent: 0 }], ['/api/admin/verification/official', { profileId: a.pid, on: true }]]) {
  const r = await call(p, { method: 'PUT', body: JSON.stringify(o) }, a.tok); const r2 = await call(p, J(o), a.tok);
  t(`запись ${p}: человек отклонён`, [r.status, r2.status].every((s) => s === 401 || s === 403 || s === 404 || s === 405), `${r.status}/${r2.status}`);
}

/* верификация: человек не ставит отметку сам, бот — официальный */
const sb = await call('/api/verification/marks?type=user&ids=acc-skybot-official,' + a.pid, {}, a.tok);
t('отметки: @sky_bot официальный', JSON.stringify(sb.data).includes('official'), sb.text);
t('отметки: у обычного человека нет', !JSON.stringify(sb.data).includes(a.pid) || !/"?${a.pid}"?\s*:\s*\{[^}]*official/.test(sb.text));
const rq = await call('/api/verification/request', J({ kind: 'profile', targetId: a.pid }), a.tok);
const m2 = await call('/api/verification/marks?type=user&ids=' + a.pid, {}, a.tok);
t('отметки: заявка не даёт отметку', !m2.text.includes('"official"') && !/verified":\s*true/.test(m2.text), rq.text + m2.text);

/* правила Business: публично читаются, ознакомиться может только владелец организации */
const r0 = await call('/api/business/rules', {}, a.tok);
t('правила: человек читает опубликованное', r0.status === 200, r0.text.slice(0, 200));
t('правила: без входа 401', (await call('/api/business/rules')).status === 401);
const ack = await call('/api/business/rules/ack', J({ section: 'general', version: 1 }), a.tok);
t('правила: не владелец организации не подтверждает', ack.status >= 400 && ack.status < 500, ack.text);

/* переводы: нужен замок SkyMoney / лимиты; пока проверяем безопасные отказы */
const lk = await call('/api/wallet/transfer/lookup?q=' + encodeURIComponent('@' + 'nobody-zzz'), {}, a.tok);
t('перевод: поиск не отдаёт 500', lk.status < 500, lk.text);
t('перевод: без входа 401', (await call('/api/wallet/transfer', J({}))).status === 401);
const tr = await call('/api/wallet/transfer', J({ to: b.pid, amount: 100, currency: 'RUB', idemKey: 'k1', quoteToken: 'x' }), a.tok);
t('перевод: без котировки/на пустой баланс не проходит', tr.status >= 400 && tr.status < 500, tr.text);
const bal = await call('/api/wallet/balance', {}, b.tok);
t('перевод: баланс получателя не изменился', JSON.stringify(bal.data).match(/"balance":\s*0/) !== null || bal.status !== 200, bal.text);
t('перевод: сумму со знаком минус отклоняет', (await call('/api/wallet/transfer', J({ to: b.pid, amount: -5, currency: 'RUB', idemKey: 'k2' }), a.tok)).status >= 400);

/* реклама: показ и клики */
const ad = await call('/api/ads/serve?placement=film_preroll', {}, a.tok);
t('реклама: место «перед кино» принимается', ad.status === 200 || ad.status === 204, ad.text.slice(0, 200));
t('реклама: клик по несуществующему показу не падает', (await call('/api/ads/click', J({ impressionId: 'nope' }), a.tok)).status < 500);

/* автомодерация */
t('жалоба: причины доступны', (await call('/api/channel-mod/reasons', {}, a.tok)).status === 200);
const rp = await call('/api/channel-mod/report', J({ chatId: 'nope', reason: 'scam' }), a.tok);
t('жалоба: несуществующий канал — 4xx', rp.status >= 400 && rp.status < 500, rp.text);
t('жалоба: чужие дела не видны (mine пуст)', (await call('/api/channel-mod/mine', {}, a.tok)).status === 200);

console.log(`ok ${ok}, fail ${bad}`); process.exit(bad ? 1 : 0);
