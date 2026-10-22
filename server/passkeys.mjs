/**
 * Ключи доступа (WebAuthn): вход по Face ID / отпечатку / Windows Hello.
 * Без внешних библиотек: свой разбор CBOR/COSE и проверка подписи через node:crypto.
 * Принимаем ES256 (-7) и RS256 (-257), аттестация «none» (устройство не проверяем — только владение ключом).
 * Обязательно подтверждение пользователя (UV): без Face ID/пальца/PIN устройства ключ не принимается.
 * Создание, заморозка и удаление требуют код аутентификатора; вход по ключу тоже заканчивается его кодом (routes/auth.mjs).
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { generateId } from './security.mjs';
import { verifySkyTwoFactor } from './skyid.mjs';
import { logEvent } from './skylog.mjs';
import { notifyAccount } from './recoverycore.mjs';

export const ICONS = ['key', 'phone', 'laptop', 'tablet', 'shield', 'star', 'heart', 'bolt', 'globe', 'home'];
const MAX_KEYS = 10;
const TTL_SEC = 300;
export const b64u = (buf) => Buffer.from(buf).toString('base64url');

export const rpId = () => process.env.PASSKEY_RP_ID || (config.publicOrigin ? new URL(config.publicOrigin).hostname : '');
const origins = () => (process.env.PASSKEY_ORIGINS ? process.env.PASSKEY_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : [config.publicOrigin].filter(Boolean));

/* ── CBOR (только нужное WebAuthn) ─────────────────────────────── */
export const cborDecode = (buf, pos = 0) => {
  const first = buf[pos]; const major = first >> 5; const info = first & 31; let p = pos + 1; let val = info;
  if (info === 24) { val = buf[p]; p += 1; }
  else if (info === 25) { val = buf.readUInt16BE(p); p += 2; }
  else if (info === 26) { val = buf.readUInt32BE(p); p += 4; }
  else if (info === 27) { val = Number(buf.readBigUInt64BE(p)); p += 8; }
  else if (info > 27) throw new Error('cbor_unsupported');
  if (major === 0) return [val, p];
  if (major === 1) return [-1 - val, p];
  if (major === 2) return [buf.subarray(p, p + val), p + val];
  if (major === 3) return [buf.subarray(p, p + val).toString('utf8'), p + val];
  if (major === 4) { const a = []; for (let i = 0; i < val; i += 1) { const [v, n] = cborDecode(buf, p); a.push(v); p = n; } return [a, p]; }
  if (major === 5) { const m = new Map(); for (let i = 0; i < val; i += 1) { const [k, n1] = cborDecode(buf, p); const [v, n2] = cborDecode(buf, n1); m.set(k, v); p = n2; } return [m, p]; }
  if (major === 7) return [info === 20 ? false : info === 21 ? true : null, p];
  throw new Error('cbor_unsupported');
};

export const coseToJwk = (cose) => {
  const kty = cose.get(1); const alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) return { alg, jwk: { kty: 'EC', crv: 'P-256', x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) } };
  if (kty === 3 && alg === -257) return { alg, jwk: { kty: 'RSA', n: b64u(cose.get(-1)), e: b64u(cose.get(-2)) } };
  throw new Error('bad_algorithm');
};

