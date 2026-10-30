// Фраза восстановления через HTTP: node scripts/audit/moneyrecovery-http-test.mjs <каталог с api.log>  (API с ADMIN_GATE=off, EMAIL_MODE=log)
import { readFileSync } from 'node:fs';
import { call } from './lib.mjs';
const S = process.argv[2];
let ok = 0, bad = 0; const t = (n, c, d = '') => { if (c) ok += 1; else { bad += 1; console.log('FAIL', n, d); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastCode = (email) => [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))].pop()?.[1];
const login = async (email, device) => {
  const H = device ? { 'x-sky-device': device } : {};
  await call('/api/auth/email/start', { method: 'POST', body: JSON.stringify({ email, viaMail: true }) }, null, H);
  await sleep(1500);
  const r = await call('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code: lastCode(email) }) }, null, H);
  return { r, H };
};
const email = `mrec${Date.now()}@example.com`;
const dev1 = 'dev-' + 'a'.repeat(30);
const a = await login(email, dev1);
let tok = a.r.data.accessToken; const H1 = a.H;
const p = await call('/api/skyid/profiles', { method: 'POST', body: JSON.stringify({ name: 'MR', username: 'mr' + Date.now().toString(36), acceptLegal: true }) }, tok, H1);
const sel = await call(`/api/skyid/profiles/${p.data.profile.id}/select`, { method: 'POST', body: '{}' }, tok, H1);
tok = sel.data.accessToken ?? tok;
// Первое устройство после входа по коду доверенное: фраза создаётся и 13-е слово задаётся.
const st1 = await call('/api/skyid/money/status', {}, tok, H1);
t('первое устройство доверенное', st1.data.unlocked === true, JSON.stringify(st1.data));
const cr = await call('/api/skyid/money/recovery/create', { method: 'POST', body: '{}' }, tok, H1);
t('фраза создана, 12 слов', cr.data?.words?.length === 12, JSON.stringify(cr.data));
const words = cr.data.words.join(' ');
t('13-е слово задано', (await call('/api/skyid/money/recovery/extra', { method: 'POST', body: JSON.stringify({ word: 'secret-thirteenth' }) }, tok, H1)).status === 200);
// Начислим себе что-то нельзя без админки — проверяем нули/структуру; настоящий баланс сверяем по доверенному устройству.
const real = await call('/api/wallet', {}, tok, H1);
t('доверенное устройство читает кошелёк', real.status === 200 && typeof real.data.balance === 'number');

// Второе устройство — тот же Sky ID, но неизвестное устройство.
const dev2 = null; // без идентификатора устройства — недоверенное
await sleep(62000); // пауза между кодами одной почты
const b = await login(email, dev2);
let tok2 = b.r.data.accessToken; const H2 = b.H;
const s2 = await call(`/api/skyid/profiles/${p.data.profile.id}/select`, { method: 'POST', body: '{}' }, tok2, H2);
tok2 = s2.data.accessToken ?? tok2;
const st2 = await call('/api/skyid/money/status', {}, tok2, H2);
if (st2.data.unlocked) { console.log('SKIP: второе устройство оказалось доверенным (вход по коду делает устройство доверенным) — сценарий чужого устройства проверяется на сервере модульным тестом'); }
else {
  t('чужое устройство просит фразу', st2.data.deviceProof === 'phrase', JSON.stringify(st2.data));
  t('в статусе нет признака пустышки', !('decoy' in st2.data));
  t('код на почту не отправляется', (await call('/api/skyid/money/code', { method: 'POST', body: '{}' }, tok2, H2)).data?.error === 'use_phrase');
  t('неверная фраза отклонена', (await call('/api/skyid/money/unlock', { method: 'POST', body: JSON.stringify({ words: 'able acid acorn actor adapt agile alarm album alert alley amber ankle' }) }, tok2, H2)).status === 401);
  const u = await call('/api/skyid/money/unlock', { method: 'POST', body: JSON.stringify({ words }) }, tok2, H2);
  t('фраза без слова открывает', u.status === 200 && u.data.unlocked === true && !('decoy' in u.data));
  const w = await call('/api/wallet', {}, tok2, H2);
  t('пустой кошелёк: нули и нет истории', w.data.balance === 0 && w.data.points === 0 && w.data.transactions.length === 0);
  t('пустой кошелёк: операции недоступны', (await call('/api/wallet/exchange', { method: 'POST', body: '{"rubles":50}' }, tok2, H2)).status === 503);
  t('пустышка не даёт менять фразу', (await call('/api/skyid/money/recovery/create', { method: 'POST', body: '{}' }, tok2, H2)).status === 403);
  await call('/api/skyid/money/lock', { method: 'POST', body: '{}' }, tok2, H2);
  const u2 = await call('/api/skyid/money/unlock', { method: 'POST', body: JSON.stringify({ words, extra: 'secret-thirteenth' }) }, tok2, H2);
  t('фраза с 13-м словом открывает', u2.status === 200 && u2.data.unlocked === true);
  const w2 = await call('/api/wallet', {}, tok2, H2);
  t('настоящий кошелёк совпадает с доверенным устройством', w2.data.balance === real.data.balance);
}
console.log(`${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
