/**
 * Приглашение по ссылке: `https://<сайт>/?inv=КОД` → код запоминается и уходит заголовком X-Sky-Invite на /api/auth/* (см. api.ts),
 * пока человек не войдёт. Ссылка очищается из адресной строки. Сервер засчитывает приглашение только новому Sky ID (server/invites.mjs).
 */
const KEY = 'sky:invite';
const CODE = /^[A-Za-z2-9]{8}$/;

export const getInvite = (): string => { try { const v = localStorage.getItem(KEY) ?? ''; return CODE.test(v) ? v.toUpperCase() : ''; } catch { return ''; } };
export const clearInvite = () => { try { localStorage.removeItem(KEY); } catch { /* не критично */ } };

export const captureInvite = () => {
  try {
    const u = new URL(window.location.href);
    const c = u.searchParams.get('inv') ?? '';
    if (!c) return;
    if (CODE.test(c)) localStorage.setItem(KEY, c.toUpperCase());
    u.searchParams.delete('inv');
    window.history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`);
  } catch { /* без хранилища приглашение просто не запомнится */ }
};
