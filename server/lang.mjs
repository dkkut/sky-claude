/**
 * Язык текущего запроса.
 *
 * Клиент в английском режиме шлёт X-Sky-Lang: en на каждый запрос
 * (src/core/auth/api.ts). Контекст живёт через await — письма с кодом,
 * SMS и подсказки языка для Sky AI берут его отсюда, не требуя
 * протаскивать параметр через десять вызовов.
 *
 * Языков два: ru (по умолчанию) и en. Всё, что не «en», — русский.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

export const langOf = (req) => (String(req?.headers?.['x-sky-lang'] ?? '').toLowerCase() === 'en' ? 'en' : 'ru');

export const runWithLang = (req, fn) => als.run({ lang: langOf(req) }, fn);

export const currentLang = () => als.getStore()?.lang ?? 'ru';

/** L('по-русски', 'in English') — строка под язык текущего запроса. */
export const L = (ru, en) => (currentLang() === 'en' ? en : ru);

/**
 * Добавка к системной части запроса для Sky AI. В английском интерфейсе
 * язык ответа по умолчанию — английский; явное задание («переведи на
 * …») и язык исходного текста при пересказе по-прежнему главнее.
 */
export const aiLangNote = () => (currentLang() === 'en'
  ? '\nThe user interface language is English: unless the task names another language or the source text is in another language, answer in English.'
  : '');
