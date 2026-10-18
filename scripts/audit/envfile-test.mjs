// Проверка server/envfile.mjs: чтение секретов из файлов. Запуск: node scripts/audit/envfile-test.mjs
import { loadEnvFiles } from '../../server/envfile.mjs';
let ok = 0, bad = 0;
const t = (n, c) => { c ? ok++ : (bad++, console.log('✖', n)); };
const files = { '/s/a': 'secret-A\n', '/s/b': 'sec ret B  \r\n', '/s/empty': '\n' };
const read = (p) => { if (!(p in files)) { const e = new Error('nf'); e.code = 'ENOENT'; throw e; } return files[p]; };

let env = { JWT_SECRET_FILE: '/s/a', ENCRYPTION_KEY_FILE: '/s/b' };
const l = loadEnvFiles(env, read);
t('читает значение, убирая один перевод строки', env.JWT_SECRET === 'secret-A');
t('пробелы внутри и в конце сохраняются', env.ENCRYPTION_KEY === 'sec ret B  ');
t('возвращает список имён', l.includes('JWT_SECRET') && l.includes('ENCRYPTION_KEY'));

env = { JWT_SECRET: 'explicit', JWT_SECRET_FILE: '/s/a' }; loadEnvFiles(env, read);
t('явное значение не перетирается', env.JWT_SECRET === 'explicit');

for (const [n, e] of [['нет файла', { AI_API_KEY_FILE: '/s/nope' }], ['пустой файл', { AI_API_KEY_FILE: '/s/empty' }]]) {
  let thrown = false; try { loadEnvFiles(e, read); } catch (x) { thrown = /AI_API_KEY_FILE/.test(x.message) && !/secret/i.test(x.message); }
  t(n + ' → остановка без значения в сообщении', thrown);
}
env = { JWT_SECRET_FILE: '' }; loadEnvFiles(env, read); t('пустой путь игнорируется', !('JWT_SECRET' in env));
env = { SSL_CERT_FILE: '/s/a', STORAGE_KEK_K2_FILE: '/s/a' }; loadEnvFiles(env, read);
t('служебные *_FILE (SSL_CERT_FILE) не трогаем, ключи копий STORAGE_KEK_* читаем', !('SSL_CERT' in env) && env.STORAGE_KEK_K2 === 'secret-A');
console.log(bad ? `FAIL ${bad}` : `OK ${ok}`); process.exit(bad ? 1 : 0);
