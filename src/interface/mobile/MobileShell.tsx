import { useState, useEffect, useRef, Suspense } from 'react';
import { ModuleGate } from '@/core/moduleClosures';
import { LimitedLock } from '@/auth/LimitedAccess';
import { AnimatePresence, motion } from 'framer-motion';
import { useModuleStore } from '@/data/state/modules';
import { PlayerEngine } from '@/player/PlayerEngine';
import { PodcastPlayerHost } from '@/podcasts/PodcastPlayer';
import { NotifBridge } from '@/notifications/NotifBridge';
import { IslandBridge } from '@/island/IslandBridge';
import { SkyIsland } from '@/island/SkyIsland';
import { useSettings } from '@/settings/store';
import { NotifToastLayer } from '@/notifications/NotifToast';
import { FloatingChatLayer } from '@/notifications/FloatingChat';
import { ActiveCallPanel, IncomingCallOverlay, MiniCallOverlay, CallAudio } from '@/calls/CallUI';
import { ErrorBoundary } from '@/app/ErrorBoundary';

import { NotificationsScreen } from '@/notifications/NotificationsScreen';
import {
  StoriesModule, ExtrasModule, LibraryModule, BusinessStudio, BusinessModule, JobsModule, BloomModule,
  ProfileModule, GamingModule, SkyVideo, ModuleFallback,
} from '@/app/lazyModules';

import { MobileHeader } from './MobileHeader';
import { MobileMessenger } from './MobileMessenger';
import { MobileTabBar } from './MobileTabBar';
import { MoreSheet } from './MoreSheet';
import { MobileMiniPlayer } from './MobileMiniPlayer';
import { MobileFullPlayer } from './MobileFullPlayer';

// Модули с собственной, уже проработанной навигацией/шапкой — им не нужна
// ещё одна общая MobileHeader поверх.
const SELF_CHROME = new Set(['messages', 'bloom', 'extras', 'profile']);

/** Первый непрозрачный фон у корня экрана: под нижней панелью та же заливка, что у содержимого, без отдельной полосы. */
const screenBackground = (root: HTMLElement | null): string | null => {
  let el: Element | null = root?.firstElementChild ?? null;
  for (let depth = 0; el && depth < 6; depth++) {
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const [, , , a] = m[1].split(',').map((x) => parseFloat(x));
      if (a === undefined || Number.isNaN(a) || a > 0.9) return bg;
    }
    el = el.firstElementChild;
  }
  return null;
};

export const MobileShell = () => {
  const activeModule = useModuleStore(s => s.activeModule);
  const [moreOpen, setMoreOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const islandMode = useSettings(s => s.settings.islandMode);
  const mainRef = useRef<HTMLElement>(null);
  const [stripBg, setStripBg] = useState<string | null>(null);

  useEffect(() => {
    const measure = () => setStripBg(screenBackground(mainRef.current));
    const t = [60, 400, 1200].map((ms) => window.setTimeout(measure, ms));
    const iv = window.setInterval(measure, 4000);
    return () => { t.forEach(clearTimeout); clearInterval(iv); };
  }, [activeModule]);

  return (
    <div className="app-root-h flex h-screen flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* height: 100dvh поверх h-screen (100vh) — на реальных мобильных
          браузерах 100vh не учитывает скрывающуюся адресную строку,
          из-за чего нижняя панель (и «Ещё») может оказаться частично за
          пределами реально видимой/тач-доступной области. Если dvh не
          поддерживается движком — значение отбрасывается как невалидное
          и остаётся h-screen, безопасный откат без побочных эффектов. */}
      <NotifBridge />
      <IslandBridge />
      <SkyIsland />
      <PlayerEngine />

      {!SELF_CHROME.has(activeModule) && <MobileHeader />}

      <main ref={mainRef} className="relative min-h-0 flex-1 overflow-hidden">
        {/* Без AnimatePresence: уходящий модуль (музыка, кабинет продавца) мог не завершить exit и не отпустить экран новой вкладке */}
<>
          <ErrorBoundary key={activeModule}>
            <motion.div key={activeModule + '_mob'} className="absolute inset-0 h-full w-full"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}  transition={{ duration: 0.12 }}>
              <Suspense fallback={<ModuleFallback />}>
                <ModuleGate id={activeModule}>
                {activeModule === 'stories'       && <StoriesModule />}
                {activeModule === 'messages'      && <LimitedLock><MobileMessenger /></LimitedLock>}
                {activeModule === 'notifications' && <NotificationsScreen />}
                {activeModule === 'gaming'        && <GamingModule />}
                {activeModule === 'bloom'         && <BloomModule />}
                {activeModule === 'extras'        && <ExtrasModule />}
                {activeModule === 'library'       && <LibraryModule />}
                {activeModule === 'studio'        && <BusinessStudio />}
                {activeModule === 'business'      && <BusinessModule />}
                {activeModule === 'jobs'          && <JobsModule />}
                {activeModule === 'profile'       && <ProfileModule />}
                {activeModule === 'video'         && <SkyVideo />}
                </ModuleGate>
              </Suspense>
            </motion.div>
          </ErrorBoundary>
        </>

        <IncomingCallOverlay />
        <ActiveCallPanel />
        <MiniCallOverlay />
        {/* Звук собеседника не зависит от того, свёрнут звонок или нет. */}
        <CallAudio />
      </main>

      {/* Подкаст продолжает играть при уходе с экрана, поэтому его
          проигрыватель живёт здесь, в оболочке, а не внутри модуля. */}
      <PodcastPlayerHost />
      {activeModule !== 'extras' && islandMode !== 'island' && <div className="kb-hide" style={{ background: stripBg ?? 'var(--bg)' }}><MobileMiniPlayer onOpen={() => setPlayerOpen(true)} /></div>}
      <div className="kb-hide" style={{ background: stripBg ?? 'var(--bg)', transition: 'background 0.2s' }}><MobileTabBar onMore={() => setMoreOpen(true)} /></div>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      <MobileFullPlayer open={playerOpen} onClose={() => setPlayerOpen(false)} />

      <NotifToastLayer />
      <FloatingChatLayer />
    </div>
  );
};
