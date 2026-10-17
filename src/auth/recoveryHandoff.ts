/**
 * Приём восстановления с сайта recovery: ссылка вида /?recovery_handoff=<одноразовый код>. Код меняется на настоящую сессию здесь, на домене приложения
 * (кука должна встать именно на нём), адрес сразу очищается. После входа открывается Профиль → Sky ID → «Восстановление», чтобы человек настроил защиту заново.
 */
import { useAuthStore } from '@/core/auth/store';
import { apiCall } from '@/core/auth/api';
import { useEffect } from 'react';
import { useModuleStore } from '@/data/state/modules';

export const consumeRecoveryHandoff = async (): Promise<void> => {
  let code = '';
  try {
    const u = new URL(location.href);
    code = u.searchParams.get('recovery_handoff') ?? '';
    if (!code) return;
    u.searchParams.delete('recovery_handoff');
    history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
  } catch { return; }
  const r = await apiCall<{ session?: unknown }>('/api/recovery/handoff', { method: 'POST', body: JSON.stringify({ code }) });
  if (!r.ok || !r.data?.session) return;
  useAuthStore.getState().loginWithLinkedSession(r.data.session);
  try { sessionStorage.setItem('sky:open', 'recovery'); } catch { /* нет хранилища */ }
};

export const useOpenRecoveryIfAsked = () => {
  useEffect(() => {
    let want = false;
    try { want = sessionStorage.getItem('sky:open') === 'recovery'; if (want) sessionStorage.removeItem('sky:open'); } catch { /* нет */ }
    if (!want) return;
    const m = useModuleStore.getState();
    m.setPendingProfileSection('skyid'); m.setPendingSkyIdSub('recovery'); m.setActiveModule('profile');
  }, []);
};
