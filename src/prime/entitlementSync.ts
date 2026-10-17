/** Подписка оформлена/закончилась на другом устройстве — этот экран узнаёт об этом: при возврате в приложение, при появлении сети и раз в 5 минут. */
import { useEffect } from 'react';
import { useAuthStore } from '@/core/auth/store';
import { useEntitlements } from '@/prime/entitlements';
import { useModuleStore } from '@/data/state/modules';

export const useEntitlementSync = () => {
  useEffect(() => {
    let alive = true;
    const sync = async () => {
      const e = await useEntitlements.getState().refresh();
      if (!alive || !e) return;
      const st = useAuthStore.getState();
      const me = st.accounts.find((a) => a.id === st.currentUserId);
      if (me && Boolean(me.isPrime) !== e.prime.active) await st.reloadSession();
    };
    void sync();
    const onVis = () => { if (!document.hidden) void sync(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    const id = window.setInterval(() => { if (!document.hidden) void sync(); }, 5 * 60_000);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onVis); clearInterval(id); };
  }, []);
};

/** Ссылка из QR на ТВ/консоли/в машине: `/?open=prime` → после входа открывается Prime. Адрес очищается сразу — ничего лишнего не остаётся. */
try {
  const sp = new URLSearchParams(location.search);
  if (sp.get('open') === 'prime') {
    sessionStorage.setItem('sky:open', 'prime');
    sp.delete('open');
    const rest = sp.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  }
} catch { /* без памяти вкладки просто откроется главная */ }

export const useOpenPrimeIfAsked = () => {
  useEffect(() => {
    let want = false;
    try { want = sessionStorage.getItem('sky:open') === 'prime'; if (want) sessionStorage.removeItem('sky:open'); } catch { /* нет */ }
    if (!want) return;
    const m = useModuleStore.getState();
    m.setActiveModule('extras'); m.setPendingExtrasTab('prime');
  }, []);
};
