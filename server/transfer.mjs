/**
 * Sky Transfer — передача файлов между устройствами одного Sky ID.
 *
 * Как это устроено на самом деле (без прикрас): файл НЕ идёт напрямую между устройствами. Отправитель режет его на куски
 * (до 4 МБ), считает SHA-256 каждого и загружает на сервер; получатель скачивает куски и проверяет каждый по хешу.
 * Куски лежат на диске сервера зашифрованными (mediacrypto, ключ сервера) — это шифрование «на диске» и TLS в пути,
 * НЕ сквозное: сервер технически способен расшифровать. После получения / отмены / срока файлы удаляются.
 *
 *  • Устройство — запись `transfer_devices` по заголовку X-Sky-Device. Первое устройство Sky ID подтверждено сразу, каждое следующее
 *    ждёт подтверждения с уже подтверждённого устройства; незнакомое устройство ничего не получает и не отправляет.
 *  • Возобновление: куски нумерованы, `status` отдаёт уже принятые; повторная загрузка того же куска безвредна.
 *  • Только свои устройства (чужим людям и «контактам» отправить нельзя — этого в Sky Transfer нет).
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { logEvent as skyLog } from './skylog.mjs';
import { pushGoEvent } from './signal.mjs';
import { saveChunk, openChunk, chunkSize, removeChunk } from './transferstore.mjs';

const env = (k, d) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
export const LIMITS = {
  maxFileBytes: env('TRANSFER_MAX_MB', 100) * 1024 * 1024,
  minChunk: 256 * 1024, maxChunk: 4 * 1024 * 1024,
  maxActive: env('TRANSFER_MAX_ACTIVE', 10),
  maxActiveBytes: env('TRANSFER_MAX_ACTIVE_MB', 500) * 1024 * 1024,
  uploadTtlH: env('TRANSFER_UPLOAD_TTL_H', 6),     // незавершённая загрузка
  readyTtlH: env('TRANSFER_READY_TTL_H', 24),      // готово, получатель не забрал
  onlineSec: 70,
};
const BLOCKED_EXT = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'vbs', 'vbe', 'wsf', 'wsh', 'ps1', 'jar', 'dll', 'lnk', 'sys', 'reg', 'hta', 'cpl']);
const KINDS = new Set(['phone', 'desktop', 'web', 'tv', 'car', 'other']);
const CANT_RECEIVE = new Set(['tv', 'car']);   // на ТВ и в машине сохранить файл некуда — честно не предлагаем
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const err = (error, extra = {}) => ({ error, ...extra });
const newId = (p) => `${p}-${crypto.randomUUID()}`;

const hashOf = (id) => crypto.createHmac('sha256', `${config.jwtSecret}:transfer-device:v1`).update(id).digest('hex');
export const deviceHash = (req) => { const v = String(req?.headers?.['x-sky-device'] ?? ''); return ID_RE.test(v) ? hashOf(v) : null; };
export const profilesOf = async (skyId) => (await query('SELECT id FROM profiles WHERE sky_id = $1 AND deleted_at IS NULL', [skyId])).rows.map((r) => r.id);
const tell = async (skyId, msg) => { try { pushGoEvent(await profilesOf(skyId), msg); } catch { /* сокет необязателен */ } };
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);

/* ── Устройства ── */
const devView = (d, meId) => ({
  id: d.id, name: d.name, kind: d.kind, status: d.status, canReceive: d.can_receive && !CANT_RECEIVE.has(d.kind),
  online: d.status === 'approved' && Date.now() - new Date(d.last_seen).getTime() < LIMITS.onlineSec * 1000, current: d.id === meId,
  createdAt: d.created_at.toISOString(),
});
export const myDevice = async (skyId, req) => {
  const h = deviceHash(req); if (!h) return null;
  return (await query('SELECT * FROM transfer_devices WHERE sky_id = $1 AND device_hash = $2', [skyId, h])).rows[0] ?? null;
};

