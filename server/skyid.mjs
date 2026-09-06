/**
 * Sky ID: аккаунт, профили и Prime.
 *
 * Разделение ответственности:
 *
 *   sky_ids  — как входят: телефон, почта, двухэтапная защита аккаунта.
 *   profiles — кем пользуются: имя, ник, аватар, своя двухэтапная защита.
 *   prime_subscriptions — Prime, привязанный к конкретному профилю.
 *
 * Ключевое правило: любая функция, работающая с профилем, принимает
 * skyId вызывающего и сама проверяет принадлежность. Подставить чужой
 * profile_id в запрос недостаточно — строка просто не найдётся.
 */
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { generateSecret, verifyTotp, otpauthUri } from './totp.mjs';
import { issueCode, verifyCode } from './verification.mjs';

/** Максимум профилей в одном Sky ID. Дублируется триггером в БД. */
export const MAX_PROFILES = 2;

/* ─── Представление наружу ─────────────────────────────────────────────── */

const toSkyId = (row) => row && ({
  id:               row.id,
  phone:            row.phone,
  email:            row.email ?? undefined,
  emailVerified:    row.email_verified,
  twoFactorEnabled: row.two_factor_enabled,
  twoFactorMethod:  row.two_factor_method ?? 'app',
  createdAt:        row.created_at.toISOString(),
});

/**
 * Профиль в том виде, в каком его ждёт приложение. Поле id совпадает с
 * прежним userId — на него ссылаются кошелёк, чаты и сообщения, поэтому
 * менять его нельзя.
 */
const toProfile = (row) => row && ({
  id:       row.id,
  skyId:    row.sky_id,
  name:     row.name,
  username: row.username,
  avatar:   row.avatar ?? undefined,
  isAdmin:  row.is_admin,
  isPrime:  Boolean(row.prime_active),
  primeUntil: row.prime_expires_at ? row.prime_expires_at.toISOString() : undefined,
  primePlan:  row.prime_plan ?? undefined,
  twoFactorEnabled: row.two_factor_enabled,
  twoFactorMethod:  row.two_factor_method ?? 'app',
  createdAt: row.created_at.toISOString(),
});

/**
 * Профиль всегда читается вместе с состоянием Prime: активной считается
 * подписка без срока или с ещё не наступившим сроком. Разъехаться флагу
 * и подписке при таком чтении негде.
 */
const PROFILE_SELECT = `
  SELECT p.*,
         pr.status = 'active' AND (pr.expires_at IS NULL OR pr.expires_at > now()) AS prime_active,
         pr.expires_at AS prime_expires_at,
         pr.plan       AS prime_plan
    FROM profiles p
    LEFT JOIN LATERAL (
      SELECT * FROM prime_subscriptions s
       WHERE s.profile_id = p.id AND s.status = 'active'
       ORDER BY s.started_at DESC LIMIT 1
    ) pr ON TRUE
`;

/* ─── Sky ID ───────────────────────────────────────────────────────────── */

export const findSkyIdByPhone = async (phone) => {
  const { rows } = await query('SELECT * FROM sky_ids WHERE phone = $1', [String(phone)]);
  return rows[0] ?? null;
};

export const findSkyIdById = async (id) => {
  const { rows } = await query('SELECT * FROM sky_ids WHERE id = $1', [String(id)]);
  return rows[0] ?? null;
};

/** Заводит Sky ID под номер или возвращает существующий. */
export const ensureSkyId = async (phone) => {
  const existing = await findSkyIdByPhone(phone);
  if (existing) return { skyId: existing, created: false };

  const id = `sky-${generateId()}`;
  const { rows } = await query(
    'INSERT INTO sky_ids (id, phone) VALUES ($1,$2) ON CONFLICT (phone) DO NOTHING RETURNING *',
    [id, String(phone)],
  );
  // Конфликт значит, что параллельный запрос успел раньше — берём его.
  if (!rows[0]) return { skyId: await findSkyIdByPhone(phone), created: false };
  return { skyId: rows[0], created: true };
};

