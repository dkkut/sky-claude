// Серверный замок приложения (server/applock.mjs). API: PASSKEY_RP_ID=sky.test PASSKEY_ORIGINS=https://sky.test APPLOCK_GRACE_SEC=20 (node scripts/audit/applock-test.mjs <каталог с api.log>)
import crypto from 'node:crypto';
import { call, mkuser, B } from './lib.mjs';
const S = process.argv[2];
let ok = 0, bad = 0; const t = (n, c, x = '') => { if (c) { ok++; console.log('ok  ', n); } else { bad++; console.log('FAIL', n, typeof x === 'string' ? x.slice(0, 200) : JSON.stringify(x).slice(0, 200)); } };
const DEV = 'dev' + crypto.randomBytes(12).toString('hex');
const OTHER = 'dev' + crypto.randomBytes(12).toString('hex');
const H = (dev = DEV) => ({ 'x-sky-device': dev });
const post = (p, b, tok, dev = DEV) => call('/api/skyid/applock' + p, { method: 'POST', body: JSON.stringify(b ?? {}), headers: H(dev) }, tok);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RP = 'sky.test', ORIGIN = 'https://sky.test';
const b64u = (b) => Buffer.from(b).toString('base64url');
const enc = (v) => { const head = (m, n) => n < 24 ? Buffer.from([(m << 5) | n]) : n < 256 ? Buffer.from([(m << 5) | 24, n]) : Buffer.from([(m << 5) | 25, n >> 8, n & 255]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [enc(k), enc(x)])]); };
const key = (() => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }); const j = publicKey.export({ format: 'jwk' }); return { privateKey, credId: crypto.randomBytes(32), x: Buffer.from(j.x, 'base64url'), y: Buffer.from(j.y, 'base64url'), counter: 0 }; })();
const rpHash = crypto.createHash('sha256').update(RP).digest();
const cdata = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false }));

const u = await mkuser(S, 'alk');
// пользователь входит «с устройства»: заголовок на вход тоже нужен, поэтому делаем повторный вход с заголовком DEV
let r;
// 1. без замка всё работает
r = await call('/api/skyid/applock', {}, u.tok, H()); t('замок выключен — статус enabled=false', r.status === 200 && r.data.enabled === false, r.data);
r = await call('/api/wallet', {}, u.tok, H()); t('до включения API открыт', r.status !== 423, r.status);

// 2. включение
r = await post('/enable', { pin: '12' }, u.tok); t('короткий код отклонён', r.status === 400, r.data);
r = await post('/enable', { pin: '2468', kind: 'web' }, u.tok); t('включение с кодом', r.status === 200 && r.data.ok, r.data);
r = await call('/api/skyid/applock', {}, u.tok, H()); t('статус: включён, открыт', r.data.enabled && r.data.locked === false && r.data.kind === 'web', r.data);
r = await call('/api/wallet', {}, u.tok, H()); t('открытая сессия работает', r.status !== 423, r.status);

// 3. закрытие
r = await post('/lock', {}, u.tok); t('lock', r.status === 200, r.data);
r = await call('/api/wallet', {}, u.tok, H()); t('закрытая сессия: 423 app_locked', r.status === 423 && r.data.error === 'app_locked', r);
r = await call('/api/wallet', {}, u.tok); t('без заголовка устройства — всё равно 423 (подмена заголовка не помогает)', r.status === 423, r.status);
r = await call('/api/wallet', {}, u.tok, H(OTHER)); t('с чужим заголовком устройства — 423', r.status === 423, r.status);
r = await call('/api/skyid/profiles', {}, u.tok, H()); t('список профилей закрыт', r.status === 423, r.status);
r = await call('/api/auth/devices', {}, u.tok, H()); t('/api/auth/devices закрыт', r.status === 423, r.status);
r = await call('/api/auth/password/change', { method: 'POST', body: '{}' }, u.tok, H()); t('смена пароля закрыта', r.status === 423, r.status);
r = await call('/api/platform/status', {}, u.tok, H()); t('статус платформы остаётся доступен', r.status === 200, r.status);
r = await post('/ping', {}, u.tok); t('пульс закрытую не открывает', r.data.locked === true, r.data);
r = await post('/disable', { pin: '2468' }, u.tok); t('закрытая сессия не может выключить замок', r.status === 423, r);
r = await post('/enable', { pin: '1111', oldPin: '2468' }, u.tok); t('закрытая сессия не меняет код', r.status === 423, r);
r = await post('/bio/begin', { pin: '2468' }, u.tok); t('закрытая сессия не добавляет биометрию', r.status === 423, r);

