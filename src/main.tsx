import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { AppShell }      from './app/AppShell';
import { AuthScreen }    from './auth/AuthScreen';
import { BetaGate }      from './auth/BetaGate';
import { setBetaRequiredHandler } from './core/auth/api';
import { OfflineMode }   from './offline/OfflineMode';
import { BlockedScreen } from './moderation/BlockedScreen';
import { apiSupportStatus, type Restrictions } from './moderation/supportApi';
import { ErrorBoundary } from './app/ErrorBoundary';
import { LegalNotice, legalNoticeSeen } from './info/LegalNotice';
import { useAuthStore }  from './core/auth/store';
import { connectSocket, disconnectSocket } from './messenger/socket';
import { reloadMessengerForUser } from './messenger/store';
import { reloadPlatformForUser }  from './platform/store';
import { reloadNotifsForUser }    from './notifications/store';
import { reloadWalletForUser }    from './wallet/store';
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

const Splash = ({ offline }: { offline: boolean }) => {
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
  const GLOW_FULL  = 'drop-shadow(0 0 24px rgba(79,110,247,0.85))';
  const GLOW_MID   = 'drop-shadow(0 0 14px rgba(79,110,247,0.5))';
  const BG         = 'radial-gradient(ellipse 80% 60% at 50% 40%, #15152a 0%, #0d0d12 60%, #09090f 100%)';
  const SHIMMER_GR = 'linear-gradient(90deg, #ededef 10%, #4f6ef7 35%, #a78bfa 55%, #ededef 80%)';
  const OFFLINE_GR = 'linear-gradient(90deg, #8a8a96 20%, #4f6ef7 45%, #8a8a96 70%)';
  const STRIPE     = 'linear-gradient(90deg, transparent, rgba(79,110,247,0.6), rgba(167,139,250,0.4), transparent)';
  const PARTICLE_BG_EVEN = 'radial-gradient(circle, rgba(79,110,247,0.12) 0%, transparent 70%)';
  const PARTICLE_BG_ODD  = 'radial-gradient(circle, rgba(167,139,250,0.08) 0%, transparent 70%)';

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
  } : { color: '#ededef' };

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
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      background: BG, overflow:'hidden', position:'relative' }}>
      <style>{SHIMMER_CSS}</style>

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
        transition:'opacity 0.8s ease 0.6s', zIndex:1, position:'relative' }}>
        <SplashCloud waving={shimmer}/>
      </div>

      {/* Version */}
      <div style={{ marginTop:6, opacity: textVisible ? 0.4 : 0,
        transition:'opacity 0.6s ease 0.3s',
        fontSize:11, letterSpacing:'0.12em', fontWeight:500,
        color:'#8a8a96', textTransform:'uppercase',
        zIndex:1, position:'relative' }}>Sky v4.6</div>

      {/* Offline */}
      <div style={{ marginTop:12, height:22, overflow:'hidden', zIndex:1, position:'relative' }}>
        {showOffline && <span style={offlineTextStyle}>Ожидание сети...</span>}
      </div>

      {/* Bottom stripe */}
      <div style={{ position:'absolute', bottom:0, left:0, right:0, height:2,
        background: STRIPE, opacity: shimmer ? 1 : 0, transition:'opacity 0.8s ease' }}/>
    </div>
  );
};

const Root = () => {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const currentUserId   = useAuthStore(s => s.currentUserId);
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

  useEffect(() => {
    let cancelled = false;
    useAuthStore.getState().restoreSession()
      .finally(() => { if (!cancelled) setSessionChecked(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 2600);
    return () => clearTimeout(t);
  }, []);

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
      connectSocket(currentUserId);
    } else {
      void reloadWalletForUser(null);
      disconnectSocket();
    }
  }, [isAuthenticated, currentUserId]);

  if (!ready || !sessionChecked) return <Splash offline={offline} />;

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
    return underLegal(
      <BetaGate onUnlocked={() => {
        setBetaLocked(false);
        void useAuthStore.getState().restoreSession();
      }} />,
    );
  }

  // Блокировка перекрывает всё: выхода в экосистему с этого экрана нет,
  // но обращение в поддержку оттуда доступно — решение надо чем-то
  // оспаривать.
  if (isAuthenticated && limits.bannedUntil !== undefined) {
    return <BlockedScreen bannedUntil={limits.bannedUntil} />;
  }

  if (offline && isAuthenticated) {
    return <OfflineMode onRetryOnline={() => { if (navigator.onLine) setOffline(false); }} />;
  }

  return isAuthenticated
    ? <AppShell key={currentUserId ?? 'app'} />
    : underLegal(<AuthScreen />);
};

ReactDOM.createRoot(document.getElementById('root')!).render(
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
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
);
