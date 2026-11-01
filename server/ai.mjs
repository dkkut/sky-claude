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
import { aiLangNote } from './lang.mjs';
import { config } from './config.mjs';
import { checkBudget, recordCall } from './aiusage.mjs';

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

/** Ход диалога → ход в формате /v1/chat/completions (текст и картинки). */
const toChatTurn = ({ role, content }) => {
  const blocks = Array.isArray(content) ? content : [content];
  const parts = blocks.map((b) => {
    if (typeof b === 'string') return { type: 'text', text: b };
    if (b?.type === 'text') return { type: 'text', text: String(b.text ?? '') };
    if (b?.type === 'image') {
      return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
    }
    return { type: 'text', text: '' };
  });
  return parts.every((p) => p.type === 'text')
    ? { role, content: parts.map((p) => p.text).join('\n') }
    : { role, content: parts };
};

/** Ход диалога → ход в родном формате Claude (/v1/messages). */
const toAnthropicTurn = ({ role, content }) => {
  const blocks = Array.isArray(content) ? content : [content];
  const parts = blocks.map((b) => {
    if (typeof b === 'string') return { type: 'text', text: b };
    if (b?.type === 'text') return { type: 'text', text: String(b.text ?? '') };
    if (b?.type === 'image' || b?.type === 'document') return { type: b.type, source: b.source };
    return { type: 'text', text: '' };
  }).filter((p) => p.type !== 'text' || p.text);
  return { role: role === 'assistant' ? 'assistant' : 'user', content: parts.length ? parts : [{ type: 'text', text: '.' }] };
};

/** Текст ответа из тела /v1/messages. */
const extractAnthropicText = (data) => (Array.isArray(data?.content) ? data.content.map((p) => (p?.type === 'text' ? String(p.text ?? '') : '')).join('') : '');

/** Короткая причина отказа поставщика для журнала сервера: только поле error.message, без ключей и эха запроса. */
const providerReason = async (res) => {
  try {
    const t = (await res.text()).slice(0, 2000);
    let msg = '';
    try { const j = JSON.parse(t); msg = String(j?.error?.message ?? j?.message ?? j?.error ?? ''); } catch { /* не JSON */ }
    return msg.replace(/(sk-|key[-_ ]?)[A-Za-z0-9_-]{8,}/gi, '$1***').replace(/\s+/g, ' ').slice(0, 200);
  } catch { return ''; }
};

