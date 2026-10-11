import { useState, Suspense } from 'react';
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
  StoriesModule, ExtrasModule, LibraryModule, BusinessStudio, BloomModule,
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

export const MobileShell = () => {
  const activeModule = useModuleStore(s => s.activeModule);
  const [moreOpen, setMoreOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const islandMode = useSettings(s => s.settings.islandMode);

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

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence>
          <ErrorBoundary key={activeModule}>
            <motion.div key={activeModule + '_mob'} className="absolute inset-0 h-full w-full"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              <Suspense fallback={<ModuleFallback />}>
                {activeModule === 'stories'       && <StoriesModule />}
                {activeModule === 'messages'      && <MobileMessenger />}
                {activeModule === 'notifications' && <NotificationsScreen />}
                {activeModule === 'gaming'        && <GamingModule />}
                {activeModule === 'bloom'         && <BloomModule />}
                {activeModule === 'extras'        && <ExtrasModule />}
                {activeModule === 'library'       && <LibraryModule />}
                {activeModule === 'studio'        && <BusinessStudio />}
                {activeModule === 'profile'       && <ProfileModule />}
                {activeModule === 'video'         && <SkyVideo />}
              </Suspense>
            </motion.div>
          </ErrorBoundary>
        </AnimatePresence>

        <IncomingCallOverlay />
        <ActiveCallPanel />
        <MiniCallOverlay />
        {/* Звук собеседника не зависит от того, свёрнут звонок или нет. */}
        <CallAudio />
      </main>

      {/* Подкаст продолжает играть при уходе с экрана, поэтому его
          проигрыватель живёт здесь, в оболочке, а не внутри модуля. */}
      <PodcastPlayerHost />
      {activeModule !== 'extras' && islandMode !== 'island' && <div className="kb-hide"><MobileMiniPlayer onOpen={() => setPlayerOpen(true)} /></div>}
      <div className="kb-hide"><MobileTabBar onMore={() => setMoreOpen(true)} /></div>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      <MobileFullPlayer open={playerOpen} onClose={() => setPlayerOpen(false)} />

      <NotifToastLayer />
      <FloatingChatLayer />
    </div>
  );
};
