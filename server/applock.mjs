/**
 * Замок приложения, который держит СЕРВЕР (вход по коду и Face ID / отпечатку на устройстве).
 *
 * Раньше замок жил только в браузере (localStorage) и обходился инструментами разработчика: стереть флаг — и экран открыт.
 * Теперь состояние «закрыто» хранится на сервере у сессии, а все запросы закрытой сессии получают 423 `app_locked`
 * (server.mjs, `applockBlocked`), сокет не открывается/закрывается (signal.mjs). Экран на клиенте только показывает это состояние.
 *
 *  • Замок включается для УСТРОЙСТВА (заголовок X-Sky-Device) с кодом 4–6 цифр. Код — scrypt + соль + перец, проверяет сервер,
 *    перебор: 5 неверных — пауза 30 с, дальше вдвое дольше; 15 неверных — сессия завершается.
 *  • Закрытой сессия становится: по запросу клиента (ушёл в фон), и САМА — если от открытого приложения давно не было пульса
 *    (`GRACE_MS`): вкладка в фоне пульс не шлёт, подделать «я ещё тут» без кода нельзя — устаревшую сессию пульс не открывает.
 *  • Открыть: код, либо биометрия через WebAuthn (подпись проверяет сервер по ключу, сохранённому при включении), либо — только в
 *    .apk/.ipa — системная биометрия телефона (она доказать серверу ничего не может; отладка WebView в релизе выключена).
 *  • Вход по паролю/коду на устройстве доказывает личность сам: такая сессия открыта, и десять минут можно задать новый код (забытый).
 * Честно о границах: тот, кто УЖЕ украл refresh-токен и использует его вне этого устройства, замком не остановлен (замок привязан к
 * сессии устройства); медиа по уже выданным пропускам доиграет до их окончания.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { sessionStore } from './sessions.mjs';
import { logEvent as skyLog } from './skylog.mjs';
import * as pk from './passkeys.mjs';

const scrypt = promisify(crypto.scrypt);
export const GRACE_MS = Math.max(20, Number(process.env.APPLOCK_GRACE_SEC) || 150) * 1000;
const FRESH_MS = 10 * 60_000;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const KINDS = new Set(['web', 'native', 'desktop']);
const err = (error, extra = {}) => ({ error, ...extra });

const hashOf = (id) => crypto.createHmac('sha256', `${config.jwtSecret}:applock-device:v1`).update(id).digest('hex');
export const deviceHash = (req) => { const v = String(req?.headers?.['x-sky-device'] ?? ''); return ID_RE.test(v) ? hashOf(v) : null; };
const pinHash = async (pin, salt) => (await scrypt(`${pin}:${config.jwtSecret}`, Buffer.from(salt, 'hex'), 32)).toString('hex');
const pinOk = (pin) => /^\d{4,6}$/.test(String(pin ?? ''));
const row = async (skyId, dev) => dev ? ((await query('SELECT * FROM app_lock_devices WHERE sky_id = $1 AND device_hash = $2', [skyId, dev])).rows[0] ?? null) : null;

/** Закрыта ли сессия сейчас (по записи замка). */
export const isClosed = (rec, now = Date.now()) => Boolean(rec) && (rec.locked === true || now - Number(rec.seen || 0) > GRACE_MS);

/** Для server.mjs / signal.mjs: сессия помечена замком и сейчас закрыта? */
export const applockBlocked = async (sid, stored) => {
  if (!stored?.appLock) return false;
  return isClosed(await sessionStore.getLock(sid));
};

const open = (sid, dev, extra = {}) => sessionStore.setLock(sid, { dev, locked: false, seen: Date.now(), ...extra });

/** Вход на устройстве с замком: сам вход — доказательство личности, сессия открыта; десять минут можно сменить забытый код. */
export const onLogin = async (skyId, sid, req) => {
  const dev = deviceHash(req);
  if (!(await row(skyId, dev))) return false;
  await open(sid, dev, { fresh: Date.now() + FRESH_MS });
  await sessionStore.patch(sid, { appLock: true });
  return true;
};

export const status = async (skyId, sid, req) => {
  const dev = deviceHash(req);
  const r = await row(skyId, dev);
  if (!r) return { enabled: false, canEnable: Boolean(dev) };
  let rec = await sessionStore.getLock(sid);
  if (!rec) {   // сессия на устройстве с замком, но без записи (например, начата до включения): закрываем, пока не откроют
    rec = { dev, locked: true, seen: 0 };
    await sessionStore.setLock(sid, rec);
  }
  const stored = await sessionStore.get(sid);
  if (stored && !stored.appLock) await sessionStore.patch(sid, { appLock: true });
  const blocked = r.blocked_until && r.blocked_until > new Date() ? Math.ceil((r.blocked_until - Date.now()) / 1000) : 0;
  return { enabled: true, kind: r.kind, bio: Boolean(r.wa_cred_id), locked: isClosed(rec), fresh: Number(rec.fresh || 0) > Date.now(), graceSec: Math.round(GRACE_MS / 1000), blockedFor: blocked };
};

