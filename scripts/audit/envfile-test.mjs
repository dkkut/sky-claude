// Проверка server/envfile.mjs: чтение секретов из файлов. Запуск: node scripts/audit/envfile-test.mjs
import { loadEnvFiles } from '../../server/envfile.mjs';
let ok = 0, bad = 0;
const t = (n, c) => { c ? ok++ : (bad++, console.log('✖', n)); };
const files = { '/s/a': 'secret-A\n', '/s/b': 'sec ret B  \r\n', '/s/empty': '\n' };
const read = (p) => { if (!(p in files)) { const e = new Error('nf'); e.code = 'ENOENT'; throw e; } return files[p]; };

let env = { A_FILE: '/s/a', B_FILE: '/s/b' };
const l = loadEnvFiles(env, read);
t('читает значение, убирая один перевод строки', env.A === 'secret-A');
t('пробелы внутри и в конце сохраняются', env.B === 'sec ret B  ');
t('возвращает список имён', l.includes('A') && l.includes('B'));

env = { A: 'explicit', A_FILE: '/s/a' }; loadEnvFiles(env, read);
t('явное значение не перетирается', env.A === 'explicit');

for (const [n, e] of [['нет файла', { X_FILE: '/s/nope' }], ['пустой файл', { X_FILE: '/s/empty' }]]) {
  let thrown = false; try { loadEnvFiles(e, read); } catch (x) { thrown = /X_FILE/.test(x.message) && !/secret/i.test(x.message); }
  t(n + ' → остановка без значения в сообщении', thrown);
}
env = { Y_FILE: '' }; loadEnvFiles(env, read); t('пустой путь игнорируется', !('Y' in env));
console.log(bad ? `FAIL ${bad}` : `OK ${ok}`); process.exit(bad ? 1 : 0);
