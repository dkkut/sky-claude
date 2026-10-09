/**
 * Sky Gifts по HTTP: обычные подарки, подарок Prime, передача
 * существующих NFT-подарков, уведомления, админка каталога и медиа.
 *
 * Как и везде: здесь только вход — сессия, частота, форма
 * идентификатора. Кто кому что может — решает слой данных
 * (gifts.mjs, primegifts.mjs, nft.mjs).
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { can } from './../admin.mjs';
import {
  GIFT_ID_RE, MEDIA_ID_RE, INSTANCE_ID_RE,
  listCatalog, adminListCatalog, getCatalogItem, createGift, updateGift, setGiftActive,
  registerGiftMedia, registerPrimeCardMedia, mediaMime,
  sendGift, saveInstanceToProfile, getInstance, receivedGifts, profileGifts, sentGifts, publicProfileGifts,
  cancelGiftInstance, archiveGiftInstance, archivedReceivedGifts, archivedSentGifts,
  errCode as giftErrCode,
} from './../gifts.mjs';
import {
  PRIME_GIFT_ID_RE, primePriceTiers, sendPrimeGift, getPrimeGiftInstance, activatePrimeGift,
  mySentPrimeGifts, myReceivedPrimeGifts,
  cancelPrimeGiftInstance, archivePrimeGiftInstance, archivedSentPrimeGifts, archivedReceivedPrimeGifts,
  errCode as primeErrCode,
} from './../primegifts.mjs';
import {
  currentOwner, ownersOf, provenanceOf, transferNft, ownedByProfile, publicOwnedBy,
} from './../nft.mjs';
import {
  activeListings, listingFor, createListing, cancelListing, buyListing,
} from './../nftmarket.mjs';
import { isKnownNftId } from './../nftgenesis.mjs';
import { listGiftNotifications, readGiftNotification } from './../giftnotify.mjs';
import { saveStream, openStream, sizeOf, newMediaId } from './../giftstore.mjs';
import { parseRange } from './../skyvideostore.mjs';

const READ_PER_MIN = 300;
const WRITE_PER_MIN = 40;
const SEND_PER_MIN = 15;
const ACTIVATE_PER_MIN = 20;
const TRANSFER_PER_HOUR = 30;
const LISTING_PER_HOUR = 30;
const BUY_PER_MIN = 15;
const NFT_LISTING_ID_RE = /^lst-[0-9a-f-]{36}$/;
const UPLOAD_PER_HOUR = 30;
const STREAM_PER_MIN = 600;

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;

const IMAGE_SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'image/gif', test: (b) => b.subarray(0, 6).toString('latin1') === 'GIF87a'
      || b.subarray(0, 6).toString('latin1') === 'GIF89a' },
];
const VIDEO_SIGNATURES = [
  { mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { mime: 'video/webm', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
];

const sniff = (buf, table) => {
  if (!buf || buf.length < 16) return null;
  for (const s of table) {
    try { if (s.test(buf)) return s.mime; } catch { /* короткий буфер */ }
  }
  return null;
};

/** Только картинка (превью — всегда статично или GIF, не видео). */
const sniffImage = (buf) => {
  const img = sniff(buf, IMAGE_SIGNATURES);
  return img ? { mime: img, kind: img === 'image/gif' ? 'animation' : 'image' } : null;
};

/** Картинка (включая GIF-анимацию) или короткое видео — по первым байтам, не по Content-Type. */
const sniffMedia = (buf) => sniffImage(buf) ?? (sniff(buf, VIDEO_SIGNATURES)
  ? { mime: sniff(buf, VIDEO_SIGNATURES), kind: 'video' } : null);

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

const errCode = (error) => giftErrCode(error) !== 400 ? giftErrCode(error)
  : primeErrCode(error) !== 400 ? primeErrCode(error)
    : error === 'not_owner' ? 403
      : error === 'invalid_recipient' || error === 'self_transfer' || error === 'self_target' ? 400
        : error === 'idem_key_required' || error === 'invalid_plan' ? 400
          : 400;

