import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { createPortal }           from 'react-dom';
import { Sidebar }                from '@/interface/layout/Sidebar';
import { PlayerEngine }           from '@/player/PlayerEngine';
import { PodcastPlayerHost }      from '@/podcasts/PodcastPlayer';
import { useModuleStore }         from '@/data/state/modules';
import { useAuthStore }           from '@/core/auth/store';
import { ChatList }               from '@/messenger/ChatList';
import { ChatWindow }             from '@/messenger/ChatWindow';
import { NotificationsScreen }    from '@/notifications/NotificationsScreen';
import {
  ExtrasModule, LibraryModule, BusinessStudio, BloomModule,
  ProfileModule, StoriesModule, GamingModule, SkyVideo, ModuleFallback,
} from './lazyModules';
import { NotifToastLayer }        from '@/notifications/NotifToast';
import { FloatingChatLayer }      from '@/notifications/FloatingChat';
import { ActiveCallPanel, IncomingCallOverlay, MiniCallOverlay, CallAudio } from '@/calls/CallUI';
import { NotifBridge }            from '@/notifications/NotifBridge';
import { ProfileViewerLayer }     from '@/profile/viewer/ProfileViewerLayer';
import { BreakReminderModal }     from '@/settings/BreakReminderModal';
import { useDeviceMode } from '@/interface/tv/useDeviceMode';
import { TVShell } from '@/interface/tv/TVShell';
import { ErrorBoundary }          from './ErrorBoundary';
import { useIsMobile }            from '@/interface/mobile/useIsMobile';
import { MobileShell }            from '@/interface/mobile/MobileShell';

// First-launch welcome notification
const useFirstLaunch = () => {
  const { currentUserId, accounts } = useAuthStore();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!currentUserId) return;
    const key = 'sky:welcomed:' + currentUserId;
    if (!localStorage.getItem(key)) {
      setTimeout(() => setShown(true), 1200);
      localStorage.setItem(key, '1');
    }
  }, [currentUserId]);
  return { shown, dismiss: () => setShown(false) };
};

/* - Pet Cursor (Prime users) ---------------------------------------- */
const PetCursor = () => {
  const { accounts, currentUserId } = useAuthStore();
  const me       = accounts.find(a => a.id === currentUserId);
  const isPrime  = me?.isPrime ?? false;
  const isMobile = useIsMobile();
  const [pos,     setPos]     = useState({ x: -200, y: -200 });
  const [visible, setVisible] = useState(false);
  const [emoji,   setEmoji]   = useState('🐱');

  useEffect(() => {
    // На тач-устройствах нет надёжного mouseleave — курсор-питомец
    // залипает на месте последнего тапа (синтетический mousemove от тача).
    // Это чисто десктопная фича, на мобильном её не показываем.
    if (!isPrime || isMobile) return;
    try {
      const prefs = JSON.parse(localStorage.getItem('sky:pets:v1') || '{}');
      const MAP: Record<string, string> = {
        'cat-neon':'🐱','bunny-pixel':'🐰','fox-cyber':'🦊','dog-retro':'🐶',
        'dino-8bit':'🦕','bear-astro':'🐻','dragon-mini':'🐲','owl-neon':'🦉',
      };
      const e = MAP[prefs.active];
      if (e) setEmoji(e);
    } catch {}

    const move  = (e: MouseEvent) => { setPos({ x: e.clientX, y: e.clientY }); setVisible(true); };
    const leave = () => setVisible(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseleave', leave);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseleave', leave); };
  }, [isPrime, isMobile]);

  if (!isPrime || isMobile || !visible) return null;
  return createPortal(
    <div style={{
      position: 'fixed', pointerEvents: 'none', zIndex: 99999,
      left: pos.x + 14, top: pos.y + 14,
      fontSize: 20, lineHeight: 1,
      transition: 'left 0.05s linear, top 0.05s linear',
      userSelect: 'none',
      filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))',
      animation: 'pet-cursor-bounce 0.9s ease-in-out infinite',
    }}>
      {emoji}
    </div>,
    document.body
  );
};

/* - Messenger layout ------------------------------------------------ */
const MessengerScreen = () => (
  <div className="relative flex h-full min-h-0 overflow-hidden">
    <ChatList />
    <ChatWindow />
  </div>
);

