import { APP_VERSION_LABEL } from './core/version';
import { KutLandMark } from './shared/KutLandMark';
import React, { useEffect, useState } from 'react';
import { useSettings, setForceDark } from './settings/store';
import './settings/customThemes';   // применяет выбранную свою тему при запуске
import ReactDOM from 'react-dom/client';
import { AppShell }      from './app/AppShell';
import { AuthScreen }    from './auth/AuthScreen';
import { DeviceLinkDeepLink } from './auth/DeviceLinkPhone';
import { UnfreezeLinkPage, useOpenDevicesIfAsked } from './auth/AccountFreeze';
import { useEntitlementSync, useOpenPrimeIfAsked } from './prime/entitlementSync';
import { installTelemetry } from './core/telemetry';
import { StorageVerifyPage } from './admin/StorageVerify';
import { OidcAuthorizeGate } from './oidc/Authorize';
import { TVAuthScreen }  from './interface/tv/auth/TVAuthScreen';
import { useDeviceMode } from './interface/tv/useDeviceMode';
import { useConsoleMode } from './interface/console/consoleMode';
import { useCarMode } from './interface/car/useCarMode';
import { useSpeakerMode } from './interface/speaker/useSpeakerMode';
import { useConsoleStore } from './interface/console/consoleStore';
import { ConsoleRoot } from './interface/console/ConsoleRoot';
import { ConsoleIntro } from './interface/console/ConsoleIntro';
import { ConsoleProfilePicker } from './interface/console/ConsoleProfilePicker';
import { BetaGate }      from './auth/BetaGate';
import { IpPinOverlay } from './auth/IpPin';
import { AppLockGate } from './auth/AppLock';
import { AuthCodeAsk } from './auth/AuthCodeAsk';
import { SshLoginNotice } from './auth/SshLoginNotice';
import { AdminTokenPrompt } from './admin/AdminTokenPrompt';
import { restoreIcon } from './appicon/appIcon';
restoreIcon();
import { GloballyBlocked } from './auth/GloballyBlocked';
import { captureInvite } from './invite/capture';
import { captureQr } from './qr/qrApi';
import { QrIncoming } from './qr/QrIncoming';
import { HandoffIncoming } from './handoff/HandoffIncoming';
import { SafetyWatcher } from './safety/SafetyWatcher';
import { startHandoff } from './handoff/handoffApi';
import { hookOutput } from './handoff/audioOutput';
import { SeasonLayer } from './settings/SeasonLayer';
const GuideOnboarding = React.lazy(() => import('./guide/GuideOnboarding').then((m) => ({ default: m.GuideOnboarding })));
const GuidePage = React.lazy(() => import('./guide/GuidePage').then((m) => ({ default: m.GuidePage })));
import { LimitedAccessGate } from './auth/LimitedAccess';
import { setBetaRequiredHandler, setPlatformBlockedHandler, initNativeAuth, type PlatformBlock } from './core/auth/api';
import { apiPlatformStatus } from './core/platform';
import { PlatformBlockScreen } from './core/PlatformBlockScreen';
import { OfflineMode }   from './offline/OfflineMode';
import { BlockedScreen } from './moderation/BlockedScreen';
import { apiSupportStatus, type Restrictions } from './moderation/supportApi';
import { ErrorBoundary } from './app/ErrorBoundary';
import { LegalNotice, legalNoticeSeen } from './info/LegalNotice';
import { useAuthStore }  from './core/auth/store';
import { connectSocket, disconnectSocket } from './messenger/socket';
import { startOrdersSync } from './offline/ordersCache';
import { startGameActivity } from './gaming/gameSync';
import { startKeyboardInset } from './shared/keyboardInset';
import { reloadMessengerForUser } from './messenger/store';
import { reloadPlatformForUser }  from './platform/store';
import { reloadNotifsForUser }    from './notifications/store';
import { reloadWalletForUser }    from './wallet/store';
import { reloadCustomizationForUser } from './customization/store';
import { syncRegionForProfile, watchRegionChanges } from './region/sync';
import { initI18n } from './i18n';
import { consumeRecoveryHandoff, useOpenRecoveryIfAsked } from './auth/recoveryHandoff';
import './styles.css';

