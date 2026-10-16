/**
 * Sky ID для сторонних сервисов — OpenID Connect поверх OAuth 2.0 (authorization code + PKCE S256).
 *
 * Принцип: человек подтверждает вход в Sky, а сервис получает только минимум.
 *   — по умолчанию: подтверждение входа и ПОПАРНЫЙ идентификатор (sub) — свой у каждого клиента, по нему разные сервисы
 *     не могут сопоставить одного человека. Имя, почта и телефон — только при отдельном согласии на конкретный scope.
 *   — пароль, сессионные токены, постоянные секреты человека сервису никогда не передаются.
 * Честно: Sky как провайдер ВИДИТ, в какие сервисы заходит человек (журнал событий без персональных данных) — вход не «анонимен» для Sky.
 *
 * Безопасность: точные адреса возврата, обязательный PKCE, одноразовый код на 60 секунд (reuse → отзыв выданных токенов),
 * запрос авторизации привязан к клиенту и профилю и решается один раз, подтверждение делается на сервере действующей сессией
 * (анимация свайпа доказательством не является), токены доступа непрозрачные и хранятся хешем, ID-токен подписан ES256 (ключ в БД зашифрован),
 * секреты клиентов — HMAC, сравнение постоянного времени, отзыв согласий и токенов.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { config } from './config.mjs';
import { encryptSecret, decryptSecret, macOf } from './crypto.mjs';
import { generateId } from './security.mjs';
import { L } from './lang.mjs';

export const ISSUER = () => `${config.publicOrigin}/api/oidc`;
const REQUEST_TTL_MIN = 10;
const CODE_TTL_SEC = 60;
const ACCESS_TTL_SEC = 900;
const IDTOKEN_TTL_SEC = 600;
const MAX_PENDING_PER_PROFILE = 10;

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256b64u = (s) => crypto.createHash('sha256').update(s).digest('base64url');
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ─── Разрешения (scope) ───────────────────────────────────────────── */

export const scopeCatalog = () => ({
  openid: { required: true, sensitive: false, label: L('Подтвердить, что это вы (случайный идентификатор, уникальный для этого сервиса)', 'Confirm it is you (a random identifier unique to this service)') },
  profile: { required: false, sensitive: true, label: L('Ваше имя и @username', 'Your name and @username') },
  email: { required: false, sensitive: true, label: L('Ваша подтверждённая почта', 'Your verified email') },
  phone: { required: false, sensitive: true, label: L('Ваш подтверждённый номер телефона', 'Your verified phone number') },
});
export const KNOWN_SCOPES = ['openid', 'profile', 'email', 'phone'];

const parseScope = (s) => [...new Set(String(s ?? '').split(/\s+/).filter(Boolean))];

/* ─── Журнал ───────────────────────────────────────────────────────── */

export const logOidc = (kind, clientId, profileId, detail = {}) =>
  query('INSERT INTO oidc_events (kind, client_id, profile_id, detail) VALUES ($1,$2,$3,$4::jsonb)', [kind, clientId ?? null, profileId ?? null, JSON.stringify(detail)]).catch(() => {});

/* ─── Ключи подписи (ES256) ────────────────────────────────────────── */

const keyCache = new Map();   // kid → KeyObject (закрытый)

const createKey = async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = sha256b64u(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).slice(0, 16);
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  await query(`INSERT INTO oidc_keys (kid, alg, public_jwk, private_sealed) VALUES ($1,'ES256',$2::jsonb,$3) ON CONFLICT DO NOTHING`,
    [kid, JSON.stringify({ ...jwk, kid, alg: 'ES256', use: 'sig' }), encryptSecret(pem)]);
  return kid;
};

