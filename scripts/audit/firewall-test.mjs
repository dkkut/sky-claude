// Файрвол (server/firewall.mjs): уровни, пределы, блокировки, автоэскалация и снижение, настройки, журнал. Модуль вызывается напрямую — API не нужен.
// Запуск: DATABASE_URL=… REDIS_URL=… JWT_SECRET=… REFRESH_TOKEN_SECRET=… ENCRYPTION_KEY=… node scripts/audit/firewall-test.mjs
const fw = await import('../../server/firewall.mjs');
const { query, pool } = await import('../../server/db.mjs');
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const req = (ip, url = '/api/some/thing', method = 'GET') => ({ url, method, headers: { 'x-real-ip': ip }, socket: { remoteAddress: '127.0.0.1' } });
const burst = (ip, n, authed, url) => { let last = null, limited = 0, statuses = {}; for (let i = 0; i < n; i++) { last = fw.gate(req(ip, url), authed); if (last) { limited++; statuses[last.status] = (statuses[last.status] ?? 0) + 1; } } return { last, limited, statuses }; };

await query("DELETE FROM defense_ip_blocks WHERE reason LIKE 'авто:%' OR reason LIKE 'вручную:%'");
await query("UPDATE firewall_state SET level = 0, pinned_until = NULL, set_by = NULL, cf_prev = NULL WHERE id");
await query("UPDATE firewall_settings SET data = '{}'::jsonb WHERE id");
await fw.getSettings(); await fw.firewallTick(); fw._reset();

t('уровень 0: ничего не ограничивается', burst('198.51.100.1', 500, false).limited === 0);

await fw.setLevel(1, { by: 'x', hours: 1, reason: 'тест' });
t('уровень 1 принят', fw.currentLevel() === 1);
{ const r = burst('198.51.100.2', 130, false); t('уровень 1: аноним получает 429 после 100/мин', r.statuses[429] === 30, JSON.stringify(r.statuses)); t('429 с Retry-After', r.last?.retryAfter > 0); }
t('уровень 1: вошедшему ещё без предела', burst('198.51.100.3', 300, true).limited === 0);
t('уровень 1: другой адрес не задет', burst('198.51.100.4', 50, false).limited === 0);
{ const r = burst('198.51.100.5', 50, false, '/api/auth/email/start'); t('уровень 1: /api/auth/ — свой предел 40', r.statuses[429] === 10, JSON.stringify(r.statuses)); }

fw._reset();
t('свои адреса (локальная сеть) не ограничиваются', burst('10.1.2.3', 500, false).limited === 0);
t('healthz и шлюз SSH не ограничиваются', burst('198.51.100.6', 400, false, '/api/ssh-gate/request').limited === 0);
t('OPTIONS (предзапрос CORS) не считается', (() => { let n = 0; for (let i = 0; i < 300; i++) if (fw.gate(req('198.51.100.7', '/api/x', 'OPTIONS'), false)) n++; return n === 0; })());
t('медиа-файлы не считаются (лента тянет десятками)', burst('198.51.100.8', 300, false, '/api/music/cover/abc').limited === 0);

await fw.setLevel(3, { by: 'x', hours: 1, reason: 'тест' });
fw._reset();
t('уровень 3: аноним вне белого списка — 403', fw.gate(req('198.51.100.9', '/api/wallet/state'), false)?.status === 403);
t('уровень 3: вход и статус аноним видит', fw.gate(req('198.51.100.9', '/api/auth/email/start'), false) === null && fw.gate(req('198.51.100.9', '/api/platform/status'), false) === null);
t('уровень 3: вошедший работает в пределах 60/мин', burst('198.51.100.10', 60, true).limited === 0 && fw.gate(req('198.51.100.10'), true)?.status === 429);
t('уровень 3: необязательные работы отложены (пол нагрузки 2)', fw.loadFloor() === 2);

await fw.setLevel(2, { by: 'x', hours: 1, reason: 'тест' });
fw._reset();
{ burst('198.51.100.20', 200, false); await new Promise((r) => setTimeout(r, 300));
  const bans = await fw.listBans(); t('уровень 2: настойчивый нарушитель заблокирован на час', bans.some((b) => b.reason.startsWith('авто:')), JSON.stringify(bans).slice(0, 160)); }
