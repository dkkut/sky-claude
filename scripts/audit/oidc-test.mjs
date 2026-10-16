// Sky ID для сторонних сервисов (OpenID Connect + PKCE): весь путь клиента, безопасность, согласия, попарные идентификаторы, отзыв.
//   API с DOMAIN=sky.test OIDC_RATE_MULT=1000 ADMIN_GATE=off. (. env.sh; node scripts/audit/oidc-test.mjs <каталог с api.log>)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/["$]/g, '\\$&')}"`).toString().trim();
let ok = 0, bad = 0;
const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (o) => JSON.stringify(o ?? {});
const codeOf = (email) => [...readFileSync(S + '/api.log', 'utf8').matchAll(new RegExp(email.replace('.', '\\.') + ' \\| [^|]*\\| [^\\d\\n]*(\\d{6})', 'g'))].pop()?.[1];
const b64u = (b) => Buffer.from(b).toString('base64url');
const pkce = () => { const verifier = b64u(crypto.randomBytes(48)); return { verifier, challenge: b64u(crypto.createHash('sha256').update(verifier).digest()) }; };
const post = (p, b, u) => call(p, { method: 'POST', body: j(b) }, u?.tok);
const form = (p, fields, headers = {}) => fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields) }).then(async (r) => ({ status: r.status, headers: r.headers, data: await r.json().catch(() => null) }));
const jwt = (tok) => { const [h, p, s] = tok.split('.'); return { head: JSON.parse(Buffer.from(h, 'base64url')), claims: JSON.parse(Buffer.from(p, 'base64url')), signed: `${h}.${p}`, sig: Buffer.from(s, 'base64url') }; };
const verifyJwt = (tok, jwks) => { const x = jwt(tok); const k = jwks.keys.find((y) => y.kid === x.head.kid); if (!k) return false; return crypto.verify('sha256', Buffer.from(x.signed), { key: crypto.createPublicKey({ key: k, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, x.sig); };

const U1 = await mkuser(S, 'oidca'); const U2 = await mkuser(S, 'oidcb'); const ADM = await mkuser(S, 'oidcadm');
q(`update profiles set is_admin=true, admin_role='super_admin' where id='${ADM.pid}'`);
q(`update sky_ids set email_verified = true where email in ('${U1.email}','${U2.email}')`);
const stepAdm = async () => { await post('/api/admin/oidc/step-up', {}, ADM); await sleep(1200); return codeOf(ADM.email); };
const RURI = 'https://rp.example.com/cb';

/* ═══ Открытые данные ═══ */
const disc = await fetch(B + '/api/oidc/.well-known/openid-configuration');
const dj = await disc.json();
t('discovery: открыт без входа и ключа беты, CORS «*»', disc.status === 200 && disc.headers.get('access-control-allow-origin') === '*' && dj.issuer.endsWith('/api/oidc'), j(dj).slice(0, 120));
t('discovery: только code + PKCE S256, подписи ES256, попарные идентификаторы', j(dj.response_types_supported) === '["code"]' && dj.code_challenge_methods_supported[0] === 'S256' && dj.id_token_signing_alg_values_supported[0] === 'ES256' && dj.subject_types_supported[0] === 'pairwise');
const jwks0 = await (await fetch(B + '/api/oidc/jwks')).json();
t('JWKS: публичный ключ ES256 без закрытых частей', jwks0.keys.length >= 1 && jwks0.keys[0].alg === 'ES256' && !('d' in jwks0.keys[0]));

/* ═══ Регистрация клиентов (админка) ═══ */
t('админка: обычному человеку закрыта', (await call('/api/admin/oidc/clients', {}, U1.tok)).status === 403);
t('админка: без подтверждения личности клиента создать нельзя', (await post('/api/admin/oidc/clients', { name: 'X', kind: 'confidential', redirectUris: [RURI] }, ADM)).status === 401);
const mkClient = async (body) => post('/api/admin/oidc/clients', { ...body, stepUpCode: await stepAdm() }, ADM);
let r = await mkClient({ name: 'Тестовый сайт', kind: 'confidential', redirectUris: [RURI], scopes: ['openid', 'profile', 'email'], homepageUrl: 'https://rp.example.com' });
const C1 = r.data.client; const C1secret = r.data.clientSecret;
t('админка: клиент создан, секрет показан один раз', r.status === 201 && C1.id.startsWith('skyc_') && C1secret.startsWith('sks_'), j(r.data).slice(0, 150));
t('админка: в списке нет ни секрета, ни его хеша', !JSON.stringify((await call('/api/admin/oidc/clients', {}, ADM.tok)).data).includes(C1secret) && !/secret_hash|secretHash/.test(JSON.stringify((await call('/api/admin/oidc/clients', {}, ADM.tok)).data)));
t('БД: секрет клиента хранится только хешем', q(`select secret_hash from oidc_clients where id='${C1.id}'`).length === 64 && !q(`select secret_hash from oidc_clients where id='${C1.id}'`).includes(C1secret));
for (const [name, uri, kind] of [['http не на loopback', 'http://evil.example.com/cb', 'confidential'], ['javascript:', 'javascript:alert(1)', 'public'], ['с фрагментом', 'https://x.example.com/cb#a', 'confidential'], ['кастомная схема у confidential', 'myapp://cb', 'confidential'], ['пробел', 'https://x.example.com/c b', 'confidential']]) {
  const bad1 = await mkClient({ name: 'Плохой', kind, redirectUris: [uri] });
  t(`регистрация: адрес возврата «${name}» отклоняется`, bad1.status === 400 && bad1.data.error === 'bad_redirect_uris', j(bad1.data));
}
r = await mkClient({ name: 'Приложение', kind: 'public', redirectUris: ['myapp://cb', 'http://127.0.0.1:8123/cb'], scopes: ['openid'] });
const C2 = r.data.client;
t('регистрация: публичный клиент (приложение) — секрета нет, loopback и своя схема допустимы', r.status === 201 && r.data.clientSecret === null && C2.kind === 'public', j(r.data).slice(0, 120));

/* ═══ Запрос авторизации ═══ */
const P = pkce();
const init = (u, over = {}) => post('/api/oidc/authorize/init', { response_type: 'code', client_id: C1.id, redirect_uri: RURI, scope: 'openid', state: 'st-abc', nonce: 'n-1', code_challenge: P.challenge, code_challenge_method: 'S256', ...over }, u);
t('init: без входа в Sky — 401', (await call('/api/oidc/authorize/init', { method: 'POST', body: '{}' })).status === 401);
r = await init(U1, { client_id: 'skyc_nope' });
t('init: неизвестный клиент — ошибка на странице Sky, без перенаправления', r.status === 400 && r.data.error === 'invalid_client' && !r.data.redirectTo);
r = await init(U1, { redirect_uri: 'https://evil.example.com/cb' });
t('init: незарегистрированный адрес возврата — без перенаправления (нет открытого редиректа)', r.status === 400 && r.data.error === 'invalid_redirect_uri' && !r.data.redirectTo);
r = await init(U1, { redirect_uri: RURI + '/' });
t('init: адрес должен совпадать ТОЧНО (даже слеш в конце)', r.data.error === 'invalid_redirect_uri');
r = await init(U1, { code_challenge: undefined });
t('init: без PKCE — возврат клиенту с ошибкой и state', r.data.error === 'invalid_request' && /error=invalid_request/.test(r.data.redirectTo) && /state=st-abc/.test(r.data.redirectTo));
r = await init(U1, { code_challenge_method: 'plain' });
t('init: PKCE plain не принимается', r.data.error === 'invalid_request');
r = await init(U1, { scope: 'openid phone' });
t('init: scope, не разрешённый клиенту, — invalid_scope', r.data.error === 'invalid_scope');
r = await init(U1, { scope: 'profile' });
t('init: без openid — invalid_scope', r.data.error === 'invalid_scope');
r = await init(U1, { response_type: 'token' });
t('init: неявный поток (token) не поддерживается', r.data.error === 'unsupported_response_type');
r = await init(U1, { scope: 'openid profile email' });
t('init: корректный запрос — сведения для страницы подтверждения', r.status === 200 && r.data.requestId && r.data.client.name === 'Тестовый сайт' && r.data.scopes.length === 3 && r.data.scopes.find((x) => x.id === 'openid').required && r.data.scopes.find((x) => x.id === 'email').sensitive, j(r.data).slice(0, 200));
const reqFull = r.data;

/* ═══ Решение человека ═══ */
t('decide: чужой человек не может решить чужой запрос', (await post('/api/oidc/authorize/decide', { requestId: reqFull.requestId, approve: true, scopes: ['openid'] }, U2)).status === 404);
t('decide: нельзя выдать scope, которого не запрашивали', (await post('/api/oidc/authorize/decide', { requestId: reqFull.requestId, approve: true, scopes: ['openid', 'phone'] }, U1)).data.error === 'bad_scopes');
t('decide: без openid нельзя', (await post('/api/oidc/authorize/decide', { requestId: reqFull.requestId, approve: true, scopes: ['email'] }, U1)).data.error === 'bad_scopes');
// человек оставляет только openid и profile — почту НЕ отдаёт
let dec = await post('/api/oidc/authorize/decide', { requestId: reqFull.requestId, approve: true, scopes: ['openid', 'profile'] }, U1);
const url1 = new URL(dec.data.redirectTo);
t('decide: возврат на зарегистрированный адрес с code, state и iss', dec.status === 200 && dec.data.approved && url1.origin + url1.pathname === RURI && url1.searchParams.get('code') && url1.searchParams.get('state') === 'st-abc' && url1.searchParams.get('iss').endsWith('/api/oidc'));
t('decide: повторное решение — 409', (await post('/api/oidc/authorize/decide', { requestId: reqFull.requestId, approve: false }, U1)).status === 409);
const code1 = url1.searchParams.get('code');
t('БД: код авторизации — только хеш', q(`select count(*) from oidc_codes where code_hash='${code1}'`) === '0' && q(`select length(code_hash) from oidc_codes order by expires_at desc limit 1`) === '64');
r = await init(U1);
dec = await post('/api/oidc/authorize/decide', { requestId: r.data.requestId, approve: false }, U1);
t('decide: отказ человека — access_denied клиенту, кода нет', dec.data.approved === false && /error=access_denied/.test(dec.data.redirectTo) && !/code=/.test(dec.data.redirectTo));
r = await init(U1); q(`update oidc_requests set expires_at = now() - interval '1 minute' where id='${r.data.requestId}'`);
t('decide: просроченный запрос — 410, код не выдаётся', (await post('/api/oidc/authorize/decide', { requestId: r.data.requestId, approve: true, scopes: ['openid'] }, U1)).status === 410);

/* ═══ Обмен кода на токены ═══ */
const basic = (id, s) => ({ authorization: 'Basic ' + Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(s)}`).toString('base64') });
const tokenReq = (code, over = {}, hdr) => form('/api/oidc/token', { grant_type: 'authorization_code', code, redirect_uri: RURI, code_verifier: P.verifier, client_id: C1.id, ...over }, hdr);
r = await tokenReq(code1, {}, undefined);
t('token: без секрета confidential-клиент отклоняется (401 invalid_client)', r.status === 401 && r.data.error === 'invalid_client');
r = await tokenReq(code1, {}, basic(C1.id, 'sks_wrong'));
t('token: неверный секрет отклоняется', r.status === 401 && r.data.error === 'invalid_client');
r = await tokenReq(code1, { code_verifier: b64u(crypto.randomBytes(48)) }, basic(C1.id, C1secret));
t('token: неверный code_verifier (PKCE) отклоняется', r.status === 400 && r.data.error === 'invalid_grant');
r = await tokenReq(code1, { redirect_uri: 'https://rp.example.com/other' }, basic(C1.id, C1secret));
t('token: другой redirect_uri отклоняется', r.data.error === 'invalid_grant');
// после неудачных попыток код всё ещё жив (отказ не сжигает его у настоящего владельца) — но после успеха сгорит
const ok1 = await tokenReq(code1, {}, basic(C1.id, C1secret));
t('token: верный обмен (Basic) — токены, no-store', ok1.status === 200 && ok1.data.token_type === 'Bearer' && ok1.data.access_token.startsWith('sat_') && ok1.data.id_token && /no-store/.test(ok1.headers.get('cache-control')), j(ok1.data).slice(0, 150));
const jwks1 = await (await fetch(B + '/api/oidc/jwks')).json();
const idt = jwt(ok1.data.id_token);
t('id_token: подпись ES256 проверяется по JWKS', verifyJwt(ok1.data.id_token, jwks1));
t('id_token: iss/aud/exp/nonce/auth_time корректны', idt.claims.iss === dj.issuer && idt.claims.aud === C1.id && idt.claims.exp > Date.now() / 1000 && idt.claims.exp - idt.claims.iat <= 600 && idt.claims.nonce === 'n-1' && idt.claims.auth_time > 0);
t('id_token: попарный sub, не равен id профиля/Sky ID; имя — потому что человек согласился на profile', idt.claims.sub.startsWith('sky_') && !idt.claims.sub.includes(U1.pid) && Boolean(idt.claims.name) && !('email' in idt.claims), j(idt.claims));
t('id_token: почта НЕ передана (человек не дал согласия на email)', !('email' in idt.claims) && !('phone_number' in idt.claims));
t('id_token: нет пароля, токенов сессии, идентификаторов профиля и Sky ID', !JSON.stringify(idt.claims).includes(U1.pid) && !/password|session|sid|skyId|sky-/.test(JSON.stringify(idt.claims)));
const sub1 = idt.claims.sub;
let ui = await fetch(B + '/api/oidc/userinfo', { headers: { authorization: `Bearer ${ok1.data.access_token}` } });
let uj = await ui.json();
t('userinfo: тот же sub и только согласованные данные', ui.status === 200 && uj.sub === sub1 && uj.name && !uj.email, j(uj));
t('userinfo: без токена и с чужим — 401', (await fetch(B + '/api/oidc/userinfo')).status === 401 && (await fetch(B + '/api/oidc/userinfo', { headers: { authorization: 'Bearer sat_xxxxxxxxxxxxxxxxxxxxxxxx' } })).status === 401);
// повтор кода
r = await tokenReq(code1, {}, basic(C1.id, C1secret));
t('token: повторное предъявление кода — отказ', r.status === 400 && r.data.error === 'invalid_grant');
ui = await fetch(B + '/api/oidc/userinfo', { headers: { authorization: `Bearer ${ok1.data.access_token}` } });
t('token: повторное предъявление кода отзывает выданные по нему токены', ui.status === 401);
t('журнал: reuse кода записан', Number(q(`select count(*) from oidc_events where kind='code_reuse' and client_id='${C1.id}'`)) >= 1);

/* ═══ Попарные идентификаторы и согласия ═══ */
const flow = async (user, client, secret, scope, grant, over = {}) => {
  const pk = pkce();
  const i = await post('/api/oidc/authorize/init', { response_type: 'code', client_id: client.id, redirect_uri: over.redirect ?? RURI, scope, state: 's', nonce: 'nn', code_challenge: pk.challenge, code_challenge_method: 'S256' }, user);
  if (!i.data.requestId) return { init: i };
  const d = await post('/api/oidc/authorize/decide', { requestId: i.data.requestId, approve: true, scopes: grant }, user);
  const code = new URL(d.data.redirectTo).searchParams.get('code');
  const tk = await form('/api/oidc/token', { grant_type: 'authorization_code', code, redirect_uri: over.redirect ?? RURI, code_verifier: pk.verifier, client_id: client.id, ...(secret ? { client_secret: secret } : {}) });
  return { init: i, tk, idt: tk.data?.id_token ? jwt(tk.data.id_token) : null };
};
let a = await flow(U1, C1, C1secret, 'openid', ['openid']);
t('sub стабилен: тот же человек в том же сервисе получает тот же идентификатор (client_secret_post)', a.idt.claims.sub === sub1 && !('name' in a.idt.claims), j(a.idt?.claims));
let b = await flow(U2, C1, C1secret, 'openid', ['openid']);
t('sub: разные люди — разные идентификаторы', b.idt.claims.sub !== sub1);
let c = await flow(U1, C2, null, 'openid', ['openid'], { redirect: 'myapp://cb' });
t('публичный клиент (приложение): вход без секрета, по PKCE', c.tk.status === 200 && c.idt.claims.aud === C2.id, j(c.tk?.data));
t('sub попарный: у того же человека в другом сервисе — другой идентификатор (сопоставить нельзя)', c.idt.claims.sub !== sub1 && c.idt.claims.sub.startsWith('sky_'));
let e = await flow(U1, C1, C1secret, 'openid email', ['openid', 'email']);
t('согласие на email: почта передаётся (подтверждённая) и только она', e.idt.claims.email === U1.email && e.idt.claims.email_verified === true && !('name' in e.idt.claims), j(e.idt?.claims));
q(`update sky_ids set email_verified = false where email='${U1.email}'`);
e = await flow(U1, C1, C1secret, 'openid email', ['openid', 'email']);
t('неподтверждённая почта не передаётся даже при согласии', !('email' in e.idt.claims));
q(`update sky_ids set email_verified = true where email='${U1.email}'`);

/* ═══ Отзыв токенов и согласий ═══ */
a = await flow(U1, C1, C1secret, 'openid', ['openid']);
const at = a.tk.data.access_token;
await form('/api/oidc/revoke', { token: at, client_id: C2.id });   // другой (публичный) клиент пытается отозвать чужой токен
t('revoke: токен другого клиента отозвать нельзя', (await fetch(B + '/api/oidc/userinfo', { headers: { authorization: `Bearer ${at}` } })).status === 200);
r = await form('/api/oidc/revoke', { token: at }, basic(C1.id, C1secret));
t('revoke: клиент отзывает свой токен — userinfo закрыт', r.status === 200 && (await fetch(B + '/api/oidc/userinfo', { headers: { authorization: `Bearer ${at}` } })).status === 401);
a = await flow(U1, C1, C1secret, 'openid', ['openid']);
const cons = await call('/api/oidc/consents', {}, U1.tok);
t('согласия: человек видит подключённые сервисы', cons.data.consents.some((x) => x.clientId === C1.id && x.name === 'Тестовый сайт'), j(cons.data));
r = await call(`/api/oidc/consents/${C1.id}`, { method: 'DELETE' }, U1.tok);
t('согласия: отзыв — токены сервиса перестают работать', r.status === 200 && (await fetch(B + '/api/oidc/userinfo', { headers: { authorization: `Bearer ${a.tk.data.access_token}` } })).status === 401);
a = await flow(U1, C1, C1secret, 'openid', ['openid']);
t('согласия: после отзыва новый вход возможен только с новым подтверждением, sub прежний', a.idt.claims.sub === sub1);

/* ═══ Секреты, ключи, приостановка ═══ */
r = await post(`/api/admin/oidc/clients/${C1.id}/rotate-secret`, { stepUpCode: await stepAdm() }, ADM);
const newSecret = r.data.clientSecret;
t('смена секрета: старый перестаёт работать, новый — работает', r.status === 200 && newSecret !== C1secret && (await form('/api/oidc/token', { grant_type: 'authorization_code', code: 'x'.repeat(40), redirect_uri: RURI, code_verifier: P.verifier, client_id: C1.id, client_secret: C1secret })).status === 401 && (await form('/api/oidc/token', { grant_type: 'authorization_code', code: 'x'.repeat(40), redirect_uri: RURI, code_verifier: P.verifier, client_id: C1.id, client_secret: newSecret })).status === 400);
t('смена секрета: для публичного клиента невозможна', (await post(`/api/admin/oidc/clients/${C2.id}/rotate-secret`, { stepUpCode: await stepAdm() }, ADM)).status === 400);
const kidBefore = jwt(a.tk.data.id_token).head.kid;
r = await post('/api/admin/oidc/keys/rotate', { stepUpCode: await stepAdm() }, ADM);
const jwks2 = await (await fetch(B + '/api/oidc/jwks')).json();
const a2 = await flow(U1, C1, newSecret, 'openid', ['openid']);
t('ключ подписи: после ротации новые токены подписаны новым ключом, а старые по-прежнему проверяются', r.status === 200 && jwt(a2.tk.data.id_token).head.kid !== kidBefore && verifyJwt(a2.tk.data.id_token, jwks2) && verifyJwt(a.tk.data.id_token, jwks2));
t('БД: закрытый ключ подписи хранится зашифрованным', q(`select private_sealed from oidc_keys limit 1`).startsWith('v1.') && !q(`select private_sealed from oidc_keys limit 1`).includes('BEGIN'));
const live = await flow(U2, C1, newSecret, 'openid', ['openid']);
r = await post(`/api/admin/oidc/clients/${C1.id}/status`, { status: 'suspended', stepUpCode: await stepAdm() }, ADM);
t('приостановка клиента: выданные токены перестают работать, новые входы закрыты', r.status === 200 && (await fetch(B + '/api/oidc/userinfo', { headers: { authorization: `Bearer ${live.tk.data.access_token}` } })).status === 401 && (await init(U1)).data.error === 'invalid_client');
/* ═══ Чистота журнала ═══ */
const dump = q(`select string_agg(detail::text, ' ') from oidc_events`) + q(`select string_agg(coalesce(client_id,'')||coalesce(profile_id,''), ' ') from oidc_events`);
t('журнал событий: нет кодов, токенов, секретов, почт', !dump.includes(code1) && !dump.includes('sat_') && !dump.includes(C1secret) && !dump.includes(U1.email));
const alltext = ['oidc_requests', 'oidc_codes', 'oidc_tokens', 'oidc_consents'].map((tb) => q(`select string_agg(t::text, ' ') from ${tb} t`)).join(' ');
t('БД: ни код, ни токен, ни секрет не лежат открытым текстом', !alltext.includes(code1) && !alltext.includes(ok1.data.access_token) && !alltext.includes(C1secret) && !alltext.includes(newSecret));
console.log(`\nИтого: ${ok} ok, ${bad} fail`);
process.exit(bad ? 1 : 0);
