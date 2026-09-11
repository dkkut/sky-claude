/**
 * Sky TV по HTTP.
 *
 * Главное, чего здесь нет: ручки, принимающей адрес потока. Ни одной.
 * Клиент присылает идентификатор канала, а какой источник ему
 * соответствует, сервер выясняет сам в базе. Поэтому заставить Sky TV
 * сходить по чужому адресу нельзя не потому, что мы такие адреса
 * отсеиваем, а потому, что принимать их неоткуда.
 *
 * Второе: эфир не идёт через память сервера.
 *
 *   • манифест — это несколько килобайт текста. Его сервер забирает
 *     сам, разбирает и переписывает адреса внутри;
 *   • куски видео при обычной раздаче отдаются перенаправлением прямо
 *     на сеть доставки источника: байты идут мимо нас совсем;
 *   • когда источник отвечает только нам, кусок ведётся через себя —
 *     но потоком, из соединения в соединение, не собираясь в память.
 *
 * При сотне зрителей на канал разница между этим и «скачать и отдать»
 * — это разница между десятками мегабайт и несколькими гигабайтами.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import {
  listChannels, readChannel, listCategories, sourceForChannel,
  listFavorites, setFavorite, noteWatched, listRecent, listEpg,
  upsertChannel, deleteChannel, attachSource, detachSource, adminOverview,
  checkAllSources, setLogo, readLogo, CATEGORIES,
} from './../tv.mjs';
import { fetchSource, readAll, SourceRejected } from './../tvsource.mjs';
import { signResource, readResource } from './../tvticket.mjs';
import { isOwner } from './../admin.mjs';

const READ_PER_MIN = 240;
const WRITE_PER_MIN = 120;
/** Эфир идёт кусками по несколько секунд — запросов много по природе. */
const STREAM_PER_MIN = 900;

const CHANNEL_ID = /^ch-[0-9a-f-]{36}$/;

/**
 * Переписать манифест так, чтобы все адреса внутри вели к нам.
 *
 * Манифест — построчный текст. Адреса в нём бывают двух видов: сами по
 * себе строкой (вложенный манифест или кусок) и внутри свойства
 * URI="..." у служебных строк — так задаются дорожки звука, субтитры и
 * ключи шифрования. Пропустить второй вид значит получить эфир без
 * звука на части каналов.
 */
const rewriteManifest = (body, baseUrl, channelId, deliverDirect) => {
  const base = new URL(baseUrl);
  const ours = (absolute, kind) =>
    `/api/tv/channel/${encodeURIComponent(channelId)}/${kind === 'manifest' ? 'manifest' : 'segment'}`
    + `?r=${encodeURIComponent(signResource(channelId, absolute, kind))}`;

  /**
   * Куда отправить зрителя за этим адресом.
   * При обычной раздаче — прямо в сеть доставки источника: это и
   * быстрее, и не тратит наш канал. Вложенный манифест всегда идёт
   * через нас: его надо переписать так же, как и первый.
   */
  const target = (raw, kind) => {
    let absolute;
    try { absolute = new URL(raw, base).toString(); } catch { return raw; }
    if (kind === 'manifest') return ours(absolute, 'manifest');
    return deliverDirect ? absolute : ours(absolute, 'segment');
  };

  return body.split('\n').map((line) => {
    const t = line.trim();
    if (!t) return line;

    if (t.startsWith('#')) {
      // Служебная строка: адрес спрятан в URI="...".
      return line.replace(/URI="([^"]+)"/g, (m, raw) => {
        // Дорожки и субтитры — это вложенные манифесты, ключ шифрования
        // — обычный файл. Отличаем по самой строке.
        const kind = /#EXT-X-(MEDIA|I-FRAME-STREAM-INF)/i.test(t) ? 'manifest' : 'segment';
        return `URI="${target(raw, kind)}"`;
      });
    }

    // Обычная строка-адрес. Вложенный манифест отличается расширением;
    // всё остальное — кусок видео.
    const kind = /\.m3u8(\?|$)/i.test(t) ? 'manifest' : 'segment';
    return target(t, kind);
  }).join('\n');
};

