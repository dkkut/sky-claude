/**
 * Управление Sky ID: профили, почта, двухэтапная защита, Prime.
 *
 * Все ручки работают строго внутри Sky ID вызывающего. profile_id из
 * запроса нигде не используется как доверенный: он всегда проходит через
 * getProfileOfSkyId, который ищет строку с условием принадлежности.
 * Поэтому подстановка чужого id даёт «не найдено», а не чужой профиль.
 */
import { config } from './../config.mjs';
import { signToken, sanitizeInput } from './../security.mjs';
import { sessionStore } from './../sessions.mjs';
import { json, parseBody, requireSkyId, requireProfile } from './../http.mjs';
import { issueCode, verifyCode } from './../verification.mjs';
import {
  listProfiles, createProfile, updateProfile, getProfileOfSkyId,
  findSkyIdById, publicSkyId, setEmailVerified,
  beginSkyTwoFactor, confirmSkyTwoFactor, disableSkyTwoFactor, verifySkyTwoFactor,
  beginProfileTwoFactor, confirmProfileTwoFactor, verifyProfileTwoFactor, disableProfileTwoFactor,
  grantPrime, revokePrime, MAX_PROFILES,
} from './../skyid.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Свежий access-токен под выбранный профиль. sid переносим из старого
 * токена: без него следующая смена профиля не нашла бы сессию.
 */
const accessTokenFor = (skyId, profileId, sessionId) => signToken(
  { sub: profileId ?? null, sky: skyId, sid: sessionId, typ: 'access' },
  config.jwtSecret, config.accessTtlSec,
);

