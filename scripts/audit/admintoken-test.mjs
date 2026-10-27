// Токен администратора: чистые части (формат, нормализация) + статическая проверка подключения. Запуск: node scripts/audit/admintoken-test.mjs
// Полный сценарий (выдача, вход в панель, подтверждения, настройки) требует API и базы — описан в CLAUDE.md; API для тестов админки запускать с ADMIN_TOKEN=off.
import fs from 'node:fs';
let bad = 0;
const t = (n, ok) => { console.log(`${ok ? 'ok ' : 'FAIL'} ${n}`); if (!ok) bad++; };
const src = fs.readFileSync(new URL('../../server/admintoken.mjs', import.meta.url), 'utf8');
const canon = new Function(`${/export const canon = [^\n]*/.exec(src)[0].replace('export const canon =', 'return')}`)();
t('регистр, дефисы и пробелы не важны', canon(' ska-ab2c3-d4e5f-g6h7j-k8m9n ') === 'SKAAB2C3D4E5FG6H7JK8M9N');
t('пустое', canon(null) === '');
const alpha = /const ALPHABET = '([^']+)'/.exec(src)[1];
t('в алфавите нет похожих знаков (0 O 1 I L)', !/[01OIL]/.test(alpha));
const read = (f) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
t('шлюз входа требует токен', /verifyAdminToken\(r\.profile_id, adminToken\)/.test(read('server/admingate.mjs')));
t('подтверждения требуют токен до расхода попытки кода', /verifyAdminToken\(actorId, getAdminToken\(\)\)/.test(read('server/adminsec.mjs')));
t('сокет передаёт токен в контекст', /setAdminToken\(payload\?\.adminToken\)/.test(read('server/signal.mjs')));
t('HTTP: настройки закрыты до ввода токена', /admin_settings_locked/.test(read('server/server.mjs')));
t('миграция есть', fs.existsSync(new URL('../../server/migrations/210_admin_token.sql', import.meta.url)));
t('переменная в compose', /ADMIN_TOKEN:/.test(read('docker-compose.yml')));
process.exit(bad ? 1 : 0);
