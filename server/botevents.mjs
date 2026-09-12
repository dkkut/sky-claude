/**
 * Очередь событий бота и её доставка на сервер владельца.
 *
 * Два способа, и выбирает владелец:
 *
 *   poll — программа сама приходит за событиями и висит на запросе,
 *          пока они не появятся. Работает за NAT, за домашним роутером,
 *          в контейнере без входящего порта — то есть почти везде.
 *          Поэтому он по умолчанию.
 *
 *   webhook — Sky сам стучится по адресу владельца. Нужен тем, у кого
 *          уже есть веб-сервер и не хочется держать процесс на связи.
 *          Требует белого адреса и https.
 *
 * Событие не пропадает, если сервер владельца выключен: оно лежит в
 * очереди сутки. Выданное программе событие считается доставленным
 * только после подтверждения — упавшая на полпути программа получит
 * его снова, а не потеряет.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { logBot } from './bots.mjs';
import { webhookTarget } from './botruntime.mjs';

/** Потолок неподтверждённых событий на бота. */
const MAX_QUEUE = 500;
/** Сколько событий отдаётся за один заход. */
const BATCH = 20;
/** Через сколько выданное, но не подтверждённое событие выдаётся снова. */
const REDELIVER_SEC = 60;
/** Сколько раз пытаемся отдать одно событие, прежде чем бросить. */
const MAX_ATTEMPTS = 10;
/** Максимум ожидания на long-poll. Дольше — и промежуточные прокси рвут связь. */
export const MAX_WAIT_MS = 25_000;

/* ─── Ожидающие ────────────────────────────────────────────────────
   botId → набор функций «разбуди меня». Когда приходит событие, ждущий
   запрос просыпается сразу, а не через секунду опроса базы. Список
   живёт в памяти процесса и теряется при перезапуске — это не страшно:
   ждущий запрос в худшем случае досидит свой таймаут и вернётся пустым,
   а событие останется в базе. */
const waiters = new Map();

const wake = (botId) => {
  const set = waiters.get(botId);
  if (!set) return;
  for (const fn of set) { try { fn(); } catch { /* уже разбужен */ } }
};

/**
 * Ждёт событие или обрыв.
 *
 * `onAbort` — способ разбудить ожидание, когда программа владельца
 * отвалилась. Без этого сервер продолжал бы держать её запрос и,
 * дождавшись события, забрал бы его в мёртвое соединение.
 */
const waitForEvent = (botId, ms, register) => new Promise((resolve) => {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    const set = waiters.get(botId);
    if (set) { set.delete(finish); if (set.size === 0) waiters.delete(botId); }
    resolve();
  };
  const timer = setTimeout(finish, ms);
  timer.unref?.();
  if (!waiters.has(botId)) waiters.set(botId, new Set());
  waiters.get(botId).add(finish);
  register?.(finish);
});

/* ─── Складывание ──────────────────────────────────────────────────── */

/**
 * Кладёт событие в очередь.
 *
 * Тело шифруется: в событии едет текст сообщения, то есть содержимое
 * переписки, и в дампе базы ему не место — по тем же причинам, что и
 * самим сообщениям.
 *
 * Возвращает id события или null, если очередь переполнена. Переполнение
 * — это не ошибка отправителя: сервер владельца просто давно выключен.
 */
export const enqueue = async (botId, type, payload, chatId = null) => {
  const { rows: sized } = await query(
    'SELECT count(*)::int AS n FROM bot_events WHERE bot_id = $1 AND acked_at IS NULL',
    [botId],
  );
  if (sized[0].n >= MAX_QUEUE) {
    /* Пишем один раз на переполнение, а не на каждое событие: иначе
       журнал заполнится тем же самым. */
    if (sized[0].n === MAX_QUEUE) {
      await logBot(botId, 'warn', 'queue.full',
        `очередь заполнена (${MAX_QUEUE}), новые события отбрасываются — сервер не забирает их`);
    }
    return null;
  }

  const { rows } = await query(
    'INSERT INTO bot_events (bot_id, type, chat_id, payload) VALUES ($1,$2,$3,$4) RETURNING id',
    [botId, String(type).slice(0, 32), chatId, encryptContent(JSON.stringify(payload ?? {}))],
  );
  const id = String(rows[0].id);
  wake(botId);
  /* Вебхук уходит отдельно и не задерживает того, кто положил событие:
     если сервер владельца отвечает медленно, это его дело, а не
     проблема отправителя сообщения. */
  void deliverWebhook(botId).catch(() => {});
  return id;
};

