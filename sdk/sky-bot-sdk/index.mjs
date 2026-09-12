/**
 * Sky Bot SDK — работает НА СЕРВЕРЕ ВЛАДЕЛЬЦА БОТА.
 *
 * Это единственная часть Sky Bots, которая выполняет код бота. Она
 * ставится на машину владельца и оттуда подключается к Sky. Сервер Sky
 * ничего из этого файла не запускает и запустить не может: он даже не
 * знает адреса той машины.
 *
 * Что делает:
 *   · один раз меняет код привязки на постоянные учётные данные;
 *   · хранит их в файле рядом с собой (0600), а не в коде;
 *   · получает события — висит на длинном запросе, ответ приходит в
 *     момент появления события;
 *   · зовёт обработчик, написанный владельцем;
 *   · отправляет ответы через Bot API;
 *   · сам переподключается после обрыва и после того, как машину
 *     включили обратно;
 *   · обновляет токен доступа до того, как тот истечёт.
 *
 * Зависимостей нет: только то, что есть в Node 18+.
 */
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_API = 'https://sky.example/api/bots/rt';
const SDK_NAME = 'node';
export const VERSION = '1.0.0';

/** Пауза с нарастанием: 1, 2, 4… до минуты. Без этого обрыв связи
    превращается в тысячу запросов в секунду к лежащему серверу. */
const backoff = (attempt) => Math.min(1000 * 2 ** Math.min(attempt, 6), 60_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class SkyBotError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export class SkyBot {
  /**
   * @param {object} opts
   * @param {string} [opts.api]        адрес Bot API
   * @param {string} [opts.stateFile]  куда класть учётные данные
   * @param {string} [opts.pairingCode] код из «Мои боты → Подключить сервер»
   * @param {string} [opts.label]      как назвать этот сервер в списке
   */
  constructor(opts = {}) {
    this.api = (opts.api || process.env.SKY_BOT_API || DEFAULT_API).replace(/\/+$/, '');
    this.stateFile = resolve(opts.stateFile || process.env.SKY_BOT_STATE || './.sky-bot.json');
    this.pairingCode = opts.pairingCode || process.env.SKY_BOT_PAIRING_CODE || '';
    this.label = opts.label || process.env.SKY_BOT_LABEL || 'сервер владельца';

    this.creds = null;     // { runtimeId, runtimeSecret }
    this.token = null;
    this.tokenUntil = 0;
    this.handlers = new Map();
    this.running = false;
    this.me = null;
  }

  /* ─── Обработчики ──────────────────────────────────────────────── */

  /**
   * on('message' | 'start' | 'inline_query', fn)
   *
   * Здесь и работает код владельца. Sky его не видит и не запускает —
   * он живёт в этом процессе, на этой машине.
   */
  on(type, fn) { this.handlers.set(type, fn); return this; }

  /* ─── Учётные данные ───────────────────────────────────────────── */

  async #loadState() {
    try {
      const raw = JSON.parse(await readFile(this.stateFile, 'utf8'));
      if (raw?.runtimeId && raw?.runtimeSecret) return raw;
    } catch { /* файла ещё нет — это первый запуск */ }
    return null;
  }

  async #saveState(state) {
    await mkdir(dirname(this.stateFile), { recursive: true });
    await writeFile(this.stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
    /* На случай, если файл уже существовал с другими правами. */
    try { await chmod(this.stateFile, 0o600); } catch { /* Windows */ }
  }

  /**
   * Обмен кода привязки на учётные данные.
   *
   * Делается один раз. Дальше код не нужен и не сработает повторно —
   * он одноразовый на стороне Sky.
   */
  async #pair() {
    if (!this.pairingCode) {
      throw new SkyBotError(
        'Нет учётных данных и нет кода привязки. Откройте «Мои боты» → ваш бот → '
        + '«Подключить сервер», получите код и передайте его через SKY_BOT_PAIRING_CODE.',
      );
    }
    const res = await fetch(`${this.api}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: this.pairingCode, label: this.label, version: VERSION, sdk: SDK_NAME,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new SkyBotError(body.error || 'pairing_failed', res.status);

    const state = {
      runtimeId: body.runtimeId,
      runtimeSecret: body.runtimeSecret,
      botId: body.botId,
      /* Ключ подписи вебхука нужен только тем, кто выбрал вебхук. */
      ...(body.webhookSecret ? { webhookSecret: body.webhookSecret } : {}),
    };
    await this.#saveState(state);
    /* Код в памяти больше не держим: он уже недействителен. */
    this.pairingCode = '';
    console.log(`[sky-bot] сервер привязан, учётные данные сохранены в ${this.stateFile}`);
    return state;
  }

  /**
   * Короткоживущий токен доступа.
   *
   * Долгоживущий секрет в каждом запросе не летает: перехваченный токен
   * протухнет сам через час, а секрет — нет.
   */
  async #refreshToken() {
    const res = await fetch(`${this.api}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runtimeId: this.creds.runtimeId, runtimeSecret: this.creds.runtimeSecret,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new SkyBotError(body.error || 'auth_failed', res.status);

    this.token = body.token;
    /* Обновляем за минуту до конца: иначе первый же запрос после
       истечения получит 401 и потеряет событие. */
    this.tokenUntil = Date.now() + (body.expiresIn - 60) * 1000;
    return body;
  }

  async #ensureToken() {
    if (this.token && Date.now() < this.tokenUntil) return this.token;
    await this.#refreshToken();
    return this.token;
  }

  /* ─── Запросы к Bot API ────────────────────────────────────────── */

  async #call(method, path, { body, query, timeoutMs = 15_000, retryOn401 = true } = {}) {
    const token = await this.#ensureToken();
    const url = new URL(this.api + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });

    /* Токен мог протухнуть раньше срока — например, сервер Sky
       перезапустили. Одна попытка обновить его, и только одна: если
       учётные данные отозваны, повторять бессмысленно. */
    if (res.status === 401 && retryOn401) {
      this.token = null;
      return this.#call(method, path, { body, query, timeoutMs, retryOn401: false });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new SkyBotError(data.error || `http_${res.status}`, res.status);
    return data;
  }

  /* ─── Действия бота ────────────────────────────────────────────── */

  /** Написать в чат. Автором будет сам бот. */
  send(chatId, text, opts = {}) {
    return this.#call('POST', '/send', { body: { chatId, text, replyTo: opts.replyTo } });
  }

  /**
   * Ответ на inline-запрос.
   *
   * Сообщение НЕ отправляется: это только предложения. Отправит их
   * человек — в Sky у него появится подтверждение.
   */
  answerInline(queryId, results) {
    return this.#call('POST', '/inline/answer', { body: { queryId, results } });
  }

  /** Рассказать Sky о своей беде — владелец увидит это в карточке бота. */
  reportError(message) {
    return this.#call('POST', '/error', { body: { message: String(message).slice(0, 300) } })
      .catch(() => {});
  }

  /* ─── Главный цикл ─────────────────────────────────────────────── */

  /**
   * Подключается и работает, пока не остановят.
   *
   * Обрыв связи, перезагрузка машины, выключенный на ночь сервер — всё
   * это не ломает бота: он просто подключается снова, а события ждут
   * его в очереди на стороне Sky (сутки).
   */
  async start() {
    this.creds = await this.#loadState() ?? await this.#pair();
    this.running = true;

    let attempt = 0;
    while (this.running) {
      try {
        if (!this.me) {
          this.me = await this.#call('GET', '/me');
          console.log(`[sky-bot] на связи: ${this.me.name} ${this.me.username} (${this.me.status})`);
        }
        const { events } = await this.#call('GET', '/events', {
          query: { wait: 25000, version: VERSION, sdk: SDK_NAME },
          /* Ждать чуть дольше самого ожидания: иначе клиент рвёт
             соединение ровно тогда, когда сервер собирается ответить. */
          timeoutMs: 35_000,
        });
        attempt = 0;

        if (events.length === 0) continue;

        const done = [];
        for (const event of events) {
          try {
            await this.#handle(event);
            done.push(event.id);
          } catch (err) {
            /* Событие не подтверждаем: Sky выдаст его снова через
               минуту. Потерять его из-за ошибки в обработчике нельзя. */
            console.error(`[sky-bot] обработчик ${event.type} упал:`, err?.message ?? err);
            await this.reportError(`${event.type}: ${err?.message ?? err}`);
          }
        }
        if (done.length) await this.#call('POST', '/ack', { body: { ids: done } });
      } catch (err) {
        if (!this.running) break;
        attempt += 1;
        const wait = backoff(attempt);

        if (err.status === 401) {
          console.error('[sky-bot] учётные данные не подходят. Сервер отвязали в «Моих ботах»? '
                      + `Удалите ${this.stateFile} и привяжите заново.`);
        } else {
          console.error(`[sky-bot] связь потеряна (${err?.message ?? err}), повтор через ${Math.round(wait / 1000)} с`);
        }
        this.me = null;
        await sleep(wait);
      }
    }
  }

  async #handle(event) {
    const fn = this.handlers.get(event.type);
    if (!fn) return;

    if (event.type === 'inline_query') {
      const results = await fn(event.data, this);
      await this.answerInline(event.data.queryId, Array.isArray(results) ? results : []);
      return;
    }

    const reply = await fn(event.data, this);
    /* Вернуть строку — самый короткий способ ответить. Ничего не
       вернуть — тоже нормально: бот мог просто промолчать. */
    if (typeof reply === 'string' && reply.trim() && event.data?.chatId) {
      await this.send(event.data.chatId, reply);
    }
  }

  stop() { this.running = false; }
}

