/**
 * Вход в Sky ID: телефон → SMS → (при необходимости) двухэтапная защита.
 *
 * Устройство сессии:
 *
 *   refresh-токен  — принадлежит Sky ID, лежит в HttpOnly-куке, живёт долго.
 *   access-токен   — короткий, несёт sky (аккаунт) и sub (активный профиль).
 *   challenge      — короткоживущий токен между вводом SMS и вводом
 *                    второго фактора; сам по себе доступа ни к чему не даёт.
 *
 * Про перебор номеров: ответ на запрос кода одинаков и для существующего
 * номера, и для нового. Узнать по нему, заведён ли аккаунт, нельзя.
 */
import { config } from './../config.mjs';
import { signToken, verifyToken, sanitizeInput } from './../security.mjs';
import { sessionStore } from './../sessions.mjs';
import { generateId } from './../security.mjs';
import { buildRefreshCookie, clearRefreshCookie } from './../cookies.mjs';
import { json, parseBody, readRefreshToken, readSession } from './../http.mjs';
import { issueCode, verifyCode, cooldownLeft, VERIFICATION_LIMITS } from './../verification.mjs';
import {
  ensureSkyId, findSkyIdById, publicSkyId, listProfiles,
  getProfileOfSkyId, verifySkyTwoFactor, sendTwoFactorEmail,
} from './../skyid.mjs';

/** Токен между SMS и вторым фактором живёт ровно столько, сколько нужно. */
const CHALLENGE_TTL_SEC = 5 * 60;

/**
 * Показываем почту так, чтобы человек узнал свою, но подсмотревший
 * из-за плеча не узнал чужую: a***@example.com.
 */
const maskEmail = (email) => {
  const value = String(email ?? '');
  const at = value.indexOf('@');
  if (at < 1) return '';
  return `${value[0]}***${value.slice(at)}`;
};

const PHONE_RE = /^\+?[0-9]{10,15}$/;
const normalizePhone = (raw) => {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '');
  return PHONE_RE.test(digits) ? digits : null;
};

/** Собирает пару токенов и куку для уже существующей сессии Sky ID. */
const issueTokens = (skyId, sessionId, profileId) => ({
  body: {
    accessToken: signToken(
      // sid нужен, чтобы смена профиля меняла саму сессию: refresh-кука
      // ограничена путём /api/auth и на другие маршруты не приходит.
      // Знание sid без подписанного токена ничего не даёт.
      { sub: profileId ?? null, sky: skyId, sid: sessionId, typ: 'access' },
      config.jwtSecret, config.accessTtlSec,
    ),
    expiresIn: config.accessTtlSec,
  },
  cookie: buildRefreshCookie(
    signToken({ sub: skyId, sid: sessionId, typ: 'refresh' }, config.refreshSecret, config.refreshTtlSec),
    config.refreshTtlSec,
  ),
});

/** Начинает сессию Sky ID и выбирает профиль по умолчанию, если он один. */
const startSession = async (skyIdRow) => {
  const profiles = await listProfiles(skyIdRow.id);

  // Единственный незащищённый профиль открываем сразу: лишний экран
  // выбора из одного варианта только мешает. Защищённый — только после
  // ввода его кода, поэтому активным здесь не становится.
  const auto = profiles.length === 1 && !profiles[0].twoFactorEnabled ? profiles[0] : null;

  const sessionId = generateId();
  await sessionStore.put(
    { id: sessionId, userId: skyIdRow.id, profileId: auto?.id ?? null },
    config.refreshTtlSec,
  );

  const tokens = issueTokens(skyIdRow.id, sessionId, auto?.id ?? null);
  return {
    body: {
      skyId: publicSkyId(skyIdRow),
      profiles,
      activeProfileId: auto?.id ?? null,
      maxProfiles: 2,
      ...tokens.body,
    },
    cookie: tokens.cookie,
  };
};