// 4. перебор кода
r = await post('/unlock', { pin: '0000' }, u.tok); t('неверный код', r.status === 400 && r.data.error === 'invalid_pin', r);
for (let i = 0; i < 3; i++) await post('/unlock', { pin: '1111' }, u.tok);
r = await post('/unlock', { pin: '2222' }, u.tok); t('5-й неверный — включилась пауза', r.status === 400 && r.data.retryAfter > 0, r);
r = await post('/unlock', { pin: '2468' }, u.tok); t('во время паузы даже верный код отклонён', r.status === 429, r);
await sleep(31000);
r = await post('/unlock', { pin: '2468' }, u.tok); t('после паузы верный код открывает', r.status === 200 && r.data.ok, r);
r = await call('/api/wallet', {}, u.tok, H()); t('после открытия API снова работает', r.status !== 423, r.status);

// 5. устаревший пульс закрывает САМ (без lock от клиента)
r = await post('/ping', {}, u.tok); t('пульс у открытой', r.data.locked === false, r.data);
await sleep(22000);
r = await call('/api/wallet', {}, u.tok, H()); t('нет пульса дольше GRACE — сервер закрыл сам', r.status === 423, r.status);
r = await post('/ping', {}, u.tok); t('пульсом «воскресить» нельзя', r.data.locked === true, r.data);
r = await post('/unlock', { pin: '2468' }, u.tok); t('открыт снова кодом', r.status === 200, r);

// 6. нативная биометрия: только для kind=native
r = await post('/lock', {}, u.tok);
r = await post('/unlock', { method: 'native' }, u.tok); t('web-устройство не принимает «нативную» биометрию', r.status === 403, r);
await post('/unlock', { pin: '2468' }, u.tok);

