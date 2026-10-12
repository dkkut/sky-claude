// Карты: Яндекс как второй поставщик (server/maps.mjs). Нужен API с YANDEX_MAPS_KEY=ykey и
//   YANDEX_STATIC_BASE_URL / YANDEX_GEOCODE_BASE_URL=http://127.0.0.1:9933 (поставщик-подделка поднимается здесь же) и GOOGLE_MAPS_KEY.
//   (. env.sh; node scripts/audit/maps-yandex-test.mjs <каталог>)
import http from 'node:http';
import { execSync } from 'node:child_process';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const seen = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const fake = http.createServer((req, res) => {
  seen.push(req.url);
  if (req.url.startsWith('/v1?')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
  if (req.url.startsWith('/1.x/')) {
    const g = new URL(req.url, 'http://x').searchParams.get('geocode');
    const body = /Нигде/.test(g) ? { response: { GeoObjectCollection: { featureMember: [] } } }
      : { response: { GeoObjectCollection: { featureMember: [{ GeoObject: { Point: { pos: '37.617635 55.755814' } } }] } } };
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(body));
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => fake.listen(9933, r));
const u = await mkuser(S, 'mapsy');
const get = (p) => fetch(B + p, { headers: { authorization: `Bearer ${u.tok}` } });
let r = await call('/api/maps/settings', {}, u.tok);
t('сервер знает обоих поставщиков, ключей не отдаёт', r.data.enabled && r.data.providers.includes('yandex') && r.data.providers.includes('google') && !JSON.stringify(r.data).includes('ykey'), JSON.stringify(r.data));
let res = await get('/api/maps/still?points=55.755814,37.617635,target&p=yandex&w=900&h=700&zoom=12&center=55.75,37.6');
t('картинка Яндекса приходит нашим сервером', res.status === 200 && res.headers.get('content-type') === 'image/png');
const u1 = new URL(seen.at(-1), 'http://x').searchParams;
t('в запрос Яндекса ушли ключ, метка, центр и размер не больше 650×450', u1.get('apikey') === 'ykey' && /37\.617635,55\.755814,pm2rdm/.test(u1.get('pt')) && u1.get('ll') === '37.600000,55.750000' && u1.get('size') === '650,450', seen.at(-1));
res = await get('/api/maps/still?points=55.755814,37.617635,pickup,3&w=300&h=200&zoom=14');
const u2 = new URL(seen.at(-1), 'http://x').searchParams;
t('по месту (Москва) без выбора рисует Яндекс; цифра на метке сохраняется', /pm2gnm3/.test(u2.get('pt') ?? ''), seen.at(-1));
const before = seen.length;
res = await get('/api/maps/still?points=48.8566,2.3522,target&w=300&h=200&zoom=14');
t('по месту (Париж) рисует Google, а не Яндекс', seen.length === before && res.status !== 500, res.status + ' ' + (seen.length - before));
res = await get('/api/maps/still?points=48.8566,2.3522,target&p=yandex&w=300&h=200&zoom=14');
t('явный выбор Яндекса уважается и в Париже', seen.length === before + 1);
res = await get('/api/maps/still?points=1,2,default&path=' + encodeURIComponent('_p~iF~ps|U_ulLnnqC_mqNvxq`@') + '&p=yandex&w=300&h=200');
t('маршрут Google рисуется и на карте Яндекса (ломаная разобрана)', /pl=c%3A3b82f6cc%2Cw%3A5%2C-120\.2/.test(seen.at(-1)) || decodeURIComponent(seen.at(-1)).includes('pl=c:3b82f6cc,w:5,-120.2,38.5'), decodeURIComponent(seen.at(-1)).slice(0, 300));
q(`delete from maps_geocode where address like 'Тверская%' or address like 'Нигде%'`);
r = await call('/api/maps/geocode', { method: 'POST', body: JSON.stringify({ address: 'Тверская улица, 1, Москва' }) }, u.tok);
t('кириллический адрес разбирает Яндекс', Math.abs(r.data.point?.lat - 55.755814) < 1e-6 && Math.abs(r.data.point?.lng - 37.617635) < 1e-6, JSON.stringify(r.data));
const n = seen.length;
r = await call('/api/maps/geocode', { method: 'POST', body: JSON.stringify({ address: 'Тверская улица, 1, Москва' }) }, u.tok);
t('повторный запрос берётся из кэша', seen.length === n && r.data.point?.cached === true);
r = await call('/api/maps/geocode', { method: 'POST', body: JSON.stringify({ address: 'Нигде на свете 999' }) }, u.tok);
t('Яндекс не нашёл — адрес спрашивается у Google (его подделка отвечает всегда)', r.status === 200 && r.data.point !== null && seen.some((x) => x.includes('geocode=') && x.includes('%D0%9D%D0%B8%D0%B3%D0%B4%D0%B5')));
fake.close();
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