/** Проверка кода с защитой от перебора. Возвращает null при успехе. */
const checkPin = async (skyId, sid, r, pin) => {
  if (r.blocked_until && r.blocked_until > new Date()) return err('too_many_attempts', { retryAfter: Math.ceil((r.blocked_until - Date.now()) / 1000) });
  if (!pinOk(pin)) return err('invalid_pin');
  const ok = crypto.timingSafeEqual(Buffer.from(await pinHash(pin, r.pin_salt), 'hex'), Buffer.from(r.pin_hash, 'hex'));
  if (ok) { if (r.fails) await query('UPDATE app_lock_devices SET fails = 0, blocked_until = NULL WHERE sky_id = $1 AND device_hash = $2', [r.sky_id, r.device_hash]); return null; }
  const fails = r.fails + 1;
  const wait = fails % 5 === 0 ? 30 * 2 ** (fails / 5 - 1) : 0;
  await query('UPDATE app_lock_devices SET fails = $3, blocked_until = $4 WHERE sky_id = $1 AND device_hash = $2', [r.sky_id, r.device_hash, fails, wait ? new Date(Date.now() + wait * 1000) : null]);
  skyLog({ category: 'security', service: 'applock', level: fails >= 10 ? 'WARN' : 'INFO', type: 'applock_bad_pin', targetId: skyId, detail: { fails } });
  if (fails >= 15) { await sessionStore.revoke(sid); return err('session_ended'); }
  return err('invalid_pin', wait ? { retryAfter: wait } : {});
};

/** Проверка подписи биометрии (WebAuthn) по ключу устройства. null — успех. */
const checkAssertion = async (skyId, r, { challengeId, credential }) => {
  if (!r.wa_cred_id) return err('no_biometric');
  const ch = await pk.takeChallenge(challengeId, 'applock-get', skyId);
  if (!ch) return err('challenge_expired');
  try {
    const resp = credential?.response ?? {};
    if (String(credential?.id ?? '') !== r.wa_cred_id) return err('unknown_key');
    pk.parseClientData(String(resp.clientDataJSON ?? ''), 'webauthn.get', ch.challenge);
    const ad = Buffer.from(String(resp.authenticatorData ?? ''), 'base64url');
    const { signCount } = pk.checkAuthData(ad);
    const signed = Buffer.concat([ad, crypto.createHash('sha256').update(Buffer.from(resp.clientDataJSON, 'base64url')).digest()]);
    const pub = crypto.createPublicKey({ key: r.wa_jwk, format: 'jwk' });
    const sig = Buffer.from(String(resp.signature ?? ''), 'base64url');
    const ok = r.wa_alg === -7 ? crypto.verify('sha256', signed, { key: pub, dsaEncoding: 'der' }, sig) : crypto.verify('sha256', signed, pub, sig);
    if (!ok) return err('bad_signature');
    const stored = Number(r.wa_count);
    if ((stored > 0 || signCount > 0) && signCount <= stored) return err('key_replayed');
    await query('UPDATE app_lock_devices SET wa_count = $3 WHERE sky_id = $1 AND device_hash = $2', [r.sky_id, r.device_hash, signCount]);
    return null;
  } catch (e) { return err(/^[a-z_]+$/.test(e.message) ? e.message : 'bad_credential'); }
};

export const unlockBegin = async (skyId, req) => {
  const r = await row(skyId, deviceHash(req));
  if (!r?.wa_cred_id) return err('no_biometric');
  const ch = await pk.newChallenge(skyId, 'applock-get');
  return { challengeId: ch.id, publicKey: { challenge: ch.challenge, rpId: pk.rpId(), userVerification: 'required', timeout: 60000, allowCredentials: [{ type: 'public-key', id: r.wa_cred_id }] } };
};

export const unlock = async (skyId, sid, req, b) => {
  const dev = deviceHash(req);
  const r = await row(skyId, dev);
  if (!r) return err('not_enabled');
  let bad;
  if (b.method === 'native') bad = r.kind === 'native' ? null : err('method_not_allowed');   // системную биометрию телефона серверу не доказать — только для .apk/.ipa
  else if (b.method === 'bio') bad = await checkAssertion(skyId, r, b);
  else bad = await checkPin(skyId, sid, r, b.pin);
  if (bad) return bad;
  const prev = await sessionStore.getLock(sid);
  await open(sid, dev, prev?.fresh ? { fresh: prev.fresh } : {});
  skyLog({ category: 'security', service: 'applock', type: 'applock_unlock', targetId: skyId, detail: { method: b.method || 'pin' } });
  return { ok: true };
};

export const ping = async (sid) => {
  const rec = await sessionStore.getLock(sid);
  if (!rec) return { locked: false };
  // Давно не было пульса — сессия закрыта окончательно: «воскресить» её пульсом нельзя, нужен код.
  if (isClosed(rec)) { if (!rec.locked) await sessionStore.setLock(sid, { ...rec, locked: true }); return { locked: true }; }
  await sessionStore.setLock(sid, { ...rec, seen: Date.now() });
  return { locked: false };
};

export const lock = async (sid) => {
  const rec = await sessionStore.getLock(sid);
  if (rec) await sessionStore.setLock(sid, { ...rec, locked: true });
  return { ok: true };
};

