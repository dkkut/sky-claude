/**
 * Подтверждение входа по SSH владельцем — та же система, что и вход в панель
 * администратора (admingate.mjs): письмо со ссылкой → страница «Вход по SSH» →
 * код из аутентификатора; «Это не я» включает систему безопасности.
 *
 * Как это стыкуется с сервером:
 *  1. sshd вызывает scripts/ssh-gate.sh через PAM (session). Скрипт подписывает запрос общим
 *     секретом SSH_GATE_SECRET и просит API создать запрос — сам секрет по сети не ходит.
 *  2. API шлёт ссылку на подтверждённую почту владельца (OWNER_USERNAME). Запрос живёт 5 минут.
 *  3. Скрипт опрашивает API по своему одноразовому ключу (poll). Пустить в сессию он может только
 *     после «approved»; всё остальное — отказ. Подтверждение выдаётся скрипту один раз.
 *  4. Владелец открывает ссылку, вводит код аутентификатора — вход подтверждён. «Это не я» —
 *     вход отклонён и (по выбору) «Выключить сервер» / «Ввести аварийные работы».
 *
 * Токен ссылки и ключ опроса хранятся хешами. На код — три попытки, потом запрос гаснет.
 * Если у владельца нет подтверждённой почты или аутентификатора, запрос отклоняется (вход закрыт),
 * а не пропускается: шлюз, который открывается при поломке, — не шлюз.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { decryptSecret } from './crypto.mjs';
import { verifyTotp } from './totp.mjs';
import { sendEmail } from './notify.mjs';
import { logAdmin, logSecurityEvent } from './adminsec.mjs';
import { rateLimitPerHour } from './security.mjs';
import { L } from './lang.mjs';
import { adminNow, enactPanic } from './admingate.mjs';

const LINK_TTL_MIN = 5;
const CODE_ATTEMPTS = 3;
const SIG_WINDOW_SEC = 120;
const hash = (kind, t) => crypto.createHash('sha256').update(`${config.jwtSecret}:ssh-gate:${kind}:v1:${t}`).digest('hex');
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const secret = () => String(process.env.SSH_GATE_SECRET ?? '');

export const sshGateEnabled = () => secret().length >= 24;

/** Подпись запроса от скрипта: HMAC-SHA256 общим секретом по полям запроса. */
export const signSshRequest = (key, { ts, user, host, rhost, tty }) =>
  crypto.createHmac('sha256', key).update([ts, user, host, rhost, tty].join('\n')).digest('hex');

const sameHex = (a, b) => {
  const x = Buffer.from(String(a), 'utf8'); const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const ownerNow = async () => {
  const name = String(config.ownerUsername ?? '').trim().toLowerCase();
  if (!name) return null;
  const { rows } = await query('SELECT id FROM profiles WHERE lower(username) = $1', [name]);
  return rows[0] ? adminNow(rows[0].id) : null;
};

/** Запрос от скрипта на сервере. */
export const requestSsh = async ({ ts, user, host, rhost, tty, sig }, { ip }) => {
  if (!sshGateEnabled()) return { error: 'disabled' };
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > SIG_WINDOW_SEC) return { error: 'bad_signature' };
  const fields = { ts: String(ts), user: clip(user, 40), host: clip(host, 80), rhost: clip(rhost, 60), tty: clip(tty, 40) };
  if (!sameHex(signSshRequest(secret(), fields), String(sig ?? ''))) return { error: 'bad_signature' };

  const who = await ownerNow();
  if (!who) return { error: 'owner_missing' };
  if (!who.email) return { error: 'email_required' };
  if (!who.twoFactor) return { error: 'two_factor_required' };
  if (!rateLimitPerHour('sshgate:req', 30)) return { error: 'too_many_requests' };
  if (!config.publicOrigin) return { error: 'public_url_missing' };

  const token = crypto.randomBytes(32).toString('base64url');
  const poll = crypto.randomBytes(24).toString('base64url');
  const id = `ssh-${crypto.randomUUID()}`;
  const device = `${fields.user}@${fields.host}${fields.tty ? ` (${fields.tty})` : ''}`;
  await query(
    `INSERT INTO ssh_gate_requests (id, profile_id, token_hash, poll_hash, ssh_user, ssh_host, ip, device, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + ($9 || ' minutes')::interval)`,
    [id, who.id, hash('link', token), hash('poll', poll), fields.user, fields.host, fields.rhost, clip(device, 160), String(LINK_TTL_MIN)]);

  const link = `${config.publicOrigin}/ssh-verify?t=${token}`;
  const r = await sendEmail(who.email, L('Вход на сервер Sky по SSH', 'Sky server SSH sign-in'),
    L(`Кто-то входит на сервер по SSH.\n\nПользователь: ${fields.user}@${fields.host}\nАдрес: ${fields.rhost || 'неизвестен'}\n\n`
      + `Если это вы — откройте ссылку и подтвердите вход кодом из аутентификатора:\n${link}\n\n`
      + `Если это не вы — откройте ссылку и нажмите «Это не я, включить систему безопасности».\nСсылка действует ${LINK_TTL_MIN} минут и работает один раз. Пока вход не подтверждён, SSH-сессия не откроется.`,
    `Someone is signing in to the server over SSH.\n\nUser: ${fields.user}@${fields.host}\nAddress: ${fields.rhost || 'unknown'}\n\n`
      + `If it was you, open the link and confirm with the code from your authenticator:\n${link}\n\n`
      + `If it was not you, open the link and press “It’s not me, enable security mode”.\nThe link is valid for ${LINK_TTL_MIN} minutes and works once. Until you confirm, the SSH session will not open.`))
    .catch((e) => ({ ok: false, error: e.message }));
  if (r && r.ok === false) {
    await query('UPDATE ssh_gate_requests SET status = $2, decided_at = now(), outcome = $3 WHERE id = $1', [id, 'denied', 'email_failed']);
    return { error: 'email_failed' };
  }
  await logSecurityEvent(who.id, 'ssh_gate_request', clip(device, 100), { ip: clip(ip, 60) });
  return { ok: true, id, poll, expiresIn: LINK_TTL_MIN * 60 };
};