/** Чтение небольшого тела — только для логотипов. */
const readLogoBody = (req, limit = 256 * 1024) => new Promise((resolve) => {
  if (Number(req.headers['content-length'] ?? 0) > limit) { resolve(null); return; }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > limit) { req.destroy(); resolve(null); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', () => resolve(null));
});

/** Ответ об отказе, одинаковый снаружи для всех причин. */
const unavailable = (res) => json(res, 503, { error: 'channel_unavailable' });

export const tvRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/tv')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  /* ── Каталог ───────────────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/tv/channels') {
    if (!rateLimit(`tv:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      channels: await listChannels(me, {
        category: params.get('category') ?? undefined,
        q: params.get('q') ?? undefined,
        favorites: params.get('favorites') === '1',
      }),
    });
  }

  if (req.method === 'GET' && path === '/api/tv/categories') {
    if (!rateLimit(`tv:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { categories: await listCategories(), all: CATEGORIES });
  }

  if (req.method === 'GET' && path === '/api/tv/favorites') {
    if (!rateLimit(`tv:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { channels: await listFavorites(me) });
  }

  if (req.method === 'POST' && path === '/api/tv/favorites') {
    if (!rateLimit(`tv:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await setFavorite(me, String(body?.channelId ?? ''), body?.on === true);
    return r.error ? json(res, 404, r) : json(res, 200, { channels: await listFavorites(me) });
  }

  if (req.method === 'GET' && path === '/api/tv/recent') {
    if (!rateLimit(`tv:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { channels: await listRecent(me) });
  }

  /* ── Управление: только владелец ───────────────────────────── */

  if (path === '/api/tv/admin/channels') {
    if (req.method === 'GET') {
      const r = await adminOverview(me);
      return r.error ? json(res, 403, r) : json(res, 200, r);
    }
    if (req.method === 'POST') {
      if (!rateLimit(`tv:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await upsertChannel(me, body ?? {});
      return r.error ? json(res, r.error === 'not_allowed' ? 403 : 400, r) : json(res, 200, r);
    }
    if (req.method === 'DELETE') {
      const body = await parseBody(req);
      const r = await deleteChannel(me, body?.slug);
      return r.error ? json(res, r.error === 'not_allowed' ? 403 : 404, r) : json(res, 200, r);
    }
  }

  if (path === '/api/tv/admin/sources') {
    if (req.method === 'POST') {
      if (!rateLimit(`tv:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await attachSource(me, body ?? {});
      return r.error ? json(res, r.error === 'not_allowed' ? 403 : 400, r) : json(res, 200, r);
    }
    if (req.method === 'DELETE') {
      const body = await parseBody(req);
      const r = await detachSource(me, body?.id);
      return r.error ? json(res, r.error === 'not_allowed' ? 403 : 404, r) : json(res, 200, r);
    }
  }

  if (req.method === 'POST' && path === '/api/tv/admin/check') {
    if (!(await isOwner(me))) return json(res, 403, { error: 'not_allowed' });
    if (!rateLimit(`tv:check:${me}`, 6)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, await checkAllSources());
  }

  /* ── Один канал ────────────────────────────────────────────── */

  const chMatch = path.match(/^\/api\/tv\/channel\/([^/]+)(\/[a-z]+)?$/);
  if (chMatch) {
    const id = chMatch[1];
    const tail = chMatch[2] ?? '';
    // Образец проверяется до всякого обращения к базе: чужой формы
    // строка дальше не проходит.
    if (!CHANNEL_ID.test(id)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`tv:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const c = await readChannel(id, me);
      return c ? json(res, 200, { channel: c }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'GET' && tail === '/logo') {
      if (!rateLimit(`tv:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const logo = await readLogo(id);
      if (!logo) return json(res, 404, { error: 'not_found' });
      res.writeHead(200, {
        'Content-Type': logo.mime,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': String(logo.data.length),
      });
      res.end(logo.data);
      return true;
    }

    if (req.method === 'POST' && tail === '/logo') {
      if (!rateLimit(`tv:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const { rows } = await import('./../db.mjs').then((m) => m.query(
        'SELECT slug FROM tv_channels WHERE id = $1', [id]));
      if (!rows[0]) return json(res, 404, { error: 'not_found' });
      const buf = await readLogoBody(req);
      if (!buf) return json(res, 413, { error: 'file_too_large' });
      const r = await setLogo(me, rows[0].slug, buf);
      return r.error ? json(res, r.error === 'not_allowed' ? 403 : 400, r) : json(res, 200, r);
    }

    if (req.method === 'GET' && tail === '/epg') {
      if (!rateLimit(`tv:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      if (!(await readChannel(id, me))) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { programme: await listEpg(id, { hours: params.get('hours') }) });
    }

    if (req.method === 'POST' && tail === '/watch') {
      if (!rateLimit(`tv:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await noteWatched(me, id);
      return r.error ? json(res, 404, r) : json(res, 200, { ok: true });
    }

    /* Манифест: первый и вложенные. */
    if (req.method === 'GET' && tail === '/manifest') {
      if (!rateLimit(`tv:stream:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });

      const source = await sourceForChannel(id);
      if (!source) return unavailable(res);

      // Вложенный манифест приходит подписанной меткой. Сам адрес из
      // неё всё равно пройдёт полную проверку в fetchSource — подпись
      // говорит лишь «это выдали мы», а не «этому можно верить».
      let targetUrl = source.url;
      const marker = params.get('r');
      if (marker) {
        const resolved = readResource(marker, id);
        if (!resolved || resolved.kind !== 'manifest') return json(res, 403, { error: 'bad_resource' });
        targetUrl = resolved.url;
      }

      try {
        const { res: upstream, finalUrl } = await fetchSource(targetUrl, { headers: source.headers });
        if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
          upstream.resume();
          console.error(`[tv] канал ${id}: источник ответил ${upstream.statusCode}`);
          return unavailable(res);
        }
        const body = (await readAll(upstream)).toString('utf8');
        const rewritten = rewriteManifest(body, finalUrl, id, source.delivery === 'redirect');
        res.writeHead(200, {
          'Content-Type': source.kind === 'dash' ? 'application/dash+xml' : 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(rewritten);
        return true;
      } catch (err) {
        // Наружу — одинаковое «канал недоступен». Что именно случилось,
        // остаётся в журнале сервера: адрес источника и причина отказа
        // зрителю знать нечего.
        console.error(`[tv] канал ${id}: ${err instanceof SourceRejected ? `${err.reason} ${err.detail}` : err.message}`);
        return unavailable(res);
      }
    }

    /* Кусок эфира — только когда источник отвечает одним нам. */
    if ((req.method === 'GET' || req.method === 'HEAD') && tail === '/segment') {
      if (!rateLimit(`tv:stream:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });

      const source = await sourceForChannel(id);
      if (!source) return unavailable(res);

      const resolved = readResource(params.get('r'), id);
      if (!resolved) return json(res, 403, { error: 'bad_resource' });

      try {
        const { res: upstream } = await fetchSource(resolved.url, {
          method: req.method,
          headers: source.headers,
          range: typeof req.headers.range === 'string' ? req.headers.range : undefined,
        });
        if (upstream.statusCode >= 400) {
          upstream.resume();
          return unavailable(res);
        }
        res.writeHead(upstream.statusCode, {
          'Content-Type': upstream.headers['content-type'] ?? 'application/octet-stream',
          ...(upstream.headers['content-length'] ? { 'Content-Length': upstream.headers['content-length'] } : {}),
          ...(upstream.headers['content-range'] ? { 'Content-Range': upstream.headers['content-range'] } : {}),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        if (req.method === 'HEAD') { upstream.resume(); res.end(); return true; }
        // Из соединения в соединение. Кусок не собирается в память ни
        // на мгновение — при сотне зрителей это и есть разница между
        // работающим сервером и упавшим.
        upstream.on('error', () => res.destroy());
        res.on('close', () => upstream.destroy());
        upstream.pipe(res);
        return true;
      } catch (err) {
        console.error(`[tv] кусок канала ${id}: ${err instanceof SourceRejected ? err.reason : err.message}`);
        return unavailable(res);
      }
    }

    return json(res, 404, { error: 'not_found' });
  }

  return json(res, 404, { error: 'not_found' });
};