/** Действующий ключ подписи (создаётся при первом обращении). Параллельные создания безвредны: берётся самый свежий. */
const activeKey = async () => {
  let { rows } = await query('SELECT kid, private_sealed FROM oidc_keys WHERE retired_at IS NULL ORDER BY created_at DESC LIMIT 1');
  if (!rows[0]) { await createKey(); ({ rows } = await query('SELECT kid, private_sealed FROM oidc_keys WHERE retired_at IS NULL ORDER BY created_at DESC LIMIT 1')); }
  const { kid, private_sealed: sealed } = rows[0];
  if (!keyCache.has(kid)) {
    const pem = decryptSecret(sealed);
    if (!pem) throw new Error('oidc_key_unreadable');
    keyCache.set(kid, crypto.createPrivateKey(pem));
  }
  return { kid, key: keyCache.get(kid) };
};

/** Выпустить новый ключ; прежний остаётся в наборе (для проверки уже выданных токенов), но больше не подписывает. */
export const rotateSigningKey = async () => {
  await query('UPDATE oidc_keys SET retired_at = now() WHERE retired_at IS NULL');
  keyCache.clear();
  return createKey();
};

export const jwks = async () => {
  await activeKey();
  const { rows } = await query(`SELECT public_jwk FROM oidc_keys WHERE retired_at IS NULL OR retired_at > now() - interval '30 days' ORDER BY created_at DESC`);
  return { keys: rows.map((r) => r.public_jwk) };
};

const signJwt = async (payload) => {
  const { kid, key } = await activeKey();
  const head = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
};

export const discovery = () => {
  const iss = ISSUER();
  return {
    issuer: iss,
    authorization_endpoint: `${config.publicOrigin}/oauth/authorize`,
    token_endpoint: `${iss}/token`,
    userinfo_endpoint: `${iss}/userinfo`,
    revocation_endpoint: `${iss}/revoke`,
    jwks_uri: `${iss}/jwks`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    subject_types_supported: ['pairwise'],
    id_token_signing_alg_values_supported: ['ES256'],
    scopes_supported: KNOWN_SCOPES,
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256'],
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'name', 'preferred_username', 'email', 'email_verified', 'phone_number', 'phone_number_verified'],
    authorization_response_iss_parameter_supported: true,
  };
};

/* ─── Клиенты ──────────────────────────────────────────────────────── */

