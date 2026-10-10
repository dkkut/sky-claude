/**
 * Sky Blox: безопасное обращение к внешним игровым серверам.
 *
 * Адрес присылает разработчик, то есть посторонний человек. Если просто
 * сделать fetch(url), он сможет заставить наш сервер ходить во
 * внутреннюю сеть (базы, кэш, облачные метаданные, соседние службы) и
 * читать ответы. Поэтому здесь всё устроено так:
 *
 *   1. Только https, без логина в адресе, порт — не из списка портов
 *      внутренних служб. Имена вроде localhost, *.local, *.internal и
 *      облачные метаданные отклоняются сразу.
 *   2. Имя разрешается в адреса нами, и КАЖДЫЙ адрес должен быть
 *      публичным: частные, loopback, link-local, CGNAT, multicast,
 *      зарезервированные диапазоны и собственные адреса этой машины
 *      отвергаются (и IPv4, и IPv6, включая ::ffff:… и 64:ff9b).
 *   3. Соединение идёт ИМЕННО на проверенный адрес (подмена DNS между
 *      проверкой и соединением — DNS rebinding — не пройдёт), SNI и
 *      Host остаются прежними.
 *   4. Редиректы не выполняются: переход на другой адрес пришлось бы
 *      проверять заново, а разработчику проще указать конечный адрес.
 *   5. Тело ответа читается с потолком, ожидание — с таймаутом.
 *
 * Ни код разработчика, ни его ответы здесь не исполняются: мы только
 * читаем заголовки и небольшой кусок тела и сверяем подпись.
 *
 * Для автотестов на одной машине есть BLOX_ALLOW_PRIVATE=1 — он работает
 * ТОЛЬКО вне production и в боевой среде игнорируется.
 */
import dns from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';
import { config } from './config.mjs';
import { query } from './db.mjs';
import { limit, runLimited, optionalAllowed } from './bloxlimits.mjs';
import { decryptContent } from './crypto.mjs';

const TEST_PRIVATE = process.env.BLOX_ALLOW_PRIVATE === '1' && config.nodeEnv !== 'production';
const MAX_BODY = 256 * 1024;
const BAD_PORTS = new Set([22, 23, 25, 53, 110, 143, 389, 445, 1433, 1521, 2375, 2376, 3306, 3389, 5432, 5433, 5900, 6379, 6380, 8080, 9200, 11211, 27017]);
const BAD_HOSTS = /(^|\.)(localhost|local|internal|intranet|lan|corp|home|localdomain)$/i;

/* ─── Диапазоны ────────────────────────────────────────────────────── */

