// Ключи доступа (server/passkeys.mjs): создание с кодом аутентификатора, вход «ключ + код», заморозка, удаление, подмены.
// API: PASSKEY_RP_ID=sky.test PASSKEY_ORIGINS=https://sky.test  (node scripts/audit/passkeys-test.mjs <каталог с api.log>)
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { call, mkuser } from './lib.mjs';
const S = process.argv[2];
const q = (s) => execSync(`psql postgres://sky:sky@127.0.0.1/sky -tA -c "${s.replace(/"/g, '\\"')}"`).toString().trim();
const { generateSecret, currentTotp } = await import('../../server/totp.mjs');
const { encryptSecret } = await import('../../server/crypto.mjs');
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, x); } };
const post = (p, b, tok) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}), headers: { 'x-real-ip': '203.0.113.' + (1 + Math.floor(Math.random() * 200)) } }, tok);
const RP = 'sky.test', ORIGIN = 'https://sky.test';
const b64u = (b) => Buffer.from(b).toString('base64url');

// мини-CBOR для создания «аттестации»
const enc = (v) => {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [enc(k), enc(x)])]);
  throw new Error('enc');
};
function head(m, n) { if (n < 24) return Buffer.from([(m << 5) | n]); if (n < 256) return Buffer.from([(m << 5) | 24, n]); const b = Buffer.alloc(3); b[0] = (m << 5) | 25; b.writeUInt16BE(n, 1); return b; }

const makeKey = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, credId: crypto.randomBytes(32), x: Buffer.from(jwk.x, 'base64url'), y: Buffer.from(jwk.y, 'base64url'), counter: 0 };
};
const rpHash = (rp = RP) => crypto.createHash('sha256').update(rp).digest();
const clientData = (type, challenge, origin = ORIGIN) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
const attestation = (k, { flags = 0x45, rp = RP } = {}) => {
  const cose = enc(new Map([[1, 2], [3, -7], [-1, 1], [-2, k.x], [-3, k.y]]));
  const idLen = Buffer.alloc(2); idLen.writeUInt16BE(k.credId.length);
  const cnt = Buffer.alloc(4);
  const ad = Buffer.concat([rpHash(rp), Buffer.from([flags | 0x40]), cnt, Buffer.alloc(16), idLen, k.credId, cose]);
  return enc(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]));
};
const register = async (tok, k, code, over = {}) => {
  const b = await post('/api/skyid/passkeys/register/begin', { twoFactorCode: code }, tok);
  if (b.status !== 200) return { b };
  const cd = clientData(over.type ?? 'webauthn.create', over.challenge ?? b.data.publicKey.challenge, over.origin);
  const f = await post('/api/skyid/passkeys/register/finish', { challengeId: b.data.challengeId, name: over.name ?? 'Мой iPhone', icon: over.icon ?? 'phone',
    credential: { id: b64u(k.credId), response: { clientDataJSON: b64u(cd), attestationObject: b64u(attestation(k, over)), transports: ['internal'] } } }, tok);
  return { b, f };
};
const assertion = async (k, over = {}) => {
  const b = await post('/api/auth/passkey/begin', {});
  const cd = clientData('webauthn.get', over.challenge ?? b.data.publicKey.challenge, over.origin);
  if (over.bump !== false) k.counter += 1;
  const cnt = Buffer.alloc(4); cnt.writeUInt32BE(over.counter ?? k.counter);
  const ad = Buffer.concat([rpHash(), Buffer.from([over.flags ?? 0x05]), cnt]);
  const sig = crypto.sign('sha256', Buffer.concat([ad, crypto.createHash('sha256').update(cd).digest()]), k.privateKey);
  const f = await post('/api/auth/passkey/finish', { challengeId: over.challengeId ?? b.data.challengeId,
    credential: { id: b64u(k.credId), response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(over.badSig ? Buffer.alloc(70, 1) : sig) } } });
  return { b, f };
};

const u = await mkuser(S, 'pka'), other = await mkuser(S, 'pkb');
const sky = q(`select sky_id from profiles where id='${u.pid}'`);
const secret = generateSecret();
const k1 = makeKey();

let r = await register(u.tok, k1, '000000');
t('без аутентификатора ключ создать нельзя', r.b.status === 409 && r.b.data.error === 'two_factor_required_setup', JSON.stringify(r.b.data));
q(`update sky_ids set two_factor_enabled=true, two_factor_method='app', two_factor_secret='${encryptSecret(secret)}' where id='${sky}'`);
r = await register(u.tok, k1, '000000'); t('неверный код аутентификатора — отказ', r.b.status === 401, JSON.stringify(r.b.data));
r = await post('/api/skyid/passkeys/register/begin', {}, u.tok); t('без кода — отказ', r.status !== 200);
r = await register(u.tok, k1, currentTotp(secret), { challenge: 'AAAA' }); t('чужой challenge отвергнут', r.f.status === 400 && r.f.data.error === 'bad_challenge', JSON.stringify(r.f?.data));
r = await register(u.tok, k1, currentTotp(secret), { origin: 'https://evil.test' }); t('чужой origin отвергнут', r.f.data.error === 'bad_origin', JSON.stringify(r.f?.data));
r = await register(u.tok, k1, currentTotp(secret), { rp: 'evil.test' }); t('чужой rpId отвергнут', r.f.data.error === 'bad_rp', JSON.stringify(r.f?.data));
r = await register(u.tok, k1, currentTotp(secret), { flags: 0x01 }); t('без подтверждения пользователя (UV) отвергнут', r.f.data.error === 'user_not_verified', JSON.stringify(r.f?.data));
r = await register(u.tok, k1, currentTotp(secret), { type: 'webauthn.get' }); t('неверный тип запроса отвергнут', r.f.data.error === 'bad_client_data', JSON.stringify(r.f?.data));
r = await register(u.tok, k1, currentTotp(secret));
t('ключ создан', r.f.status === 200 && r.f.data.key.name === 'Мой iPhone' && r.f.data.key.icon === 'phone', JSON.stringify(r.f?.data));
const keyId = r.f.data.key.id;
const replay = await post('/api/skyid/passkeys/register/finish', { challengeId: r.b.data.challengeId, credential: {} }, u.tok);
t('challenge одноразовый', replay.status === 410);
r = await call('/api/skyid/passkeys', {}, u.tok); t('список: 1 ключ', r.data.keys.length === 1 && r.data.twoFactorEnabled && !JSON.stringify(r.data).includes('public'), JSON.stringify(r.data).slice(0, 150));
r = await call('/api/skyid/passkeys', {}, other.tok); t('чужой список пуст', r.data.keys.length === 0);

