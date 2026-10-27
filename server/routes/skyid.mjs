/**
 * Управление Sky ID: профили, почта, двухэтапная защита, Prime.
 *
 * Все ручки работают строго внутри Sky ID вызывающего. profile_id из
 * запроса нигде не используется как доверенный: он всегда проходит через
 * getProfileOfSkyId, который ищет строку с условием принадлежности.
 * Поэтому подстановка чужого id даёт «не найдено», а не чужой профиль.
 */
import { needDeviceCode } from './../devicecode.mjs';
import { award as awardCashback } from './../cashbackrules.mjs';
import { logEvent as skyLog } from './../skylog.mjs';
import { mayOpenWithoutCode, listTrusted, revokeTrusted, setSkipFlag } from './../trusteddevices.mjs';
import { claimPrimeCoupon, releaseCoupon, discountedPrice } from './../skycodes.mjs';
import { config } from './../config.mjs';
import { signToken, sanitizeInput } from './../security.mjs';
import { sessionStore } from './../sessions.mjs';
import { json, parseBody, requireSkyId, requireProfile } from './../http.mjs';
import { issueCode, verifyCode } from './../verification.mjs';
import { guardContactChange, noteContactChanged } from './../accountrecovery.mjs';
import { clientIp } from './../http.mjs';
import { wallet } from './../wallet.mjs';
import { recordAcceptance, LEGAL_REVISION } from './../legal.mjs';

import {
  listProfiles, createProfile, updateProfile, getProfileOfSkyId,
  findSkyIdById, publicSkyId, setEmailVerified, publicProfile,
  beginSkyTwoFactor, confirmSkyTwoFactor, disableSkyTwoFactor, verifySkyTwoFactor,
  beginProfileTwoFactor, confirmProfileTwoFactor, verifyProfileTwoFactor, disableProfileTwoFactor,
  grantPrime, purchasePrime, revokePrime, MAX_PROFILES, sendTwoFactorCode, setPhoneVerified, PRIME_PRICES,
} from './../skyid.mjs';
import { rateLimit } from './../security.mjs';
import { purchaseAllowedOn } from './../entitlements.mjs';

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

/**
 * Проверка с различием «убрать» и «не подошло». Раньше любое неподходящее
 * значение (слишком большой снимок, чужой формат) превращалось в null, то
 * есть в «стереть аватар», а сервер отвечал 200: человек видел успех, а
 * после обновления страницы аватара не было вовсе.
 *   undefined → поле не меняем; '' / null → убрать; иначе строка либо
 *   проходит проверку, либо PATCH отклоняется с invalid_avatar.
 */