// 7. биометрия WebAuthn
r = await post('/bio/begin', { pin: '9999' }, u.tok); t('биометрию без верного кода не добавить', r.status === 400, r);
r = await post('/bio/begin', { pin: '2468' }, u.tok); t('bio/begin', r.status === 200 && r.data.publicKey?.challenge, r);
{
  const cose = enc(new Map([[1, 2], [3, -7], [-1, 1], [-2, key.x], [-3, key.y]]));
  const idLen = Buffer.alloc(2); idLen.writeUInt16BE(key.credId.length);
  const ad = Buffer.concat([rpHash, Buffer.from([0x45 | 0x40]), Buffer.alloc(4), Buffer.alloc(16), idLen, key.credId, cose]);
  const att = enc(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]));
  r = await post('/bio/finish', { challengeId: r.data.challengeId, credential: { id: b64u(key.credId), response: { clientDataJSON: b64u(cdata('webauthn.create', r.data.publicKey.challenge)), attestationObject: b64u(att) } } }, u.tok);
  t('bio/finish', r.status === 200 && r.data.ok, r);
}
r = await call('/api/skyid/applock', {}, u.tok, H()); t('статус: биометрия подключена', r.data.bio === true, r.data);
const assert = async (over = {}) => {
  const b = await post('/unlock/begin', {}, u.tok);
  if (b.status !== 200) return { b };
  const cd = cdata('webauthn.get', over.challenge ?? b.data.publicKey.challenge);
  key.counter += over.noBump ? 0 : 1;
  const cnt = Buffer.alloc(4); cnt.writeUInt32BE(over.counter ?? key.counter);
  const ad = Buffer.concat([rpHash, Buffer.from([over.flags ?? 0x05]), cnt]);
  const sig = crypto.sign('sha256', Buffer.concat([ad, crypto.createHash('sha256').update(cd).digest()]), key.privateKey);
  const f = await post('/unlock', { method: 'bio', challengeId: over.challengeId ?? b.data.challengeId, credential: { id: b64u(key.credId), response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(over.badSig ? Buffer.alloc(70, 1) : sig) } } }, u.tok);
  return { b, f };
};
await post('/lock', {}, u.tok);
r = await assert({ badSig: true }); t('поддельная подпись отклонена', r.f.status === 400 && r.f.data.error === 'bad_signature', r.f);
r = await assert({ flags: 0x01 }); t('без подтверждения пользователя (UV) отклонено', r.f.status === 400, r.f);
r = await assert({ challenge: 'AAAA' }); t('чужой вызов отклонён', r.f.status === 400, r.f);
r = await assert(); t('верная подпись открывает', r.f.status === 200 && r.f.data.ok, r.f);
await post('/lock', {}, u.tok);
r = await assert({ noBump: true }); t('повтор счётчика (клонированный ключ) отклонён', r.f.status === 400, r.f);
r = await assert(); t('следующая подпись со свежим счётчиком проходит', r.f.status === 200, r.f);
r = await call('/api/wallet', {}, u.tok, H()); t('после биометрии API работает', r.status !== 423, r.status);
await post('/lock', {}, u.tok);
{ const b = await post('/unlock/begin', {}, u.tok); r = await post('/unlock', { method: 'bio', challengeId: b.data.challengeId, credential: { id: 'x', response: {} } }, u.tok); t('чужой ключ отклонён', r.status === 400, r); }
await post('/unlock', { pin: '2468' }, u.tok);

// 8. сокет: закрытая сессия не получает ничего
{
  const { default: WebSocket } = await import('ws');
  const WS = process.env.WS_URL ?? 'ws://127.0.0.1:8081';
  const open = (tok) => new Promise((res) => { const ws = new WebSocket(WS, { origin: process.env.WS_ORIGIN ?? 'https://sky.test' }); const got = []; ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', payload: { token: tok } }))); ws.on('message', (m) => got.push(JSON.parse(String(m)).type)); ws.on('error', () => {}); ws.on('close', (c) => got.push('close:' + c)); setTimeout(() => res({ ws, got }), 1500); });
  let s = await open(u.tok); t('открытая сессия — сокет авторизован', s.got.includes('authorized'), s.got); 
  await post('/lock', {}, u.tok); await sleep(800);
  t('lock закрывает уже открытый сокет', s.got.includes('applock') && s.got.some((x) => x === 'close:4423'), s.got);
  s = await open(u.tok); t('закрытой сессии сокет не открывается', s.got.includes('applock') && !s.got.includes('authorized'), s.got); s.ws.close();
  await post('/unlock', { pin: '2468' }, u.tok);
}

// 9. выключение и чужие устройства
r = await post('/disable', { pin: '0000' }, u.tok); t('выключить с неверным кодом нельзя', r.status === 400, r);
const o = await mkuser(S, 'alk2'); r = await call('/api/skyid/applock', {}, o.tok, H()); t('у другого Sky ID замка нет', r.data.enabled === false, r.data);
r = await post('/disable', { pin: '2468' }, u.tok); t('выключение с верным кодом', r.status === 200, r);
r = await call('/api/wallet', {}, u.tok, H()); t('после выключения API открыт', r.status !== 423, r.status);
r = await call('/api/skyid/applock', {}, u.tok, H()); t('статус: выключен', r.data.enabled === false, r.data);
console.log(`Итого: ${ok} ok, ${bad} fail`); process.exit(bad ? 1 : 0);
