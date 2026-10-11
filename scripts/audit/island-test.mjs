/* Sky Island: логика очереди и фразы-активатора (без браузера).
   Запуск: node scripts/audit/island-test.mjs */
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(join(tmpdir(), 'island-'));
const entry = join(out, 'entry.ts');
import { writeFileSync } from 'node:fs';
writeFileSync(entry, `export * from '${process.cwd()}/src/island/islandStore'; export * from '${process.cwd()}/src/island/wakeWord';`);
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: join(out, 'b.mjs'), logLevel: 'silent' });
const m = await import(pathToFileURL(join(out, 'b.mjs')).href);
const { useIslandStore: S, PRIORITY, QUEUE_MAX, pickNext, isWakePhrase } = m;

let fails = 0;
const ok = (c, name) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${name}`); if (!c) fails += 1; };
const ev = (kind, o = {}) => ({ kind, title: kind, ttl: 4000, ...o });
const reset = () => S.getState().clear();

reset();
S.getState().push(ev('message', { mergeKey: 'm:1', title: 'A' }));
ok(S.getState().current?.title === 'A', '1. первое событие сразу на экране');

S.getState().push(ev('message', { mergeKey: 'm:1', title: 'A2' }));
ok(S.getState().current?.title === 'A2' && S.getState().current.count === 2 && S.getState().queue.length === 0, '2. то же событие склеивается, без дубля');

S.getState().push(ev('track', { mergeKey: 'track' }));
ok(S.getState().queue.length === 1 && S.getState().current.kind === 'message', '3. менее важное ждёт в очереди');

S.getState().push(ev('call', { ttl: 0, mergeKey: 'call' }));
ok(S.getState().current.kind === 'call' && S.getState().queue.some((q) => q.kind === 'message'), '4. звонок вытесняет, прежнее возвращается в очередь');

S.getState().push(ev('message', { mergeKey: 'm:2' }));
ok(S.getState().current.kind === 'call', '5. сообщение не вытесняет звонок');

S.getState().dismiss('нет-такого');
ok(S.getState().current.kind === 'call', '6. чужой id не снимает звонок');

S.getState().resolve('call');
ok(S.getState().current && S.getState().current.kind !== 'call', '7. звонок закончился — следующее из очереди');

reset();
S.getState().push(ev('message', { mergeKey: 'a' }));
for (let i = 0; i < 20; i += 1) S.getState().push(ev('system', { mergeKey: `s${i}` }));
ok(S.getState().queue.length <= QUEUE_MAX, '8. очередь ограничена');

reset();
const now = Date.now();
const old = { id: 'o', kind: 'track', title: 'old', ttl: 3000, at: now - 50_000 };
const fresh = { id: 'f', kind: 'system', title: 'fresh', ttl: 4000, at: now };
ok(pickNext([fresh, old], now).next.id === 'o', '9. ожидание повышает вес — мелкое не голодает вечно');
ok(pickNext([{ ...old, at: now - 70_000 }], now).next === null, '10. протухшее выбрасывается');

reset();
S.getState().push(ev('message', { mergeKey: 'x' }));
S.getState().dismiss();
ok(S.getState().current === null && S.getState().queue.length === 0, '11. после закрытия остров пуст (скрыт)');

ok(PRIORITY.call > PRIORITY.ai && PRIORITY.ai > PRIORITY.message && PRIORITY.message > PRIORITY.media && PRIORITY.media > PRIORITY.system && PRIORITY.system > PRIORITY.track, '12. порядок приоритетов: звонок > ИИ > сообщения > медиа > система > трек');

const yes = ['Привет, Скай', 'привет скай', 'Эй, Скай!', 'hey sky', 'Окей скай включи музыку'];
const no = ['Привет, Максим', 'скай', 'это небо', 'привет всем', 'sky high'];
ok(yes.every(isWakePhrase), '13. фраза-активатор узнаётся');
ok(no.every((t) => !isWakePhrase(t)), '14. посторонние фразы не активируют');

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВсе проверки острова пройдены');
process.exit(fails ? 1 : 0);
