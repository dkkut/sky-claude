/**
 * Защита аккаунта от чужих входов: очистка недавних сессий и временная заморозка НОВЫХ входов.
 *
 *  • Очистка — завершить сессии, начатые за последний час/сутки/неделю/месяц, либо только последнюю по времени входа.
 *    Текущая сессия никогда не завершается: человек, который нажал кнопку, не теряет доступ.
 *  • Заморозка — пока она действует, `startSession` отказывает (423 account_frozen) всем способам входа: код на почту/телефон,
 *    пароль, вход по QR. Уже открытые сессии работают. Срок — от 1 часа до 7 суток, заморозка всегда кончается сама.
 *    Включить можно только с подтверждённой почтой: туда уходит ссылка на разморозку.
 *  • Разморозка вручную — два условия сразу: (1) открыта ссылка из письма (одноразовая, действует на 30 минут после открытия),
 *    (2) человек в «Устройствах» уже открытой сессии нажимает «Разморозить» (если включён аутентификатор — с его кодом).
 *    Ссылка сама ничего не размораживает, поэтому её предпросмотр почтовым сканером ничего не меняет.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { decryptSecret } from './crypto.mjs';
import { verifyTotp } from './totp.mjs';
import { sendEmail } from './notify.mjs';
import { sessionStore } from './sessions.mjs';
import { L } from './lang.mjs';

export const REMOVE_HOURS = [1, 24, 168, 720];
export const FREEZE_HOURS = [1, 24, 72, 168];
const LINK_WINDOW_MIN = 30;

const hash = (t) => crypto.createHash('sha256').update(`${config.jwtSecret}:account-freeze:v1:${t}`).digest('hex');
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const log = (skyId, kind, ip, ua, detail = {}) =>
  query('INSERT INTO account_freeze_log (sky_id, kind, ip, ua, detail) VALUES ($1,$2,$3,$4,$5)', [skyId, kind, clip(ip, 100), clip(ua, 300), JSON.stringify(detail)]);

const load = async (skyId) => (await query(
  `SELECT id, email, email_verified, two_factor_enabled, two_factor_method, two_factor_secret,
          login_frozen_until, freeze_link_ok_until FROM sky_ids WHERE id = $1`, [skyId])).rows[0] ?? null;
const hasEmail = (r) => Boolean(r?.email && r.email_verified);
const hasTotp = (r) => Boolean(r?.two_factor_enabled && (r.two_factor_method ?? 'app') === 'app' && r.two_factor_secret);
const frozenNow = (r) => Boolean(r?.login_frozen_until && r.login_frozen_until > new Date());

/** Для startSession: заморожен ли аккаунт. Попытка входа во время заморозки записывается (не чаще раза в 10 минут). */
export const assertLoginAllowed = async (skyId, { ip, ua } = {}) => {
  const r = await load(skyId);
  if (!frozenNow(r)) return;
  const recent = await query(`SELECT 1 FROM account_freeze_log WHERE sky_id=$1 AND kind='blocked_login' AND created_at > now() - interval '10 minutes' LIMIT 1`, [skyId]);
  if (!recent.rows[0]) await log(skyId, 'blocked_login', ip, ua);
  throw Object.assign(new Error('account_frozen'), { status: 423, until: r.login_frozen_until.toISOString() });
};

export const isFrozen = async (skyId) => frozenNow(await load(skyId));

export const freezeState = async (skyId) => {
  const r = await load(skyId);
  if (!r) return { error: 'not_found' };
  const frozen = frozenNow(r);
  const linkOk = frozen && Boolean(r.freeze_link_ok_until && r.freeze_link_ok_until > new Date());
  const ev = await query(`SELECT kind, ip, ua, detail, created_at FROM account_freeze_log WHERE sky_id=$1 ORDER BY created_at DESC LIMIT 8`, [skyId]);
  return {
    frozen, until: frozen ? r.login_frozen_until.toISOString() : null,
    linkConfirmed: linkOk, linkUntil: linkOk ? r.freeze_link_ok_until.toISOString() : null,
    hasEmail: hasEmail(r), needsTotp: hasTotp(r),
    events: ev.rows.map((e) => ({ kind: e.kind, ip: e.ip, ua: e.ua, detail: e.detail, at: e.created_at.toISOString() })),
  };
};

const sendFreezeEmail = async (r, token, until) => {
  const link = `${config.publicOrigin}/unfreeze?t=${token}`;
  const when = until.toISOString().replace('T', ' ').slice(0, 16);
  await sendEmail(
    r.email,
    L('Новые входы в Sky ID заморожены', 'New sign-ins to your Sky ID are frozen'),
    L(
      `Новые входы в ваш Sky ID заморожены до ${when} (UTC). Уже открытые сессии работают, новые войти не смогут.\n\n` +
      `Чтобы снять заморозку раньше срока: 1) откройте ссылку и подтвердите её, 2) на устройстве, где вы уже вошли, зайдите в ` +
      `Профиль → Sky ID → Устройства и нажмите «Разморозить» в баннере «Разморозка аккаунта».\n${link}\n\n` +
      'Ссылка одноразовая. Если это были не вы — не открывайте её, смените пароль и завершите чужие сессии. Заморозка закончится сама в указанное время.',
      `New sign-ins to your Sky ID are frozen until ${when} (UTC). Sessions that are already open keep working; nobody new can sign in.\n\n` +
      `To lift the freeze early: 1) open the link and confirm it, 2) on a device where you are already signed in go to ` +
      `Profile → Sky ID → Devices and tap “Unfreeze” in the “Account unfreeze” banner.\n${link}\n\n` +
      'The link is single-use. If this was not you, do not open it, change your password and end unknown sessions. The freeze ends by itself at the time above.',
    ),
  );
};