const avatarPatch = (raw) => {
  if (raw === undefined) return { value: undefined };
  if (raw === null || String(raw).trim() === '') return { value: null };
  const value = sanitizeAvatar(raw);
  return value === null ? { error: true } : { value };
};

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

  /* Профиль любого человека — то немногое, что о нём видно без общего
     чата и без переписки: имя, ник, аватар, Prime. Раздельно от
     /profiles/:id выше: та ручка — управление своими профилями внутри
     своего Sky ID, эта — витрина чужого профиля для кого угодно из
     Sky, кто уже вошёл. */
  const publicMatch = url.match(/^\/api\/skyid\/profile\/([\w.-]+)$/);
  if (req.method === 'GET' && publicMatch) {
    const s = await requireProfile(req, res); if (!s) return true;
    if (!rateLimit(`skyid:pub:${s.profileId}`, 120)) return json(res, 429, { error: 'rate_limited' });
    const p = await publicProfile(s.profileId, publicMatch[1]);
    return p ? json(res, 200, { profile: p }) : json(res, 404, { error: 'not_found' });
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
      /* Ключ, которым владелец один раз занимает свой ник. Обычной
         регистрации он не нужен и ни на что не влияет. Не чистим его
         sanitizeInput: это секрет, а не текст для показа, и любая
         правка сломала бы сравнение. */
      ownerClaim: typeof body.ownerClaim === 'string' ? body.ownerClaim : '',
    });
    if (result.error === 'profile_limit_reached') {
      return json(res, 409, { error: 'profile_limit_reached', maxProfiles: MAX_PROFILES });
    }
    /* Ник владельца: отвечаем тем же кодом, что и на занятый ник.
       Разные ответы подсказывали бы, какой ник особенный. */
    if (result.error === 'owner_claim_closed' || result.error === 'owner_claim_denied') {
      return json(res, 409, { error: 'username_taken' });
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

    // Car/Console/TV на доверенном устройстве: код профиля не спрашиваем, если владелец это включил.
    const skipCode = profile.twoFactorEnabled && !body.code && await mayOpenWithoutCode(s.skyId, profileId, req);
    if (profile.twoFactorEnabled && !skipCode) {
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
      if (check.error) return json(res, check.error === 'too_many_attempts' ? 429 : 401, { error: check.error });
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

  /* ── Доверенные устройства: пропуск кода профиля в Car/Console/TV ── */
  if (req.method === 'GET' && url === '/api/skyid/trusted-devices') {
    const s = await requireSkyId(req, res); if (!s) return true;
    return json(res, 200, { devices: await listTrusted(s.skyId, req) });
  }
  const trustedDel = url.match(/^\/api\/skyid\/trusted-devices\/([a-f0-9]{16})$/);
  if (req.method === 'DELETE' && trustedDel) {
    const s = await requireSkyId(req, res); if (!s) return true;
    const tb = (await parseBody(req).catch(() => ({}))) ?? {};
    const need = await needDeviceCode(s.skyId, tb.twoFactorCode);
    if (need) return json(res, need.status, need.body);
    return (await revokeTrusted(s.skyId, trustedDel[1])) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'not_found' });
  }
  const skipMatch = url.match(/^\/api\/skyid\/profiles\/([\w.-]+)\/skip-code$/);
  if (req.method === 'POST' && skipMatch) {
    const s = await requireSkyId(req, res); if (!s) return true;
    const body = await parseBody(req);
    const profile = await getProfileOfSkyId(s.skyId, skipMatch[1]);
    if (!profile) return json(res, 404, { error: 'not_found' });
    // Включить пропуск — ослабить защиту: просим код профиля, пока он стоит. Выключить можно без кода.
    if (body.on === true && profile.twoFactorEnabled) {
      if (!body.code) return json(res, 401, { error: 'profile_code_required', method: profile.twoFactorMethod ?? 'app' });
      const check = await verifyProfileTwoFactor(s.skyId, skipMatch[1], body.code);
      if (check.error) return json(res, check.error === 'too_many_attempts' ? 429 : 401, { error: check.error });
    }
    await setSkipFlag(s.skyId, skipMatch[1], body.on === true);
    return json(res, 200, { ok: true, skipCodeTrusted: body.on === true });
  }

  const patchMatch = url.match(/^\/api\/skyid\/profiles\/([\w.-]+)$/);
  if (req.method === 'PATCH' && patchMatch) {
    const s = await requireSkyId(req, res); if (!s) return true;
    const body = await parseBody(req);
    const av = avatarPatch(body.avatar), bn = avatarPatch(body.banner);
    if (av.error) return json(res, 400, { error: 'invalid_avatar', maxBytes: AVATAR_MAX });
    if (bn.error) return json(res, 400, { error: 'invalid_banner', maxBytes: AVATAR_MAX });
    const result = await updateProfile(s.skyId, patchMatch[1], {
      name:   body.name   !== undefined ? sanitizeInput(body.name) : undefined,
      avatar: av.value,
      // Баннер — та же картинка, что и аватар, просто другое поле; тот
      // же приём проверки формата/размера.
      banner: bn.value,
      bio:    body.bio    !== undefined ? sanitizeInput(body.bio) : undefined,
      // Регион существующей системы (src/region) — сохраняем то, что
      // человек уже выбрал в RegionPicker, ничего не решая за него.
      regionCode: body.regionCode !== undefined ? body.regionCode : undefined,
      // Косметика расширенного профиля — см. updateProfile/EXTRA_FIELDS
      // в skyid.mjs: неизвестные ключи и слишком длинные значения там же
      // отбрасываются, здесь только пропускаем объект как есть.
      extra: body.extra !== undefined && typeof body.extra === 'object' ? body.extra : undefined,
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
      if (result.error) return json(res, result.error === 'too_many_attempts' ? 429 : 400, { error: result.error });
      return json(res, 200, { ok: true, profile: await getProfileOfSkyId(s.skyId, profileId) });
    }

    // Отключение требует действующего кода: иначе тому, кто дорвался до
    // открытой вкладки, достаточно нажать кнопку.
    const check = await verifyProfileTwoFactor(s.skyId, profileId, body.code);
    if (check.error) return json(res, check.error === 'too_many_attempts' ? 429 : 401, { error: check.error });
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
    if (result.error) return json(res, result.error === 'too_many_attempts' ? 429 : 400, { error: result.error });
    return json(res, 200, { ok: true, skyId: publicSkyId(await findSkyIdById(s.skyId)) });
  }

  if (req.method === 'POST' && url === '/api/skyid/two-factor/disable') {
    const s = await requireSkyId(req, res); if (!s) return true;
    const body = await parseBody(req);
    const sky = await findSkyIdById(s.skyId);
    if (sky.two_factor_enabled) {
      const check = await verifySkyTwoFactor(s.skyId, body.code);
      if (check.error) return json(res, check.error === 'too_many_attempts' ? 429 : 401, { error: check.error });
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

    // Замена УЖЕ подтверждённой почты — только при втором факторе (или коде на текущую почту): украденная сессия контакт не перепривяжет
    const before = await findSkyIdById(s.skyId);
    if (!before?.email_verified || String(before.email).toLowerCase() !== email) {
      const guard = await guardContactChange(s.skyId, 'email', body, verifySkyTwoFactor);
      if (guard) return json(res, guard.error === 'too_many_attempts' ? 429 : guard.error === 'cannot_prove_ownership' ? 409 : 401, guard);
    }

    const check = await verifyCode('email', email, `link:${s.skyId}`, body.code);
    if (check.error) return json(res, 401, { error: check.error, attemptsLeft: check.attemptsLeft });

    const result = await setEmailVerified(s.skyId, email);
    if (result.error) return json(res, 409, { error: result.error });
    if (before?.email_verified) await noteContactChanged(s.skyId, 'email', before.email, email, clientIp(req)).catch((e) => console.error('[skyid] уведомление о смене почты:', e.message));
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

    const before = await findSkyIdById(s.skyId);
    if (!before?.phone_verified || before.phone !== phone) {
      const guard = await guardContactChange(s.skyId, 'phone', body, verifySkyTwoFactor);
      if (guard) return json(res, guard.error === 'too_many_attempts' ? 429 : guard.error === 'cannot_prove_ownership' ? 409 : 401, guard);
    }

    const check = await verifyCode('phone', phone, `link:${s.skyId}`, body.code);
    if (check.error) return json(res, 401, { error: check.error, attemptsLeft: check.attemptsLeft });

    const result = await setPhoneVerified(s.skyId, phone);
    if (result.error) return json(res, 409, { error: result.error });
    if (before?.phone_verified) await noteContactChanged(s.skyId, 'phone', before.phone, phone, clientIp(req)).catch((e) => console.error('[skyid] уведомление о смене номера:', e.message));
    return json(res, 200, { ok: true, skyId: publicSkyId(result.skyId) });
  }

  /* ══ Prime ═══════════════════════════════════════════════════════
     Prime принадлежит профилю. Начисление проходит через проверку
     принадлежности профиля Sky ID, поэтому выписать Prime чужому
     профилю, подменив id в запросе, нельзя.                          */

  if (req.method === 'POST' && url === '/api/skyid/prime/grant') {
    const s = await requireProfile(req, res); if (!s) return true;
    // ТВ, консоль и машина подписку не оформляют: «Откройте приложение Sky на телефоне» (entitlements.mjs).
    if (!purchaseAllowedOn(req)) return json(res, 403, { error: 'purchase_not_on_device' });
    const body = await parseBody(req);

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

    /* Купон Sky Codes: скидка читается из базы, а не из запроса. Купон
       занимается атомарно ДО списания и возвращается, если покупка не
       состоялась. */
    const coupon = await claimPrimeCoupon(target, `prime:${days}`);
    const charge = coupon ? discountedPrice(price, coupon.percent) : price;

    let bought;
    try {
      bought = await purchasePrime(s.skyId, target, days, charge);
    } catch {
      if (coupon) await releaseCoupon(coupon.id);
      skyLog({ category: 'user', service: 'prime', type: 'prime_purchase_failed', level: 'ERROR', actorId: target, result: 'error', reason: 'grant_failed' });
      return json(res, 500, { error: 'grant_failed' });
    }
    if (bought.error) {
      if (coupon) await releaseCoupon(coupon.id);
      return json(res, bought.error === 'already_lifetime' ? 409 : 400, bought);
    }
    const paid = { balance: bought.balance };
    const result = { profile: bought.profile };
    awardCashback({ trigger: 'prime_purchase', profileId: target, amountRub: charge, ref: `prime:${target}:${Date.now()}:${days}` }).catch(() => {});
    skyLog({ category: 'user', service: 'prime', type: 'prime_purchase', actorId: target, detail: { days, price: charge, coupon: Boolean(coupon) } });
    return json(res, 200, {
      profile: result.profile, profiles: await listProfiles(s.skyId),
      balance: paid.balance, price: charge,
      ...(coupon ? { discount: { percent: coupon.percent, listPrice: price } } : {}),
    });
  }

  if (req.method === 'POST' && url === '/api/skyid/prime/revoke') {
    const s = await requireProfile(req, res); if (!s) return true;
    if (!purchaseAllowedOn(req)) return json(res, 403, { error: 'purchase_not_on_device' });
    const body = await parseBody(req);
    const target = body.profileId ? String(body.profileId) : s.profileId;
    const result = await revokePrime(s.skyId, target);
    if (result.error) return json(res, 404, { error: result.error });
    return json(res, 200, { profile: result.profile, profiles: await listProfiles(s.skyId) });
  }

  return false;
};
