// Кастомизация других людей: надетое видно собеседнику (HTTP, API на :8080).
// Запуск: node scripts/audit/customization-peers-test.mjs <каталог с api.log>
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const a = await mkuser(S, 'cpA'); const b = await mkuser(S, 'cpB');
const J = (o) => ({ method: 'POST', body: JSON.stringify(o) });
let r = await call('/api/customization/equip', J({ category: 'banner', itemId: 'banner-aurora' }), a.tok);
t('A надел баннер', r.status === 200, JSON.stringify(r.data));
r = await call('/api/customization/equip', J({ category: 'frame', itemId: 'frame-gold' }), a.tok);
r = await call(`/api/customization/of?ids=${a.pid},${b.pid}`, {}, b.tok);
t('B видит надетое у A', r.status === 200 && r.data.equipped[a.pid]?.banner === 'banner-aurora' && r.data.equipped[a.pid]?.frame === 'frame-gold', JSON.stringify(r.data));
t('у B ничего не надето', !r.data.equipped[b.pid]);
r = await call('/api/customization/of?ids=%27%3Bdrop%20table%20x,%20', {}, b.tok);
t('мусорные идентификаторы отбрасываются', r.status === 200 && Object.keys(r.data.equipped).length === 0, JSON.stringify(r.data));
r = await call('/api/customization/of?ids=x', {});
t('без входа — отказ', r.status === 401 || r.status === 403);
console.log(`\n${bad ? 'ПРОВАЛЕНО' : 'Все проверки пройдены'}: ok=${ok} fail=${bad}`);
process.exit(bad ? 1 : 0);
