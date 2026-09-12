/**
 * Sky Bots по HTTP.
 *
 * Две разные двери, и это главное в файле:
 *
 *   /api/bots/…      — владелец из браузера. Требуется профиль Sky ID.
 *   /api/bots/rt/…   — Bot API: сюда ходит программа с сервера
 *                      владельца. Требуется токен runtime. Сессии Sky
 *                      ID у неё нет и быть не должно.
 *
 * Проверка стоит до разбора пути, а не внутри каждой ветки: иначе
 * достаточно было бы забыть её в одной из них. Токен runtime не даёт
 * доступа к ручкам владельца, а сессия человека — к Bot API.
 *
 * Идентификатор бота, с которым работает программа, берётся ИЗ ТОКЕНА,
 * а не из тела запроса. Что бы она ни прислала, работать будет только
 * со своим ботом — подменить bot_id нечем. Владелец тоже не указывается
 * нигде: он берётся из сессии.
 *
 * И ещё раз, потому что это суть задачи: здесь нет ни одного места,
 * где выполнялся бы код бота. Ни eval, ни vm, ни дочернего процесса, ни
 * контейнера. Sky складывает события и принимает действия.
 */
import crypto from 'node:crypto';
import { json, parseBody, requireProfile, readAccessToken } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { query } from './../db.mjs';
import { isAdmin, isOwner } from './../admin.mjs';
import {
  listPublished, listCategories, listMine, readBot, readBotByUsername,
  createBot, updateBot, deleteBot, readCode, setCommands,
  submitBot, unpublishBot, moderationQueue, moderateBot,
  listLog, logBot, ownsBot,
  inlineBotByTrigger, listInlineBots, putInlinePending, takeInlinePending,
  BOT_ID_RE,
} from './../bots.mjs';
import {
  createPairing, redeemPairing, runtimeSession, readRuntime,
  touchRuntime, reportRuntimeError, clearRuntimeError,
  unlinkRuntime, setDelivery, PAIRING_PER_HOUR,
} from './../botruntime.mjs';
import {
  takeOrWait, ack, releaseTaken, enqueue,
  awaitInlineAnswer, resolveInlineAnswer, MAX_WAIT_MS,
} from './../botevents.mjs';
import {
  openDialog, dialogHistory, sendToBot, botSend, botChats,
} from './../botchat.mjs';
import { saveMessage, memberIds, isMember } from './../chats.mjs';
import { pushNewMessage } from './../signal.mjs';

/* ─── Потолки обращений ────────────────────────────────────────────── */
const READ_PER_MIN = 240;
const WRITE_PER_MIN = 60;
const DIALOG_PER_MIN = 120;
/** Bot API щедрее: за ним стоит программа, а не человек с мышкой. */
const RT_PER_MIN = 600;
const RT_SEND_PER_MIN = 120;
/*
 * Подбор учётных данных — скупо, но считать надо по тому, КОГО
 * подбирают, а не по адресу.
 *
 * Sky стоит за nginx, и для сервера все запросы приходят с одного
 * адреса. Счётчик «десять в минуту на адрес» означал бы десять на
 * ВСЕХ ботов мира разом: одна программа, перезапускающаяся в цикле,
 * закрывала бы вход остальным.
 *
 * Поэтому ключ — идентификатор runtime (для обмена секрета) и сам код
 * (для привязки). Это и есть то, что подбирают: перебор по одной цели
 * упирается в потолок, а чужие цели друг другу не мешают. Отдельный
 * общий потолок держит вал неудачных попыток сразу по многим целям.
 */
const AUTH_PER_MIN = 10;
/** Общий потолок НЕУДАЧНЫХ попыток: удачные не считаем. */
const AUTH_FAIL_PER_MIN = 120;
const INLINE_PER_MIN = 60;

/** Сколько ждём ответа inline-бота, прежде чем сказать «не ответил». */
const INLINE_WAIT_MS = 9_000;

