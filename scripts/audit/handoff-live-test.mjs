// liveSeek: место получателя при передаче «вживую». Запуск: node scripts/audit/handoff-live-test.mjs (нужны DATABASE_URL/REDIS_URL окружения модулей сервера не требуются — берём функцию из исходника)
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../../server/handoff.mjs', import.meta.url), 'utf8');
const m = /export const liveSeek = [\s\S]*?\n};/.exec(src);
const cl = /const clamp = [^\n]*/.exec(src)[0];
const MAX_POS = 86400 * 2;
const liveSeek = new Function('MAX_POS', `${cl}\n${m[0].replace('export const ', 'return ').replace(/;$/, '')};`)(MAX_POS);
let bad = 0;
const t = (n, ok) => { console.log(`${ok ? 'ok ' : 'FAIL'} ${n}`); if (!ok) bad++; };
const t0 = Date.parse('2026-10-27T10:00:00Z');
t('+5 с прошло', liveSeek(60, 200, new Date(t0), t0 + 5000) === 65);
t('не больше длительности', liveSeek(198, 200, new Date(t0), t0 + 60000) === 199);
t('длительность неизвестна', liveSeek(10, 0, new Date(t0), t0 + 3500) === 13.5);
t('часы назад не уменьшают', liveSeek(10, 100, new Date(t0), t0 - 9000) === 10);
process.exit(bad ? 1 : 0);
