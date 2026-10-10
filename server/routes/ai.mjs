/**
 * Sky AI по HTTP.
 *
 * Здесь только вход: кто спрашивает, не слишком ли часто, той ли формы
 * идентификатор. Кому что можно — решают aichat.mjs и aitools.mjs.
 *
 * Разделение, ради которого всё и затевалось:
 *
 *   · /api/ai/send, /chats, /chat/* — обычный чат и история. Доступны
 *     любому, кто вошёл в Sky ID и выбрал профиль. Слова «Prime» в этих
 *     ветках нет вовсе, и это не упущение.
 *
 *   · /api/ai/summary, /file, /image, /transcribe, /upload — отдельные
 *     инструменты. Здесь Prime проверяется, и проверяется дважды: тут,
 *     чтобы отказать сразу и не читать тело, и внутри самого
 *     инструмента, который спрашивает базу сам.
 *
 * Чего этот файл не читает из запроса никогда:
 *   · признак подписки — его вычисляет сервер по таблице подписок;
 *   · идентификатор пользователя — он берётся из токена;
 *   · модель, адрес поставщика и системную часть запроса — их задаёт
 *     владелец сервера, не клиент.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { hasPrime } from './../skyid.mjs';
import { aiConfigured, sttConfigured, ttsConfigured } from './../ai.mjs';
import {
  listChats, createChat, renameChat, deleteChat, readChat, sendMessage,
  usageToday, LIMITS, PRIME_TOOLS, MAX_MESSAGE_CHARS, CHAT_ID_RE, ask, ASK_TASKS,
} from './../aichat.mjs';
import {
  summarize, analyzeFile, analyzeImage, transcribe,
  newFileRecord, markFileStored, dropFileRecord,
  SUMMARY_STYLES, MAX_DOC_BYTES, MAX_IMAGE_BYTES, MAX_AUDIO_BYTES, MAX_SUMMARY_CHARS,
} from './../aitools.mjs';
import { saveStream } from './../aistore.mjs';
import { voiceTurn, sniffAudio, MAX_VOICE_BYTES } from './../aivoice.mjs';

/* ─── Потолки ──────────────────────────────────────────────────────
   Дневные пределы считает aichat.mjs и хранит в базе. Здесь — защита
   от частых запросов: она нужна и тому, у кого дневной предел ещё не
   выбран, потому что дело не в числе за сутки, а в нагрузке сейчас. */
const READ_PER_MIN = 120;
const CHAT_PER_MIN = 12;
const TOOL_PER_MIN = 8;
const UPLOAD_PER_HOUR = 60;

/** Заявленный размер, выше которого не стоит и начинать. */
const MAX_UPLOAD_BYTES = Math.max(MAX_DOC_BYTES, MAX_IMAGE_BYTES, MAX_AUDIO_BYTES);

/**
 * Отказ, когда тело ещё идёт.
 *
 * Клиент в этот момент пишет файл и ответ не читает. Если оборвать
 * соединение сразу, его запись падает с EPIPE, и вместо «файл слишком
 * большой» человек видит «соединение разорвано». Поэтому остаток
 * дочитываем и выбрасываем — но не бесконечно.
 */
const DRAIN_LIMIT = 8 * 1024 * 1024;
const DRAIN_MS = 10_000;

const rejectBody = (req, res, code, body) => {
  json(res, code, body);

  let drained = 0;
  let done = false;
  let timer = null;

  const finish = (hard) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    req.off('data', onData);
    if (hard === true) req.destroy();
  };
  const onData = (chunk) => {
    drained += chunk.length;
    if (drained > DRAIN_LIMIT) finish(true);
  };

  timer = setTimeout(() => finish(true), DRAIN_MS);
  timer.unref();
  req.on('data', onData);
  req.once('end', () => finish(false));
  req.once('error', () => finish(false));
  req.once('close', () => finish(false));
  return true;
};

/**
 * Тело запроса целиком в память, с потолком по факту, а не по
 * заголовку. Для голосового хода: запись короткая, и гонять её через
 * диск (как файлы для «Расшифровки») незачем — разобрали и забыли.
 */
const readBodyCapped = (req, maxBytes) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > maxBytes) { reject(new Error('too_large')); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.once('end', () => resolve(Buffer.concat(chunks)));
  req.once('error', reject);
});

/**
 * Коды ответа по причине отказа.
 *
 * 402 — «нужна подписка», и это единственное место, где Prime влияет
 * на ответ. 429 — предел, и человеку важно отличать «слишком часто» от
 * «на сегодня хватит», поэтому причина уходит вместе с кодом.
 */