/** Регистрация / повторный вход устройства. Первое устройство Sky ID подтверждено сразу, остальные — ждут. */
export const registerDevice = async (skyId, req, { name, kind, trusted = false }) => {
  const h = deviceHash(req); if (!h) return err('no_device');
  const k = KINDS.has(kind) ? kind : 'web';
  const nm = cleanName(name).slice(0, 60) || 'Устройство';
  const cur = await myDevice(skyId, req);
  if (cur) {
    if (cur.status === 'revoked') return err('device_revoked');
    await query('UPDATE transfer_devices SET last_seen = now(), name = $2, kind = $3 WHERE id = $1', [cur.id, nm, k]);
    return { ok: true, id: cur.id, status: cur.status };
  }
  const id = newId('dev');
  // Первое устройство (нет ни одного подтверждённого) подтверждается само; проверка и вставка — под замком Sky ID (гонка двух первых).
  const r = await query(`WITH lock AS (SELECT pg_advisory_xact_lock(hashtext($2)))
      INSERT INTO transfer_devices (id, sky_id, device_hash, name, kind, can_receive, status)
      SELECT $1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN 'approved' WHEN EXISTS (SELECT 1 FROM transfer_devices WHERE sky_id = $2 AND status = 'approved') THEN 'pending' ELSE 'approved' END FROM lock
      ON CONFLICT (sky_id, device_hash) DO NOTHING RETURNING status`, [id, skyId, h, nm, k, !CANT_RECEIVE.has(k), !!trusted]).catch(() => ({ rows: [] }));
  const row = r.rows[0] ?? (await myDevice(skyId, req)) ;
  const status = row?.status ?? 'pending';
  if (status === 'pending') await tell(skyId, { type: 'transfer:device', payload: { id } });
  skyLog({ category: 'security', service: 'transfer', type: 'device_registered', targetId: skyId, detail: { status, kind: k } });
  return { ok: true, id: row?.id ?? id, status };
};

export const heartbeat = async (skyId, req) => {
  const d = await myDevice(skyId, req);
  if (!d || d.status === 'revoked') return err('unknown_device');
  await query('UPDATE transfer_devices SET last_seen = now() WHERE id = $1', [d.id]);
  return { ok: true, status: d.status };
};

const needApproved = async (skyId, req) => {
  const d = await myDevice(skyId, req);
  if (!d) return { bad: err('unknown_device') };
  if (d.status !== 'approved') return { bad: err('device_not_approved') };
  return { d };
};

export const approveDevice = async (skyId, req, targetId) => {
  const { d, bad } = await needApproved(skyId, req); if (bad) return bad;
  if (d.id === targetId) return err('cannot_approve_self');
  const up = await query(`UPDATE transfer_devices SET status = 'approved', approved_by = $3 WHERE id = $1 AND sky_id = $2 AND status = 'pending' RETURNING id`, [targetId, skyId, d.id]);
  if (!up.rows[0]) return err('not_found');
  skyLog({ category: 'security', service: 'transfer', type: 'device_approved', targetId: skyId });
  await tell(skyId, { type: 'transfer:device', payload: { id: targetId } });
  return { ok: true };
};

/** Удалить/отклонить устройство: отменяет его активные передачи и стирает их файлы. */
export const removeDevice = async (skyId, req, targetId) => {
  const { d, bad } = await needApproved(skyId, req); if (bad) return bad;
  const t = (await query('SELECT * FROM transfer_devices WHERE id = $1 AND sky_id = $2', [targetId, skyId])).rows[0];
  if (!t) return err('not_found');
  if (t.id === d.id) return err('cannot_remove_self');
  await query(`UPDATE transfer_devices SET status = 'revoked' WHERE id = $1`, [t.id]);
  const live = (await query(`SELECT id FROM transfers WHERE (from_device = $1 OR to_device = $1) AND status IN ('uploading','ready','awaiting_accept','downloading')`, [t.id])).rows;
  for (const x of live) await finish(x.id, 'cancelled', 'device_removed');
  skyLog({ category: 'security', service: 'transfer', type: 'device_removed', targetId: skyId });
  return { ok: true };
};

export const renameDevice = async (skyId, req, targetId, name) => {
  const { bad } = await needApproved(skyId, req); if (bad) return bad;
  const nm = cleanName(name).slice(0, 60); if (!nm) return err('invalid_name');
  const up = await query('UPDATE transfer_devices SET name = $3 WHERE id = $1 AND sky_id = $2 RETURNING id', [targetId, skyId, nm]);
  return up.rows[0] ? { ok: true } : err('not_found');
};

