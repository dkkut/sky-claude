/** Ссылки внутрь Sky GO: `/?place=<id организации>` и `/?go=transport`. Адрес очищается, запрос ждёт входа и открывает раздел.
 *  Это обычные веб-ссылки Sky: в приложениях Android/Windows своя схема ссылок (app links) не зарегистрирована — там ссылка открывает сайт, а внутри приложения переходы идут напрямую. */
import { useEffect } from 'react';
import { useModuleStore } from '@/data/state/modules';

const KEY = 'sky:go:link';
export interface GoLink { open?: string; group?: string }
const PLACE = /^kbz-[0-9a-f-]{36}$/;

export const captureGoLink = () => {
  try {
    const u = new URL(window.location.href); const place = u.searchParams.get('place'); const go = u.searchParams.get('go');
    const link: GoLink = {};
    if (place && PLACE.test(place)) link.open = place; else if (go === 'transport') link.group = 'transport'; else return;
    sessionStorage.setItem(KEY, JSON.stringify(link));
    u.searchParams.delete('place'); u.searchParams.delete('go');
    window.history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  } catch { /* нет доступа к адресу */ }
};
let taken: GoLink | null | undefined;   // один раз на загрузку: двойной вызов инициализатора (StrictMode) возвращает то же
export const takeGoLink = (): GoLink | null => {
  if (taken !== undefined) return taken;
  try { const v = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); taken = v ? (JSON.parse(v) as GoLink) : null; } catch { taken = null; }
  return taken;
};
export const useOpenGoIfAsked = () => {
  useEffect(() => {
    let want = false;
    try { want = Boolean(sessionStorage.getItem(KEY)); } catch { /* нет */ }
    if (!want) return;
    const m = useModuleStore.getState(); m.setActiveModule('extras'); m.setPendingExtrasTab('go');
  }, []);
};
/** После того как раздел принял ссылку, повторно её не применять. */
export const clearGoLink = () => { taken = null; };
