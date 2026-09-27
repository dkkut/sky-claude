/**
 * Sky Pets по HTTP — тот же принцип раздачи медиа и загрузки, что и
 * routes/bloom.mjs/routes/stories.mjs (сниффинг магических байт, а не
 * Content-Type от клиента).
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { can } from './../admin.mjs';
import {
  MEDIA_ID_RE, SKIN_ID_RE, PET_TYPES, RARITIES,
  getOrCreatePet, renamePet, interact, setActiveSkin, changeType,
  listSkins, getSkin, purchaseSkin,
  adminCreateSkin, adminListSkins, adminRetireSkin, mediaMimeOf,
} from './../pets.mjs';
import { saveStream, openStream, sizeOf, newMediaId } from './../petsstore.mjs';
import { parseRange } from './../skyvideostore.mjs';

const READ_PER_MIN = 120;
const WRITE_PER_MIN = 40;
const UPLOAD_PER_HOUR = 20;
const STREAM_PER_MIN = 300;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_MODEL_BYTES = 32 * 1024 * 1024;

const IMAGE_SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];
/** glTF-модели: текстовый .gltf (JSON) или бинарный .glb (магическое число «glTF»). */
const MODEL_SIGNATURES = [
  { mime: 'model/gltf-binary', test: (b) => b.subarray(0, 4).toString('latin1') === 'glTF' },
  { mime: 'model/gltf+json', test: (b) => b.subarray(0, 1).toString('latin1') === '{' },
];

const sniff = (buf, table) => {
  if (!buf || buf.length < 4) return null;
  for (const s of table) {
    try { if (s.test(buf)) return s.mime; } catch { /* короткий буфер */ }
  }
  return null;
};
const sniffImage = (buf) => sniff(buf, IMAGE_SIGNATURES);
const sniffModel = (buf) => sniff(buf, MODEL_SIGNATURES);

const peek = (req, bytes) => new Promise((resolve) => {
  const chunks = [];
  let size = 0;
  const onData = (c) => {
    chunks.push(c);
    size += c.length;
    if (size >= bytes) { req.pause(); req.off('data', onData); resolve(Buffer.concat(chunks)); }
  };
  const onEnd = () => { req.off('data', onData); resolve(Buffer.concat(chunks)); };
  req.on('data', onData);
  req.once('end', onEnd);
});
const withHead = (head, rest) => Readable.from((async function* () {
  yield head;
  for await (const chunk of rest) yield chunk;
})());
const rejectBody = (req, res, code, body) => {
  json(res, code, body, { Connection: 'close' });
  res.once('finish', () => req.destroy());
  return true;
};

const errCode = (error) => (
  error === 'not_found' ? 404
    : error === 'not_allowed' ? 403
      : error === 'already_owned' ? 409
        : error === 'insufficient_points' ? 402
          : error === 'rate_limited' ? 429
            : 400
);

const streamMedia = async (req, res, mediaId) => {
  const mime = await mediaMimeOf(mediaId);
  if (!mime) return json(res, 404, { error: 'not_found' });
  const size = await sizeOf(mediaId);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });

  const common = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400, immutable',
    'Vary': 'Authorization',
  };
  const range = parseRange(req.headers.range, size);
  if (range?.invalid) {
    res.writeHead(416, { ...common, 'Content-Range': `bytes */${size}` });
    res.end();
    return true;
  }
  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, { ...common, 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': String(length) });
    const stream = openStream(mediaId, range);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return true;
  }
  res.writeHead(200, { ...common, 'Content-Length': String(size) });
  const stream = openStream(mediaId);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
};