export const publicSkyId = (row) => toSkyId(row);

/* ─── Почта ────────────────────────────────────────────────────────────── */

export const setEmailVerified = async (skyId, email) => {
  try {
    const { rows } = await query(
      `UPDATE sky_ids SET email = $2, email_verified = TRUE, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [skyId, String(email).toLowerCase()],
    );
    return { skyId: rows[0] };
  } catch (err) {
    // 23505 — адрес уже подтверждён другим Sky ID.
    if (err.code === '23505') return { error: 'email_taken' };
    throw err;
  }
};

/* ─── Двухэтапная защита Sky ID ────────────────────────────────────────── */

/**
 * Готовит секрет, но НЕ включает защиту: она включится только после
 * того, как человек подтвердит, что его приложение выдаёт верный код.
 * Иначе можно запереть себя, сохранив секрет, который никуда не записан.
 */
/**
 * Общая часть для обоих способов: куда слать код и как его проверить.
 *
 * 'app'   — код показывает приложение-аутентификатор (TOTP).
 * 'email' — код приходит письмом на подтверждённую почту Sky ID.
 *
 * SMS вторым фактором сознательно нет: вход и так идёт по коду из SMS,
 * и второй код на тот же номер ничего не добавляет — кто получил
 * первый, получит и второй.
 */
export const TWO_FACTOR_METHODS = ['app', 'email'];

/** Почта, на которую можно слать второй фактор: только подтверждённая. */
const verifiedEmailOf = async (skyId) => {
  const { rows } = await query(
    'SELECT email, email_verified FROM sky_ids WHERE id = $1', [skyId],
  );
  return rows[0]?.email_verified ? rows[0].email : null;
};

/**
 * Назначение кода. Включает и цель, и этап: код для включения защиты и
 * код для входа не должны делить одну паузу между отправками. Иначе
 * сразу после включения защиты профиль минуту нельзя было бы открыть —
 * прежний код уже потрачен, а новый ещё нельзя выслать.
 */
const emailPurpose = (skyId, profileId, stage) =>
  `${profileId ? `2fa-profile:${profileId}` : `2fa-sky:${skyId}`}:${stage}`;

/** Идёт настройка (защита ещё не включена) или обычная проверка. */
const stageOf = (enabled) => (enabled ? 'use' : 'setup');

const twoFactorState = async (skyId, profileId) => {
  const { rows } = profileId
    ? await query('SELECT two_factor_enabled AS on FROM profiles WHERE sky_id = $1 AND id = $2', [skyId, profileId])
    : await query('SELECT two_factor_enabled AS on FROM sky_ids WHERE id = $1', [skyId]);
  return rows[0] ? stageOf(rows[0].on) : null;
};

/** Отправляет код второго фактора на почту. */
export const sendTwoFactorEmail = async (skyId, profileId = null, stage = null) => {
  const email = await verifiedEmailOf(skyId);
  if (!email) return { error: 'email_not_verified' };

  const at = stage ?? await twoFactorState(skyId, profileId);
  if (!at) return { error: 'not_found' };

  const result = await issueCode('email', email, emailPurpose(skyId, profileId, at));
  if (result.error) return { error: result.error, retryAfter: result.retryAfter };
  return { ok: true, retryAfter: result.retryAfter, expiresIn: result.expiresIn, email };
};

const checkEmailCode = async (skyId, profileId, code, stage) => {
  const email = await verifiedEmailOf(skyId);
  if (!email) return { error: 'email_not_verified' };
  const result = await verifyCode('email', email, emailPurpose(skyId, profileId, stage), code);
  return result.error ? { error: result.error, attemptsLeft: result.attemptsLeft } : { ok: true };
};

/* ─── Двухэтапная защита Sky ID ────────────────────────────────────────── */
/*  Секрет сохраняется сразу, но защита включается только после того,
    как человек подтвердит, что код у него действительно приходит.
    Иначе можно запереть себя, сохранив секрет, который никуда не записан. */

export const beginSkyTwoFactor = async (skyId, label, method = 'app') => {
  if (!TWO_FACTOR_METHODS.includes(method)) return { error: 'invalid_method' };

  // Пока защита включена, начинать настройку заново нельзя: иначе
  // достаточно было бы открытой вкладки, чтобы сбросить её без кода.
  // Сменить способ — сначала отключить, а отключение требует кода.
  const { rows } = await query('SELECT two_factor_enabled FROM sky_ids WHERE id = $1', [skyId]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].two_factor_enabled) return { error: 'already_enabled' };

  if (method === 'email') {
    const sent = await sendTwoFactorEmail(skyId, null, 'setup');
    if (sent.error) return sent;
    await query(
      `UPDATE sky_ids SET two_factor_method = 'email', two_factor_secret = NULL,
              two_factor_enabled = FALSE, updated_at = now() WHERE id = $1`,
      [skyId],
    );
    return { ok: true, method: 'email', email: sent.email, retryAfter: sent.retryAfter };
  }

  const secret = generateSecret();
  await query(
    `UPDATE sky_ids SET two_factor_secret = $2, two_factor_method = 'app',
            two_factor_enabled = FALSE, updated_at = now() WHERE id = $1`,
    [skyId, encryptSecret(secret)],
  );
  return { ok: true, method: 'app', secret, uri: otpauthUri(secret, label, 'Sky ID') };
};

export const confirmSkyTwoFactor = async (skyId, code) => {
  const { rows } = await query(
    'SELECT two_factor_secret, two_factor_method FROM sky_ids WHERE id = $1', [skyId],
  );
  if (!rows[0]) return { error: 'not_found' };

  if (rows[0].two_factor_method === 'email') {
    const check = await checkEmailCode(skyId, null, code, 'setup');
    if (check.error) return check;
  } else {
    const secret = decryptSecret(rows[0].two_factor_secret);
    if (!secret) return { error: 'not_started' };
    if (!verifyTotp(secret, code)) return { error: 'invalid_code' };
  }

  await query('UPDATE sky_ids SET two_factor_enabled = TRUE, updated_at = now() WHERE id = $1', [skyId]);
  return { ok: true };
};

export const verifySkyTwoFactor = async (skyId, code) => {
  const { rows } = await query(
    'SELECT two_factor_enabled, two_factor_secret, two_factor_method FROM sky_ids WHERE id = $1',
    [skyId],
  );
  if (!rows[0]?.two_factor_enabled) return { ok: true, skipped: true };

  if (rows[0].two_factor_method === 'email') return checkEmailCode(skyId, null, code, 'use');

  const secret = decryptSecret(rows[0].two_factor_secret);
  if (!secret) return { error: 'not_configured' };
  return verifyTotp(secret, code) ? { ok: true } : { error: 'invalid_code' };
};

export const disableSkyTwoFactor = async (skyId) => {
  await query(
    `UPDATE sky_ids SET two_factor_enabled = FALSE, two_factor_secret = NULL,
            two_factor_method = 'app', updated_at = now() WHERE id = $1`,
    [skyId],
  );
  return { ok: true };
};

/* ─── Профили ──────────────────────────────────────────────────────────── */

export const listProfiles = async (skyId) => {
  const { rows } = await query(`${PROFILE_SELECT} WHERE p.sky_id = $1 ORDER BY p.created_at`, [skyId]);
  return rows.map(toProfile);
};

/**
 * Профиль по id, но только внутри указанного Sky ID. Именно эта функция
 * закрывает подстановку чужого profile_id: чужая строка не вернётся.
 */
export const getProfileOfSkyId = async (skyId, profileId) => {
  const { rows } = await query(
    `${PROFILE_SELECT} WHERE p.id = $2 AND p.sky_id = $1`, [skyId, profileId],
  );
  return toProfile(rows[0]);
};

export const getProfileById = async (profileId) => {
  const { rows } = await query(`${PROFILE_SELECT} WHERE p.id = $1`, [profileId]);
  return toProfile(rows[0]);
};

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

export const createProfile = async (skyId, { name, username, avatar }) => {
  const cleanName = String(name ?? '').trim();
  const cleanUser = String(username ?? '').trim();

  if (cleanName.length < 2 || cleanName.length > 64) return { error: 'invalid_name' };
  if (!USERNAME_RE.test(cleanUser)) return { error: 'invalid_username' };

  const id = `acc-${generateId()}`;
  try {
    await query(
      `INSERT INTO profiles (id, sky_id, username, name, avatar)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, skyId, cleanUser, cleanName, avatar ?? null],
    );
  } catch (err) {
    if (err.code === '23505') return { error: 'username_taken' };
    // Триггер в БД не даёт создать третий профиль.
    if (err.message?.includes('profile_limit_reached')) return { error: 'profile_limit_reached' };
    throw err;
  }
  return { profile: await getProfileOfSkyId(skyId, id) };
};

