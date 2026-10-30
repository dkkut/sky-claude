/**
 * Второй, необязательный способ входа: почта → пароль.
 *
 * Существующий вход — код на почту или SMS, с двухэтапной защитой
 * поверх, — этот файл не трогает и ничего в нём не меняет. Пароль это
 * отдельная, добровольная привязка к уже существующему Sky ID:
 *
 *   1. Человек уже вошёл обычным способом (код на почту).
 *   2. Заводит пароль здесь — тоже с подтверждением кодом, иначе
 *      получивший на минуту чужую открытую сессию мог бы тихо оставить
 *      себе постоянный ход в аккаунт.
 *   3. Дальше можно входить и кодом по-прежнему, и почтой с паролем —
 *      оба способа ведут в один и тот же Sky ID.
 *
 * Пароль сам по себе слабее кода: его можно списать, подсмотреть,
 * переиспользовать с другого сайта. Предупреждение об этом клиент
 * показывает на экране; здесь — только техническая защита того, что
 * подсказкой не закрыть: перебор, безопасное хранение хеша, обязательный
 * сброс всех сессий при смене пароля.
 */
import { config } from './../config.mjs';
import { query } from './../db.mjs';
import { hashPassword, verifyPassword, generateId, rateLimit, rateLimitPerHour, signToken } from './../security.mjs';
import { sessionStore } from './../sessions.mjs';
import { json, parseBody, readSession, appBody, deviceMeta } from './../http.mjs';
import { issueCode, verifyCode, cooldownLeft, VERIFICATION_LIMITS } from './../verification.mjs';
import { findSkyIdById, findSkyIdByEmail, sendTwoFactorCode } from './../skyid.mjs';
import { sendEmail } from './../notify.mjs';
import { noteAdminBreachSignal } from './../breach.mjs';
import { clientIp } from './../http.mjs';
import { maskEmail, normalizeEmail, startSession, issueTokens } from './auth.mjs';

/** Пароль: не короче, чтобы не подбирался за секунды, не длиннее
    разумного, чтобы вход не превращался в загрузку файла. */
const MIN_LEN = 8;
const MAX_LEN = 200;

/** После стольких неверных паролей подряд аккаунт временно не пускает
    даже верный — обычный предел на IP такое не ловит, если перебор
    идёт с разных адресов. */
const MAX_FAILS = 8;
const LOCK_MINUTES = 15;

const badPassword = (pwd, email) => {
  if (typeof pwd !== 'string') return 'bad_password';
  if (pwd.length < MIN_LEN) return 'password_too_short';
  if (pwd.length > MAX_LEN) return 'password_too_long';
  // Пароль, совпадающий с почтой целиком, не защищает вообще: тот,
  // кто знает адрес для входа, знал бы и пароль.
  if (email && pwd.toLowerCase() === String(email).toLowerCase()) return 'password_too_weak';
  return null;
};

/** Взводит и списывает счётчик неудач. Не бросает — сама блокировка не
    должна уронить запрос, если что-то пошло не так с записью счётчика. */
const noteFailure = async (skyId) => {
  const { rows } = await query(
    `UPDATE sky_ids SET password_fail_count = password_fail_count + 1,
            password_locked_until = CASE
              WHEN password_fail_count + 1 >= $2
                THEN now() + ($3 || ' minutes')::interval
              ELSE password_locked_until
            END
      WHERE id = $1
      RETURNING password_fail_count`,
    [skyId, MAX_FAILS, LOCK_MINUTES],
  );
  return rows[0]?.password_fail_count ?? 0;
};

/**
 * Письмо о блокировке — единственный момент, когда владелец узнаёт,
 * что его пароль прямо сейчас подбирают: сама блокировка это не
 * останавливает перебор, а делает его на время бессмысленным, но
 * молча — без письма атакующий просто попробует через 15 минут снова,
 * а владелец так и не узнает. Отправка не должна блокировать ответ:
 * вызывается без await, ошибка только в журнал.
 */