const codeFor = (error) => (
  error === 'not_found' ? 404
    : error === 'not_allowed' || error === 'not_a_member' ? 403
      : error === 'invalid_credentials' ? 401
        : error === 'too_many' || error === 'already_pending' || error === 'already_published'
          || error === 'not_pending' || error === 'username_taken' || error === 'trigger_taken'
          || error === 'runtime_required' || error === 'not_linked' ? 409
          : 400);

/** Текст от человека: без управляющих символов и в разумных пределах. */
const clean = (value, max) =>
  String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

/* ══════════════════════════════════════════════════════════════════════
   BOT API — сюда ходит программа с сервера владельца
   ══════════════════════════════════════════════════════════════════════ */

const runtimeRoutes = async (req, res, path) => {
  /* Привязка: единственная ручка Bot API без токена. Здесь программа
     обменивает одноразовый код на собственные учётные данные. */
  if (req.method === 'POST' && path === '/api/bots/rt/pair') {
    const body = await parseBody(req);
    /* Ключ — сам код. Хешируем, чтобы не держать его в памяти
       счётчика открытым текстом. */
    const codeKey = crypto.createHash('sha256')
      .update(String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .digest('base64url').slice(0, 22);
    if (!rateLimit(`bot:pair:${codeKey}`, AUTH_PER_MIN)) return json(res, 429, { error: 'rate_limited' });

    const result = await redeemPairing(body.code, {
      label: body.label, version: body.version, sdk: body.sdk,
      delivery: body.delivery, webhookUrl: body.webhookUrl,
    });
    if (result.error) {
      if (!rateLimit('bot:pair:fail', AUTH_FAIL_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, result.error === 'invalid_code' ? 401 : 400, { error: result.error });
    }

    /* Первый и последний раз, когда секрет уходит наружу. Ни в журнал,
       ни в ответ владельцу он больше не попадёт. */
    return json(res, 200, result);
  }

  /* Обмен пары на короткоживущий токен. */
  if (req.method === 'POST' && path === '/api/bots/rt/session') {
    const body = await parseBody(req);
    /* Считаем по тому runtime, чей секрет подбирают. Перезапуск одной
       программы не мешает остальным. */
    const who = String(body.runtimeId ?? 'unknown').slice(0, 64);
    if (!rateLimit(`bot:sess:${who}`, AUTH_PER_MIN)) return json(res, 429, { error: 'rate_limited' });

    const result = await runtimeSession(body.runtimeId, body.runtimeSecret);
    if (result.error) {
      if (!rateLimit('bot:sess:fail', AUTH_FAIL_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 401, { error: result.error });
    }
    return json(res, 200, result);
  }

  /* Дальше — только с токеном. */
  const rt = await readRuntime(readAccessToken(req));
  if (!rt) return json(res, 401, { error: 'unauthorized' });
  const { botId, runtimeId } = rt;

  if (!rateLimit(`bot:rt:${runtimeId}`, RT_PER_MIN)) return json(res, 429, { error: 'rate_limited' });

  /* Кто я и что мне можно. Заодно первая отметка «на связи». */
  if (req.method === 'GET' && path === '/api/bots/rt/me') {
    await touchRuntime(runtimeId);
    const { rows } = await query(
      'SELECT name, username, status, inline_enabled, inline_trigger FROM bots WHERE id = $1', [botId],
    );
    if (!rows[0]) return json(res, 404, { error: 'not_found' });
    return json(res, 200, {
      botId,
      name: rows[0].name,
      username: `@${rows[0].username}`,
      status: rows[0].status,
      inline: rows[0].inline_enabled,
      inlineTrigger: rows[0].inline_trigger ?? null,
      chats: await botChats(botId),
    });
  }

  /*
   * Получение событий.
   *
   * Долгий запрос: программа держит его открытым, Sky отвечает в момент
   * появления события. Пустой ответ по таймауту — нормальная часть
   * схемы, программа сразу спрашивает снова. Это и есть «постоянное
   * соединение» без входящего порта на стороне владельца.
   */
  if (req.method === 'GET' && path === '/api/bots/rt/events') {
    const params = new URL(req.url, 'http://x').searchParams;
    const waitMs = Math.min(Number(params.get('wait') ?? 25_000) || 0, MAX_WAIT_MS);
    await touchRuntime(runtimeId, {
      version: params.get('version') ?? undefined,
      sdk: params.get('sdk') ?? undefined,
    });

    /*
     * Обрыв соединения должен прерывать ожидание.
     *
     * Программа владельца висит здесь до двадцати пяти секунд. Если её
     * за это время убили — перезапуск, потеря сети, упавший контейнер, —
     * ждать дальше некому. Хуже того: дождавшись события, сервер забрал
     * бы его в мёртвое соединение, и следующая минута прошла бы в
     * тишине именно тогда, когда программа уже поднялась.
     */
    let gone = false;
    let wakeUp = null;
    const onClose = () => { gone = true; wakeUp?.(); };
    res.once('close', onClose);

    try {
      const events = await takeOrWait(botId, runtimeId, waitMs, {
        onAbort: (fn) => { wakeUp = fn; if (gone) fn(); },
      });

      /*
       * Пока мы ждали, сервер могли отвязать. Проверку повторяем: без
       * неё отозванные учётные данные ещё до двадцати пяти секунд
       * получали бы чужие теперь события.
       */
      const stillValid = gone ? null : await readRuntime(readAccessToken(req));
      if (gone || !stillValid || stillValid.botId !== botId) {
        /* Взятое, но не отданное возвращаем в очередь немедленно. */
        if (events.length) await releaseTaken(botId, events.map((e) => e.id));
        if (!gone) return json(res, 401, { error: 'unauthorized' });
        return true;
      }

      if (events.length) {
        await touchRuntime(runtimeId, { events: events.length });
        await clearRuntimeError(runtimeId);
      }
      return json(res, 200, { events, waited: waitMs });
    } finally {
      res.off('close', onClose);
    }
  }

  /* Подтверждение обработки. Без него событие выдастся снова. */
  if (req.method === 'POST' && path === '/api/bots/rt/ack') {
    const body = await parseBody(req);
    const n = await ack(botId, body.ids);
    return json(res, 200, { acked: n });
  }

  /*
   * Отправка сообщения.
   *
   * Автор — профиль этого бота и только он: он выводится из botId,
   * который взят из токена. Ни поля «от кого», ни возможности его
   * задать здесь нет. Право писать в чат проверяет слой данных по
   * участию — в чат, куда бота не звали, он не напишет.
   */
  if (req.method === 'POST' && path === '/api/bots/rt/send') {
    if (!rateLimit(`bot:send:${botId}`, RT_SEND_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const chatId = String(body.chatId ?? '');
    if (!chatId) return json(res, 400, { error: 'chat_required' });

    const result = await botSend(botId, chatId, { text: body.text, replyTo: body.replyTo });
    if (result.error) return json(res, codeFor(result.error), { error: result.error });

    await touchRuntime(runtimeId, { actions: 1 });
    /* Ответ бота расходится по сокету так же, как любое сообщение:
       собеседник видит его сразу, а не после перезагрузки. */
    pushNewMessage(result.members, chatId, result.message);
    return json(res, 200, { messageId: result.message.id, chatId });
  }

  /*
   * Ответ на inline-запрос.
   *
   * Программа НЕ отправляет сообщение, а предлагает варианты. Они
   * складываются заготовками и превращаются в сообщение только после
   * того, как человек подтвердит — в своём собственном сеансе. Так бот
   * не может написать за него.
   */
  if (req.method === 'POST' && path === '/api/bots/rt/inline/answer') {
    const body = await parseBody(req);
    const queryId = String(body.queryId ?? '');
    if (!/^[0-9a-f-]{36}$/.test(queryId)) return json(res, 400, { error: 'invalid_query' });

    const items = (Array.isArray(body.results) ? body.results : []).slice(0, 8)
      .map((r) => ({ title: clean(r?.title, 120), text: clean(r?.text, 4000) }))
      .filter((r) => r.text);

    /* Отдавать «нет такого запроса» отдельным кодом нельзя: по разнице
       ответов можно было бы выяснять, какие запросы существуют. */
    const delivered = resolveInlineAnswer(queryId, { botId, items });
    await touchRuntime(runtimeId, { actions: 1 });
    return json(res, 200, { accepted: delivered });
  }

  /* Программа сама рассказывает о своей беде — владелец увидит это в
     карточке бота и в журнале. */
  if (req.method === 'POST' && path === '/api/bots/rt/error') {
    const body = await parseBody(req);
    await reportRuntimeError(runtimeId, botId, body.message);
    return json(res, 200, { ok: true });
  }

  /* Пульс: нужен тем, кто ходит вебхуком и не держит долгий запрос. */
  if (req.method === 'POST' && path === '/api/bots/rt/heartbeat') {
    const body = await parseBody(req);
    await touchRuntime(runtimeId, { version: body.version, sdk: body.sdk });
    return json(res, 200, { ok: true, serverTime: new Date().toISOString() });
  }

  return json(res, 404, { error: 'not_found' });
};

/* ══════════════════════════════════════════════════════════════════════
   Ручки владельца и каталога
   ══════════════════════════════════════════════════════════════════════ */

export const botRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/bots')) return false;
  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  /* Bot API живёт под /rt/ и опознаёт своего по токену runtime.
     Сессия Sky ID сюда не подходит — и наоборот. */
  if (path.startsWith('/api/bots/rt/')) {
    await runtimeRoutes(req, res, path);
    return true;
  }

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  /* ── Каталог «Все боты» ─────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/bots/catalog') {
    if (!rateLimit(`bot:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      bots: await listPublished({ q: params.get('q') ?? '', category: params.get('category') ?? '' }),
      categories: listCategories(),
    });
  }

  /* ── «Мои боты» ─────────────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/bots/mine') {
    if (!rateLimit(`bot:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { bots: await listMine(me) });
  }

  if (req.method === 'POST' && path === '/api/bots') {
    if (!rateLimit(`bot:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const result = await createBot(me, body);
    if (result.error) return json(res, codeFor(result.error), { error: result.error });
    return json(res, 201, { bot: result.bot });
  }

  /* ── Подсказка и вызов inline прямо из поля ввода ───────────── */

  if (req.method === 'GET' && path === '/api/bots/inline') {
    if (!rateLimit(`bot:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { bots: await listInlineBots(params.get('q') ?? '') });
  }

  /*
   * Запрос к inline-боту.
   *
   * Человек набрал «#триггер что-то» в чате. Sky спрашивает сервер
   * владельца и ждёт ответа считанные секунды: человек стоит у поля
   * ввода. Ничего не отправляется — возвращаются варианты.
   */
  if (req.method === 'POST' && path === '/api/bots/inline/query') {
    if (!rateLimit(`bot:inline:${me}`, INLINE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const chatId = String(body.chatId ?? '');

    /* Чат, в который просят, должен быть чатом спрашивающего. Иначе
       заготовку можно было бы создать для чужой переписки. */
    if (!chatId || !(await isMember(chatId, me))) return json(res, 403, { error: 'not_allowed' });

    const bot = await inlineBotByTrigger(body.trigger);
    if (!bot) return json(res, 404, { error: 'bot_not_found' });

    const queryId = crypto.randomUUID();
    const queued = await enqueue(bot.id, 'inline_query', {
      queryId,
      chatId,
      from: { id: me, name: clean(body.fromName, 64) },
      query: clean(body.query, 500),
    }, chatId);
    if (queued === null) return json(res, 503, { error: 'bot_unavailable' });

    const answer = await awaitInlineAnswer(queryId, INLINE_WAIT_MS);
    if (!answer) {
      await logBot(bot.id, 'warn', 'inline.timeout', 'сервер владельца не ответил на inline-запрос');
      return json(res, 504, { error: 'bot_timeout', bot });
    }
    /* Ответ пришёл от программы ЭТОГО бота — сверяем, а не верим
       номеру запроса: иначе чужая программа, угадав номер, подсунула
       бы человеку свой текст. */
    if (answer.botId !== bot.id) return json(res, 502, { error: 'bot_mismatch' });

    const pending = await putInlinePending(bot.id, me, chatId, answer.items);
    if (pending.length === 0) return json(res, 200, { bot, results: [] });
    return json(res, 200, { bot, results: pending });
  }

  /*
   * Подтверждение: сообщение уходит ОТ ИМЕНИ ЧЕЛОВЕКА.
   *
   * Автором ставится тот, кто нажал кнопку, — он же и владелец сессии.
   * Бот здесь не участвует вовсе: он своё дело сделал, когда предложил
   * текст. Заготовка гасится тем же запросом, что её находит, поэтому
   * два нажатия не отправят два сообщения.
   */
  if (req.method === 'POST' && path === '/api/bots/inline/confirm') {
    if (!rateLimit(`bot:inline:${me}`, INLINE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const chatId = String(body.chatId ?? '');

    const taken = await takeInlinePending(body.pendingId, me, chatId);
    if (!taken) return json(res, 404, { error: 'expired' });

    const saved = await saveMessage(chatId, me, {
      id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      text: taken.text, kind: 'text',
      /* Пометка для интерфейса: сообщение составил бот, отправил
         человек. Скрывать это незачем, а понимать — полезно. */
      viaBot: taken.botId,
    });
    if (!saved) return json(res, 403, { error: 'not_allowed' });
    if (saved.error) return json(res, 409, { error: saved.error });

    pushNewMessage(await memberIds(chatId), chatId, saved);
    await logBot(taken.botId, 'info', 'inline.sent', 'человек подтвердил отправку');
    return json(res, 200, { message: saved, chatId });
  }

  /* ── Разговор с ботом ───────────────────────────────────────── */

  const dialogMatch = /^\/api\/bots\/(bot-[0-9a-f-]{36})\/dialog$/.exec(path);
  if (dialogMatch) {
    const botId = dialogMatch[1];
    if (!rateLimit(`bot:dlg:${me}`, DIALOG_PER_MIN)) return json(res, 429, { error: 'rate_limited' });

    if (req.method === 'GET') {
      const result = await dialogHistory(botId, me, Number(params.get('limit') ?? 50), params.get('before'));
      if (result.error) return json(res, codeFor(result.error), { error: result.error });
      return json(res, 200, result);
    }
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const result = await sendToBot(botId, me, clean(body.fromName, 64), body.text);
      if (result.error) return json(res, codeFor(result.error), { error: result.error });
      pushNewMessage(await memberIds(result.chatId), result.chatId, result.message);
      return json(res, 200, result);
    }
  }

  /* ── Модерация ──────────────────────────────────────────────── */

  if (path === '/api/bots/moderation') {
    /* Право администратора спрашивается у admin.mjs, а не берётся из
       поля в теле запроса. */
    if (!(await isAdmin(me)) && !(await isOwner(me))) return json(res, 403, { error: 'not_allowed' });
    if (req.method === 'GET') return json(res, 200, { bots: await moderationQueue() });
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const result = await moderateBot(body.botId, body.approve === true, body.reason);
      if (result.error) return json(res, codeFor(result.error), { error: result.error });
      return json(res, 200, { ok: true });
    }
  }

  /* ── Один бот ───────────────────────────────────────────────── */

  const byName = /^\/api\/bots\/by-username\/(@?[A-Za-z0-9_]{3,33})$/.exec(path);
  if (req.method === 'GET' && byName) {
    const bot = await readBotByUsername(byName[1], me);
    if (!bot) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { bot });
  }

  const one = /^\/api\/bots\/(bot-[0-9a-f-]{36})(\/[a-z/-]+)?$/.exec(path);
  if (!one) return json(res, 404, { error: 'not_found' });

  const botId = one[1];
  const tail = one[2] ?? '';

  if (!BOT_ID_RE.test(botId)) return json(res, 404, { error: 'not_found' });

  /* Карточка — единственное, что доступно не владельцу, и только для
     опубликованного бота: это проверяет readBot. */
  if (req.method === 'GET' && tail === '') {
    const bot = await readBot(botId, me);
    if (!bot) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { bot });
  }
  if (req.method === 'POST' && tail === '/open') {
    const opened = await openDialog(botId, me);
    if (opened.error) return json(res, codeFor(opened.error), { error: opened.error });
    return json(res, 200, opened);
  }

  /*
   * Дальше — только владельцу.
   *
   * Одна проверка на все оставшиеся ветки: так её нельзя забыть в
   * какой-то одной. Ответ 404, а не 403, — чужой бот не должен
   * отличаться от несуществующего.
   */
  if (!(await ownsBot(botId, me))) return json(res, 404, { error: 'not_found' });
  if (!rateLimit(`bot:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });

  if (req.method === 'PATCH' && tail === '') {
    const body = await parseBody(req);
    const result = await updateBot(botId, me, body);
    if (result.error) return json(res, codeFor(result.error), { error: result.error });
    return json(res, 200, { bot: result.bot });
  }

  if (req.method === 'DELETE' && tail === '') {
    const result = await deleteBot(botId, me);
    if (result.error) return json(res, codeFor(result.error), { error: result.error });
    return json(res, 200, { ok: true });
  }

  /* Черновик кода. Sky его хранит и показывает, но не запускает. */
  if (req.method === 'GET' && tail === '/code') {
    const found = await readCode(botId, me);
    if (!found) return json(res, 404, { error: 'not_found' });
    return json(res, 200, found);
  }

  if (req.method === 'PUT' && tail === '/commands') {
    const body = await parseBody(req);
    const result = await setCommands(botId, me, body.commands);
    if (result.error) return json(res, codeFor(result.error), { error: result.error });
    return json(res, 200, result);
  }

  /* ── Управление сервером владельца ──────────────────────────── */

  /*
   * Выдать код привязки.
   *
   * Ограничитель на час — не формальность: код короткий, и без потолка
   * можно было бы выпускать их пачками, повышая шанс угадать чужой.
   */
  if (req.method === 'POST' && tail === '/pairing') {
    if (!rateLimitPerHour(`bot:pair:${botId}`, PAIRING_PER_HOUR)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    const result = await createPairing(botId, me);
    if (result.error) return json(res, codeFor(result.error), { error: result.error });
    /* Код показывается один раз, тому, кто его заказал. Повторно его
       не узнать — только выпустить новый. */
    return json(res, 200, result);
  }

  if (req.method === 'POST' && tail === '/unlink') {
    const result = await unlinkRuntime(botId, me);
    if (result.error) return json(res, codeFor(result.error), { error: result.error });
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && tail === '/delivery') {
    const body = await parseBody(req);
    const result = await setDelivery(botId, me, body.mode, body.webhookUrl);
    if (result.error) return json(res, codeFor(result.error), { error: result.error });
    return json(res, 200, result);
  }

  if (req.method === 'POST' && tail === '/submit') {
    const result = await submitBot(botId, me);
    if (result.error) return json(res, codeFor(result.error), { error: result.error });
    return json(res, 200, { bot: result.bot });
  }

  if (req.method === 'POST' && tail === '/unpublish') {
    const result = await unpublishBot(botId, me);
    if (result.error) return json(res, codeFor(result.error), { error: result.error });
    return json(res, 200, { bot: result.bot });
  }

  if (req.method === 'GET' && tail === '/log') {
    const rows = await listLog(botId, me, Number(params.get('limit') ?? 100));
    if (rows === null) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { log: rows });
  }

  /* Куда бот вхож. Владельцу видно, чтобы понимать, откуда приходят
     события; чужому — нет. */
  if (req.method === 'GET' && tail === '/chats') {
    return json(res, 200, { chats: await botChats(botId) });
  }

  return json(res, 404, { error: 'not_found' });
};