export const petsRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/pets')) return false;
  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  const mediaMatch = /^\/api\/pets\/media\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && mediaMatch && MEDIA_ID_RE.test(mediaMatch[1])) {
    const session = await requireProfile(req, res);
    if (!session) return true;
    if (!rateLimit(`pets:stream:${session.profileId}`, STREAM_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return streamMedia(req, res, mediaMatch[1]);
  }

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  if (req.method === 'GET' && path === '/api/pets/meta') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { petTypes: PET_TYPES, rarities: RARITIES });
  }

  if (req.method === 'GET' && path === '/api/pets/me') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { pet: await getOrCreatePet(me, params.get('type')) });
  }

  if (req.method === 'POST' && path === '/api/pets/me/rename') {
    if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await renamePet(me, body?.name ?? '');
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  if (req.method === 'POST' && path === '/api/pets/me/interact') {
    if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await interact(me, String(body?.action ?? ''));
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  if (req.method === 'POST' && path === '/api/pets/me/type') {
    if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await changeType(me, String(body?.type ?? ''));
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  if (req.method === 'POST' && path === '/api/pets/me/skin') {
    if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await setActiveSkin(me, String(body?.skinId ?? ''));
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  if (req.method === 'GET' && path === '/api/pets/market') {
    if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const items = await listSkins(me, {
      q: params.get('q'), rarity: params.get('rarity'), petType: params.get('petType'),
    });
    return json(res, 200, { items });
  }

  const skinMatch = /^\/api\/pets\/market\/([^/]+)(\/[a-z]+)?$/.exec(path);
  if (skinMatch) {
    const skinId = skinMatch[1];
    const tail = skinMatch[2] ?? '';
    if (!SKIN_ID_RE.test(skinId)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`pets:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const skin = await getSkin(skinId, me);
      if (!skin) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { skin });
    }

    if (req.method === 'POST' && tail === '/buy') {
      if (!rateLimit(`pets:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await purchaseSkin(me, skinId);
      if (r.error) return json(res, errCode(r.error), r);
      return json(res, 200, r);
    }
  }

  /* ── Админка каталога — право проверяется внутри adminCreateSkin/
     adminListSkins/adminRetireSkin (can(me,'content')), здесь только
     маршрутизация. ── */

  if (req.method === 'GET' && path === '/api/pets/admin/skins') {
    if (!rateLimit(`pets:admin:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await adminListSkins(me);
    if (r.error) return json(res, 403, r);
    return json(res, 200, r);
  }

  if (req.method === 'POST' && path === '/api/pets/admin/skins') {
    if (!rateLimit(`pets:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await adminCreateSkin(me, body ?? {});
    if (r.error) return json(res, r.error === 'not_allowed' ? 403 : 400, r);
    return json(res, 200, r);
  }

  const retireMatch = /^\/api\/pets\/admin\/skins\/([^/]+)\/retire$/.exec(path);
  if (req.method === 'POST' && retireMatch) {
    if (!rateLimit(`pets:admin:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await adminRetireSkin(me, retireMatch[1]);
    if (r.error) return json(res, r.error === 'not_allowed' ? 403 : 404, r);
    return json(res, 200, r);
  }

  if (req.method === 'POST' && path === '/api/pets/admin/media') {
    if (!(await can(me, 'content'))) return rejectBody(req, res, 403, { error: 'not_allowed' });
    if (!rateLimitPerHour(`pets:upload:${me}`, UPLOAD_PER_HOUR)) return rejectBody(req, res, 429, { error: 'rate_limited' });

    const kind = params.get('kind') === 'model' ? 'model' : 'image';
    const head = await peek(req, 16);
    const mime = kind === 'model' ? sniffModel(head) : sniffImage(head);
    if (!mime) return rejectBody(req, res, 415, { error: 'unsupported_media' });
    const limit = kind === 'model' ? MAX_MODEL_BYTES : MAX_IMAGE_BYTES;
    const mediaId = newMediaId();
    const saved = await saveStream(mediaId, withHead(head, req), limit);
    if (saved.error) return json(res, saved.error === 'too_large' ? 413 : 400, saved);
    return json(res, 200, { mediaId, mime, bytes: saved.bytes });
  }

  return json(res, 404, { error: 'not_found' });
};