/* ── Настройки ── */
const prefsView = (p) => ({ accept: p?.accept ?? 'own', confirm: p?.confirm ?? false, keepHours: p?.keep_hours ?? 0, historyDays: p?.history_days ?? 30 });
export const getPrefs = async (skyId) => prefsView((await query('SELECT * FROM transfer_prefs WHERE sky_id = $1', [skyId])).rows[0]);
export const setPrefs = async (skyId, b) => {
  const cur = await getPrefs(skyId);
  const next = {
    accept: ['own', 'off'].includes(b.accept) ? b.accept : cur.accept,
    confirm: typeof b.confirm === 'boolean' ? b.confirm : cur.confirm,
    keepHours: [0, 1, 24, 72].includes(Number(b.keepHours)) ? Number(b.keepHours) : cur.keepHours,
    historyDays: [0, 7, 30, 90].includes(Number(b.historyDays)) ? Number(b.historyDays) : cur.historyDays,
  };
  await query(`INSERT INTO transfer_prefs (sky_id, accept, confirm, keep_hours, history_days) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (sky_id) DO UPDATE SET accept = $2, confirm = $3, keep_hours = $4, history_days = $5, updated_at = now()`, [skyId, next.accept, next.confirm, next.keepHours, next.historyDays]);
  return next;
};

/* ── Передачи ── */
const ACTIVE = ['uploading', 'ready', 'awaiting_accept', 'downloading'];
const view = (t, meId) => ({
  id: t.id, name: t.name, size: Number(t.size), mime: t.mime, chunks: t.chunks, chunkSize: t.chunk_size, status: t.status, error: t.error,
  from: t.from_device, to: t.to_device, direction: t.from_device === meId ? 'out' : 'in',
  bytesUp: Number(t.bytes_up), bytesDown: Number(t.bytes_down), createdAt: t.created_at.toISOString(), updatedAt: t.updated_at.toISOString(),
  expiresAt: t.expires_at.toISOString(), finishedAt: t.finished_at?.toISOString() ?? null, filesGone: t.files_gone,
});

/** Закрыть передачу: статус, удаление файлов (если это не «хранить N часов» после успешной доставки). */
const finish = async (id, status, error = null) => {
  const up = await query(`UPDATE transfers SET status = $2, error = $3, finished_at = now(), updated_at = now() WHERE id = $1 AND status = ANY($4) RETURNING *`, [id, status, error, ACTIVE]);
  const t = up.rows[0]; if (!t) return null;
  await dropFiles(t.id);
  return t;
};
const dropFiles = async (id) => {
  const { rows } = await query('SELECT idx FROM transfer_chunks WHERE transfer_id = $1', [id]);
  for (const r of rows) await removeChunk(id, r.idx).catch(() => {});
  await query('DELETE FROM transfer_chunks WHERE transfer_id = $1', [id]);
  await query('UPDATE transfers SET files_gone = TRUE WHERE id = $1', [id]);
};

export const overview = async (skyId, req) => {
  const me = await myDevice(skyId, req);
  const devices = (await query(`SELECT * FROM transfer_devices WHERE sky_id = $1 AND status <> 'revoked' ORDER BY created_at`, [skyId])).rows.map((d) => devHide(devView(d, me?.id)));
  const rows = (await query(`SELECT * FROM transfers WHERE sky_id = $1 ORDER BY created_at DESC LIMIT 60`, [skyId])).rows;
  return {
    device: me ? devView(me, me.id) : null, devices, prefs: await getPrefs(skyId),
    active: rows.filter((t) => ACTIVE.includes(t.status)).map((t) => view(t, me?.id)),
    history: rows.filter((t) => !ACTIVE.includes(t.status)).map((t) => view(t, me?.id)),
    limits: { maxFileBytes: LIMITS.maxFileBytes, minChunk: LIMITS.minChunk, maxChunk: LIMITS.maxChunk, blockedExt: [...BLOCKED_EXT] },
  };
};
const devHide = (d) => d;

