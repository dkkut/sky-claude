/**
 * Двухэтапный вход в панель администратора.
 *
 * 1. Администратор/владелец открывает панель — сервер шлёт на подтверждённую почту ссылку
 *    (одноразовая, 15 минут, привязана к сессии, из которой её запросили).
 * 2. Ссылка открывает страницу «Вход в панель»: время, устройство, адрес. Там два пути:
 *    «Авторизоваться» — ввести код из аутентификатора, и сессия получает доступ на 8 часов;
 *    «Это не я» — включить систему безопасности: «Выключить сервер» (только владелец) или
 *    «Ввести аварийные работы» (любой администратор).
 * 3. Тех, с кого сняли права, ссылка не пускает и письма им не уходят.
 *
 * Токен хранится только хешем. На код — три попытки, потом ссылка гаснет.
 * Само закрытие панели без открытого шлюза — в admin.mjs (rightsOf/isOwner).
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { decryptSecret } from './crypto.mjs';
import { verifyTotp } from './totp.mjs';
import { sendEmail } from './notify.mjs';
import { sessionStore } from './sessions.mjs';
import { forgetGate } from './admin.mjs';
import { logAdmin, logSecurityEvent } from './adminsec.mjs';
import { rateLimitPerHour } from './security.mjs';
import { L } from './lang.mjs';

const LINK_TTL_MIN = 15;
const OPEN_HOURS = 8;
const CODE_ATTEMPTS = 3;
const tokenHash = (t) => crypto.createHash('sha256').update(`${config.jwtSecret}:admin-gate:v1:${t}`).digest('hex');
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

/** Администратор (или владелец) сейчас — без оглядки на шлюз. */
const adminNow = async (profileId) => {
  const name = String(config.ownerUsername ?? '').trim().toLowerCase();
  const { rows } = await query(
    `SELECT p.id, p.name, p.username, p.is_admin, lower(p.username) = $2 AS owner,
            s.id AS sky_id, s.email, s.email_verified, s.two_factor_enabled, s.two_factor_secret
       FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE p.id = $1`, [profileId, name || ' ']);
  const r = rows[0];
  if (!r || !(r.is_admin || r.owner)) return null;
  return { id: r.id, name: r.name, username: r.username, owner: Boolean(r.owner), skyId: r.sky_id,
    email: r.email_verified ? String(r.email ?? '') : '', twoFactor: Boolean(r.two_factor_enabled), secret: r.two_factor_secret };
};

const publicOrigin = (req) => {
  if (config.publicOrigin) return config.publicOrigin;
  const o = String(req?.headers?.origin ?? '');
  return config.nodeEnv !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) ? o : '';
};

