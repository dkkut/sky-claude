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

/** Способ второго фактора: код из приложения или письмо на почту. */
export type TwoFactorMethod = 'app' | 'email';

export interface SkyIdInfo {
  id:                 string;
  phone:              string;
  email?:             string;
  emailVerified:      boolean;
  twoFactorEnabled:   boolean;
  twoFactorMethod:    TwoFactorMethod;
  createdAt?:         string;
}

export interface ServerProfile {
  id:               string;
  skyId:            string;
  username:         string;
  name:             string;
  avatar?:          string | null;
  bio?:             string | null;
  isAdmin:          boolean;
  isPrime:          boolean;
  primeExpiresAt?:  string | null;
  primePlan?:       string | null;
  twoFactorEnabled: boolean;
  twoFactorMethod:  TwoFactorMethod;
  createdAt?:       string;
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

type Json = Record<string, unknown>;

/* ─── Сообщения об ошибках ───────────────────────────────────── */
const ERRORS: Record<string, string> = {
  beta_required:         'Нужен ключ доступа к закрытой бете',
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
  email_taken:           'Эта почта уже привязана к другому Sky ID',
  email_not_verified:    'Сначала привяжите и подтвердите почту',
  already_enabled:       'Защита уже включена. Чтобы сменить способ, сначала отключите её',
  invalid_method:        'Такой способ проверки не поддерживается',
  not_started:           'Настройка не начата — начните заново',
  profile_limit_reached: 'На один Sky ID можно завести не больше двух профилей',
  profile_code_required: 'Профиль защищён — введите код из приложения',
  two_factor_required:   'Введите код из приложения',
  challenge_expired:     'Время вышло — начните вход заново',
  not_found:             'Не найдено',
  unauthorized:          'Сессия закончилась, войдите заново',
  no_active_profile:     'Сначала выберите профиль',
  sms_not_configured:    'Отправка кодов пока не настроена',
  email_not_configured:  'Отправка писем пока не настроена',
  payments_not_configured: 'Оплата пока не подключена',
};

export const explain = (code?: string, status?: number) =>
  (code && ERRORS[code]) || (code ? `Не получилось (${code})` : `Ошибка сервера (${status ?? '?'})`);

/* ─── Транспорт ──────────────────────────────────────────────── */
const readJson = async (res: Response): Promise<any> => {
  try { return await res.json(); } catch { return {}; }
};

const raw = (path: string, init: RequestInit = {}) =>
  fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
    // Без этого браузер не отправит HttpOnly-куку с refresh-токеном.
    credentials: 'same-origin',
  });

/** Чтобы несколько одновременных 401 не устроили гонку обновлений. */
let refreshing: Promise<boolean> | null = null;

const refreshOnce = (): Promise<boolean> => {
  refreshing ??= (async () => {
    const res  = await raw('/api/auth/refresh', { method: 'POST', body: '{}' });
    const data = await readJson(res);
    if (!res.ok) { setAccessToken(null); return false; }
    setAccessToken(data.accessToken ?? null);
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
};

export interface Reply<T> { ok: boolean; data?: T; error?: string; reason?: string; status: number }

/* ─── Калитка закрытой беты ──────────────────────────────────────
   Пока приложение не готово, сервер отвечает на любой запрос к API
   отказом beta_required, если у браузера нет пропуска. Здесь мы лишь
   замечаем этот отказ и сообщаем о нём приложению — решает сервер. */

let onBetaRequired: (() => void) | null = null;
export const setBetaRequiredHandler = (fn: (() => void) | null) => { onBetaRequired = fn; };

/**
 * Запрос к API. Если access протух — обновляемся один раз и повторяем;
 * второй неудачи достаточно, чтобы считать сессию законченной.
 */
const call = async <T>(path: string, init: RequestInit = {}, retry = true): Promise<Reply<T>> => {
  let res: Response;
  try {
    res = await raw(path, init);
  } catch {
    return { ok: false, error: 'network', reason: 'Нет связи с сервером', status: 0 };
  }

  if (res.status === 401 && retry && path !== '/api/auth/refresh') {
    if (await refreshOnce()) return call<T>(path, init, false);
  }

  const data = await readJson(res);
  if (!res.ok) {
    if (res.status === 403 && data?.error === 'beta_required') onBetaRequired?.();
    return { ok: false, error: data?.error, reason: explain(data?.error, res.status), status: res.status, data };
  }
  return { ok: true, data, status: res.status };
};

const post = <T>(path: string, body: Json = {}) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body) });
const patch = <T>(path: string, body: Json = {}) =>
  call<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const get = <T>(path: string) => call<T>(path);

