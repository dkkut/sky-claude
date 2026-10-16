/* ===============================================================
   КЛИЕНТ SKY ID

   Sky ID — это учётная запись (телефон, почта, двухэтапная защита),
   внутри которой живут профили (имя, ник, аватар, Prime, кошелёк).
   Вход выполняется в Sky ID, работа идёт от имени выбранного профиля.

   Access-токен держим только в памяти вкладки: в localStorage его
   класть нельзя — оттуда его заберёт любой скрипт, дорвавшийся до
   страницы. Refresh-токен браузеру вообще не виден, он приходит
   в HttpOnly-куке и уходит обратно сам.

   Ни одно решение здесь не принимается: сколько профилей можно
   завести, есть ли Prime, нужен ли второй фактор — отвечает сервер.
   Этот файл только спрашивает и показывает ответ.
=============================================================== */
import { isEnglish } from '@/i18n/lang';
import { NATIVE_APP, IOS_WEB, API_ORIGIN, nativeStore, REFRESH_TOKEN_KEY, BETA_TOKEN_KEY } from '../nativeApp';

/** Способ второго фактора: код из приложения или письмо на почту. */
export type TwoFactorMethod = 'app' | 'email' | 'sms';

export interface SkyIdInfo {
  id:                 string;
  /** Телефон необязателен: аккаунт может жить на одной почте. */
  phone?:             string;
  phoneVerified:      boolean;
  email?:             string;
  emailVerified:      boolean;
  twoFactorEnabled:   boolean;
  twoFactorMethod:    TwoFactorMethod;
  /** Есть ли способ входа почтой и паролем. */
  passwordSet?:       boolean;
  createdAt?:         string;
}

export interface ServerProfile {
  id:               string;
  skyId:            string;
  username:         string;
  name:             string;
  avatar?:          string | null;
  bio?:             string | null;
  banner?:          string | null;
  customStatus?:    string;
  statusEmoji?:     string;
  links?:           string[];
  country?:         string;
  language?:        string;
  timezone?:        string;
  nameSticker?:     string;
  nameColor?:       string;
  birthDate?:       string;
  isAdmin:          boolean;
  isPrime:          boolean;
  primeExpiresAt?:  string | null;
  primePlan?:       string | null;
  twoFactorEnabled: boolean;
  twoFactorMethod:  TwoFactorMethod;
  /** Не спрашивать код профиля в Car/Console/TV на доверенных устройствах. */
  skipCodeTrusted?: boolean;
  createdAt?:       string;
  /** Регион уже существующей системы смены региона (src/region), если
      сохранён на сервере — см. server/regions.mjs. */
  regionCode?:      string;
}

/** Полное состояние входа, как его видит сервер. */
export interface SkySession {
  skyId:           SkyIdInfo;
  profiles:        ServerProfile[];
  activeProfileId: string | null;
  maxProfiles:     number;
}

/** Живёт только в памяти вкладки. Перезагрузка страницы его теряет — это намеренно. */
let accessToken: string | null = null;

export const getAccessToken = () => accessToken;
export const setAccessToken = (t: string | null) => { accessToken = t; };

/**
 * Только для родного приложения (Android/Windows): пропуск беты в памяти,
 * чтобы raw() мог приложить его синхронно к каждому запросу. Refresh-
 * токен в память не кладём — он читается из защищённого хранилища прямо
 * перед отправкой (см. refreshOnce/apiRefreshSession), в памяти вкладки
 * ему делать нечего по той же причине, что и access-токену.
 */
let nativeBetaToken: string | null = null;

/** Подгружает сохранённый пропуск беты перед первым запросом. Вызывать
 *  один раз при старте приложения, только когда NATIVE_APP. */
export const initNativeAuth = async () => {
  if (!NATIVE_APP) return;
  nativeBetaToken = await nativeStore.get(BETA_TOKEN_KEY);
};

type Json = Record<string, unknown>;

