/* ===========================================================
   SKY CONSOLE — заставка холодного запуска.
   Тьма → космос и звёзды → небесно-фиолетовый свет из центра →
   логотип Sky, собирающийся из света → слоган. Не блокирует
   загрузку: пока играет, сессия проверяется параллельно, а в конце
   заставка ждёт её только если сервер ещё не ответил.
=========================================================== */
import { KutLandMark } from '../../shared/KutLandMark';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useConsoleStore } from './consoleStore';

const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const FULL_MS = 5600;
const SHORT_MS = 1500;

export const ConsoleIntro = ({ sessionReady, onDone }: { sessionReady: boolean; onDone: () => void }) => {
  const prefs = useConsoleStore((s) => s.prefs);
  const reduced = useReducedMotion();
  const light = prefs.fx === 'light' || !!reduced;
  const short = !prefs.intro;
  const total = short ? SHORT_MS : FULL_MS;
  const [elapsed, setElapsed] = useState(false);
  const [skip, setSkip] = useState(false);
  const started = useRef(performance.now());
  const done = useRef(false);

  const stars = useMemo(() => {
    const r = rng(7);
    return Array.from({ length: light ? 24 : 90 }, (_, i) => ({
      x: r() * 100, y: r() * 100, s: 1 + r() * 2.2, d: 2.2 + r() * 3.5, delay: r() * 3, o: 0.3 + r() * 0.7, k: i,
    }));
  }, [light]);

  useEffect(() => { const t = setTimeout(() => setElapsed(true), total); return () => clearTimeout(t); }, [total]);

  // Пропустить: любая кнопка, но не раньше чем через секунду — чтобы случайное нажатие при запуске не съело заставку.
  useEffect(() => {
    const allow = () => performance.now() - started.current > 1000;
    const trySkip = () => { if (allow()) setSkip(true); };
    window.addEventListener('keydown', trySkip);
    window.addEventListener('pointerdown', trySkip);
    let raf = 0;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pads = navigator.getGamepads?.() ?? [];
      if (pads.some((p) => p?.buttons.some((b) => b.pressed))) trySkip();
    };
    raf = requestAnimationFrame(poll);
    return () => { window.removeEventListener('keydown', trySkip); window.removeEventListener('pointerdown', trySkip); cancelAnimationFrame(raf); };
  }, []);

  const finished = (elapsed || skip) && sessionReady;
  useEffect(() => {
    if (finished && !done.current) { done.current = true; onDone(); }
  }, [finished, onDone]);

  const k = short ? 0.28 : 1; // сжатие таймлайна
  const T = (ms: number) => (ms / 1000) * k;

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: '#02020a' }} role="status" aria-label="Sky Console запускается">
      {/* Космический фон */}
      <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: T(300), duration: T(2200) }}
        style={{ background: 'radial-gradient(120% 90% at 50% 120%, #0d0a2e 0%, #05051a 45%, #02020a 80%)' }} />
      {/* Звёзды */}
      <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: T(500), duration: T(2000) }}>
        {stars.map((s) => (
          <span key={s.k} className="console-fx absolute rounded-full bg-white" style={{
            left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, opacity: s.o,
            animation: light ? undefined : `console-twinkle ${s.d}s ease-in-out ${s.delay}s infinite`,
          }} />
        ))}
      </motion.div>
      {/* Свет из центра */}
      <motion.div className="absolute left-1/2 top-1/2 rounded-full" style={{
        width: '90vmax', height: '90vmax', translate: '-50% -50%',
        background: 'radial-gradient(circle, rgba(139,124,255,0.55) 0%, rgba(79,110,247,0.28) 22%, rgba(60,40,160,0.12) 42%, transparent 62%)',
        filter: light ? undefined : 'blur(8px)',
      }} initial={{ scale: 0.08, opacity: 0 }} animate={{ scale: [0.08, 0.5, 0.9], opacity: [0, 0.8, 0.6] }}
      transition={{ delay: T(900), duration: T(3400), ease: 'easeOut', times: [0, 0.55, 1] }} />

      {/* Логотип */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.div className="relative" initial={{ opacity: 0, scale: 0.86, filter: 'blur(30px) brightness(3)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px) brightness(1)' }} transition={{ delay: T(2300), duration: T(1500), ease: [0.2, 0.7, 0.2, 1] }}>
          <motion.div className="absolute left-1/2 top-1/2 rounded-full" style={{ width: 360, height: 360, translate: '-50% -50%', background: 'radial-gradient(circle, rgba(170,155,255,0.5), transparent 65%)' }}
            initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.55] }} transition={{ delay: T(2300), duration: T(2200) }} />
          <img src="/logo.png" alt="Sky" draggable={false} style={{ position: 'relative', width: 'min(24vmin, 220px)', height: 'min(24vmin, 220px)', objectFit: 'contain', filter: 'drop-shadow(0 0 28px rgba(139,124,255,0.75))', maskImage: 'radial-gradient(ellipse 58% 62% at 50% 50%, #000 66%, transparent 100%)', WebkitMaskImage: 'radial-gradient(ellipse 58% 62% at 50% 50%, #000 66%, transparent 100%)' }} />
        </motion.div>
        <motion.p className="mt-8 text-[clamp(18px,2.6vmin,30px)] font-light tracking-[0.42em] text-white/85" translate="no"
          initial={{ opacity: 0, y: 10, letterSpacing: '0.7em' }} animate={{ opacity: 1, y: 0, letterSpacing: '0.42em' }} transition={{ delay: T(3900), duration: T(1100), ease: 'easeOut' }}>
          Твоя экосистема
        </motion.p>
        <motion.div className="absolute bottom-6 left-0 right-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: T(4600), duration: T(900) }}><KutLandMark /></motion.div>
        {!sessionReady && (elapsed || skip) && (
          <div className="mt-10 h-1 w-40 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} aria-label="Загрузка">
            <motion.div className="h-full w-1/3 rounded-full" style={{ background: '#8b7cff' }} animate={{ x: ['-100%', '300%'] }} transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }} />
          </div>
        )}
      </div>
      {/* Уход в тёмное — плавный переход к следующему экрану */}
      <motion.div className="pointer-events-none absolute inset-0 bg-black" initial={{ opacity: 0 }} animate={{ opacity: finished ? 1 : 0 }} transition={{ duration: 0.35 }} />
    </div>
  );
};
