/**
 * Средства восстановления привилегированных аккаунтов.
 *
 * ТОКЕН АДМИНИСТРАТОРА. Создаётся автоматически при выдаче роли (`adminsec.executePending`, случай `admin_grant`).
 *  • Генерируется сервером (32 байта случайности), уникален для профиля, не связан ни с паролем, ни с сессией, ни с API-ключом.
 *  • В базе — только HMAC-хеш. Открытое значение до первого показа лежит ЗАПЕЧАТАННЫМ (encryptSecret) и стирается в момент показа.
 *    Показывается ОДИН раз — самому назначенному администратору, после подтверждения его личности (step-up `recovery_admin_token`),
 *    поэтому ни владелец, ни выдавший роль, ни сотрудники поддержки значения не видят.
 *  • Потерян — вернуть нельзя: после проверки личности выпускается новый, прежний отзывается. Отзыв действует немедленно.
 *  • Токен — лишь один из факторов восстановления. Он не выдаёт сессию, не возвращает снятую роль и не делает никого администратором:
 *    при снятой роли проверка токена не проходит (профиль больше не is_admin).
 * СЕКРЕТ ВЛАДЕЛЬЦА. Задаёт и меняет сам владелец (со step-up), хранится как scrypt-хеш, нигде не показывается. Пять неверных — блок на 15 минут,
 *    дальше растёт. Администратору он недоступен; общего «мастер-ключа» нет.
 */
import { query } from './db.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { hashPassword, verifyPassword } from './security.mjs';
import { isOwnerRaw } from './admin.mjs';
import { newId, randomSecret, hashSecret, record, notifyAccount } from './recoverycore.mjs';
import { L } from './lang.mjs';

const err = (error, extra = {}) => ({ error, ...extra });
const fmt = (raw) => `SKYADM-${raw.slice(0, 8)}-${raw.slice(8, 16)}-${raw.slice(16, 24)}-${raw.slice(24, 32)}`.toUpperCase();
const canon = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* ─── Токен администратора ─────────────────────────────────────────── */

