// Чтение репозиториев для режима «Код»: разбор адреса, защита путей. Сеть не используется.
import assert from 'node:assert/strict';
import { parseRepo, repoFiles } from '../../server/airepo.mjs';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n += 1; };
ok(parseRepo('https://github.com/dkkut/sky-claude')?.repo === 'dkkut/sky-claude', 'ссылка');
ok(parseRepo('dkkut/sky-claude.git')?.repo === 'dkkut/sky-claude', '.git');
ok(parseRepo('github.com/a/b/tree/feat/x')?.ref === 'feat/x', 'ветка из ссылки');
for (const bad of ['../etc/passwd', 'a/b/c', 'http://evil.example/a/b', 'a b/c', '', null, 'a/..']) ok(parseRepo(bad) === null, `отказ: ${bad}`);
ok((await repoFiles({ repo: 'a/b', paths: ['../x', '/etc/passwd', 'a\\b', 'ok/ \u0000'] })).error === 'no_files', 'опасные пути отброшены до запроса');
ok((await repoFiles({ repo: 'bad repo', paths: ['a.ts'] })).error === 'bad_repo', 'плохой репозиторий');
ok((await repoFiles({ repo: 'a/b', paths: ['a.ts'], token: 'x y' })).error === 'bad_token', 'плохой токен не уходит в сеть');
console.log(`Репозитории: ${n} проверок пройдено`);
