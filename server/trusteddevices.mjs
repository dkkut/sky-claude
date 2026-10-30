/**
 * Доверенные устройства Sky ID.
 *
 * Устройство становится доверенным, когда на нём вошли по коду (почта/SMS). Клиент носит случайный
 * идентификатор устройства (заголовок X-Sky-Device); в базе — только его хеш. Пропуск кода профиля
 * действует лишь в режимах Car / Console / TV (заголовок X-Sky-Mode) и только у профилей, где
 * владелец сам включил «не спрашивать код на доверенных устройствах».
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';

const MAX_DEVICES = 20;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MODES = new Set(['car', 'console', 'tv']);

const hashOf = (id) => crypto.createHmac('sha256', `${config.jwtSecret}:trusted-device:v1`).update(id).digest('hex');
const rawId = (req) => { const v = String(req?.headers?.['x-sky-device'] ?? ''); return ID_RE.test(v) ? v : null; };
const label = (req) => String(req?.headers?.['user-agent'] ?? '').slice(0, 160);

/** Вход по коду на этом устройстве состоялся — запоминаем его. */
export const trustDevice = async (skyId, req) => {
  const id = rawId(req);
  if (!id) return;
  const h = hashOf(id);
  await query(
    `INSERT INTO sky_trusted_devices (sky_id, device_hash, label) VALUES ($1,$2,$3)
     ON CONFLICT (sky_id, device_hash) DO UPDATE SET last_seen = now(), label = excluded.label`, [skyId, h, label(req)]);
  await query(
    `DELETE FROM sky_trusted_devices WHERE sky_id = $1 AND device_hash NOT IN
       (SELECT device_hash FROM sky_trusted_devices WHERE sky_id = $1 ORDER BY last_seen DESC LIMIT ${MAX_DEVICES})`, [skyId]);
};

/** Можно ли открыть профиль без кода: режим Car/Console/TV + доверенное устройство + включено у профиля. */
export const mayOpenWithoutCode = async (skyId, profileId, req) => {
  if (!MODES.has(String(req?.headers?.['x-sky-mode'] ?? ''))) return false;
  const id = rawId(req);
  if (!id) return false;
  const { rows } = await query(
    `SELECT 1 FROM profiles p JOIN sky_trusted_devices d ON d.sky_id = p.sky_id AND d.device_hash = $3
      WHERE p.sky_id = $1 AND p.id = $2 AND p.skip_code_trusted`, [skyId, profileId, hashOf(id)]);
  if (rows[0]) await query('UPDATE sky_trusted_devices SET last_seen = now() WHERE sky_id = $1 AND device_hash = $2', [skyId, hashOf(id)]);
  return Boolean(rows[0]);
};

/** Это устройство уже доверенное для этого Sky ID (вход по коду состоялся раньше)? */
export const isDeviceTrusted = async (skyId, req) => {
  const id = rawId(req); if (!id) return false;
  return (await query('SELECT 1 FROM sky_trusted_devices WHERE sky_id = $1 AND device_hash = $2', [skyId, hashOf(id)])).rowCount > 0;
};

export const listTrusted = async (skyId, req) => {
  const cur = rawId(req) ? hashOf(rawId(req)) : null;
  const { rows } = await query(
    'SELECT device_hash, label, first_seen, last_seen FROM sky_trusted_devices WHERE sky_id = $1 ORDER BY last_seen DESC', [skyId]);
  return rows.map((r) => ({ id: r.device_hash.slice(0, 16), label: r.label, firstSeen: r.first_seen.toISOString(), lastSeen: r.last_seen.toISOString(), current: r.device_hash === cur }));
};

export const revokeTrusted = async (skyId, shortId) => {
  const { rowCount } = await query('DELETE FROM sky_trusted_devices WHERE sky_id = $1 AND left(device_hash, 16) = $2', [skyId, String(shortId ?? '')]);
  return rowCount > 0;
};

export const setSkipFlag = async (skyId, profileId, on) => {
  const { rowCount } = await query('UPDATE profiles SET skip_code_trusted = $3 WHERE sky_id = $1 AND id = $2', [skyId, profileId, Boolean(on)]);
  return rowCount > 0;
};