export const issueAdminToken = async (profileId, createdBy = null, reason = 'issued') => {
  const { rows: p } = await query('SELECT sky_id FROM profiles WHERE id = $1', [profileId]);
  if (!p[0]) return err('not_found');
  const raw = randomSecret(24).replace(/[^A-Za-z0-9]/g, '').padEnd(32, 'X').slice(0, 32);
  const shown = fmt(raw);
  // Прежний действующий отзывается и новый создаётся ОДНИМ оператором: два действующих токена на профиль невозможны (уникальный индекс).
  await query(`UPDATE recovery_admin_tokens SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE profile_id = $1 AND revoked_at IS NULL`, [profileId, createdBy, reason === 'issued' ? 'rotated' : reason]);
  const id = newId('rat');
  await query(`INSERT INTO recovery_admin_tokens (id, profile_id, sky_id, token_hash, sealed, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, profileId, p[0].sky_id, hashSecret('admintoken', canon(shown)), encryptSecret(shown), createdBy]);
  await record({ skyId: p[0].sky_id, kind: 'admin', event: 'admin_token_issued', factor: 'admin_token', detail: reason });
  await notifyAccount(p[0].sky_id, {
    title: L('Административный доступ Sky: токен восстановления', 'Sky admin access: recovery token'),
    text: L('Для вашего административного аккаунта создан токен восстановления. Откройте Профиль → Sky ID → Безопасность и восстановление и сохраните его — он показывается один раз.', 'A recovery token was created for your administrator account. Open Profile → Sky ID → Security and recovery and save it — it is shown once.'),
  });
  return { ok: true, id };
};

export const adminTokenState = async (profileId) => {
  const { rows } = await query(`SELECT id, created_at, revealed_at, (sealed IS NOT NULL) AS pending, last_used_at FROM recovery_admin_tokens WHERE profile_id = $1 AND revoked_at IS NULL`, [profileId]);
  const r = rows[0];
  return r ? { exists: true, pendingReveal: r.pending, createdAt: r.created_at.toISOString(), revealedAt: r.revealed_at?.toISOString?.() ?? null, lastUsedAt: r.last_used_at?.toISOString?.() ?? null } : { exists: false };
};

/** Атомарно: прочитать запечатанное значение и стереть его. Повторный вызов вернёт «нечего показывать». */
export const revealOnce = async (profileId, ip = '') => {
  const { pool } = await import('./db.mjs');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(`SELECT id, sky_id, sealed FROM recovery_admin_tokens WHERE profile_id = $1 AND revoked_at IS NULL AND sealed IS NOT NULL FOR UPDATE`, [profileId]);
    if (!rows[0]) { await c.query('ROLLBACK'); return err('nothing_to_show'); }
    const plain = decryptSecret(rows[0].sealed);
    await c.query(`UPDATE recovery_admin_tokens SET sealed = NULL, revealed_at = now() WHERE id = $1`, [rows[0].id]);
    await c.query('COMMIT');
    await record({ skyId: rows[0].sky_id, kind: 'admin', event: 'admin_token_revealed', factor: 'admin_token', ip });
    return plain ? { ok: true, token: plain } : err('nothing_to_show');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};

export const revokeAdminToken = async (actorId, profileId, reason, ip = '') => {
  const why = String(reason ?? '').trim().slice(0, 160);
  if (why.length < 5) return err('reason_required');
  const { rows } = await query(`UPDATE recovery_admin_tokens SET revoked_at = now(), revoked_by = $2, revoke_reason = $3, sealed = NULL WHERE profile_id = $1 AND revoked_at IS NULL RETURNING sky_id`, [profileId, actorId, why]);
  if (!rows[0]) return err('not_found');
  await record({ skyId: rows[0].sky_id, kind: 'admin', event: 'admin_token_revoked', factor: 'admin_token', ip, detail: `by ${actorId}`, level: 'WARN' });
  await notifyAccount(rows[0].sky_id, { title: L('Токен восстановления отозван', 'Recovery token revoked'), text: L('Токен восстановления вашего административного аккаунта отозван. Новый можно получить в Профиль → Sky ID → Безопасность и восстановление.', 'The recovery token of your administrator account was revoked. You can get a new one in Profile → Sky ID → Security and recovery.') });
  return { ok: true };
};

/** Проверка предъявленного значения: токен именно этого аккаунта, не отозван, не просрочен, профиль всё ещё администратор. */
export const verifyAdminToken = async (skyId, value) => {
  const v = canon(value); if (v.length < 20) return false;
  const { rows } = await query(
    `SELECT t.id FROM recovery_admin_tokens t JOIN profiles p ON p.id = t.profile_id
      WHERE t.sky_id = $1 AND t.token_hash = $2 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())
        AND p.is_admin AND p.deleted_at IS NULL`, [skyId, hashSecret('admintoken', v)]);
  if (!rows[0]) return false;
  await query('UPDATE recovery_admin_tokens SET last_used_at = now() WHERE id = $1', [rows[0].id]);
  return true;
};

/** После успешного восстановления администратора использованный токен считается скомпрометированным: выпускается новый (виден только владельцу после проверки). */
export const afterAdminRecovery = async (skyId, ip = '') => {
  const { rows } = await query(`SELECT id FROM profiles WHERE sky_id = $1 AND is_admin AND deleted_at IS NULL`, [skyId]);
  for (const p of rows) await issueAdminToken(p.id, null, 'after_recovery');
};

/* ─── Секрет владельца ─────────────────────────────────────────────── */

export const ownerSecretState = async (profileId) => {
  const { rows } = await query('SELECT set_at, locked_until FROM recovery_owner_secrets WHERE profile_id = $1', [profileId]);
  return rows[0] ? { set: true, setAt: rows[0].set_at.toISOString(), locked: Boolean(rows[0].locked_until && rows[0].locked_until > new Date()) } : { set: false };
};

export const setOwnerSecret = async (profileId, secret, ip = '') => {
  if (!(await isOwnerRaw(profileId))) return err('owner_only');
  const s = String(secret ?? '');
  if (s.length < 20 || s.length > 200 || !/[A-Za-zА-Яа-я]/.test(s) || !/\d/.test(s)) return err('weak_secret');
  const { rows: p } = await query('SELECT sky_id FROM profiles WHERE id = $1', [profileId]);
  const hash = await hashPassword(s);
  await query(`INSERT INTO recovery_owner_secrets (profile_id, secret_hash) VALUES ($1,$2)
     ON CONFLICT (profile_id) DO UPDATE SET secret_hash = $2, set_at = now(), fails = 0, locked_until = NULL`, [profileId, hash]);
  await record({ skyId: p[0]?.sky_id, kind: 'owner', event: 'owner_secret_set', factor: 'owner_secret', ip, level: 'WARN' });
  if (p[0]) await notifyAccount(p[0].sky_id, { title: L('Секрет восстановления владельца изменён', 'Owner recovery secret changed'), text: L('Секрет восстановления владельца создан или заменён. Если это были не вы — немедленно обратитесь на recovery-сайт и смените пароль.', 'The owner recovery secret was created or replaced. If it was not you, act immediately.') });
  return { ok: true };
};

export const verifyOwnerSecret = async (skyId, value) => {
  const { rows } = await query(`SELECT s.* FROM recovery_owner_secrets s JOIN profiles p ON p.id = s.profile_id WHERE p.sky_id = $1`, [skyId]);
  const r = rows[0]; if (!r) return false;
  if (r.locked_until && r.locked_until > new Date()) return false;
  const ok = await verifyPassword(String(value ?? ''), r.secret_hash);
  if (ok) { await query('UPDATE recovery_owner_secrets SET fails = 0, locked_until = NULL WHERE profile_id = $1', [r.profile_id]); return true; }
  const fails = r.fails + 1;
  const lock = fails >= 5 ? new Date(Date.now() + Math.min(24 * 3600_000, 15 * 60_000 * 2 ** Math.floor((fails - 5) / 5))) : null;
  await query('UPDATE recovery_owner_secrets SET fails = $2, locked_until = $3 WHERE profile_id = $1', [r.profile_id, fails, lock]);
  return false;
};