export const createTransfer = async (skyId, req, b) => {
  const { d: from, bad } = await needApproved(skyId, req); if (bad) return bad;
  const prefs = await getPrefs(skyId);
  const to = (await query('SELECT * FROM transfer_devices WHERE id = $1 AND sky_id = $2', [String(b.toDevice ?? ''), skyId])).rows[0];
  if (!to || to.status !== 'approved') return err('recipient_not_trusted');
  if (to.id === from.id) return err('same_device');
  if (!to.can_receive || CANT_RECEIVE.has(to.kind)) return err('recipient_cannot_receive');
  if (prefs.accept === 'off') return err('transfers_disabled');
  const name = cleanName(b.name); if (!name) return err('invalid_name');
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (name.includes('.') && BLOCKED_EXT.has(ext)) return err('type_not_allowed', { ext });
  const size = Number(b.size);
  if (!Number.isInteger(size) || size <= 0) return err('invalid_size');
  if (size > LIMITS.maxFileBytes) return err('file_too_large', { max: LIMITS.maxFileBytes });
  const cs = Number(b.chunkSize);
  if (!Number.isInteger(cs) || cs < LIMITS.minChunk || cs > LIMITS.maxChunk) return err('invalid_chunk_size');
  const hashes = Array.isArray(b.hashes) ? b.hashes.map((h) => String(h).toLowerCase()) : [];
  const chunks = Math.ceil(size / cs);
  if (hashes.length !== chunks || !hashes.every((h) => HASH_RE.test(h))) return err('invalid_hashes');
  const digest = crypto.createHash('sha256').update(hashes.join('')).digest('hex');
  const id = newId('xfr');
  const mime = String(b.mime ?? '').replace(/[^\w.+\-/]/g, '').slice(0, 100);
  // Лимиты активных передач — в одном запросе с вставкой под замком Sky ID (параллельные «отправить» не обходят предел).
  const ins = await query(`WITH lock AS (SELECT pg_advisory_xact_lock(hashtext($2)))
      INSERT INTO transfers (id, sky_id, from_device, to_device, name, size, mime, chunk_size, chunks, hashes, digest, expires_at)
      SELECT $1,$2,$3,$4,$5,$6::bigint,$7,$8::int,$9::int,$10::jsonb,$11, now() + ($12 || ' hours')::interval FROM lock
       WHERE (SELECT count(*) FROM transfers WHERE sky_id = $2 AND status = ANY($13)) < $14::int
         AND COALESCE((SELECT sum(size) FROM transfers WHERE sky_id = $2 AND status = ANY($13)), 0) + $6::bigint <= $15::bigint
      RETURNING *`, [id, skyId, from.id, to.id, name, size, mime, cs, chunks, JSON.stringify(hashes), digest, String(LIMITS.uploadTtlH), ACTIVE, LIMITS.maxActive, LIMITS.maxActiveBytes]);
  if (!ins.rows[0]) return err('too_many_active');
  skyLog({ category: 'user', service: 'transfer', type: 'transfer_created', targetId: skyId, detail: { size, chunks } });
  return { ok: true, transfer: view(ins.rows[0], from.id) };
};

/** Передача, к которой есть доступ у ЭТОГО устройства (отправитель или получатель) и этого Sky ID. */
const mine = async (skyId, req, id, role) => {
  const { d, bad } = await needApproved(skyId, req); if (bad) return { bad };
  if (!/^xfr-[0-9a-f-]{36}$/.test(String(id))) return { bad: err('not_found') };
  const t = (await query('SELECT * FROM transfers WHERE id = $1 AND sky_id = $2', [id, skyId])).rows[0];
  if (!t) return { bad: err('not_found') };
  const isFrom = t.from_device === d.id, isTo = t.to_device === d.id;
  if (role === 'from' ? !isFrom : role === 'to' ? !isTo : !(isFrom || isTo)) return { bad: err('not_found') };
  return { t, d };
};

export const statusOf = async (skyId, req, id) => {
  const { t, d, bad } = await mine(skyId, req, id); if (bad) return bad;
  const got = (await query('SELECT idx FROM transfer_chunks WHERE transfer_id = $1 ORDER BY idx', [t.id])).rows.map((r) => r.idx);
  return { transfer: view(t, d.id), received: got, hashes: t.hashes, digest: t.digest };
};

