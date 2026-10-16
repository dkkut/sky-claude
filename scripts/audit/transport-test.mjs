// Защита канала передачи: статические проверки конфигурации nginx и юнит-проверки серверных защит. (node scripts/audit/transport-test.mjs)
import { readFileSync } from 'node:fs';
import { insecureApiRequest } from '../../server/transport.mjs';
import { s3Config } from '../../server/skystorages3.mjs';
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const tpl = readFileSync('nginx/templates/sky.conf.template', 'utf8');
const main = readFileSync('nginx/nginx.conf', 'utf8');
const sec = readFileSync('nginx/snippets/security-headers.conf', 'utf8');

t('nginx: только TLS 1.2 и 1.3', /ssl_protocols\s+TLSv1\.2 TLSv1\.3;/.test(tpl) && !/TLSv1[ ;]|TLSv1\.1|SSLv/.test(tpl.replace(/TLSv1\.2|TLSv1\.3/g, '')));
t('nginx: шифры только с прямой секретностью (ECDHE), без RC4/3DES/CBC/NULL', /ssl_ciphers\s+ECDHE/.test(tpl) && !/RC4|3DES|CBC|NULL|EXPORT|aNULL|MD5/.test(tpl.match(/ssl_ciphers[^;]+;/)[0]));
t('nginx: билеты сессий TLS выключены (прямая секретность между сессиями)', /ssl_session_tickets\s+off;/.test(tpl));
t('nginx: http перенаправляется на https', /return 301 https:\/\/\$host\$request_uri;/.test(tpl));
t('nginx: HSTS на год с includeSubDomains', /Strict-Transport-Security "max-age=31536000; includeSubDomains"/.test(sec));
t('nginx: версия сервера не раскрывается', /server_tokens off;/.test(main));
t('nginx: заголовки против встраивания и подмены типа', /X-Frame-Options/.test(sec) && /X-Content-Type-Options\s+"nosniff"/.test(sec) && /frame-ancestors/.test(sec));
t('nginx: CSP не разрешает http:-источники', !/http:\/\//.test(sec.match(/Content-Security-Policy[^\n]*/)?.[0] ?? ''));
t('журнал nginx не пишет строку запроса и реферер с параметрами (в них одноразовые токены)', /map \$request_uri \$log_uri/.test(main) && /map \$http_referer \$log_referer/.test(main) && !/"\$request"/.test(main.match(/log_format main[\s\S]*?;/)[0]) && !/\$http_referer"/.test(main.match(/log_format main[\s\S]*?;/)[0]));
t('страницы ссылок из писем отдаются отдельным verify.html', /\^\/\(admin-verify\|ssh-verify\|ssh-confirm\|unfreeze\|storage-verify\)\$/.test(tpl));
t('verify.html не отправляет Referer', /name="referrer" content="no-referrer"/.test(readFileSync('verify.html', 'utf8')));

const mk = (proto, url = '/api/x', env = 'production') => insecureApiRequest({ headers: proto === undefined ? {} : { 'x-forwarded-proto': proto } }, url, env);
t('API: запрос по http в боевом режиме отклоняется', mk('http') === true);
t('API: цепочка прокси «http, https» считается по первому звену', mk('http, https') === true);
t('API: https проходит', mk('https') === false);
t('API: без заголовка (прямой внутренний вызов, healthz) проходит', mk(undefined) === false);
t('API: не-API пути (статика, healthz) не затрагиваются', mk('http', '/healthz') === false);
t('API: вне боевого режима проверка не мешает разработке', mk('http', '/api/x', 'development') === false);
process.env.STORAGE_S3_ENDPOINT = 'http://s3.example.com'; process.env.STORAGE_S3_BUCKET = 'b'; process.env.STORAGE_S3_ACCESS_KEY = 'a'; process.env.STORAGE_S3_SECRET_KEY = 'xxxxxxxxxx';
delete process.env.STORAGE_S3_ALLOW_INSECURE;
t('S3: адрес без https не принимается', s3Config().ok === false && s3Config().missing.some((m) => /https/.test(m)));
process.env.STORAGE_S3_ENDPOINT = 'https://s3.example.com';
t('S3: https принимается', s3Config().ok === true);
const nat = readFileSync('.env.native', 'utf8');
t('приложения Android/Windows ходят на сервер только по https', /VITE_API_ORIGIN=https:\/\//.test(nat));
console.log(`\nИтого: ${ok} ok, ${bad} fail`);
process.exit(bad ? 1 : 0);