/* ─── Выдача (poll) ────────────────────────────────────────────────── */

const toEvent = (row) => {
  let body = {};
  try { body = JSON.parse(decryptContent(row.payload)); } catch { body = {}; }
  return {
    id: String(row.id),
    type: row.type,
    chatId: row.chat_id ?? undefined,
    at: row.created_at.toISOString(),
    data: body,
  };
};

/**
 * Забирает партию событий.
 *
 * Берутся и новые, и те, что выдавались больше минуты назад и не были
 * подтверждены: программа могла упасть между «получил» и «обработал».
 * Отметка taken_at ставится тем же запросом, что и выбирает строки,
 * поэтому две одновременные программы одного бота не получат одно
 * событие дважды.
 */
export const take = async (botId, runtimeId, limit = BATCH) => {
  const { rows } = await query(
    `UPDATE bot_events SET taken_at = now(), taken_by = $2, attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM bot_events
         WHERE bot_id = $1 AND acked_at IS NULL AND attempts < $4
           AND (taken_at IS NULL OR taken_at < now() - ($5 || ' seconds')::interval)
         ORDER BY id
         LIMIT $3
         FOR UPDATE SKIP LOCKED)
      RETURNING id, type, chat_id, payload, created_at`,
    [botId, runtimeId, Math.min(Math.max(Number(limit) || BATCH, 1), BATCH),
     MAX_ATTEMPTS, String(REDELIVER_SEC)],
  );
  return rows.map(toEvent);
};

/**
 * Ждёт события, если их сейчас нет.
 *
 * Это и есть «постоянное соединение» со стороны программы: она держит
 * один запрос, Sky отвечает в момент появления события. Пустой ответ
 * по таймауту — нормальная часть схемы, программа сразу спрашивает
 * снова.
 */
export const takeOrWait = async (botId, runtimeId, waitMs, { onAbort } = {}) => {
  const first = await take(botId, runtimeId);
  if (first.length > 0) return first;
  const ms = Math.min(Math.max(Number(waitMs) || 0, 0), MAX_WAIT_MS);
  if (ms === 0) return [];
  await waitForEvent(botId, ms, onAbort);
  return take(botId, runtimeId);
};

/**
 * Возвращает выданные события обратно в очередь.
 *
 * Нужно, когда соединение оборвалось между «взяли» и «отдали»:
 * перезапуск программы владельца, потеря сети, убитый контейнер.
 * Без этого событие считалось бы выданным и пряталось на минуту —
 * ровно в тот момент, когда программа поднялась и ждёт работу.
 *
 * Счётчик попыток тоже откатываем: попытки не было, отдать не успели.
 */
export const releaseTaken = async (botId, ids) => {
  const list = (Array.isArray(ids) ? ids : [])
    .map((v) => Number(v)).filter((v) => Number.isSafeInteger(v) && v > 0);
  if (list.length === 0) return 0;
  const { rowCount } = await query(
    `UPDATE bot_events
        SET taken_at = NULL, taken_by = NULL, attempts = GREATEST(attempts - 1, 0)
      WHERE bot_id = $1 AND id = ANY($2::bigint[]) AND acked_at IS NULL`,
    [botId, list],
  );
  if (rowCount) wake(botId);
  return rowCount;
};

/**
 * Подтверждение обработки.
 *
 * Условие bot_id = $1 здесь не для порядка: без него программа одного
 * бота могла бы подтвердить (то есть погасить) события другого, зная
 * только номер.
 */