/** Опрос от скрипта: подтверждение выдаётся один раз. */
export const pollSsh = async (id, poll) => {
  const { rows } = await query('SELECT * FROM ssh_gate_requests WHERE id = $1', [String(id ?? '')]);
  const r = rows[0];
  if (!r || !sameHex(hash('poll', String(poll ?? '')), r.poll_hash)) return { status: 'unknown' };
  if (r.status === 'approved') {
    const { rowCount } = await query('UPDATE ssh_gate_requests SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [r.id]);
    return { status: rowCount ? 'approved' : 'denied' };
  }
  if (r.status !== 'pending') return { status: 'denied' };
  if (r.expires_at < new Date()) {
    await query("UPDATE ssh_gate_requests SET status = 'denied', decided_at = now(), outcome = 'expired' WHERE id = $1 AND status = 'pending'", [r.id]);
    return { status: 'expired' };
  }
  return { status: 'pending' };
};

const liveRequest = async (token) => {
  const t = String(token ?? '');
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(t)) return null;
  const { rows } = await query(
    `SELECT * FROM ssh_gate_requests WHERE token_hash = $1 AND status = 'pending' AND expires_at > now()`, [hash('link', t)]);
  return rows[0] ?? null;
};

/** Что показать на странице ссылки. */
export const inspectSshLink = async (token) => {
  const r = await liveRequest(token);
  if (!r) return { error: 'invalid_link' };
  const who = await adminNow(r.profile_id);
  if (!who) return { error: 'invalid_link' };
  return { ok: true, requestedAt: r.created_at.toISOString(), device: r.device, ip: r.ip, owner: who.owner, expiresAt: r.expires_at.toISOString() };
};

/** «Авторизоваться»: верный код аутентификатора пускает SSH-сессию. */
export const confirmSshLink = async (token, code) => {
  const r = await liveRequest(token);
  if (!r) return { error: 'invalid_link' };
  const who = await adminNow(r.profile_id);
  if (!who) return { error: 'invalid_link' };
  if (!who.twoFactor) return { error: 'two_factor_required' };
  if (r.attempts >= CODE_ATTEMPTS) {
    await query("UPDATE ssh_gate_requests SET status = 'denied', decided_at = now(), outcome = 'exhausted' WHERE id = $1", [r.id]);
    return { error: 'invalid_link' };
  }
  const key = decryptSecret(who.secret);
  const good = Boolean(key) && verifyTotp(key, String(code ?? '').replace(/\s+/g, ''));
  if (!good) {
    const { rows } = await query('UPDATE ssh_gate_requests SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts', [r.id]);
    await logSecurityEvent(r.profile_id, 'ssh_gate_bad_code', '', {});
    if ((rows[0]?.attempts ?? 0) >= CODE_ATTEMPTS) {
      await query("UPDATE ssh_gate_requests SET status = 'denied', decided_at = now(), outcome = 'exhausted' WHERE id = $1", [r.id]);
      return { error: 'code_exhausted' };
    }
    return { error: 'bad_code', left: CODE_ATTEMPTS - (rows[0]?.attempts ?? 0) };
  }
  await query("UPDATE ssh_gate_requests SET status = 'approved', decided_at = now(), outcome = 'confirmed' WHERE id = $1", [r.id]);
  await logAdmin({ actorId: r.profile_id, type: 'ssh_gate_approved', targetType: 'system', detail: clip(`${r.device} · ${r.ip}`, 120) });
  return { ok: true };
};

/**
 * «Это не я». action: 'deny' — только отклонить вход; 'lockdown' — ещё и закрыть панель,
 * завершить сессии администраторов; 'shutdown' — ещё и выключить сервер. Ссылка — единственное,
 * что нужно: человек мог остаться без кода, а время важнее.
 */
export const panicSshLink = async (token, action, { ip } = {}) => {
  const r = await liveRequest(token);
  if (!r) return { error: 'invalid_link' };
  const who = await adminNow(r.profile_id);
  if (!who) return { error: 'invalid_link' };
  if (!['deny', 'lockdown', 'shutdown'].includes(action)) return { error: 'bad_action' };
  if (action === 'shutdown' && !who.owner) return { error: 'owner_only' };

  await query('UPDATE ssh_gate_requests SET status = $2, decided_at = now(), outcome = $3 WHERE id = $1', [r.id, 'denied', `panic_${action}`]);
  let revoked = 0;
  if (action === 'deny') {
    await logAdmin({ actorId: who.id, type: 'ssh_gate_denied', targetType: 'system', detail: clip(`${r.device} · ${r.ip}`, 120) });
  } else {
    ({ revoked } = await enactPanic(who, action, { ip, source: `SSH ${r.device}` }));
  }
  return { ok: true, action, revoked };
};

/** Уборка. */
export const sweepSshGate = async () => {
  await query("UPDATE ssh_gate_requests SET status = 'denied', decided_at = now(), outcome = 'expired' WHERE status = 'pending' AND expires_at < now()");
  await query("DELETE FROM ssh_gate_requests WHERE created_at < now() - interval '30 days'");
};