export const updateProfile = async (skyId, profileId, patch) => {
  const owned = await getProfileOfSkyId(skyId, profileId);
  if (!owned) return { error: 'not_found' };

  const fields = [];
  const values = [skyId, profileId];
  if (patch.name !== undefined) {
    const v = String(patch.name).trim();
    if (v.length < 2 || v.length > 64) return { error: 'invalid_name' };
    values.push(v); fields.push(`name = $${values.length}`);
  }
  if (patch.avatar !== undefined) {
    values.push(patch.avatar ?? null); fields.push(`avatar = $${values.length}`);
  }
  if (fields.length === 0) return { profile: owned };

  await query(
    `UPDATE profiles SET ${fields.join(', ')}, updated_at = now()
      WHERE sky_id = $1 AND id = $2`, values,
  );
  return { profile: await getProfileOfSkyId(skyId, profileId) };
};

/* ─── Двухэтапная защита профиля ───────────────────────────────────────── */
/*  Независима от защиты Sky ID: включение одной ничего не делает с другой,
    и защита первого профиля не распространяется на второй.               */

export const beginProfileTwoFactor = async (skyId, profileId, method = 'app') => {
  if (!TWO_FACTOR_METHODS.includes(method)) return { error: 'invalid_method' };

  const profile = await getProfileOfSkyId(skyId, profileId);
  if (!profile) return { error: 'not_found' };
  // Как и у Sky ID: включённую защиту нельзя сбросить началом настройки.
  if (profile.twoFactorEnabled) return { error: 'already_enabled' };

  if (method === 'email') {
    const sent = await sendTwoFactorEmail(skyId, profileId, 'setup');
    if (sent.error) return sent;
    await query(
      `UPDATE profiles SET two_factor_method = 'email', two_factor_secret = NULL,
              two_factor_enabled = FALSE, updated_at = now() WHERE sky_id = $1 AND id = $2`,
      [skyId, profileId],
    );
    return { ok: true, method: 'email', email: sent.email, retryAfter: sent.retryAfter };
  }

  const secret = generateSecret();
  await query(
    `UPDATE profiles SET two_factor_secret = $3, two_factor_method = 'app',
            two_factor_enabled = FALSE, updated_at = now() WHERE sky_id = $1 AND id = $2`,
    [skyId, profileId, encryptSecret(secret)],
  );
  return { ok: true, method: 'app', secret, uri: otpauthUri(secret, `${profile.username} (профиль)`, 'Sky ID') };
};