const SHIMMER_CSS = `
@keyframes sky-shimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}
@keyframes sky-fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0);   }
}
@keyframes sky-float-0 {
  0%, 100% { transform: translate(-50%,-50%) scale(1); }
  50%       { transform: translate(-50%,-60%) scale(1.08); }
}
@keyframes sky-float-1 {
  0%, 100% { transform: translate(-50%,-50%) scale(1.05); }
  50%       { transform: translate(-50%,-44%) scale(0.95); }
}
@keyframes sky-wave-arm {
  0%, 100% { transform: rotate(-20deg); }
  50%       { transform: rotate(20deg); }
}
@keyframes sky-cloud-pulse {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50%       { opacity: 0.7; transform: scale(1.15); }
}
@keyframes sky-shadow-pulse {
  0%, 100% { opacity: 0.8; transform: scaleX(1); }
  50%       { opacity: 0.4; transform: scaleX(0.7); }
}
`;


/* -- Sky Cloud Mascot (splash) -------------------------------- */
const SplashCloud = ({ waving }: { waving: boolean }) => {
  const [blink, setBlink] = React.useState(false);
  React.useEffect(() => {
    const t = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 140);
    }, 3200 + Math.random() * 1800);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ position:'relative', width:100, height:90 }}>
      {/* Outer glow ring */}
      <div style={{
        position:'absolute', inset:-16, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(79,110,247,0.18) 0%, transparent 65%)',
        animation: waving ? 'sky-cloud-pulse 2.4s ease-in-out infinite' : 'none',
        pointerEvents:'none',
      }}/>
      <svg viewBox="0 0 100 82" width="100" height="82"
        style={{ overflow:'visible', filter:'drop-shadow(0 8px 24px rgba(79,110,247,0.3))' }}>
        <defs>
          <radialGradient id="cg" cx="48%" cy="38%" r="60%">
            <stop offset="0%" stopColor="#ffffff"/>
            <stop offset="100%" stopColor="#dbeafe"/>
          </radialGradient>
          <radialGradient id="cg2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f0f9ff"/>
            <stop offset="100%" stopColor="#bfdbfe"/>
          </radialGradient>
        </defs>

        {/* Cloud body - layered circles for depth */}
        <circle cx="26" cy="54" r="19"  fill="url(#cg2)" opacity="0.9"/>
        <circle cx="50" cy="38" r="25"  fill="url(#cg)"/>
        <circle cx="74" cy="52" r="18"  fill="url(#cg2)" opacity="0.9"/>
        <circle cx="62" cy="62" r="14"  fill="url(#cg)"/>
        <circle cx="36" cy="62" r="14"  fill="url(#cg)"/>
        <rect   x="18"  y="52" width="64" height="20" rx="10" fill="url(#cg)"/>

        {/* Shadow underneath */}
        <ellipse cx="50" cy="74" rx="32" ry="4"
          fill="rgba(30,58,138,0.12)"
          style={{ animation:'sky-shadow-pulse 2.4s ease-in-out infinite' }}/>

        {/* Left eye */}
        {blink
          ? <line x1="39" y1="42" x2="47" y2="42" stroke="#1e3a5f" strokeWidth="2.8" strokeLinecap="round"/>
          : <>
              <ellipse cx="43" cy="42" rx="4.5" ry="4.8" fill="#1e3a5f"/>
              <circle cx="44.8" cy="40.2" r="1.5" fill="white"/>
            </>
        }
        {/* Right eye */}
        {blink
          ? <line x1="53" y1="42" x2="61" y2="42" stroke="#1e3a5f" strokeWidth="2.8" strokeLinecap="round"/>
          : <>
              <ellipse cx="57" cy="42" rx="4.5" ry="4.8" fill="#1e3a5f"/>
              <circle cx="58.8" cy="40.2" r="1.5" fill="white"/>
            </>
        }

        {/* Mouth - smile or open */}
        {waving
          ? <path d="M 40 53 Q 50 62 60 53" stroke="#1e3a5f" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
          : <path d="M 41 54 Q 50 59 59 54" stroke="#1e3a5f" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
        }

        {/* Rosy cheeks when waving */}
        {waving && <>
          <ellipse cx="35" cy="50" rx="6" ry="4" fill="#fca5a5" opacity="0.4"/>
          <ellipse cx="65" cy="50" rx="6" ry="4" fill="#fca5a5" opacity="0.4"/>
        </>}

        {/* Waving arm */}
        <g style={{
          transformOrigin: '76px 56px',
          animation: waving ? 'sky-wave-arm 0.5s ease-in-out infinite' : 'none',
          display: waving ? 'block' : 'none',
        }}>
          <ellipse cx="80" cy="52" rx="8" ry="7" fill="url(#cg)" opacity="0.95"/>
          <path d="M74 44v5m2.5-6v6m2.5-5v5" stroke="#fff" strokeWidth="1.4"
            strokeLinecap="round" fill="none" opacity="0.9"/>
        </g>

        {/* Sky brand tag */}
        <text x="50" y="68" fontSize="8" fill="#3b82f6" opacity="0.65"
          fontWeight="700" textAnchor="middle" fontFamily="system-ui, sans-serif">
          sky
        </text>
      </svg>
    </div>
  );
};