/** Состояние шлюза для сессии: нужен ли вход, открыт ли, чего не хватает для прохождения. */
export const gateStatus = async (sid, profileId) => {
  const who = await adminNow(profileId);
  if (!who) return { admin: false };
  const { rows } = await query('SELECT expires_at FROM admin_gate_open WHERE sid = $1 AND profile_id = $2 AND expires_at > now()', [sid, profileId]);
  const { rows: pend } = await query(
    `SELECT created_at, expires_at FROM admin_gate_requests
      WHERE sid = $1 AND profile_id = $2 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [sid, profileId]);
  const canPass = Boolean(who.email && who.twoFactor);
  return {
    admin: true, enabled: process.env.ADMIN_GATE !== 'off', canPass,
    open: Boolean(rows[0]), openUntil: rows[0]?.expires_at.toISOString() ?? null,
    pending: Boolean(pend[0]), pendingSince: pend[0]?.created_at.toISOString() ?? null,
    missing: { email: !who.email, twoFactor: !who.twoFactor },
    emailHint: who.email ? who.email.replace(/^(.).*(@.*)$/, '$1•••$2') : null,
  };
};

/** Выслать ссылку. Письма уходят только тем, кто сейчас администратор. */
export const requestGate = async (sid, profileId, { req, device, ip }) => {
  const who = await adminNow(profileId);
  if (!who) return { error: 'not_allowed' };
  if (!who.email) return { error: 'email_required' };
  if (!who.twoFactor) return { error: 'two_factor_required' };
  if (!rateLimitPerHour(`admgate:req:${profileId}`, 6)) return { error: 'too_many_requests' };
  const origin = publicOrigin(req);
  if (!origin) return { error: 'public_url_missing' };

  await query('UPDATE admin_gate_requests SET used_at = now(), outcome = $2 WHERE sid = $1 AND used_at IS NULL', [sid, 'replaced']);
  const token = crypto.randomBytes(32).toString('base64url');
  const id = `agr-${crypto.randomUUID()}`;
  await query(
    `INSERT INTO admin_gate_requests (id, profile_id, sid, token_hash, device, ip, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' minutes')::interval)`,
    [id, profileId, sid, tokenHash(token), clip(device, 160), clip(ip, 60), String(LINK_TTL_MIN)]);

  const link = `${origin}/admin-verify?t=${token}`;
  const r = await sendEmail(who.email, L('Вход в панель администратора Sky', 'Sky admin panel sign-in'),
    L(`Кто-то открыл панель администратора с вашего аккаунта.\n\nУстройство: ${clip(device, 160) || 'неизвестно'}\nАдрес: ${clip(ip, 60) || 'неизвестен'}\n\n`
      + `Если это вы — откройте ссылку и подтвердите вход кодом из аутентификатора:\n${link}\n\n`
      + `Если это не вы — откройте ссылку и нажмите «Это не я, включить систему безопасности».\nСсылка действует ${LINK_TTL_MIN} минут и работает один раз.`,
    `Someone opened the admin panel on your account.\n\nDevice: ${clip(device, 160) || 'unknown'}\nAddress: ${clip(ip, 60) || 'unknown'}\n\n`
      + `If it was you, open the link and confirm with the code from your authenticator:\n${link}\n\n`
      + `If it was not you, open the link and press “It’s not me, enable security mode”.\nThe link is valid for ${LINK_TTL_MIN} minutes and works once.`))
    .catch((e) => ({ ok: false, error: e.message }));
  if (r && r.ok === false) return { error: 'email_failed' };
  await logSecurityEvent(profileId, 'admin_gate_request', clip(device, 100), {});
  return { ok: true, expiresIn: LINK_TTL_MIN * 60 };
};

const liveRequest = async (token) => {
  const t = String(token ?? '');
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(t)) return null;
  const { rows } = await query(
    `SELECT * FROM admin_gate_requests WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [tokenHash(t)]);
  return rows[0] ?? null;
};

/** Что показать на странице ссылки. Ничего лишнего: ни почты, ни имени. */
export const inspectLink = async (token) => {
  const r = await liveRequest(token);
  if (!r) return { error: 'invalid_link' };
  const who = await adminNow(r.profile_id);
  if (!who) return { error: 'invalid_link' };     // сняли с админки — ссылка мертва
  return { ok: true, requestedAt: r.created_at.toISOString(), device: r.device, ip: r.ip, owner: who.owner, expiresAt: r.expires_at.toISOString() };
};

/** «Авторизоваться»: верный код из аутентификатора открывает шлюз для сессии, откуда пришёл запрос. */
export const confirmLink = async (token, code) => {
  const r = await liveRequest(token);
  if (!r) return { error: 'invalid_link' };
  const who = await adminNow(r.profile_id);
  if (!who) return { error: 'invalid_link' };
  if (!who.twoFactor) return { error: 'two_factor_required' };
  if (r.attempts >= CODE_ATTEMPTS) {
    await query('UPDATE admin_gate_requests SET used_at = now(), outcome = $2 WHERE id = $1', [r.id, 'exhausted']);
    return { error: 'invalid_link' };
  }
  const secret = decryptSecret(who.secret);
  const good = Boolean(secret) && verifyTotp(secret, String(code ?? '').replace(/\s+/g, ''));
  if (!good) {
    const { rows } = await query('UPDATE admin_gate_requests SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts', [r.id]);
    await logSecurityEvent(r.profile_id, 'admin_gate_bad_code', '', {});
    if ((rows[0]?.attempts ?? 0) >= CODE_ATTEMPTS) {
      await query('UPDATE admin_gate_requests SET used_at = now(), outcome = $2 WHERE id = $1', [r.id, 'exhausted']);
      return { error: 'code_exhausted' };
    }
    return { error: 'bad_code', left: CODE_ATTEMPTS - (rows[0]?.attempts ?? 0) };
  }
  // Сессия должна ещё жить: иначе открывать шлюз некому.
  const stored = await sessionStore.get(r.sid);
  if (!stored) { await query('UPDATE admin_gate_requests SET used_at = now(), outcome = $2 WHERE id = $1', [r.id, 'session_gone']); return { error: 'session_gone' }; }
  await query('UPDATE admin_gate_requests SET used_at = now(), outcome = $2 WHERE id = $1', [r.id, 'confirmed']);
  await query(
    `INSERT INTO admin_gate_open (sid, profile_id, expires_at) VALUES ($1,$2, now() + ($3 || ' hours')::interval)
     ON CONFLICT (sid) DO UPDATE SET profile_id = $2, opened_at = now(), expires_at = excluded.expires_at`, [r.sid, r.profile_id, String(OPEN_HOURS)]);
  forgetGate(r.sid);
  await logAdmin({ actorId: r.profile_id, type: 'admin_gate_open', targetType: 'session', detail: clip(r.device, 120) });
  return { ok: true };
};

