let pass = 0, fail = 0; const ok = (c, m, x = '') => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m, x); } };
const B = 'http://127.0.0.1:8090';
const hit = async (h, path = '/api/nothing') => (await fetch(B + path, { headers: h })).status;
let last; for (let i = 0; i < 25; i++) last = await hit({ 'x-real-ip': '203.0.113.5' });
ok(last === 429, 'клиент A после лимита получает 429');
ok(await hit({ 'x-real-ip': '203.0.113.6' }) !== 429, 'клиент B (другой X-Real-IP) не страдает от клиента A');
ok(await hit({ 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.9, 203.0.113.5' }) === 429, 'подделка XFF не снимает лимит A');
let st = 0; for (let i = 0; i < 15; i++) st = await hit({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.' + i });
ok(st !== 429, 'смена первого элемента XFF не создаёт новый счётчик/не ломает B');
// медиа-запросы имеют отдельный бо́льший счётчик
let m = 0; for (let i = 0; i < 40; i++) m = await hit({ 'x-real-ip': '203.0.113.5' }, '/api/music/track/trk-x/cover');
ok(m !== 429, 'обложки считаются отдельным (х10) счётчиком и не добиваются общим лимитом API', String(m));
console.log(`\n${pass} ok, ${fail} fail`);
