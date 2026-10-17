/** Проверка ввода прокси Windows-приложения (electron/proxycfg.cjs): адрес, порт, тип, логин/пароль, правило Chromium. */
import { createRequire } from 'node:module';
const { normalize } = createRequire(import.meta.url)('../../electron/proxycfg.cjs');
let ok = 0, bad = 0;
const check = (n, c, i = '') => { if (c) ok++; else { bad++; console.log('FAIL', n, i); } };
const t = (o) => normalize({ enabled: true, type: 'http', host: 'proxy.example.com', port: 8080, ...o });

let r = t({});
check('http: правило', r.ok && r.rules === 'http://proxy.example.com:8080', JSON.stringify(r));
r = t({ type: 'socks5', port: '1080' });
check('socks5: правило, порт строкой', r.ok && r.rules === 'socks5://proxy.example.com:1080');
r = t({ type: 'socks4' });
check('socks4: правило', r.ok && r.rules === 'socks4://proxy.example.com:8080');
r = t({ host: '127.0.0.1' });
check('ipv4 принимается', r.ok && r.rules === 'http://127.0.0.1:8080');
r = t({ host: '::1' });
check('ipv6 в скобках', r.ok && r.rules === 'http://[::1]:8080');
r = t({ username: 'u', password: 'p' });
check('http с логином принимается', r.ok && r.cfg.username === 'u');
r = t({ type: 'socks5', username: 'u', password: 'p' });
check('socks с логином отклоняется', !r.ok && r.error === 'socks_auth_unsupported');
for (const host of ['', 'a b', 'proxy.example.com;evil', 'http://x.y', 'x.y/path', '-bad.com', 'a'.repeat(300), 'host\r\nX-Evil: 1', 'x.y:80', "x'y.com"])
  check(`host «${host.slice(0, 20).replace(/\r|\n/g, '⏎')}» отклонён`, !t({ host }).ok);
for (const port of [0, -1, 65536, 1.5, 'abc', '', null, '80; rm'])
  check(`port ${JSON.stringify(port)} отклонён`, !t({ port }).ok);
check('тип вне списка отклонён', !t({ type: 'vless' }).ok && !t({ type: '' }).ok && !t({ type: 'https' }).ok);
check('перевод строки в пароле отклонён', !t({ password: 'a\nb' }).ok);
check('пустой ввод не падает', !normalize(null).ok && !normalize('x').ok && !normalize(undefined).ok);
r = t({ enabled: false });
check('enabled сохраняется как есть', r.ok && r.cfg.enabled === false);
console.log(`${ok} ok, ${bad} FAIL`);
process.exit(bad ? 1 : 0);
