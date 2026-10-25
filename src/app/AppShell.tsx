import { Sparkles } from 'lucide-react';
import { ModuleGate } from '@/core/moduleClosures';
import { LimitedLock } from '@/auth/LimitedAccess';
import { useCursorPet } from '@/shared/cursorPet';
import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { createPortal }           from 'react-dom';
import { Sidebar }                from '@/interface/layout/Sidebar';
import { PlayerEngine }           from '@/player/PlayerEngine';
import { PodcastPlayerHost }      from '@/podcasts/PodcastPlayer';
import { useModuleStore }         from '@/data/state/modules';
import { useAuthStore }           from '@/core/auth/store';
import { useModerationStore }     from '@/shared/moderationStore';
import { ChatList }               from '@/messenger/ChatList';
import { ChatWindow }             from '@/messenger/ChatWindow';
import { NotificationsScreen }    from '@/notifications/NotificationsScreen';
import {
  ExtrasModule, LibraryModule, BusinessStudio, BloomModule,
  ProfileModule, StoriesModule, GamingModule, SkyVideo, ModuleFallback,
} from './lazyModules';
import { NotifToastLayer }        from '@/notifications/NotifToast';
import { FlashLayer }             from '@/shared/flash';
import { FloatingChatLayer }      from '@/notifications/FloatingChat';
import { ActiveCallPanel, IncomingCallOverlay, MiniCallOverlay, CallAudio } from '@/calls/CallUI';
import { NotifBridge }            from '@/notifications/NotifBridge';
import { IslandBridge }           from '@/island/IslandBridge';
import { SkyIsland }              from '@/island/SkyIsland';
import { ProfileViewerLayer }     from '@/profile/viewer/ProfileViewerLayer';
import { BreakReminderModal }     from '@/settings/BreakReminderModal';
import { useDeviceMode } from '@/interface/tv/useDeviceMode';
import { TVShell } from '@/interface/tv/TVShell';
import { useSpeakerMode } from '@/interface/speaker/useSpeakerMode';
import { SpeakerShell } from '@/interface/speaker/SpeakerShell';
import { useCarMode } from '@/interface/car/useCarMode';
import { useConsoleMode } from '@/interface/console/consoleMode';
import { ConsoleShell } from '@/interface/console/ConsoleShell';
import { CarShell } from '@/interface/car/CarShell';
import { isElectron } from '@/core/nativeApp';
import { isQuickActionsWindow } from '@/interface/quickactions/useQuickActionsWindow';
import { QuickActionsShell } from '@/interface/quickactions/QuickActionsShell';
import { useMainWindowPlayerBridge } from '@/interface/quickactions/playerBridge';
import { ErrorBoundary }          from './ErrorBoundary';
import { useIsMobile }            from '@/interface/mobile/useIsMobile';
import { MobileShell }            from '@/interface/mobile/MobileShell';
import { apiCall }                from '@/core/auth/api';

/* - Pet Cursor (Prime users) ---------------------------------------- */
const PetCursor = () => {
  const accounts = useAuthStore((s) => s.accounts);
  const currentUserId = useAuthStore((s) => s.currentUserId);
  const me       = accounts.find(a => a.id === currentUserId);
  const isPrime  = me?.isPrime ?? false;
  const isMobile = useIsMobile();
  const [pos,     setPos]     = useState({ x: -200, y: -200 });
  const [visible, setVisible] = useState(false);
  const { enabled, animal: emoji } = useCursorPet();

  useEffect(() => {
    // На тач-устройствах нет надёжного mouseleave — курсор-питомец
    // залипает на месте последнего тапа (синтетический mousemove от тача).
    // Это чисто десктопная фича, на мобильном её не показываем.
    if (!isPrime || isMobile || !enabled) return;
    const move  = (e: MouseEvent) => { setPos({ x: e.clientX, y: e.clientY }); setVisible(true); };
    const leave = () => setVisible(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseleave', leave);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseleave', leave); };
  }, [isPrime, isMobile, enabled]);

  if (!isPrime || isMobile || !enabled || !visible) return null;
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
  <LimitedLock>
    <div className="relative flex h-full min-h-0 overflow-hidden">
      <ChatList />
      <ChatWindow />
    </div>
  </LimitedLock>
);

