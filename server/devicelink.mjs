/**
 * Вход на устройстве без клавиатуры (ТВ, консоль, машина) через телефон.
 *
 *  1. Устройство просит запрос (`start`) и получает код подключения (он же внутри QR), проверочное
 *     число и свой секретный ключ опроса. Код и ключ хранятся только хешами.
 *  2. Телефон, где человек уже вошёл, читает QR или принимает набранный код (`lookup`) и видит всё,
 *     что известно об устройстве: тип, система и браузер, адрес, время запроса.
 *  3. Подтверждение (`decide`) требует ввести проверочное число с экрана устройства (защита от
 *     чужого QR, показанного вам под видом своего) и, если у человека включён аутентификатор, его код.
 *  4. Устройство опрашивает `poll`; сессия выдаётся ОДИН раз, тем же путём, что и обычный вход.
 *
 * Запрос живёт 10 минут. Три неверных проверочных числа — запрос гаснет. Подтвердить за другого
 * нельзя: сессия выдаётся тому, чей телефон подтвердил. Ничего не пишется в журналы в открытом виде.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { decryptSecret } from './crypto.mjs';
import { verifyTotp } from './totp.mjs';
import { generateId } from './security.mjs';
import { ipMask, ipFp } from './ipmask.mjs';

const TTL_MIN = 10;
const VERIFY_ATTEMPTS = 3;
const KINDS = new Set(['tv', 'console', 'car', 'other']);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const hash = (kind, v) => crypto.createHash('sha256').update(`${config.jwtSecret}:device-link:${kind}:v1:${v}`).digest('hex');
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const sameHex = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const normalizeCode = (raw) => {
  // В алфавите нет 0/1/O/I/L — их путают, поэтому они и не выдаются; всё лишнее (дефис, пробел) отбрасываем.
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 && [...s].every((c) => ALPHABET.includes(c)) ? s : '';
};
const newCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
export const fmtCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;

/** Что говорит о себе устройство, разобрано из User-Agent на сервере: сам заголовок подделать можно, но это лучшее, что есть. */
export const describeUa = (ua) => {
  const s = String(ua ?? '');
  const has = (re) => re.test(s);
  let model = '';
  if (has(/PlayStation 5|PS5/i)) model = 'PlayStation 5';
  else if (has(/PlayStation 4|PS4/i)) model = 'PlayStation 4';
  else if (has(/Xbox/i)) model = 'Xbox';
  else if (has(/Nintendo Switch/i)) model = 'Nintendo Switch';
  else if (has(/Steam ?Deck|SteamOS/i)) model = 'Steam Deck';
  else if (has(/Tizen/i)) model = 'Samsung Smart TV (Tizen)';
  else if (has(/Web0S|webOS/i)) model = 'LG Smart TV (webOS)';
  else if (has(/Android TV|AFTM|BRAVIA|SmartTV|Smart-TV|HbbTV/i)) model = 'Smart TV';
  else if (has(/CarPlay|Android Auto|Automotive/i)) model = 'Автомобиль';
  let os = '';
  if (has(/Windows NT/i)) os = 'Windows';
  else if (has(/Android/i)) os = 'Android';
  else if (has(/iPhone|iPad|iOS/i)) os = 'iOS';
  else if (has(/Mac OS X|Macintosh/i)) os = 'macOS';
  else if (has(/CrOS/i)) os = 'ChromeOS';
  else if (has(/Linux|X11/i)) os = 'Linux';
  let browser = '';
  if (has(/Edg(e|A|iOS)?\//i)) browser = 'Edge';
  else if (has(/OPR\/|Opera/i)) browser = 'Opera';
  else if (has(/Firefox\//i)) browser = 'Firefox';
  else if (has(/Chrome\/|CriOS/i)) browser = 'Chrome';
  else if (has(/Safari\//i)) browser = 'Safari';
  else if (has(/Electron\//i)) browser = 'Electron';
  return { model, os, browser };
};

const publicView = (r) => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  ...describeUa(r.ua),
  ua: r.ua,
  ip: r.ip,
  lang: r.lang,
  app: r.app,
  requestedAt: new Date(r.created_at).toISOString(),
  expiresAt: new Date(r.expires_at).toISOString(),
  status: r.status,
});

/** Устройство просит код. */
export const startLink = async ({ kind, label, lang, app }, { ip, ua }) => {
  const id = generateId();
  const code = newCode();
  const pollKey = crypto.randomBytes(24).toString('base64url');
  const verify = String(crypto.randomInt(0, 100)).padStart(2, '0');
  const k = KINDS.has(kind) ? kind : 'other';
  await query(
    `INSERT INTO device_links (id, code_hash, poll_hash, verify_hash, kind, label, ua, ip, ip_fp, lang, app, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + ($12 || ' minutes')::interval)`,
    [id, hash('code', code), hash('poll', pollKey), hash('verify', `${id}:${verify}`), k, clip(label, 60),
      clip(ua, 300), ipMask(ip, 100), ipFp(ip), clip(lang, 8), Boolean(app), String(TTL_MIN)],
  );
  return { id, code: fmtCode(code), codeRaw: code, pollKey, verify, expiresIn: TTL_MIN * 60, kind: k };
};

const byCode = async (code) => {
  const c = normalizeCode(code);
  if (!c) return null;
  const { rows } = await query(
    `SELECT * FROM device_links WHERE code_hash = $1 AND status = 'pending' AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`, [hash('code', c)]);
  return rows[0] ?? null;
};

/** Телефон смотрит, что за устройство просит вход. Само по себе ничего не разрешает. */
export const lookupLink = async (skyId, code) => {
  const row = await byCode(code);
  if (!row) return { error: 'not_found' };
  await query('UPDATE device_links SET sky_id = COALESCE(sky_id, $2) WHERE id = $1', [row.id, skyId]);
  return { ok: true, device: publicView(row) };
};

const hasTotp = (r) => Boolean(r?.two_factor_enabled && (r.two_factor_method ?? 'app') === 'app' && r.two_factor_secret);

/** Нужен ли человеку код аутентификатора, чтобы подтвердить вход на другом устройстве. */
export const needsTotp = async (skyId) => {
  const { rows } = await query('SELECT two_factor_enabled, two_factor_method, two_factor_secret FROM sky_ids WHERE id = $1', [skyId]);
  return hasTotp(rows[0]);
};

/** Решение с телефона: разрешить или отклонить. */
export const decideLink = async (skyId, sid, ip, { id, approve, verify, totp }) => {
  const { rows } = await query('SELECT * FROM device_links WHERE id = $1', [String(id ?? '')]);
  const row = rows[0];
  if (!row || row.status !== 'pending' || new Date(row.expires_at) <= new Date()) return { error: 'not_found' };
  if (!approve) {
    await query(`UPDATE device_links SET status='denied', sky_id=$2, decided_sid=$3, decided_ip=$4, decided_ip_fp=$5, decided_at=now()
                  WHERE id=$1 AND status='pending'`, [row.id, skyId, sid, ipMask(ip, 100), ipFp(ip)]);
    return { ok: true, status: 'denied' };
  }
  if (!/^\d{2}$/.test(String(verify ?? ''))) return { error: 'bad_verify' };
  const sec = (await query('SELECT two_factor_enabled, two_factor_method, two_factor_secret FROM sky_ids WHERE id=$1', [skyId])).rows[0];
  if (hasTotp(sec)) {
    const r = sec;
    const code = String(totp ?? '').replace(/\s+/g, '');
    if (!code) return { error: 'totp_required' };
    let secret = '';
    try { secret = decryptSecret(r.two_factor_secret); } catch { /* ниже откажем */ }
    if (!secret || !verifyTotp(secret, code)) return { error: 'bad_code' };
  }
  if (!sameHex(row.verify_hash, hash('verify', `${row.id}:${verify}`))) {
    const u = await query(
      `UPDATE device_links SET attempts = attempts + 1,
              status = CASE WHEN attempts + 1 >= $2 THEN 'exhausted' ELSE status END
        WHERE id = $1 AND status = 'pending' RETURNING attempts, status`, [row.id, VERIFY_ATTEMPTS]);
    const left = Math.max(0, VERIFY_ATTEMPTS - (u.rows[0]?.attempts ?? VERIFY_ATTEMPTS));
    return { error: left === 0 ? 'exhausted' : 'wrong_verify', attemptsLeft: left };
  }
  const u = await query(
    `UPDATE device_links SET status='approved', sky_id=$2, decided_sid=$3, decided_ip=$4, decided_ip_fp=$5, decided_at=now()
      WHERE id=$1 AND status='pending' AND expires_at > now()`, [row.id, skyId, sid, ipMask(ip, 100), ipFp(ip)]);
  return u.rowCount ? { ok: true, status: 'approved' } : { error: 'not_found' };
};

/** Опрос с устройства. Выдача сессии — один раз: статус `approved` атомарно становится `consumed`. */
export const pollLink = async ({ id, pollKey }) => {
  const { rows } = await query('SELECT * FROM device_links WHERE id = $1', [String(id ?? '')]);
  const row = rows[0];
  if (!row || !sameHex(row.poll_hash, hash('poll', String(pollKey ?? '')))) return { error: 'not_found' };
  if (row.status === 'pending') {
    if (new Date(row.expires_at) <= new Date()) return { status: 'expired' };
    return { status: 'pending', scanned: Boolean(row.sky_id) };
  }
  if (row.status === 'approved') {
    if (new Date(row.expires_at) <= new Date()) return { status: 'expired' };
    const u = await query(`UPDATE device_links SET status='consumed', consumed_at=now() WHERE id=$1 AND status='approved' RETURNING sky_id`, [row.id]);
    if (!u.rowCount) return { status: 'consumed' };
    return { status: 'approved', skyId: u.rows[0].sky_id, row };
  }
  return { status: row.status };
};

export const cancelLink = async ({ id, pollKey }) => {
  const { rows } = await query('SELECT poll_hash FROM device_links WHERE id = $1', [String(id ?? '')]);
  if (!rows[0] || !sameHex(rows[0].poll_hash, hash('poll', String(pollKey ?? '')))) return { error: 'not_found' };
  await query(`UPDATE device_links SET status='cancelled' WHERE id=$1 AND status IN ('pending','approved')`, [id]);
  return { ok: true };
};

/** Последние привязки человека: что подтверждал и что отклонил. */
export const linkHistory = async (skyId) => {
  const { rows } = await query(
    `SELECT * FROM device_links WHERE sky_id = $1 AND status IN ('approved','consumed','denied','exhausted')
      ORDER BY created_at DESC LIMIT 20`, [skyId]);
  return rows.map((r) => ({ ...publicView(r), decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null, signedIn: r.status === 'consumed' }));
};

export const sweepDeviceLinks = async () => {
  await query(`UPDATE device_links SET status='cancelled' WHERE status IN ('pending','approved') AND expires_at < now() - interval '1 hour'`);
  await query(`DELETE FROM device_links WHERE created_at < now() - interval '90 days'`);
};