export const ack = async (botId, ids) => {
  const list = (Array.isArray(ids) ? ids : []).slice(0, 200)
    .map((v) => Number(v)).filter((v) => Number.isSafeInteger(v) && v > 0);
  if (list.length === 0) return 0;
  const { rowCount } = await query(
    'UPDATE bot_events SET acked_at = now() WHERE bot_id = $1 AND id = ANY($2::bigint[]) AND acked_at IS NULL',
    [botId, list],
  );
  return rowCount;
};

/* ─── Вебхук ───────────────────────────────────────────────────────── */

/**
 * Подпись доставки.
 *
 * Подписывается не только тело, но и время с номером доставки. Без
 * времени перехваченный запрос можно повторять вечно; без номера —
 * повторить его же и получить двойную обработку. Программа обязана
 * отвергать доставку старше пяти минут и запоминать номера — так
 * написано в SDK и в README.
 */
export const signDelivery = (secret, deliveryId, timestamp, body) =>
  crypto.createHmac('sha256', secret)
    .update(`v1:${deliveryId}:${timestamp}:${body}`)
    .digest('hex');

/** Разрешено ли соединяться с этим адресом (проверяется после разрешения имени). */
const isPrivateAddress = (ip) => {
  if (!ip) return true;
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    /* Уникальные локальные (fc00::/7) и link-local (fe80::/10). */
    if (/^f[cd]/.test(v) || /^fe[89ab]/.test(v)) return true;
    /* IPv4 внутри IPv6 — тот же внутренний адрес другими буквами. */
    const mapped = v.match(/(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || a >= 224;
};

/**
 * Сам адрес назначения после разрешения имени.
 *
 * Проверка имени при настройке отсекает явное (`localhost`, литеральный
 * адрес), но имя может указывать куда угодно, в том числе на 127.0.0.1
 * или на адрес внутри docker-сети — и владелец домена волен поменять
 * запись в любой момент. Поэтому имя разрешается здесь, перед самой
 * отправкой, и внутренний адрес отбивается.
 */
const resolveSafe = async (hostname) => {
  const dns = await import('node:dns/promises');
  let addrs;
  try { addrs = await dns.lookup(hostname, { all: true }); } catch { return null; }
  if (!addrs.length) return null;
  if (addrs.some((a) => isPrivateAddress(a.address))) return null;
  return addrs[0].address;
};

const WEBHOOK_TIMEOUT_MS = 10_000;
/**
 * Быстрые повторы внутри одной доставки. Дальше событие просто остаётся
 * в очереди, и его подберёт retryPendingWebhooks — держать процесс час
 * ради одного бота нельзя, а событие никуда не денется.
 */
const RETRY_STEPS_MS = [0, 2_000, 8_000];

/* Чтобы не гнать по вебхуку несколько доставок одного бота разом. */
const sending = new Set();

/**
 * Один POST на проверенный адрес.
 *
 * Соединение открывается именно к тому адресу, который признан внешним:
 * lookup подменён и возвращает только его. Без этого между проверкой
 * имени и запросом остаётся щель — владелец домена волен в этот момент
 * поменять запись на 127.0.0.1, и запрос уйдёт внутрь сети. Проверка
 * имени сертификата при этом сохраняется: servername берётся из адреса,
 * а не из того, куда мы соединились.
 */
const postTo = (url, address, headers, body) => new Promise((resolve, reject) => {
  import('node:https').then(({ default: https }) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
      servername: url.hostname,
      lookup: (_host, opts, cb) => cb(null, address, address.includes(':') ? 6 : 4),
      timeout: WEBHOOK_TIMEOUT_MS,
    }, (res) => {
      /* Ответ нам не нужен — важен только код. Тело сливаем, иначе
         соединение не освободится. */
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('timeout', () => { req.destroy(new Error('нет ответа за 10 с')); });
    req.on('error', reject);
    req.end(body);
  }).catch(reject);
});

/**
 * Отправляет накопленные события по вебхуку.
 *
 * Одна доставка — одна партия. Неподтверждённые события остаются в
 * очереди: сервер владельца может ответить ошибкой или вовсе не
 * ответить, и тогда партия уйдёт снова следующей попыткой.
 */
export const deliverWebhook = async (botId) => {
  if (sending.has(botId)) return;
  const target = await webhookTarget(botId);
  if (!target) return;

  sending.add(botId);
  try {
    const events = await take(botId, target.runtimeId, BATCH);
    if (events.length === 0) return;

    const deliveryId = crypto.randomUUID();
    const body = JSON.stringify({ deliveryId, botId, events });
    const url = new URL(target.url);

    const address = await resolveSafe(url.hostname);
    if (!address) {
      await logBot(botId, 'error', 'webhook.blocked',
        `адрес ${url.hostname} разрешается во внутренний или не разрешается вовсе`);
      return;
    }

    let lastError = '';
    for (let attempt = 0; attempt < RETRY_STEPS_MS.length; attempt += 1) {
      if (RETRY_STEPS_MS[attempt] > 0) {
        await new Promise((r) => { const t = setTimeout(r, RETRY_STEPS_MS[attempt]); t.unref?.(); });
      }
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signDelivery(target.secret, deliveryId, timestamp, body);

      try {
        const status = await postTo(url, address, {
          'Content-Type': 'application/json',
          'X-Sky-Delivery': deliveryId,
          'X-Sky-Timestamp': timestamp,
          'X-Sky-Signature': `v1=${signature}`,
          'User-Agent': 'SkyBots/1.0',
        }, body);
        if (status >= 200 && status < 300) {
          await ack(botId, events.map((e) => e.id));
          await logBot(botId, 'info', 'webhook.delivered', `событий: ${events.length}`);
          return;
        }
        lastError = `ответ ${status}`;
        /* 4xx, кроме «слишком часто», повторять бессмысленно: это не
           временный сбой, а отказ разбирать такую доставку. */
        if (status >= 400 && status < 500 && status !== 429) break;
      } catch (err) {
        lastError = String(err?.message ?? err).slice(0, 120);
      }
    }
    await logBot(botId, 'error', 'webhook.failed', `не доставлено: ${lastError}`);
  } finally {
    sending.delete(botId);
  }
};

/**
 * Досылка того, что осталось в очереди у вебхучных ботов.
 *
 * Нужна после перезапуска Sky и после того, как сервер владельца
 * поднялся: первая попытка могла прийтись на то время, когда он лежал.
 */
export const retryPendingWebhooks = async () => {
  const { rows } = await query(
    `SELECT DISTINCT e.bot_id FROM bot_events e
       JOIN bot_runtimes r ON r.bot_id = e.bot_id AND r.revoked_at IS NULL AND r.delivery = 'webhook'
      WHERE e.acked_at IS NULL AND e.attempts < $1
      LIMIT 50`,
    [MAX_ATTEMPTS],
  );
  for (const { bot_id: botId } of rows) void deliverWebhook(botId).catch(() => {});
  return rows.length;
};

/* ─── Ответ на inline-запрос ───────────────────────────────────────
   Inline работает иначе, чем сообщение: человек ждёт ответа прямо
   сейчас, в поле ввода. Поэтому здесь не очередь, а короткое ожидание
   в памяти процесса — секунд десять. Не успел сервер владельца —
   человек увидит «бот не ответил», а не будет ждать вечно. */

const inlineWaiters = new Map();

export const awaitInlineAnswer = (queryId, ms) => new Promise((resolve) => {
  let done = false;
  const finish = (value) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    inlineWaiters.delete(queryId);
    resolve(value ?? null);
  };
  const timer = setTimeout(() => finish(null), ms);
  timer.unref?.();
  inlineWaiters.set(queryId, finish);
});

/**
 * Ответ от программы владельца.
 *
 * Возвращает false, если такого запроса нет: он мог истечь, а мог быть
 * чужим. Различать эти случаи снаружи не нужно — по разнице ответов
 * можно было бы выяснять, какие запросы существуют.
 */
export const resolveInlineAnswer = (queryId, results) => {
  const fn = inlineWaiters.get(queryId);
  if (!fn) return false;
  fn(results);
  return true;
};
