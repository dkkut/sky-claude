/**
 * Sky ID для сторонних сервисов (OpenID Connect) — маршруты.
 *   публично (для серверов и браузеров сервисов): /api/oidc/.well-known/openid-configuration, /jwks, /token, /userinfo, /revoke
 *   человек (вошёл в Sky): /api/oidc/authorize/init|decide, /api/oidc/consents
 *   сотрудники (право oidc): /api/admin/oidc/*
 * Ядро — server/oidc.mjs.
 */
import crypto from 'node:crypto';
import { json, requireProfile, parseBody, clientIp, BadRequest } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can } from './../admin.mjs';
import { beginStepUp, consumeStepUp, logAdmin, requestMeta } from './../adminsec.mjs';
import * as O from './../oidc.mjs';

const readForm = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 16 * 1024) { reject(new BadRequest('payload_too_large')); req.destroy(); } });
  req.on('end', () => {
    try {
      const ct = String(req.headers['content-type'] ?? '');
      if (ct.includes('application/json')) { const o = raw ? JSON.parse(raw) : {}; resolve(o && typeof o === 'object' && !Array.isArray(o) ? o : {}); return; }
      resolve(Object.fromEntries(new URLSearchParams(raw)));
    } catch { reject(new BadRequest('invalid_body')); }
  });
  req.on('error', reject);
});

const noStore = (res) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Pragma', 'no-cache'); };
const oauthReply = (res, r) => { if (r.noStore) noStore(res); return json(res, r.status, r.body); };
const MULT = Math.max(Number(process.env.OIDC_RATE_MULT) || 1, 1);
const rl = (key, n) => rateLimit(key, n * MULT);
const hashIp = (ip) => crypto.createHash('sha256').update(`oidc-ip:${ip}`).digest('hex').slice(0, 24);

/** Клиент из запроса: Basic или client_secret_post. */
const clientCreds = (req, b) => {
  const h = String(req.headers.authorization ?? '');
  if (/^basic /i.test(h)) {
    try { const [id, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':'); return { id: decodeURIComponent(id), secret: decodeURIComponent(rest.join(':')) }; } catch { return { id: '', secret: '' }; }
  }
  return { id: String(b.client_id ?? ''), secret: b.client_secret ? String(b.client_secret) : '' };
};

const ADMIN_CODE = { not_found: 404, not_allowed: 403, step_up_required: 401, step_up_invalid: 401, step_up_exhausted: 429, no_second_factor: 409, lockdown: 423 };