/** Проверка адреса возврата при регистрации: https, либо http только на loopback, либо собственная схема приложения (только публичный клиент). */
export const validateRedirectUri = (uri, kind) => {
  const s = String(uri ?? '').trim();
  if (!s || s.length > 512 || /[\s<>"'\\]/.test(s)) return false;
  let u; try { u = new URL(s); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === 'https:') return !u.username && !u.password;
  if (u.protocol === 'http:') return ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && !u.username && !u.password;
  if (kind === 'public' && /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'ftp:', 'ws:', 'wss:'].includes(u.protocol)) return true;
  return false;
};

const normalizeClientInput = (input, forCreate) => {
  const out = {};
  const kind = input.kind === 'public' ? 'public' : input.kind === 'confidential' ? 'confidential' : (forCreate ? null : undefined);
  if (forCreate && !kind) return { error: 'bad_kind' };
  if (kind !== undefined) out.kind = kind;
  if (input.name !== undefined || forCreate) {
    const name = String(input.name ?? '').trim().slice(0, 80);
    if (name.length < 2) return { error: 'bad_name' };
    out.name = name;
  }
  if (input.description !== undefined) out.description = String(input.description).slice(0, 300);
  if (input.homepageUrl !== undefined) {
    const h = String(input.homepageUrl).trim();
    if (h && !/^https:\/\/[^\s]+$/.test(h)) return { error: 'bad_homepage' };
    out.homepage_url = h.slice(0, 300);
  }
  if (input.redirectUris !== undefined || forCreate) {
    const list = [...new Set((Array.isArray(input.redirectUris) ? input.redirectUris : []).map((x) => String(x).trim()))];
    if (!list.length || list.length > 10) return { error: 'bad_redirect_uris' };
    out.redirect_uris = list;
  }
  if (input.scopes !== undefined) {
    const sc = parseScope(Array.isArray(input.scopes) ? input.scopes.join(' ') : input.scopes);
    if (!sc.includes('openid') || sc.some((x) => !KNOWN_SCOPES.includes(x))) return { error: 'bad_scopes' };
    out.scopes = sc;
  }
  return { out };
};

const clientView = (r) => ({
  id: r.id, name: r.name, description: r.description, homepageUrl: r.homepage_url, kind: r.kind, redirectUris: r.redirect_uris,
  scopes: r.scopes, status: r.status, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  secretRotatedAt: r.secret_rotated_at ? r.secret_rotated_at.toISOString() : null, hasSecret: Boolean(r.secret_hash),
});

export const listClients = async () => (await query(`SELECT * FROM oidc_clients WHERE status <> 'deleted' ORDER BY created_at DESC`)).rows.map(clientView);

/** Создать клиента. Секрет возвращается ОДИН раз; в базе — только HMAC. Публичные клиенты секрета не имеют (их защищает PKCE). */
export const createClient = async (actorId, input) => {
  const n = normalizeClientInput(input, true);
  if (n.error) return n;
  const o = n.out;
  if (o.redirect_uris.some((u) => !validateRedirectUri(u, o.kind))) return { error: 'bad_redirect_uris' };
  const id = `skyc_${rand(12)}`;
  const secret = o.kind === 'confidential' ? `sks_${rand(32)}` : null;
  const scopes = o.scopes ?? ['openid'];
  await query(
    `INSERT INTO oidc_clients (id, name, description, homepage_url, kind, secret_hash, redirect_uris, scopes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
    [id, o.name, o.description ?? '', o.homepage_url ?? '', o.kind, secret ? macOf('oidc-client', secret) : null, JSON.stringify(o.redirect_uris), JSON.stringify(scopes), actorId]);
  await logOidc('client_created', id, null, { by: actorId, kind: o.kind });
  const { rows } = await query('SELECT * FROM oidc_clients WHERE id = $1', [id]);
  return { ok: true, client: clientView(rows[0]), clientSecret: secret };
};

export const updateClient = async (actorId, id, input) => {
  const { rows: cur } = await query(`SELECT * FROM oidc_clients WHERE id = $1 AND status <> 'deleted'`, [String(id)]);
  if (!cur[0]) return { error: 'not_found' };
  const n = normalizeClientInput({ ...input, kind: undefined }, false);
  if (n.error) return n;
  const o = n.out;
  if (o.redirect_uris && o.redirect_uris.some((u) => !validateRedirectUri(u, cur[0].kind))) return { error: 'bad_redirect_uris' };
  const sets = []; const vals = [id]; let i = 2;
  for (const [k, v] of Object.entries(o)) { sets.push(`${k} = $${i}${k === 'redirect_uris' || k === 'scopes' ? '::jsonb' : ''}`); vals.push(k === 'redirect_uris' || k === 'scopes' ? JSON.stringify(v) : v); i += 1; }
  if (!sets.length) return { error: 'nothing_to_update' };
  await query(`UPDATE oidc_clients SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
  await logOidc('client_updated', id, null, { by: actorId, fields: Object.keys(o) });
  const { rows } = await query('SELECT * FROM oidc_clients WHERE id = $1', [id]);
  return { ok: true, client: clientView(rows[0]) };
};

export const setClientStatus = async (actorId, id, status) => {
  if (!['active', 'suspended', 'deleted'].includes(status)) return { error: 'bad_status' };
  const { rowCount } = await query(`UPDATE oidc_clients SET status = $2, updated_at = now() WHERE id = $1 AND status <> 'deleted'`, [String(id), status]);
  if (!rowCount) return { error: 'not_found' };
  if (status !== 'active') await query('UPDATE oidc_tokens SET revoked_at = now() WHERE client_id = $1 AND revoked_at IS NULL', [id]);   // приостановка/удаление гасит выданные токены
  await logOidc(`client_${status}`, id, null, { by: actorId });
  return { ok: true };
};

export const rotateClientSecret = async (actorId, id) => {
  const { rows } = await query(`SELECT kind FROM oidc_clients WHERE id = $1 AND status <> 'deleted'`, [String(id)]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].kind !== 'confidential') return { error: 'public_client_has_no_secret' };
  const secret = `sks_${rand(32)}`;
  await query('UPDATE oidc_clients SET secret_hash = $2, secret_rotated_at = now(), updated_at = now() WHERE id = $1', [id, macOf('oidc-client', secret)]);
  await logOidc('client_secret_rotated', id, null, { by: actorId });
  return { ok: true, clientSecret: secret };
};

const getActiveClient = async (id) => {
  const { rows } = await query(`SELECT * FROM oidc_clients WHERE id = $1 AND status = 'active'`, [String(id ?? '')]);
  return rows[0] ?? null;
};

/* ─── Шаг 1: запрос авторизации (страница Sky, человек вошёл) ──────── */

const redirectWith = (uri, params) => {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
};

/**
 * Принять параметры из адреса страницы /oauth/authorize. До проверки адреса возврата НЕ перенаправляем (иначе открытый редирект):
 * такие ошибки показываются на странице Sky. После проверки ошибки (неверный scope, нет PKCE) возвращаются клиенту через redirectTo.
 */
export const beginAuthorization = async (profileId, p, meta = {}) => {
  const client = await getActiveClient(p.client_id);
  if (!client) return { error: 'invalid_client', message: L('Сервис не найден или отключён.', 'The service was not found or is disabled.') };
  const redirectUri = String(p.redirect_uri ?? '');
  if (!client.redirect_uris.includes(redirectUri)) return { error: 'invalid_redirect_uri', message: L('Адрес возврата не зарегистрирован для этого сервиса.', 'The return address is not registered for this service.') };
  const state = String(p.state ?? '').slice(0, 512);
  const fail = (error, description) => ({ error, message: description, redirectTo: redirectWith(redirectUri, { error, error_description: description, state, iss: ISSUER() }) });
  if (p.response_type !== 'code') return fail('unsupported_response_type', 'only response_type=code is supported');
  const scopes = parseScope(p.scope);
  if (!scopes.includes('openid')) return fail('invalid_scope', 'scope must include openid');
  if (scopes.some((s) => !KNOWN_SCOPES.includes(s) || !client.scopes.includes(s))) return fail('invalid_scope', 'scope is not allowed for this client');
  const challenge = String(p.code_challenge ?? '');
  if (p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return fail('invalid_request', 'PKCE S256 code_challenge is required');
  const nonce = String(p.nonce ?? '').slice(0, 256);

  const { rows: pend } = await query(`SELECT count(*)::int AS n FROM oidc_requests WHERE profile_id = $1 AND status = 'pending' AND expires_at > now()`, [profileId]);
  if (pend[0].n >= MAX_PENDING_PER_PROFILE) return { error: 'too_many_requests', message: L('Слишком много незавершённых запросов входа.', 'Too many pending sign-in requests.') };

  const id = `oar_${rand(18)}`;
  await query(
    `INSERT INTO oidc_requests (id, client_id, profile_id, redirect_uri, scope, state, nonce, code_challenge, expires_at, ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(mins => $9), $10)`,
    [id, client.id, profileId, redirectUri, scopes.join(' '), state, nonce, challenge, REQUEST_TTL_MIN, meta.ipHash ?? null]);
  await logOidc('authorize_started', client.id, profileId, { scopes });
  const cat = scopeCatalog();
  const { rows: prof } = await query('SELECT name, username FROM profiles WHERE id = $1', [profileId]);
  const { rows: prev } = await query('SELECT scope FROM oidc_consents WHERE profile_id = $1 AND client_id = $2 AND revoked_at IS NULL', [profileId, client.id]);
  return {
    ok: true, requestId: id, expiresInSec: REQUEST_TTL_MIN * 60,
    client: { id: client.id, name: client.name, description: client.description, homepage: client.homepage_url, returnTo: new URL(redirectUri).origin === 'null' ? new URL(redirectUri).protocol : new URL(redirectUri).origin },
    scopes: scopes.map((s) => ({ id: s, label: cat[s].label, required: cat[s].required, sensitive: cat[s].sensitive })),
    previouslyGranted: prev[0] ? parseScope(prev[0].scope) : [],
    profile: { name: prof[0]?.name ?? '', username: prof[0]?.username ?? '' },
  };
};

/* ─── Шаг 2: решение человека (подтверждение на сервере) ───────────── */

const subFor = (clientId, profileId) => `sky_${macOf('oidc-sub', `${clientId}|${profileId}`).slice(0, 32)}`;

export const decideAuthorization = async (profileId, requestId, approve, grantedScopes) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM oidc_requests WHERE id = $1 AND profile_id = $2 FOR UPDATE', [String(requestId ?? ''), profileId]);
    const r = rows[0];
    if (!r) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (r.status !== 'pending') { await client.query('ROLLBACK'); return { error: 'already_decided' }; }
    if (r.expires_at < new Date()) {
      await client.query(`UPDATE oidc_requests SET status = 'expired' WHERE id = $1`, [r.id]); await client.query('COMMIT');
      return { error: 'expired', message: L('Время на подтверждение вышло.', 'The confirmation time ran out.') };
    }
    const iss = ISSUER();
    const cl = (await client.query(`SELECT status FROM oidc_clients WHERE id = $1`, [r.client_id])).rows[0];
    if (!approve || cl?.status !== 'active') {
      await client.query(`UPDATE oidc_requests SET status = 'denied', decided_at = now() WHERE id = $1`, [r.id]);
      await client.query('COMMIT');
      await logOidc('authorize_denied', r.client_id, profileId, {});
      return { ok: true, approved: false, redirectTo: redirectWith(r.redirect_uri, { error: 'access_denied', state: r.state, iss }) };
    }
    const requested = parseScope(r.scope);
    const granted = parseScope(Array.isArray(grantedScopes) ? grantedScopes.join(' ') : grantedScopes);
    if (!granted.includes('openid') || granted.some((s) => !requested.includes(s))) { await client.query('ROLLBACK'); return { error: 'bad_scopes' }; }
    const sub = subFor(r.client_id, profileId);
    await client.query(
      `INSERT INTO oidc_consents (profile_id, client_id, sub, scope) VALUES ($1,$2,$3,$4)
       ON CONFLICT (profile_id, client_id) DO UPDATE SET scope = EXCLUDED.scope, revoked_at = NULL, granted_at = now()`,
      [profileId, r.client_id, sub, granted.join(' ')]);
    const code = rand(32);
    await client.query(`UPDATE oidc_requests SET status = 'approved', decided_at = now() WHERE id = $1`, [r.id]);
    await client.query(
      `INSERT INTO oidc_codes (code_hash, request_id, client_id, profile_id, redirect_uri, scope, nonce, code_challenge, auth_time, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), now() + make_interval(secs => $9))`,
      [sha256hex(code), r.id, r.client_id, profileId, r.redirect_uri, granted.join(' '), r.nonce, r.code_challenge, CODE_TTL_SEC]);
    await client.query('COMMIT');
    await logOidc('authorize_approved', r.client_id, profileId, { scopes: granted });
    return { ok: true, approved: true, redirectTo: redirectWith(r.redirect_uri, { code, state: r.state, iss }) };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};

/* ─── Шаг 3: обмен кода на токены (сервер сервиса) ─────────────────── */

const oauthError = (error, description, status = 400) => ({ status, body: { error, ...(description ? { error_description: description } : {}) } });

const claimsFor = async (profileId, scopes) => {
  const { rows } = await query(
    `SELECT p.name, p.username, s.email, s.email_verified, s.phone, s.phone_verified FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE p.id = $1`, [profileId]);
  const r = rows[0]; const out = {};
  if (!r) return out;
  if (scopes.includes('profile')) { out.name = r.name; if (r.username) out.preferred_username = r.username; }
  if (scopes.includes('email') && r.email && r.email_verified) { out.email = r.email; out.email_verified = true; }
  if (scopes.includes('phone') && r.phone && r.phone_verified) { out.phone_number = r.phone; out.phone_number_verified = true; }
  return out;
};

/** Проверка клиента на токен-эндпоинте. Возвращает {client} либо {err}. Публичные клиенты секрета не предъявляют — их защищает PKCE. */
export const authenticateClient = async (clientId, secret) => {
  const client = await getActiveClient(clientId);
  if (!client) return { err: oauthError('invalid_client', 'unknown or disabled client', 401) };
  if (client.kind === 'confidential') {
    if (!secret || !client.secret_hash || !safeEq(macOf('oidc-client', secret), client.secret_hash)) return { err: oauthError('invalid_client', 'client authentication failed', 401), client };
  }
  return { client };
};

export const exchangeCode = async (client, p) => {
  if (p.grant_type !== 'authorization_code') return oauthError('unsupported_grant_type', 'only authorization_code is supported');
  const code = String(p.code ?? '');
  const verifier = String(p.code_verifier ?? '');
  if (!code || code.length > 128 || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthError('invalid_request', 'code and a valid code_verifier are required');
  const codeHash = sha256hex(code);

  const conn = await pool.connect();
  let row;
  try {
    await conn.query('BEGIN');
    const { rows } = await conn.query('SELECT * FROM oidc_codes WHERE code_hash = $1 FOR UPDATE', [codeHash]);
    row = rows[0];
    if (!row) { await conn.query('ROLLBACK'); return oauthError('invalid_grant', 'invalid code'); }
    if (row.used_at) {
      // Повторное предъявление уже обменянного кода — признак кражи: все токены, выданные по нему, отзываются.
      await conn.query('UPDATE oidc_tokens SET revoked_at = now() WHERE code_hash = $1 AND revoked_at IS NULL', [codeHash]);
      await conn.query('COMMIT');
      await logOidc('code_reuse', row.client_id, row.profile_id, {});
      return oauthError('invalid_grant', 'code already used');
    }
    if (row.expires_at < new Date() || row.client_id !== client.id || row.redirect_uri !== String(p.redirect_uri ?? '')
        || !safeEq(sha256b64u(verifier), row.code_challenge)) {
      await conn.query('ROLLBACK');
      await logOidc('exchange_rejected', client.id, row.profile_id, {});
      return oauthError('invalid_grant', 'code is expired or does not match this client, redirect_uri or code_verifier');
    }
    const { rows: cons } = await conn.query('SELECT sub, scope, revoked_at FROM oidc_consents WHERE profile_id = $1 AND client_id = $2', [row.profile_id, client.id]);
    if (!cons[0] || cons[0].revoked_at) { await conn.query('ROLLBACK'); return oauthError('invalid_grant', 'consent was revoked'); }
    await conn.query('UPDATE oidc_codes SET used_at = now() WHERE code_hash = $1', [codeHash]);
    const access = `sat_${rand(32)}`;
    await conn.query(
      `INSERT INTO oidc_tokens (id, token_hash, client_id, profile_id, scope, code_hash, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(secs => $7))`,
      [`otk_${generateId()}`, sha256hex(access), client.id, row.profile_id, row.scope, codeHash, ACCESS_TTL_SEC]);
    await conn.query('UPDATE oidc_consents SET last_used_at = now() WHERE profile_id = $1 AND client_id = $2', [row.profile_id, client.id]);
    await conn.query('COMMIT');

    const scopes = parseScope(row.scope);
    const now = Math.floor(Date.now() / 1000);
    const idToken = await signJwt({
      iss: ISSUER(), sub: cons[0].sub, aud: client.id, azp: client.id, iat: now, exp: now + IDTOKEN_TTL_SEC, auth_time: Math.floor(row.auth_time.getTime() / 1000),
      ...(row.nonce ? { nonce: row.nonce } : {}), ...(await claimsFor(row.profile_id, scopes)),
    });
    await logOidc('token_issued', client.id, row.profile_id, { scopes });
    return { status: 200, body: { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_SEC, id_token: idToken, scope: row.scope }, noStore: true };
  } catch (e) { await conn.query('ROLLBACK').catch(() => {}); throw e; } finally { conn.release(); }
};

/* ─── userinfo / отзыв токена ──────────────────────────────────────── */

export const userinfo = async (bearer) => {
  const token = String(bearer ?? '');
  if (!/^sat_[A-Za-z0-9_-]{20,64}$/.test(token)) return oauthError('invalid_token', null, 401);
  const { rows } = await query(
    `SELECT t.*, c.status AS client_status, k.sub, k.revoked_at AS consent_revoked FROM oidc_tokens t
       JOIN oidc_clients c ON c.id = t.client_id
       JOIN oidc_consents k ON k.profile_id = t.profile_id AND k.client_id = t.client_id
      WHERE t.token_hash = $1`, [sha256hex(token)]);
  const t = rows[0];
  if (!t || t.revoked_at || t.expires_at < new Date() || t.client_status !== 'active' || t.consent_revoked) return oauthError('invalid_token', null, 401);
  return { status: 200, body: { sub: t.sub, ...(await claimsFor(t.profile_id, parseScope(t.scope))) }, noStore: true };
};

export const revokeToken = async (client, token) => {
  const { rowCount } = await query('UPDATE oidc_tokens SET revoked_at = now() WHERE token_hash = $1 AND client_id = $2 AND revoked_at IS NULL', [sha256hex(String(token ?? '')), client.id]);
  if (rowCount) await logOidc('token_revoked', client.id, null, {});
  return { status: 200, body: {} };   // по RFC 7009 ответ одинаков, существовал токен или нет
};

/* ─── Согласия человека ────────────────────────────────────────────── */

export const listConsents = async (profileId) => {
  const { rows } = await query(
    `SELECT k.client_id, k.scope, k.granted_at, k.last_used_at, c.name, c.homepage_url FROM oidc_consents k JOIN oidc_clients c ON c.id = k.client_id
      WHERE k.profile_id = $1 AND k.revoked_at IS NULL AND c.status = 'active' ORDER BY k.granted_at DESC`, [profileId]);
  return rows.map((r) => ({ clientId: r.client_id, name: r.name, homepage: r.homepage_url, scopes: parseScope(r.scope), grantedAt: r.granted_at.toISOString(), lastUsedAt: r.last_used_at?.toISOString() ?? null }));
};

export const revokeConsent = async (profileId, clientId) => {
  const { rowCount } = await query('UPDATE oidc_consents SET revoked_at = now() WHERE profile_id = $1 AND client_id = $2 AND revoked_at IS NULL', [profileId, String(clientId)]);
  if (!rowCount) return { error: 'not_found' };
  await query('UPDATE oidc_tokens SET revoked_at = now() WHERE profile_id = $1 AND client_id = $2 AND revoked_at IS NULL', [profileId, String(clientId)]);
  await logOidc('consent_revoked', String(clientId), profileId, {});
  return { ok: true };
};

export const recentEvents = async (limit = 100) =>
  (await query('SELECT id, at, kind, client_id, profile_id, detail FROM oidc_events ORDER BY at DESC LIMIT $1', [Math.min(Math.max(limit, 1), 500)])).rows
    .map((r) => ({ id: Number(r.id), at: r.at.toISOString(), kind: r.kind, clientId: r.client_id, profileId: r.profile_id, detail: r.detail }));

/** Уборка: просроченные запросы, использованные/просроченные коды, старые токены. */
export const sweepOidc = async () => {
  await query(`UPDATE oidc_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < now()`);
  await query(`DELETE FROM oidc_codes WHERE expires_at < now() - interval '1 day'`);
  await query(`DELETE FROM oidc_tokens WHERE expires_at < now() - interval '7 days'`);
  await query(`DELETE FROM oidc_requests WHERE created_at < now() - interval '7 days'`);
  await query(`DELETE FROM oidc_events WHERE at < now() - interval '180 days'`);
};
