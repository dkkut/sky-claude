/* ===============================================================
   КЛИЕНТ API АВТОРИЗАЦИИ

   Access-токен держим только в памяти вкладки: в localStorage его
   класть нельзя — оттуда его заберёт любой скрипт, дорвавшийся до
   страницы. Refresh-токен браузеру вообще не виден, он приходит
   в HttpOnly-куке и уходит обратно сам.

   Отсюда же перевыпуск: если access протух, запрос делается заново
   после обновления, но только один раз — иначе при отозванной сессии
   получился бы бесконечный цикл.
=============================================================== */

export interface ServerUser {
  id:       string;
  phone:    string;
  username: string;
  name:     string;
  isAdmin:  boolean;
  isPrime:  boolean;
}

/** Живёт только в памяти вкладки. Перезагрузка страницы его теряет — это намеренно. */
let accessToken: string | null = null;

export const getAccessToken = () => accessToken;
export const setAccessToken = (t: string | null) => { accessToken = t; };

const API = '/api/auth';

type Json = Record<string, unknown>;

const request = async (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
    // Без этого браузер не отправит HttpOnly-куку с refresh-токеном.
    credentials: 'same-origin',
  });

const post = (path: string, body: Json = {}) =>
  request(path, { method: 'POST', body: JSON.stringify(body) });

/** Читает JSON, не падая на пустом или битом теле. */
const readJson = async (res: Response): Promise<any> => {
  try { return await res.json(); } catch { return {}; }
};

export interface AuthResult {
  ok:      boolean;
  user?:   ServerUser;
  reason?: string;
}

const ERRORS: Record<string, string> = {
  invalid_credentials: 'Неверный логин или пароль',
  already_exists:      'Такой аккаунт уже существует',
  invalid_phone:       'Некорректный номер телефона',
  invalid_username:    'Ник: 3–32 символа, латиница, цифры, _',
  invalid_name:        'Некорректное имя',
  weak_password:       'Пароль минимум 8 символов',
  rate_limited:        'Слишком много попыток, подождите минуту',
};

const toReason = (data: any, res: Response) =>
  ERRORS[data?.error] ?? `Ошибка сервера (${res.status})`;

export const apiLogin = async (login: string, password: string): Promise<AuthResult> => {
  const res  = await post('/login', { login, password });
  const data = await readJson(res);
  if (!res.ok) return { ok: false, reason: toReason(data, res) };
  setAccessToken(data.accessToken ?? null);
  return { ok: true, user: data.user };
};

export const apiRegister = async (
  p: { phone: string; username: string; name: string; password: string },
): Promise<AuthResult> => {
  const res  = await post('/register', p);
  const data = await readJson(res);
  if (!res.ok) return { ok: false, reason: toReason(data, res) };
  setAccessToken(data.accessToken ?? null);
  return { ok: true, user: data.user };
};

export const apiLogout = async (): Promise<void> => {
  try { await post('/logout'); } finally { setAccessToken(null); }
};

/**
 * Восстанавливает сессию по куке. Вызывается при старте приложения:
 * access-токена после перезагрузки нет, а кука осталась.
 */
export const apiRefresh = async (): Promise<AuthResult> => {
  const res  = await post('/refresh');
  const data = await readJson(res);
  if (!res.ok) {
    setAccessToken(null);
    return { ok: false, reason: toReason(data, res) };
  }
  setAccessToken(data.accessToken ?? null);
  return { ok: true, user: data.user };
};

/** Кто вошёл — по мнению сервера, а не по данным из браузера. */
export const apiMe = async (): Promise<AuthResult> => {
  const res = await request('/me');
  if (res.status === 401) {
    // Access протух — пробуем один раз обновиться и повторить.
    const refreshed = await apiRefresh();
    if (!refreshed.ok) return refreshed;
    const retry = await request('/me');
    if (!retry.ok) return { ok: false, reason: 'unauthorized' };
    return { ok: true, user: (await readJson(retry)).user };
  }
  if (!res.ok) return { ok: false, reason: `Ошибка сервера (${res.status})` };
  return { ok: true, user: (await readJson(res)).user };
};

export const apiChangePassword = async (
  oldPassword: string, newPassword: string,
): Promise<{ ok: boolean; reason?: string }> => {
  const send = () => post('/change-password', { oldPassword, newPassword });
  let res = await send();
  if (res.status === 401) {
    // Access протух — обновляемся и пробуем один раз.
    const refreshed = await apiRefresh();
    if (!refreshed.ok) return { ok: false, reason: 'Сессия истекла, войдите заново' };
    res = await send();
  }
  const data = await readJson(res);
  if (!res.ok) {
    const map: Record<string, string> = {
      wrong_password: 'Неверный текущий пароль',
      weak_password:  'Новый пароль минимум 8 символов',
      unauthorized:   'Сессия истекла, войдите заново',
    };
    return { ok: false, reason: map[data?.error] ?? toReason(data, res) };
  }
  setAccessToken(data.accessToken ?? null);
  return { ok: true };
};

/** Доступен ли бэкенд. Нужно, чтобы отличить «нет сети» от «неверный пароль». */
export const apiAvailable = async (): Promise<boolean> => {
  try {
    const res = await fetch('/healthz', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
};
