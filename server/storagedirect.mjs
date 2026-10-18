/**
 * Sky Storage: прямой доступ к хранилищу (консоль/клиент S3) ТОЛЬКО после подтверждения владельцем — как вход по SSH.
 * Настоящие ключи хостера знает один сервер Sky (STORAGE_S3_*). Человеку выдаётся временная пара ключей для S3-шлюза Sky
 * (/api/storage/s3, server/routes/storagedirect.mjs), которая действует N минут и отзывается кнопкой.
 *   запрос (право storage_direct или владелец) → письмо владельцу со ссылкой → страница /storage-verify + код подтверждения
 *   личности (аутентификатор/почта) → выдача ключей ОДИН раз запросившему → шлюз проверяет подпись, срок и режим.
 * Молчание — не согласие: просроченный запрос ключей не даёт. Секрет ключа лежит зашифрованным и стирается после срока.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { sendEmail } from './notify.mjs';
import { can, isOwner } from './admin.mjs';
import { beginStepUp, consumeStepUp, logAdmin } from './adminsec.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { ownerIds, notifyOwners, logEvent, newId, snapshot } from './skystoragestate.mjs';

export const STEP_PURPOSE = 'storage_direct';
export const TOKEN_PREFIX = 'dx_';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const origin = () => config.publicOrigin || '';
const WAIT_MIN = 10;
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export const gatewayEndpoint = () => `${origin()}/api/storage/s3`;

const view = (r) => ({ id: r.id, scope: r.scope, minutes: r.minutes, note: r.note, status: r.status, createdAt: r.created_at, expiresAt: r.expires_at, approvedAt: r.approved_at, accessUntil: r.access_until, secretShown: Boolean(r.secret_shown_at), requester: r.username });

const mailOwner = async (r, token) => {
  const link = `${origin()}/storage-verify?t=${token}`;
  const owners = await query('SELECT s.email, s.email_verified FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE p.id = ANY($1::text[])', [await ownerIds()]);
  const who = (await query('SELECT username FROM profiles WHERE id=$1', [r.requester_id])).rows[0]?.username ?? '—';
  for (const o of owners.rows) {
    if (!o.email || !o.email_verified) continue;
    await sendEmail(o.email, 'Sky Storage: запрос ПРЯМОГО доступа к хранилищу',
      `Запрошен прямой доступ к хранилищу Sky (консоль/клиент S3).\n\nКто: @${who}\nРежим: ${r.scope === 'read' ? 'только чтение' : 'чтение и запись'}\nСрок доступа: ${r.minutes} мин\n${r.note ? `Цель: ${r.note}\n` : ''}Запрос действует ${WAIT_MIN} мин.\n\n` +
      `Если это вы или ваше распоряжение — откройте страницу и подтвердите кодом: ${link}\nЕсли нет — отклоните: ключей не будет.\n\nСсылка одноразовая. Само открытие ссылки ничего не подтверждает.`).catch((e) => console.error('[storage] письмо:', e.message));
  }
};

const lazyExpire = async () => {
  await query("UPDATE storage_direct_requests SET status='expired' WHERE status='pending' AND expires_at <= now()");
  await query("UPDATE storage_direct_requests SET status='expired', secret_enc=NULL WHERE status='approved' AND access_until <= now()");
  await query("UPDATE storage_direct_requests SET secret_enc=NULL WHERE status IN ('denied','expired','revoked') AND secret_enc IS NOT NULL");
};

const allowed = async (me) => (await isOwner(me)) || (await can(me, 'storage_direct'));

export const request = async (me, input, meta = {}) => {
  if (!(await allowed(me))) return { error: 'not_allowed' };
  if (snapshot() && !snapshot().settings) return { error: 'storage_unavailable' };
  const scope = input?.scope === 'readwrite' ? 'readwrite' : input?.scope === 'read' ? 'read' : null; if (!scope) return { error: 'bad_scope' };
  const minutes = Math.floor(Number(input?.minutes)); if (!Number.isFinite(minutes) || minutes < 5 || minutes > 60) return { error: 'bad_minutes' };
  const note = clean(input?.note, 200); if (note.length < 5) return { error: 'reason_required' };
  await lazyExpire();
  const id = newId('sd'); const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  try {
    await query(`INSERT INTO storage_direct_requests (id, requester_id, scope, minutes, note, token_hash, expires_at, info) VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' minutes')::interval, $8::jsonb)`,
      [id, me, scope, minutes, note, sha(token), String(WAIT_MIN), JSON.stringify({ ip: meta.ip ?? '', ua: meta.ua ?? '' })]);
  } catch (e) { if (e.code === '23505') return { error: 'request_open' }; throw e; }
  const r = (await query('SELECT * FROM storage_direct_requests WHERE id=$1', [id])).rows[0];
  await query('UPDATE storage_direct_requests SET mailed_at = now() WHERE id=$1', [id]);
  await logEvent('direct_request', 'warn', { id, scope, minutes }, me);
  await notifyOwners(`direct:${id}`, 'Запрос прямого доступа к хранилищу', `Запрошен доступ (${scope === 'read' ? 'чтение' : 'чтение и запись'}, ${minutes} мин). Подтвердите по ссылке из письма.`, { critical: true });
  await mailOwner(r, token);
  await logAdmin({ actorId: me, targetType: 'storage', type: 'storage_direct_request', detail: `${scope}, ${minutes} мин — ${note}`, meta }).catch(() => {});
  return { ok: true, id, waitMinutes: WAIT_MIN };
};

export const list = async (me) => {
  if (!(await allowed(me))) return { error: 'not_allowed' };
  await lazyExpire();
  const mine = await isOwner(me);
  const { rows } = await query(`SELECT d.*, p.username FROM storage_direct_requests d LEFT JOIN profiles p ON p.id=d.requester_id ${mine ? '' : 'WHERE d.requester_id=$1'} ORDER BY d.created_at DESC LIMIT 50`, mine ? [] : [me]);
  return { items: rows.map(view), endpoint: gatewayEndpoint(), bucket: 'sky-storage' };
};

/** Запросивший забирает ключи — ровно один раз после подтверждения. */
export const claim = async (me, id) => {
  await lazyExpire();
  const r = (await query('SELECT * FROM storage_direct_requests WHERE id=$1 AND requester_id=$2', [String(id ?? ''), me])).rows[0];
  if (!r) return { error: 'not_found' };
  if (r.status !== 'approved') return { status: r.status };
  const got = await query(`UPDATE storage_direct_requests SET secret_shown_at = now() WHERE id=$1 AND secret_shown_at IS NULL AND status='approved' AND access_until > now() RETURNING secret_enc, access_key_id, access_until, scope`, [r.id]);
  if (!got.rowCount) return { status: 'approved', error: 'already_shown' };
  const x = got.rows[0];
  return { status: 'approved', endpoint: gatewayEndpoint(), bucket: 'sky-storage', accessKeyId: x.access_key_id, secretAccessKey: decryptSecret(x.secret_enc), expiresAt: x.access_until, scope: x.scope };
};