/* ─── Сообщения об ошибках ───────────────────────────────────── */
const ERRORS: Record<string, string> = {
  beta_required:         'Нужен ключ доступа к закрытой бете',
  platform_shutdown:     'Идут аварийные работы',
  platform_maintenance:  'Идут технические работы',
  invalid_beta_key:      'Такой ключ не подходит',
  invalid_phone:         'Проверьте номер телефона',
  invalid_email:         'Проверьте адрес почты',
  invalid_code:          'Неверный код',
  code_expired:          'Код устарел — запросите новый',
  too_many_attempts:     'Слишком много попыток. Запросите новый код',
  too_soon:              'Код уже отправлен, подождите немного',
  too_many_requests:     'Слишком много запросов кода. Попробуйте через час',
  rate_limited:          'Слишком много попыток, подождите минуту',
  invalid_username:      'Ник: 3–32 символа, латиница, цифры и _',
  invalid_name:          'Имя: от 2 до 64 символов',
  username_taken:        'Такой ник уже занят',
  legal_not_accepted:    'Чтобы завести Sky ID, нужно принять документы',
  email_taken:           'Эта почта уже привязана к другому Sky ID',
  email_not_verified:    'Сначала привяжите и подтвердите почту',
  phone_not_verified:    'Сначала привяжите и подтвердите телефон',
  phone_taken:           'Этот номер уже привязан к другому Sky ID',
  already_enabled:       'Защита уже включена. Чтобы сменить способ, сначала отключите её',
  invalid_method:        'Такой способ проверки не поддерживается',
  not_started:           'Настройка не начата — начните заново',
  profile_limit_reached: 'На один Sky ID можно завести не больше двух профилей',
  profile_code_required: 'Профиль защищён — введите код из приложения',
  two_factor_required:   'Введите код из приложения',
  current_email_code_required: 'Введите код, отправленный на вашу текущую почту',
  cannot_prove_ownership: 'Нечем подтвердить, что аккаунт ваш: включите аутентификатор или обратитесь в поддержку',
  admin_manual:          'Для аккаунтов администраторов это выполняет владелец на сервере',
  challenge_expired:     'Время вышло — начните вход заново',
  not_found:             'Не найдено',
  registration_closed:   'Регистрация новых аккаунтов временно закрыта. Войти могут только уже зарегистрированные',
  registration_daily_limit: 'Сегодня регистрации новых аккаунтов уже закончились. Попробуйте позже',
  registration_ip_limit: 'С этого адреса уже создано максимум аккаунтов. Попробуйте позже',
  account_frozen:        'Новые входы в этот аккаунт заморожены его владельцем. Разморозить можно на устройстве, где вход уже выполнен: Профиль → Sky ID → Устройства',
  nothing_to_do:         'Выберите, что сделать',
  bad_period:            'Выберите период из списка',
  bad_freeze:            'Выберите срок заморозки из списка',
  link_required:         'Сначала откройте ссылку из письма и подтвердите её',
  invalid_link:          'Ссылка недействительна, уже использована или заморозка закончилась',
  not_frozen:            'Новые входы не заморожены',
  wrong_verify:          'Число не совпало с тем, что на экране устройства',
  bad_verify:            'Введите двузначное число с экрана устройства',
  totp_required:         'Введите код из приложения-аутентификатора',
  exhausted:             'Слишком много неверных чисел — запрос закрыт, начните заново на устройстве',
  unauthorized:          'Сессия закончилась, войдите заново',
  no_active_profile:     'Сначала выберите профиль',
  sms_not_configured:    'Отправка кодов пока не настроена',
  email_not_configured:  'Отправка писем пока не настроена',
  payments_not_configured: 'Оплата пока не подключена',
  file_too_large:      'Файл слишком большой (до 10 МБ)',
  quota_exceeded:      'Закончилось место для вложений',
  empty_file:          'Пустой файл',
  /* Вход и смена пароля. invalid_credentials нарочно одно и то же для
     «нет такой почты» и «неверный пароль» — иначе по ответу можно было
     бы собирать список заведённых адресов. */
  invalid_credentials:   'Неверная почта или пароль',
  account_locked:        'Слишком много неверных попыток — подождите 15 минут',
  password_too_short:    'Пароль: минимум 8 символов',
  password_too_long:     'Пароль слишком длинный',
  password_too_weak:     'Пароль не должен совпадать с почтой',
  wrong_password:        'Неверный текущий пароль',
  no_password_set:       'Пароль ещё не задан',
  email_required:        'Сначала привяжите и подтвердите почту',
  insufficient_points:   'Не хватает баллов',
  invalid_avatar:        'Изображение не подошло: слишком большое или неподдерживаемый формат',
  invalid_banner:        'Изображение не подошло: слишком большое или неподдерживаемый формат',
  bad_daily_limit: 'Дневной лимит ниже цены площадки. Выберите один из предложенных.',
  bad_duration: 'Срок меньше минимального для этой площадки или больше 30 дней.',
  bad_placement: 'Такой площадки нет.', bad_format: 'Этот формат не подходит для выбранной площадки.',
  empty_title: 'Введите заголовок.', media_required: 'Для этого формата нужно загрузить файл.',
  bad_link: 'Ссылка должна начинаться с https://', bad_media: 'Файл не принят, загрузите его заново.',
  insufficient_funds:    'Недостаточно средств на балансе — пополните кошелёк',
  invalid_plan:          'Такого тарифа нет',
  grant_failed:          'Не удалось оформить подписку, деньги возвращены на баланс',
  not_active_profile:    'Подписку можно оформить только на активный профиль',
  already_owned:         'Уже куплено',
  not_owned:             'Сначала нужно купить',
  pin_required:          'Подтвердите PIN-код: вы зашли с нового адреса',
  wrong_pin:             'Неверный PIN-код',
  locked:                'Слишком много неверных попыток — ввод PIN временно заблокирован',
  bad_pin:               'PIN — ровно четыре цифры',
  bad_code:              'Код не подошёл',
  bad_codes:             'Коды не подошли — проверьте код с почты и код из аутентификатора',
  no_request:            'Сначала запросите код на почту (он живёт 15 минут)',
  authenticator_required:'Для PIN нужен включённый аутентификатор (Профиль → Sky ID → Защита)',
  session_ended:         'Слишком много неверных попыток — сессия завершена. Войдите заново',
};

