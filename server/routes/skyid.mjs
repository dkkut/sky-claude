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
import { wallet } from './../wallet.mjs';
import { recordAcceptance, LEGAL_REVISION } from './../legal.mjs';

import {
  listProfiles, createProfile, updateProfile, getProfileOfSkyId,
  findSkyIdById, publicSkyId, setEmailVerified,
  beginSkyTwoFactor, confirmSkyTwoFactor, disableSkyTwoFactor, verifySkyTwoFactor,
  beginProfileTwoFactor, confirmProfileTwoFactor, verifyProfileTwoFactor, disableProfileTwoFactor,
  grantPrime, revokePrime, MAX_PROFILES, sendTwoFactorCode, setPhoneVerified,
} from './../skyid.mjs';

/**
 * Цены подписки в рублях по сроку. Держим их здесь, а не в браузере:
 * присланную клиентом цену можно переписать в запросе.
 */
const PRIME_PRICES = { 30: 400, 365: 3790, 730: 6990 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Тот же вид номера, что и при входе: «+79001234567», «89001234567» и
 * «+7 900 123-45-67» — один и тот же телефон, и привязка не должна
 * зависеть от того, как его набрали.
 */
const normalizePhone = (raw) => {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
};

/**
 * Аватар: либо обычная ссылка на картинку, либо сама картинка,
 * вложенная в строку.
 *
 * Значение подставляется в стили и в src на страницах, которые видят
 * другие люди. Поэтому подходят только два вида строк целиком, а всё
 * остальное отбрасывается: ни javascript:, ни попытка закрыть кавычку
 * и дописать своё правило в эти два вида не укладываются.
 */
const AVATAR_URL  = /^https:\/\/[\w.-]+(:\d{1,5})?\/[\w\-./%~+]*$/;
const AVATAR_DATA = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const AVATAR_MAX  = 256 * 1024;   // ~190 КБ картинки после base64

const sanitizeAvatar = (raw) => {
  const value = String(raw ?? '').trim();
  if (!value || value.length > AVATAR_MAX) return null;
  if (AVATAR_URL.test(value) && value.length <= 512) return value;
  if (AVATAR_DATA.test(value)) return value;
  return null;
};

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

    // Первый профиль — это и есть регистрация. Дальше согласие уже
    // записано, и спрашивать его на втором профиле незачем.
    const existing = await listProfiles(s.skyId);
    if (existing.length === 0 && body.acceptLegal !== true) {
      return json(res, 400, { error: 'legal_not_accepted' });
    }

    const result = await createProfile(s.skyId, {
      name:     sanitizeInput(body.name ?? ''),
      username: sanitizeInput(body.username ?? ''),
      avatar:   sanitizeAvatar(body.avatar),
    });
    if (result.error === 'profile_limit_reached') {
      return json(res, 409, { error: 'profile_limit_reached', maxProfiles: MAX_PROFILES });
    }
    if (result.error) return json(res, 400, { error: result.error });

    // Записываем после того, как профиль создан: иначе согласие
    // осталось бы от регистрации, которая не состоялась.
    if (existing.length === 0) await recordAcceptance(s.skyId, LEGAL_REVISION);

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
      if (!body.code) {
        // Если второй фактор приходит письмом — сразу и отправляем,
        // чтобы человек не искал отдельную кнопку.
        let sent = null;
        if (profile.twoFactorMethod === 'email') {
          const r = await sendTwoFactorCode(s.skyId, profileId);
          if (r.error && r.error !== 'too_soon') return json(res, 503, r);
          sent = { retryAfter: r.retryAfter };
        }
        return json(res, 401, {
          error: 'profile_code_required',
          method: profile.twoFactorMethod ?? 'app',
          ...(sent ?? {}),
        });
      }
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
      avatar: body.avatar !== undefined ? sanitizeAvatar(body.avatar) : undefined,
    });
    if (result.error === 'not_found') return json(res, 404, { error: 'not_found' });
    if (result.error) return json(res, 400, { error: result.error });
    return json(res, 200, { profile: result.profile });
  }

  /* ══ Двухэтапная защита профиля ══════════════════════════════════ */

  const p2faMatch = url.match(/^\/api\/skyid\/profiles\/([\w.-]+)\/two-factor\/(begin|confirm|disable|send)$/);
  if (req.method === 'POST' && p2faMatch) {
    const s = await requireSkyId(req, res); if (!s) return true;
    const [, profileId, action] = p2faMatch;

    if (action === 'begin') {
      const body = await parseBody(req);
      const result = await beginProfileTwoFactor(s.skyId, profileId, body.method ?? 'app');
      if (result.error === 'not_found') return json(res, 404, { error: result.error });
      if (result.error) return json(res, 400, result);
      // Секрет отдаём один раз, чтобы человек внёс его в приложение.
      // Для почты секрета нет — только адрес, куда ушёл код.
      return json(res, 200, {
        method: result.method, secret: result.secret, uri: result.uri,
        email: result.email, retryAfter: result.retryAfter,
      });
    }

    // Повторная отправка кода на почту — и при настройке, и при входе
    // в защищённый профиль.
    if (action === 'send') {
      const result = await sendTwoFactorCode(s.skyId, profileId);
      if (result.error) return json(res, 400, result);
      return json(res, 200, { ok: true, email: result.email, retryAfter: result.retryAfter });
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
    const body = await parseBody(req);
    const sky = await findSkyIdById(s.skyId);
    const result = await beginSkyTwoFactor(s.skyId, sky.phone, body.method ?? 'app');
    if (result.error) return json(res, 400, result);
    return json(res, 200, {
      method: result.method, secret: result.secret, uri: result.uri,
      email: result.email, retryAfter: result.retryAfter,
    });
  }

  // Повторная отправка кода на почту при настройке защиты Sky ID.
  if (req.method === 'POST' && url === '/api/skyid/two-factor/send') {
    const s = await requireSkyId(req, res); if (!s) return true;
    const result = await sendTwoFactorCode(s.skyId, null);
    if (result.error) return json(res, 400, result);
    return json(res, 200, { ok: true, email: result.email, retryAfter: result.retryAfter });
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

  /* ══ Привязка телефона ═══════════════════════════════════════════
     Телефон необязателен: войти можно и по одной почте. Он нужен как
     второй канал проверки — код на него становится настоящим вторым
     фактором, потому что вход идёт другим путём.                     */

  if (req.method === 'POST' && url === '/api/skyid/phone/start') {
    const s = await requireSkyId(req, res); if (!s) return true;
    const body = await parseBody(req);
    const phone = normalizePhone(body.phone);
    if (!phone) return json(res, 400, { error: 'invalid_phone' });

    const result = await issueCode('phone', phone, `link:${s.skyId}`);
    if (result.error === 'too_soon') {
      return json(res, 429, { error: 'too_soon', retryAfter: result.retryAfter });
    }
    if (result.error) return json(res, 429, { error: result.error });
    return json(res, 200, { ok: true, retryAfter: result.retryAfter, expiresIn: result.expiresIn });
  }

  if (req.method === 'POST' && url === '/api/skyid/phone/verify') {
    const s = await requireSkyId(req, res); if (!s) return true;
    const body = await parseBody(req);
    const phone = normalizePhone(body.phone);
    if (!phone) return json(res, 400, { error: 'invalid_phone' });

    const check = await verifyCode('phone', phone, `link:${s.skyId}`, body.code);
    if (check.error) return json(res, 401, { error: check.error, attemptsLeft: check.attemptsLeft });

    const result = await setPhoneVerified(s.skyId, phone);
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

    // Срок и цена — из таблицы сервера. Если бы цену присылал браузер,
    // подписку можно было бы купить за рубль, поправив запрос.
    const days = Number(body.days);
    const price = PRIME_PRICES[days];
    if (!price) return json(res, 400, { error: 'invalid_plan' });

    // Без явного profileId Prime получает активный профиль, а не «весь Sky ID».
    const target = body.profileId ? String(body.profileId) : s.profileId;
    // Платит тот профиль, которому выписывается подписка: чужой кошелёк
    // так не потратить.
    if (target !== s.profileId) return json(res, 403, { error: 'not_active_profile' });

    const owned = await getProfileOfSkyId(s.skyId, target);
    if (!owned) return json(res, 404, { error: 'not_found' });

    const paid = await wallet.spend(target, price, 'prime', `Sky Prime · ${days} дн.`);
    if (paid.error) return json(res, 400, paid);

    const result = await grantPrime(s.skyId, target, sanitizeInput(body.plan ?? 'standard'), days);
    if (result.error) {
      // Списали, но не выдали — возвращаем деньги, иначе они пропадут.
      await wallet.refund(target, price, 'Возврат за Sky Prime');
      return json(res, 500, { error: 'grant_failed' });
    }
    return json(res, 200, {
      profile: result.profile, profiles: await listProfiles(s.skyId),
      balance: paid.balance, price,
    });
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