/* ═══ Вход ═══════════════════════════════════════════════════ */

export interface CodeRequested { ok: true; retryAfter: number; expiresIn: number; codeLength: number }

/** Шаг 1: просим код на телефон. */
export const apiRequestPhoneCode = (phone: string) =>
  post<CodeRequested>('/api/auth/phone/start', { phone });

/** Сколько секунд осталось до повторной отправки. */
export const apiPhoneCooldown = (phone: string) =>
  post<{ retryAfter: number }>('/api/auth/phone/cooldown', { phone });

export type PhoneVerified =
  | ({ needsTwoFactor: true; method: TwoFactorMethod; challenge: string;
       expiresIn: number; email?: string; retryAfter?: number })
  | (SkySession & { accessToken: string; expiresIn: number; isNew?: boolean });

/** Шаг 2: проверяем код. Может ответить «нужен второй фактор». */
export const apiVerifyPhoneCode = (phone: string, code: string) =>
  post<PhoneVerified>('/api/auth/phone/verify', { phone, code });

/** Шаг 3: второй фактор самого Sky ID. */
export const apiVerifySkyTwoFactor = (challenge: string, code: string) =>
  post<SkySession & { accessToken: string }>('/api/auth/two-factor/verify', { challenge, code });

/** Прислать код второго фактора на почту ещё раз (на экране входа). */
export const apiResendLoginTwoFactor = (challenge: string) =>
  post<{ ok: true; email: string; retryAfter: number }>('/api/auth/two-factor/send', { challenge });

/** Восстановление сессии по куке — вызывается при старте приложения. */
export const apiRefreshSession = async (): Promise<Reply<SkySession & { accessToken: string }>> => {
  const res = await post<SkySession & { accessToken: string }>('/api/auth/refresh');
  if (res.ok && res.data) setAccessToken(res.data.accessToken ?? null);
  else setAccessToken(null);
  return res;
};

/** Текущее состояние входа по мнению сервера. */
export const apiSession = () => get<SkySession>('/api/auth/session');

export const apiLogout = async (): Promise<void> => {
  try { await post('/api/auth/logout'); } finally { setAccessToken(null); }
};

/* ═══ Профили ════════════════════════════════════════════════ */

export const apiListProfiles = () =>
  get<{ profiles: ServerProfile[]; activeProfileId: string | null; maxProfiles: number }>('/api/skyid/profiles');

export const apiCreateProfile = (p: { name: string; username: string; avatar?: string }) =>
  post<{ profile: ServerProfile; profiles: ServerProfile[] }>('/api/skyid/profiles', p);

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

export const apiUpdateProfile = (profileId: string, p: { name?: string; avatar?: string }) =>
  patch<{ profile: ServerProfile }>(`/api/skyid/profiles/${encodeURIComponent(profileId)}`, p);

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

/* ═══ Почта ══════════════════════════════════════════════════ */

export const apiEmailStart = (email: string) =>
  post<{ ok: true; retryAfter: number; expiresIn: number }>('/api/skyid/email/start', { email });

export const apiEmailVerify = (email: string, code: string) =>
  post<{ skyId: SkyIdInfo }>('/api/skyid/email/verify', { email, code });

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

/* ═══ Прочее ═════════════════════════════════════════════════ */

/** Доступен ли бэкенд. Нужно, чтобы отличить «нет сети» от «неверный код». */
export const apiAvailable = async (): Promise<boolean> => {
  try {
    const res = await fetch('/healthz', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
};
