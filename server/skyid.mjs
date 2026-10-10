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
import { generateId, sanitizeInput, rateLimit, rateLimitPerHour } from './security.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { generateSecret, verifyTotp, otpauthUri } from './totp.mjs';
import { mayClaimUsername } from './admin.mjs';
import { issueCode, verifyCode } from './verification.mjs';
import { isOwnerUsername } from './admin.mjs';
import { getPrivacy, isContact } from './privacy.mjs';
import { isValidRegion } from './regions.mjs';

/** Максимум профилей в одном Sky ID. Дублируется триггером в БД. */
export const MAX_PROFILES = 2;

/**
 * Цены подписки Prime в рублях по сроку — единственная таблица на весь
 * сервер (самостоятельная покупка, routes/skyid.mjs, и подарок Prime,
 * primegifts.mjs, читают её отсюда). Присланную клиентом цену никто не
 * читает нигде: её всегда считает сервер по этой таблице.
 */
export const PRIME_PRICES = { 30: 399, 90: 1090, 180: 2090, 365: 3790, 730: 6990 };

/* ─── Представление наружу ─────────────────────────────────────────────── */

const toSkyId = (row) => row && ({
  id:               row.id,
  phone:            row.phone ?? undefined,
  phoneVerified:    Boolean(row.phone_verified),
  email:            row.email ?? undefined,
  emailVerified:    row.email_verified,
  twoFactorEnabled: row.two_factor_enabled,
  twoFactorMethod:  row.two_factor_method ?? 'app',
  // Сам хеш наружу никогда не идёт — только факт, что вход паролем
  // включён, чтобы экран настроек знал, что показать: «задать» или
  // «сменить».
  passwordSet:      Boolean(row.password_hash),
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
  bio:      row.bio ?? undefined,
  banner:   row.banner ?? undefined,
  // Косметика расширенного профиля (EditExtendedProfileSheet) — см.
  // миграцию 074. Раньше жила только в localStorage, поэтому у другого
  // человека и на другом устройстве не появлялась никогда.
  customStatus: row.profile_extra?.customStatus ?? undefined,
  statusEmoji:  row.profile_extra?.statusEmoji ?? undefined,
  links:        Array.isArray(row.profile_extra?.links) ? row.profile_extra.links : undefined,
  country:      row.profile_extra?.country ?? undefined,
  language:     row.profile_extra?.language ?? undefined,
  timezone:     row.profile_extra?.timezone ?? undefined,
  nameSticker:  row.profile_extra?.nameSticker ?? undefined,
  nameColor:    row.profile_extra?.nameColor ?? undefined,
  // Самостоятельно указанный день рождения для социального отображения —
  // не то же самое, что date_of_birth: та колонка подтверждается через
  // courierverify.mjs для курьерской проверки совершеннолетия, и косметическая
  // правка отсюда не должна иметь к ней никакого отношения.
  birthDate:    row.profile_extra?.birthDate ?? undefined,
  // Право, а не колонка. Владелец — администратор по нику из .env, и
  // колонка is_admin у него при этом стоит в false. Сервер это знает
  // (isAdmin в admin.mjs) и пускал владельца всюду, а вот в профиль
  // уходило голое значение колонки — и панель администратора у хозяина
  // сервиса просто не появлялась.
  isAdmin:  Boolean(row.is_admin) || isOwnerUsername(row.username),
  isPrime:  Boolean(row.prime_active),
  primeUntil: row.prime_expires_at ? row.prime_expires_at.toISOString() : undefined,
  primePlan:  row.prime_plan ?? undefined,
  twoFactorEnabled: row.two_factor_enabled,
  twoFactorMethod:  row.two_factor_method ?? 'app',
  createdAt: row.created_at.toISOString(),
  // Регион уже существующей системы смены региона (src/region), просто
  // сохранённый на сервере — см. server/regions.mjs.
  regionCode: row.region_code ?? undefined,
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

export const findSkyIdByEmail = async (email) => {
  const { rows } = await query(
    'SELECT * FROM sky_ids WHERE lower(email) = lower($1) AND email_verified', [String(email)],
  );
  return rows[0] ?? null;
};

/**
 * Заводит Sky ID под номер или возвращает существующий.
 *
 * Остаётся для аккаунтов, заведённых до перехода на почту, и для тех,
 * кто предпочитает вход по SMS.
 */
export const ensureSkyId = async (phone) => {
  const existing = await findSkyIdByPhone(phone);
  if (existing) return { skyId: existing, created: false };

  const id = `sky-${generateId()}`;
  const { rows } = await query(
    // Без указания столбца: уникальный индекс на телефон теперь
    // частичный (только для непустых), и вывести его по имени столбца
    // Postgres не берётся.
    `INSERT INTO sky_ids (id, phone, phone_verified) VALUES ($1,$2,TRUE)
     ON CONFLICT DO NOTHING RETURNING *`,
    [id, String(phone)],
  );
  // Конфликт значит, что параллельный запрос успел раньше — берём его.
  if (!rows[0]) return { skyId: await findSkyIdByPhone(phone), created: false };
  return { skyId: rows[0], created: true };
};

/**
 * То же для почты — основного способа входа.
 *
 * Адрес считается подтверждённым сразу: сюда попадают только после
 * верного кода из письма, а он и есть подтверждение.
 */
export const ensureSkyIdByEmail = async (email) => {
  const clean = String(email).toLowerCase();
  const existing = await findSkyIdByEmail(clean);
  if (existing) return { skyId: existing, created: false };

  const id = `sky-${generateId()}`;
  const { rows } = await query(
    `INSERT INTO sky_ids (id, email, email_verified) VALUES ($1,$2,TRUE)
     ON CONFLICT DO NOTHING RETURNING *`,
    [id, clean],
  );
  if (!rows[0]) return { skyId: await findSkyIdByEmail(clean), created: false };
  return { skyId: rows[0], created: true };
};

/** Привязывает подтверждённый номер к существующему Sky ID. */
export const setPhoneVerified = async (skyId, phone) => {
  try {
    const { rows } = await query(
      `UPDATE sky_ids SET phone = $2, phone_verified = TRUE, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [skyId, String(phone)],
    );
    return { skyId: rows[0] };
  } catch (err) {
    // 23505 — номер уже привязан к другому Sky ID.
    if (err.code === '23505') return { error: 'phone_taken' };
    throw err;
  }
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
 * 'sms'   — код приходит на подтверждённый номер.
 *
 * Смысл второго фактора в том, что канал ДРУГОЙ. Код на тот же адрес,
 * которым вошли, ничего не добавляет: кто получил первый, получит и
 * второй. Проверку этого делает вызывающая сторона — она знает, каким
 * способом человек вошёл.
 */
export const TWO_FACTOR_METHODS = ['app', 'email', 'sms'];

/**
 * Назначение кода. Включает и цель, и этап: код для включения защиты и
 * код для входа не должны делить одну паузу между отправками. Иначе
 * сразу после включения защиты профиль минуту нельзя было бы открыть —
 * прежний код уже потрачен, а новый ещё нельзя выслать.
 */
const codePurpose = (skyId, profileId, stage) =>
  `${profileId ? `2fa-profile:${profileId}` : `2fa-sky:${skyId}`}:${stage}`;

/** Идёт настройка (защита ещё не включена) или обычная проверка. */
const stageOf = (enabled) => (enabled ? 'use' : 'setup');

const twoFactorState = async (skyId, profileId) => {
  const { rows } = profileId
    ? await query('SELECT two_factor_enabled AS on FROM profiles WHERE sky_id = $1 AND id = $2', [skyId, profileId])
    : await query('SELECT two_factor_enabled AS on FROM sky_ids WHERE id = $1', [skyId]);
  return rows[0] ? stageOf(rows[0].on) : null;
};

/** Куда слать код выбранным способом: почта или телефон. */
const destinationFor = async (skyId, method) => {
  const { rows } = await query(
    'SELECT email, email_verified, phone, phone_verified FROM sky_ids WHERE id = $1', [skyId],
  );
  const row = rows[0];
  if (!row) return { error: 'not_found' };
  if (method === 'email') {
    return row.email_verified ? { channel: 'email', to: row.email } : { error: 'email_not_verified' };
  }
  if (method === 'sms') {
    return row.phone_verified ? { channel: 'phone', to: row.phone } : { error: 'phone_not_verified' };
  }
  return { error: 'invalid_method' };
};

/** Каким способом настроена защита — у Sky ID или у профиля. */
const methodOf = async (skyId, profileId) => {
  const { rows } = profileId
    ? await query('SELECT two_factor_method AS m FROM profiles WHERE sky_id = $1 AND id = $2', [skyId, profileId])
    : await query('SELECT two_factor_method AS m FROM sky_ids WHERE id = $1', [skyId]);
  return rows[0]?.m ?? null;
};

/**
 * Отправляет код второго фактора выбранным способом.
 *
 * method не передан — берём тот, что записан: при повторной отправке
 * гадать не нужно, способ уже выбран.
 */
export const sendTwoFactorCode = async (skyId, profileId = null, stage = null, method = null) => {
  const how = method ?? await methodOf(skyId, profileId);
  if (!how || how === 'app') return { error: 'invalid_method' };

  const dest = await destinationFor(skyId, how);
  if (dest.error) return dest;

  const at = stage ?? await twoFactorState(skyId, profileId);
  if (!at) return { error: 'not_found' };

  const result = await issueCode(dest.channel, dest.to, codePurpose(skyId, profileId, at));
  if (result.error) return { error: result.error, retryAfter: result.retryAfter };
  return {
    ok: true, retryAfter: result.retryAfter, expiresIn: result.expiresIn,
    method: how, email: how === 'email' ? dest.to : undefined,
    phone: how === 'sms' ? dest.to : undefined,
  };
};

const checkTwoFactorCode = async (skyId, profileId, code, stage, method = null) => {
  const how = method ?? await methodOf(skyId, profileId);
  const dest = await destinationFor(skyId, how);
  if (dest.error) return dest;
  const result = await verifyCode(dest.channel, dest.to, codePurpose(skyId, profileId, stage), code);
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

  if (method !== 'app') {
    const sent = await sendTwoFactorCode(skyId, null, 'setup', method);
    if (sent.error) return sent;
    await query(
      `UPDATE sky_ids SET two_factor_method = $2, two_factor_secret = NULL,
              two_factor_enabled = FALSE, updated_at = now() WHERE id = $1`,
      [skyId, method],
    );
    return { ok: true, method, email: sent.email, phone: sent.phone, retryAfter: sent.retryAfter };
  }

  const secret = generateSecret();
  await query(
    `UPDATE sky_ids SET two_factor_secret = $2, two_factor_method = 'app',
            two_factor_enabled = FALSE, updated_at = now() WHERE id = $1`,
    [skyId, encryptSecret(secret)],
  );
  return { ok: true, method: 'app', secret, uri: otpauthUri(secret, label, 'Sky ID') };
};

/**
 * Код из приложения-аутентификатора не похож на письмо или смс — для
 * него нет отдельной строки в базе, по которой verifyCode() в
 * verification.mjs сам считает попытки. Проверка здесь — голое
 * сравнение с текущим TOTP, а 6 цифр без предела перебираются за
 * разумное время. Тот же предел по ключу, что у входа по паролю
 * (pwlogin в routes/password.mjs): на минуту и на час, по цели попытки,
 * а не по IP атакующего — он может сменить IP, цель нет.
 */
const totpAttemptOk = (key) => rateLimit(`2fa:app:${key}`, 10) && rateLimitPerHour(`2fa:app:${key}`, 30);

export const confirmSkyTwoFactor = async (skyId, code) => {
  const { rows } = await query(
    'SELECT two_factor_secret, two_factor_method FROM sky_ids WHERE id = $1', [skyId],
  );
  if (!rows[0]) return { error: 'not_found' };

  if (rows[0].two_factor_method !== 'app') {
    const check = await checkTwoFactorCode(skyId, null, code, 'setup');
    if (check.error) return check;
  } else {
    if (!totpAttemptOk(skyId)) return { error: 'too_many_attempts' };
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

  if (rows[0].two_factor_method !== 'app') return checkTwoFactorCode(skyId, null, code, 'use');

  if (!totpAttemptOk(skyId)) return { error: 'too_many_attempts' };
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

/**
 * Профиль для просмотра кем угодно — тот минимум, что видно о человеке
 * без единой общей группы и без переписки: имя, ник, аватар, Prime.
 *
 * Не toProfile целиком: там есть twoFactorEnabled и twoFactorMethod —
 * это устройство защиты владельца, а не что-то для показа посторонним.
 * Настройки приватности отдаются как есть, а не применяются здесь —
 * решение, что после них можно показать (друзей, посты, игры), остаётся
 * за экраном профиля.
 *
 * Косметика расширенного профиля (banner/bio/nameColor/nameSticker/
 * customStatus/statusEmoji/links/country/language/timezone/birthDate)
 * сервер хранит с миграции 074 (см. toProfile выше), но эта функция
 * раньше их не отдавала — владелец настраивал их в своём профиле,
 * они сохранялись, а другие люди всё равно видели старый пустой
 * профиль. showCountry/showTimezone/showActivity — то же самое, что
 * уже решает клиентский canSee() по privacy.profileVisibility; для
 * полей без отдельного тумблера (banner/bio/nameColor/nameSticker/
 * customStatus/links) видимость та же, что у аватара — показываются
 * всем, потому что отдельного переключателя для них ещё нет.
 */
export const publicProfile = async (viewerId, targetId) => {
  const p = await getProfileById(String(targetId ?? ''));
  if (!p) return null;
  const privacy = await getPrivacy(p.id);
  return {
    id: p.id,
    name: p.name,
    username: p.username,
    avatar: p.avatar,
    bio: p.bio,
    banner: p.banner,
    nameSticker: p.nameSticker,
    nameColor: p.nameColor,
    customStatus: p.customStatus,
    statusEmoji: p.statusEmoji,
    links: p.links,
    country: p.country,
    language: p.language,
    timezone: p.timezone,
    birthDate: p.birthDate,
    isAdmin: p.isAdmin,
    isPrime: p.isPrime,
    primeUntil: p.primeUntil,
    createdAt: p.createdAt,
    isContact: viewerId ? await isContact(viewerId, p.id) : false,
    privacy: {
      whoCanWrite: privacy.whoCanWrite,
      whoCanCall: privacy.whoCanCall,
      whoSeesOnline: privacy.whoSeesOnline,
      ...privacy.profileVisibility,
    },
  };
};

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

export const createProfile = async (skyId, { name, username, avatar, ownerClaim }) => {
  const cleanName = String(name ?? '').trim();
  const cleanUser = String(username ?? '').trim();

  if (cleanName.length < 2 || cleanName.length > 64) return { error: 'invalid_name' };
  if (!USERNAME_RE.test(cleanUser)) return { error: 'invalid_username' };

  /* Ник владельца — не обычный ник: из него выводятся права владельца
     всей экосистемы. Пока он свободен, зарегистрировавшийся под ним
     получал бы сервис целиком. Занять его можно только одноразовым
     ключом из окружения — см. mayClaimUsername. */
  const claim = await mayClaimUsername(cleanUser, ownerClaim);
  if (!claim.ok) return { error: claim.error };

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

/** Косметические поля расширенного профиля — см. миграцию 074. Список и
    длины те же, что уже были у полей в EditExtendedProfileSheet, только
    раньше их некому было проверить: значения оседали в localStorage. */
const EXTRA_FIELDS = {
  customStatus: 120,
  statusEmoji:  16,
  country:      60,
  language:     30,
  timezone:     60,
  nameSticker:  30,
  nameColor:    20,
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
  if (patch.banner !== undefined) {
    // Формат/размер уже проверены sanitizeAvatar в routes/skyid.mjs — тем
    // же способом, что и у avatar.
    values.push(patch.banner ?? null); fields.push(`banner = $${values.length}`);
  }
  if (patch.bio !== undefined) {
    const v = String(patch.bio ?? '').trim();
    if (v.length > 300) return { error: 'invalid_bio' };
    values.push(v || null); fields.push(`bio = $${values.length}`);
  }
  if (patch.regionCode !== undefined) {
    // Тот же список кодов, что и в уже существующем RegionPicker
    // (src/region) — сервер только сохраняет то, что человек там уже
    // выбрал, и отвергает всё, чего в этом списке нет.
    const v = String(patch.regionCode ?? '').toUpperCase().trim();
    if (v && !isValidRegion(v)) return { error: 'invalid_region' };
    values.push(v || null); fields.push(`region_code = $${values.length}`);
  }
  if (patch.extra && typeof patch.extra === 'object') {
    // Известные ключи с проверкой длины сливаются в уже сохранённый
    // объект (owned уже несёт его распакованным — см. toProfile выше);
    // неизвестные ключи и слишком длинные значения отбрасываются молча —
    // тот же приём, что и у VISIBILITY_KEYS в privacy.mjs.
    const current = {};
    for (const key of Object.keys(EXTRA_FIELDS)) if (owned[key] !== undefined) current[key] = owned[key];
    if (Array.isArray(owned.links)) current.links = owned.links;
    if (owned.birthDate !== undefined) current.birthDate = owned.birthDate;
    for (const [key, max] of Object.entries(EXTRA_FIELDS)) {
      if (patch.extra[key] === undefined) continue;
      const v = sanitizeInput(patch.extra[key] ?? '');
      if (v.length > max) return { error: 'invalid_extra' };
      if (v) current[key] = v; else delete current[key];
    }
    if (patch.extra.links !== undefined) {
      const links = Array.isArray(patch.extra.links) ? patch.extra.links : [];
      if (links.length > 5 || links.some((l) => typeof l !== 'string' || l.length > 200)) {
        return { error: 'invalid_extra' };
      }
      if (links.length) current.links = links.map((l) => sanitizeInput(l)).filter(Boolean);
      else delete current.links;
    }
    if (patch.extra.birthDate !== undefined) {
      const v = String(patch.extra.birthDate ?? '').trim();
      if (v) {
        // Косметическая дата, не проверка возраста — просто формат и
        // разумные границы, чтобы не хранить мусор.
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
        const year = m ? Number(m[1]) : NaN;
        if (!m || Number.isNaN(Date.parse(v)) || year < 1900 || year > new Date().getFullYear()) {
          return { error: 'invalid_extra' };
        }
        current.birthDate = v;
      } else {
        delete current.birthDate;
      }
    }
    values.push(JSON.stringify(current)); fields.push(`profile_extra = $${values.length}::jsonb`);
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

  if (method !== 'app') {
    const sent = await sendTwoFactorCode(skyId, profileId, 'setup', method);
    if (sent.error) return sent;
    await query(
      `UPDATE profiles SET two_factor_method = $3, two_factor_secret = NULL,
              two_factor_enabled = FALSE, updated_at = now() WHERE sky_id = $1 AND id = $2`,
      [skyId, profileId, method],
    );
    return { ok: true, method, email: sent.email, phone: sent.phone, retryAfter: sent.retryAfter };
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

  if (rows[0].two_factor_method !== 'app') {
    const check = await checkTwoFactorCode(skyId, profileId, code, 'setup');
    if (check.error) return check;
  } else {
    if (!totpAttemptOk(`${skyId}:${profileId}`)) return { error: 'too_many_attempts' };
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

  if (rows[0].two_factor_method !== 'app') return checkTwoFactorCode(skyId, profileId, code, 'use');

  if (!totpAttemptOk(`${skyId}:${profileId}`)) return { error: 'too_many_attempts' };
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
/**
 * Есть ли у профиля действующая подписка Prime.
 *
 * Правда — в таблице подписок, а не во флаге profiles.is_prime: флаг
 * удобен для показа, но истечь сам он не умеет.
 */
export const hasPrime = async (profileId) => {
  if (!profileId) return false;
  const { rows } = await query(
    `SELECT EXISTS (
       SELECT 1 FROM prime_subscriptions
        WHERE profile_id = $1 AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())
     ) AS ok`,
    [String(profileId)],
  );
  return rows[0]?.ok === true;
};

/**
 * `additive: true` не заменяет действующую подписку, а прибавляет
 * дни к её остатку — для подарка Prime: если у получателя Prime уже
 * активен, подарок должен продлить срок, а не обнулить то, что уже
 * было оплачено. Без этого флага (все прежние вызывающие — админ-
 * начисление, награда мероприятия, самостоятельная покупка) поведение
 * не меняется: старая подписка истекает, новая считает от «сейчас».
 */
/**
 * Ядро выдачи Prime внутри ЧУЖОЙ транзакции (BEGIN/COMMIT держит
 * вызывающий). Возвращает { skipped: true }, если подписка уже
 * бессрочная и прибавлять дни некуда.
 */
export const grantPrimeIn = async (client, profileId, plan, days, opts = {}) => {
  const additive = opts?.additive === true;
  let base = Date.now();
  if (additive) {
    const { rows: activeRows } = await client.query(
      `SELECT expires_at FROM prime_subscriptions
        WHERE profile_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
        FOR UPDATE`,
      [profileId],
    );
    if (activeRows[0] && activeRows[0].expires_at === null) {
      // Уже бессрочный Prime — добавлять дни некуда, но подарок не пропадает:
      // подписка остаётся такой же бессрочной.
      return { skipped: true };
    }
    const currentExpiry = activeRows[0]?.expires_at;
    if (currentExpiry && currentExpiry.getTime() > base) base = currentExpiry.getTime();
  }

  await client.query(
    `UPDATE prime_subscriptions SET status = 'expired' WHERE profile_id = $1 AND status = 'active'`,
    [profileId],
  );
  const expires = days ? new Date(base + days * 86400_000) : null;
  await client.query(
    `INSERT INTO prime_subscriptions (id, profile_id, status, plan, expires_at)
     VALUES ($1,$2,'active',$3,$4)`,
    [`prime-${generateId()}`, profileId, String(plan ?? 'standard'), expires],
  );
  // Флаг в профиле — производное значение, держим его в согласии
  // с подпиской, чтобы существующий код приложения не расходился с БД.
  await client.query('UPDATE profiles SET is_prime = TRUE, updated_at = now() WHERE id = $1', [profileId]);
  return { expires };
};

export const grantPrime = async (skyId, profileId, plan, days, opts = {}) => {
  const owned = await getProfileOfSkyId(skyId, profileId);
  if (!owned) return { error: 'not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await grantPrimeIn(client, profileId, plan, days, opts);
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