export const confirmProfileTwoFactor = async (skyId, profileId, code) => {
  const { rows } = await query(
    'SELECT two_factor_secret, two_factor_method FROM profiles WHERE sky_id = $1 AND id = $2',
    [skyId, profileId],
  );
  if (!rows[0]) return { error: 'not_found' };

  if (rows[0].two_factor_method === 'email') {
    const check = await checkEmailCode(skyId, profileId, code, 'setup');
    if (check.error) return check;
  } else {
    const secret = decryptSecret(rows[0].two_factor_secret);
    if (!secret) return { error: 'not_started' };
    if (!verifyTotp(secret, code)) return { error: 'invalid_code' };
  }

  await query(
    'UPDATE profiles SET two_factor_enabled = TRUE, updated_at = now() WHERE sky_id = $1 AND id = $2',
    [skyId, profileId],
  );
  return { ok: true };
};

export const verifyProfileTwoFactor = async (skyId, profileId, code) => {
  const { rows } = await query(
    `SELECT two_factor_enabled, two_factor_secret, two_factor_method
       FROM profiles WHERE sky_id = $1 AND id = $2`,
    [skyId, profileId],
  );
  if (!rows[0]) return { error: 'not_found' };
  if (!rows[0].two_factor_enabled) return { ok: true, skipped: true };

  if (rows[0].two_factor_method === 'email') return checkEmailCode(skyId, profileId, code, 'use');

  const secret = decryptSecret(rows[0].two_factor_secret);
  if (!secret) return { error: 'not_configured' };
  return verifyTotp(secret, code) ? { ok: true } : { error: 'invalid_code' };
};