export const explain = (code?: string, status?: number) =>
  (code && ERRORS[code]) || (code ? `Не получилось (${code})` : `Ошибка сервера (${status ?? '?'})`);

/* ─── Транспорт ──────────────────────────────────────────────── */
const readJson = async (res: Response): Promise<any> => {
  try { return await res.json(); } catch { return {}; }
};

/** Случайный идентификатор этого устройства: сервер хранит только его хеш (доверенные устройства). */
const deviceId = (): string => {
  try {
    let id = localStorage.getItem('sky:device:v1') ?? '';
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      const b = new Uint8Array(24); crypto.getRandomValues(b);
      id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem('sky:device:v1', id);
    }
    return id;
  } catch { return ''; }
};
const skyMode = (): string => (typeof document !== 'undefined' ? document.documentElement.dataset.skyMode ?? '' : '');

const raw = (path: string, init: RequestInit = {}) =>
  fetch(NATIVE_APP ? API_ORIGIN + path : path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      // Родное приложение метит каждый запрос: сервер по этому заголовку
      // отличает его от браузера и кладёт refresh/beta-токен в тело
      // ответа вместо (или вместе с) HttpOnly-кукой — см. appBody в
      // server/http.mjs. Обычный браузер этот заголовок не шлёт и
      // токены в теле не получает.
      ...(isEnglish() ? { 'X-Sky-Lang': 'en' } : {}),
      ...(deviceId() ? { 'X-Sky-Device': deviceId() } : {}),
      ...(skyMode() ? { 'X-Sky-Mode': skyMode() } : {}),
      ...(NATIVE_APP ? { 'X-Sky-Client': 'app' } : {}),
      // iPhone в браузере: пропуск медиа нужен и в теле ответа — см. mediaBody в server/http.mjs.
      ...(IOS_WEB ? { 'X-Sky-Media-Url': '1' } : {}),
      ...(NATIVE_APP && nativeBetaToken ? { 'X-Sky-Beta': nativeBetaToken } : {}),
      ...(init.headers ?? {}),
    },
    // Родное приложение открыто с другого origin, чем API (свой бандл, а
    // не боевой домен) — куки там всё равно нет и same-origin её не
    // отправит; сессию оно носит явным токеном (см. refreshOnce ниже).
    credentials: NATIVE_APP ? 'omit' : 'same-origin',
  });

/**
 * То же самое (абсолютный адрес + пометка родного приложения) для сырых
 * XMLHttpRequest-загрузок файлов (видео, аудио и т.п.) — raw() выше их
 * не касается, а без этого upload в приложении просто не долетал бы до
 * сервера: относительный путь резолвился бы в собственный origin
 * приложения (https://localhost у Capacitor, app://sky у Electron), а
 * калитка беты отклоняла бы запрос без X-Sky-Beta.
 */
export const uploadUrl = (path: string) => (NATIVE_APP ? API_ORIGIN + path : path);

export const nativeXhrHeaders = (): Record<string, string> => (
  NATIVE_APP
    ? { 'X-Sky-Client': 'app', ...(nativeBetaToken ? { 'X-Sky-Beta': nativeBetaToken } : {}) }
    : {}
);

/** Чтобы несколько одновременных 401 не устроили гонку обновлений. */
let refreshing: Promise<boolean> | null = null;

