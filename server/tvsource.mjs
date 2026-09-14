/**
 * Куда Sky TV имеет право ходить за эфиром.
 *
 * Это единственная дверь наружу во всём телевидении. Ни одна ручка не
 * принимает от клиента адрес — такого параметра нет нигде, — поэтому
 * подставить сюда чужую ссылку нельзя в принципе. Но и адреса, которые
 * завёл владелец, проверяются каждый раз заново, и вот почему.
 *
 * Узел может разрешиться во внутренний адрес. Это не выдумка: достаточно
 * завести у себя имя, указывающее на 127.0.0.1 или на адрес соседнего
 * контейнера, — и запрос, который выглядит как поход за эфиром, уходит
 * к нашей же базе или к служебной ручке. Поэтому:
 *
 *   1. узел сверяется с белым списком владельца;
 *   2. имя разрешается в адреса, и каждый адрес проверяется на
 *      принадлежность к внутренним сетям;
 *   3. соединение открывается именно к проверенному адресу, а не к
 *      имени. Это важнее, чем кажется: между проверкой и соединением
 *      ответ службы имён может поменяться — первый раз отдать чужой
 *      адрес, второй раз свой. Если соединяться по имени, вся проверка
 *      выше становится украшением;
 *   4. переход по перенаправлению — это новый адрес, и он проходит всё
 *      то же самое с начала.
 *
 * Наружу отсюда не уходит ничего: ни адрес источника, ни заголовки, ни
 * причина отказа. Всё это остаётся в журнале сервера.
 */
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from './config.mjs';

/** Дольше ждать эфир незачем: зритель за это время уйдёт. */
const TIMEOUT_MS = 8000;
/** Манифест — это текст на несколько килобайт. Мегабайт здесь с запасом. */
const MAX_MANIFEST_BYTES = 1024 * 1024;
/** Столько перенаправлений подряд. Больше — это уже петля. */
const MAX_REDIRECTS = 4;

/* ─── Разбор и проверка адреса ─────────────────────────────────────── */

export class SourceRejected extends Error {
  constructor(reason, detail) {
    super(reason);
    this.reason = reason;
    this.detail = detail ?? '';
  }
}

/**
 * Разрешён ли узел белым списком владельца.
 *
 * Совпадение либо точное, либо по поддомену: сети доставки раскиданы
 * по «edge17.example.com», и перечислять их поимённо невозможно. А вот
 * обратное — «example.com.злоумышленник.рф» — совпадением не считается,
 * потому что сравнивается конец имени вместе с точкой.
 */
const hostAllowed = (hostname) => {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return config.tvAllowedHosts.some((a) => host === a || host.endsWith(`.${a}`));
};

/**
 * Внутренний ли это адрес.
 *
 * Перечислены не «подозрительные» диапазоны, а все, которые не ведут в
 * открытый интернет: свои, частные, служебные, связные, а также адрес
 * облачной службы сведений о машине — классическая цель такой атаки.
 */
const isPrivateAddress = (ip) => {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0) return true;                       // «этот» узел
    if (a === 10) return true;                      // частная сеть
    if (a === 127) return true;                     // сам себе
    if (a === 169 && b === 254) return true;        // связный адрес и сведения о машине
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;          // служебное назначение
    if (a === 100 && b >= 64 && b <= 127) return true; // общий адрес оператора
    if (a === 198 && (b === 18 || b === 19)) return true; // для измерений
    if (a >= 224) return true;                      // групповые и зарезервированные
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    if (s.startsWith('fe80')) return true;          // связные
    if (/^f[cd]/.test(s)) return true;              // частные
    if (s.startsWith('ff')) return true;            // групповые
    // Адрес IPv4, записанный внутри IPv6: проверяем его самого.
    const m = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateAddress(m[1]);
    return false;
  }
  return true;
};

/**
 * Проверка адреса до всякого соединения. Возвращает разобранный адрес
 * и список проверенных числовых адресов узла.
 */
export const checkUrl = async (raw) => {
  let u;
  try { u = new URL(String(raw ?? '')); } catch { throw new SourceRejected('bad_url'); }

  // Только https: по обычному http эфир можно подменить по дороге, а
  // заодно увести заголовок с ключом доступа.
  if (u.protocol !== 'https:') throw new SourceRejected('bad_protocol', u.protocol);
  // Имя и пароль в адресе — способ передать учётные данные туда, куда
  // мы их отправлять не собирались.
  if (u.username || u.password) throw new SourceRejected('credentials_in_url');
  // Порт либо обычный, либо не указан. Всё остальное — это попытка
  // достучаться до служебной двери на разрешённом узле.
  if (u.port && u.port !== '443') throw new SourceRejected('bad_port', u.port);
  // Числовой адрес вместо имени белый список не проходит никогда.
  // Скобки у IPv6 снимаем до проверки: «[::1]» — это тоже числовой
  // адрес, и отказать по нему надо с честной причиной, а не по тому,
  // что такой строки нет в списке узлов.
  const bare = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) throw new SourceRejected('ip_not_allowed', bare);
  if (!hostAllowed(u.hostname)) throw new SourceRejected('host_not_allowed', u.hostname);

  let records;
  try {
    records = await dns.lookup(u.hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new SourceRejected('dns_failed', err.code ?? '');
  }
  if (!records.length) throw new SourceRejected('dns_empty');
  // Достаточно одного внутреннего адреса среди ответов, чтобы отказать
  // целиком: какой из них выберет система при соединении — не наше дело.
  for (const r of records) {
    if (isPrivateAddress(r.address)) throw new SourceRejected('private_address', r.address);
  }
  return { url: u, addresses: records.map((r) => r.address) };
};

