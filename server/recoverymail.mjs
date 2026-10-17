/**
 * Резервная электронная почта Sky ID.
 *  • Адрес годится для восстановления только после подтверждения одноразовой ссылкой и только через сутки после подтверждения
 *    (RECOVERY_BACKUP_HOLD_HOURS): украденная сессия не успеет «обзавестись» своей резервной почтой и тут же ею воспользоваться,
 *    а настоящий владелец за это время получит письма на основную и прежнюю резервную почту.
 *  • Добавить или заменить адрес можно только с доказательством владения: код аутентификатора, а без него — код на основную
 *    почту (или на телефон, если почты нет). Одного входа в сессию мало.
 *  • Один адрес — один аккаунт (уникальный индекс); отличаться от основной почты он обязан.
 *  • Ответы не раскрывают, занят ли адрес другим аккаунтом.
 */
import { query } from './db.mjs';
import { issueCode, verifyCode } from './verification.mjs';
import { verifySkyTwoFactor } from './skyid.mjs';
import { sendEmail } from './notify.mjs';
import { rateLimitPerHour } from './security.mjs';
import { L } from './lang.mjs';
import { randomSecret, hashSecret, recoveryOrigin, maskEmail, normEmail, EMAIL_RE, record, notifyAccount, historyFor } from './recoverycore.mjs';
import { backupCodesLeft } from './accountrecovery.mjs';

const holdMs = () => Math.max(0, Number(process.env.RECOVERY_BACKUP_HOLD_HOURS ?? 24)) * 3600_000;
const LINK_TTL_MS = 60 * 60_000;
const err = (error, extra = {}) => ({ error, ...extra });
const sky = async (id) => (await query('SELECT * FROM sky_ids WHERE id = $1', [id])).rows[0] ?? null;

export const getBackupRow = async (skyId) => (await query('SELECT * FROM sky_backup_emails WHERE sky_id = $1', [skyId])).rows[0] ?? null;

/** Годится ли резервная почта для восстановления прямо сейчас. */
export const usableBackupEmail = async (skyId) => {
  const r = await getBackupRow(skyId);
  if (!r?.email || !r.verified_at) return null;
  if (r.usable_after && r.usable_after > new Date()) return null;
  return r.email;
};

/** Сводка для раздела «Безопасность и восстановление». */
export const overview = async (skyId, sessionId) => {
  const row = await sky(skyId); if (!row) return err('not_found');
  const b = await getBackupRow(skyId);
  const { sessionStore } = await import('./sessions.mjs');
  const sessions = (await sessionStore.listForUser(skyId)).length;
  return {
    primaryEmail: row.email ? { masked: maskEmail(row.email), verified: Boolean(row.email_verified) } : null,
    primaryPhone: row.phone ? { verified: Boolean(row.phone_verified) } : null,
    backupEmail: b?.email ? { masked: maskEmail(b.email), verifiedAt: b.verified_at?.toISOString?.() ?? null, usableAfter: b.usable_after && b.usable_after > new Date() ? b.usable_after.toISOString() : null } : null,
    pendingBackupEmail: b?.pending_email && b.pending_expires > new Date() ? { masked: maskEmail(b.pending_email), expiresAt: b.pending_expires.toISOString() } : null,
    twoFactor: { enabled: Boolean(row.two_factor_enabled), method: row.two_factor_method },
    backupCodesLeft: await backupCodesLeft(skyId),
    sessions, currentSession: sessionId,
    history: await historyFor(skyId, 20),
    holdHours: holdMs() / 3600_000,
  };
};

/** Как человек докажет владение перед сменой резервной почты. */
const proofKind = (row) => (row.two_factor_enabled ? 'twoFactor' : row.email_verified && row.email ? 'email' : row.phone_verified && row.phone ? 'phone' : null);

export const sendGuardCode = async (skyId) => {
  const row = await sky(skyId); if (!row) return err('not_found');
  const k = proofKind(row);
  if (!k) return err('cannot_prove_ownership');
  if (k === 'twoFactor') return { ok: true, kind: 'twoFactor' };
  const r = await issueCode(k === 'email' ? 'email' : 'phone', k === 'email' ? row.email : row.phone, `backup_guard:${skyId}`);
  return r.error ? r : { ok: true, kind: k, retryAfter: r.retryAfter };
};

const checkProof = async (row, body) => {
  const k = proofKind(row);
  if (!k) return err('cannot_prove_ownership');
  if (k === 'twoFactor') {
    if (!body?.twoFactorCode) return err('two_factor_required');
    const c = await verifySkyTwoFactor(row.id, String(body.twoFactorCode));
    return c?.error ? err(c.error === 'too_many_attempts' ? 'too_many_attempts' : 'invalid_code') : null;
  }
  if (!body?.guardCode) return err('guard_code_required', { kind: k });
  const c = await verifyCode(k === 'email' ? 'email' : 'phone', k === 'email' ? row.email : row.phone, `backup_guard:${row.id}`, String(body.guardCode));
  return c.error ? err('invalid_code') : null;
};

/** Начать добавление/смену резервной почты: письмо с одноразовой ссылкой на НОВЫЙ адрес. */
export const startSet = async (skyId, body, ip = '') => {
  const row = await sky(skyId); if (!row) return err('not_found');
  const email = normEmail(body?.email);
  if (!EMAIL_RE.test(email)) return err('invalid_email');
  if (!rateLimitPerHour(`backupmail:${skyId}`, 6)) return err('too_many_requests');
  const bad = await checkProof(row, body); if (bad) return bad;
  return startSetProven(skyId, email, ip, proofKind(row));
};

