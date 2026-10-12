// Подкасты, книги и режим «Код» в Sky AI — только с Prime (сервер отвечает, экран — вежливость).
//   (. env.sh; node scripts/audit/prime-gates-test.mjs <каталог>)
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const free = await mkuser(S, 'pgfree'); const prime = await mkuser(S, 'pgprime');
q(`INSERT INTO prime_subscriptions(id,profile_id,status,plan) VALUES ('pg${Date.now()}','${prime.pid}','active','test')`);
const get = (p, u) => call(p, {}, u.tok);
const post = (p, b, u) => call(p, { method: 'POST', body: JSON.stringify(b) }, u.tok);
for (const p of ['/api/podcasts/catalog', '/api/books/catalog', '/api/podcasts/mine', '/api/books/shelf']) {
  t(`без Prime ${p} → 403 prime_required`, (await get(p, free)).status === 403 && (await get(p, free)).data?.error === 'prime_required');
  t(`с Prime ${p} открыт`, (await get(p, prime)).status === 200, JSON.stringify((await get(p, prime)).data).slice(0, 80));
}
t('без Prime пропуск для подкастов не выдаётся', (await post('/api/podcasts/ticket', {}, free)).status === 403);
t('без Prime «Код» → 402', (await post('/api/ai/send', { text: 'привет', mode: 'code' }, free)).status === 402);
const chat = await post('/api/ai/send', { text: 'привет' }, free);
t('обычный чат без Prime по-прежнему открыт', chat.status !== 402 && chat.status !== 403, chat.status + JSON.stringify(chat.data).slice(0, 80));
const code = await post('/api/ai/send', { text: 'функция сложения', mode: 'code' }, prime);
t('с Prime «Код» работает', code.status === 200, code.status + JSON.stringify(code.data).slice(0, 80));
console.log(`\nИтого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