export const putChunk = async (skyId, req, id, idx, buf) => {
  const { t, d, bad } = await mine(skyId, req, id, 'from'); if (bad) return bad;
  if (t.status !== 'uploading') return err('not_uploading', { status: t.status });
  const n = Number(idx);
  if (!Number.isInteger(n) || n < 0 || n >= t.chunks) return err('bad_chunk');
  const expectLen = n === t.chunks - 1 ? Number(t.size) - t.chunk_size * (t.chunks - 1) : t.chunk_size;
  if (buf.length !== expectLen) return err('bad_chunk_size', { expected: expectLen });
  if (crypto.createHash('sha256').update(buf).digest('hex') !== t.hashes[n]) return err('hash_mismatch');
  const had = (await query('SELECT 1 FROM transfer_chunks WHERE transfer_id = $1 AND idx = $2', [t.id, n])).rowCount > 0;
  if (!had) {
    const sv = await saveChunk(t.id, n, buf).catch((e) => ({ error: e?.code || 'storage_failed' }));
    if (sv?.error) return err('storage_unavailable');
    const ins = await query('INSERT INTO transfer_chunks (transfer_id, idx, bytes) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING idx', [t.id, n, buf.length]);
    if (ins.rows[0]) await query('UPDATE transfers SET bytes_up = bytes_up + $2, updated_at = now(), expires_at = now() + ($3 || \' hours\')::interval WHERE id = $1 AND status = \'uploading\'', [t.id, buf.length, String(LIMITS.uploadTtlH)]);
  }
  const have = Number((await query('SELECT count(*) AS n FROM transfer_chunks WHERE transfer_id = $1', [t.id])).rows[0].n);
  if (have === t.chunks) {
    const prefs = await getPrefs(skyId);
    const next = prefs.confirm ? 'awaiting_accept' : 'ready';
    const up = await query(`UPDATE transfers SET status = $2, updated_at = now(), expires_at = now() + ($3 || ' hours')::interval WHERE id = $1 AND status = 'uploading' RETURNING id`, [t.id, next, String(LIMITS.readyTtlH)]);
    if (up.rows[0]) await tell(skyId, { type: 'transfer:incoming', payload: { id: t.id, to: t.to_device, name: t.name } });
  }
  return { ok: true, received: have };
};

export const accept = async (skyId, req, id) => {
  const { t, bad } = await mine(skyId, req, id, 'to'); if (bad) return bad;
  const up = await query(`UPDATE transfers SET status = 'ready', updated_at = now() WHERE id = $1 AND status = 'awaiting_accept' RETURNING id`, [t.id]);
  return up.rows[0] || t.status === 'ready' || t.status === 'downloading' ? { ok: true } : err('bad_state', { status: t.status });
};
export const reject = async (skyId, req, id) => {
  const { t, bad } = await mine(skyId, req, id, 'to'); if (bad) return bad;
  const r = await finish(t.id, 'rejected', 'rejected_by_recipient');
  if (r) await tell(skyId, { type: 'transfer:update', payload: { id: t.id } });
  return r ? { ok: true } : err('bad_state', { status: t.status });
};
export const cancel = async (skyId, req, id) => {
  const { t, bad } = await mine(skyId, req, id); if (bad) return bad;
  const r = await finish(t.id, 'cancelled', 'cancelled');
  if (r) await tell(skyId, { type: 'transfer:update', payload: { id: t.id } });
  return r ? { ok: true } : err('bad_state', { status: t.status });
};

/** Скачивание куска получателем: только после готовности (и подтверждения, если оно включено). */
export const openForDownload = async (skyId, req, id, idx) => {
  const { t, bad } = await mine(skyId, req, id, 'to'); if (bad) return bad;
  if (!['ready', 'downloading'].includes(t.status) && !(t.status === 'delivered' && !t.files_gone)) return err(t.status === 'awaiting_accept' ? 'awaiting_accept' : 'not_ready', { status: t.status });
  const n = Number(idx);
  if (!Number.isInteger(n) || n < 0 || n >= t.chunks) return err('bad_chunk');
  const size = await chunkSize(t.id, n);
  if (size === null) return err('chunk_missing');
  if (t.status === 'ready') await query(`UPDATE transfers SET status = 'downloading', updated_at = now() WHERE id = $1 AND status = 'ready'`, [t.id]);
  return { size, stream: openChunk(t.id, n), hash: t.hashes[n], t, n };
};
export const noteDownloaded = (id, bytes) => query(`UPDATE transfers SET bytes_down = LEAST(size, bytes_down + $2), updated_at = now() WHERE id = $1`, [id, bytes]).catch(() => {});