export const oidcRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/oidc') && !url.startsWith('/api/admin/oidc')) return false;
  const path = new URL(req.url, 'http://x').pathname;
  const ip = clientIp(req);

  /* ─── Публичное: открытые данные и эндпоинты серверов сервисов ─── */
  if (path.startsWith('/api/oidc/')) {
    if (req.method === 'GET' && path === '/api/oidc/.well-known/openid-configuration') { res.setHeader('Cache-Control', 'public, max-age=300'); return json(res, 200, O.discovery()); }
    if (req.method === 'GET' && path === '/api/oidc/jwks') { res.setHeader('Cache-Control', 'public, max-age=300'); return json(res, 200, await O.jwks()); }

    if (req.method === 'POST' && path === '/api/oidc/token') {
      if (!rl(`oidc:tok:${ip}`, 120)) return json(res, 429, { error: 'slow_down' });
      const b = await readForm(req);
      const cr = clientCreds(req, b);
      if (!rl(`oidc:tokc:${cr.id}`, 300)) return json(res, 429, { error: 'slow_down' });
      const auth = await O.authenticateClient(cr.id, cr.secret);
      if (auth.err) {
        // подбор секрета ограничиваем отдельно
        if (!rl(`oidc:badauth:${ip}:${cr.id}`, 10)) return json(res, 429, { error: 'slow_down' });
        if (/^basic /i.test(String(req.headers.authorization ?? ''))) res.setHeader('WWW-Authenticate', 'Basic realm="Sky ID"');
        return oauthReply(res, auth.err);
      }
      return oauthReply(res, await O.exchangeCode(auth.client, b));
    }

    if ((req.method === 'GET' || req.method === 'POST') && path === '/api/oidc/userinfo') {
      if (!rl(`oidc:ui:${ip}`, 300)) return json(res, 429, { error: 'slow_down' });
      const h = String(req.headers.authorization ?? '');
      const r = await O.userinfo(/^bearer /i.test(h) ? h.slice(7).trim() : '');
      if (r.status === 401) res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      return oauthReply(res, r);
    }

    if (req.method === 'POST' && path === '/api/oidc/revoke') {
      if (!rl(`oidc:rev:${ip}`, 120)) return json(res, 429, { error: 'slow_down' });
      const b = await readForm(req);
      const cr = clientCreds(req, b);
      const auth = await O.authenticateClient(cr.id, cr.secret);
      if (auth.err) return oauthReply(res, auth.err);
      return oauthReply(res, await O.revokeToken(auth.client, b.token));
    }
  }

  /* ─── Человек: запрос авторизации и согласия ─── */
  if (path.startsWith('/api/oidc/')) {
    const session = await requireProfile(req, res);
    if (!session) return true;
    const me = session.profileId;

    if (req.method === 'POST' && path === '/api/oidc/authorize/init') {
      if (!rl(`oidc:init:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' });
      const b = (await parseBody(req)) ?? {};
      const r = await O.beginAuthorization(me, b, { ipHash: hashIp(ip) });
      return json(res, r.error && !r.redirectTo ? (r.error === 'too_many_requests' ? 429 : 400) : 200, r);
    }
    if (req.method === 'POST' && path === '/api/oidc/authorize/decide') {
      if (!rl(`oidc:dec:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' });
      const b = (await parseBody(req)) ?? {};
      const r = await O.decideAuthorization(me, b.requestId, b.approve === true, b.scopes);
      return json(res, r.error ? (r.error === 'not_found' ? 404 : r.error === 'already_decided' ? 409 : r.error === 'expired' ? 410 : 400) : 200, r);
    }
    if (req.method === 'GET' && path === '/api/oidc/consents') return json(res, 200, { consents: await O.listConsents(me) });
    const cm = /^\/api\/oidc\/consents\/([A-Za-z0-9_-]{1,64})$/.exec(path);
    if (req.method === 'DELETE' && cm) {
      if (!rl(`oidc:cons:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' });
      const r = await O.revokeConsent(me, cm[1]);
      return json(res, r.error ? 404 : 200, r);
    }
    return json(res, 404, { error: 'not_found' });
  }

  /* ─── Сотрудники ─── */
  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const meta = requestMeta(req);
  if (!(await can(me, 'oidc'))) return json(res, 403, { error: 'not_allowed' });
  if (!rl(`oidc:admin:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const rest = path.slice('/api/admin/oidc'.length);
  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : ((await parseBody(req)) ?? {});
  const reply = (r, okCode = 200) => json(res, r.error ? (ADMIN_CODE[r.error] ?? 400) : okCode, r);
  /** Опасные действия: подтверждение личности (код) под своим назначением. */
  const gate = async (type) => {
    const s = await consumeStepUp(me, 'oidc_admin', body.stepUpCode, { meta });
    if (s.error) { await logAdmin({ actorId: me, type, targetType: 'oidc', result: 'denied', detail: 'нет подтверждения', meta }); return s; }
    return null;
  };

  if (req.method === 'POST' && rest === '/step-up') return reply(await beginStepUp(me, 'oidc_admin', { meta }));
  if (req.method === 'GET' && rest === '/clients') return json(res, 200, { clients: await O.listClients() });
  if (req.method === 'GET' && rest === '/events') return json(res, 200, { events: await O.recentEvents(Number(new URL(req.url, 'http://x').searchParams.get('limit')) || 100) });

  if (req.method === 'POST' && rest === '/clients') {
    const g = await gate('oidc_client_create'); if (g) return reply(g);
    const r = await O.createClient(me, body);
    if (r.ok) await logAdmin({ actorId: me, type: 'oidc_client_create', targetType: 'oidc', detail: `клиент ${r.client.id} «${r.client.name}»`.slice(0, 250), meta });
    return reply(r, 201);
  }
  let m = /^\/clients\/(skyc_[A-Za-z0-9_-]{8,40})$/.exec(rest);
  if (m && req.method === 'PATCH') {
    const g = await gate('oidc_client_update'); if (g) return reply(g);
    const r = await O.updateClient(me, m[1], body);
    if (r.ok) await logAdmin({ actorId: me, type: 'oidc_client_update', targetType: 'oidc', detail: `клиент ${m[1]}`, meta });
    return reply(r);
  }
  m = /^\/clients\/(skyc_[A-Za-z0-9_-]{8,40})\/(rotate-secret|status)$/.exec(rest);
  if (m && req.method === 'POST') {
    const g = await gate(`oidc_client_${m[2]}`); if (g) return reply(g);
    const r = m[2] === 'rotate-secret' ? await O.rotateClientSecret(me, m[1]) : await O.setClientStatus(me, m[1], String(body.status ?? ''));
    if (r.ok) await logAdmin({ actorId: me, type: `oidc_client_${m[2] === 'status' ? String(body.status) : 'secret_rotate'}`, targetType: 'oidc', detail: `клиент ${m[1]}`, meta });
    return reply(r);
  }
  if (req.method === 'POST' && rest === '/keys/rotate') {
    const g = await gate('oidc_key_rotate'); if (g) return reply(g);
    const kid = await O.rotateSigningKey();
    await logAdmin({ actorId: me, type: 'oidc_key_rotate', targetType: 'oidc', detail: `новый ключ ${kid}`, meta });
    return json(res, 200, { ok: true, kid });
  }
  return json(res, 404, { error: 'not_found' });
};
