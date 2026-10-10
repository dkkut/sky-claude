/**
 * Настройки безопасности Sky Gifts. «Защита от случайной продажи» — настоящая:
 * пока включена, лот публикуется только после отдельного подтверждения.
 * Хранится на устройстве по профилю; по умолчанию включена.
 */
const key = (userId: string) => `sky:gifts:confirmSale:${userId}`;

export const getConfirmSale = (userId: string): boolean => {
  try { return localStorage.getItem(key(userId)) !== '0'; } catch { return true; }
};
export const setConfirmSale = (userId: string, on: boolean) => {
  try { localStorage.setItem(key(userId), on ? '1' : '0'); } catch { /* приватный режим */ }
};

/** Устройство для журнала: по userAgent, без выдумок. */
export const deviceLabel = (): string => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Устройство';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'браузер';
  return `${os} · ${br}`;
};
