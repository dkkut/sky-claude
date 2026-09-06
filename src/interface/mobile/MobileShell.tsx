import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useModuleStore } from '@/data/state/modules';
import { PlayerEngine } from '@/player/PlayerEngine';
import { NotifBridge } from '@/notifications/NotifBridge';
import { NotifToastLayer } from '@/notifications/NotifToast';
import { FloatingChatLayer } from '@/notifications/FloatingChat';
import { ActiveCallPanel, IncomingCallOverlay, MiniCallOverlay } from '@/calls/CallUI';
import { ErrorBoundary } from '@/app/ErrorBoundary';

import { StoriesModule } from '@/stories/StoriesModule';
import { ExtrasModule } from '@/extras/ExtrasModule';
import { LibraryModule } from '@/library/LibraryModule';
import { BusinessStudio } from '@/library/BusinessStudio';
import { BloomModule } from '@/bloom/BloomModule';
import { ProfileModule } from '@/profile/ProfileModule';
import { NotificationsScreen } from '@/notifications/NotificationsScreen';
import { GamingModule } from '@/gaming/GamingModule';
import { SkyVideo } from '@/extras/SkyVideo';

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

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: 'var(--bg)', height: '100dvh' }}>
      {/* height: 100dvh поверх h-screen (100vh) — на реальных мобильных
          браузерах 100vh не учитывает скрывающуюся адресную строку,
          из-за чего нижняя панель (и «Ещё») может оказаться частично за
          пределами реально видимой/тач-доступной области. Если dvh не
          поддерживается движком — значение отбрасывается как невалидное
          и остаётся h-screen, безопасный откат без побочных эффектов. */}
      <NotifBridge />
      <PlayerEngine />

      {!SELF_CHROME.has(activeModule) && <MobileHeader />}

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <ErrorBoundary key={activeModule}>
            <motion.div key={activeModule + '_mob'} className="h-full w-full"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
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
            </motion.div>
          </ErrorBoundary>
        </AnimatePresence>

        <IncomingCallOverlay />
        <ActiveCallPanel />
        <MiniCallOverlay />
      </main>

      {activeModule !== 'extras' && <MobileMiniPlayer onOpen={() => setPlayerOpen(true)} />}
      <MobileTabBar onMore={() => setMoreOpen(true)} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      <MobileFullPlayer open={playerOpen} onClose={() => setPlayerOpen(false)} />

      <NotifToastLayer />
      <FloatingChatLayer />
    </div>
  );
};