export const authRoutes = async (req, res, url) => {
  /* ── Шаг 1: запрос кода на телефон ──────────────────────────────── */
  if (req.method === 'POST' && url === '/api/auth/phone/start') {
    const body = await parseBody(req);
    const phone = normalizePhone(body.phone);
    if (!phone) return json(res, 400, { error: 'invalid_phone' });

    const result = await issueCode('phone', phone, 'login');
    if (result.error === 'too_soon') {
      return json(res, 429, { error: 'too_soon', retryAfter: result.retryAfter });
    }
    if (result.error) return json(res, 429, { error: result.error });

    // Ответ одинаков независимо от того, есть ли такой номер в системе.
    return json(res, 200, {
      ok: true,
      retryAfter: result.retryAfter,
      expiresIn: result.expiresIn,
      codeLength: 6,
    });
  }

  /* ── Шаг 2: проверка кода ───────────────────────────────────────── */
  if (req.method === 'POST' && url === '/api/auth/phone/verify') {
    const body = await parseBody(req);
    const phone = normalizePhone(body.phone);
    if (!phone) return json(res, 400, { error: 'invalid_phone' });

    const check = await verifyCode('phone', phone, 'login', body.code);
    if (check.error) {
      return json(res, 401, { error: check.error, attemptsLeft: check.attemptsLeft });
    }

    // Аккаунт заводится при первом успешном входе: отдельной регистрации нет.
    const { skyId, created } = await ensureSkyId(phone);

    // Включена защита Sky ID — сессию пока не выдаём.
    if (skyId.two_factor_enabled) {
      const challenge = signToken(
        { sub: skyId.id, typ: '2fa-challenge' }, config.jwtSecret, CHALLENGE_TTL_SEC,
      );

      // Код на почту отправляем сразу: заставлять нажимать «прислать
      // код» после ввода SMS — лишний шаг. Пауза между отправками не
      // ошибка: предыдущий код ещё жив.
      let sent = null;
      if (skyId.two_factor_method === 'email') {
        const r = await sendTwoFactorEmail(skyId.id, null);
        if (r.error && r.error !== 'too_soon') {
          return json(res, 503, { error: r.error });
        }
        sent = { email: maskEmail(skyId.email), retryAfter: r.retryAfter };
      }

      return json(res, 200, {
        needsTwoFactor: true,
        method: skyId.two_factor_method ?? 'app',
        challenge,
        expiresIn: CHALLENGE_TTL_SEC,
        ...(sent ?? {}),
      });
    }

    const session = await startSession(skyId);
    return json(res, created ? 201 : 200, { ...session.body, isNew: created },
                { 'Set-Cookie': session.cookie });
  }

  /* ── Шаг 3: второй фактор Sky ID ────────────────────────────────── */
  if (req.method === 'POST' && url === '/api/auth/two-factor/verify') {
    const body = await parseBody(req);
    const payload = verifyToken(String(body.challenge ?? ''), config.jwtSecret);
    if (!payload || payload.typ !== '2fa-challenge') {
      return json(res, 401, { error: 'challenge_expired' });
    }

    const check = await verifySkyTwoFactor(payload.sub, body.code);
    if (check.error) return json(res, 401, { error: check.error });

    const skyId = await findSkyIdById(payload.sub);
    if (!skyId) return json(res, 401, { error: 'unauthorized' });

    const session = await startSession(skyId);
    return json(res, 200, session.body, { 'Set-Cookie': session.cookie });
  }

  /* ── Повторная отправка кода второго фактора на почту ───────────── */
  if (req.method === 'POST' && url === '/api/auth/two-factor/send') {
    const body = await parseBody(req);
    const payload = verifyToken(String(body.challenge ?? ''), config.jwtSecret);
    if (!payload || payload.typ !== '2fa-challenge') {
      return json(res, 401, { error: 'challenge_expired' });
    }
    const result = await sendTwoFactorEmail(payload.sub, null);
    if (result.error) return json(res, 400, result);
    return json(res, 200, { ok: true, email: maskEmail(result.email), retryAfter: result.retryAfter });
  }

  /* ── Сколько ждать до повторной отправки ────────────────────────── */
  if (req.method === 'POST' && url === '/api/auth/phone/cooldown') {
    const body = await parseBody(req);
    const phone = normalizePhone(body.phone);
    if (!phone) return json(res, 400, { error: 'invalid_phone' });
    return json(res, 200, {
      retryAfter: await cooldownLeft('phone', phone, 'login'),
      limits: VERIFICATION_LIMITS,
    });
  }

  /* ── Восстановление сессии по куке ──────────────────────────────── */
  if (req.method === 'POST' && url === '/api/auth/refresh') {
    const body = await parseBody(req);
    const payload = verifyToken(readRefreshToken(req, body), config.refreshSecret);
    if (!payload || payload.typ !== 'refresh' || !payload.sid) {
      return json(res, 401, { error: 'invalid_refresh' }, { 'Set-Cookie': clearRefreshCookie() });
    }

    const stored = await sessionStore.get(payload.sid);
    if (!stored || stored.userId !== payload.sub) {
      return json(res, 401, { error: 'stale_session' }, { 'Set-Cookie': clearRefreshCookie() });
    }

    const skyId = await findSkyIdById(stored.userId);
    if (!skyId) {
      await sessionStore.revoke(payload.sid);
      return json(res, 401, { error: 'stale_session' }, { 'Set-Cookie': clearRefreshCookie() });
    }

    // Активный профиль перечитываем из БД: за время сессии его могли
    // удалить, и держаться за исчезнувший id нельзя.
    const active = stored.profileId
      ? await getProfileOfSkyId(skyId.id, stored.profileId)
      : null;
    if (stored.profileId && !active) await sessionStore.setActiveProfile(payload.sid, null);

    const tokens = issueTokens(skyId.id, payload.sid, active?.id ?? null);
    return json(res, 200, {
      skyId: publicSkyId(skyId),
      profiles: await listProfiles(skyId.id),
      activeProfileId: active?.id ?? null,
      maxProfiles: 2,
      ...tokens.body,
    }, { 'Set-Cookie': tokens.cookie });
  }

  /* ── Текущее состояние сессии ───────────────────────────────────── */
  if (req.method === 'GET' && url === '/api/auth/session') {
    const session = await readSession(req);
    if (!session) return json(res, 401, { error: 'unauthorized' });

    const skyId = await findSkyIdById(session.skyId);
    if (!skyId) return json(res, 401, { error: 'unauthorized' });

    return json(res, 200, {
      skyId: publicSkyId(skyId),
      profiles: await listProfiles(skyId.id),
      activeProfileId: session.profileId,
      maxProfiles: 2,
    });
  }

  /* ── Выход из Sky ID ────────────────────────────────────────────── */
  if (req.method === 'POST' && url === '/api/auth/logout') {
    const body = await parseBody(req);
    const payload = verifyToken(readRefreshToken(req, body), config.refreshSecret);
    // Гасим серверную сессию: одного удаления куки мало, иначе украденный
    // токен продолжал бы работать.
    if (payload?.sid) await sessionStore.revoke(payload.sid);
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearRefreshCookie() });
  }

  return false;
};
