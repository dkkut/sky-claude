/**
 * Приём и выдача вложений.
 *
 * Тело загрузки читается сырыми байтами, а не через JSON: картинка в
 * base64 внутри JSON весит на треть больше и разбирается в строку
 * целиком. Имя файла и чат приходят строкой запроса и заголовком.
 *
 * Выдача идёт с заголовками, при которых браузер не может истолковать
 * файл как страницу: тип берётся из самих байтов, всё неопознанное
 * отдаётся только на скачивание, sniffing запрещён.
 */
import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { storeAttachment, readAttachment, MAX_FILE_BYTES } from './../attachments.mjs';

/** Потолок скачиваний в минуту на профиль: расшифровка стоит времени. */
const DOWNLOADS_PER_MIN = 180;

/**
 * Имя файла в заголовке.
 *
 * Заголовки передаются однобайтовой кодировкой, и русское имя в них
 * либо превратится в кашу, либо уронит ответ. Поэтому даём два вида:
 * обеднённое латинское — для старых клиентов, и полное в кодировке
 * UTF-8 по RFC 5987 — для всех современных.
 */
const dispositionFor = (name, inline) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_') || 'file';
  const utf8 = encodeURIComponent(name);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
};

/** Что можно показать прямо на странице; остальное — только скачать. */
const INLINE = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/webm', 'video/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav',
]);

/**
 * Читает тело как байты с жёстким потолком.
 *
 * Заявленный размер проверяется до чтения: так отправитель получает
 * понятный отказ, а не оборванное соединение, и лишние мегабайты не
 * проходят через память вовсе. Счётчик по ходу чтения остаётся на
 * случай, когда размер не объявлен.
 */
const TOO_LARGE = Symbol('too_large');

const readBytes = (req, limit) => new Promise((resolve, reject) => {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) { reject(TOO_LARGE); return; }

  const chunks = [];
  let size = 0;
  let stopped = false;
  req.on('data', (chunk) => {
    if (stopped) return;
    size += chunk.length;
    if (size > limit) {
      stopped = true;
      reject(TOO_LARGE);
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => { if (!stopped) resolve(Buffer.concat(chunks)); });
  req.on('error', (err) => { if (!stopped) reject(err); });
});

const params = (req) => new URL(req.url || '/', 'http://sky.local').searchParams;

export const fileRoutes = async (req, res, url) => {
  /* ── Загрузка ── */
  if (req.method === 'POST' && url === '/api/files') {
    const s = await requireProfile(req, res); if (!s) return true;

    const chatId = params(req).get('chatId') ?? '';
    if (!chatId) return json(res, 400, { error: 'invalid_chat' });

    let bytes;
    try {
      bytes = await readBytes(req, MAX_FILE_BYTES);
    } catch (err) {
      if (err !== TOO_LARGE) return json(res, 400, { error: 'bad_request' });
      // Ответ отправляем до того, как оборвать приём: иначе отправитель
      // видит разрыв связи вместо объяснения, что файл слишком большой.
      json(res, 413, { error: 'file_too_large', maxBytes: MAX_FILE_BYTES }, { Connection: 'close' });
      req.destroy();
      return true;
    }

    const result = await storeAttachment({
      chatId, ownerId: s.profileId, bytes,
      fileName: params(req).get('name') ?? '',
    });
    // «Не участник» и «нет такого чата» отвечают одинаково: по ответу
    // нельзя выяснять, какие чаты есть на сервере.
    if (result.error === 'not_found')      return json(res, 404, { error: 'not_found' });
    if (result.error === 'file_too_large') return json(res, 413, { error: result.error, maxBytes: MAX_FILE_BYTES });
    if (result.error === 'quota_exceeded') return json(res, 507, { error: result.error });
    if (result.error === 'rate_limited')   return json(res, 429, { error: result.error });
    if (result.error)                      return json(res, 400, { error: result.error });

    return json(res, 201, { file: result });
  }

  /* ── Выдача ── */
  // Идентификатор ровно того вида, какой выдаёт сервер: ничего похожего
  // на путь сюда не попадёт даже теоретически.
  const match = url.match(/^\/api\/files\/(f-[0-9a-f-]{36})$/);
  if (req.method === 'GET' && match) {
    const s = await requireProfile(req, res); if (!s) return true;
    if (!rateLimit(`file:${s.profileId}`, DOWNLOADS_PER_MIN)) {
      return json(res, 429, { error: 'rate_limited' });
    }

    const file = await readAttachment(match[1], s.profileId);
    if (!file) return json(res, 404, { error: 'not_found' });

    const inline = INLINE.has(file.mime);
    res.writeHead(200, {
      'Content-Type': inline ? file.mime : 'application/octet-stream',
      'Content-Length': file.data.length,
      // Даже опознанную картинку отдаём с запретом на угадывание типа:
      // иначе браузер может решить, что это что-то другое.
      'X-Content-Type-Options': 'nosniff',
      // Неопознанное открыть в окне нельзя — только сохранить.
      'Content-Disposition': dispositionFor(file.name, inline),
      // Файл — часть переписки: ни прокси, ни общий кэш его хранить не
      // должны, а страница-получатель должна быть нашей.
      'Cache-Control': 'private, max-age=300, no-transform',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Referrer-Policy': 'no-referrer',
    });
    res.end(file.data);
    return true;
  }

  return false;
};