/* ─── Проверка подписи вебхука ───────────────────────────────────────
   Нужна тем, кто выбрал доставку вебхуком: Sky стучится к вам сам, и
   вы обязаны убедиться, что стучится действительно Sky.

   Три проверки, и все три обязательны:
     · подпись — иначе запрос подделает кто угодно;
     · время — иначе перехваченный запрос можно повторять вечно;
     · номер доставки — иначе его повторят и бот обработает дважды.  */

const seenDeliveries = new Map();

export const verifyWebhook = ({ secret, deliveryId, timestamp, signature, body, maxAgeSec = 300 }) => {
  if (!secret || !deliveryId || !timestamp || !signature) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > maxAgeSec) return false;

  const expected = crypto.createHmac('sha256', secret)
    .update(`v1:${deliveryId}:${timestamp}:${body}`).digest('hex');
  const got = String(signature).replace(/^v1=/, '');

  /* Сравнение постоянного времени: по скорости обычного сравнения
     подпись подбирается побайтно. */
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;

  /* Повтор той же доставки. Память чистим от старых записей, иначе
     карта растёт, пока процесс жив. */
  const now = Date.now();
  for (const [id, at] of seenDeliveries) {
    if (now - at > maxAgeSec * 2000) seenDeliveries.delete(id);
  }
  if (seenDeliveries.has(deliveryId)) return false;
  seenDeliveries.set(deliveryId, now);

  return true;
};

export default SkyBot;