const v4ToInt = (ip) => ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
const inCidr4 = (ip, base, bits) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((v4ToInt(ip) & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
};
const V4_BLOCK = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

const expandV6 = (ip) => {
  let s = ip.toLowerCase().split('%')[0];
  if (s.includes('.')) { // встроенный IPv4 в хвосте
    const i = s.lastIndexOf(':');
    const v4 = s.slice(i + 1);
    const n = v4ToInt(v4);
    s = `${s.slice(0, i + 1)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(Math.max(0, 8 - h.length - t.length)).fill('0');
  return [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16));
};

export const isPublicIp = (ip) => {
  if (net.isIPv4(ip)) return !V4_BLOCK.some(([b, bits]) => inCidr4(ip, b, bits));
  if (!net.isIPv6(ip)) return false;
  const g = expandV6(ip);
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return false;
  const allZero = (a) => a.every((x) => x === 0);
  if (allZero(g)) return false;                                  // ::
  if (allZero(g.slice(0, 7)) && g[7] === 1) return false;       // ::1
  const first = g[0];
  if ((first & 0xfe00) === 0xfc00) return false;                 // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false;                 // fe80::/10
  if ((first & 0xffc0) === 0xfec0) return false;                 // site-local
  if ((first & 0xff00) === 0xff00) return false;                 // multicast
  if (first === 0x2001 && g[1] === 0x0db8) return false;         // документация
  if (first === 0x2001 && g[1] === 0) return false;              // Teredo
  if (first === 0x2002) return false;                            // 6to4
  if (allZero(g.slice(0, 5)) && g[5] === 0xffff) {               // ::ffff:a.b.c.d
    return isPublicIp(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  if (first === 0x64 && g[1] === 0xff9b) {                       // NAT64: проверяем встроенный IPv4
    return isPublicIp(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  return true;
};

const ownAddresses = () => {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) out.add(a.address.toLowerCase());
  return out;
};

/* ─── Проверка адреса ──────────────────────────────────────────────── */

/**
 * Разобрать и проверить адрес. Возвращает { ok, url, host, port,
 * addresses } или { ok:false, code, message, fix }. Ничего не отправляет.
 */
export const resolveSafeUrl = async (raw, { label = 'Адрес' } = {}) => {
  const fail = (code, message, fix) => ({ ok: false, code, message, fix });
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch {
    return fail('bad_url', `${label}: это не похоже на адрес.`, 'Укажите полный адрес вида https://example.com/');
  }
  if (u.protocol !== 'https:' && !(TEST_PRIVATE && u.protocol === 'http:')) {
    return fail('https_required', `${label}: поддерживается только https.`, 'Включите HTTPS (сертификат Let’s Encrypt бесплатный) или разместите игру на хостинге с HTTPS.');
  }
  if (u.username || u.password) return fail('credentials_in_url', `${label}: логин и пароль в адресе запрещены.`, 'Уберите учётные данные из адреса.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host.length > 253) return fail('bad_host', `${label}: неверное имя сервера.`, 'Проверьте адрес.');
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (!TEST_PRIVATE && (BAD_PORTS.has(port) || (port < 1024 && port !== 443))) {
    return fail('bad_port', `${label}: порт ${port} не допускается.`, 'Используйте 443 или порт от 1024 (кроме портов баз данных и служебных).');
  }
  if (!TEST_PRIVATE && (BAD_HOSTS.test(host) || host === 'metadata.google.internal')) {
    return fail('internal_host', `${label}: внутренние имена серверов не поддерживаются.`, 'Нужен публичный домен, доступный из интернета.');
  }

  let addresses;
  if (net.isIP(host)) addresses = [host];
  else {
    try { addresses = (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address); } catch {
      return fail('dns_failed', `${label}: имя «${host}» не найдено в DNS.`, 'Проверьте домен и A/AAAA-запись: она должна указывать на ваш сервер.');
    }
  }
  if (!addresses.length) return fail('dns_failed', `${label}: у «${host}» нет адресов.`, 'Добавьте A/AAAA-запись.');
  const own = ownAddresses();
  if (!TEST_PRIVATE) {
    for (const a of addresses) {
      if (!isPublicIp(a) || own.has(a.toLowerCase())) {
        return fail('private_address', `${label}: адрес указывает во внутреннюю сеть или на сервер Sky.`, 'Игровой сервер должен быть доступен по публичному адресу вашей инфраструктуры.');
      }
    }
  }
  return { ok: true, url: u, host, port, addresses };
};

/* ─── Запрос ───────────────────────────────────────────────────────── */

/**
 * GET по проверенному адресу. Соединяется с первым проверенным IP;
 * редиректы не выполняет; тело режет по потолку.
 */
const fetchPinned = async (target, { method = 'GET', headers = {}, maxBody = MAX_BODY } = {}) => {
  const timeout = await limit('probeTimeoutMs');
  const t0 = Date.now();
  const pinned = target.addresses[0];
  const lib = target.url.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve({ ...v, ms: Date.now() - t0 }); } };
    const req = lib.request({
      host: pinned,
      port: target.port,
      method,
      path: `${target.url.pathname}${target.url.search}`,
      servername: net.isIP(target.host) ? undefined : target.host,
      headers: { Host: target.url.host, 'User-Agent': 'SkyBlox-Probe/1', Accept: '*/*', ...headers },
      timeout,
      rejectUnauthorized: !TEST_PRIVATE,
    }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBody) { res.destroy(); finish({ ok: true, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), truncated: true }); return; }
        chunks.push(c);
      });
      res.on('end', () => finish({ ok: true, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), truncated: false }));
      res.on('error', () => finish({ ok: false, error: 'reset' }));
    });
    req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => finish({ ok: false, error: e.code === 'CERT_HAS_EXPIRED' || /certificate|self.signed|SSL|TLS/i.test(String(e.message)) ? 'tls' : (e.code ?? 'connect') }));
    req.end();
  });
};

const netMessage = (error) => ({
  timeout: ['Сервер не ответил вовремя.', 'Проверьте, что сервер запущен и порт открыт в файрволе.'],
  tls: ['Не удалось установить защищённое соединение.', 'Проверьте сертификат HTTPS: он должен быть действительным, не самоподписанным и выписан на этот домен.'],
  ECONNREFUSED: ['Сервер отказал в соединении.', 'Запустите сервер и убедитесь, что он слушает нужный порт на внешнем интерфейсе.'],
  ECONNRESET: ['Соединение оборвано сервером.', 'Проверьте журнал вашего сервера.'],
  EHOSTUNREACH: ['Сервер недоступен из интернета.', 'Проверьте файрвол и проброс портов (для домашнего компьютера нужен публичный адрес или туннель с HTTPS).'],
  ENOTFOUND: ['Имя сервера не найдено.', 'Проверьте DNS-запись.'],
}[error] ?? ['Не удалось подключиться к серверу.', 'Проверьте адрес, DNS, файрвол и сертификат.']);

/* ─── Проверка совместимости ───────────────────────────────────────── */

export const HOSTING_TYPES = {
  webhost: 'Веб-хостинг (статический сайт с HTML5-игрой)',
  external: 'Внешний игровой хостинг / платформа',
  vps: 'VPS',
  dedicated: 'Выделенный сервер',
  own_server: 'Собственный физический сервер',
  pc: 'Компьютер разработчика',
};

/**
 * Что платформа реально поддерживает. Это не маркетинг, а граница
 * архитектуры: игры запускаются в изолированном окне браузера (iframe с
 * sandbox) по HTTPS, а сервер игры — необязательный внешний HTTPS-сервис,
 * который говорит с Sky подписанными запросами.
 */
export const SUPPORTED_FORMATS = [
  'Браузерные игры (HTML5, JavaScript, WebGL, WebAssembly) по HTTPS — запускаются в изолированном окне.',
  'Игровой сервер на вашей инфраструктуре: HTTPS API с проверкой подписи Sky (/sky/health) — для рейтингов, покупок и выдачи предметов.',
];
export const UNSUPPORTED_FORMATS = [
  'Нативные клиенты (.exe, .apk, Unity/Unreal-билды без WebGL/WebAssembly) — Sky не запускает исполняемые файлы.',
  'Игровой трафик по UDP/TCP/WebSocket через серверы Sky — Sky его не проксирует; ваша игра подключается к вашему серверу напрямую из браузера.',
];

export const hostingAdvice = (hosting, { hasServer }) => {
  const a = [];
  if (hosting === 'pc') a.push('Компьютер разработчика должен быть доступен из интернета по HTTPS (домен + сертификат или туннель). Если компьютер выключен, игра станет недоступна — для публикации лучше VPS или хостинг.');
  if (hosting === 'own_server' || hosting === 'dedicated' || hosting === 'vps') a.push('Поставьте обратный прокси (nginx/Caddy) с сертификатом HTTPS перед игрой и сервером.');
  if (hosting === 'webhost' && hasServer) a.push('Обычный веб-хостинг не запускает серверный код. Адрес сервера нужен только если у вас есть отдельный API; иначе уберите его.');
  if (hosting === 'webhost' && !hasServer) a.push('Для внутриигровых покупок и рейтингов нужен серверный адрес: подписанные запросы нельзя делать из браузера — секрет раскроется.');
  return a;
};

const sameOriginFrame = (headers) => {
  const xfo = String(headers['x-frame-options'] ?? '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return { ok: false, why: `X-Frame-Options: ${xfo.trim()}` };
  const csp = String(headers['content-security-policy'] ?? '');
  const m = csp.match(/frame-ancestors([^;]*)/i);
  if (m) {
    const v = m[1].toLowerCase();
    const origin = (config.publicOrigin || '').toLowerCase();
    const ok = v.includes('*') || (origin && v.includes(origin.replace(/^https?:\/\//, '')));
    if (!ok) return { ok: false, why: `CSP frame-ancestors:${m[1].trim() ? ` ${m[1].trim()}` : ''}` };
  }
  return { ok: true };
};

const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Полная проверка проекта. Возвращает список проверок с понятными
 * сообщениями, итог и по какому адресу что не так. Состояние пишется в
 * blox_games и blox_probe_log.
 */
export const probeGame = async (game, { source = 'manual' } = {}) => {
  if (!optionalAllowed() && source === 'background') return { skipped: 'busy' };
  const max = await limit('maxConcurrentProbes');
  const ran = await runLimited('probe', max, async () => {
    await query(`UPDATE blox_games SET conn_status = 'checking', updated_at = now() WHERE id = $1`, [game.id]);
    const checks = [];
    const add = (name, ok, message, fix) => checks.push({ name, ok, message, ...(fix ? { fix } : {}) });

    /* — адрес клиента: игра в окне браузера — */
    if (!game.client_url) {
      add('client_url', false, 'Адрес игры не указан.', 'Укажите https-адрес страницы, на которой запускается игра.');
    } else {
      const t = await resolveSafeUrl(game.client_url, { label: 'Адрес игры' });
      if (!t.ok) add('client_url', false, t.message, t.fix);
      else {
        const r = await fetchPinned(t, { headers: { Accept: 'text/html' } });
        if (!r.ok) { const [m, f] = netMessage(r.error); add('client_url', false, `Адрес игры: ${m}`, f); }
        else if (r.status >= 300 && r.status < 400) add('client_url', false, `Адрес игры отвечает редиректом (${r.status}). Sky не переходит по редиректам.`, `Укажите конечный адрес: ${String(r.headers.location ?? '').slice(0, 200)}`);
        else if (r.status !== 200) add('client_url', false, `Адрес игры ответил кодом ${r.status}.`, 'Страница игры должна отвечать 200.');
        else if (!/text\/html/i.test(String(r.headers['content-type'] ?? ''))) add('client_url', false, 'Адрес игры отдаёт не HTML-страницу.', 'Укажите адрес страницы с игрой (index.html).');
        else {
          const frame = sameOriginFrame(r.headers);
          if (!frame.ok) add('framing', false, `Игру нельзя открыть в окне Sky (${frame.why}).`, 'Уберите X-Frame-Options и добавьте Content-Security-Policy: frame-ancestors ' + (config.publicOrigin || 'https://ваш-домен-sky') + '.');
          else add('framing', true, 'Игру можно открыть в окне Sky.');
          add('client_url', true, `Страница игры доступна (${r.ms} мс).`);
          if (!/<html|<!doctype/i.test(r.body)) add('html', false, 'В ответе не найдена HTML-разметка.', 'Проверьте, что адрес ведёт на страницу игры.');
        }
      }
    }

    /* — адрес сервера: подписанный ответ — */
    if (game.server_url) {
      const base = await resolveSafeUrl(game.server_url, { label: 'Адрес сервера' });
      if (!base.ok) add('server_url', false, base.message, base.fix);
      else {
        const nonce = crypto.randomBytes(16).toString('hex');
        const probeUrl = new URL('/sky/health', base.url);
        const t = { ...base, url: probeUrl };
        const secret = decryptContent(game.secret_enc);
        const r = await fetchPinned(t, { headers: { Accept: 'application/json', 'X-Sky-Challenge': nonce } });
        if (!r.ok) { const [m, f] = netMessage(r.error); add('server_url', false, `Сервер: ${m}`, f); }
        else if (r.status === 404) add('server_url', false, 'Сервер отвечает, но /sky/health не найден.', 'Добавьте ручку GET /sky/health — она должна вернуть JSON {"ok":true,"protocol":1,"signature":HMAC-SHA256(секрет, X-Sky-Challenge)}.');
        else if (r.status !== 200) add('server_url', false, `/sky/health ответил кодом ${r.status}.`, 'Ручка должна отвечать 200.');
        else {
          let j = null; try { j = JSON.parse(r.body); } catch { /* ниже */ }
          if (!j || j.ok !== true) add('server_url', false, 'Ответ /sky/health не JSON с "ok": true.', 'Верните {"ok":true,"protocol":1,"signature":"…"}.');
          else if (j.protocol !== 1) add('protocol', false, `Версия протокола ${j.protocol ?? 'не указана'}; поддерживается 1.`, 'Укажите "protocol": 1.');
          else if (!j.signature || !safeEq(String(j.signature).toLowerCase(), hmacHex(secret, nonce))) {
            add('signature', false, 'Подпись неверна: сервер не знает секрет проекта или считает её иначе.', 'signature = HMAC-SHA256(секретный ключ проекта, значение заголовка X-Sky-Challenge) в hex.');
          } else add('server_url', true, `Сервер отвечает и подтвердил секрет проекта (${r.ms} мс).`);
        }
      }
    } else {
      add('server_url', true, 'Адрес сервера не задан — игра без серверной части (покупки и серверные рейтинги недоступны).');
    }

    const hard = checks.filter((c) => !c.ok);
    const ok = hard.length === 0 && Boolean(game.client_url);
    const firstBad = hard[0];
    const details = { checks, source, at: new Date().toISOString() };
    await query(
      `UPDATE blox_games SET conn_status = $2, conn_checked_at = now(), conn_error = $3, conn_details = $4::jsonb, updated_at = now() WHERE id = $1`,
      [game.id, ok ? 'ok' : 'failed', ok ? '' : `${firstBad?.message ?? 'Проверка не пройдена'}`.slice(0, 300), JSON.stringify(details)]);
    await query(
      'INSERT INTO blox_probe_log (game_id, kind, ok, detail, ms) VALUES ($1,$2,$3,$4,NULL)',
      [game.id, source, ok, ok ? 'ok' : (firstBad?.message ?? '').slice(0, 300)]);
    return { ok, checks, advice: hostingAdvice(game.hosting_type, { hasServer: Boolean(game.server_url) }) };
  });
  if (ran.error === 'busy') {
    return { busy: true, ok: false, checks: [], message: 'Сейчас идёт много проверок. Повторите через минуту.' };
  }
  return ran.value;
};

/* ─── Автоматическая проверка содержимого ──────────────────────────── */

const SHORTENERS = /(^|\.)(bit\.ly|t\.co|tinyurl\.com|goo\.gl|clck\.ru|cutt\.ly|is\.gd|vk\.cc|rb\.gy)$/i;
const SUSPICIOUS = [
  [/(бесплатн\w*|халяв\w*)\s+(робукс|валют|прайм|баллы)/i, 'Обещание бесплатной валюты — частая схема обмана'],
  [/(введите|пришлите|отправьте)\s+(пароль|код из (смс|sms|письма)|данные карты)/i, 'Запрос паролей, кодов или данных карты'],
  [/(взлом|читы?|хак)\s+(аккаунт|баланс|prime)/i, 'Упоминание взлома аккаунтов или баланса'],
  [/18\+|порно|эротик/i, 'Возможный контент для взрослых'],
];

/**
 * Простые автоматические проверки названия, описания и ссылок. Это
 * подсказка модератору, а не вердикт: отсутствие замечаний не значит,
 * что содержимое проверено, и в интерфейсе так и написано.
 */
export const autoCheck = ({ title = '', description = '', urls = [] }) => {
  const f = [];
  const text = `${title}\n${description}`;
  for (const [re, why] of SUSPICIOUS) if (re.test(text)) f.push({ severity: 'high', code: 'text', message: why });
  const links = text.match(/https?:\/\/[^\s)]+/gi) ?? [];
  if (links.length > 3) f.push({ severity: 'medium', code: 'links', message: `В тексте много внешних ссылок (${links.length}).` });
  for (const l of [...links, ...urls]) {
    let h = '';
    try { h = new URL(l).hostname; } catch { f.push({ severity: 'medium', code: 'bad_link', message: `Некорректная ссылка: ${String(l).slice(0, 80)}` }); continue; }
    if (SHORTENERS.test(h)) f.push({ severity: 'high', code: 'shortener', message: `Сокращатель ссылок скрывает адрес: ${h}` });
    if (net.isIP(h)) f.push({ severity: 'medium', code: 'ip_link', message: `Ссылка на IP-адрес вместо домена: ${h}` });
    if (/xn--/.test(h)) f.push({ severity: 'medium', code: 'punycode', message: `Домен с punycode (возможная подмена символов): ${h}` });
  }
  if (title.length > 0 && title === title.toUpperCase() && /[A-ZА-Я]{12,}/.test(title)) f.push({ severity: 'low', code: 'caps', message: 'Название написано заглавными буквами.' });
  if (/(.)\1{9,}/.test(text)) f.push({ severity: 'low', code: 'repeat', message: 'Повторяющиеся символы в тексте.' });
  return f;
};