const codeFor = (error) => (
  error === 'prime_required' ? 402
    : error === 'not_found' ? 404
      : error === 'daily_limit' ? 429
        : error === 'ai_busy' ? 503
          : error === 'ai_not_configured' || error === 'stt_not_configured' ? 501
            : error === 'ai_timeout' ? 504
              : error === 'ai_failed' || error === 'stt_failed' ? 502
                : error === 'ai_input_too_large' || error === 'too_large' ? 413
                  : error === 'unsupported_type' || error === 'unsupported_image'
                    || error === 'unsupported_audio' ? 415
                    : error === 'too_many_chats' ? 409
                      : 400);

const fail = (res, result) => json(res, codeFor(result.error), result);

export const aiRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/ai')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  /* ══ Состояние ══════════════════════════════════════════════════
     Признак подписки приходит отсюда, с сервера. Клиент его
     показывает, но ни на что им не влияет: каждая Prime-ручка
     спрашивает базу заново. */

  if (req.method === 'GET' && path === '/api/ai/state') {
    if (!rateLimit(`ai:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const prime = await hasPrime(me);
    return json(res, 200, {
      configured: aiConfigured(),
      transcription: sttConfigured(),
      voiceReply: ttsConfigured(),
      prime,
      usage: await usageToday(me, prime),
      limits: LIMITS,
      primeTools: PRIME_TOOLS,
      maxMessageChars: MAX_MESSAGE_CHARS,
      maxSummaryChars: MAX_SUMMARY_CHARS,
      summaryStyles: Object.entries(SUMMARY_STYLES).map(([key, v]) => ({ key, label: v.label })),
      askTasks: Object.keys(ASK_TASKS),
      uploadLimits: { document: MAX_DOC_BYTES, image: MAX_IMAGE_BYTES, audio: MAX_AUDIO_BYTES },
    });
  }

  /* ══ Диалоги — бесплатно ════════════════════════════════════════ */

  if (path === '/api/ai/chats') {
    if (req.method === 'GET') {
      if (!rateLimit(`ai:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, { chats: await listChats(me, params.get('limit')) });
    }
    if (req.method === 'POST') {
      if (!rateLimit(`ai:write:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const result = await createChat(me, body.title);
      if (result.error) return fail(res, result);
      return json(res, 201, result);
    }
  }

  const one = /^\/api\/ai\/chat\/(aic-[0-9a-f-]{36})$/.exec(path);
  if (one) {
    const chatId = one[1];
    if (!CHAT_ID_RE.test(chatId)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET') {
      if (!rateLimit(`ai:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      /* Чужой диалог сюда не попадёт: условие по владельцу стоит в
         самом запросе к базе, и чужой идентификатор ничего не выберет. */
      const found = await readChat(chatId, me, params.get('limit'));
      if (!found) return json(res, 404, { error: 'not_found' });
      return json(res, 200, found);
    }
    if (req.method === 'PATCH') {
      if (!rateLimit(`ai:write:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const result = await renameChat(chatId, me, body.title);
      if (result.error) return fail(res, result);
      return json(res, 200, result);
    }
    if (req.method === 'DELETE') {
      if (!rateLimit(`ai:write:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const result = await deleteChat(chatId, me);
      if (result.error) return fail(res, result);
      return json(res, 200, result);
    }
  }

  /* ══ Обычный чат — бесплатно ════════════════════════════════════
     Ни здесь, ни в sendMessage Prime не спрашивается. Подписка
     влияет только на размер дневного предела. */

  if (req.method === 'POST' && path === '/api/ai/send') {
    if (!rateLimit(`ai:chat:${me}`, CHAT_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const result = await sendMessage(me, {
      chatId: body.chatId,
      body: body.text,
      prime: await hasPrime(me),
      mode: body.mode === 'code' ? 'code' : 'chat',
      voice: body.voice === true,
      assist: body.assist === true,
    });
    if (result.error) return fail(res, result);
    return json(res, 200, result);
  }

  /* Мелкие помощники в переписке: перевод, правка, варианты ответа.
     Один ход без истории — то же, что человек набрал бы в чате сам,
     поэтому и бесплатно. Prime здесь не спрашивается. */
  if (req.method === 'POST' && path === '/api/ai/ask') {
    if (!rateLimit(`ai:chat:${me}`, CHAT_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const result = await ask(me, {
      task: body.task,
      text: body.text,
      arg: body.arg,
      prime: await hasPrime(me),
    });
    if (result.error) return fail(res, result);
    return json(res, 200, result);
  }

  /* ══ Дальше — только Prime ══════════════════════════════════════
     Одна проверка на все оставшиеся ветки: так её нельзя забыть в
     какой-то одной. Инструменты проверяют ещё раз сами. */

  const primeArea = path === '/api/ai/upload'
    || path === '/api/ai/summary'
    || path === '/api/ai/file'
    || path === '/api/ai/image'
    || path === '/api/ai/transcribe'
    || path === '/api/ai/voice';

  if (!primeArea) return json(res, 404, { error: 'not_found' });

  if (!(await hasPrime(me))) {
    /* Тело не читаем вовсе: незачем принимать мегабайты у того, кому
       уже отказано. */
    return req.method === 'POST' && (path === '/api/ai/upload' || path === '/api/ai/voice')
      ? rejectBody(req, res, 402, { error: 'prime_required' })
      : json(res, 402, { error: 'prime_required' });
  }

  /* ══ Голосовой ход ══════════════════════════════════════════════
     Один POST — запись целиком телом запроса — сразу отдаёт и
     распознанный текст, и ответ модели (в тот же диалог), и голос
     ответа. Никакого отдельного «сначала загрузить» — запись короткая. */
  if (req.method === 'POST' && path === '/api/ai/voice') {
    if (!rateLimit(`ai:voice:${me}`, TOOL_PER_MIN)) return rejectBody(req, res, 429, { error: 'rate_limited' });

    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_VOICE_BYTES) return rejectBody(req, res, 413, { error: 'too_large', limit: MAX_VOICE_BYTES });

    let audio;
    try {
      audio = await readBodyCapped(req, MAX_VOICE_BYTES);
    } catch {
      return json(res, 413, { error: 'too_large', limit: MAX_VOICE_BYTES });
    }

    const mime = sniffAudio(audio);
    if (!mime) return json(res, 415, { error: 'unsupported_audio' });

    const chatId = params.get('chat');
    const result = await voiceTurn(me, {
      audio, mime,
      chatId: CHAT_ID_RE.test(String(chatId)) ? chatId : undefined,
      language: params.get('language') ?? '',
    });
    if (result.error) return fail(res, result);
    return json(res, 200, result);
  }

  /* ══ Приём файла ════════════════════════════════════════════════
     Файл уходит телом запроса. Имя показывается строкой адреса и
     нигде, кроме показа, не используется: путь на диске собирается
     из идентификатора, который выдал сервер. */

  if (req.method === 'POST' && path === '/api/ai/upload') {
    if (!rateLimitPerHour(`ai:upload:${me}`, UPLOAD_PER_HOUR)) {
      return rejectBody(req, res, 429, { error: 'too_many_requests' });
    }

    /* Заявленный размер — слова клиента: по ним можно отказать сразу,
       но верить им нельзя, поэтому предел считается и по факту. */
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_UPLOAD_BYTES) {
      return rejectBody(req, res, 413, { error: 'too_large', limit: MAX_UPLOAD_BYTES });
    }

    const chatId = params.get('chat');
    const fileId = await newFileRecord(me, CHAT_ID_RE.test(String(chatId)) ? chatId : null, params.get('name') ?? '');

    const saved = await saveStream(fileId, req, MAX_UPLOAD_BYTES);
    if (saved.error) {
      await dropFileRecord(fileId);
      return json(res, saved.error === 'too_large' ? 413 : 400, { error: saved.error });
    }

    /* Тип определит инструмент — по первым байтам. Здесь мы его не
       записываем как правду: то, что прислал клиент, правдой не
       является. */
    await markFileStored(fileId, 'application/octet-stream', saved.bytes);
    return json(res, 200, { fileId, bytes: saved.bytes });
  }

  if (req.method !== 'POST') return json(res, 404, { error: 'not_found' });
  if (!rateLimit(`ai:tool:${me}`, TOOL_PER_MIN)) return json(res, 429, { error: 'rate_limited' });

  const body = await parseBody(req);

  if (path === '/api/ai/summary') {
    const result = await summarize(me, { text: body.text, style: body.style, chatId: body.chatId });
    if (result.error) return fail(res, result);
    return json(res, 200, result);
  }

  if (path === '/api/ai/file') {
    const result = await analyzeFile(me, { fileId: body.fileId, question: body.question, chatId: body.chatId });
    if (result.error) return fail(res, result);
    return json(res, 200, result);
  }

  if (path === '/api/ai/image') {
    const result = await analyzeImage(me, { fileId: body.fileId, question: body.question, chatId: body.chatId });
    if (result.error) return fail(res, result);
    return json(res, 200, result);
  }

  if (path === '/api/ai/transcribe') {
    const result = await transcribe(me, { fileId: body.fileId, chatId: body.chatId, language: body.language });
    if (result.error) return fail(res, result);
    return json(res, 200, result);
  }

  return json(res, 404, { error: 'not_found' });
};