const notifyLockout = async (skyId) => {
  if (!skyId.email || !skyId.email_verified) return;
  await sendEmail(
    skyId.email,
    'Подозрительная активность: вход в Sky ID временно заблокирован',
    `Подряд ${MAX_FAILS} раз ввели неверный пароль от вашего Sky ID — похоже, кто-то его ` +
    `подбирает. Вход паролем закрыт на ${LOCK_MINUTES} минут, остальные способы входа ` +
    '(код на почту/телефон) работают как обычно.\n\n' +
    'Если это были не вы — после снятия блокировки смените пароль и проверьте список ' +
    'устройств в Настройках.',
  );
};

const clearFailures = async (skyId) => {
  await query(
    'UPDATE sky_ids SET password_fail_count = 0, password_locked_until = NULL WHERE id = $1',
    [skyId],
  );
};

const isLocked = (row) => Boolean(row.password_locked_until && row.password_locked_until > new Date());

export const passwordRoutes = async (req, res, url) => {
  /* ══ Завести пароль на своём аккаунте ═══════════════════════════════
     Требует активный вход обычным способом плюс свежий код — заводить
     пароль по одной украденной на минуту сессии нельзя. */

  if (req.method === 'POST' && url === '/api/auth/password/setup/start') {
    const session = await readSession(req);
    if (!session) return json(res, 401, { error: 'unauthorized' });
    const skyId = await findSkyIdById(session.skyId);
    if (!skyId) return json(res, 401, { error: 'unauthorized' });
    if (!skyId.email || !skyId.email_verified) {
      return json(res, 409, { error: 'email_required' });
    }
    if (!rateLimit(`pwsetup:${session.skyId}`, 5)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    const result = await issueCode('email', skyId.email, 'password_set');
    if (result.error === 'too_soon') return json(res, 429, { error: 'too_soon', retryAfter: result.retryAfter });
    if (result.error) return json(res, /_(failed|not_configured)$/.test(result.error) ? 503 : 429, { error: result.error });
    return json(res, 200, {
      ok: true, email: maskEmail(skyId.email),
      retryAfter: result.retryAfter, expiresIn: result.expiresIn, codeLength: 6,
    });
  }

  if (req.method === 'POST' && url === '/api/auth/password/setup') {
    const session = await readSession(req);
    if (!session) return json(res, 401, { error: 'unauthorized' });
    const skyId = await findSkyIdById(session.skyId);
    if (!skyId) return json(res, 401, { error: 'unauthorized' });
    if (!skyId.email || !skyId.email_verified) {
      return json(res, 409, { error: 'email_required' });
    }

    const body = await parseBody(req);
    const bad = badPassword(body.password, skyId.email);
    if (bad) return json(res, 400, { error: bad });

    const check = await verifyCode('email', skyId.email, 'password_set', body.code);
    if (check.error) return json(res, 401, { error: check.error, attemptsLeft: check.attemptsLeft });

    const hash = await hashPassword(body.password);
    await query(
      `UPDATE sky_ids SET password_hash = $2, password_set_at = now(),
              password_fail_count = 0, password_locked_until = NULL
        WHERE id = $1`,
      [skyId.id, hash],
    );
    // Заводит новый способ входа, а не подозрение на взлом: остальные
    // устройства этим действием трогать незачем.
    return json(res, 200, { ok: true });
  }

  /* ══ Сменить уже заведённый пароль, зная старый ═══════════════════ */
  if (req.method === 'POST' && url === '/api/auth/password/change') {
    const session = await readSession(req);
    if (!session) return json(res, 401, { error: 'unauthorized' });
    const skyId = await findSkyIdById(session.skyId);
    if (!skyId) return json(res, 401, { error: 'unauthorized' });
    if (!skyId.password_hash) return json(res, 409, { error: 'no_password_set' });

    const body = await parseBody(req);
    if (!rateLimit(`pwchange:${session.skyId}`, 10)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    const okOld = await verifyPassword(String(body.currentPassword ?? ''), skyId.password_hash);
    if (!okOld) return json(res, 401, { error: 'wrong_password' });

    const bad = badPassword(body.newPassword, skyId.email);
    if (bad) return json(res, 400, { error: bad });

    const hash = await hashPassword(body.newPassword);
    await query(
      `UPDATE sky_ids SET password_hash = $2, password_set_at = now(),
              password_fail_count = 0, password_locked_until = NULL
        WHERE id = $1`,
      [skyId.id, hash],
    );

    // Смена пароля — это ровно тот случай, для которого существует
    // revokeAllForUser: пароль мог утечь, и все чужие сессии должны
    // погаснуть. Своей взамен выдаём новую, чтобы сменивший пароль не
    // остался за дверью в собственном приложении.
    await sessionStore.revokeAllForUser(skyId.id);
    const sessionId = generateId();
    await sessionStore.put(
      { id: sessionId, userId: skyId.id, profileId: session.profileId, ...deviceMeta(req) },
      config.refreshTtlSec,
    );
    const tokens = issueTokens(skyId.id, sessionId, session.profileId);
    return json(res, 200,
                appBody(req, { ok: true, ...tokens.body }, { refreshToken: tokens.refreshToken }),
                { 'Set-Cookie': tokens.cookie });
  }

  /* ══ Убрать пароль как способ входа ═══════════════════════════════ */
  if (req.method === 'POST' && url === '/api/auth/password/remove') {
    const session = await readSession(req);
    if (!session) return json(res, 401, { error: 'unauthorized' });
    if (!rateLimit(`pwremove:${session.skyId}`, 10)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    await query(
      `UPDATE sky_ids SET password_hash = NULL, password_set_at = NULL,
              password_fail_count = 0, password_locked_until = NULL
        WHERE id = $1`,
      [session.skyId],
    );
    return json(res, 200, { ok: true });
  }

  /* ══ Вход почтой и паролем — без кода ══════════════════════════════ */
  if (req.method === 'POST' && url === '/api/auth/password/login') {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    // Ответ на неверную почту и на неверный пароль один и тот же:
    // иначе по разнице ответов собирался бы список заведённых адресов.
    const fail = () => json(res, 401, { error: 'invalid_credentials' });
    if (!email) return fail();

    // Предел по адресу, а не только по IP: подбор пароля к одному
    // аккаунту с разных адресов IP-предел не остановит.
    if (!rateLimit(`pwlogin:${email}`, 10) || !rateLimitPerHour(`pwlogin:${email}`, 30)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    // И по адресу клиента: перебор «много почт × один пароль» (credential stuffing) предел по почте не ловит.
    const ipMult = Math.max(1, Number(process.env.AUTH_START_RATE_MULT) || 1);
    if (!rateLimit(`pwloginip:${clientIp(req)}`, 20 * ipMult) || !rateLimitPerHour(`pwloginip:${clientIp(req)}`, 300 * ipMult)) {
      return json(res, 429, { error: 'too_many_requests' });
    }

    const skyId = await findSkyIdByEmail(email);
    if (!skyId || !skyId.password_hash) {
      // Считаем и это попыткой в общий предел выше — своего Sky ID тут
      // нет, ставить блокировку не на что, дальше просто отказ.
      return fail();
    }
    if (isLocked(skyId)) return json(res, 429, { error: 'account_locked' });

    const good = await verifyPassword(String(body.password ?? ''), skyId.password_hash);
    if (!good) {
      const fails = await noteFailure(skyId.id);
      if (fails === MAX_FAILS) {
        notifyLockout(skyId).catch((err) => console.error('[password] письмо о блокировке:', err.message));
        noteAdminBreachSignal(skyId.id, 'password')
          .catch((err) => console.error('[password] сигнал о взломе администратора:', err.message));
      }
      return fail();
    }
    await clearFailures(skyId.id);

    if (skyId.two_factor_enabled) {
      // Тот же челлендж, что и у входа кодом: второй фактор не должен
      // становиться слабее оттого, что первый шаг сменился на пароль.
      const challenge = signToken(
        { sub: skyId.id, typ: '2fa-challenge' }, config.jwtSecret, 5 * 60,
      );
      let sent = null;
      if (skyId.two_factor_method !== 'app' && skyId.two_factor_method !== 'email') {
        const r = await sendTwoFactorCode(skyId.id, null, 'use');
        if (r.error && r.error !== 'too_soon') return json(res, 503, { error: r.error });
        sent = { retryAfter: r.retryAfter };
      }
      return json(res, 200, {
        needsTwoFactor: true, method: skyId.two_factor_method ?? 'app',
        sameChannel: skyId.two_factor_method === 'email',
        challenge, expiresIn: 5 * 60, ...(sent ?? {}),
      });
    }

    /* Вход по паролю тоже делает устройство доверенным для SkyMoney: пароль кошелёк всё равно спросит отдельно, а без этого
       при неработающей почте человек вообще не мог открыть кошелёк и историю. */
    const session = await startSession(skyId, req, { trust: true });
    return json(res, 200, appBody(req, session.body, { refreshToken: session.refreshToken }),
                { 'Set-Cookie': session.cookie });
  }

  /* ══ Забыли пароль ═════════════════════════════════════════════════
     Тот же анти-перебор адресов, что у обычного входа кодом: ответ
     одинаков независимо от того, есть ли аккаунт и есть ли у него
     пароль. */
  if (req.method === 'POST' && url === '/api/auth/password/forgot') {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    if (!email) return json(res, 400, { error: 'invalid_email' });

    const result = await issueCode('email', email, 'password_reset');
    if (result.error === 'too_soon') return json(res, 429, { error: 'too_soon', retryAfter: result.retryAfter });
    if (result.error) return json(res, /_(failed|not_configured)$/.test(result.error) ? 503 : 429, { error: result.error });
    return json(res, 200, {
      ok: true, retryAfter: result.retryAfter, expiresIn: result.expiresIn, codeLength: 6,
    });
  }

  if (req.method === 'POST' && url === '/api/auth/password/forgot/cooldown') {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    if (!email) return json(res, 400, { error: 'invalid_email' });
    return json(res, 200, {
      retryAfter: await cooldownLeft('email', email, 'password_reset'),
      limits: VERIFICATION_LIMITS,
    });
  }

  if (req.method === 'POST' && url === '/api/auth/password/reset') {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    if (!email) return json(res, 400, { error: 'invalid_email' });

    // Тот же предел по адресу, что у входа паролем: код сам ограничен
    // числом попыток, но ручку, что его проверяет, стоит ограничить и
    // отдельно — предел на код и предел на ручку защищают от разного.
    if (!rateLimit(`pwreset:${email}`, 10)) {
      return json(res, 429, { error: 'too_many_requests' });
    }

    const check = await verifyCode('email', email, 'password_reset', body.code);
    if (check.error) return json(res, 401, { error: check.error, attemptsLeft: check.attemptsLeft });

    // Аккаунта с таким адресом может не быть: код всё равно проверился
    // (он не выдаёт наличие аккаунта заранее), а поставить пароль
    // некому. Отвечаем тем же «ok», чтобы ответ ничего не выдавал.
    const skyId = await findSkyIdByEmail(email);
    if (!skyId) return json(res, 200, { ok: true });

    const bad = badPassword(body.password, email);
    if (bad) return json(res, 400, { error: bad });

    const hash = await hashPassword(body.password);
    await query(
      `UPDATE sky_ids SET password_hash = $2, password_set_at = now(),
              password_fail_count = 0, password_locked_until = NULL
        WHERE id = $1`,
      [skyId.id, hash],
    );
    // Сброс пароля — ровно тот случай, когда все сессии гасятся без
    // исключения: если это не хозяин аккаунта, а тот, кто получил
    // доступ к почте, настоящий хозяин должен увидеть, что его
    // разлогинило, а не тихо потерять устройства одно за другим.
    await sessionStore.revokeAllForUser(skyId.id);
    return json(res, 200, { ok: true });
  }

  return false;
};