t('блокировка записана в журнал', (await fw.listEvents(20)).some((e) => e.kind === 'ban'));
t('защищённый адрес заблокировать нельзя', (await fw.ban('10.0.0.5', 1, 'x', true)).error === 'protected_address');
{ const fp = (await fw.listBans())[0]?.ipFp; await fw.unban(fp); t('разблокировка работает', !(await fw.listBans()).some((b) => b.ipFp === fp)); }

await fw.setLevel(4, { by: 'x', hours: 1, reason: 'тест' });
t('«Атака»: пол нагрузки 3 (необязательное отключено)', fw.loadFloor() === 3);
fw._reset();
t('«Атака»: аноним 12/мин', burst('198.51.100.30', 20, false, '/api/auth/email/start').statuses[429] >= 8);
t('«Атака»: регистрация закрыта', (await import('../../server/registration.mjs')).registerLimited ? await (async () => { try { await (await import('../../server/registration.mjs')).registerLimited('198.51.100.31', async () => null); return false; } catch (e) { return e.code === 'registration_closed'; } })() : false);

// автоэскалация
await fw.setLevel(0, { by: 'x', reason: 'сброс' });
await query("UPDATE firewall_state SET pinned_until = NULL, set_by = NULL WHERE id");
fw._reset(); await fw.getSettings();
await fw.setLevel(1, { by: 'x', hours: 1, reason: 'для автоматики' });
await query("UPDATE firewall_state SET pinned_until = NULL WHERE id");
for (let i = 1; i <= 30; i++) for (let k = 0; k < 130; k++) fw.gate(req(`203.0.113.${i}`), false);   // 30 адресов по 130 запросов → по 30 отказов на уровне 1
{ const s = fw.stats(); t('счётчики видят отказы', s.limitedPerMin > 0 && s.attackers > 0, JSON.stringify({ l: s.limitedPerMin, a: s.attackers })); }
await query("UPDATE firewall_settings SET data = jsonb_set('{\"thresholds\":{\"limited2\":10,\"limited3\":20,\"attackers3\":10}}'::jsonb, '{autoEscalate}', 'true') WHERE id");
await fw.firewallTick();   // тик заново читает настройки из базы
t('настройки читаются из базы', (await fw.getSettings()).thresholds.limited2 === 10);
t('автоматика сама подняла уровень по сигналам', fw.currentLevel() >= 2, String(fw.currentLevel()));
t('подъём записан в журнал как автоматический', (await fw.listEvents(20)).some((e) => e.kind === 'level_up'));

// ручной уровень удерживается, автоматика его не снижает
await fw.setLevel(3, { by: 'owner', hours: 2, reason: 'вручную' });
fw._reset(); await query("UPDATE firewall_settings SET data = jsonb_set(data, '{calmMinutes}', '1') WHERE id"); await fw.getSettings();
await query("UPDATE firewall_state SET set_at = now() - interval '30 minutes' WHERE id");
await fw.firewallTick();
t('ручной уровень не снижается автоматикой', fw.currentLevel() === 3, String(fw.currentLevel()));
// без закрепления — снижается на ступень
await query("UPDATE firewall_state SET pinned_until = NULL WHERE id");
await fw.firewallTick();
t('без закрепления и при тишине — снижается на ступень', fw.currentLevel() === 2, String(fw.currentLevel()));

// настройки
{ const r = await fw.saveSettings('x', { calmMinutes: 0 }); t('плохое значение настройки отклоняется', r.error === 'bad_field'); }
{ const r = await fw.saveSettings('x', { trustedIps: ['198.51.100.77'], thresholds: { limited1: 55 } }); t('настройки сохраняются', r.ok && r.settings.trustedIps[0] === '198.51.100.77' && r.settings.thresholds.limited1 === 55); }
await fw.setLevel(3, { by: 'x', hours: 1, reason: 'доверенный' }); fw._reset();
t('доверенный адрес не ограничивается', burst('198.51.100.77', 400, false).limited === 0);
{ const r = await fw.saveSettings('x', { trustedIps: ['не адрес!'] }); t('мусор вместо адреса отклоняется', r.error === 'bad_field'); }
t('Cloudflare без ключей не настроен', fw.cloudflareConfigured() === false);

await fw.setLevel(0, { by: 'x', reason: 'конец теста' });
await query("UPDATE firewall_settings SET data = '{}'::jsonb WHERE id");
await query("DELETE FROM defense_ip_blocks WHERE reason LIKE 'авто:%' OR reason LIKE 'вручную:%'");
console.log(`\n${ok} ok, ${bad} fail`); await pool.end(); process.exit(bad ? 1 : 0);
