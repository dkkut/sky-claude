import { json, requireProfile, parseBody, clientIp } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import * as site from './../sitecms.mjs';

const ERR_STATUS = { not_allowed: 403, not_found: 404, file_too_large: 413, upload_interrupted: 400, empty_file: 400, unsupported_type: 415, too_many_files: 409, bad_extension: 400 };
const reply = (res, r) => json(res, r.error ? (ERR_STATUS[r.error] ?? 400) : 200, r);

/** Отдача файла с поддержкой Range (apk/exe — десятки мегабайт, докачка на слабой сети обязательна). */
const sendFile = (req, res, { path, size, mime, name, cache }) => {
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  let start = 0; let end = size - 1; let status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1] === '') { start = Math.max(0, size - Number(range[2])); } else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    status = 206;
  }
  const h = { 'Content-Type': mime, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': cache ?? 'private, no-store' };
  if (status === 206) h['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, h);
  if (req.method === 'HEAD') return res.end();
  const s = site.openRange(path, start, end);
  s.on('error', () => res.destroy()); res.on('close', () => s.destroy());
  return s.pipe(res);
};

/** Открытая часть: то, что читает лендинг (без входа). Нужна и в «Технических работах»: страница статуса должна отвечать всегда. */
export const siteRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/site/')) return false;
  const ip = clientIp(req);
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;
  if (!rateLimit(`site:any:${ip}`, 240)) return json(res, 429, { error: 'too_many_requests' });

  if (req.method === 'GET' && path === '/api/site/public') {
    res.setHeader('Cache-Control', 'public, max-age=20');
    return json(res, 200, await site.publicContent());
  }

  let m;
  if ((req.method === 'GET' || req.method === 'HEAD') && (m = path.match(/^\/api\/site\/download\/([a-z0-9_-]{2,20})$/))) {
    if (!rateLimit(`site:dl:${ip}`, 30)) return json(res, 429, { error: 'too_many_requests' });
    const f = await site.downloadFile(m[1]);
    if (!f) return json(res, 404, { error: 'not_found' });
    // Счётчик считает начало скачивания, а не каждый докачанный кусок.
    return sendFile(req, res, { path: f.path, size: Number(f.file.size), mime: f.file.mime, name: f.file.name, cache: 'public, max-age=300' });
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  if (path === '/api/site/upload') {
    if (!rateLimitPerHour(`site:up:${ip}`, 30)) { req.resume(); return json(res, 429, { error: 'too_many_requests' }); }
    const r = await site.attach({ owner: u.searchParams.get('owner'), code: u.searchParams.get('code'), token: u.searchParams.get('token'), role: u.searchParams.get('role') ?? 'file', name: u.searchParams.get('name') }, req);
    return reply(res, r);
  }

  const b = (await parseBody(req)) ?? {};
  if (path === '/api/site/check') {
    if (!rateLimit(`site:chk:${ip}`, 20) || !rateLimitPerHour(`site:chk:h:${ip}`, 100)) return json(res, 429, { error: 'too_many_requests' });
    return reply(res, await site.checkAppeal(b.code, b.email));
  }
  if (path === '/api/site/appeals' || path === '/api/site/releases') {
    // Ловушка для ботов: настоящий человек это поле не видит и не заполняет.
    if (b.website) return json(res, 200, { ok: true, code: 'SKY-0000-0000', token: 'x' });
    if (!rateLimitPerHour(`site:sub:${ip}`, 8) || !rateLimit(`site:sub:m:${ip}`, 3)) return json(res, 429, { error: 'too_many_requests' });
    return reply(res, path.endsWith('appeals') ? await site.submitAppeal(b, { ip }) : await site.submitRelease(b, { ip }));
  }
  return json(res, 404, { error: 'not_found' });
};

/** Админка сайта (право `site`). */
export const siteAdminRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/admin/site')) return false;
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const u = new URL(req.url, 'http://x');
  const path = u.pathname; const meta = requestMeta(req);
  const w = req.method !== 'GET' && req.method !== 'HEAD';
  if (!rateLimit(`adm:site:${w ? 'w' : 'r'}:${me}`, w ? 60 : 240)) { if (w) req.resume(); return json(res, 429, { error: 'too_many_requests' }); }
  const deny = () => json(res, 403, { error: 'not_allowed' });
  let m;

  if (req.method === 'GET' && path === '/api/admin/site/overview') { const r = await site.adminOverview(me); return r ? json(res, 200, r) : deny(); }
  if (path === '/api/admin/site/links') {
    if (req.method === 'GET') { const r = await site.adminLinks(me); return r ? json(res, 200, r) : deny(); }
    if (req.method === 'PUT') return reply(res, await site.adminSaveLinks(me, (await parseBody(req))?.links, meta));
  }
  if (req.method === 'GET' && path === '/api/admin/site/downloads') { const r = await site.adminDownloads(me); return r ? json(res, 200, r) : deny(); }
  if ((m = path.match(/^\/api\/admin\/site\/downloads\/([a-z0-9_-]{2,20})$/)) && req.method === 'PUT') return reply(res, await site.adminSaveDownload(me, m[1], (await parseBody(req)) ?? {}, meta));
  if ((m = path.match(/^\/api\/admin\/site\/downloads\/([a-z0-9_-]{2,20})\/file$/))) {
    if (req.method === 'POST') return reply(res, await site.adminUploadFile(me, m[1], u.searchParams.get('name'), req, meta));
    if (req.method === 'DELETE') return reply(res, await site.adminDeleteFile(me, m[1], meta));
  }
  if (path === '/api/admin/site/status') {
    if (req.method === 'GET') { const r = await site.adminStatus(me); return r ? json(res, 200, r) : deny(); }
    if (req.method === 'PUT') return reply(res, await site.adminSaveStatus(me, (await parseBody(req)) ?? {}, meta));
  }
  if (req.method === 'GET' && (m = path.match(/^\/api\/admin\/site\/(appeals|releases)$/))) {
    const r = await site.adminQueue(me, m[1] === 'appeals' ? 'appeal' : 'release', u.searchParams.get('status')); return r ? json(res, 200, r) : deny();
  }
  if ((m = path.match(/^\/api\/admin\/site\/(appeals|releases)\/([a-z]{3}-[0-9a-f-]{36})$/)) && req.method === 'GET') {
    const r = await site.adminItem(me, m[1] === 'appeals' ? 'appeal' : 'release', m[2]); return r ? reply(res, r) : deny();
  }
  if ((m = path.match(/^\/api\/admin\/site\/(appeals|releases)\/([a-z]{3}-[0-9a-f-]{36})\/decide$/)) && req.method === 'POST') {
    return reply(res, await site.adminDecide(me, m[1] === 'appeals' ? 'appeal' : 'release', m[2], (await parseBody(req)) ?? {}, meta));
  }
  if ((m = path.match(/^\/api\/admin\/site\/attachments\/(sat-[0-9a-f-]{36})$/)) && req.method === 'GET') {
    const r = await site.adminAttachment(me, m[1]); if (!r) return deny(); if (r.error) return reply(res, r);
    return sendFile(req, res, { path: r.path, size: Number(r.att.size), mime: r.att.mime, name: r.att.name });
  }
  return json(res, 404, { error: 'not_found' });
};
