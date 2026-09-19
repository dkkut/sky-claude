/**
 * Мероприятия по HTTP.
 *
 * Здесь только вход — кто спрашивает, не слишком ли часто, той ли формы
 * идентификатор. Права и всю логику решает campaigns.mjs.
 *
 * Одно исключение из общей калитки закрытой беты: /api/campaigns/r/ —
 * переход по ссылке участника, публично, без входа в Sky вообще (см.
 * server.mjs). Всё остальное здесь — как в любом другом модуле,
 * требует обычной сессии.
 */
import { Readable } from 'node:stream';
import { json, parseBody, requireProfile, readSession } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  listActiveCampaigns, campaignDetail, joinCampaign, myLink, myParticipation,
  recordClick, requestReward,
  listCampaignsForAdmin, createCampaign, updateCampaign, setCampaignActive, archiveCampaign,
  listLevels, createLevel, updateLevel, setLevelActive, deleteLevel,
  listParticipantsForAdmin, listRewardGrantsForAdmin, rejectRewardGrant,
  CAMPAIGN_ID_RE, PARTICIPATION_ID_RE, LEVEL_ID_RE, GRANT_ID_RE,
} from './../campaigns.mjs';
import { saveStream, sizeOf, openStream, coverIdFor } from './../campaignstore.mjs';
import { can } from './../admin.mjs';
import { query } from './../db.mjs';

const READ_PER_MIN = 200;
const WRITE_PER_MIN = 40;
const CLICK_PER_MIN = 300;
const UPLOAD_PER_HOUR = 30;
const MAX_COVER_BYTES = 6 * 1024 * 1024;

const IMAGE_SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png',  test: (b) => b.subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF'
      && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];
const sniff = (buf) => {
  if (!buf || buf.length < 16) return null;
  for (const s of IMAGE_SIGNATURES) {
    try { if (s.test(buf)) return s.mime; } catch { /* короткий буфер */ }
  }
  return null;
};
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

const sendImage = async (res, fileId, mime) => {
  const size = await sizeOf(fileId);
  if (size === null || size === 0) return json(res, 404, { error: 'not_found' });
  res.writeHead(200, {
    'Content-Type': mime || 'image/jpeg',
    'Content-Length': String(size),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=600',
  });
  const stream = openStream(fileId);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
};

const errCode = (error) => (
  error === 'not_allowed' ? 403
    : error === 'not_found' ? 404
      : error === 'already_requested' || error === 'has_grants' || error === 'threshold_taken'
        || error === 'already_decided' ? 409
        : error === 'too_large' ? 413
          : error === 'unsupported_image' ? 415
            : 400
);

