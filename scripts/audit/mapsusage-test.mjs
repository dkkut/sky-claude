// Sky Maps Core: учёт, переключатели, пределы (модуль напрямую). Запуск: DATABASE_URL=… REDIS_URL=… JWT_SECRET=… ENCRYPTION_KEY=… node scripts/audit/mapsusage-test.mjs
process.chdir(new URL('../../server/', import.meta.url).pathname);
const u = await import('../../server/mapsusage.mjs');
const { capabilities } = await import('../../server/skymaps.mjs');
const { query, pool } = await import('../../server/db.mjs');
let ok = 0, bad = 0; const t = (n, c) => { if (c) ok++; else { bad++; console.log('✗', n); } };
await query('DELETE FROM maps_usage'); await query('DELETE FROM maps_errors');
await u.saveMapsSettings('t', { features: {}, limits: {} });

let calls = 0;
const good = () => u.track('yandex', 'geocode', async () => { calls++; return { ok: true, value: 7 }; });
const fail = () => u.track('yandex', 'geocode', async () => { calls++; return { ok: false, code: 'net' }; });
t('успех возвращает значение', (await good()).value === 7);
t('сбой возвращает ok:false', (await fail()).ok === false);
t('исключение не пробрасывается', (await u.track('yandex', 'geocode', async () => { throw new Error('x'); })).code === 'exception');

let r = await u.usageReport(1);
const row = r.usage.find((x) => x.provider === 'yandex' && x.feature === 'geocode');
t('счётчик успехов', row?.ok === 1); t('счётчик сбоев', row?.failed === 2);
t('ошибки записаны', r.errors.length === 2 && r.errors.every((e) => !/\d{2}\.\d{4}/.test(e.code)));

await u.saveMapsSettings('t', { features: { geocode: false } });
calls = 0; const off = await good();
t('выключенная функция не вызывает поставщика', off.code === 'feature_off' && calls === 0);
t('другие функции работают', (await u.track('yandex', 'static', async () => ({ ok: true }))).ok === true);

await u.saveMapsSettings('t', { features: {}, limits: { 'yandex:geocode': 5 } });
calls = 0; const outs = []; for (let i = 0; i < 6; i++) outs.push(await good());
t('предел: после исчерпания отказ', outs.some((x) => x.code === 'limit') && calls <= 3);
t('отказ по пределу посчитан', ((await u.usageReport(1)).usage.find((x) => x.feature === 'geocode' && x.provider === 'yandex')?.limited ?? 0) >= 1);

t('плохой ключ предела отклонён', (await u.saveMapsSettings('t', { limits: { 'bing:geocode': 5 } })).error === 'bad_limit_key');
t('плохое значение предела отклонено', (await u.saveMapsSettings('t', { limits: { 'yandex:geocode': -1 } })).error === 'bad_limit');
await u.saveMapsSettings('t', { features: {}, limits: {} });

const cap = capabilities();
t('в таблице возможностей нет ключей', !JSON.stringify(cap).match(/AIza|apikey/i));
t('яндекс-маршрутизация честно не подключена', cap.routing.every((m) => m.yandex.available === false));
t('режимы: авто, пешком, вело, такси, курьер', ['car', 'foot', 'bike', 'taxi', 'courier'].every((id) => cap.routing.some((m) => m.mode === id)));

console.log(`mapsusage: ${ok} ok, ${bad} fail`); await pool.end(); process.exit(bad ? 1 : 0);