const revokeAdmins = async (actor) => {
  // Все сессии того, кто нажал «Это не я» (это могла быть чужая сессия), и сессии остальных администраторов, кроме владельца.
  let n = await sessionStore.revokeAllForUser(actor.skyId);
  const name = String(config.ownerUsername ?? '').trim().toLowerCase();
  const { rows } = await query(
    `SELECT DISTINCT s.id AS sky_id FROM profiles p JOIN sky_ids s ON s.id = p.sky_id
      WHERE p.is_admin AND lower(p.username) <> $1 AND s.id <> $2`, [name || ' ', actor.skyId]);
  for (const x of rows) n += await sessionStore.revokeAllForUser(x.sky_id);
  await query('DELETE FROM admin_gate_open WHERE profile_id IN (SELECT id FROM profiles WHERE is_admin) OR profile_id = $1', [actor.id]);
  return n;
};

/**
 * «Это не я». action: 'lockdown' — «аварийные работы» для панели (любой администратор),
 * 'shutdown' — выключить сервер (только владелец). Ссылка — единственное, что нужно:
 * человек мог остаться без кода, а время важнее.
 */
export const panicLink = async (token, action, { ip } = {}) => {
  const r = await liveRequest(token);
  if (!r) return { error: 'invalid_link' };
  const who = await adminNow(r.profile_id);
  if (!who) return { error: 'invalid_link' };
  if (action !== 'lockdown' && action !== 'shutdown') return { error: 'bad_action' };
  if (action === 'shutdown' && !who.owner) return { error: 'owner_only' };

  const reason = L(`Включено по ссылке «Это не я» (@${who.username})`, `Enabled via “It’s not me” link (@${who.username})`).slice(0, 280);
  await query('UPDATE admin_gate_requests SET used_at = now(), outcome = $2 WHERE id = $1', [r.id, `panic_${action}`]);

  if (action === 'shutdown') {
    await query('UPDATE platform_shutdown SET active = TRUE, reason = $1, set_by = $2, set_at = now() WHERE id', [reason, who.id]);
  }
  // Панель закрывается в обоих случаях: выключенный сервер без закрытой панели смысла не имеет.
  await query('UPDATE admin_lockdown SET active = TRUE, reason = $1, set_by = $2, set_at = now() WHERE id', [reason, who.id]);
  const revoked = await revokeAdmins(who);
  await logAdmin({ actorId: who.id, type: action === 'shutdown' ? 'gate_panic_shutdown' : 'gate_panic_lockdown', targetType: 'system',
    detail: `${reason} · сессий закрыто: ${revoked} · ${clip(ip, 40)}` });

  // Владелец узнаёт, если кнопку нажал не он сам.
  if (!who.owner) {
    const name = String(config.ownerUsername ?? '').trim().toLowerCase();
    const { rows } = await query(
      `SELECT s.email FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE lower(p.username) = $1 AND s.email_verified`, [name || ' ']);
    if (rows[0]?.email) {
      await sendEmail(rows[0].email, L('Администратор включил аварийный режим', 'An admin enabled emergency mode'),
        L(`@${who.username} нажал «Это не я» при входе в панель: панель закрыта, сессии администраторов завершены. Проверьте журнал и выключите режим в панели.`,
          `@${who.username} pressed “It’s not me” at panel sign-in: the panel is locked and admin sessions were ended. Check the log and turn the mode off in the panel.`)).catch(() => {});
    }
  }
  return { ok: true, action, revoked };
};

/** Уборка: отработавшие запросы и просроченные открытия. */
export const sweepAdminGate = async () => {
  await query("DELETE FROM admin_gate_requests WHERE expires_at < now() - interval '2 days'");
  await query("DELETE FROM admin_gate_open WHERE expires_at < now()");
};