const streamMedia = async (req, res, mediaId) => {
  const mime = await mediaMime(mediaId);
  if (!mime) return json(res, 404, { error: 'not_found' });
  const size = await sizeOf(mediaId);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });

  const common = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600, immutable',
    // Доступ проверяется по Authorization (requireProfile) — без Vary
    // браузер мог бы отдать медиа, закешированное под одним профилем,
    // другому профилю того же Sky ID в том же браузере.
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

export const giftRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/gifts')) return false;
  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const body = async () => parseBody(req);

  /* ── Медиа ─────────────────────────────────────────────────────────── */

  const mediaMatch = /^\/api\/gifts\/media\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && mediaMatch && MEDIA_ID_RE.test(mediaMatch[1])) {
    if (!rateLimit(`gift:stream:${me}`, STREAM_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return streamMedia(req, res, mediaMatch[1]);
  }

  /* ── Каталог ───────────────────────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/gifts/catalog') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await listCatalog() });
  }

  /* ── Отправка и доставка обычного подарка ─────────────────────────── */

  if (req.method === 'POST' && path === '/api/gifts/send') {
    if (!rateLimit(`gift:send:${me}`, SEND_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const r = await sendGift(me, {
      giftCatalogId: b.giftCatalogId, recipientId: b.recipientId, target: b.target,
      chatId: b.chatId, message: b.message, idemKey: b.idemKey,
    });
    return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
  }

  const instanceMatch = /^\/api\/gifts\/instances\/(gi-[0-9a-f-]{36})(\/save|\/cancel|\/archive)?$/.exec(path);
  if (instanceMatch) {
    const id = instanceMatch[1];
    if (!INSTANCE_ID_RE.test(id)) return json(res, 404, { error: 'not_found' });
    if (req.method === 'GET' && !instanceMatch[2]) {
      if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await getInstance(me, id);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, { instance: r });
    }
    if (req.method === 'POST' && instanceMatch[2] === '/save') {
      if (!rateLimit(`gift:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const r = await saveInstanceToProfile(me, id, b?.on !== false);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
    if (req.method === 'POST' && instanceMatch[2] === '/cancel') {
      if (!rateLimit(`gift:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await cancelGiftInstance(me, id);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
    if (req.method === 'POST' && instanceMatch[2] === '/archive') {
      if (!rateLimit(`gift:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const r = await archiveGiftInstance(me, id, b?.on !== false);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
  }

  if (req.method === 'GET' && path === '/api/gifts/mine/received') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await receivedGifts(me) });
  }
  if (req.method === 'GET' && path === '/api/gifts/mine/profile') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await profileGifts(me) });
  }
  if (req.method === 'GET' && path === '/api/gifts/mine/sent') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await sentGifts(me) });
  }
  if (req.method === 'GET' && path === '/api/gifts/mine/received/archived') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await archivedReceivedGifts(me) });
  }
  if (req.method === 'GET' && path === '/api/gifts/mine/sent/archived') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await archivedSentGifts(me) });
  }

  const publicGiftsMatch = /^\/api\/gifts\/profile\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (req.method === 'GET' && publicGiftsMatch) {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    const r = await publicProfileGifts(me, publicGiftsMatch[1]);
    return json(res, 200, r);
  }

  /* ── Подарок Prime ─────────────────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/gifts/prime/prices') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { tiers: primePriceTiers() });
  }
  if (req.method === 'POST' && path === '/api/gifts/prime/send') {
    if (!rateLimit(`gift:send:${me}`, SEND_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const r = await sendPrimeGift(me, {
      recipientId: b.recipientId, days: b.days, theme: b.theme, message: b.message, idemKey: b.idemKey,
    });
    return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
  }
  const primeInstanceMatch = /^\/api\/gifts\/prime\/instances\/(pgi-[0-9a-f-]{36})(\/activate|\/cancel|\/archive)?$/.exec(path);
  if (primeInstanceMatch) {
    const id = primeInstanceMatch[1];
    if (!PRIME_GIFT_ID_RE.test(id)) return json(res, 404, { error: 'not_found' });
    if (req.method === 'GET' && !primeInstanceMatch[2]) {
      if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await getPrimeGiftInstance(me, id);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, { instance: r });
    }
    if (req.method === 'POST' && primeInstanceMatch[2] === '/activate') {
      if (!rateLimit(`gift:activate:${me}`, ACTIVATE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await activatePrimeGift(me, id);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
    if (req.method === 'POST' && primeInstanceMatch[2] === '/cancel') {
      if (!rateLimit(`gift:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await cancelPrimeGiftInstance(me, id);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
    if (req.method === 'POST' && primeInstanceMatch[2] === '/archive') {
      if (!rateLimit(`gift:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const r = await archivePrimeGiftInstance(me, id, b?.on !== false);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
  }
  if (req.method === 'GET' && path === '/api/gifts/prime/mine/sent') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await mySentPrimeGifts(me) });
  }
  if (req.method === 'GET' && path === '/api/gifts/prime/mine/received') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await myReceivedPrimeGifts(me) });
  }
  if (req.method === 'GET' && path === '/api/gifts/prime/mine/sent/archived') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await archivedSentPrimeGifts(me) });
  }
  if (req.method === 'GET' && path === '/api/gifts/prime/mine/received/archived') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await archivedReceivedPrimeGifts(me) });
  }

  /* ── NFT: владение, история, передача ─────────────────────────────── */

  if (req.method === 'GET' && path === '/api/gifts/nft/owners') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    const ids = (params.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
    return json(res, 200, { owners: await ownersOf(ids) });
  }
  // Проверяется раньше общего nftMatch ниже: без этого литеральный путь
  // "listings" сам сошёл бы за nftId в /nft/:id и упал бы в 404.
  if (req.method === 'GET' && path === '/api/gifts/nft/listings') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { listings: await activeListings() });
  }
  const nftProfileMatch = /^\/api\/gifts\/nft\/profile\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (req.method === 'GET' && nftProfileMatch) {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    const target = nftProfileMatch[1];
    const r = target === me ? { hidden: false, items: await ownedByProfile(me) } : await publicOwnedBy(me, target);
    return json(res, 200, r);
  }
  const nftMatch = /^\/api\/gifts\/nft\/([a-z0-9-]{1,32})(\/owner|\/history|\/transfer)?$/.exec(path);
  if (nftMatch) {
    const nftId = nftMatch[1];
    if (!isKnownNftId(nftId)) return json(res, 404, { error: 'not_found' });
    if (req.method === 'GET' && nftMatch[2] === '/owner') {
      if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { owner: await currentOwner(nftId) });
    }
    if (req.method === 'GET' && nftMatch[2] === '/history') {
      if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { provenance: await provenanceOf(nftId) });
    }
    if (req.method === 'POST' && nftMatch[2] === '/transfer') {
      if (!rateLimitPerHour(`gift:transfer:${me}`, TRANSFER_PER_HOUR)) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const r = await transferNft(me, nftId, String(b.recipientId ?? ''));
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
  }

  /* ── NFT: маркет (выставить / снять / купить) ─────────────────────── */

  const nftListingByGiftMatch = /^\/api\/gifts\/nft\/([a-z0-9-]{1,32})\/listing$/.exec(path);
  if (nftListingByGiftMatch) {
    const nftId = nftListingByGiftMatch[1];
    if (!isKnownNftId(nftId)) return json(res, 404, { error: 'not_found' });
    if (req.method === 'GET') {
      if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { listing: await listingFor(nftId) });
    }
    if (req.method === 'POST') {
      if (!rateLimitPerHour(`gift:listing:${me}`, LISTING_PER_HOUR)) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const r = await createListing(me, nftId, {
        type: b.type, price: b.price, reservePrice: b.reservePrice, decayPct: b.decayPct, durationH: b.durationH,
      });
      return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
    }
  }
  const nftListingMatch = /^\/api\/gifts\/nft\/listing\/(lst-[0-9a-f-]{36})(\/buy)?$/.exec(path);
  if (nftListingMatch) {
    const listingId = nftListingMatch[1];
    if (!NFT_LISTING_ID_RE.test(listingId)) return json(res, 404, { error: 'not_found' });
    if (req.method === 'DELETE' && !nftListingMatch[2]) {
      if (!rateLimit(`gift:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await cancelListing(me, listingId);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
    if (req.method === 'POST' && nftListingMatch[2] === '/buy') {
      if (!rateLimit(`gift:buy:${me}`, BUY_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await buyListing(me, listingId);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
  }

  /* ── Уведомления ───────────────────────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/gifts/notifications') {
    if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { notifications: await listGiftNotifications(me) });
  }
  const notifMatch = /^\/api\/gifts\/notifications\/(gnf-[0-9a-f-]{36})\/read$/.exec(path);
  if (req.method === 'POST' && notifMatch) {
    if (!rateLimit(`gift:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, await readGiftNotification(me, notifMatch[1]));
  }

  /* ── Админка: каталог ──────────────────────────────────────────────── */

  if (path.startsWith('/api/gifts/admin')) {
    if (!(await can(me, 'gifts'))) return json(res, 403, { error: 'not_allowed' });

    if (req.method === 'GET' && path === '/api/gifts/admin/catalog') {
      if (!rateLimit(`gift:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      return json(res, 200, { items: await adminListCatalog() });
    }
    if (req.method === 'POST' && path === '/api/gifts/admin/catalog') {
      if (!rateLimit(`gift:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await createGift(await body());
      return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
    }

    const adminCatalogMatch = /^\/api\/gifts\/admin\/catalog\/(gc-[0-9a-f-]{36})(\/active|\/media)?$/.exec(path);
    if (adminCatalogMatch) {
      const gid = adminCatalogMatch[1];
      if (!GIFT_ID_RE.test(gid)) return json(res, 404, { error: 'not_found' });
      const tail = adminCatalogMatch[2] ?? '';

      if (req.method === 'PATCH' && tail === '') {
        if (!rateLimit(`gift:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
        const r = await updateGift(gid, await body());
        return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
      }
      if (req.method === 'POST' && tail === '/active') {
        if (!rateLimit(`gift:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
        const b = await body();
        const r = await setGiftActive(gid, b.on !== false);
        return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
      }
      if (req.method === 'POST' && tail === '/media') {
        const exists = await getCatalogItem(gid);
        if (!exists) return json(res, 404, { error: 'not_found' });
        const role = params.get('role') === 'thumbnail' ? 'thumbnail' : 'main';
        if (!rateLimitPerHour(`gift:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'too_many_requests' });
        const limit = role === 'thumbnail' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
        const declared = Number(req.headers['content-length'] ?? 0);
        if (declared > limit) return rejectBody(req, res, 413, { error: 'too_large' });
        const head = await peek(req, 32);
        const sniffed = role === 'thumbnail' ? sniffImage(head) : sniffMedia(head);
        if (!sniffed) return rejectBody(req, res, 415, { error: 'unsupported_media' });
        req.resume();
        const mediaId = newMediaId();
        const saved = await saveStream(mediaId, withHead(head, req), limit);
        if (saved.error) return json(res, saved.error === 'too_large' ? 413 : 400, saved);
        await registerGiftMedia(gid, mediaId, role, sniffed.kind, sniffed.mime, saved.bytes, me);
        return json(res, 200, { mediaId, bytes: saved.bytes });
      }
    }

    const primeCardMatch = /^\/api\/gifts\/admin\/prime-card\/([a-z0-9_-]{1,24})\/media$/.exec(path);
    if (req.method === 'POST' && primeCardMatch) {
      const themeId = primeCardMatch[1];
      const role = params.get('role') === 'thumbnail' ? 'thumbnail' : 'main';
      if (!rateLimitPerHour(`gift:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'too_many_requests' });
      const limit = role === 'thumbnail' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > limit) return rejectBody(req, res, 413, { error: 'too_large' });
      const head = await peek(req, 32);
      const sniffed = role === 'thumbnail' ? sniffImage(head) : sniffMedia(head);
      if (!sniffed) return rejectBody(req, res, 415, { error: 'unsupported_media' });
      req.resume();
      const mediaId = newMediaId();
      const saved = await saveStream(mediaId, withHead(head, req), limit);
      if (saved.error) return json(res, saved.error === 'too_large' ? 413 : 400, saved);
      await registerPrimeCardMedia(themeId, mediaId, role, sniffed.kind, sniffed.mime, saved.bytes, me);
      return json(res, 200, { mediaId, bytes: saved.bytes });
    }
  }

  return false;
};