// предел проверок кода — 10 в минуту: ждём сброса
await new Promise((r) => setTimeout(r, 61000));
// вход
let a = await assertion(k1);
t('вход по ключу → всё равно нужен код аутентификатора', a.f.status === 200 && a.f.data.needsTwoFactor === true && !a.f.data.accessToken, JSON.stringify(a.f.data).slice(0, 150));
const fin = await post('/api/auth/two-factor/verify', { challenge: a.f.data.challenge, code: currentTotp(secret) });
t('после кода — сессия', fin.status === 200 && fin.data.accessToken, String(fin.status));
a = await assertion(k1, { badSig: true }); t('подделанная подпись', a.f.status === 401 && a.f.data.error === 'bad_signature', JSON.stringify(a.f.data));
a = await assertion(k1, { origin: 'https://evil.test' }); t('вход с чужого origin', a.f.status === 401);
a = await assertion(k1, { flags: 0x01 }); t('вход без UV', a.f.data.error === 'user_not_verified', JSON.stringify(a.f.data));
const stale = await assertion(k1, { bump: false, counter: 1 });
t('повтор старого счётчика → ключ заморожен (подозрение на клон)', stale.f.status === 403 && stale.f.data.error === 'key_frozen', JSON.stringify(stale.f.data));
r = await call('/api/skyid/passkeys', {}, u.tok); t('в списке ключ заморожен', r.data.keys[0].status === 'frozen');
await new Promise((r) => setTimeout(r, 61000));
r = await post(`/api/skyid/passkeys/${keyId}/unfreeze`, { twoFactorCode: '000000' }, u.tok); t('разморозка без кода — отказ', r.status === 401);
r = await post(`/api/skyid/passkeys/${keyId}/unfreeze`, { twoFactorCode: currentTotp(secret) }, u.tok); t('разморозка с кодом', r.status === 200 && r.data.key.status === 'active', JSON.stringify(r.data));
a = await assertion(k1); t('после разморозки вход идёт', a.f.status === 200 && a.f.data.needsTwoFactor, JSON.stringify(a.f.data).slice(0, 100));
r = await post(`/api/skyid/passkeys/${keyId}/freeze`, { twoFactorCode: currentTotp(secret) }, u.tok); t('заморозка', r.status === 200 && r.data.key.status === 'frozen');
a = await assertion(k1); t('замороженным входить нельзя', a.f.status === 403, String(a.f.status));
r = await call(`/api/skyid/passkeys/${keyId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Рабочий <b>', icon: 'laptop' }) }, u.tok); t('переименование и иконка', r.status === 200 && r.data.key.icon === 'laptop' && !r.data.key.name.includes('<'), JSON.stringify(r.data));
r = await call(`/api/skyid/passkeys/${keyId}`, { method: 'PATCH', body: JSON.stringify({ icon: 'virus' }) }, u.tok); t('неизвестная иконка отвергнута', r.status === 400);
r = await call(`/api/skyid/passkeys/${keyId}`, { method: 'PATCH', body: JSON.stringify({ name: 'x' }) }, other.tok); t('чужой ключ не изменить', r.status === 404);
r = await call(`/api/skyid/passkeys/${keyId}`, { method: 'DELETE', body: JSON.stringify({ twoFactorCode: currentTotp(secret) }) }, other.tok); t('чужой ключ не удалить', r.status === 404 || r.status === 409, String(r.status));
r = await call(`/api/skyid/passkeys/${keyId}`, { method: 'DELETE', body: JSON.stringify({ twoFactorCode: '000000' }) }, u.tok); t('удаление без кода — отказ', r.status === 401);
r = await call(`/api/skyid/passkeys/${keyId}`, { method: 'DELETE', body: JSON.stringify({ twoFactorCode: currentTotp(secret) }) }, u.tok); t('удаление с кодом', r.status === 200);
a = await assertion(k1); t('удалённым входить нельзя', a.f.status === 401 && a.f.data.error === 'unknown_key', JSON.stringify(a.f.data));
// выключили 2FA — вход по ключу не пускает
const k2 = makeKey(); r = await register(u.tok, k2, currentTotp(secret)); t('второй ключ создан', r.f.status === 200);
q(`update sky_ids set two_factor_enabled=false where id='${sky}'`);
a = await assertion(k2); t('без аутентификатора по ключу не входим', a.f.status === 403 && a.f.data.error === 'two_factor_required_setup', JSON.stringify(a.f.data));
r = await post('/api/auth/passkey/finish', { challengeId: 'nope', credential: {} }); t('мусор вместо вызова', r.status === 401);
console.log(`\n${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
