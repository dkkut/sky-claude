import crypto from 'node:crypto';
import { json, parseBody, requireProfile, clientIp } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta } from './../adminsec.mjs';
import { agentAuth } from './serverops.mjs';
import * as G from './../gameinfra.mjs';
import { KINDS, MC_TYPES, GTA_PLATFORMS } from './../gamespec.mjs';

const STATUS = { not_found: 404, not_allowed: 403, owner_only: 403, bad_state: 409, stop_first: 409, agent_offline: 409, command_in_progress: 409, main_host_not_confirmed: 403, insufficient_resources: 409, launch_not_supported: 409, main_exists: 409, port_busy: 409, no_free_port: 409 };
const PURPOSE = 'game_infra';
const secret = () => String(process.env.GAMEINFRA_SECRET ?? '');
/** Ключ агента одного хоста: производный от общего секрета и id хоста — чужой хост подписать за этот не сможет. */
export const hostKey = (hostId) => crypto.createHmac('sha256', secret()).update(`host:${hostId}`).digest('hex');
const readRaw = (req, max = 512 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
});

/** /api/ops/agent/games/* — агент игрового хоста (стоит ДО маршрутов Sky Ops; адрес уже выведен из шлюзов), /api/admin/gameinfra/* — панель (право `game_infra`). */
export const gameInfraRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (path.startsWith('/api/ops/agent/games/')) {
    const ip = clientIp(req);
    if (!rateLimit(`gia:${ip}`, 600)) return json(res, 429, { error: 'too_many_requests' });
    if (secret().length < 24) return json(res, 404, { error: 'disabled' });
    const hostId = String(req.headers['x-game-host'] ?? ''); if (!/^gh-[0-9a-f-]{36}$/.test(hostId)) return json(res, 403, { error: 'bad_host' });
    let raw; try { raw = await readRaw(req); } catch { return json(res, 413, { error: 'too_large' }); }
    const bad = agentAuth(req, path, raw, hostKey(hostId)); if (bad) return json(res, 403, { error: bad });
    const b = raw.length ? (() => { try { return JSON.parse(raw.toString('utf8')); } catch { return {}; } })() : {};
    if (path === '/api/ops/agent/games/ping' && req.method === 'POST') return json(res, 200, await G.agentPing(hostId, b));
    if (path === '/api/ops/agent/games/claim' && req.method === 'POST') { await G.agentPing(hostId, { version: b.version ?? '', metrics: b.metrics ?? {}, servers: b.servers ?? [] }); return json(res, 200, await G.agentClaim(hostId)); }
    if (path === '/api/ops/agent/games/report' && req.method === 'POST') { const r = await G.agentReport(hostId, String(b.commandId ?? ''), { ok: b.ok === true, output: b.output, backup: b.backup }); return json(res, r.error ? 404 : 200, r); }
    return json(res, 404, { error: 'not_found' });
  }
  if (!path.startsWith('/api/admin/gameinfra')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;
  if (!(await can(me, 'game_infra'))) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`gi:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const owner = await isOwner(me); const meta = requestMeta(req);
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  const body = async () => (await parseBody(req)) ?? {};
  const stepUp = async (b) => { if (!owner) return { error: 'owner_only' }; const st = await consumeStepUp(me, PURPOSE, b.stepUpCode, { meta }); return st.error ? { error: st.error } : null; };
  let m;

  if (req.method === 'GET' && path === '/api/admin/gameinfra') {
    const audit = G.auditResources();
    return json(res, 200, { owner, kinds: KINDS, mcTypes: MC_TYPES, gtaPlatforms: GTA_PLATFORMS, audit, mainHost: G.mainHostAssessment(audit), hosts: await G.listHosts(), servers: await G.listServers(me, { owner }) });
  }
  if (req.method === 'POST' && path === '/api/admin/gameinfra/step-up') { if (!owner) return json(res, 403, { error: 'owner_only' }); const r = await beginStepUp(me, PURPOSE, { meta }); return json(res, r.error ? 400 : 200, r); }
  if (req.method === 'GET' && path === '/api/admin/gameinfra/log') return json(res, 200, { log: await G.infraLog() });
  if (req.method === 'POST' && path === '/api/admin/gameinfra/hosts') { const b = await body(); const e = await stepUp(b); if (e) return json(res, e.error === 'owner_only' ? 403 : 401, e); return reply(await G.createHost(me, b)); }
  if (req.method === 'POST' && (m = /^\/api\/admin\/gameinfra\/hosts\/(gh-[0-9a-f-]{36})\/(confirm-main|revoke-main|key)$/.exec(path))) {
    const b = await body(); const e = await stepUp(b); if (e) return json(res, e.error === 'owner_only' ? 403 : 401, e);
    if (m[2] === 'key') { if (secret().length < 24) return json(res, 409, { error: 'secret_not_set' }); return json(res, 200, { hostId: m[1], key: hostKey(m[1]), note: 'Ключ агента этого хоста. Показывается по запросу владельца; храните его только на игровом хосте.' }); }
    return reply(await G.confirmMainHost(me, m[1], m[2] === 'confirm-main'));
  }
  if (req.method === 'POST' && path === '/api/admin/gameinfra/fit') { const b = await body(); const { cleanLimits } = await import('./../gamespec.mjs'); const l = cleanLimits(b.limits); if (l.error) return json(res, 400, l); return json(res, 200, G.fitCheck(G.auditResources(), l.limits)); }
  if (req.method === 'POST' && path === '/api/admin/gameinfra/servers') { if (!owner && !(await can(me, 'game_infra'))) return json(res, 403, { error: 'not_allowed' }); return reply(await G.createServer(me, await body())); }
  if ((m = /^\/api\/admin\/gameinfra\/servers\/(gs-[0-9a-f-]{36})(?:\/([a-z-]+))?$/.exec(path))) {
    const sid = m[1]; const sub = m[2] ?? '';
    const level = await G.accessLevel(me, sid, { owner });
    if (!level) return json(res, 404, { error: 'not_found' });                       // чужой сервер (по списку доступа) не раскрываем
    if (req.method === 'GET' && !sub) return reply(await G.serverDetail(sid));
    if (req.method === 'GET' && sub === 'log') return json(res, 200, { log: await G.infraLog(sid) });
    if (level !== 'operate') return json(res, 403, { error: 'not_allowed' });
    if (req.method === 'POST' && ['start', 'stop', 'restart', 'backup', 'logs'].includes(sub)) return reply(await G.enqueue(me, sid, sub));
    if (req.method === 'PUT' && !sub) return reply(await G.updateServer(me, sid, await body()));
    if (req.method === 'DELETE' && !sub) { const b = await body(); const e = await stepUp(b); if (e) return json(res, e.error === 'owner_only' ? 403 : 401, e); return reply(await G.removeServer(me, sid)); }
    if (req.method === 'POST' && sub === 'access') { const b = await body(); const e = await stepUp(b); if (e) return json(res, e.error === 'owner_only' ? 403 : 401, e); return reply(await G.setAccess(me, sid, b.username, b.level)); }
  }
  return json(res, 404, { error: 'not_found' });
};