export const revoke = async (me, id, meta = {}) => {
  const r = (await query('SELECT * FROM storage_direct_requests WHERE id=$1', [String(id ?? '')])).rows[0];
  if (!r) return { error: 'not_found' };
  if (!((await isOwner(me)) || (r.requester_id === me && (await allowed(me))))) return { error: 'not_found' };
  const u = await query("UPDATE storage_direct_requests SET status='revoked', revoked_at=now(), revoked_by=$2, secret_enc=NULL WHERE id=$1 AND status IN ('pending','approved')", [r.id, me]);
  if (!u.rowCount) return { error: 'not_open' };
  await logEvent('direct_revoked', 'warn', { id: r.id }, me);
  await logAdmin({ actorId: me, targetType: 'storage', type: 'storage_direct_revoke', detail: r.id, meta }).catch(() => {});
  return { ok: true };
};

export const log = async (me, id) => {
  const r = (await query('SELECT requester_id FROM storage_direct_requests WHERE id=$1', [String(id ?? '')])).rows[0];
  if (!r || !((await isOwner(me)) || r.requester_id === me)) return { error: 'not_found' };
  const { rows } = await query('SELECT at, op, key, status, bytes, net FROM storage_direct_log WHERE request_id=$1 ORDER BY id DESC LIMIT 200', [id]);
  return { items: rows };
};

