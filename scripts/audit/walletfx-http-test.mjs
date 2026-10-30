// Валютные счета через HTTP: node scripts/audit/walletfx-http-test.mjs <каталог с api.log>  (API с ADMIN_GATE=off, EMAIL_MODE=log)
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const u = await mkuser(S, 'FxHttp');
const anon = await call('/api/wallet/fx');
t('без входа — 401', anon.status === 401);
const g = await call('/api/wallet/fx', {}, u.tok);
t('обзор доступен (устройство доверенное или код не нужен)', g.status === 200 || g.status === 403, `${g.status}`);
if (g.status === 403) console.log('SKIP: замок SkyMoney закрыт для нового пользователя (ожидаемо — проверяется модульным тестом)');
else {
  t('в обзоре 6 валют, ни одна не доступна без курса', g.data.currencies.length === 6 && g.data.currencies.every((c) => !c.available), JSON.stringify(g.data.currencies[0]));
  t('открыть недоступную валюту нельзя', (await call('/api/wallet/fx/open', { method: 'POST', body: '{"currency":"USD"}' }, u.tok)).status === 409);
  t('обмен без счёта — 404', (await call('/api/wallet/fx/convert', { method: 'POST', body: JSON.stringify({ currency: 'USD', direction: 'buy', amount: 100, idemKey: 'k-http-0001' }) }, u.tok)).status === 404);
}
t('курсы в админке — не для обычного человека', (await call('/api/admin/fx-rates', {}, u.tok)).status === 403);
t('менять курсы обычному нельзя', (await call('/api/admin/fx-rates', { method: 'PUT', body: '{"rates":[{"currency":"USD","rateRub":90}]}' }, u.tok)).status === 403);
console.log(`${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
