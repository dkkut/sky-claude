/**
 * Закрытые из админки модули (server/modclosure.mjs). Список приходит в публичном /api/platform/status;
 * стор перечитывает его раз в минуту и при возврате на вкладку. Закрытый модуль не монтируется — вместо него баннер.
 * Администраторы заходят в закрытые модули как обычно (им нужно проверять и чинить); им показывается только метка «Закрыт для людей».
 */
import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';
import { Wrench } from 'lucide-react';
import { apiPlatformStatus } from './platform';
import { useAuthStore } from './auth/store';

interface Closure { reason?: string }
interface S { closed: Record<string, Closure>; mediaBanner: boolean; load: () => Promise<void> }

export const useModuleClosures = create<S>((set) => ({
  closed: {},
  mediaBanner: false,
  load: async () => {
    const s = await apiPlatformStatus();
    if (s) set({ closed: s.closedModules ?? {}, mediaBanner: s.mediaBanner === true });
  },
}));

let started = false;
const start = () => {
  if (started || typeof window === 'undefined') return;
  started = true;
  const load = () => { void useModuleClosures.getState().load(); };
  load();
  window.setInterval(load, 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
};

export const ModuleClosedBanner = ({ reason }: { reason?: string }) => (
  <div role="alert" data-keep-dark className="relative grid h-full w-full place-items-center overflow-hidden px-6"
    style={{ background: 'radial-gradient(110% 80% at 50% 0%, #1b2350 0%, #0b0c1f 55%, #06060d 100%)', color: '#fff' }}>
    <div className="max-w-sm text-center">
      <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl"
        style={{ background: 'rgba(79,110,247,.12)', border: '1px solid rgba(79,110,247,.3)', color: 'var(--accent)' }}>
        <Wrench size={34} />
      </div>
      <h2 className="text-xl font-black">Сервис временно недоступен</h2>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,.7)' }}>Мы уже работаем над восстановлением доступа.</p>
      {reason && <p className="mt-3 rounded-2xl px-4 py-2.5 text-xs" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.75)' }}>{reason}</p>}
    </div>
  </div>
);

/** Обёртка модуля: `id` — ключ из server/modclosure.mjs; неизвестный ключ — модуль не закрывается. */
/** Закрытый «Профиль» у людей: только выход из Sky ID (остальное в профиле недоступно). */
const ProfileLogoutOnly = ({ reason }: { reason?: string }) => {
  const logout = useAuthStore((s) => s.logout);
  return (
    <div className="grid h-full w-full place-items-center px-6" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm text-center">
        <p className="text-lg font-black" style={{ color: 'var(--t1)' }}>Сервис временно недоступен</p>
        <p className="mt-2 text-sm" style={{ color: 'var(--t2)' }}>Мы уже работаем над восстановлением доступа. Сейчас в профиле доступен только выход из Sky ID.</p>
        {reason && <p className="mt-3 rounded-2xl px-4 py-2.5 text-xs" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>{reason}</p>}
        <button type="button" onClick={() => { void logout(); }} className="mt-5 w-full rounded-full py-3 text-sm font-bold" style={{ background: 'rgba(239,68,68,.14)', color: 'var(--red, #ef4444)', border: '1px solid rgba(239,68,68,.35)' }}>Выйти из Sky ID</button>
      </div>
    </div>
  );
};

export const ModuleGate = ({ id, children }: { id: string; children: ReactNode }) => {
  const closure = useModuleClosures((s) => s.closed[id]);
  const isAdmin = useAuthStore((s) => s.accounts.find((a) => a.id === s.currentUserId)?.isAdmin ?? false);
  useEffect(start, []);
  if (!closure) return <>{children}</>;
  if (!isAdmin && id === 'profile') return <ProfileLogoutOnly reason={closure.reason} />;
  if (!isAdmin) return <ModuleClosedBanner reason={closure.reason} />;
  return (
    <>
      {children}
      <div role="status" className="pointer-events-none fixed left-3 z-[60] rounded-full px-3 py-1 text-[11px] font-bold"
        style={{ bottom: 'calc(var(--safe-bottom, 0px) + 84px)', background: 'rgba(239,68,68,.92)', color: '#fff', boxShadow: '0 4px 14px rgba(0,0,0,.35)' }}>
        Закрыт для людей — виден только администрации
      </div>
    </>
  );
};

/** Баннер о перебоях в Sky Media (включается из админки → Модули). Показывается только внутри Sky Media, ничего не блокирует. */
export const MediaOutageBanner = () => {
  const on = useModuleClosures((st) => st.mediaBanner);
  useEffect(start, []);
  if (!on) return null;
  return (
    <div role="status" data-testid="media-outage-banner" className="mx-3 mt-3 flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-[13px] font-semibold"
      style={{ background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.35)', color: 'var(--t1)' }}>
      <Wrench size={15} className="mt-0.5 shrink-0" style={{ color: '#f59e0b' }} />
      <span>Sky сейчас работает с перебоями, мы работаем над исправлениями</span>
    </div>
  );
};
