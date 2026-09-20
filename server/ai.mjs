/**
 * Разговор с языковой моделью — единственное место в сервере, где
 * известен ключ.
 *
 * Почему отдельным файлом. В проекте был экран Sky AI, который ходил на
 * api.anthropic.com прямо из браузера. Так делать нельзя: ключ,
 * положенный в страницу, — это ключ, отданный всем, кто открыл
 * страницу. (Ключа там, впрочем, и не было, поэтому ни одна функция
 * Sky AI не работала вовсе.) Здесь наоборот: запрос уходит с сервера,
 * ключ берётся из окружения, а в браузер возвращается только готовый
 * ответ.
 *
 * Поставщик — OpenAI, ручка /v1/responses: она, в отличие от более
 * старой /v1/chat/completions, принимает PDF так же, как раньше
 * принимала его Anthropic (файлом, без ручного извлечения текста), а
 * вызывающему коду (aichat.mjs, aitools.mjs) это различие не видно —
 * наружу всё так же смотрит askModel({system, user|messages, maxTokens}).
 *
 * Что сюда не передаётся снаружи:
 *   • модель — её называет владелец сервера в AI_MODEL, не клиент;
 *   • адрес — тем более: присланным адресом наш ключ уводят на чужой
 *     сервер, и это самая дешёвая кража ключа, какая бывает;
 *   • системная часть запроса — её задаёт вызывающий код сервера.
 * Клиент может повлиять только на содержимое, и оно обрезано по длине.
 *
 * Ответ читается с потолком по размеру и по времени: зависший или
 * бесконечный ответ иначе держал бы соединение и память.
 */
import { config } from './config.mjs';

/** Минута: дольше ждать нечего, человек уже ушёл с экрана. */
const TIMEOUT_MS = 60_000;
/** Разбор большого документа думает дольше обычного ответа. */
const LONG_TIMEOUT_MS = 180_000;
/** Потолок на ответ. Пересказ выпуска в него укладывается с запасом. */
const MAX_ANSWER_BYTES = 256 * 1024;
/** Сколько запросов к модели идёт одновременно на весь сервер. */
const MAX_INFLIGHT = Math.max(1, Number(process.env.AI_MAX_INFLIGHT) || 4);

let inflight = 0;

export const aiConfigured = () => Boolean(config.aiApiKey);

/** Сколько запросов к модели идёт прямо сейчас — для наблюдения. */
export const aiInflight = () => inflight;

/**
 * Свой формат блока содержимого (Claude-подобный: { type, ... }) в
 * формат, который принимает /v1/responses. Один блок — один элемент
 * `content` внутри хода. Роль здесь важна для простого текста: то, что
 * раньше сказала модель (роль assistant, из истории диалога), нужно
 * отдать обратно как output_text, а не input_text, — иначе поставщик
 * получает историю, где модель как будто сама себе присылала вход.
 */
const toInputPart = (block, role) => {
  if (typeof block === 'string') {
    return role === 'assistant'
      ? { type: 'output_text', text: block }
      : { type: 'input_text', text: block };
  }
  switch (block?.type) {
    case 'text':
      return role === 'assistant'
        ? { type: 'output_text', text: String(block.text ?? '') }
        : { type: 'input_text', text: String(block.text ?? '') };
    case 'image':
      return {
        type: 'input_image',
        image_url: `data:${block.source.media_type};base64,${block.source.data}`,
      };
    case 'document':
      return {
        type: 'input_file',
        filename: 'document.pdf',
        file_data: `data:${block.source.media_type};base64,${block.source.data}`,
      };
    default:
      return { type: 'input_text', text: '' };
  }
};

/** Ход диалога в своём формате → ход в формате /v1/responses. */
const toResponsesTurn = ({ role, content }) => ({
  role,
  content: Array.isArray(content)
    ? content.map((b) => toInputPart(b, role))
    : [toInputPart(content, role)],
});

