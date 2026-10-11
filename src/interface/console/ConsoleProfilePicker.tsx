/* ===========================================================
   SKY CONSOLE — «Кто играет?»
   Настоящие профили Sky ID (useAuthStore.profiles). Доступ проверяет
   сервер (selectProfile): защищённому профилю нужен код — как везде.
   Выбор карточки сам по себе личность не подтверждает.
=========================================================== */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Crown, Lock, LogOut } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import type { ServerProfile } from '@/core/auth/api';
import { consoleNav } from './input/nav';
import { useConsoleStore } from './consoleStore';

const grad = (n: string) => {
  let h = 0; for (let i = 0; i < n.length; i += 1) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return `linear-gradient(135deg, hsl(${h % 360} 70% 55%), hsl(${(h + 50) % 360} 70% 40%))`;
};
const initials = (n: string) => n.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

const Clock = () => {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 15000); return () => clearInterval(i); }, []);
  return <span translate="no">{t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
};

export const ConsoleBackdrop = ({ dim = 0 }: { dim?: number }) => {
  const fx = useConsoleStore((s) => s.prefs.fx);
  const stars = useMemo(() => Array.from({ length: fx === 'light' ? 20 : 60 }, (_, i) => ({ x: (i * 37.7) % 100, y: (i * 53.3) % 100, s: 1 + (i % 3), o: 0.2 + ((i * 7) % 8) / 12 })), [fx]);
  return (
    <div className="absolute inset-0 -z-0 overflow-hidden" style={{ background: 'radial-gradient(130% 100% at 50% 110%, #1a1250 0%, #080824 48%, #02020a 85%)' }} aria-hidden>
      {stars.map((s, i) => <span key={i} className="absolute rounded-full bg-white" style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, opacity: s.o }} />)}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(60% 50% at 50% 55%, rgba(139,124,255,0.18), transparent 70%)' }} />
      {dim > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: dim }} />}
    </div>
  );
};