const Splash = ({ offline, minimal, onSkip }: { offline: boolean; minimal?: boolean; onSkip?: () => void }) => {
  const light = useSettings((st) => st.settings.colorScheme === 'light');
  const [phase, setPhase] = useState(0);
  const [showOffline, setShowOffline] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 600);
    const t2 = setTimeout(() => setPhase(2), 1100);
    const t3 = setTimeout(() => setPhase(3), 1350);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  useEffect(() => {
    if (!offline) { setShowOffline(false); return; }
    const t = setTimeout(() => setShowOffline(true), 900);
    return () => clearTimeout(t);
  }, [offline]);

  const logoVisible = phase >= 1;
  const textVisible = phase >= 2;
  const shimmer     = phase >= 3;

  // Pre-compute all style values to avoid esbuild regex false-positives with slash chars
  const GLOW_FULL  = `drop-shadow(0 0 24px rgba(79,110,247,${light ? 0.5 : 0.85}))`;
  const GLOW_MID   = `drop-shadow(0 0 14px rgba(79,110,247,${light ? 0.3 : 0.5}))`;
  const BG         = light
    ? 'radial-gradient(ellipse 80% 60% at 50% 40%, #ffffff 0%, #f6f7fb 60%, #eceef6 100%)'
    : 'radial-gradient(ellipse 80% 60% at 50% 40%, #15152a 0%, #0d0d12 60%, #09090f 100%)';
  const SHIMMER_GR = light
    ? 'linear-gradient(90deg, #1b1d2a 10%, #4f6ef7 35%, #a78bfa 55%, #1b1d2a 80%)'
    : 'linear-gradient(90deg, #ededef 10%, #4f6ef7 35%, #a78bfa 55%, #ededef 80%)';
  const OFFLINE_GR = 'linear-gradient(90deg, #8a8a96 20%, #4f6ef7 45%, #8a8a96 70%)';
  const STRIPE     = 'linear-gradient(90deg, transparent, rgba(79,110,247,0.6), rgba(167,139,250,0.4), transparent)';
  const PARTICLE_BG_EVEN = `radial-gradient(circle, rgba(79,110,247,${light ? 0.16 : 0.12}) 0%, transparent 70%)`;
  const PARTICLE_BG_ODD  = `radial-gradient(circle, rgba(167,139,250,${light ? 0.14 : 0.08}) 0%, transparent 70%)`;

  const logoFilter: string = shimmer ? GLOW_FULL : logoVisible ? GLOW_MID : 'none';
  const logoTransform: string = logoVisible ? 'scale(1)' : 'scale(0.4)';
  const rowTransform: string  = textVisible ? 'translateX(-32px)' : 'translateX(0)';

  const shimmerStyle: React.CSSProperties = shimmer ? {
    backgroundImage: SHIMMER_GR,
    backgroundSize: '200% auto',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    animation: 'sky-shimmer 2.2s linear infinite',
  } : { color: light ? '#1b1d2a' : '#ededef' };

  const offlineTextStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 500,
    animation: 'sky-fade-up 0.45s ease forwards',
    backgroundImage: OFFLINE_GR,
    backgroundSize: '200% auto',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    animationName: 'sky-shimmer',
    animationDuration: '2.2s',
    animationIterationCount: 'infinite',
  };

  return (
    <div onClick={onSkip} style={{ height:'100vh', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      background: BG, overflow:'hidden', position:'relative', cursor: onSkip ? 'pointer' : undefined }}>
      <style>{SHIMMER_CSS}</style>
      {minimal ? null : <>

      {/* Background particles */}
      <div style={{ position:'absolute', inset:0, pointerEvents:'none', overflow:'hidden' }}>
        {[...Array(6)].map((_,i) => (
          <div key={i} style={{
            position:'absolute', borderRadius:'50%',
            background: i % 2 === 0 ? PARTICLE_BG_EVEN : PARTICLE_BG_ODD,
            width: 200 + i * 60, height: 200 + i * 60,
            left: (10 + i * 14) + '%',
            top: (20 + (i % 3) * 20) + '%',
            transform: 'translate(-50%,-50%)',
            opacity: logoVisible ? 1 : 0,
            transition: 'opacity 1s ease',
            animation: logoVisible ? 'sky-float-0 5s ease-in-out infinite' : 'none',
          }}/>
        ))}
      </div>

      {/* Logo + text row */}
      <div style={{ display:'flex', alignItems:'center',
        transform: rowTransform, transition:'transform 0.55s ease',
        position:'relative', zIndex:1 }}>

        {/* Logo */}
        <div style={{ width:72, height:72, flexShrink:0,
          opacity: logoVisible ? 1 : 0, transform: logoTransform,
          transition:'opacity 0.65s ease, transform 0.65s ease',
          filter: logoFilter }}>
          <img src="/logo.png" alt="Sky" style={{ width:'100%', height:'100%', objectFit:'contain' }}/>
        </div>

        {/* Text */}
        <div style={{ overflow:'hidden',
          maxWidth: textVisible ? 140 : 0, opacity: textVisible ? 1 : 0,
          transition:'max-width 0.5s ease, opacity 0.4s ease' }}>
          <span style={{ display:'block', paddingLeft:16, fontSize:42,
            fontWeight:800, letterSpacing:'-1.5px', lineHeight:1,
            whiteSpace:'nowrap', userSelect:'none', ...shimmerStyle }}>sky</span>
        </div>
      </div>

      {/* Mascot */}
      <div style={{ marginTop:18, opacity: textVisible ? 1 : 0,
        transition:'opacity 0.8s ease 0.6s', zIndex:1, position:'relative',
        filter: light ? 'drop-shadow(0 6px 12px rgba(79,110,247,0.35))' : undefined }}>
        <SplashCloud waving={shimmer}/>
      </div>

      {/* Version */}
      <div style={{ marginTop:6, opacity: textVisible ? 0.4 : 0,
        transition:'opacity 0.6s ease 0.3s',
        fontSize:11, letterSpacing:'0.12em', fontWeight:500,
        color: light ? '#6b6e80' : '#8a8a96', textTransform:'uppercase',
        zIndex:1, position:'relative' }}>{APP_VERSION_LABEL}</div>

      {/* Offline */}
      <div style={{ marginTop:12, height:22, overflow:'hidden', zIndex:1, position:'relative' }}>
        {showOffline && <span style={offlineTextStyle}>Ожидание сети...</span>}
      </div>

      {/* Компания: небольшая подпись внизу */}
      <div style={{ position:'absolute', bottom:'calc(env(safe-area-inset-bottom, 0px) + 48px)', left:0, right:0, zIndex:1, opacity: textVisible ? 1 : 0, transition:'opacity 0.8s ease 0.8s' }}>
        <KutLandMark light={light}/>
      </div>

      {/* Bottom stripe */}
      <div style={{ position:'absolute', bottom:0, left:0, right:0, height:2,
        background: STRIPE, opacity: shimmer ? 1 : 0, transition:'opacity 0.8s ease' }}/>
      </>}
    </div>
  );
};

