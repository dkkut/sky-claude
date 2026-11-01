/**
 * Личный токен администратора, введённый человеком: живёт ТОЛЬКО в памяти вкладки (не в localStorage), пару минут,
 * и уходит заголовком/полем вместе с запросами подтверждений. Проверяет его сервер (server/admintoken.mjs).
 */
let cache = '';
let until = 0;
export const CACHE_MS = 2 * 60 * 1000;
export const getAdminTokenCached = () => (cache && Date.now() < until ? cache : '');
export const setAdminTokenCached = (t: string) => { cache = t; until = Date.now() + CACHE_MS; };
export const clearAdminTokenCached = () => { cache = ''; until = 0; };
/** Попросить человека ввести токен (окно AdminTokenPrompt). */
export const askAdminToken = (reason = '') => { try { window.dispatchEvent(new CustomEvent('sky:admin-token', { detail: { reason } })); } catch { /* вне браузера */ } };
export const isAdminTokenError = (code?: string) => Boolean(code) && (String(code).startsWith('admin_token_') || code === 'admin_settings_locked');

/**
 * Попросить токен и ДОЖДАТЬСЯ ответа: true — токен введён и принят (он уже в памяти), false — окно закрыли или время вышло.
 * Нужно, чтобы запрос, отклонённый из-за токена, повторился сам с тем же кодом подтверждения: сначала человек вводит код
 * аутентификатора, потом токен, и нажимать «ещё раз» не нужно.
 */
export const askAdminTokenAndWait = (reason = ''): Promise<boolean> => new Promise((resolve) => {
  if (typeof window === 'undefined') { resolve(false); return; }
  const done = (v: boolean) => { window.removeEventListener('sky:admin-unlocked', ok); window.removeEventListener('sky:admin-token-cancel', no); clearTimeout(t); resolve(v); };
  const ok = () => done(true); const no = () => done(false);
  const t = setTimeout(() => done(false), 3 * 60 * 1000);
  window.addEventListener('sky:admin-unlocked', ok); window.addEventListener('sky:admin-token-cancel', no);
  askAdminToken(reason);
});