/** Текст ответа из тела /v1/chat/completions. */
const extractChatText = (data) => {
  const c = data?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => String(p?.text ?? '')).join('');
  return '';
};

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
  // Лимит расхода, заданный администрацией (если включена блокировка). Сбой самой проверки не должен отключать Sky AI.
  const budget = await checkBudget().catch((e) => { console.error('[ai] проверка лимита:', e.message); return { ok: true }; });
  if (budget.error) return { error: 'ai_budget' };

  const turns = Array.isArray(messages) && messages.length
    ? messages
    : [{ role: 'user', content: String(user ?? '') }];

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), long ? LONG_TIMEOUT_MS : TIMEOUT_MS);
  inflight += 1;
  // Длина того, что уходит поставщику, — для ОЦЕНКИ расхода, если он не пришлёт usage (картинки и PDF в оценку не входят)
  const textLen = (c) => (typeof c === 'string' ? c.length : Array.isArray(c) ? c.reduce((a, b) => a + (typeof b === 'string' ? b.length : b?.type === 'text' ? String(b.text ?? '').length : 0), 0) : 0);
  const inChars = String(system ?? '').length + turns.reduce((a, t) => a + textLen(t.content), 0);
  const note = (ok, code, usage = null, outChars = 0) => recordCall({ kind: 'chat', ok, code, usage, chars: { input: inChars, output: outChars } });
  try {
    const style = config.aiApiStyle;
    const limit = Math.max(256, Math.min(8000, Number(maxTokens) || 2000));
    const sys = `${system}${aiLangNote()}`;
    // Поставщики расходятся в мелочах (temperature у новых моделей, max_tokens / max_completion_tokens): при 400 пробуем один раз без спорных полей.
    const build = (strict) => {
      if (style === 'anthropic') return { url: '/v1/messages', headers: { 'x-api-key': config.aiApiKey, 'anthropic-version': '2023-06-01', ...(/(^|\.)anthropic\.com(\/|$)/i.test(config.aiBaseUrl.replace(/^https?:\/\//i, '')) ? {} : { authorization: `Bearer ${config.aiApiKey}` }) }, body: { model: config.aiModel, max_tokens: limit, system: sys, messages: turns.map(toAnthropicTurn) } };
      if (style === 'chat') return { url: '/v1/chat/completions', headers: { authorization: `Bearer ${config.aiApiKey}` }, body: { model: config.aiModel, ...(strict ? { max_tokens: limit } : { max_completion_tokens: limit }), messages: [{ role: 'system', content: sys }, ...turns.map(toChatTurn)] } };
      return { url: '/v1/responses', headers: { authorization: `Bearer ${config.aiApiKey}` }, body: { model: config.aiModel, max_output_tokens: limit, ...(strict ? { temperature: 0 } : {}), instructions: sys, input: turns.map(toResponsesTurn) } };
    };
    const send = async (strict) => {
      const r = build(strict);
      return fetch(`${config.aiBaseUrl}${r.url}`, { method: 'POST', signal: control.signal, headers: { 'content-type': 'application/json', ...r.headers }, body: JSON.stringify(r.body) });
    };
    let res = await send(true);
    if (res.status === 400) {
      const why = await providerReason(res);
      console.warn('[ai] 400 от поставщика, повтор без спорных полей:', why);
      res = await send(false);
    }

    if (!res.ok) {
      console.warn('[ai] отказ поставщика', res.status, await providerReason(res));
      if (res.status === 429) { await note(false, 'ai_busy'); return { error: 'ai_busy' }; }
      // 413 и 400 на большом вложении — это «файл не по зубам», а не
      // поломка сервера, и человеку надо сказать именно это.
      if (res.status === 413) { await note(false, 'ai_input_too_large'); return { error: 'ai_input_too_large' }; }
      await note(false, `provider_${res.status}`);
      return { error: 'ai_failed' };
    }

    const raw = await readCapped(res);
    if (raw === null) { await note(false, 'ai_failed'); return { error: 'ai_failed' }; }
    let data;
    try { data = JSON.parse(raw); } catch { await note(false, 'ai_failed'); return { error: 'ai_failed' }; }

    const text = style === 'chat' ? extractChatText(data) : style === 'anthropic' ? extractAnthropicText(data) : extractResponseText(data);
    if (!text.trim()) { await note(false, 'ai_failed'); return { error: 'ai_failed' }; }
    const u = data?.usage ?? {};
    const usage = style === 'chat'
      ? { input: Number(u.prompt_tokens) || 0, output: Number(u.completion_tokens) || 0 }
      : { input: Number(u.input_tokens) || 0, output: Number(u.output_tokens) || 0 };
    await note(true, '', usage, text.length);
    return { text, stopReason: data?.status ?? null };
  } catch (err) {
    console.warn('[ai] запрос не удался:', err?.name === 'AbortError' ? 'превышено время' : 'ошибка связи');
    const code = err?.name === 'AbortError' ? 'ai_timeout' : 'ai_failed';
    await note(false, code);
    return { error: code };
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
      await recordCall({ kind: 'stt', ok: false, code: res.status === 429 ? 'ai_busy' : `provider_${res.status}` });
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

    await recordCall({ kind: 'stt', ok: true });
    return { text, cues, language: String(data?.language ?? '') };
  } catch (err) {
    console.warn('[stt] запрос не удался:', err?.name === 'AbortError' ? 'превышено время' : 'ошибка связи');
    await recordCall({ kind: 'stt', ok: false, code: err?.name === 'AbortError' ? 'ai_timeout' : 'stt_failed' });
    return { error: err?.name === 'AbortError' ? 'ai_timeout' : 'stt_failed' };
  } finally {
    clearTimeout(timer);
    sttInflight -= 1;
  }
};

/* ══════════════════════════════════════════════════════════════════
   Голосовой ответ (текст → речь)
   ══════════════════════════════════════════════════════════════════ */

/**
 * Речь из текста — для голосового режима Sky AI.
 *
 * Отдельный поставщик и отдельная настройка от языковой модели: адрес,
 * ключ и голос называет владелец сервера (TTS_BASE_URL/TTS_API_KEY/
 * TTS_VOICE), клиент их не выбирает. Пока поставщик не назван —
 * голосового ответа нет, ручка отвечает `tts_not_configured` вместо
 * того, чтобы промолчать необъяснимо.
 */
export const ttsConfigured = () => Boolean(config.ttsApiKey && config.ttsBaseUrl);

const TTS_TIMEOUT_MS = 60_000;
let ttsInflight = 0;
const MAX_TTS_INFLIGHT = Math.max(1, Number(process.env.TTS_MAX_INFLIGHT) || 2);
/** Ответ длиннее — не помещается в один голосовой ответ разумной длины. */
const MAX_TTS_CHARS = 4000;
/** Потолок на аудио-ответ поставщика. */
const MAX_AUDIO_ANSWER_BYTES = 16 * 1024 * 1024;

export const synthesizeSpeech = async ({ text: body }) => {
  if (!ttsConfigured()) return { error: 'tts_not_configured' };
  const clean = String(body ?? '').trim().slice(0, MAX_TTS_CHARS);
  if (!clean) return { error: 'empty_message' };
  if (ttsInflight >= MAX_TTS_INFLIGHT) return { error: 'ai_busy' };

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TTS_TIMEOUT_MS);
  ttsInflight += 1;
  try {
    const res = await fetch(`${config.ttsBaseUrl}/v1/audio/speech`, {
      method: 'POST',
      signal: control.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.ttsApiKey}`,
      },
      body: JSON.stringify({
        model: config.ttsModel,
        voice: config.ttsVoice,
        input: clean,
        response_format: 'mp3',
      }),
    });

    if (!res.ok) {
      console.warn('[tts] отказ поставщика', res.status);
      if (res.status === 429) return { error: 'ai_busy' };
      return { error: 'tts_failed' };
    }

    const reader = res.body?.getReader?.();
    const chunks = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_AUDIO_ANSWER_BYTES) { await reader.cancel().catch(() => {}); return { error: 'tts_failed' }; }
        chunks.push(value);
      }
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_AUDIO_ANSWER_BYTES) return { error: 'tts_failed' };
      chunks.push(buf);
    }
    const audio = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    if (!audio.length) return { error: 'tts_failed' };
    return { audio, mime: 'audio/mpeg' };
  } catch (err) {
    console.warn('[tts] запрос не удался:', err?.name === 'AbortError' ? 'превышено время' : 'ошибка связи');
    return { error: err?.name === 'AbortError' ? 'ai_timeout' : 'tts_failed' };
  } finally {
    clearTimeout(timer);
    ttsInflight -= 1;
  }
};
