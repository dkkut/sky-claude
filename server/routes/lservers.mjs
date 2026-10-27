import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can } from './../admin.mjs';
import { logAdmin } from './../adminsec.mjs';
import { isClosed } from './../modclosure.mjs';
import { query } from './../db.mjs';
import * as S from './../lservers.mjs';

const ERR = { not_found: 404, duplicate: 409, invalid: 400, too_many: 429, changed_since: 409, already_rolled_back: 409 };

/** Sky Launcher → серверы GTA V / Minecraft: каталог, избранное, история, профили (люди) и управление карточками (право `launcher`). */
export const lserversRoutes = async (req, res, url) => {
  const user = url.startsWith('/api/launcher/servers') || url.startsWith('/api/launcher/profiles');
  const admin = url.startsWith('/api/admin/launcher/servers') || url.startsWith('/api/admin/launcher/import') || url.startsWith('/api/admin/launcher/settings');
  if (!user && !admin) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId; const u = new URL(req.url, 'http://x'); let m;
  const reply = (r) => json(res, r.error ? (ERR[r.error] ?? 400) : 200, r);

  if (user) {
    if (!rateLimit(`lsrv:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
    if (await isClosed('launcher')) return json(res, 503, { error: 'module_closed' });
    const b = req.method === 'GET' ? {} : ((await parseBody(req)) ?? {});
    if (url === '/api/launcher/servers' && req.method === 'GET') return json(res, 200, await S.listServers(me, Object.fromEntries(u.searchParams)));
    if (url === '/api/launcher/servers/facets' && req.method === 'GET') return json(res, 200, await S.serverFacets(u.searchParams.get('kind') === 'gta' ? 'gta' : 'minecraft'));
    if (url === '/api/launcher/servers/history') {
      if (req.method === 'GET') return json(res, 200, await S.listHistory(me));
      if (req.method === 'DELETE') return json(res, 200, await S.clearHistory(me));
    }
    if ((m = url.match(/^\/api\/launcher\/servers\/(lsv-[0-9a-f-]{36})\/(favorite|connect)$/)) && req.method === 'POST') {
      if (m[2] === 'favorite') return reply(await S.toggleFavorite(me, m[1], b.on !== false));
      if (!rateLimit(`lconn:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' });
      return reply(await S.connectInfo(me, m[1]));
    }
    if (url === '/api/launcher/profiles') {
      if (req.method === 'GET') return json(res, 200, await S.listProfiles(me, u.searchParams.get('kind')));
      if (req.method === 'POST') return reply(await S.saveProfile(me, b));
    }
    if ((m = url.match(/^\/api\/launcher\/profiles\/(lpr-[0-9a-f-]{36})(\/reset)?$/))) {
      if (m[2] && req.method === 'POST') return reply(await S.resetProfile(me, m[1]));
      if (!m[2] && req.method === 'DELETE') return reply(await S.deleteProfile(me, m[1]));
    }
    return json(res, 404, { error: 'not_found' });
  }

  /* ── администрация ── */
  if (!(await can(me, 'launcher'))) return json(res, 403, { error: 'forbidden' });
  if (!rateLimit(`ladm:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const b = req.method === 'GET' ? {} : ((await parseBody(req)) ?? {});
  const audit = (type, detail, meta) => logAdmin({ actorId: me, targetType: 'system', type, detail, meta }).catch(() => {});

  if (url === '/api/admin/launcher/servers' && req.method === 'GET') return json(res, 200, await S.adminListServers(Object.fromEntries(u.searchParams)));
  if (url === '/api/admin/launcher/servers' && req.method === 'POST') { const r = await S.adminSaveServer(me, null, b); if (r.ok) await audit('launcher_server_create', String(b.name ?? '').slice(0, 80)); return reply(r); }
  if (url === '/api/admin/launcher/servers/log' && req.method === 'GET') return json(res, 200, await S.serverLog(u.searchParams.get('id')));
  if ((m = url.match(/^\/api\/admin\/launcher\/servers\/(lsv-[0-9a-f-]{36})(\/probe)?$/))) {
    if (m[2] && req.method === 'POST') {
      if (!rateLimit(`lprobe:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' });
      const r = await S.probeAndStore(m[1]); return r ? json(res, 200, r) : json(res, 404, { error: 'not_found' });
    }
    if (!m[2] && req.method === 'PUT') { const r = await S.adminSaveServer(me, m[1], b); if (r.ok) await audit('launcher_server_update', m[1]); return reply(r); }
    if (!m[2] && req.method === 'DELETE') { const r = await S.adminDeleteServer(me, m[1]); if (r.ok) await audit('launcher_server_delete', m[1]); return reply(r); }
  }
  if (url === '/api/admin/launcher/import/preview' && req.method === 'POST') {
    const p = await S.planImport(b?.doc ?? b); if (p.error) return reply(p);
    return json(res, 200, { ...p, items: p.items.map(({ _v, ...x }) => x) });
  }
  if (url === '/api/admin/launcher/import/apply' && req.method === 'POST') { const r = await S.applyImport(me, b?.doc ?? b); if (r.ok) await audit('launcher_import', `batch ${r.batch}`, r.counts); return reply(r); }
  if (url === '/api/admin/launcher/import/rollback' && req.method === 'POST') { const r = await S.rollbackBatch(me, String(b.batch ?? '')); if (r.ok) await audit('launcher_import_rollback', String(b.batch)); return reply(r); }
  if (url === '/api/admin/launcher/settings') {
    if (req.method === 'GET') { const r = (await query(`SELECT value FROM launcher_settings WHERE key='probe'`)).rows[0]; return json(res, 200, { probe: { enabled: true, intervalMin: 5, ...(r?.value ?? {}) } }); }
    if (req.method === 'PUT') {
      const v = { enabled: b.enabled !== false, intervalMin: Math.max(2, Math.min(60, Math.floor(Number(b.intervalMin) || 5))) };
      await query(`INSERT INTO launcher_settings (key, value, updated_by) VALUES ('probe',$1,$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=now()`, [JSON.stringify(v), me]);
      await audit('launcher_settings', `probe ${v.enabled ? 'on' : 'off'} ${v.intervalMin}`); return json(res, 200, { probe: v });
    }
  }
  return json(res, 404, { error: 'not_found' });
};