const AdminVerifyPage = React.lazy(() => import('./admin/AdminGate').then((m) => ({ default: m.AdminVerifyPage })));
const AdminVerifyLazy = ({ kind }: { kind?: 'admin' | 'ssh' }) => <React.Suspense fallback={null}><AdminVerifyPage kind={kind} /></React.Suspense>;

const Root = () => {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const currentUserId   = useAuthStore(s => s.currentUserId);
  // Раньше до входа TV всегда получал обычный AuthScreen — экран под
  // мышь/тач/физическую клавиатуру, ни один элемент которого не был
  // виден системе навигации пультом (TVFocusable/focusManager). На
  // настоящем ТВ это означало, что войти вообще нельзя было.
  const deviceMode = useDeviceMode();
  const consoleMode = useConsoleMode();
  const carMode = useCarMode() || useSpeakerMode();
  const introDone = useConsoleStore((st) => st.introDone);
  const picked = useConsoleStore((st) => st.picked);
  const authStep = useAuthStore((st) => st.step);
  const profileCount = useAuthStore((st) => st.profiles.length);
  const authShown = useConsoleStore((st) => st.authShown);
  /* Режим для сервера: на доверенном устройстве Car/Console/TV профиль можно открыть без кода (если владелец разрешил). */
  useEffect(() => {
    document.documentElement.dataset.skyMode = consoleMode ? 'console' : carMode ? 'car' : deviceMode === 'tv' ? 'tv' : '';
  }, [consoleMode, carMode, deviceMode]);
  /* ТВ и Car Mode — всегда тёмная тема (консоль делает то же в ConsoleRoot). */
  useEffect(() => {
    if (consoleMode) return undefined;
    const on = deviceMode === 'tv' || carMode;
    setForceDark(on);
    return () => setForceDark(false);
  }, [deviceMode, carMode, consoleMode]);
  /* Консоль: оболочка нужна и экранам входа/ошибок — там тоже работает геймпад. */
  const wrap = (n: React.ReactNode) => (consoleMode ? <ConsoleRoot>{n}</ConsoleRoot> : n);
  // Skip splash if already authenticated (page refresh) - show instantly
  // Always show splash on every load
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const onOnline  = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Пока показывается сплэш, спрашиваем сервер, есть ли живая сессия.
  // Готовность наступает, когда и таймер вышел, и ответ получен —
  // иначе успел бы мелькнуть экран входа у уже вошедшего пользователя.
  const [sessionChecked, setSessionChecked] = useState(false);

  // Закрытая бета: сервер отказывает всему API, пока у браузера нет
  // пропуска. Замечаем такой отказ и показываем экран с полем для ключа.
  const [betaLocked, setBetaLocked] = useState(false);
  const [legalOpen, setLegalOpen] = useState(() => !legalNoticeSeen());
  useEffect(() => {
    setBetaRequiredHandler(() => setBetaLocked(true));
    return () => setBetaRequiredHandler(null);
  }, []);

  // «Аварийные работы» / «Технические работы» — сайт целиком, не путать
  // с аварийным режимом панели администратора (тот виден только внутри
  // самой панели). Владельца/администрацию сервер пропускает мимо этого
  // гейта сам, так что их обычные запросы просто не дают 503 — сюда это
  // долетает только теми, кого режим действительно касается.
  const [platformBlock, setPlatformBlock] = useState<PlatformBlock>(null);
  useEffect(() => {
    // 503 от сервера — повод перепроверить статус: если посетителя режим не касается (владелец/админ), заглушку не показываем
    setPlatformBlockedHandler((b) => {
      if (!b) { setPlatformBlock(null); return; }
      void apiPlatformStatus().then((s) => setPlatformBlock(s?.bypass ? null : b));
    });
    return () => setPlatformBlockedHandler(null);
  }, []);
  const checkPlatformStatus = async () => {
    const s = await apiPlatformStatus();
    if (!s) return;
    if (s.bypass) { setPlatformBlock(null); return; }   // владелец/администратор: сервер пропускает его мимо режима
    if (s.shutdown.active) setPlatformBlock({ kind: 'shutdown', reason: s.shutdown.reason });
    else if (s.maintenance.active) setPlatformBlock({ kind: 'maintenance', reason: s.maintenance.reason });
    else setPlatformBlock(null);
  };
  // После входа (и смены профиля) перепроверяем режим работ: заглушка, оставшаяся от запроса до входа, не должна висеть у владельца
  useEffect(() => { if (isAuthenticated) void checkPlatformStatus(); }, [isAuthenticated, currentUserId]);

  useEffect(() => {
    let cancelled = false;
    // В родном приложении сначала подгружаем сохранённый пропуск беты
    // из защищённого хранилища в память (raw() кладёт его в заголовок
    // синхронно) — иначе самый первый запрос (restoreSession) ушёл бы
    // без него и упёрся в калитку. В веб-сборке initNativeAuth — no-op.
    // Заставка не должна висеть вечно, если сервер не отвечает (перезапуск, обрыв): через 12 с показываем экран входа,
    // а проверка сессии продолжается в фоне и сама войдёт, как только сервер ответит.
    const giveUp = setTimeout(() => { if (!cancelled) setSessionChecked(true); }, 12000);
    initNativeAuth()
      .then(() => useAuthStore.getState().restoreSession())
      .finally(() => {
        clearTimeout(giveUp);
        if (cancelled) return;
        setSessionChecked(true);
        // До входа собственные гейтованные запросы не идут, поэтому
        // анонимный браузер иначе так и не узнал бы, почему сайт не
        // отвечает — спрашиваем открытую ручку статуса сами, один раз.
        // Уже вошедшего так не трогаем: у него источник правды — настоящие
        // 503 на реальных запросах (иначе владельца/админку задело бы
        // этим экраном по ошибке, пока их же запросы проходят мимо гейта).
        if (!useAuthStore.getState().isAuthenticated) void checkPlatformStatus();
      });
    return () => { cancelled = true; clearTimeout(giveUp); };
  }, []);

  const introAnim = useSettings((st) => st.settings.introAnim);
  useEffect(() => {
    // Заставку можно выключить в настройках: тогда ждём только ответ сервера о сессии.
    if (!introAnim) { setReady(true); return undefined; }
    const t = setTimeout(() => setReady(true), 2600);
    return () => clearTimeout(t);
  }, [introAnim]);

  // Ограничения решает сервер, поэтому спрашиваем его, а не смотрим в
  // сохранённый профиль: снятый бан должен действовать сразу, а
  // выставленный — не обходиться перезагрузкой страницы.
  const [limits, setLimits] = useState<Restrictions>({});
  useEffect(() => {
    if (!isAuthenticated) { setLimits({}); return; }
    let alive = true;
    const check = () => { void apiSupportStatus().then(r => { if (alive) setLimits(r.restrictions); }); };
    check();
    // Блокировку могут выдать, пока человек сидит в приложении.
    const t = setInterval(check, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [isAuthenticated, currentUserId]);

  useEffect(() => {
    if (isAuthenticated && currentUserId) {
      // note: splash always shown on load; only setReady via timer
      reloadMessengerForUser(currentUserId);
      reloadPlatformForUser(currentUserId);
      reloadNotifsForUser(currentUserId);
      // Кошелёк подтягиваем с сервера: в браузере он больше не хранится.
      void reloadWalletForUser(currentUserId);
      reloadCustomizationForUser(currentUserId);
      connectSocket(currentUserId);
      // Регион уже существующей системы (src/region) — догоняем с
      // сервером, ничего не меняя в самом выборе региона.
      const account = useAuthStore.getState().accounts.find(a => a.id === currentUserId);
      syncRegionForProfile(currentUserId, account?.regionCode);
    } else {
      void reloadWalletForUser(null);
      disconnectSocket();
    }
  }, [isAuthenticated, currentUserId]);

  // Клавиатура на телефоне: интерфейс не уезжает, поле ввода садится над клавиатурой.
  useEffect(() => startKeyboardInset(), []);

  // Копия заказов для офлайна (трек-номер, последнее сообщение) и досылка сообщений по заказу после возврата связи.
  useEffect(() => {
    if (!isAuthenticated || !currentUserId) return undefined;
    return startOrdersSync();
  }, [isAuthenticated, currentUserId]);

  // «Продолжить на другом устройстве»: это устройство в общем реестре, держим его «на связи», ловим входящие передачи; звук — на выбранное устройство вывода.
  useEffect(() => {
    hookOutput();
    if (!isAuthenticated || !currentUserId) return undefined;
    return startHandoff();
  }, [isAuthenticated, currentUserId]);

  // Активность в играх: пульс отмеченной игры, свои итоги, присутствие собеседников, определение игр в Windows-приложении.
  useEffect(() => {
    if (!isAuthenticated || !currentUserId) return undefined;
    return startGameActivity();
  }, [isAuthenticated, currentUserId]);

  // Дальнейшие изменения региона через существующий RegionPicker —
  // один слушатель на всё приложение, не пересоздаётся при каждом входе.
  useEffect(() => {
    watchRegionChanges(() => useAuthStore.getState().currentUserId);
  }, []);

  // Sky Console: своя заставка вместо обычной; не блокирует проверку сессии, идущую параллельно.
  if (consoleMode && !introDone) {
    return <ConsoleRoot><ConsoleIntro sessionReady={sessionChecked} onDone={() => useConsoleStore.getState().setIntroDone()} /></ConsoleRoot>;
  }

  if (!consoleMode && (!ready || !sessionChecked)) return <Splash offline={offline} minimal={!introAnim} onSkip={introAnim ? () => setReady(true) : undefined} />;

  // Окно о документах всплывает поверх любого экрана до входа — беты,
  // входа, выбора профиля: согласие относится не к экрану, а к
  // пользованию сервисом. Вошедшего им не дёргаем: у него согласие уже
  // записано на сервере, при создании профиля.
  //
  // Экран под окном получает нижний отступ, пока окно висит: иначе на
  // невысоком телефоне оно накроет ту самую кнопку, ради которой человек
  // сюда и пришёл.
  const showLegal = !isAuthenticated && legalOpen;
  const underLegal = (screen: React.ReactNode) => (
    <div style={{
      height: '100%', boxSizing: 'border-box',
      paddingBottom: showLegal ? 168 : 0,
      transition: 'padding-bottom 220ms ease',
    }}>
      {screen}
      {showLegal && <LegalNotice onDone={() => setLegalOpen(false)} />}
    </div>
  );

  if (betaLocked) {
    return wrap(underLegal(
      <BetaGate onUnlocked={() => {
        setBetaLocked(false);
        void useAuthStore.getState().restoreSession();
      }} />,
    ));
  }

  if (platformBlock) {
    return wrap(underLegal(
      <PlatformBlockScreen block={platformBlock} onRetry={checkPlatformStatus}
        onDismiss={!isAuthenticated ? () => setPlatformBlock(null) : undefined} />,
    ));
  }

  // Блокировка перекрывает всё: выхода в экосистему с этого экрана нет,
  // но обращение в поддержку оттуда доступно — решение надо чем-то
  // оспаривать.
  if (isAuthenticated && limits.bannedUntil !== undefined) {
    return wrap(<BlockedScreen bannedUntil={limits.bannedUntil} />);
  }

  // На ТВ, в консоли и в машине крупный интерфейс остаётся: загруженное видно, а о потере связи сообщает
  // плашка. Мелкий экран офлайн-режима для телефона там не годится.
  if (offline && isAuthenticated && !(consoleMode || deviceMode === 'tv' || carMode)) {
    return wrap(<OfflineMode onRetryOnline={() => { if (navigator.onLine) setOffline(false); }} />);
  }

  // «Кто играет?» при холодном запуске и смене профиля — в консоли, на ТВ и в автомобиле:
  // это общие экраны, где за устройством бывает несколько человек. Доступ проверяет сервер (selectProfile).
  if (consoleMode || deviceMode === 'tv' || carMode) {
    const needsPicker = profileCount > 0 && (authStep === 'profiles' || (isAuthenticated && !picked && !authShown));
    if (needsPicker) return <ConsoleRoot><ConsoleProfilePicker /></ConsoleRoot>;
    if (!isAuthenticated) {
      if (consoleMode) return <ConsoleRoot>{underLegal(<ConsoleAuth><AuthScreen /></ConsoleAuth>)}</ConsoleRoot>;
      return underLegal(<ConsoleAuth>{deviceMode === 'tv' ? <TVAuthScreen /> : <AuthScreen />}</ConsoleAuth>);
    }
    if (consoleMode) return <ConsoleRoot><AppShell key={currentUserId ?? 'app'} /></ConsoleRoot>;
  }

  return isAuthenticated
    ? <AppShell key={currentUserId ?? 'app'} />
    : underLegal(deviceMode === 'tv' ? <TVAuthScreen /> : <AuthScreen />);
};

/** Экран входа в консоли: помечаем, что профиль человек выбирал на нём, и «Кто играет?» не повторяем. */
const ConsoleAuth = ({ children }: { children: React.ReactNode }) => {
  useEffect(() => { useConsoleStore.getState().markAuthShown(); }, []);
  return <>{children}</>;
};

/* Язык и словарь — до первого кадра: английский не должен мелькать русским. */
/** Показывается только вошедшему: неавторизованный сначала видит обычный вход. */
const OpenDevices = () => { useOpenRecoveryIfAsked(); useOpenDevicesIfAsked(); useOpenPrimeIfAsked(); useEntitlementSync(); return null; };
const LinkDeepLinkGate = () => {
  const ok = useAuthStore((s) => s.isAuthenticated);
  return ok ? <><DeviceLinkDeepLink /><OpenDevices /></> : null;
};

installTelemetry();

captureInvite();   // ссылка-приглашение ?inv=КОД
captureQr();   // ссылка из Sky QR ?qr=КОД — запоминается до входа
void initI18n().then(() => consumeRecoveryHandoff()).catch(() => undefined).finally(() => ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100dvh', gap: 16, padding: 32, background: 'var(--bg)', color: 'var(--t1)',
      }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--amber, #f59e0b)' }}>
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>
          <path d="M12 9v4"/><path d="M12 17h.01"/>
        </svg>
        <p style={{ fontWeight: 700, fontSize: 16 }}>Что-то пошло не так</p>
        <p style={{ color: 'var(--t2)', fontSize: 13, textAlign: 'center', maxWidth: 320 }}>
          Приложению нужна перезагрузка. Ваши данные сохранены.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: 10, padding: '9px 20px', fontSize: 14,
            fontWeight: 600, cursor: 'pointer',
          }}>
          Перезагрузить
        </button>
      </div>
    }>
      {location.pathname === '/admin-verify' ? <AdminVerifyLazy /> : location.pathname === '/ssh-verify' ? <AdminVerifyLazy kind="ssh" /> : location.pathname === '/unfreeze' ? <UnfreezeLinkPage /> : location.pathname === '/storage-verify' ? <StorageVerifyPage /> : location.pathname === '/guide' ? <React.Suspense fallback={null}><GuidePage standalone /></React.Suspense> : <><Root /><SeasonLayer /><React.Suspense fallback={null}><GuideOnboarding /></React.Suspense><IpPinOverlay /><GloballyBlocked /><LimitedAccessGate /><AppLockGate /><AdminTokenPrompt /><AuthCodeAsk /><SshLoginNotice /><LinkDeepLinkGate /><QrIncoming /><HandoffIncoming /><SafetyWatcher /><OidcAuthorizeGate /></>}
    </ErrorBoundary>
  </React.StrictMode>
));