const issueLink = async (skyId) => {
  const token = crypto.randomBytes(32).toString('base64url');
  await query('UPDATE sky_ids SET freeze_token_hash = $2, freeze_link_ok_until = NULL WHERE id = $1', [skyId, hash(token)]);
  return token;
};

/** Очистка сессий и/или заморозка. Текущая сессия остаётся всегда. */
export const protectAccount = async (skyId, sid, { ip, ua }, { remove, hours, freezeHours }) => {
  const mode = ['none', 'last', 'period'].includes(remove) ? remove : 'none';
  const fh = Number(freezeHours) || 0;
  if (mode === 'period' && !REMOVE_HOURS.includes(Number(hours))) return { error: 'bad_period' };
  if (fh && !FREEZE_HOURS.includes(fh)) return { error: 'bad_freeze' };
  if (mode === 'none' && !fh) return { error: 'nothing_to_do' };
  const r = await load(skyId);
  if (!r) return { error: 'not_found' };
  if (fh && !hasEmail(r)) return { error: 'email_required' };

  let frozenUntil = null;
  if (fh) {
    // Не короче уже действующей: «сократить» заморозку в обход ссылки нельзя.
    const u = await query(
      `UPDATE sky_ids SET login_frozen_until = GREATEST(COALESCE(login_frozen_until, now()), now() + ($2 || ' hours')::interval)
        WHERE id = $1 RETURNING login_frozen_until`, [skyId, String(fh)]);
    frozenUntil = u.rows[0].login_frozen_until;
    const token = await issueLink(skyId);
    await sendFreezeEmail(r, token, frozenUntil).catch((e) => console.error('[freeze] письмо:', e.message));
    await log(skyId, 'freeze', ip, ua, { hours: fh, until: frozenUntil.toISOString() });
  }

  let removed = 0;
  if (mode !== 'none') {
    const list = (await sessionStore.listForUser(skyId)).filter((s) => s.id !== sid);
    let targets = [];
    if (mode === 'last') {
      const last = [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
      targets = last ? [last] : [];
    } else {
      const cutoff = Date.now() - Number(hours) * 3_600_000;
      targets = list.filter((s) => (s.createdAt ?? 0) >= cutoff);
    }
    for (const s of targets) await sessionStore.revoke(s.id);
    removed = targets.length;
    // Доверенные устройства, появившиеся тогда же, — тоже: иначе чужое устройство осталось бы «своим».
    if (targets.length) {
      const since = new Date(Math.min(...targets.map((s) => s.createdAt ?? Date.now())) - 60_000);
      await query('DELETE FROM sky_trusted_devices WHERE sky_id = $1 AND first_seen >= $2', [skyId, since]);
    }
    await log(skyId, 'cleanup', ip, ua, { mode, hours: mode === 'period' ? Number(hours) : null, removed });
  }
  return { ok: true, removed, frozenUntil: frozenUntil ? frozenUntil.toISOString() : null };
};

/** Ссылка из письма открыта и подтверждена на странице. Одноразовая; сама ничего не размораживает. */
export const confirmFreezeLink = async (token, { ip, ua }) => {
  const t = String(token ?? '');
  if (t.length < 20 || t.length > 100) return { error: 'invalid_link' };
  const { rows } = await query(
    `UPDATE sky_ids SET freeze_token_hash = NULL, freeze_link_ok_until = now() + ($2 || ' minutes')::interval
      WHERE freeze_token_hash = $1 AND login_frozen_until > now() RETURNING id, freeze_link_ok_until`, [hash(t), String(LINK_WINDOW_MIN)]);
  if (!rows[0]) return { error: 'invalid_link' };
  await log(rows[0].id, 'link_opened', ip, ua);
  return { ok: true, minutes: LINK_WINDOW_MIN };
};

export const resendFreezeLink = async (skyId) => {
  const r = await load(skyId);
  if (!r) return { error: 'not_found' };
  if (!frozenNow(r)) return { error: 'not_frozen' };
  if (!hasEmail(r)) return { error: 'email_required' };
  const token = await issueLink(skyId);
  await sendFreezeEmail(r, token, r.login_frozen_until).catch((e) => console.error('[freeze] письмо:', e.message));
  return { ok: true };
};

/** Финальный шаг: ссылка открыта + человек в уже открытой сессии (+ код аутентификатора, если он включён). */
export const unfreeze = async (skyId, { ip, ua }, { totp }) => {
  const r = await load(skyId);
  if (!r) return { error: 'not_found' };
  if (!frozenNow(r)) return { ok: true, already: true };
  if (!(r.freeze_link_ok_until && r.freeze_link_ok_until > new Date())) return { error: 'link_required' };
  if (hasTotp(r)) {
    const code = String(totp ?? '').replace(/\s+/g, '');
    if (!code) return { error: 'totp_required' };
    let secret = ''; try { secret = decryptSecret(r.two_factor_secret); } catch { /* отказ ниже */ }
    if (!secret || !verifyTotp(secret, code)) return { error: 'bad_code' };
  }
  await query('UPDATE sky_ids SET login_frozen_until = NULL, freeze_token_hash = NULL, freeze_link_ok_until = NULL WHERE id = $1', [skyId]);
  await log(skyId, 'unfreeze', ip, ua);
  return { ok: true };
};

export const sweepFreezeLog = () => query(`DELETE FROM account_freeze_log WHERE created_at < now() - interval '180 days'`);