export const disableProfileTwoFactor = async (skyId, profileId) => {
  const { rowCount } = await query(
    `UPDATE profiles SET two_factor_enabled = FALSE, two_factor_secret = NULL,
            two_factor_method = 'app', updated_at = now()
      WHERE sky_id = $1 AND id = $2`,
    [skyId, profileId],
  );
  return rowCount === 1 ? { ok: true } : { error: 'not_found' };
};

/* ─── Prime ────────────────────────────────────────────────────────────── */

/**
 * Выдаёт Prime конкретному профилю. Профиль проверяется на принадлежность
 * Sky ID: подставив чужой id, Prime себе не выпишешь.
 *
 * Прежняя активная подписка помечается завершённой, чтобы у профиля не
 * копилось несколько активных строк.
 */
export const grantPrime = async (skyId, profileId, plan, days) => {
  const owned = await getProfileOfSkyId(skyId, profileId);
  if (!owned) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE prime_subscriptions SET status = 'expired' WHERE profile_id = $1 AND status = 'active'`,
      [profileId],
    );
    const expires = days ? new Date(Date.now() + days * 86400_000) : null;
    await client.query(
      `INSERT INTO prime_subscriptions (id, profile_id, status, plan, expires_at)
       VALUES ($1,$2,'active',$3,$4)`,
      [`prime-${generateId()}`, profileId, String(plan ?? 'standard'), expires],
    );
    // Флаг в профиле — производное значение, держим его в согласии
    // с подпиской, чтобы существующий код приложения не расходился с БД.
    await client.query('UPDATE profiles SET is_prime = TRUE, updated_at = now() WHERE id = $1', [profileId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { profile: await getProfileOfSkyId(skyId, profileId) };
};

export const revokePrime = async (skyId, profileId) => {
  const owned = await getProfileOfSkyId(skyId, profileId);
  if (!owned) return { error: 'not_found' };
  await query(
    `UPDATE prime_subscriptions SET status = 'cancelled' WHERE profile_id = $1 AND status = 'active'`,
    [profileId],
  );
  await query('UPDATE profiles SET is_prime = FALSE, updated_at = now() WHERE id = $1', [profileId]);
  return { profile: await getProfileOfSkyId(skyId, profileId) };
};

/** Гасит подписки, у которых истёк срок. Вызывается по расписанию. */
export const expirePrimeSubscriptions = async () => {
  const { rows } = await query(
    `UPDATE prime_subscriptions SET status = 'expired'
      WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()
      RETURNING profile_id`,
  );
  for (const r of rows) {
    await query('UPDATE profiles SET is_prime = FALSE WHERE id = $1', [r.profile_id]);
  }
  return rows.length;
};