/**
 * Достать текст ответа из тела /v1/responses.
 *
 * Форма разбирается терпимо: под `output` лежит список ходов модели,
 * и текст может явиться как `output_text`, так и (после отказа
 * модерации) как `refusal` — оба варианта всё равно текст для показа
 * человеку, выдумывать вместо него нечего.
 */
const extractResponseText = (data) => {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const out = Array.isArray(data?.output) ? data.output : [];
  const parts = [];
  for (const item of out) {
    if (!Array.isArray(item?.content)) continue;
    for (const c of item.content) {
      if (c?.type === 'output_text' && c.text) parts.push(String(c.text));
      else if (c?.type === 'refusal' && c.refusal) parts.push(String(c.refusal));
    }
  }
  return parts.join('');
};

/**
 * Спросить модель.
 *
 * Принимает либо один текст (user), либо готовый список ходов
 * (messages) — для продолжения диалога. Оба сразу не имеют смысла:
 * если есть список, он и уходит.
 *
 * Возвращает { text } или { error }. Ошибки наружу уходят короткими
 * словами: подробности ответа поставщика могут содержать и ключ, и
 * внутренние адреса, поэтому в журнал идёт только код состояния.
 */
export const askModel = async ({ system, user, messages, maxTokens = 2000, long = false }) => {
  if (!aiConfigured()) return { error: 'ai_not_configured' };
  if (inflight >= MAX_INFLIGHT) return { error: 'ai_busy' };

  const turns = Array.isArray(messages) && messages.length
    ? messages
    : [{ role: 'user', content: String(user ?? '') }];

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), long ? LONG_TIMEOUT_MS : TIMEOUT_MS);
  inflight += 1;
  try {
    const res = await fetch(`${config.aiBaseUrl}/v1/responses`, {
      method: 'POST',
      signal: control.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.aiApiKey}`,
      },
      body: JSON.stringify({
        model: config.aiModel,
        max_output_tokens: Math.max(256, Math.min(8000, Number(maxTokens) || 2000)),
        temperature: 0,
        instructions: system,
        input: turns.map(toResponsesTurn),
      }),
    });

    if (!res.ok) {
      // Тело ответа не разбираем и не показываем: в нём бывает эхо
      // запроса вместе с заголовками.
      console.warn('[ai] отказ поставщика', res.status);
      if (res.status === 429) return { error: 'ai_busy' };
      // 413 и 400 на большом вложении — это «файл не по зубам», а не
      // поломка сервера, и человеку надо сказать именно это.
      if (res.status === 413) return { error: 'ai_input_too_large' };
      return { error: 'ai_failed' };
    }

    const raw = await readCapped(res);
    if (raw === null) return { error: 'ai_failed' };
    let data;
    try { data = JSON.parse(raw); } catch { return { error: 'ai_failed' }; }

    const text = extractResponseText(data);
    if (!text.trim()) return { error: 'ai_failed' };
    return { text, stopReason: data?.status ?? null };
  } catch (err) {
    console.warn('[ai] запрос не удался:', err?.name === 'AbortError' ? 'превышено время' : 'ошибка связи');
    return { error: err?.name === 'AbortError' ? 'ai_timeout' : 'ai_failed' };
  } finally {
    clearTimeout(timer);
    inflight -= 1;
  }
};

/* ─── Блоки содержимого ────────────────────────────────────────────
   Собираются здесь, а не в вызывающем коде, чтобы форма запроса к
   поставщику была описана в одном месте. Ничего из присланного
   клиентом в роли и в типе блока не участвует. Формат — свой,
   Claude-подобный ({type, source:{...}}); в формат /v1/responses его
   переводит toInputPart() прямо перед отправкой. */

export const textBlock = (text) => ({ type: 'text', text: String(text ?? '') });

/**
 * Картинка. Данные уходят в base64: файл лежит у нас, и давать
 * поставщику ссылку на наш сервер незачем — он к ней и не пойдёт, а
 * ссылка на чужой адрес была бы дырой в обе стороны.
 */
export const imageBlock = (mime, base64) => ({
  type: 'image',
  source: { type: 'base64', media_type: String(mime), data: String(base64) },
});

/** Документ (PDF). Тот же принцип: данные, а не ссылка. */
export const documentBlock = (base64) => ({
  type: 'document',
  source: { type: 'base64', media_type: 'application/pdf', data: String(base64) },
});

/** Чтение ответа с потолком: поставщик тоже может прислать лишнее. */
const readCapped = async (res) => {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const t = await res.text();
    return t.length > MAX_ANSWER_BYTES ? null : t;
  }
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ANSWER_BYTES) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
};

/* ══════════════════════════════════════════════════════════════════
   Расшифровка речи
   ══════════════════════════════════════════════════════════════════ */

/**
 * Речь в текст.
 *
 * Языковая модель этого не умеет — это отдельная работа и отдельный
 * поставщик. Адрес и ключ задаёт владелец сервера в STT_BASE_URL и
 * STT_API_KEY; ожидается обычная ручка /v1/audio/transcriptions,
 * которую понимают и Whisper API, и то, что ставят у себя.
 *
 * Пока поставщик не назван, расшифровки нет, и ручка так и отвечает.
 * Выдумывать текст вместо расшифровки нельзя: человек поверит, что
 * это сказали в записи.
 */
export const sttConfigured = () => Boolean(config.sttApiKey && config.sttBaseUrl);

const STT_TIMEOUT_MS = 300_000;
let sttInflight = 0;
const MAX_STT_INFLIGHT = Math.max(1, Number(process.env.STT_MAX_INFLIGHT) || 2);

/**
 * Расшифровать запись.
 *
 * `audio` — Buffer, `mime` и `name` нужны поставщику, чтобы понять
 * формат. Имя берётся не от человека: путь и имя файла у нас свои.
 */
export const transcribeAudio = async ({ audio, mime, name = 'audio', language = '' }) => {
  if (!sttConfigured()) return { error: 'stt_not_configured' };
  if (sttInflight >= MAX_STT_INFLIGHT) return { error: 'ai_busy' };

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), STT_TIMEOUT_MS);
  sttInflight += 1;
  try {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: String(mime) }), String(name));
    form.append('model', config.sttModel);
    /* Просим разметку по времени: без неё расшифровка часовой записи —
       сплошная простыня, по которой нечего искать. */
    form.append('response_format', 'verbose_json');
    if (language) form.append('language', String(language).slice(0, 8));

    const res = await fetch(`${config.sttBaseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      signal: control.signal,
      headers: { authorization: `Bearer ${config.sttApiKey}` },
      body: form,
    });

    if (!res.ok) {
      console.warn('[stt] отказ поставщика', res.status);
      if (res.status === 429) return { error: 'ai_busy' };
      if (res.status === 413) return { error: 'ai_input_too_large' };
      return { error: 'stt_failed' };
    }

    const raw = await readCapped(res);
    if (raw === null) return { error: 'stt_failed' };
    let data;
    try { data = JSON.parse(raw); } catch { return { error: 'stt_failed' }; }

    const text = String(data?.text ?? '').trim();
    if (!text) return { error: 'stt_empty' };

    /* Отметки времени берём, если поставщик их дал. Если нет — отдаём
       один сплошной кусок, а не рисуем времена сами. */
    const cues = Array.isArray(data?.segments)
      ? data.segments
        .map((s) => ({
          start: Number(s?.start) || 0,
          end: Number(s?.end) || 0,
          text: String(s?.text ?? '').trim(),
        }))
        .filter((s) => s.text)
        .slice(0, 5000)
      : [];

    return { text, cues, language: String(data?.language ?? '') };
  } catch (err) {
    console.warn('[stt] запрос не удался:', err?.name === 'AbortError' ? 'превышено время' : 'ошибка связи');
    return { error: err?.name === 'AbortError' ? 'ai_timeout' : 'stt_failed' };
  } finally {
    clearTimeout(timer);
    sttInflight -= 1;
  }
};