/* ─── Запрос ───────────────────────────────────────────────────────── */

/**
 * Один запрос к проверенному адресу.
 *
 * Соединение открывается к числовому адресу из проверки: подменить
 * ответ службы имён между проверкой и соединением нельзя, потому что
 * второй раз её никто не спрашивает.
 */
const requestOnce = (u, address, { method, headers, range }) => new Promise((resolve, reject) => {
  const req = https.request({
    protocol: 'https:',
    host: address,
    // Имя узла нужно и для заголовка, и для проверки сертификата:
    // соединяемся по адресу, но убеждаемся, что на том конце тот, к
    // кому шли.
    servername: u.hostname,
    port: u.port || 443,
    path: `${u.pathname}${u.search}`,
    method,
    headers: {
      Host: u.hostname,
      'User-Agent': 'SkyTV/1.0',
      'Accept-Encoding': 'identity',
      ...(range ? { Range: range } : {}),
      ...headers,
    },
    timeout: TIMEOUT_MS,
    // Перенаправления разбираем сами: каждое из них — новый адрес,
    // который обязан пройти проверку заново.
    followRedirects: false,
  }, (res) => resolve(res));
  req.on('timeout', () => { req.destroy(new SourceRejected('timeout')); });
  req.on('error', (err) => reject(err instanceof SourceRejected ? err : new SourceRejected('network', err.code ?? '')));
  req.end();
});

/**
 * Запрос с разбором перенаправлений. Каждый переход проходит проверку
 * узла и адреса с самого начала.
 */
export const fetchSource = async (rawUrl, { method = 'GET', headers = {}, range } = {}) => {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const { url, addresses } = await checkUrl(current);
    const res = await requestOnce(url, addresses[0], { method, headers, range });

    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      const next = res.headers.location;
      res.resume();
      if (!next) throw new SourceRejected('redirect_without_target');
      // Относительный адрес разрешаем относительно нынешнего — и снова
      // проверяем целиком, а не «раз узел тот же, значит можно».
      current = new URL(next, url).toString();
      continue;
    }
    return { res, url, finalUrl: url.toString() };
  }
  throw new SourceRejected('too_many_redirects');
};

/** Прочитать небольшой ответ целиком. Только для манифестов и расписания. */
export const readAll = (res, limit = MAX_MANIFEST_BYTES) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  res.on('data', (c) => {
    size += c.length;
    if (size > limit) { res.destroy(); reject(new SourceRejected('too_large')); return; }
    chunks.push(c);
  });
  res.on('end', () => resolve(Buffer.concat(chunks)));
  res.on('error', (err) => reject(new SourceRejected('network', err.code ?? '')));
});

/**
 * Проверка здоровья источника: жив ли, отвечает ли манифестом и как
 * быстро. Наружу из этого уходит только «да» или «нет».
 */
export const probeSource = async (rawUrl, headers, kind) => {
  const started = Date.now();
  try {
    const { res } = await fetchSource(rawUrl, { headers });
    const code = res.statusCode;
    if (code < 200 || code >= 300) {
      res.resume();
      return { ok: false, statusCode: code, detail: `ответ ${code}`, latencyMs: Date.now() - started };
    }
    const body = (await readAll(res, 256 * 1024)).toString('utf8');
    const latencyMs = Date.now() - started;
    // Манифест должен быть манифестом. Страница с ошибкой или заглушка
    // оператора тоже отвечают «двести», и без этой проверки канал
    // считался бы исправным, пока зритель не нажмёт «смотреть».
    const looksRight = kind === 'dash'
      ? /<MPD[\s>]/i.test(body)
      : body.trimStart().startsWith('#EXTM3U');
    if (!looksRight) {
      return { ok: false, statusCode: code, detail: 'ответ не похож на манифест', latencyMs };
    }
    return { ok: true, statusCode: code, detail: '', latencyMs };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      detail: err instanceof SourceRejected ? `${err.reason} ${err.detail}`.trim() : 'сбой запроса',
      latencyMs: Date.now() - started,
    };
  }
};

export { hostAllowed, isPrivateAddress, MAX_MANIFEST_BYTES };