export const parseClientData = (raw, type, expectChallenge) => {
  let cd; try { cd = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { throw new Error('bad_client_data'); }
  if (cd.type !== type) throw new Error('bad_client_data');
  if (cd.challenge !== expectChallenge) throw new Error('bad_challenge');
  if (!origins().includes(cd.origin) || cd.crossOrigin === true) throw new Error('bad_origin');
  return cd;
};
export const checkAuthData = (ad) => {
  if (ad.length < 37) throw new Error('bad_auth_data');
  if (!ad.subarray(0, 32).equals(crypto.createHash('sha256').update(rpId()).digest())) throw new Error('bad_rp');
  const flags = ad[32];
  if (!(flags & 1)) throw new Error('user_not_present');
  if (!(flags & 4)) throw new Error('user_not_verified');
  return { flags, signCount: ad.readUInt32BE(33) };
};

/* ── Вызовы (challenge) ────────────────────────────────────────── */
export const newChallenge = async (skyId, purpose) => {
  await query('DELETE FROM passkey_challenges WHERE expires_at < now()').catch(() => {});
  const id = `pkc-${generateId()}`; const challenge = b64u(crypto.randomBytes(32));
  await query(`INSERT INTO passkey_challenges (id, sky_id, purpose, challenge, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' seconds')::interval)`, [id, skyId, purpose, challenge, String(TTL_SEC)]);
  return { id, challenge };
};
export const takeChallenge = async (id, purpose, skyId) => {
  const { rows } = await query(`DELETE FROM passkey_challenges WHERE id = $1 AND purpose = $2 AND expires_at > now() RETURNING sky_id, challenge`, [String(id ?? ''), purpose]);
  const r = rows[0];
  if (!r || (skyId !== undefined && r.sky_id !== skyId)) return null;
  return r;
};

const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || 'Ключ доступа';
const view = (r) => ({ id: r.id, name: r.name, icon: r.icon, status: r.status, transports: r.transports, createdAt: r.created_at, lastUsedAt: r.last_used_at });

export const listKeys = async (skyId) => {
  const { rows } = await query('SELECT * FROM sky_passkeys WHERE sky_id = $1 ORDER BY created_at', [skyId]);
  const tf = await query('SELECT two_factor_enabled FROM sky_ids WHERE id = $1', [skyId]);
  return { keys: rows.map(view), icons: ICONS, twoFactorEnabled: !!tf.rows[0]?.two_factor_enabled, max: MAX_KEYS };
};

const needTwoFactor = async (skyId, code) => {
  const { rows } = await query('SELECT two_factor_enabled FROM sky_ids WHERE id = $1', [skyId]);
  if (!rows[0]?.two_factor_enabled) return { error: 'two_factor_required_setup' };
  const tf = await verifySkyTwoFactor(skyId, code);
  if (tf?.error) return { error: tf.error === 'invalid_code' ? 'invalid_code' : tf.error };
  return null;
};

/* ── Создание ключа ────────────────────────────────────────────── */
export const beginRegister = async (skyId, { twoFactorCode }) => {
  const bad = await needTwoFactor(skyId, twoFactorCode); if (bad) return bad;
  const { rows } = await query('SELECT cred_id FROM sky_passkeys WHERE sky_id = $1', [skyId]);
  if (rows.length >= MAX_KEYS) return { error: 'too_many_keys' };
  const who = (await query('SELECT email FROM sky_ids WHERE id = $1', [skyId])).rows[0];
  const ch = await newChallenge(skyId, 'register');
  return {
    challengeId: ch.id,
    publicKey: {
      rp: { id: rpId(), name: 'Sky' },
      user: { id: b64u(Buffer.from(skyId)), name: who?.email || 'Sky ID', displayName: who?.email || 'Sky ID' },
      challenge: ch.challenge,
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      attestation: 'none', timeout: 60000,
      excludeCredentials: rows.map((r) => ({ type: 'public-key', id: r.cred_id })),
    },
  };
};

export const finishRegister = async (skyId, { challengeId, credential, name, icon }) => {
  const ch = await takeChallenge(challengeId, 'register', skyId);
  if (!ch) return { error: 'challenge_expired' };
  try {
    const resp = credential?.response ?? {};
    parseClientData(String(resp.clientDataJSON ?? ''), 'webauthn.create', ch.challenge);
    const [att] = cborDecode(Buffer.from(String(resp.attestationObject ?? ''), 'base64url'));
    const ad = att.get('authData'); if (!Buffer.isBuffer(ad)) throw new Error('bad_auth_data');
    const { flags, signCount } = checkAuthData(ad);
    if (!(flags & 0x40)) throw new Error('no_credential');
    const idLen = ad.readUInt16BE(53); const credId = ad.subarray(55, 55 + idLen);
    if (b64u(credId) !== String(credential.id)) throw new Error('bad_credential');
    const [cose] = cborDecode(ad, 55 + idLen);
    const { alg, jwk } = coseToJwk(cose);
    const id = `pk-${generateId()}`;
    const transports = Array.isArray(resp.transports) ? resp.transports.filter((t) => /^[a-z-]{2,12}$/.test(t)).slice(0, 5) : [];
    const ins = await query(
      `INSERT INTO sky_passkeys (id, sky_id, cred_id, public_jwk, alg, sign_count, name, icon, transports)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE (SELECT count(*) FROM sky_passkeys WHERE sky_id = $2) < $10
       ON CONFLICT (cred_id) DO NOTHING RETURNING *`,
      [id, skyId, b64u(credId), JSON.stringify(jwk), alg, signCount, cleanName(name), ICONS.includes(icon) ? icon : 'key', transports, MAX_KEYS]);
    if (!ins.rows[0]) return { error: 'cannot_add' };
    logEvent({ category: 'security', service: 'passkeys', type: 'passkey_created', targetId: skyId });
    void notifyAccount(skyId, { title: 'Добавлен ключ доступа', text: `В ваш Sky ID добавлен ключ доступа «${cleanName(name)}».` }).catch(() => {});
    return { ok: true, key: view(ins.rows[0]) };
  } catch (e) {
    return { error: /^[a-z_]+$/.test(e.message) ? e.message : 'bad_credential' };
  }
};

/* ── Вход ──────────────────────────────────────────────────────── */
export const beginLogin = async () => {
  const ch = await newChallenge(null, 'login');
  return { challengeId: ch.id, publicKey: { challenge: ch.challenge, rpId: rpId(), userVerification: 'required', timeout: 60000, allowCredentials: [] } };
};

export const finishLogin = async ({ challengeId, credential }) => {
  const ch = await takeChallenge(challengeId, 'login');
  if (!ch) return { error: 'challenge_expired' };
  try {
    const resp = credential?.response ?? {};
    const { rows } = await query('SELECT * FROM sky_passkeys WHERE cred_id = $1', [String(credential?.id ?? '')]);
    const key = rows[0]; if (!key) return { error: 'unknown_key' };
    parseClientData(String(resp.clientDataJSON ?? ''), 'webauthn.get', ch.challenge);
    const ad = Buffer.from(String(resp.authenticatorData ?? ''), 'base64url');
    const { signCount } = checkAuthData(ad);
    const signed = Buffer.concat([ad, crypto.createHash('sha256').update(Buffer.from(resp.clientDataJSON, 'base64url')).digest()]);
    const pub = crypto.createPublicKey({ key: key.public_jwk, format: 'jwk' });
    const sig = Buffer.from(String(resp.signature ?? ''), 'base64url');
    const ok = key.alg === -7 ? crypto.verify('sha256', signed, { key: pub, dsaEncoding: 'der' }, sig) : crypto.verify('sha256', signed, pub, sig);
    if (!ok) return { error: 'bad_signature' };
    const stored = Number(key.sign_count);
    if ((stored > 0 || signCount > 0) && signCount <= stored) {
      await query(`UPDATE sky_passkeys SET status = 'frozen' WHERE id = $1`, [key.id]);
      logEvent({ category: 'security', service: 'passkeys', level: 'WARN', type: 'passkey_clone_suspected', targetId: key.sky_id });
      return { error: 'key_frozen' };
    }
    if (key.status !== 'active') return { error: 'key_frozen' };
    await query('UPDATE sky_passkeys SET sign_count = $2, last_used_at = now() WHERE id = $1', [key.id, signCount]);
    return { ok: true, skyId: key.sky_id, keyId: key.id };
  } catch (e) {
    return { error: /^[a-z_]+$/.test(e.message) ? e.message : 'bad_credential' };
  }
};

/* ── Управление ────────────────────────────────────────────────── */
export const updateKey = async (skyId, keyId, { name, icon }) => {
  const sets = []; const vals = [keyId, skyId];
  if (name !== undefined) { vals.push(cleanName(name)); sets.push(`name = $${vals.length}`); }
  if (icon !== undefined) { if (!ICONS.includes(icon)) return { error: 'bad_icon' }; vals.push(icon); sets.push(`icon = $${vals.length}`); }
  if (!sets.length) return { error: 'nothing_to_change' };
  const { rows } = await query(`UPDATE sky_passkeys SET ${sets.join(', ')} WHERE id = $1 AND sky_id = $2 RETURNING *`, vals);
  return rows[0] ? { ok: true, key: view(rows[0]) } : { error: 'not_found' };
};

export const setFrozen = async (skyId, keyId, frozen, twoFactorCode) => {
  const bad = await needTwoFactor(skyId, twoFactorCode); if (bad) return bad;
  const { rows } = await query(`UPDATE sky_passkeys SET status = $3 WHERE id = $1 AND sky_id = $2 RETURNING *`, [keyId, skyId, frozen ? 'frozen' : 'active']);
  if (!rows[0]) return { error: 'not_found' };
  logEvent({ category: 'security', service: 'passkeys', type: frozen ? 'passkey_frozen' : 'passkey_unfrozen', targetId: skyId });
  void notifyAccount(skyId, { title: frozen ? 'Ключ доступа заморожен' : 'Ключ доступа разморожен', text: `Ключ «${rows[0].name}» ${frozen ? 'заморожен: входить им нельзя' : 'снова работает'}.` }).catch(() => {});
  return { ok: true, key: view(rows[0]) };
};

export const deleteKey = async (skyId, keyId, twoFactorCode) => {
  const bad = await needTwoFactor(skyId, twoFactorCode); if (bad) return bad;
  const { rows } = await query('DELETE FROM sky_passkeys WHERE id = $1 AND sky_id = $2 RETURNING name', [keyId, skyId]);
  if (!rows[0]) return { error: 'not_found' };
  logEvent({ category: 'security', service: 'passkeys', type: 'passkey_deleted', targetId: skyId });
  void notifyAccount(skyId, { title: 'Ключ доступа удалён', text: `Ключ «${rows[0].name}» удалён из вашего Sky ID.` }).catch(() => {});
  return { ok: true };
};