/* - Main AppShell --------------------------------------------------- */
export const AppShell = () => {
  const activeModule = useModuleStore(s => s.activeModule);
  const setActiveModule = useModuleStore(s => s.setActiveModule);
  const welcome = useFirstLaunch();
  const isMobile = useIsMobile();
  const deviceMode = useDeviceMode();

  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('module');
    const valid = ['stories','messages','bloom','extras','profile','notifications','gaming','video','library','studio'];
    if (m && valid.includes(m)) setActiveModule(m as any);
  }, []);

  if (deviceMode === 'tv') {
    return <ErrorBoundary><TVShell /></ErrorBoundary>;
  }

  if (isMobile) {
    return (
      <>
        <PetCursor />
        <AnimatePresence>
          {welcome.shown && (
            <motion.div
              initial={{ opacity: 0, y: -60 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -60 }}
              transition={{ type: 'spring', damping: 24, stiffness: 300 }}
              style={{
                position: 'fixed', top: 'calc(var(--safe-top) + 8px)', left: 16, right: 16,
                zIndex: 99998, background: 'var(--bg-l3)', border: '1px solid var(--border-m)', borderRadius: 16,
                padding: '12px 16px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'center', gap: 12, backdropFilter: 'blur(20px)',
              }}>
              <span style={{ fontSize: 22 }}>👋</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>Добро пожаловать в Sky!</p>
              </div>
              <button type="button" onClick={welcome.dismiss}
                style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600 }}>
                Начать
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <MobileShell />
        <ProfileViewerLayer />
        <ErrorBoundary>
          <BreakReminderModal />
        </ErrorBoundary>
      </>
    );
  }

  return (
    <>
      <PetCursor />

      {/* First-launch welcome */}
      <AnimatePresence>
        {welcome.shown && (
          <motion.div
            initial={{ opacity: 0, y: -60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -60 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            style={{
              position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
              zIndex: 99998, background: 'var(--bg-l3)',
              border: '1px solid var(--border-m)', borderRadius: 16,
              padding: '12px 20px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', gap: 12, minWidth: 280,
              backdropFilter: 'blur(20px)',
            }}>
            <span style={{ fontSize: 24 }}>👋</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--t1)' }}>Добро пожаловать в Sky!</p>
              <p style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>Экосистема готова к использованию</p>
            </div>
            <button
              type="button"
              onClick={welcome.dismiss}
              style={{ background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Начать
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)', height: '100dvh' }}>
        <NotifBridge />
        <PlayerEngine />
        {/* Подкаст продолжает играть при уходе с экрана, поэтому его
            проигрыватель живёт здесь, в оболочке, а не внутри модуля. */}
        <PodcastPlayerHost />
        <Sidebar />
        <main
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
          style={{ background: 'var(--bg-l1)' }}>
          <AnimatePresence mode="wait">
            <ErrorBoundary key={activeModule}>
              <motion.div
                key={activeModule + '_m'}
                className="h-full w-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}>
                <React.Suspense fallback={<ModuleFallback />}>
                  {activeModule === 'stories'       && <StoriesModule />}
                  {activeModule === 'messages'      && <MessengerScreen />}
                  {activeModule === 'notifications' && <NotificationsScreen />}
                  {activeModule === 'gaming'        && <GamingModule />}
                  {activeModule === 'bloom'         && <BloomModule />}
                  {activeModule === 'extras'        && <ExtrasModule />}
                  {activeModule === 'library'       && <LibraryModule />}
                  {activeModule === 'studio'        && <BusinessStudio />}
                  {activeModule === 'profile'       && <ProfileModule />}
                  {activeModule === 'video'         && <SkyVideo />}
                </React.Suspense>
              </motion.div>
            </ErrorBoundary>
          </AnimatePresence>
          <IncomingCallOverlay />
          <ActiveCallPanel />
          <MiniCallOverlay />
          {/* Звук собеседника не зависит от того, свёрнут звонок или нет. */}
          <CallAudio />
        </main>
        <NotifToastLayer />
        <FloatingChatLayer />
        <ProfileViewerLayer />
        <ErrorBoundary>
          <BreakReminderModal />
        </ErrorBoundary>
      </div>
    </>
  );
};