const refreshOnce = (): Promise<boolean> => {
  refreshing ??= (async () => {
    const body = NATIVE_APP ? { refreshToken: (await nativeStore.get(REFRESH_TOKEN_KEY)) ?? '' } : {};
    const res  = await raw('/api/auth/refresh', { method: 'POST', body: JSON.stringify(body) });
    const data = await readJson(res);
    if (!res.ok) { setAccessToken(null); return false; }
    setAccessToken(data.accessToken ?? null);
    if (NATIVE_APP && typeof data.refreshToken === 'string') {
      await nativeStore.set(REFRESH_TOKEN_KEY, data.refreshToken);
    }
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
};

export interface Reply<T> { ok: boolean; data?: T; error?: string; reason?: string; status: number }

/* ─── Калитка закрытой беты ──────────────────────────────────────
   Пока приложение не готово, сервер отвечает на любой запрос к API
   отказом beta_required, если у браузера нет пропуска. Здесь мы лишь
   замечаем этот отказ и сообщаем о нём приложению — решает сервер. */

/** PIN при смене IP (server/ippin.mjs): сервер закрыл сессию, пока не введён PIN. */
let onPinRequired: (() => void) | null = null;
export const setPinRequiredHandler = (fn: (() => void) | null) => { onPinRequired = fn; };

let onBetaRequired: (() => void) | null = null;
export const setBetaRequiredHandler = (fn: (() => void) | null) => { onBetaRequired = fn; };

/* ─── «Аварийные работы» / «Технические работы» ───────────────────
   Сайт целиком, не путать с аварийным режимом панели администратора
   (тот виден только внутри самой панели). Сервер отвечает 503 с одним
   из двух кодов на любой запрос — замечаем и показываем нужный экран. */

export type PlatformBlock = { kind: 'shutdown' | 'maintenance'; reason: string } | null;
let onPlatformBlocked: ((block: PlatformBlock) => void) | null = null;
export const setPlatformBlockedHandler = (fn: ((block: PlatformBlock) => void) | null) => { onPlatformBlocked = fn; };

/**
 * Запрос к API. Если access протух — обновляемся один раз и повторяем;
 * второй неудачи достаточно, чтобы считать сессию законченной.
 */
/** Короткие сбои сети и прокси (502/503/504) у чтения: повторяем, а не оставляем пустой экран. */
const TRANSIENT_RETRY_MS = [400, 1200];
const isRead = (init: RequestInit) => !init.method || init.method.toUpperCase() === 'GET';
const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const call = async <T>(path: string, init: RequestInit = {}, retry = true, transient = 0): Promise<Reply<T>> => {
  let res: Response;
  try {
    res = await raw(path, init);
  } catch {
    // Только чтение: повтор записи мог бы выполнить действие дважды.
    if (isRead(init) && transient < TRANSIENT_RETRY_MS.length && typeof navigator !== 'undefined' && navigator.onLine !== false) {
      await sleepMs(TRANSIENT_RETRY_MS[transient]);
      return call<T>(path, init, retry, transient + 1);
    }
    /* В родном приложении fetch к чужому origin бросает ровно то же
       исключение и при обрыве сети, и при отказе CORS (сервер не
       прислал Access-Control-Allow-Origin для этого origin — см.
       EXTRA_ORIGINS в DEPLOY.md) — но на практике для устройства с
       интернетом второе куда вероятнее первого, и générique «нет
       связи» выглядит как баг приложения, а не как то, что сервер
       ещё не знает об этом origin. Подсказываем ровно это, не завышая
       уверенность: сеть тоже может быть ни при чём. */
    const reason = NATIVE_APP
      ? 'Сервер не отвечает этому приложению (возможно, не настроен на его стороне) — либо нет связи с интернетом'
      : 'Нет связи с сервером';
    return { ok: false, error: 'network', reason, status: 0 };
  }

  if (res.status === 401 && retry && path !== '/api/auth/refresh') {
    if (await refreshOnce()) return call<T>(path, init, false, transient);
  }

  // nginx на рестарте/деплое api отвечает 502/504, перегрузка — 503 без
  // кода площадки: подождать долю секунды дешевле, чем показать ошибку.
  if (isRead(init) && (res.status === 502 || res.status === 504 || res.status === 503)
      && transient < TRANSIENT_RETRY_MS.length) {
    const peek = await res.clone().json().catch(() => null) as { error?: string } | null;
    if (!peek?.error?.startsWith('platform_')) {
      await sleepMs(TRANSIENT_RETRY_MS[transient]);
      return call<T>(path, init, retry, transient + 1);
    }
  }

  const data = await readJson(res);
  if (!res.ok) {
    if (res.status === 403 && data?.error === 'beta_required') onBetaRequired?.();
    if (res.status === 403 && data?.error === 'pin_required') onPinRequired?.();
    if (res.status === 503 && data?.error === 'platform_shutdown') onPlatformBlocked?.({ kind: 'shutdown', reason: String(data?.reason ?? '') });
    if (res.status === 503 && data?.error === 'platform_maintenance') onPlatformBlocked?.({ kind: 'maintenance', reason: String(data?.reason ?? '') });
    return { ok: false, error: data?.error, reason: (data?.message && String(data?.error).startsWith('registration_')) ? String(data.message) : explain(data?.error, res.status), status: res.status, data };
  }

  // Родное приложение подхватывает refresh/beta-токен из ЛЮБОГО ответа,
  // который его несёт (вход, проверка кода, обновление сессии, разблок
  // беты) — один общий перехват вместо правки каждой из этих ручек по
  // отдельности. Сервер кладёт их в тело только вместе с заголовком
  // X-Sky-Client: app (см. appBody в server/http.mjs), так что обычный
  // браузер сюда никогда не попадает.
  if (NATIVE_APP) {
    if (typeof data?.refreshToken === 'string') void nativeStore.set(REFRESH_TOKEN_KEY, data.refreshToken);
    if (typeof data?.betaToken === 'string') {
      nativeBetaToken = data.betaToken;
      void nativeStore.set(BETA_TOKEN_KEY, data.betaToken);
    }
  }

  return { ok: true, data, status: res.status };
};

/**
 * Тот же запрос наружу модуля: поддержка ходит своими маршрутами, но
 * должна пользоваться общим обновлением токена и общей обработкой
 * закрытой беты, а не заводить второй такой же механизм.
 */
export const apiCall = call;

/** GET двоичного файла (документ, скан): та же сессия, результат — Blob. */
export const apiBlob = async (path: string): Promise<{ ok: boolean; status: number; blob: Blob | null }> => {
  let res: Response;
  try {
    res = await raw(path);
    if (res.status === 401 && await refreshOnce()) res = await raw(path);
  } catch { return { ok: false, status: 0, blob: null }; }
  return { ok: res.ok, status: res.status, blob: res.ok ? await res.blob() : null };
};

/** GET, ответ которого — не JSON (выгрузка CSV): та же сессия и то же обновление токена. */
export const apiText = async (path: string): Promise<{ ok: boolean; status: number; text: string }> => {
  let res: Response;
  try {
    res = await raw(path);
    if (res.status === 401 && await refreshOnce()) res = await raw(path);
  } catch { return { ok: false, status: 0, text: '' }; }
  return { ok: res.ok, status: res.status, text: await res.text() };
};

const post = <T>(path: string, body: Json = {}) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: Json = {}) =>
  call<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const get = <T>(path: string) => call<T>(path);

/* ═══ Вход ═══════════════════════════════════════════════════ */

export interface CodeRequested { ok: true; retryAfter: number; expiresIn: number; codeLength: number }

/** Шаг 1 основного пути: просим код на почту. */
export const apiRequestEmailCode = (email: string) =>
  post<CodeRequested>('/api/auth/email/start', { email });

/** Шаг 2 основного пути: проверяем код из письма. */
export const apiVerifyEmailCode = (email: string, code: string) =>
  post<LoginResult>('/api/auth/email/verify', { email, code });

/**
 * Второй, необязательный путь: почта и пароль, без кода на каждый вход.
 * Слабее основного — пароль можно списать или переиспользовать с
 * другого сайта, — поэтому клиент обязан показать предупреждение
 * рядом с этой кнопкой, а не только рядом с формой создания пароля.
 */
export const apiLoginWithPassword = (email: string, password: string) =>
  post<LoginResult>('/api/auth/password/login', { email, password });

export const apiStartPasswordSetup = () =>
  post<CodeRequested & { email: string }>('/api/auth/password/setup/start');
export const apiFinishPasswordSetup = (password: string, code: string) =>
  post<{ ok: true }>('/api/auth/password/setup', { password, code });
export const apiChangePassword = (currentPassword: string, newPassword: string) =>
  post<{ ok: true; accessToken: string; expiresIn: number }>('/api/auth/password/change', { currentPassword, newPassword });
export const apiRemovePassword = () =>
  post<{ ok: true }>('/api/auth/password/remove');
export const apiForgotPassword = (email: string) =>
  post<CodeRequested>('/api/auth/password/forgot', { email });
export const apiResetPassword = (email: string, code: string, password: string) =>
  post<{ ok: true }>('/api/auth/password/reset', { email, code, password });

/** Шаг 1 запасного пути: просим код на телефон. */
export const apiRequestPhoneCode = (phone: string) =>
  post<CodeRequested>('/api/auth/phone/start', { phone });

/** Сколько секунд осталось до повторной отправки. */
export const apiPhoneCooldown = (phone: string) =>
  post<{ retryAfter: number }>('/api/auth/phone/cooldown', { phone });

export type LoginResult =
  | ({ needsTwoFactor: true; method: TwoFactorMethod; challenge: string;
       expiresIn: number; email?: string; phone?: string;
       sameChannel?: boolean; retryAfter?: number })
  | (SkySession & { accessToken: string; expiresIn: number; isNew?: boolean });

/** Прежнее имя оставлено, чтобы не переписывать всё сразу. */
export type PhoneVerified = LoginResult;

/** Шаг 2: проверяем код. Может ответить «нужен второй фактор». */
export const apiVerifyPhoneCode = (phone: string, code: string) =>
  post<PhoneVerified>('/api/auth/phone/verify', { phone, code });

/** Шаг 3: второй фактор самого Sky ID. */
export const apiVerifySkyTwoFactor = (challenge: string, code: string) =>
  post<SkySession & { accessToken: string }>('/api/auth/two-factor/verify', { challenge, code });

/** Прислать код второго фактора на почту ещё раз (на экране входа). */
export const apiResendLoginTwoFactor = (challenge: string) =>
  post<{ ok: true; email: string; retryAfter: number }>('/api/auth/two-factor/send', { challenge });

/**
 * Восстановление сессии — вызывается при старте приложения. У обычного
 * браузера это кука; у родного приложения своего origin нет куки, и оно
 * посылает сохранённый refresh-токен явно (ответ подхватывается общим
 * перехватом в call()).
 */
export const apiRefreshSession = async (): Promise<Reply<SkySession & { accessToken: string }>> => {
  const body = NATIVE_APP ? { refreshToken: (await nativeStore.get(REFRESH_TOKEN_KEY)) ?? '' } : {};
  const res = await post<SkySession & { accessToken: string }>('/api/auth/refresh', body);
  if (res.ok && res.data) setAccessToken(res.data.accessToken ?? null);
  else setAccessToken(null);
  return res;
};

/** Текущее состояние входа по мнению сервера. */
export const apiSession = () => get<SkySession>('/api/auth/session');

export const apiLogout = async (): Promise<void> => {
  try {
    // Кука несёт refresh-токен у браузера сама; у родного приложения
    // куки нет, и сервер не найдёт сессию для отзыва без явного токена.
    const body = NATIVE_APP ? { refreshToken: (await nativeStore.get(REFRESH_TOKEN_KEY)) ?? '' } : {};
    await post('/api/auth/logout', body);
  } finally {
    setAccessToken(null);
    if (NATIVE_APP) await nativeStore.remove(REFRESH_TOKEN_KEY);
  }
};

/* ═══ Устройства ═════════════════════════════════════════════
   Настоящий список сессий Sky ID (server/sessions.mjs) — раньше
   «Устройства» рисовались из localStorage и «завершить сессию» ничего
   не завершало нигде, кроме своего же браузера. */

export interface ServerDevice {
  id: string; ua: string; createdAt: string; lastSeenAt: string; isCurrent: boolean;
  via?: { kind: string; label: string } | null;
}

export const apiListDevices = () =>
  get<{ devices: ServerDevice[] }>('/api/auth/devices');

export const apiRevokeDevice = (id: string) =>
  post<{ ok: true; isCurrent: boolean }>(`/api/auth/devices/${encodeURIComponent(id)}/revoke`);

/* ─── Доверенные устройства ─── */
export interface TrustedDevice { id: string; label: string; firstSeen: string; lastSeen: string; current: boolean }
export const apiTrustedDevices = () => get<{ devices: TrustedDevice[] }>('/api/skyid/trusted-devices');
export const apiRevokeTrusted = (id: string) => call<{ ok: true }>(`/api/skyid/trusted-devices/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const apiSetSkipCode = (profileId: string, on: boolean, code?: string) =>
  post<{ ok: true; skipCodeTrusted: boolean }>(`/api/skyid/profiles/${encodeURIComponent(profileId)}/skip-code`, { on, ...(code ? { code } : {}) });

export const apiRevokeAllDevices = () =>
  post<{ ok: true }>('/api/auth/devices/revoke-all');

/* ═══ Профили ════════════════════════════════════════════════ */

export const apiListProfiles = () =>
  get<{ profiles: ServerProfile[]; activeProfileId: string | null; maxProfiles: number }>('/api/skyid/profiles');

/**
 * Создание профиля. Для первого профиля Sky ID сервер требует
 * `acceptLegal`: первый профиль — это и есть регистрация, и согласие с
 * документами записывается именно там, вместе с их редакцией.
 */
export const apiCreateProfile = (
  p: { name: string; username: string; avatar?: string; acceptLegal?: boolean },
) => post<{ profile: ServerProfile; profiles: ServerProfile[] }>('/api/skyid/profiles', p);

/**
 * Выбор профиля. Sky ID при этом остаётся авторизованным — меняется
 * только активный профиль в той же сессии. Для защищённого профиля
 * нужен код: без него сервер отвечает profile_code_required.
 */
export const apiSelectProfile = async (profileId: string, code?: string) => {
  const res = await post<{ profile: ServerProfile; activeProfileId: string; accessToken: string }>(
    `/api/skyid/profiles/${encodeURIComponent(profileId)}/select`, code ? { code } : {},
  );
  if (res.ok && res.data?.accessToken) setAccessToken(res.data.accessToken);
  return res;
};

export interface ProfileExtraPatch {
  customStatus?: string; statusEmoji?: string; links?: string[];
  country?: string; language?: string; timezone?: string;
  nameSticker?: string; nameColor?: string; birthDate?: string;
}

export const apiUpdateProfile = (profileId: string, p: {
  name?: string; avatar?: string; banner?: string; bio?: string;
  regionCode?: string; extra?: ProfileExtraPatch;
}) =>
  patch<{ profile: ServerProfile }>(`/api/skyid/profiles/${encodeURIComponent(profileId)}`, p);

/** То немногое, что видно о чужом профиле: имя, ник, аватар, Prime, приватность. */
export interface PublicProfile {
  id: string;
  name: string;
  username: string;
  avatar?: string;
  bio?: string;
  banner?: string;
  nameSticker?: string;
  nameColor?: string;
  customStatus?: string;
  statusEmoji?: string;
  links?: string[];
  country?: string;
  language?: string;
  timezone?: string;
  birthDate?: string;
  isAdmin: boolean;
  isPrime: boolean;
  primeUntil?: string;
  createdAt: string;
  isContact: boolean;
  privacy: {
    whoCanWrite: 'all' | 'contacts' | 'nobody';
    whoCanCall: 'all' | 'contacts' | 'nobody';
    whoSeesOnline: 'all' | 'contacts' | 'nobody';
    showPhone?: boolean; showBirthDate?: boolean; showGames?: boolean; showMusic?: boolean;
    showMovies?: boolean; showGifts?: boolean; showAchievements?: boolean; showFollowing?: boolean;
    showFriends?: boolean; showPhotos?: boolean; showStories?: boolean; showPosts?: boolean;
    showBio?: boolean; showBanner?: boolean; showNameCustomization?: boolean;
    showLinks?: boolean; showCustomStatus?: boolean;
  };
}

/** Профиль любого человека по id — независимо от того, свой он или чужой. */
export const apiPublicProfile = (profileId: string) =>
  get<{ profile: PublicProfile }>(`/api/skyid/profile/${encodeURIComponent(profileId)}`);

/* ═══ Двухэтапная защита профиля ═════════════════════════════ */

export const apiProfileTwoFactorBegin = (profileId: string, method: TwoFactorMethod = 'app') =>
  post<{ method: TwoFactorMethod; secret?: string; uri?: string; email?: string; retryAfter?: number }>(
    `/api/skyid/profiles/${encodeURIComponent(profileId)}/two-factor/begin`, { method });

/** Прислать код на почту ещё раз — и при настройке, и при входе в профиль. */
export const apiProfileTwoFactorSend = (profileId: string) =>
  post<{ ok: true; email: string; retryAfter: number }>(
    `/api/skyid/profiles/${encodeURIComponent(profileId)}/two-factor/send`);

export const apiProfileTwoFactorConfirm = (profileId: string, code: string) =>
  post<{ profile: ServerProfile }>(`/api/skyid/profiles/${encodeURIComponent(profileId)}/two-factor/confirm`, { code });

export const apiProfileTwoFactorDisable = (profileId: string, code: string) =>
  post<{ profile: ServerProfile }>(`/api/skyid/profiles/${encodeURIComponent(profileId)}/two-factor/disable`, { code });

/* ═══ Двухэтапная защита Sky ID ══════════════════════════════ */

export const apiSkyTwoFactorBegin = (method: TwoFactorMethod = 'app') =>
  post<{ method: TwoFactorMethod; secret?: string; uri?: string; email?: string; retryAfter?: number }>(
    '/api/skyid/two-factor/begin', { method });

export const apiSkyTwoFactorSend = () =>
  post<{ ok: true; email: string; retryAfter: number }>('/api/skyid/two-factor/send');

export const apiSkyTwoFactorConfirm = (code: string) =>
  post<{ skyId: SkyIdInfo }>('/api/skyid/two-factor/confirm', { code });

export const apiSkyTwoFactorDisable = (code: string) =>
  post<{ skyId: SkyIdInfo }>('/api/skyid/two-factor/disable', { code });

/* ═══ Привязка телефона ══════════════════════════════════════
   Телефон необязателен. Он нужен как второй канал проверки: код на
   него — настоящий второй фактор, потому что вход идёт по почте. */

export const apiPhoneLinkStart = (phone: string) =>
  post<{ ok: true; retryAfter: number }>('/api/skyid/phone/start', { phone });

/** `guard` — подтверждение замены УЖЕ подтверждённого контакта: код аутентификатора или код с текущей почты (сервер: accountrecovery.mjs). */
export interface ContactGuard { twoFactorCode?: string; currentEmailCode?: string }
export const apiPhoneLinkVerify = (phone: string, code: string, guard?: ContactGuard) =>
  post<{ skyId: SkyIdInfo }>('/api/skyid/phone/verify', { phone, code, ...guard });

export const apiContactGuardCode = () =>
  post<{ ok: true; email: string; retryAfter?: number }>('/api/skyid/contact/guard-code', {});

/* ═══ Почта ══════════════════════════════════════════════════ */

export const apiEmailStart = (email: string) =>
  post<{ ok: true; retryAfter: number; expiresIn: number }>('/api/skyid/email/start', { email });

export const apiEmailVerify = (email: string, code: string, guard?: ContactGuard) =>
  post<{ skyId: SkyIdInfo }>('/api/skyid/email/verify', { email, code, ...guard });

/* ═══ Prime ══════════════════════════════════════════════════ */

export const apiGrantPrime = (plan: string, days: number) =>
  post<{ profile: ServerProfile }>('/api/skyid/prime/grant', { plan, days });

export const apiRevokePrime = () =>
  post<{ profile: ServerProfile }>('/api/skyid/prime/revoke');

/* ═══ Закрытая бета ══════════════════════════════════════════ */

/** Нужен ли ключ вообще. Когда бета закончится, сервер ответит false. */
export const apiBetaStatus = () => get<{ required: boolean }>('/api/beta/status');

/** Обменивает ключ на пропуск. Сам ключ в браузере не сохраняется. */
export const apiBetaUnlock = (key: string) => post<{ ok: true }>('/api/beta/unlock', { key });

/* ═══ Справочник людей ═══════════════════════════════════════ */

export interface DirectoryPerson { id: string; name: string; username: string; avatar?: string }

/**
 * Поиск собеседника на сервере. До этого мессенджер искал людей в
 * списке аккаунтов внутри браузера и находил только тех, кто попал
 * туда при сборке, — то есть реального человека найти было нечем.
 */
export const apiSearchPeople = (q: string) =>
  get<{ people: DirectoryPerson[] }>(`/api/directory/search?q=${encodeURIComponent(q)}`);

/** Имена по известным id — для участников групп. */
export const apiPeopleByIds = (ids: string[]) =>
  get<{ people: DirectoryPerson[] }>(`/api/directory/people?ids=${encodeURIComponent(ids.join(','))}`);

/* ═══ Вложения ═══════════════════════════════════════════════ */

export interface UploadedFile { id: string; mime: string; size: number; name: string }

/** Потолок вложения — тот же, что на сервере. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Отправляет файл на сервер и возвращает его идентификатор.
 *
 * Байты идут телом как есть: картинка внутри JSON весит на треть
 * больше. Имя и чат — в строке запроса; на сервере файл лежит под своим
 * идентификатором, а имя нужно только для показа.
 */
export const apiUploadFile = async (chatId: string, file: File): Promise<Reply<{ file: UploadedFile }>> => {
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: 'file_too_large', reason: explain('file_too_large'), status: 413 };
  }
  const path = `/api/files?chatId=${encodeURIComponent(chatId)}&name=${encodeURIComponent(file.name)}`;
  return call<{ file: UploadedFile }>(path, {
    method: 'POST',
    body: file,
    // Тип содержимого сервер определяет по самим байтам: строка от
    // клиента ему не указ, поэтому здесь она нейтральная.
    headers: { 'Content-Type': 'application/octet-stream' },
  });
};

/**
 * Скачивает вложение.
 *
 * Через fetch, а не подстановкой адреса в src: токен доступа живёт в
 * памяти вкладки, и тег img его не отправит — картинка просто не
 * загрузится. Класть же токен в куку или в адрес значит завести второй
 * способ доказать, кто ты, и охранять его отдельно.
 */
export const apiFetchFile = async (path: string): Promise<Blob | null> => {
  const once = () => raw(path, { method: 'GET' });
  let res = await once();
  if (res.status === 401 && await refreshOnce()) res = await once();
  if (!res.ok) return null;
  return res.blob();
};

/* ═══ Прочее ═════════════════════════════════════════════════ */

/** Доступен ли бэкенд. Нужно, чтобы отличить «нет сети» от «неверный код». */
export const apiAvailable = async (): Promise<boolean> => {
  try {
    const res = await fetch(NATIVE_APP ? `${API_ORIGIN}/healthz` : '/healthz',
      { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
};


/* ═══ Вход на ТВ, консоли и в машине по QR / коду ════════════════
   Устройство просит код (/api/auth/link/*), телефон с уже выполненным
   входом подтверждает его (/api/skyid/link/*). См. server/devicelink.mjs. */

export type LinkKind = 'tv' | 'console' | 'car' | 'other';
export interface LinkStart { id: string; code: string; pollKey: string; verify: string; expiresIn: number; url: string }
export interface LinkDevice {
  id: string; kind: LinkKind; label: string; model: string; os: string; browser: string;
  ua: string; ip: string; lang: string; app: boolean; requestedAt: string; expiresAt: string; status: string;
}
export type LinkPoll =
  | { status: 'pending'; scanned?: boolean }
  | { status: 'approved'; session: SkySession & { accessToken?: string } }
  | { status: 'denied' | 'expired' | 'cancelled' | 'exhausted' | 'consumed' };

export const apiLinkStart = (kind: LinkKind, label?: string, lang?: string) =>
  post<LinkStart>('/api/auth/link/start', { kind, label, lang });
export const apiLinkPoll = (id: string, pollKey: string) =>
  post<LinkPoll>('/api/auth/link/poll', { id, pollKey });
export const apiLinkCancel = (id: string, pollKey: string) =>
  post<{ ok: true }>('/api/auth/link/cancel', { id, pollKey });
export const apiLinkLookup = (code: string) =>
  post<{ ok: true; device: LinkDevice; needsTotp: boolean }>('/api/skyid/link/lookup', { code });
export const apiLinkDecide = (id: string, approve: boolean, verify?: string, totp?: string) =>
  post<{ ok: true; status: string; attemptsLeft?: number }>('/api/skyid/link/decide', { id, approve, verify, totp });
export const apiLinkHistory = () =>
  get<{ items: (LinkDevice & { decidedAt: string | null; signedIn: boolean })[] }>('/api/skyid/link/history');


/* ═══ Защита аккаунта: очистка сессий и заморозка новых входов ═══
   См. server/accountfreeze.mjs. Разморозка вручную — ссылка из письма
   + баннер «Разморозка аккаунта» в «Устройствах». */

export interface FreezeEvent { kind: 'freeze' | 'cleanup' | 'link_opened' | 'unfreeze' | 'blocked_login'; ip: string; ua: string; detail: Record<string, unknown>; at: string }
export interface FreezeState {
  frozen: boolean; until: string | null; linkConfirmed: boolean; linkUntil: string | null;
  hasEmail: boolean; needsTotp: boolean; events: FreezeEvent[];
}
export interface ProtectRequest { remove: 'none' | 'last' | 'period'; hours?: number; freezeHours?: number }

export const apiFreezeState = () => get<FreezeState>('/api/auth/freeze');
export const apiProtectAccount = (b: ProtectRequest) =>
  post<{ ok: true; removed: number; frozenUntil: string | null }>('/api/auth/devices/protect', b as unknown as Json);
export const apiFreezeResend = () => post<{ ok: true }>('/api/auth/freeze/resend');
export const apiUnfreeze = (totp?: string) => post<{ ok: true }>('/api/auth/freeze/unfreeze', totp ? { totp } : {});
export const apiFreezeLink = (t: string) => post<{ ok: true; minutes: number }>('/api/auth/freeze/link', { t });
