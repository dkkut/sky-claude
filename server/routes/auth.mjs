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
import { signToken, verifyToken } from './../security.mjs';
import { sessionStore } from './../sessions.mjs';
import { generateId } from './../security.mjs';
import { buildRefreshCookie, clearRefreshCookie } from './../cookies.mjs';
import { json, parseBody, readRefreshToken, readSession, appBody, deviceMeta } from './../http.mjs';
import { issueCode, verifyCode, cooldownLeft, VERIFICATION_LIMITS } from './../verification.mjs';
import { sendEmail } from './../notify.mjs';
import {
  ensureSkyId, ensureSkyIdByEmail, findSkyIdById, publicSkyId, listProfiles,
  getProfileOfSkyId, verifySkyTwoFactor, sendTwoFactorCode,
} from './../skyid.mjs';

/** Токен между SMS и вторым фактором живёт ровно столько, сколько нужно. */
const CHALLENGE_TTL_SEC = 5 * 60;

/**
 * Показываем почту так, чтобы человек узнал свою, но подсмотревший
 * из-за плеча не узнал чужую: a***@example.com.
 */
export const maskEmail = (email) => {
  const value = String(email ?? '');
  const at = value.indexOf('@');
  if (at < 1) return '';
  return `${value[0]}***${value.slice(at)}`;
};