/* - Main AppShell --------------------------------------------------- */
export const AppShell = () => {
  const activeModule = useModuleStore(s => s.activeModule);
  const setActiveModule = useModuleStore(s => s.setActiveModule);
  const isMobile = useIsMobile();
  const deviceMode = useDeviceMode();
  const carMode = useCarMode();
  const speakerMode = useSpeakerMode();
  const consoleMode = useConsoleMode();
  // Пуш состояния плеера в overlay Quick Actions (см. playerBridge.ts) —
  // сам по себе ничего не делает вне Electron-основного окна.
  useMainWindowPlayerBridge();

  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('module');
    const valid = ['stories','messages','bloom','extras','profile','notifications','gaming','video','library','studio'];
    if (m && valid.includes(m)) setActiveModule(m as any);
  }, []);

  /* Передача личности KutRent Market (market.kutrent.online) с этого
   * домена: мы уже вошли (AppShell монтируется только после входа), а
   * market.kutrent.online — другой домен, своей Sky-сессии у него нет и
   * быть не должно. Выпускаем одноразовый токен и уводим браузер на
   * ?return= — но только на тот адрес, который сервер сам проверит
   * против MARKET_DOMAIN (см. server/routes/kutrentmarket.mjs,
   * marketOriginAllowed): открыть эту ссылку с посторонним return
   * можно сколько угодно, токен для него просто не выпустят. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('module') !== 'kutrent-link') return;
    const returnUrl = params.get('return') ?? '';
    if (!returnUrl) return;
    let returnOrigin = '';
    try { returnOrigin = new URL(returnUrl).origin; } catch { return; }
    void apiCall<{ token: string }>('/api/kutrent-market/sso/start', {
      method: 'POST', body: JSON.stringify({ returnOrigin }),
    }).then((r) => {
      if (r.ok && r.data?.token) {
        window.location.href = `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(r.data.token)}`;
      }
    });
  }, []);

  // Пометки/блокировки модерации (видео-каналы, каналы мессенджера,
  // фильмы) — один раз на сессию, здесь, а не в каждом из мест показа
  // (SkyVideo/SkyFilm/ChatWindow/ChatList/AdminPanel): AppShell
  // перемонтируется при смене currentUserId (key в main.tsx), так что
  // и это состояние честно переспрашивается при входе другим человеком.
  useEffect(() => { void useModerationStore.getState().fetchFlags(); }, []);

  // Overlay-окно Quick Actions — отдельный рендер-процесс Electron
  // (app://sky/?quickActions=1, см. electron/main.cjs), никогда не
  // Android/iOS/веб/TV/Car: там window.sky.quickActions просто не
  // существует, и isQuickActionsWindow() всегда вернёт false.
  if (isElectron() && isQuickActionsWindow()) {
    return <ErrorBoundary><QuickActionsShell /></ErrorBoundary>;
  }

  // Sky Console — отдельная оболочка для консолей; приоритет выше Sky TV, сам Sky TV не затронут.
  if (consoleMode) {
    return <ErrorBoundary><ConsoleShell messenger={<MessengerScreen />} /></ErrorBoundary>;
  }

  if (deviceMode === 'tv') {
    return <ErrorBoundary><TVShell /></ErrorBoundary>;
  }

  if (carMode) {
    return <ErrorBoundary><CarShell /></ErrorBoundary>;
  }

  if (speakerMode) {
    return <ErrorBoundary><SpeakerShell /></ErrorBoundary>;
  }

  if (isMobile) {
    return (
      <>
        <PetCursor />
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

      <div className="island-pad-shell flex h-screen overflow-hidden" style={{ background: 'var(--bg)', height: '100dvh' }}>
        <NotifBridge />
        <IslandBridge />
        <SkyIsland />
        <PlayerEngine />
        {/* Подкаст продолжает играть при уходе с экрана, поэтому его
            проигрыватель живёт здесь, в оболочке, а не внутри модуля. */}
        <PodcastPlayerHost />
        <Sidebar />
        <main
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
          style={{ background: 'var(--bg-l1)' }}>
          {/* Без AnimatePresence: уходящий модуль (музыка, кабинет продавца) мог не завершить exit и не отпустить экран новой вкладке */}
<>
            <ErrorBoundary key={activeModule}>
              <motion.div
                key={activeModule + '_m'}
                className="absolute inset-0 h-full w-full"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                
                transition={{ duration: 0.1 }}>
                <React.Suspense fallback={<ModuleFallback />}>
                  <ModuleGate id={activeModule}>
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
                </ModuleGate>
                </React.Suspense>
              </motion.div>
            </ErrorBoundary>
          </>
          <IncomingCallOverlay />
          <ActiveCallPanel />
          <MiniCallOverlay />
          {/* Звук собеседника не зависит от того, свёрнут звонок или нет. */}
          <CallAudio />
        </main>
        <NotifToastLayer />
        <FlashLayer />
        <FloatingChatLayer />
        <ProfileViewerLayer />
        <ErrorBoundary>
          <BreakReminderModal />
        </ErrorBoundary>
      </div>
    </>
  );
};