/* ─── Страница подтверждения (токен dx_…) ─── */
const byToken = async (token) => {
  const t = String(token ?? '');
  if (!t.startsWith(TOKEN_PREFIX) || !/^[A-Za-z0-9_-]{30,80}$/.test(t)) return null;
  return (await query('SELECT * FROM storage_direct_requests WHERE token_hash=$1', [sha(t)])).rows[0] ?? null;
};
export const isDirectToken = (t) => String(t ?? '').startsWith(TOKEN_PREFIX);

export const lookupForPage = async (token, meta) => {
  await lazyExpire();
  const r = await byToken(token); if (!r) return { error: 'invalid' };
  if (r.token_used_at || r.status !== 'pending') return { error: r.status === 'pending' ? 'used' : r.status };
  const ow = (await ownerIds())[0]; if (!ow) return { error: 'no_owner' };
  const step = await beginStepUp(ow, STEP_PURPOSE, { meta }); if (step.error) return { error: step.error };
  const who = (await query('SELECT username FROM profiles WHERE id=$1', [r.requester_id])).rows[0]?.username;
  return { request: { when: r.created_at, ua: `Прямой доступ к хранилищу: ${r.scope === 'read' ? 'только чтение' : 'чтение и запись'}, ${r.minutes} мин`, net: who ? `@${who}` : '', reasons: [r.note || 'без пояснения'], expiresAt: r.expires_at }, method: step.method };
};

export const decideByToken = async (token, approve, code, meta) => {
  await lazyExpire();
  const r = await byToken(token); if (!r) return { error: 'invalid' };
  if (r.token_used_at || r.status !== 'pending') return { error: r.status === 'pending' ? 'used' : r.status };
  const ow = (await ownerIds())[0];
  const step = await consumeStepUp(ow, STEP_PURPOSE, code, { meta }); if (step.error) return { error: step.error };
  if (approve !== true) {
    const u = await query("UPDATE storage_direct_requests SET status='denied', token_used_at=now(), decided_via='email' WHERE id=$1 AND status='pending'", [r.id]);
    if (!u.rowCount) return { error: 'used' };
    await logEvent('direct_denied', 'warn', { id: r.id }, ow);
    return { ok: true, status: 'denied' };
  }
  const keyId = 'SKYD' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const secret = crypto.randomBytes(30).toString('base64url');
  const u = await query(`UPDATE storage_direct_requests SET status='approved', approved_at=now(), token_used_at=now(), decided_via='email', access_key_id=$2, secret_enc=$3, access_until = now() + (minutes || ' minutes')::interval
                          WHERE id=$1 AND status='pending' AND expires_at > now()`, [r.id, keyId, encryptSecret(secret)]);
  if (!u.rowCount) return { error: 'expired' };
  await logEvent('direct_approved', 'warn', { id: r.id, scope: r.scope, minutes: r.minutes }, ow);
  await logAdmin({ actorId: ow, targetId: r.requester_id, targetType: 'storage', type: 'storage_direct_approve', detail: `${r.id}: ${r.scope}, ${r.minutes} мин`, meta }).catch(() => {});
  return { ok: true, status: 'approved' };
};

/** Ключ → действующий доступ или null (шлюз). Секрет расшифровывается только здесь. */
export const authenticate = async (accessKeyId) => {
  if (!/^SKYD[0-9A-F]{16}$/.test(String(accessKeyId ?? ''))) return null;
  const r = (await query("SELECT id, requester_id, scope, access_until, secret_enc FROM storage_direct_requests WHERE access_key_id=$1 AND status='approved' AND access_until > now() AND secret_enc IS NOT NULL", [accessKeyId])).rows[0];
  if (!r) return null;
  return { id: r.id, requesterId: r.requester_id, scope: r.scope, until: r.access_until, secret: decryptSecret(r.secret_enc) };
};

export const record = (requestId, op, key, status, bytes, net) =>
  query('INSERT INTO storage_direct_log (request_id, op, key, status, bytes, net) VALUES ($1,$2,$3,$4,$5,$6)', [requestId, op, String(key ?? '').slice(0, 300), status, bytes ?? 0, String(net ?? '').slice(0, 64)]).catch(() => {});

export const sweepDirect = async () => { await lazyExpire(); };