/** Номер показываем хвостом: свой узнаешь, чужой — нет. */
const maskPhone = (phone) => {
  const value = String(phone ?? '');
  return value.length > 4 ? `••• ${value.slice(-4)}` : '';
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Почта приводится к нижнему регистру: Ivan@ и ivan@ — один адрес. */
export const normalizeEmail = (raw) => {
  const value = String(raw ?? '').trim().toLowerCase();
  return EMAIL_RE.test(value) && value.length <= 254 ? value : null;
};

/**
 * Приводит номер к одному виду: +7 и дальше цифры.
 *
 * Это не косметика. Номер — это и есть учётная запись, и «+79001234567»,
 * «79001234567» и «89001234567» должны попадать в один Sky ID. Пока
 * номер хранился как набран, один и тот же человек, войдя однажды через
 * восьмёрку, заводил себе второй аккаунт с пустыми профилями.
 *
 * Восьмёрку меняем на семёрку только у одиннадцатизначных номеров —
 * это российский способ набора; в других странах кода «8» нет.
 */
const normalizePhone = (raw) => {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
};

/**
 * Собирает пару токенов и куку для уже существующей сессии Sky ID.
 *
 * Вывезена наружу для routes/password.mjs: вход по паролю заканчивается
 * тем же самым устройством сессии, что и вход по коду, — рефреш-кука,
 * короткий доступ, sid внутри. Держать вторую копию этой сборки было бы
 * поводом однажды забыть обновить одну из двух одинаково.
 */
export const issueTokens = (skyId, sessionId, profileId) => {
  // Сырой refresh-токен выносим в переменную: он же уходит в куку для
  // браузера, он же — в тело ответа для родного приложения (см. appBody
  // в http.mjs). Кука привязана к пути /api/auth и HttpOnly, поэтому
  // возврат того же значения в теле ничего не открывает обычной вкладке —
  // JS там его и так не увидит.
  const refreshToken = signToken(
    { sub: skyId, sid: sessionId, typ: 'refresh' }, config.refreshSecret, config.refreshTtlSec,
  );
  return {
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
    cookie: buildRefreshCookie(refreshToken, config.refreshTtlSec),
    refreshToken,
  };
};

/**
 * Письмо о входе с устройства, которого не было среди живых сессий.
 *
 * До этого вход создавал сессию молча: узнать о чужом входе владелец
 * мог только сам, зайдя в «Устройства» и сверив список. Это ничего не
 * блокирует — только даёт знать как можно раньше, пока вход ещё можно
 * отменить (отозвать сессию, сменить пароль). Отправка не должна
 * задерживать и тем более ронять сам вход, поэтому вызывается без
 * await и падение логируется, а не прокидывается наружу.
 */
const notifyNewLogin = async (skyIdRow, meta) => {
  if (!skyIdRow.email || !skyIdRow.email_verified) return;
  const when = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const ua = (meta.ua || 'неизвестно').slice(0, 200);
  const ip = meta.ip || 'неизвестен';
  await sendEmail(
    skyIdRow.email,
    'Новый вход в Sky ID',
    `Выполнен вход в ваш Sky ID.\n\nКогда: ${when} (UTC)\nС адреса: ${ip}\nУстройство: ${ua}\n\n` +
    'Если это были вы — ничего делать не нужно. Если нет — зайдите в ' +
    'Настройки → Устройства и завершите эту сессию, затем смените пароль.',
  );
};

/**
 * Начинает сессию Sky ID и выбирает профиль по умолчанию, если он один.
 * Экспортирована по той же причине, что и issueTokens выше.
 */
export const startSession = async (skyIdRow, req) => {
  const profiles = await listProfiles(skyIdRow.id);

  // Единственный незащищённый профиль открываем сразу: лишний экран
  // выбора из одного варианта только мешает. Защищённый — только после
  // ввода его кода, поэтому активным здесь не становится.
  const auto = profiles.length === 1 && !profiles[0].twoFactorEnabled ? profiles[0] : null;

  const sessionId = generateId();
  const meta = deviceMeta(req);

  // Известное устройство — то, с чьего IP уже есть живая сессия. IP
  // меняется у обычного человека чаще, чем хотелось бы (мобильная
  // сеть, Wi-Fi дома/на работе), поэтому письма будут — это осознанный
  // компромисс: пропустить настоящий чужой вход хуже, чем лишнее письмо.
  const known = await sessionStore.listForUser(skyIdRow.id);
  const isNewDevice = known.length > 0 && !known.some((s) => s.ip && s.ip === meta.ip);

  await sessionStore.put(
    { id: sessionId, userId: skyIdRow.id, profileId: auto?.id ?? null, ...meta },
    config.refreshTtlSec,
  );

  if (isNewDevice) {
    notifyNewLogin(skyIdRow, meta).catch((err) => console.error('[auth] письмо о новом входе:', err.message));
  }

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
    refreshToken: tokens.refreshToken,
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

  /* ── Вход по почте: шаг 1, запрос кода ──────────────────────────
     Основной способ входа. Письма ничего не стоят и не зависят от
     симки, поэтому именно с них начинается знакомство с Sky ID.      */
  if (req.method === 'POST' && url === '/api/auth/email/start') {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    if (!email) return json(res, 400, { error: 'invalid_email' });

    const result = await issueCode('email', email, 'login');
    if (result.error === 'too_soon') {
      return json(res, 429, { error: 'too_soon', retryAfter: result.retryAfter });
    }
    if (result.error) return json(res, 429, { error: result.error });

    // Ответ одинаков и для нового адреса, и для существующего: по нему
    // нельзя перебором собрать список тех, у кого есть аккаунт.
    return json(res, 200, {
      ok: true, retryAfter: result.retryAfter, expiresIn: result.expiresIn, codeLength: 6,
    });
  }

  /* ── Вход по почте: шаг 2, проверка кода ────────────────────────── */
  if (req.method === 'POST' && url === '/api/auth/email/verify') {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    if (!email) return json(res, 400, { error: 'invalid_email' });

    const check = await verifyCode('email', email, 'login', body.code);
    if (check.error) {
      return json(res, 401, { error: check.error, attemptsLeft: check.attemptsLeft });
    }

    const { skyId, created } = await ensureSkyIdByEmail(email);

    if (skyId.two_factor_enabled) {
      const challenge = signToken(
        { sub: skyId.id, typ: '2fa-challenge' }, config.jwtSecret, CHALLENGE_TTL_SEC,
      );
      // Код второго фактора шлём сразу, кроме случая, когда способ —
      // та же почта: второй код на тот же адрес защитой не является.
      let sent = null;
      if (skyId.two_factor_method !== 'app' && skyId.two_factor_method !== 'email') {
        const r = await sendTwoFactorCode(skyId.id, null, 'use');
        if (r.error && r.error !== 'too_soon') return json(res, 503, { error: r.error });
        sent = { phone: maskPhone(r.phone), retryAfter: r.retryAfter };
      }
      return json(res, 200, {
        needsTwoFactor: true,
        method: skyId.two_factor_method ?? 'app',
        sameChannel: skyId.two_factor_method === 'email',
        challenge, expiresIn: CHALLENGE_TTL_SEC,
        ...(sent ?? {}),
      });
    }

    const session = await startSession(skyId, req);
    return json(res, created ? 201 : 200,
                appBody(req, { ...session.body, isNew: created }, { refreshToken: session.refreshToken }),
                { 'Set-Cookie': session.cookie });
  }

  /* ── Сколько ждать до повторной отправки письма ─────────────────── */
  if (req.method === 'POST' && url === '/api/auth/email/cooldown') {
    const body = await parseBody(req);
    const email = normalizeEmail(body.email);
    if (!email) return json(res, 400, { error: 'invalid_email' });
    return json(res, 200, {
      retryAfter: await cooldownLeft('email', email, 'login'),
      limits: VERIFICATION_LIMITS,
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
        const r = await sendTwoFactorCode(skyId.id, null);
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

    const session = await startSession(skyId, req);
    return json(res, created ? 201 : 200,
                appBody(req, { ...session.body, isNew: created }, { refreshToken: session.refreshToken }),
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
    if (check.error) return json(res, check.error === 'too_many_attempts' ? 429 : 401, { error: check.error });

    const skyId = await findSkyIdById(payload.sub);
    if (!skyId) return json(res, 401, { error: 'unauthorized' });

    const session = await startSession(skyId, req);
    return json(res, 200, appBody(req, session.body, { refreshToken: session.refreshToken }),
                { 'Set-Cookie': session.cookie });
  }

  /* ── Повторная отправка кода второго фактора на почту ───────────── */
  if (req.method === 'POST' && url === '/api/auth/two-factor/send') {
    const body = await parseBody(req);
    const payload = verifyToken(String(body.challenge ?? ''), config.jwtSecret);
    if (!payload || payload.typ !== '2fa-challenge') {
      return json(res, 401, { error: 'challenge_expired' });
    }
    const result = await sendTwoFactorCode(payload.sub, null);
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
    // Обновление токена — самое частое обращение живой сессии: удобное
    // место отметить «видели только что» для экрана «Устройства».
    await sessionStore.touch(payload.sid);

    const tokens = issueTokens(skyId.id, payload.sid, active?.id ?? null);
    return json(res, 200, appBody(req, {
      skyId: publicSkyId(skyId),
      profiles: await listProfiles(skyId.id),
      activeProfileId: active?.id ?? null,
      maxProfiles: 2,
      ...tokens.body,
    }, { refreshToken: tokens.refreshToken }), { 'Set-Cookie': tokens.cookie });
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

  /* ── Устройства: настоящий список сессий Sky ID ─────────────────────
     Раньше «Устройства» рисовались из localStorage и не отражали ничего
     реального — «завершить сессию» там не завершало её нигде, кроме
     своего же браузера. IP не отдаём вовсе (тот же принцип, что и
     раньше был на клиенте): достаточно браузера/ОС из ua и времени. */
  if (req.method === 'GET' && url === '/api/auth/devices') {
    const session = await readSession(req);
    if (!session) return json(res, 401, { error: 'unauthorized' });
    const list = await sessionStore.listForUser(session.skyId);
    return json(res, 200, {
      devices: list.map((d) => ({
        id: d.id,
        ua: d.ua ?? '',
        createdAt: new Date(d.createdAt ?? Date.now()).toISOString(),
        lastSeenAt: new Date(d.lastSeenAt ?? d.createdAt ?? Date.now()).toISOString(),
        isCurrent: d.id === session.sessionId,
      })),
    });
  }

  /* ── Устройства: завершить одну сессию ──────────────────────────── */
  const deviceMatch = /^\/api\/auth\/devices\/([a-zA-Z0-9-]{10,64})\/revoke$/.exec(url);
  if (req.method === 'POST' && deviceMatch) {
    const session = await readSession(req);
    if (!session) return json(res, 401, { error: 'unauthorized' });
    const target = await sessionStore.get(deviceMatch[1]);
    // Чужая сессия и несуществующий id отвечают одинаково: подтверждать
    // угаданный чужой идентификатор незачем.
    if (!target || target.userId !== session.skyId) return json(res, 404, { error: 'not_found' });
    await sessionStore.revoke(deviceMatch[1]);
    return json(res, 200, { ok: true, isCurrent: deviceMatch[1] === session.sessionId });
  }

  /* ── Устройства: завершить все сессии, включая текущую ──────────── */
  if (req.method === 'POST' && url === '/api/auth/devices/revoke-all') {
    const session = await readSession(req);
    if (!session) return json(res, 401, { error: 'unauthorized' });
    await sessionStore.revokeAllForUser(session.skyId);
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearRefreshCookie() });
  }

  return false;
};
