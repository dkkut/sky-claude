import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can } from './../admin.mjs';
import { logAdmin } from './../adminsec.mjs';
import { isClosed } from './../modclosure.mjs';
import * as G from './../lgames.mjs';

const ERR = { not_found: 404, forbidden: 403, invalid: 400, too_many: 429, bad_status: 409, incomplete: 422, insufficient_funds: 402, version_exists: 409, build_closed: 409, build_in_use: 409,
  file_too_large: 413, build_too_large: 413, too_large: 413, not_in_library: 403, not_available: 409, not_approved: 409, self_review: 403, blocked: 423, module_closed: 503 };
const code = (r) => ERR[r.error] ?? 400;

const readRaw = (req, limit) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too_large'), { code: 'too_large' })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
});

/** Sky Game Launcher: каталог, библиотека, загрузка файлов (игроки), кабинет владельца (/dev) и модерация (/api/admin/launcher/games). */
export const lgamesRoutes = async (req, res, url) => {
  const player = url.startsWith('/api/launcher/') && !url.startsWith('/api/launcher/servers') && !url.startsWith('/api/launcher/profiles');
  const admin = url.startsWith('/api/admin/launcher/games') || url.startsWith('/api/admin/launcher/queues') || url.startsWith('/api/admin/launcher/owners') || url.startsWith('/api/admin/launcher/builds');
  if (!player && !admin) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId; const u = new URL(req.url, 'http://x'); let m;
  const reply = (r, okCode = 200) => json(res, r.error ? code(r) : okCode, r);
  const body = async () => (req.method === 'GET' || req.method === 'DELETE' ? {} : ((await parseBody(req)) ?? {}));

  if (admin) {
    if (!rateLimit(`lgadm:${me}`, 150)) return json(res, 429, { error: 'too_many_requests' });
    const mod = await can(me, 'launcher_moderation'); const cfg = await can(me, 'launcher');
    if (!mod && !cfg) return json(res, 403, { error: 'forbidden' });
    const audit = (type, detail, meta) => logAdmin({ actorId: me, targetType: 'system', type, detail, meta }).catch(() => {});
    if (url === '/api/admin/launcher/games' && req.method === 'GET') return json(res, 200, await G.adminGames(Object.fromEntries(u.searchParams)));
    if (url === '/api/admin/launcher/owners' && req.method === 'GET') return json(res, 200, await G.adminOwners());
    if (url === '/api/admin/launcher/queues' && req.method === 'GET') return json(res, 200, await G.adminQueues());
    if ((m = url.match(/^\/api\/admin\/launcher\/games\/(lgm-[0-9a-f-]{36})(?:\/(decide|featured))?$/))) {
      if (!m[2] && req.method === 'GET') return reply(await G.adminGame(m[1]));
      const b = await body();
      if (m[2] === 'decide' && req.method === 'POST') {
        if (!mod) return json(res, 403, { error: 'forbidden' });
        const r = await G.decideGame(me, m[1], String(b.decision ?? ''), b.note); if (r.ok) await audit('launcher_game_decision', `${b.decision} ${m[1]}`); return reply(r);
      }
      if (m[2] === 'featured' && req.method === 'POST') { if (!cfg) return json(res, 403, { error: 'forbidden' }); const r = await G.adminSetFeatured(m[1], b.on); await audit('launcher_game_featured', `${m[1]} ${b.on ? 'on' : 'off'}`); return reply(r); }
    }
    if ((m = url.match(/^\/api\/admin\/launcher\/builds\/(lbd-[0-9a-f-]{36})\/decide$/)) && req.method === 'POST') {
      if (!mod) return json(res, 403, { error: 'forbidden' });
      const b = await body(); const r = await G.decideBuild(me, m[1], String(b.decision ?? ''), b.note); if (r.ok) await audit('launcher_build_decision', `${b.decision} ${m[1]}`); return reply(r);
    }
    return json(res, 404, { error: 'not_found' });
  }

  if (!rateLimit(`lg:${me}`, 300)) return json(res, 429, { error: 'too_many_requests' });
  if (await isClosed('launcher')) return json(res, 503, { error: 'module_closed' });

  /* ── файлы игры: поток с Range, право проверяется на каждый запрос ── */
  if ((m = url.match(/^\/api\/launcher\/blob\/(lbd-[0-9a-f-]{36})\/([0-9a-f]{64})$/)) && req.method === 'GET') {
    if (!rateLimit(`lgblob:${me}`, 600)) return json(res, 429, { error: 'too_many_requests' });
    const acc = await G.blobAccess(me, m[1], m[2]); if (!acc) return json(res, 404, { error: 'not_found' });
    let start = 0; let end = acc.size - 1; const rg = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (rg) { if (rg[1] !== '') { start = Number(rg[1]); if (rg[2] !== '') end = Math.min(end, Number(rg[2])); } else if (rg[2] !== '') start = Math.max(0, acc.size - Number(rg[2])); if (start > end || start >= acc.size) { res.writeHead(416, { 'Content-Range': `bytes */${acc.size}` }); return res.end(); } }
    res.writeHead(rg ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(rg ? { 'Content-Range': `bytes ${start}-${end}/${acc.size}` } : {}), 'Cache-Control': 'private, max-age=0', 'X-Content-Type-Options': 'nosniff' });
    if (acc.size === 0) return res.end();
    const st = G.openBlob(acc.path, { start, end }); st.on('error', () => res.destroy()); res.on('close', () => st.destroy()); st.pipe(res); return true;
  }
  /* ── загрузка файла сборки владельцем: сырое тело, потоково ── */
  if ((m = url.match(/^\/api\/launcher\/dev\/builds\/(lbd-[0-9a-f-]{36})\/file$/)) && req.method === 'PUT') {
    if (!rateLimit(`lgup:${me}`, 600)) return json(res, 429, { error: 'too_many_requests' });
    const size = req.headers['content-length'] !== undefined ? Number(req.headers['content-length']) : NaN;
    return reply(await G.receiveFile(me, m[1], u.searchParams.get('path'), req, size));
  }
  if ((m = url.match(/^\/api\/launcher\/dev\/games\/(lgm-[0-9a-f-]{36})\/media\/(cover|screenshot)$/)) && req.method === 'PUT') {
    let buf; try { buf = await readRaw(req, 1_000_000); } catch { return json(res, 413, { error: 'too_large' }); }
    return reply(await G.addMedia(me, m[1], m[2], buf));
  }

  if (url === '/api/launcher/terms' && req.method === 'GET') return json(res, 200, { terms: G.TERMS });
  if (url === '/api/launcher/catalog' && req.method === 'GET') return json(res, 200, await G.listCatalog(me, Object.fromEntries(u.searchParams)));
  if (url === '/api/launcher/library' && req.method === 'GET') return json(res, 200, await G.listLibrary(me));
  if ((m = url.match(/^\/api\/launcher\/media\/(lmd-[0-9a-f-]{36})$/)) && req.method === 'GET') {
    const x = await G.getMedia(m[1], me, (await can(me, 'launcher')) || (await can(me, 'launcher_moderation'))); if (!x) return json(res, 404, { error: 'not_found' });
    res.writeHead(200, { 'Content-Type': x.mime, 'Content-Length': x.data.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' }); return res.end(x.data);
  }
  if ((m = url.match(/^\/api\/launcher\/games\/(lgm-[0-9a-f-]{36})(?:\/(manifest))?$/)) && req.method === 'GET') {
    if (m[2]) { const r = await G.getManifest(me, m[1], u.searchParams.get('channel') === 'test' ? 'test' : 'release'); return reply(r); }
    return reply(await G.gameDetail(me, m[1], (await can(me, 'launcher')) || (await can(me, 'launcher_moderation'))));
  }
  const b = await body();
  if ((m = url.match(/^\/api\/launcher\/library\/(lgm-[0-9a-f-]{36})(?:\/(favorite))?$/))) {
    if (m[2] && req.method === 'POST') return reply(await G.setFavorite(me, m[1], b.on !== false));
    if (!m[2] && req.method === 'POST') return reply(await G.addToLibrary(me, m[1]));
    if (!m[2] && req.method === 'DELETE') return reply(await G.removeFromLibrary(me, m[1]));
  }
  if (url === '/api/launcher/events' && req.method === 'POST') { if (!rateLimit(`lgev:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' }); return reply(await G.recordEvent(me, String(b.gameId ?? ''), String(b.kind ?? ''))); }

  /* ── кабинет владельца ── */
  if (url === '/api/launcher/dev/games') { if (req.method === 'GET') return json(res, 200, await G.myGames(me)); if (req.method === 'POST') return reply(await G.createGame(me, b)); }
  if (url === '/api/launcher/dev/transfers' && req.method === 'GET') return json(res, 200, await G.incomingTransfers(me));
  if ((m = url.match(/^\/api\/launcher\/dev\/transfers\/(ltr-[0-9a-f-]{36})\/(accept|decline)$/)) && req.method === 'POST') return reply(await G.answerTransfer(me, m[1], m[2] === 'accept'));
  if ((m = url.match(/^\/api\/launcher\/dev\/games\/(lgm-[0-9a-f-]{36})(?:\/([a-z-]+))?(?:\/([A-Za-z0-9:.-]{1,64}))?$/))) {
    const gid = m[1]; const act = m[2]; const arg = m[3];
    if (!act && req.method === 'GET') return reply(await G.myGame(me, gid));
    if (!act && req.method === 'PUT') return reply(await G.saveGame(me, gid, b));
    if (act === 'media' && req.method === 'DELETE') return reply(await G.deleteMedia(me, gid, arg));
    if (act === 'builds' && req.method === 'POST') return reply(await G.createBuild(me, gid, b));
    if (act === 'placement' && req.method === 'GET') return reply(await G.placementState(me, gid));
    if (act === 'submit' && req.method === 'POST') { if (!rateLimit(`lgsub:${me}`, 10)) return json(res, 429, { error: 'too_many_requests' }); return reply(await G.submitGame(me, gid, b.idemKey)); }
    if (act === 'members' && req.method === 'POST') return reply(await G.addMember(me, gid, b.username, b.role));
    if (act === 'members' && req.method === 'DELETE') return reply(await G.removeMember(me, gid, arg));
    if (act === 'transfer' && req.method === 'POST') return reply(await G.proposeTransfer(me, gid, b.username, b.confirmTitle));
    if (act === 'news' && req.method === 'POST') return reply(await G.postNews(me, gid, b.title, b.body));
    if (act === 'stats' && req.method === 'GET') return reply(await G.gameStats(me, gid, u.searchParams.get('days')));
  }
  if ((m = url.match(/^\/api\/launcher\/dev\/builds\/(lbd-[0-9a-f-]{36})(?:\/(finalize|submit|publish))?$/))) {
    if (m[2] === 'finalize' && req.method === 'POST') return reply(await G.finalizeBuild(me, m[1], b));
    if (m[2] === 'submit' && req.method === 'POST') return reply(await G.submitBuild(me, m[1]));
    if (m[2] === 'publish' && req.method === 'POST') return reply(await G.publishBuild(me, m[1]));
    if (!m[2] && req.method === 'DELETE') return reply(await G.deleteBuild(me, m[1]));
  }
  return json(res, 404, { error: 'not_found' });
};