/** Получатель проверил все куски по хешам и присылает итоговый digest — только тогда передача считается доставленной. */
export const complete = async (skyId, req, id, digest) => {
  const { t, bad } = await mine(skyId, req, id, 'to'); if (bad) return bad;
  if (t.status === 'delivered') return { ok: true, duplicate: true };
  if (!['ready', 'downloading'].includes(t.status)) return err('bad_state', { status: t.status });
  if (String(digest ?? '').toLowerCase() !== t.digest) {
    await finish(t.id, 'failed', 'integrity'); await tell(skyId, { type: 'transfer:update', payload: { id: t.id } });
    return err('integrity_failed');
  }
  const prefs = await getPrefs(skyId);
  const up = await query(`UPDATE transfers SET status = 'delivered', finished_at = now(), updated_at = now(), bytes_down = size,
      expires_at = now() + ($2 || ' hours')::interval WHERE id = $1 AND status IN ('ready','downloading') RETURNING id`, [t.id, String(Math.max(prefs.keepHours, 0))]);
  if (!up.rows[0]) return err('bad_state');
  if (prefs.keepHours === 0) await dropFiles(t.id);
  skyLog({ category: 'user', service: 'transfer', type: 'transfer_delivered', targetId: skyId, detail: { size: Number(t.size) } });
  await tell(skyId, { type: 'transfer:update', payload: { id: t.id } });
  return { ok: true };
};

/** Получатель/отправитель отмечает ошибку (обрыв, битый кусок): передача закрывается, файлы удаляются. */
export const fail = async (skyId, req, id, reason) => {
  const { t, bad } = await mine(skyId, req, id); if (bad) return bad;
  const r = await finish(t.id, 'failed', String(reason ?? 'failed').replace(/[^\w ._-]/g, '').slice(0, 60) || 'failed');
  return r ? { ok: true } : err('bad_state', { status: t.status });
};

export const deleteRecord = async (skyId, req, id) => {
  const { t, bad } = await mine(skyId, req, id); if (bad) return bad;
  if (ACTIVE.includes(t.status)) return err('still_active');
  await dropFiles(t.id);
  await query('DELETE FROM transfers WHERE id = $1', [t.id]);
  return { ok: true };
};
export const clearHistory = async (skyId, req) => {
  const { bad } = await needApproved(skyId, req); if (bad) return bad;
  const rows = (await query('SELECT id FROM transfers WHERE sky_id = $1 AND NOT (status = ANY($2))', [skyId, ACTIVE])).rows;
  for (const r of rows) { await dropFiles(r.id); }
  await query('DELETE FROM transfers WHERE sky_id = $1 AND NOT (status = ANY($2))', [skyId, ACTIVE]);
  return { ok: true, removed: rows.length };
};

/** Уборка: просроченные передачи, файлы доставленных после срока хранения, старая история. Вызывается из часовой уборки сервера. */
export const sweepTransfers = async () => {
  let expired = 0, dropped = 0, history = 0;
  for (const r of (await query(`SELECT id FROM transfers WHERE status = ANY($1) AND expires_at < now()`, [ACTIVE])).rows) { if (await finish(r.id, 'expired', 'expired')) expired++; }
  for (const r of (await query(`SELECT id FROM transfers WHERE status = 'delivered' AND NOT files_gone AND expires_at < now()`)).rows) { await dropFiles(r.id); dropped++; }
  const old = (await query(`SELECT t.id FROM transfers t LEFT JOIN transfer_prefs p ON p.sky_id = t.sky_id
      WHERE NOT (t.status = ANY($1)) AND t.finished_at < now() - (COALESCE(p.history_days, 30) || ' days')::interval`, [ACTIVE])).rows;
  for (const r of old) { await dropFiles(r.id); await query('DELETE FROM transfers WHERE id = $1', [r.id]); history++; }
  // Устройства, которых не видели 180 дней, перестают считаться подтверждёнными.
  await query(`UPDATE transfer_devices SET status = 'revoked' WHERE last_seen < now() - interval '180 days' AND status <> 'revoked'`);
  return { expired, dropped, history };
};