/** Ядро: доказательство владения уже проверено вызывающим (код при смене из профиля или фактор запроса восстановления). */
export const startSetProven = async (skyId, rawEmail, ip = '', factor = 'recovery') => {
  const row = await sky(skyId); if (!row) return err('not_found');
  const email = normEmail(rawEmail);
  if (!EMAIL_RE.test(email)) return err('invalid_email');
  if (row.email && normEmail(row.email) === email) return err('same_as_primary');
  const cur = await getBackupRow(skyId);
  if (cur?.email && normEmail(cur.email) === email) return err('same_as_current');

  const token = randomSecret(); const hash = hashSecret('backupmail', token);
  await query(
    `INSERT INTO sky_backup_emails (sky_id, pending_email, pending_hash, pending_expires) VALUES ($1,$2,$3,$4)
     ON CONFLICT (sky_id) DO UPDATE SET pending_email = $2, pending_hash = $3, pending_expires = $4, updated_at = now()`,
    [skyId, email, hash, new Date(Date.now() + LINK_TTL_MS)]);
  const link = `${recoveryOrigin()}/confirm-email#t=${token}`;
  // Ответ одинаков, даже если адрес занят другим аккаунтом: это выяснится при подтверждении, а письмо уйдёт в любом случае.
  sendEmail(email, L('Sky — подтвердите резервную почту', 'Sky — confirm your backup email'),
    L(`Этот адрес указан как резервная почта для восстановления доступа к Sky ID.\n\nЧтобы подтвердить, откройте ссылку (действует 1 час, одноразовая):\n${link}\n\nЕсли вы ничего не делали — просто проигнорируйте письмо.`,
      `This address was entered as the backup email for recovering a Sky ID.\n\nTo confirm, open the link (valid for 1 hour, single use):\n${link}\n\nIf you did nothing, just ignore this email.`)).catch((e) => console.error('[recovery] письмо:', e.message));
  await record({ skyId, event: 'backup_email_started', factor, ip });
  await notifyAccount(skyId, { title: L('Начата смена резервной почты', 'Backup email change started'), text: L(`Кто-то указал новую резервную почту ${maskEmail(email)}. Адрес станет доверенным только после подтверждения письмом.`, `A new backup email ${maskEmail(email)} was entered. It becomes trusted only after confirmation by email.`) });
  return { ok: true, masked: maskEmail(email), expiresIn: LINK_TTL_MS / 1000 };
};

/** Подтверждение по ссылке из письма (без входа в сессию: письмо — и есть доказательство владения новым адресом). */
export const confirmLink = async (token, ip = '') => {
  if (typeof token !== 'string' || token.length < 20) return err('invalid_link');
  const hash = hashSecret('backupmail', token);
  const { rows } = await query('SELECT * FROM sky_backup_emails WHERE pending_hash = $1', [hash]);
  const r = rows[0];
  if (!r || !r.pending_expires || r.pending_expires < new Date()) return err('invalid_link');
  const prev = r.email;
  try {
    // Одна транзакция-запрос: ссылка гасится в том же UPDATE, что и ставит адрес (повторное и параллельное использование невозможно).
    const upd = await query(
      `UPDATE sky_backup_emails SET email = pending_email, verified_at = now(), usable_after = now() + ($2 || ' milliseconds')::interval,
              pending_email = NULL, pending_hash = NULL, pending_expires = NULL, updated_at = now()
        WHERE sky_id = $1 AND pending_hash = $3 RETURNING email`, [r.sky_id, String(holdMs()), hash]);
    if (!upd.rowCount) return err('invalid_link');
  } catch (e) {
    if (e.code === '23505') { await query('UPDATE sky_backup_emails SET pending_email = NULL, pending_hash = NULL, pending_expires = NULL WHERE sky_id = $1', [r.sky_id]); return err('email_unavailable'); }
    throw e;
  }
  await record({ skyId: r.sky_id, event: 'backup_email_confirmed', factor: 'email', ip });
  await notifyAccount(r.sky_id, {
    title: L('Резервная почта подтверждена', 'Backup email confirmed'),
    text: L(`Резервная почта ${maskEmail(r.pending_email)} подтверждена${prev ? ` (прежняя ${maskEmail(prev)} заменена)` : ''}. Для восстановления доступа она заработает через ${Math.round(holdMs() / 3600_000)} ч.`,
      `Backup email ${maskEmail(r.pending_email)} is confirmed${prev ? ` (the previous ${maskEmail(prev)} was replaced)` : ''}. It can be used for recovery in ${Math.round(holdMs() / 3600_000)} h.`),
  });
  if (prev) sendEmail(prev, L('Sky — резервная почта заменена', 'Sky — backup email replaced'), L(`Резервная почта вашего Sky ID заменена на ${maskEmail(r.pending_email)}. Если это были не вы — зайдите в Профиль → Sky ID → Безопасность и восстановление.`, `The backup email of your Sky ID was replaced with ${maskEmail(r.pending_email)}. If this was not you, open Profile → Sky ID → Security and recovery.`)).catch(() => {});
  return { ok: true };
};

export const endOtherSessions = async (skyId, currentSessionId, ip = '') => {
  const { sessionStore } = await import('./sessions.mjs');
  const all = await sessionStore.listForUser(skyId);
  let n = 0;
  for (const s of all) if (s.id !== currentSessionId) { await sessionStore.revoke(s.id); n += 1; }
  await record({ skyId, event: 'sessions_ended', ip, detail: String(n) });
  return { ok: true, ended: n };
};
