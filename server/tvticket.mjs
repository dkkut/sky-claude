/**
 * Подписанные ссылки внутри эфира.
 *
 * Манифест прямого эфира — это список других адресов: вложенных
 * манифестов по качеству и кусков видео. Отдать их зрителю как есть
 * иногда нельзя (источник отвечает только нам), а принять от зрителя
 * адрес и сходить по нему — значит своими руками сделать ту самую
 * дыру, от которой защищает tvsource.mjs.
 *
 * Поэтому адреса внутри манифеста переписываются на свои, и в них
 * лежит не сам адрес, а подписанная сервером метка. Подделать её
 * нельзя — подпись своя, с отдельной пометкой назначения. Привязка к
 * каналу тоже в подписи: метку от одного канала нельзя предъявить
 * другому.
 *
 * Живёт метка минуты: кусок эфира столько и живёт, а украденная метка
 * должна протухать сама.
 */
import crypto from 'node:crypto';
import { config } from './config.mjs';

const CONTEXT = 'sky:tv-resource:v1';
/** Кусок эфира длится несколько секунд; две минуты — с большим запасом. */
const TTL_SEC = 120;

const b64u = (s) => Buffer.from(s).toString('base64url');

const sign = (payload) => crypto
  .createHmac('sha256', `${config.jwtSecret}:${CONTEXT}`)
  .update(payload)
  .digest('base64url');

/**
 * Метка на один адрес внутри эфира конкретного канала.
 * `kind` разделяет вложенный манифест и кусок видео: манифест мы потом
 * снова разбираем и переписываем, кусок — отдаём как есть.
 */
export const signResource = (channelId, url, kind) => {
  const body = b64u(JSON.stringify({
    c: String(channelId),
    u: String(url),
    k: kind === 'manifest' ? 'm' : 's',
    e: Math.floor(Date.now() / 1000) + TTL_SEC,
  }));
  return `${body}.${sign(body)}`;
};

/**
 * Адрес из метки — или null. Сравнение подписей побайтово постоянным
 * временем: обычное равенство строк подсказывает длину совпадения по
 * времени ответа.
 */
export const readResource = (token, channelId) => {
  const value = String(token ?? '');
  const dot = value.indexOf('.');
  if (dot <= 0) return null;

  const body = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const want = Buffer.from(sign(body));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data?.u || typeof data.e !== 'number') return null;
    if (data.e < Math.floor(Date.now() / 1000)) return null;
    // Метка выдана для этого канала и ни для какого другого.
    if (String(data.c) !== String(channelId)) return null;
    return { url: String(data.u), kind: data.k === 'm' ? 'manifest' : 'segment' };
  } catch {
    return null;
  }
};