export const skyIdRoutes = async (req, res, url) => {
  /* ══ Профили ═════════════════════════════════════════════════════ */

  if (req.method === 'GET' && url === '/api/skyid/profiles') {
    const s = await requireSkyId(req, res); if (!s) return true;
    return json(res, 200, {
      profiles: await listProfiles(s.skyId),
      activeProfileId: s.profileId,
      maxProfiles: MAX_PROFILES,
    });
  }

  if (req.method === 'POST' && url === '/api/skyid/profiles') {
    const s = await requireSkyId(req, res); if (!s) return true;
    const body = await parseBody(req);

    const result = await createProfile(s.skyId, {
      name:     sanitizeInput(body.name ?? ''),
      username: sanitizeInput(body.username ?? ''),
      avatar:   body.avatar ? String(body.avatar).slice(0, 512) : null,
    });
    if (result.error === 'profile_limit_reached') {
      return json(res, 409, { error: 'profile_limit_reached', maxProfiles: MAX_PROFILES });
    }
    if (result.error) return json(res, 400, { error: result.error });

    return json(res, 201, { profile: result.profile, profiles: await listProfiles(s.skyId) });
  }

  /* ── Выбор профиля: он же смена профиля ──────────────────────────
     Sky ID при этом остаётся авторизованным — меняется только активный
     профиль в той же сессии.                                        */
  const selectMatch = url.match(/^\/api\/skyid\/profiles\/([\w.-]+)\/select$/);
  if (req.method === 'POST' && selectMatch) {
    const s = await requireSkyId(req, res); if (!s) return true;
    const profileId = selectMatch[1];
    const body = await parseBody(req);

    const profile = await getProfileOfSkyId(s.skyId, profileId);
    if (!profile) return json(res, 404, { error: 'not_found' });

    if (profile.twoFactorEnabled) {
      if (!body.code) return json(res, 401, { error: 'profile_code_required' });
      const check = await verifyProfileTwoFactor(s.skyId, profileId, body.code);
      if (check.error) return json(res, 401, { error: check.error });
    }

    // Меняем профиль в самой сессии: иначе после обновления страницы
    // вернулся бы прежний.
    if (s.sessionId) await sessionStore.setActiveProfile(s.sessionId, profileId);

    return json(res, 200, {
      profile,
      activeProfileId: profileId,
      accessToken: accessTokenFor(s.skyId, profileId, s.sessionId),
      expiresIn: config.accessTtlSec,
    });
  }

  const patchMatch = url.match(/^\/api\/skyid\/profiles\/([\w.-]+)$/);
  if (req.method === 'PATCH' && patchMatch) {
    const s = await requireSkyId(req, res); if (!s) return true;
    const body = await parseBody(req);
    const result = await updateProfile(s.skyId, patchMatch[1], {
      name:   body.name   !== undefined ? sanitizeInput(body.name) : undefined,
      avatar: body.avatar !== undefined ? String(body.avatar).slice(0, 512) : undefined,
    });
    if (result.error === 'not_found') return json(res, 404, { error: 'not_found' });
    if (result.error) return json(res, 400, { error: result.error });
    return json(res, 200, { profile: result.profile });
  }

  /* ══ Двухэтапная защита профиля ══════════════════════════════════ */

  const p2faMatch = url.match(/^\/api\/skyid\/profiles\/([\w.-]+)\/two-factor\/(begin|confirm|disable)$/);
  if (req.method === 'POST' && p2faMatch) {
    const s = await requireSkyId(req, res); if (!s) return true;
    const [, profileId, action] = p2faMatch;

    if (action === 'begin') {
      const result = await beginProfileTwoFactor(s.skyId, profileId);
      if (result.error) return json(res, 404, { error: result.error });
      // Секрет отдаём один раз, чтобы человек внёс его в приложение.
      return json(res, 200, { secret: result.secret, uri: result.uri });
    }

    const body = await parseBody(req);
    if (action === 'confirm') {
      const result = await confirmProfileTwoFactor(s.skyId, profileId, body.code);
      if (result.error) return json(res, 400, { error: result.error });
      return json(res, 200, { ok: true, profile: await getProfileOfSkyId(s.skyId, profileId) });
    }

    // Отключение требует действующего кода: иначе тому, кто дорвался до
    // открытой вкладки, достаточно нажать кнопку.
    const check = await verifyProfileTwoFactor(s.skyId, profileId, body.code);
    if (check.error) return json(res, 401, { error: check.error });
    const result = await disableProfileTwoFactor(s.skyId, profileId);
    if (result.error) return json(res, 404, { error: result.error });
    return json(res, 200, { ok: true, profile: await getProfileOfSkyId(s.skyId, profileId) });
  }

  /* ══ Двухэтапная защита Sky ID ═══════════════════════════════════ */

  if (req.method === 'POST' && url === '/api/skyid/two-factor/begin') {
    const s = await requireSkyId(req, res); if (!s) return true;
    const sky = await findSkyIdById(s.skyId);
    const result = await beginSkyTwoFactor(s.skyId, sky.phone);
    return json(res, 200, { secret: result.secret, uri: result.uri });
  }

  if (req.method === 'POST' && url === '/api/skyid/two-factor/confirm') {
    const s = await requireSkyId(req, res); if (!s) return true;
    const body = await parseBody(req);
    const result = await confirmSkyTwoFactor(s.skyId, body.code);
    if (result.error) return json(res, 400, { error: result.error });
    return json(res, 200, { ok: true, skyId: publicSkyId(await findSkyIdById(s.skyId)) });
  }

  if (req.method === 'POST' && url === '/api/skyid/two-factor/disable') {
    const s = await requireSkyId(req, res); if (!s) return true;
    const body = await parseBody(req);
    const sky = await findSkyIdById(s.skyId);
    if (sky.two_factor_enabled) {
      const check = await verifySkyTwoFactor(s.skyId, body.code);
      if (check.error) return json(res, 401, { error: check.error });
    }
    await disableSkyTwoFactor(s.skyId);
    return json(res, 200, { ok: true, skyId: publicSkyId(await findSkyIdById(s.skyId)) });
  }

  /* ══ Привязка почты ══════════════════════════════════════════════ */

  if (req.method === 'POST' && url === '/api/skyid/email/start') {
    const s = await requireSkyId(req, res); if (!s) return true;
    const body = await parseBody(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return json(res, 400, { error: 'invalid_email' });

    const result = await issueCode('email', email, `link:${s.skyId}`);
    if (result.error === 'too_soon') {
      return json(res, 429, { error: 'too_soon', retryAfter: result.retryAfter });
    }
    if (result.error) return json(res, 429, { error: result.error });
    return json(res, 200, { ok: true, retryAfter: result.retryAfter, expiresIn: result.expiresIn });
  }

  if (req.method === 'POST' && url === '/api/skyid/email/verify') {
    const s = await requireSkyId(req, res); if (!s) return true;
    const body = await parseBody(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'invalid_email' });

    const check = await verifyCode('email', email, `link:${s.skyId}`, body.code);
    if (check.error) return json(res, 401, { error: check.error, attemptsLeft: check.attemptsLeft });

    const result = await setEmailVerified(s.skyId, email);
    if (result.error) return json(res, 409, { error: result.error });
    return json(res, 200, { ok: true, skyId: publicSkyId(result.skyId) });
  }

  /* ══ Prime ═══════════════════════════════════════════════════════
     Prime принадлежит профилю. Начисление проходит через проверку
     принадлежности профиля Sky ID, поэтому выписать Prime чужому
     профилю, подменив id в запросе, нельзя.                          */

  if (req.method === 'POST' && url === '/api/skyid/prime/grant') {
    const s = await requireProfile(req, res); if (!s) return true;
    const body = await parseBody(req);

    // Начисление создаёт ценность, поэтому закрыто тем же флагом, что и
    // пополнение кошелька: открывать его можно только вместе с реальной
    // оплатой.
    if (config.paymentsMode !== 'demo') {
      return json(res, 501, { error: 'payments_not_configured' });
    }

    // Без явного profileId Prime получает активный профиль, а не «весь Sky ID».
    const target = body.profileId ? String(body.profileId) : s.profileId;
    const result = await grantPrime(s.skyId, target, sanitizeInput(body.plan ?? 'standard'),
                                    Number(body.days) || null);
    if (result.error) return json(res, 404, { error: result.error });
    return json(res, 200, { profile: result.profile, profiles: await listProfiles(s.skyId) });
  }

  if (req.method === 'POST' && url === '/api/skyid/prime/revoke') {
    const s = await requireProfile(req, res); if (!s) return true;
    const body = await parseBody(req);
    const target = body.profileId ? String(body.profileId) : s.profileId;
    const result = await revokePrime(s.skyId, target);
    if (result.error) return json(res, 404, { error: result.error });
    return json(res, 200, { profile: result.profile, profiles: await listProfiles(s.skyId) });
  }

  return false;
};
