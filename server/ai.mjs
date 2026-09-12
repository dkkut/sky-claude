/**
 * Разговор с языковой моделью — единственное место в сервере, где
 * известен ключ.
 *
 * Почему отдельным файлом. В проекте уже есть экран Sky AI, который
 * ходит на api.anthropic.com прямо из браузера. Так делать нельзя:
 * ключ, положенный в страницу, — это ключ, отданный всем, кто открыл
 * страницу. Здесь наоборот: запрос уходит с сервера, ключ берётся из
 * окружения, а в браузер возвращается только готовый ответ.
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
/** Потолок на ответ. Пересказ выпуска в него укладывается с запасом. */
const MAX_ANSWER_BYTES = 256 * 1024;
/** Сколько запросов к модели идёт одновременно на весь сервер. */
const MAX_INFLIGHT = 3;

let inflight = 0;

export const aiConfigured = () => Boolean(config.aiApiKey);

/**
 * Спросить модель.
 *
 * Возвращает { text } или { error }. Ошибки наружу уходят короткими
 * словами: подробности ответа поставщика могут содержать и ключ, и
 * внутренние адреса, поэтому в журнал идёт только код состояния.
 */
export const askModel = async ({ system, user, maxTokens = 2000 }) => {
  if (!aiConfigured()) return { error: 'ai_not_configured' };
  if (inflight >= MAX_INFLIGHT) return { error: 'ai_busy' };

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  inflight += 1;
  try {
    const res = await fetch(`${config.aiBaseUrl}/v1/messages`, {
      method: 'POST',
      signal: control.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.aiApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.aiModel,
        max_tokens: Math.max(256, Math.min(8000, Number(maxTokens) || 2000)),
        temperature: 0,
        system,
        messages: [{ role: 'user', content: String(user ?? '') }],
      }),
    });

    if (!res.ok) {
      // Тело ответа не разбираем и не показываем: в нём бывает эхо
      // запроса вместе с заголовками.
      console.warn('[ai] отказ поставщика', res.status);
      return { error: res.status === 429 ? 'ai_busy' : 'ai_failed' };
    }

    const raw = await readCapped(res);
    if (raw === null) return { error: 'ai_failed' };
    let data;
    try { data = JSON.parse(raw); } catch { return { error: 'ai_failed' }; }

    const text = Array.isArray(data?.content)
      ? data.content.filter((c) => c?.type === 'text').map((c) => String(c.text ?? '')).join('')
      : '';
    if (!text.trim()) return { error: 'ai_failed' };
    return { text };
  } catch (err) {
    console.warn('[ai] запрос не удался:', err?.name === 'AbortError' ? 'превышено время' : 'ошибка связи');
    return { error: 'ai_failed' };
  } finally {
    clearTimeout(timer);
    inflight -= 1;
  }
};

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
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ANSWER_BYTES) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
};
