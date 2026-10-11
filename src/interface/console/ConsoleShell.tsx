/* ===========================================================
   SKY CONSOLE — оболочка после выбора профиля.
   Главное меню + хост существующих модулей Sky. Сервисы не
   копируются: открывается тот же модуль, что и в обычной Sky;
   плееры, звонки, уведомления и остров — общие, второй экземпляр
   не создаётся.
=========================================================== */
import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Home } from 'lucide-react';
import { NetBanner } from '@/shared/NetBanner';
import { PlayerEngine } from '@/player/PlayerEngine';
import { PodcastPlayerHost } from '@/podcasts/PodcastPlayer';
import { NotifToastLayer } from '@/notifications/NotifToast';
import { FlashLayer } from '@/shared/flash';
import { NotifBridge } from '@/notifications/NotifBridge';
import { NotificationsScreen } from '@/notifications/NotificationsScreen';
import { ActiveCallPanel, IncomingCallOverlay, MiniCallOverlay, CallAudio } from '@/calls/CallUI';
import { IslandBridge } from '@/island/IslandBridge';
import { SkyIsland } from '@/island/SkyIsland';
import { pickNowPlaying } from '@/island/mediaAdapter';
import { ExtrasModule, GamingModule, SkyVideo, ModuleFallback } from '@/app/lazyModules';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { useConsoleStore } from './consoleStore';
import { ConsoleHome } from './ConsoleHome';
import { ConsoleSettings } from './ConsoleSettings';
import { ConsoleCalls } from './ConsoleCalls';
import { consoleNav } from './input/nav';
import { candidates } from './input/spatial';

const SCALE = 1.25;

const Host = ({ messenger }: { messenger: React.ReactNode }) => {
  const service = useConsoleStore((s) => s.service);
  switch (service) {
    case 'film': case 'music': case 'podcasts': case 'blox': case 'ai': case 'prime': case 'market': case 'go': return <ExtrasModule />;
    case 'games': return <GamingModule />;
    case 'video': return <SkyVideo />;
    case 'messenger': return <>{messenger}</>;
    case 'calls': return <ConsoleCalls />;
    case 'notifications': return <NotificationsScreen />;
    default: return null;
  }
};

export const ConsoleShell = ({ messenger }: { messenger: React.ReactNode }) => {
  const service = useConsoleStore((s) => s.service);
  const settingsOpen = useConsoleStore((s) => s.settingsOpen);
  const open = useConsoleStore((s) => s.open);

  /* Кнопки геймпада, зависящие от оболочки. */
  useEffect(() => {
    consoleNav.onHome = () => { useConsoleStore.getState().setSettingsOpen(false); open(null); };
    consoleNav.onBackFallback = () => {
      const st = useConsoleStore.getState();
      if (st.settingsOpen) { st.setSettingsOpen(false); return true; }
      if (st.service) { st.open(null); return true; }
      return true; // на главной «Назад» ничего не делает
    };
    consoleNav.onMedia = () => { pickNowPlaying()?.toggle(); };
    consoleNav.onShoulder = (d) => {
      const tabs = candidates().filter((e) => e.getAttribute('role') === 'tab');
      if (tabs.length > 1) {
        const i = Math.max(0, tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'));
        const next = tabs[(i + d + tabs.length) % tabs.length];
        next.click(); consoleNav.focusEl(next);
        return;
      }
      const n = pickNowPlaying();
      if (n) (d > 0 ? n.next : n.prev)();
    };
    return () => { consoleNav.onHome = () => {}; consoleNav.onBackFallback = () => false; consoleNav.onMedia = () => {}; consoleNav.onShoulder = () => {}; };
  }, [open]);

  /* Выход из аккаунта размонтирует оболочку: открытый сервис/настройки не должны переехать в следующий вход. */
  useEffect(() => () => { const st = useConsoleStore.getState(); st.setSettingsOpen(false); st.open(null); }, []);

  /* Вернулись из сервиса — фокус на главной восстанавливает сама карточка. После смены экрана
     фокус не должен остаться на исчезнувшем элементе. */
  useEffect(() => { if (service) { const t = setTimeout(() => consoleNav.ensureFocus(), 350); return () => clearTimeout(t); } return undefined; }, [service]);

  return (
    <div className="fixed inset-0 z-[500]" style={{ background: 'var(--bg)' }}>
      <NotifBridge />
      <NetBanner />
      <IslandBridge />
      <SkyIsland />
      <PlayerEngine />
      <PodcastPlayerHost />

      <AnimatePresence mode="wait">
        {!service ? (
          <motion.div key="home" className="absolute inset-0" initial={{ opacity: 0, scale: 1.04, filter: 'blur(12px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0 }} transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}>
            <ConsoleHome />
          </motion.div>
        ) : (
          <motion.div key={'svc-' + service} className="absolute inset-0" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            <div className="absolute inset-x-0 top-0 bottom-[68px] overflow-hidden" style={{ background: 'var(--bg-l1)' }}>
              {/* Существующие интерфейсы рассчитаны на монитор вплотную: на экране в трёх метрах крупнее. */}
              <div className="console-scale" style={{ width: `${100 / SCALE}%`, height: `${100 / SCALE}%`, transform: `scale(${SCALE})`, transformOrigin: '0 0' }}>
                <ErrorBoundary>
                  <React.Suspense fallback={<ModuleFallback />}><Host messenger={messenger} /></React.Suspense>
                </ErrorBoundary>
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 flex h-[68px] items-center px-8" style={{ background: 'rgba(5,5,16,0.96)', borderTop: '1px solid rgba(160,150,255,0.18)' }} data-keep-dark>
              <button type="button" onClick={() => open(null)} aria-label="Главная" className="flex items-center gap-3 rounded-full px-6 py-2 text-[20px] font-semibold text-white outline-none" style={{ background: 'rgba(255,255,255,0.12)' }}>
                <Home size={22} /> Sky Console
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <IncomingCallOverlay />
      <ActiveCallPanel />
      <MiniCallOverlay />
      <CallAudio />
      <NotifToastLayer />
      <FlashLayer />
      {settingsOpen && <ConsoleSettings />}
    </div>
  );
};