const ProfileCard = ({ p, i, active, chosen, dimmed, onPick }: {
  p: ServerProfile; i: number; active: boolean; chosen: boolean; dimmed: boolean; onPick: () => void;
}) => (
  <motion.button type="button" onClick={onPick} aria-label={p.name} data-console-autofocus={active ? '' : undefined}
    className="w-[220px] rounded-[36px] bg-transparent p-4 outline-none"
    initial={{ opacity: 0, y: 40, scale: 0.8, filter: 'blur(14px)' }}
    animate={{ opacity: dimmed ? 0.25 : 1, y: 0, scale: chosen ? 1.18 : 1, filter: 'blur(0px)' }}
    transition={{ delay: 0.15 + i * 0.12, duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}>
    <span className="console-zoom console-noring flex flex-col items-center gap-4">
    <span className="console-avatar relative grid h-[168px] w-[168px] place-items-center overflow-hidden rounded-full text-[56px] font-bold text-white"
      style={{ background: p.avatar ? `center/cover url(${p.avatar})` : grad(p.name), boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 0 3px rgba(255,255,255,0.12)' }}>
      {!p.avatar && <span translate="no">{initials(p.name)}</span>}
      {chosen && <motion.span className="absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 0 0 4px #b3a7ff, 0 0 60px rgba(139,124,255,0.9)' }} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.7] }} transition={{ duration: 0.6 }} />}
    </span>
    <span className="flex max-w-full items-center gap-2 text-[26px] font-semibold text-white" translate="no">
      <span className="truncate">{p.name}</span>
      {p.isPrime && <Crown size={20} className="shrink-0 text-amber-300" aria-label="Prime" />}
      {p.twoFactorEnabled && <Lock size={18} className="shrink-0 text-white/60" aria-label="Защищён кодом" />}
    </span>
    <span className="-mt-3 text-[16px] text-white/50" translate="no">@{p.username}</span>
    </span>
  </motion.button>
);

export const ConsoleProfilePicker = () => {
  const profiles = useAuthStore((s) => s.profiles);
  const activeId = useAuthStore((s) => s.activeProfileId);
  const selectProfile = useAuthStore((s) => s.selectProfile);
  const logout = useAuthStore((s) => s.logout);
  const setPicked = useConsoleStore((s) => s.setPicked);
  const [chosen, setChosen] = useState<string | null>(null);
  const [codeFor, setCodeFor] = useState<ServerProfile | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const mountedAt = useRef(performance.now());
  useEffect(() => { const t = setTimeout(() => consoleNav.focusAuto(), 1100); return () => clearTimeout(t); }, []);
  // Данные обновились (например, пришла сессия) — фокус не должен пропасть, но и не прыгать на карточку
  // до её появления: иначе нажатие, которым пропустили заставку, сразу выбрало бы профиль.
  useEffect(() => {
    if (codeFor || performance.now() - mountedAt.current < 1200) return undefined;
    consoleNav.ensureFocus();
    return undefined;
  }, [profiles.length, codeFor]);

  const attempt = async (p: ServerProfile, withCode?: string) => {
    if (busy || performance.now() - mountedAt.current < 900) return;
    setBusy(true); setErr(''); setChosen(p.id);
    // Подтверждение выбора идёт параллельно с проверкой доступа на сервере.
    const res = await selectProfile(p.id, withCode);
    setBusy(false);
    if (res.ok) { setPicked(true); return; }
    if (res.needsCode) { setCodeFor(p); setCode(''); setErr(res.reason ?? ''); setChosen(null); return; }
    setChosen(null); setErr(res.reason ?? 'Не удалось открыть профиль');
  };

  return (
    <div className="fixed inset-0 overflow-hidden text-white">
      <ConsoleBackdrop />
      <div className="absolute right-12 top-9 text-[26px] font-light text-white/85"><Clock /></div>
      <AnimatePresence mode="wait">
        {!codeFor ? (
          <motion.div key="pick" className="console-picker absolute inset-0 flex flex-col items-center justify-center gap-14" exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="text-center">
              <h1 className="text-[clamp(36px,5vmin,56px)] font-light tracking-[0.22em]">КТО ИГРАЕТ?</h1>
              <p className="mt-3 text-[20px] text-white/55">Выберите профиль Sky ID</p>
            </motion.div>
            <div className="flex flex-wrap items-start justify-center gap-6">
              {profiles.map((p, i) => (
                <ProfileCard key={p.id} p={p} i={i} active={p.id === activeId || (!activeId && i === 0)} chosen={chosen === p.id} dimmed={!!chosen && chosen !== p.id} onPick={() => { void attempt(p); }} />
              ))}
              <motion.button type="button" onClick={() => logout()} aria-label="Другой аккаунт" className="w-[220px] rounded-[36px] bg-transparent p-4 outline-none"
                initial={{ opacity: 0, y: 40 }} animate={{ opacity: chosen ? 0.25 : 1, y: 0 }} transition={{ delay: 0.15 + profiles.length * 0.12, duration: 0.6 }}>
                <span className="console-zoom console-noring flex flex-col items-center gap-4">
                <span className="console-avatar grid h-[168px] w-[168px] place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.08)', boxShadow: '0 0 0 3px rgba(255,255,255,0.1)' }}><LogOut size={52} className="text-white/70" /></span>
                <span className="text-[24px] font-semibold text-white/85">Другой аккаунт</span>
                </span>
              </motion.button>
            </div>
            <div className="h-8 text-[20px] text-amber-200" role="alert">{err}</div>
          </motion.div>
        ) : (
          <motion.div key="code" className="absolute inset-0 flex flex-col items-center justify-center gap-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Lock size={48} className="text-white/70" />
            <h1 className="text-[40px] font-light tracking-[0.12em]" translate="no">{codeFor.name}</h1>
            <p className="text-[20px] text-white/60">Профиль защищён. Введите код из приложения или письма.</p>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" autoComplete="one-time-code" aria-label="Код"
              data-console-autofocus className="w-[340px] rounded-2xl bg-white/10 px-6 py-4 text-center text-[34px] tracking-[0.5em] text-white outline-none" translate="no" />
            <div className="flex gap-4">
              <button type="button" disabled={busy || code.length < 4} onClick={() => { void attempt(codeFor, code); }} className="console-card rounded-full px-10 py-3 text-[22px] font-semibold" style={{ background: '#7c6cff' }}>Войти</button>
              <button type="button" data-console-back onClick={() => { setCodeFor(null); setErr(''); }} className="console-card rounded-full px-10 py-3 text-[22px] font-semibold" style={{ background: 'rgba(255,255,255,0.12)' }}>Назад</button>
            </div>
            <div className="h-8 text-[20px] text-amber-200" role="alert">{err}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