export const enable = async (skyId, sid, req, b) => {
  const dev = deviceHash(req);
  if (!dev) return err('no_device');
  if (!pinOk(b.pin)) return err('invalid_pin');
  const kind = KINDS.has(b.kind) ? b.kind : 'web';
  const prev = await row(skyId, dev);
  const rec = await sessionStore.getLock(sid);
  if (prev) {   // менять код можно: старым кодом или сразу после входа (забыли код)
    const fresh = Number(rec?.fresh || 0) > Date.now();
    if (!fresh) { const bad = await checkPin(skyId, sid, prev, b.oldPin); if (bad) return bad; }
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await pinHash(b.pin, salt);
  await query(`INSERT INTO app_lock_devices (sky_id, device_hash, kind, pin_salt, pin_hash) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (sky_id, device_hash) DO UPDATE SET kind = $3, pin_salt = $4, pin_hash = $5, fails = 0, blocked_until = NULL, updated_at = now()`, [skyId, dev, kind, salt, hash]);
  await open(sid, dev, {});
  await sessionStore.patch(sid, { appLock: true });
  skyLog({ category: 'security', service: 'applock', type: prev ? 'applock_pin_changed' : 'applock_enabled', targetId: skyId, detail: { kind } });
  return { ok: true };
};

/** Выключить: сессия должна быть открыта и подтвердить себя кодом или биометрией. */
export const disable = async (skyId, sid, req, b) => {
  const dev = deviceHash(req);
  const r = await row(skyId, dev);
  if (!r) return { ok: true };
  const bad = b.method === 'native' ? (r.kind === 'native' ? null : err('method_not_allowed')) : b.method === 'bio' ? await checkAssertion(skyId, r, b) : await checkPin(skyId, sid, r, b.pin);
  if (bad) return bad;
  await query('DELETE FROM app_lock_devices WHERE sky_id = $1 AND device_hash = $2', [skyId, dev]);
  await sessionStore.setLock(sid, null);
  await sessionStore.patch(sid, { appLock: false });
  skyLog({ category: 'security', service: 'applock', type: 'applock_disabled', targetId: skyId });
  return { ok: true };
};

/* ── Биометрия в браузере: ключ создаётся на устройстве, на сервере остаётся только открытая часть ── */
export const bioBegin = async (skyId, sid, req, b) => {
  const r = await row(skyId, deviceHash(req));
  if (!r) return err('not_enabled');
  const bad = await checkPin(skyId, sid, r, b.pin); if (bad) return bad;   // чужую биометрию без кода не добавить
  const ch = await pk.newChallenge(skyId, 'applock-reg');
  return { challengeId: ch.id, publicKey: {
    rp: { id: pk.rpId(), name: 'Sky' },
    user: { id: pk.b64u(Buffer.from(`${skyId}:applock`)), name: 'sky-app-lock', displayName: 'Sky' },
    challenge: ch.challenge,
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    attestation: 'none', timeout: 60000,
  } };
};
export const bioFinish = async (skyId, req, { challengeId, credential }) => {
  const dev = deviceHash(req);
  const r = await row(skyId, dev); if (!r) return err('not_enabled');
  const ch = await pk.takeChallenge(challengeId, 'applock-reg', skyId);
  if (!ch) return err('challenge_expired');
  try {
    const resp = credential?.response ?? {};
    pk.parseClientData(String(resp.clientDataJSON ?? ''), 'webauthn.create', ch.challenge);
    const [att] = pk.cborDecode(Buffer.from(String(resp.attestationObject ?? ''), 'base64url'));
    const ad = att.get('authData'); if (!Buffer.isBuffer(ad)) throw new Error('bad_auth_data');
    const { flags, signCount } = pk.checkAuthData(ad);
    if (!(flags & 0x40)) throw new Error('no_credential');
    const idLen = ad.readUInt16BE(53); const credId = ad.subarray(55, 55 + idLen);
    if (pk.b64u(credId) !== String(credential.id)) throw new Error('bad_credential');
    const [cose] = pk.cborDecode(ad, 55 + idLen);
    const { alg, jwk } = pk.coseToJwk(cose);
    await query('UPDATE app_lock_devices SET wa_cred_id = $3, wa_jwk = $4, wa_alg = $5, wa_count = $6, updated_at = now() WHERE sky_id = $1 AND device_hash = $2', [skyId, dev, pk.b64u(credId), JSON.stringify(jwk), alg, signCount]);
    return { ok: true };
  } catch (e) { return err(/^[a-z_]+$/.test(e.message) ? e.message : 'bad_credential'); }
};
export const bioRemove = async (skyId, sid, req, b) => {
  const r = await row(skyId, deviceHash(req)); if (!r) return err('not_enabled');
  const bad = await checkPin(skyId, sid, r, b.pin); if (bad) return bad;
  await query('UPDATE app_lock_devices SET wa_cred_id = NULL, wa_jwk = NULL, wa_alg = NULL, wa_count = 0 WHERE sky_id = $1 AND device_hash = $2', [skyId, r.device_hash]);
  return { ok: true };
};