export const campaignRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/campaigns')) return false;
  const path = url.split('?')[0];

  /* Переход по ссылке — единственная публичная ручка модуля: её
     кликает зритель ролика, а не вошедший в Sky человек. */
  const clickMatch = /^\/api\/campaigns\/r\/(.+)$/.exec(path);
  if (req.method === 'GET' && clickMatch) {
    if (!rateLimit(`camp:click:${req.socket.remoteAddress || 'unknown'}`, CLICK_PER_MIN)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    const done = await recordClick(decodeURIComponent(clickMatch[1]), {
      ip: req.socket.remoteAddress, userAgent: req.headers['user-agent'],
    });
    // Признак принятого перехода клиенту не нужен и не показывается —
    // это не квитанция для зрителя, а просто редирект на витрину.
    void done;
    res.writeHead(302, { Location: '/' });
    res.end();
    return true;
  }

  const coverMatch = /^\/api\/campaigns\/(camp-[0-9a-f-]{36})\/cover$/.exec(path);
  const isPublicCover = req.method === 'GET' && Boolean(coverMatch);

  let me = null;
  if (isPublicCover) {
    const session = await readSession(req);
    me = session?.profileId ?? null;
  } else {
    const session = await requireProfile(req, res);
    if (!session) return true;
    me = session.profileId;
  }

  if (isPublicCover) {
    const { rows } = await query('SELECT has_cover, cover_mime FROM campaigns WHERE id = $1', [coverMatch[1]]);
    if (!rows[0]?.has_cover) return json(res, 404, { error: 'not_found' });
    return sendImage(res, coverIdFor(coverMatch[1]), rows[0].cover_mime);
  }

  const body = async () => parseBody(req);

  /* ── Публичный список и карточка ──────────────────────────────────── */

  if (req.method === 'GET' && path === '/api/campaigns') {
    if (!rateLimit(`camp:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { campaigns: await listActiveCampaigns() });
  }

  const detailMatch = /^\/api\/campaigns\/(camp-[0-9a-f-]{36})$/.exec(path);
  if (req.method === 'GET' && detailMatch) {
    if (!rateLimit(`camp:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    const found = await campaignDetail(detailMatch[1]);
    return found ? json(res, 200, { campaign: found }) : json(res, 404, { error: 'not_found' });
  }

  /* ── Участие ───────────────────────────────────────────────────────── */

  const joinMatch = /^\/api\/campaigns\/(camp-[0-9a-f-]{36})\/join$/.exec(path);
  if (req.method === 'POST' && joinMatch) {
    if (!rateLimit(`camp:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    const b = await body();
    const r = await joinCampaign(joinMatch[1], me, { videoUrl: b.videoUrl });
    return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
  }

  const mineMatch = /^\/api\/campaigns\/(camp-[0-9a-f-]{36})\/mine$/.exec(path);
  if (req.method === 'GET' && mineMatch) {
    if (!rateLimit(`camp:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    const found = await myParticipation(mineMatch[1], me);
    return json(res, 200, { participation: found });
  }

  const partMatch = /^\/api\/campaigns\/participations\/(cpp-[0-9a-f-]{36})(\/[a-z-]+)?$/.exec(path);
  if (partMatch) {
    const pid = partMatch[1];
    const tail = partMatch[2] ?? '';
    if (!PARTICIPATION_ID_RE.test(pid)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '/link') {
      if (!rateLimit(`camp:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await myLink(pid, me);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/link/regenerate') {
      if (!rateLimit(`camp:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await myLink(pid, me, { regenerate: true });
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/request-reward') {
      if (!rateLimitPerHour(`camp:reward:${me}`, 10)) return json(res, 429, { error: 'too_many_requests' });
      const r = await requestReward(pid, me);
      return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
    }
    return json(res, 404, { error: 'not_found' });
  }

  /* ── Администрирование: мероприятия ───────────────────────────────── */

  if (req.method === 'GET' && path === '/api/campaigns/admin') {
    if (!rateLimit(`camp:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    const r = await listCampaignsForAdmin(me);
    return r?.error ? json(res, errCode(r.error), r) : json(res, 200, { campaigns: r });
  }
  if (req.method === 'POST' && path === '/api/campaigns/admin') {
    if (!rateLimit(`camp:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    const r = await createCampaign(me, await body());
    return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
  }

  if (req.method === 'GET' && path === '/api/campaigns/admin/grants') {
    if (!rateLimit(`camp:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    const params = new URL(req.url, 'http://x').searchParams;
    const r = await listRewardGrantsForAdmin(me, {
      status: params.get('status') || undefined, campaignId: params.get('campaignId') || undefined,
    });
    return r?.error ? json(res, errCode(r.error), r) : json(res, 200, { grants: r });
  }
  const grantRejectMatch = /^\/api\/campaigns\/admin\/grants\/(cprg-[0-9a-f-]{36})\/reject$/.exec(path);
  if (req.method === 'POST' && grantRejectMatch) {
    if (!rateLimit(`camp:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
    if (!GRANT_ID_RE.test(grantRejectMatch[1])) return json(res, 404, { error: 'not_found' });
    const b = await body();
    const r = await rejectRewardGrant(me, grantRejectMatch[1], b.reason);
    return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
  }

  const adminCampMatch = /^\/api\/campaigns\/admin\/(camp-[0-9a-f-]{36})(\/[a-z-]+)?(\/.*)?$/.exec(path);
  if (adminCampMatch) {
    const cid = adminCampMatch[1];
    const tail = adminCampMatch[2] ?? '';
    const rest = adminCampMatch[3] ?? '';
    if (!CAMPAIGN_ID_RE.test(cid)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'PATCH' && tail === '') {
      if (!rateLimit(`camp:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await updateCampaign(me, cid, await body());
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/active') {
      if (!rateLimit(`camp:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const r = await setCampaignActive(me, cid, b.on !== false);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/archive') {
      if (!rateLimit(`camp:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await archiveCampaign(me, cid);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
    if (req.method === 'POST' && tail === '/cover') {
      if (!(await can(me, 'campaigns'))) return json(res, 403, { error: 'not_allowed' });
      const { rows: exists } = await query('SELECT id FROM campaigns WHERE id = $1', [cid]);
      if (!exists[0]) return json(res, 404, { error: 'not_found' });
      if (!rateLimitPerHour(`camp:upload:${me}`, UPLOAD_PER_HOUR)) return json(res, 429, { error: 'too_many_requests' });
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > MAX_COVER_BYTES) return json(res, 413, { error: 'too_large' });
      const head = await peek(req, 32);
      const mime = sniff(head);
      if (!mime) return json(res, 415, { error: 'unsupported_image' });
      const saved = await saveStream(coverIdFor(cid), withHead(head, req), MAX_COVER_BYTES);
      if (saved.error) return json(res, saved.error === 'too_large' ? 413 : 500, saved);
      await query('UPDATE campaigns SET has_cover = TRUE, cover_mime = $2 WHERE id = $1', [cid, mime]);
      return json(res, 201, { ok: true, bytes: saved.bytes });
    }

    if (req.method === 'GET' && tail === '/participants') {
      if (!rateLimit(`camp:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
      const r = await listParticipantsForAdmin(me, cid);
      return r?.error ? json(res, errCode(r.error), r) : json(res, 200, { participants: r });
    }

    if (tail === '/levels') {
      if (req.method === 'GET' && rest === '') {
        if (!rateLimit(`camp:r:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
        const r = await listLevels(me, cid);
        return r?.error ? json(res, errCode(r.error), r) : json(res, 200, { levels: r });
      }
      if (req.method === 'POST' && rest === '') {
        if (!rateLimit(`camp:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
        const r = await createLevel(me, cid, await body());
        return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
      }
      const levelMatch = /^\/(cplv-[0-9a-f-]{36})(\/[a-z]+)?$/.exec(rest);
      if (levelMatch) {
        const lid = levelMatch[1];
        const ltail = levelMatch[2] ?? '';
        if (!LEVEL_ID_RE.test(lid)) return json(res, 404, { error: 'not_found' });
        if (req.method === 'PATCH' && ltail === '') {
          if (!rateLimit(`camp:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
          const r = await updateLevel(me, lid, await body());
          return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
        }
        if (req.method === 'POST' && ltail === '/active') {
          if (!rateLimit(`camp:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
          const b = await body();
          const r = await setLevelActive(me, lid, b.on !== false);
          return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
        }
        if (req.method === 'DELETE' && ltail === '') {
          if (!rateLimit(`camp:w:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'too_many_requests' });
          const r = await deleteLevel(me, lid);
          return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
        }
      }
    }
  }

  return false;
};
