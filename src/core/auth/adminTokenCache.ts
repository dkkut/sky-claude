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
