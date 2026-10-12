/**
 * Sky Island — капсула сверху по центру.
 *
 * Скрыта, пока нечего показать (место не занимает и клики не перехватывает:
 * кликабельна только сама капсула). Появляется компактной на событие или
 * пока играет медиа; по нажатию раскрывается вниз компактной панелью.
 * Все данные — из реальных источников (islandStore, mediaAdapter, aiSession).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Pause, Play, SkipBack, SkipForward, X, Mic, Keyboard, Square, ExternalLink, Phone,
  MessageCircle, Bell, Download, Music2, Sparkles, Rewind, FastForward, Send, AlertTriangle,
} from 'lucide-react';
import { useSettings } from '@/settings/store';
import { useIslandStore, type IslandEvent } from './islandStore';
import { useNowPlaying, sourceLabel, type NowPlaying } from './mediaAdapter';
import { useAiSession, type AiPhase } from './aiSession';
import { useWake } from './wake';

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60); const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

const SURFACE = 'rgba(8,9,16,0.94)';
const EDGE = 'rgba(160,150,255,0.18)';
const ACCENT = '#8b7cff';
const RATES = [0.75, 1, 1.25, 1.5, 2];

const Cover = ({ src, letter, size, icon }: { src?: string; letter?: string; size: number; icon?: React.ReactNode }) => {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  return (
    <div className="shrink-0 overflow-hidden flex items-center justify-center text-white/90"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), background: 'rgba(255,255,255,0.08)', fontSize: size * 0.42, fontWeight: 700 }}>
      {src && !bad ? <img src={src} alt="" className="h-full w-full object-cover" draggable={false} onError={() => setBad(true)} />
        : icon ?? <span translate="no">{letter ?? '·'}</span>}
    </div>
  );
};

/** Индикатор воспроизведения: показывает состояние плеера, не звук. */
const Eq = ({ active, animate }: { active: boolean; animate: boolean }) => (
  <div className="flex items-end gap-[2px]" style={{ height: 14 }} aria-hidden>
    {[0, 1, 2, 3].map((i) => (
      <span key={i} className="block w-[3px] rounded-full" style={{
        background: ACCENT, height: active ? undefined : 4,
        animation: active && animate ? `island-eq ${0.7 + i * 0.13}s ease-in-out ${i * 0.08}s infinite alternate` : undefined,
        minHeight: 4, ...(active && !animate ? { height: 8 } : {}),
      }} />
    ))}
  </div>
);

/** Волна по реальному уровню микрофона: кольцо последних замеров. */
const MicWave = ({ level, bars = 18, height = 28 }: { level: number | null; bars?: number; height?: number }) => {
  const hist = useRef<number[]>([]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (level === null) { hist.current = []; return; }
    hist.current = [...hist.current.slice(-(bars - 1)), level];
    tick((n) => n + 1);
  }, [level, bars]);
  const arr = Array.from({ length: bars }, (_, i) => hist.current[hist.current.length - bars + i] ?? 0);
  return (
    <div className="flex items-center gap-[3px]" style={{ height }} aria-hidden>
      {arr.map((v, i) => (
        <span key={i} className="block w-[3px] rounded-full" style={{
          height: level === null ? 3 : Math.max(3, v * height), background: level === null ? 'rgba(255,255,255,0.25)' : ACCENT,
          transition: 'height 60ms linear',
        }} />
      ))}
    </div>
  );
};

const PHASE_TEXT: Record<AiPhase, string> = {
  off: '', detected: 'Слушаю вас', listening: 'Слушаю', processing: 'Думаю', speaking: 'Отвечаю',
  followup: 'Продолжайте', confirm: 'Подтвердите', error: 'Не получилось',
};

const IconBtn = ({ label, onClick, children, size = 36, primary, disabled }: {
  label: string; onClick: () => void; children: React.ReactNode; size?: number; primary?: boolean; disabled?: boolean;
}) => (
  <button type="button" aria-label={label} title={label} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick(); }}
    className="flex items-center justify-center rounded-full text-white outline-none transition active:scale-90 focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-35"
    style={{ width: size, height: size, background: primary ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.1)', color: primary ? '#0b0b14' : '#fff' }}>
    {children}
  </button>
);

/* ── Раскрытая панель медиа ─────────────────────────────────── */
const MediaPanel = ({ np, onClose }: { np: NowPlaying; onClose: () => void }) => {
  const [drag, setDrag] = useState<number | null>(null);
  const cur = drag ?? np.current;
  const showSeek = np.canSeek && np.duration > 0;
  const skipLike = np.kind === 'podcast' || np.kind === 'film' || np.kind === 'video' || np.kind === 'book';
  return (
    <div className="w-full px-4 pb-4 pt-4">
      <div className="flex items-center gap-3">
        <Cover src={np.cover} size={64} icon={<Music2 size={26} />} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-white" translate="no">{np.title}</div>
          <div className="truncate text-[13px] text-white/55" translate="no">{np.subtitle || sourceLabel(np.kind)}</div>
          <div className="mt-0.5 text-[11px] uppercase tracking-wide" style={{ color: ACCENT }}>{sourceLabel(np.kind)}</div>
        </div>
        <IconBtn label="Закрыть" onClick={onClose} size={30}><X size={15} /></IconBtn>
      </div>

      {np.error && (
        <div className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] text-amber-200" style={{ background: 'rgba(245,158,11,0.12)' }}>
          <AlertTriangle size={14} /> Не удалось воспроизвести. Откройте плеер и попробуйте ещё раз.
        </div>
      )}

      {showSeek && (
        <div className="mt-4">
          <input type="range" min={0} max={Math.max(1, Math.floor(np.duration))} step={1} value={Math.min(cur, np.duration)}
            aria-label="Перемотка" aria-valuetext={`${fmt(cur)} из ${fmt(np.duration)}`}
            onChange={(e) => setDrag(Number(e.target.value))}
            onPointerUp={() => { if (drag !== null) { np.seek(drag); setDrag(null); } }}
            onKeyUp={() => { if (drag !== null) { np.seek(drag); setDrag(null); } }}
            className="island-range w-full" style={{ ['--p' as string]: `${(cur / Math.max(1, np.duration)) * 100}%` }} />
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-white/50">
            <span>{fmt(cur)}</span><span>−{fmt(Math.max(0, np.duration - cur))}</span>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-center gap-3">
        {(np.canPrev || skipLike) && (
          <IconBtn label={skipLike && !np.canPrev ? 'Назад на 15 секунд' : 'Предыдущий'} onClick={np.prev} size={42}>
            {skipLike && !np.canPrev ? <Rewind size={18} /> : <SkipBack size={18} />}
          </IconBtn>
        )}
        <IconBtn label={np.playing ? 'Пауза' : 'Играть'} onClick={np.toggle} size={54} primary>
          {np.playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-0.5" />}
        </IconBtn>
        {(np.canNext || skipLike) && (
          <IconBtn label={skipLike && !np.canNext ? 'Вперёд на 30 секунд' : 'Следующий'} onClick={np.next} size={42}>
            {skipLike && !np.canNext ? <FastForward size={18} /> : <SkipForward size={18} />}
          </IconBtn>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between">
        {np.setRate && np.rate !== undefined ? (
          <button type="button" className="rounded-full px-3 py-1 text-[12px] font-semibold text-white/80 outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            style={{ background: 'rgba(255,255,255,0.1)' }} aria-label="Скорость"
            onClick={(e) => { e.stopPropagation(); const i = RATES.indexOf(np.rate ?? 1); np.setRate?.(RATES[(i + 1) % RATES.length]); }}>
            ×{np.rate}
          </button>
        ) : <span />}
        <button type="button" onClick={(e) => { e.stopPropagation(); np.open(); onClose(); }}
          className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold text-white/80 outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
          style={{ background: 'rgba(255,255,255,0.1)' }}>
          <ExternalLink size={13} /> Открыть
        </button>
      </div>
    </div>
  );
};

/* ── Раскрытая панель события ───────────────────────────────── */
const EventIcon = ({ e }: { e: IslandEvent }) => {
  if (e.kind === 'call') return <Phone size={18} />;
  if (e.kind === 'download') return <Download size={18} />;
  if (e.kind === 'message') return <MessageCircle size={18} />;
  if (e.kind === 'track') return <Music2 size={18} />;
  return <Bell size={18} />;
};

const EventPanel = ({ e, onClose }: { e: IslandEvent; onClose: () => void }) => (
  <div className="w-full px-4 pb-4 pt-4">
    <div className="flex items-start gap-3">
      <Cover src={e.cover} letter={e.letter} size={48} icon={<EventIcon e={e} />} />
      <div className="min-w-0 flex-1">
        {/* В раскрытом виде текст показывается целиком (до 4 строк), а не обрезается в одну: так читаются и тексты ошибок. */}
        <div className="line-clamp-4 break-words text-[15px] font-semibold text-white" translate={e.userText ? 'no' : undefined}>{e.title}</div>
        {e.body && <div className="mt-0.5 line-clamp-6 break-words text-[13px] text-white/60" translate={e.userText ? 'no' : undefined}>{e.body}</div>}
      </div>
      <IconBtn label="Закрыть" onClick={onClose} size={30}><X size={15} /></IconBtn>
    </div>
    <div className="mt-3 flex gap-2">
      {e.actions?.map((a) => (
        <button key={a.label} type="button" onClick={(ev) => { ev.stopPropagation(); a.run(); }}
          className="flex-1 rounded-full py-2 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
          style={a.primary ? { background: '#34d399', color: '#04130d' } : { background: 'rgba(255,255,255,0.1)', color: '#fff' }}>
          {a.label}
        </button>
      ))}
      {!e.actions && e.onOpen && (
        <button type="button" onClick={(ev) => { ev.stopPropagation(); e.onOpen?.(); onClose(); }}
          className="flex-1 rounded-full py-2 text-[13px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
          style={{ background: 'rgba(255,255,255,0.12)' }}>Открыть</button>
      )}
    </div>
  </div>
);

/* ── Панель Sky AI ──────────────────────────────────────────── */
const AiPanel = () => {
  const s = useAiSession();
  const [text, setText] = useState('');
  const listening = s.phase === 'listening' || s.phase === 'detected';
  return (
    <div className="w-full px-4 pb-4 pt-4" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(139,124,255,0.2)', color: ACCENT }}>
          <Sparkles size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-white">Sky AI</div>
          <div className="text-[12px] text-white/55">{s.phase === 'error' ? s.error : PHASE_TEXT[s.phase]}</div>
        </div>
        <IconBtn label="Завершить" onClick={() => useAiSession.getState().stop()} size={30}><X size={15} /></IconBtn>
      </div>

      {listening && !s.textMode && <div className="mt-3 flex justify-center"><MicWave level={s.level} bars={26} height={30} /></div>}
      {s.heard && <div className="mt-3 rounded-xl px-3 py-2 text-[13px] text-white/80" style={{ background: 'rgba(255,255,255,0.07)' }} translate="no">{s.heard}</div>}
      {s.answer && <div className="mt-2 max-h-40 overflow-auto text-[13px] leading-relaxed text-white" translate="no">{s.answer}</div>}
      {s.phase === 'processing' && <div className="mt-3 flex justify-center gap-1" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="island-dot" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>}

      {s.phase === 'confirm' && (
        <div className="mt-3">
          <div className="text-[13px] text-white/80">{s.confirmLabel}</div>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => s.answerConfirm(true)} className="flex-1 rounded-full py-2 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-violet-300" style={{ background: '#fff', color: '#0b0b14' }}>Да</button>
            <button type="button" onClick={() => s.answerConfirm(false)} className="flex-1 rounded-full py-2 text-[13px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-violet-300" style={{ background: 'rgba(255,255,255,0.12)' }}>Нет</button>
          </div>
        </div>
      )}

      {s.textMode && s.phase !== 'confirm' && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) { setText(''); s.submitText(t); } }}>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="Сообщение для Sky AI" placeholder="Напишите…"
            className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2 text-[13px] text-white outline-none placeholder:text-white/35 focus-visible:ring-2 focus-visible:ring-violet-300" />
          <IconBtn label="Отправить" onClick={() => { const t = text.trim(); if (t) { setText(''); s.submitText(t); } }} primary><Send size={16} /></IconBtn>
        </form>
      )}

      {s.phase !== 'confirm' && (
        <div className="mt-3 flex items-center justify-center gap-3">
          {(listening || s.phase === 'speaking') && !s.textMode && (
            <IconBtn label={listening ? 'Выключить микрофон' : 'Остановить ответ'} onClick={() => s.interrupt()}><Square size={15} fill="currentColor" /></IconBtn>
          )}
          {s.textMode
            ? <IconBtn label="Говорить" onClick={() => s.setTextMode(false)}><Mic size={16} /></IconBtn>
            : <IconBtn label="Писать текстом" onClick={() => s.setTextMode(true)}><Keyboard size={16} /></IconBtn>}
          {!s.textMode && s.phase === 'followup' && <IconBtn label="Слушать" onClick={() => s.setTextMode(false)} primary><Mic size={16} /></IconBtn>}
        </div>
      )}
    </div>
  );
};

/* ── Сама капсула ───────────────────────────────────────────── */
type View = 'hidden' | 'ai' | 'event' | 'media';

export const SkyIsland = () => {
  const mode = useSettings((s) => s.settings.islandMode);
  const animOn = useSettings((s) => s.settings.animationsOn);
  const simpleAnim = useSettings((s) => s.settings.islandAnim === 'simple');
  const manualAi = useSettings((s) => s.settings.aiManualCall);
  const reduced = useReducedMotion();
  const calm = reduced || simpleAnim || !animOn;

  const { current, expanded, holding } = useIslandStore();
  const np = useNowPlaying();
  const ai = useAiSession();
  const wake = useWake((s) => s.state);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaShown, setMediaShown] = useState(true);
  /* Крестик: капсулу этого трека убрали — вернётся с новым треком/выпуском. */
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { useIslandStore.setState({ mounted: true }); return () => useIslandStore.setState({ mounted: false }); }, []);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Пауза дольше 8 секунд прячет капсулу, если рядом есть боковой плеер. */
  useEffect(() => {
    if (np?.playing) { setMediaShown(true); return undefined; }
    if (mode !== 'both') { setMediaShown(true); return undefined; }
    const t = setTimeout(() => { setMediaShown(false); setMediaOpen(false); }, 8000);
    return () => clearTimeout(t);
  }, [np?.playing, np?.key, mode]);

  const enabled = mode !== 'side';
  const view: View = !enabled ? 'hidden'
    : current?.kind === 'call' ? 'event'
      : current?.kind === 'ai' || ai.phase !== 'off' ? 'ai'
        : current ? 'event'
          : np && mediaShown && closedKey !== np.key ? 'media' : 'hidden';

  const open = view === 'media' ? mediaOpen : expanded || view === 'ai';

  /* Пока капсула на экране, оболочки сдвигают содержимое вниз на её высоту (--island-pad), чтобы она не закрывала кнопки. */
  useEffect(() => {
    document.documentElement.style.setProperty('--island-pad', view === 'hidden' ? '0px' : '52px');
  }, [view]);
  useEffect(() => () => { document.documentElement.style.setProperty('--island-pad', '0px'); }, []);

  /* Таймер события: стоит, пока человек взаимодействует или панель раскрыта. */
  const left = useRef<{ id: string; ms: number } | null>(null);
  useEffect(() => {
    if (!current || current.ttl === 0 || holding || expanded) return undefined;
    if (left.current?.id !== current.id) left.current = { id: current.id, ms: current.ttl };
    const started = Date.now();
    const t = setTimeout(() => useIslandStore.getState().dismiss(current.id), left.current.ms);
    return () => { clearTimeout(t); if (left.current) left.current.ms = Math.max(400, left.current.ms - (Date.now() - started)); };
  }, [current, holding, expanded]);

  /* Раскрытую панель не закрываем посреди действий: только после тишины. */
  const touch = () => {
    if (idle.current) clearTimeout(idle.current);
    if (!open || view === 'ai' || current?.kind === 'call') return;
    idle.current = setTimeout(() => {
      if (view === 'media') setMediaOpen(false);
      else useIslandStore.getState().dismiss(current?.id);
    }, view === 'media' ? 10_000 : 8000);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { touch(); return () => { if (idle.current) clearTimeout(idle.current); }; }, [open, view, current?.id]);

  /* Нажатие вне капсулы и Esc сворачивают. */
  useEffect(() => {
    if (!open || view === 'ai' || current?.kind === 'call') return undefined;
    const down = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      if (view === 'media') setMediaOpen(false); else useIslandStore.getState().setExpanded(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (view === 'media') setMediaOpen(false); else useIslandStore.getState().setExpanded(false); } };
    document.addEventListener('pointerdown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [open, view, current?.kind]);

  const spring = calm ? { duration: 0.16 } : { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.9 };
  const closePanel = () => { if (view === 'media') setMediaOpen(false); else useIslandStore.getState().dismiss(current?.id); };

  const compact = useMemo(() => {
    if (view === 'ai') {
      return (
        <div className="flex items-center gap-2.5 px-3" style={{ height: 38 }}>
          <Sparkles size={15} style={{ color: ACCENT }} />
          <span className="text-[12px] font-semibold text-white">{PHASE_TEXT[ai.phase] || 'Sky AI'}</span>
          {(ai.phase === 'listening' || ai.phase === 'detected') ? <MicWave level={ai.level} bars={10} height={16} /> : null}
        </div>
      );
    }
    if (view === 'event' && current) {
      return (
        <div className="flex items-center gap-2.5 pl-2 pr-3" style={{ height: 38 }}>
          <Cover src={current.cover} letter={current.letter} size={26} icon={<EventIcon e={current} />} />
          <span className="max-w-[190px] truncate text-[12px] font-semibold text-white" translate={current.userText ? 'no' : undefined}>{current.title}</span>
          {current.kind === 'call' && <span className="island-ring h-2 w-2 rounded-full" style={{ background: '#34d399' }} aria-hidden />}
          {(current.count ?? 1) > 1 && <span className="rounded-full px-1.5 text-[10px] font-bold text-white" style={{ background: ACCENT }} translate="no">{current.count}</span>}
        </div>
      );
    }
    if (view === 'media' && np) {
      return (
        <div className="flex items-center gap-2.5 pl-2 pr-3" style={{ height: 38 }}>
          <Cover src={np.cover} size={26} icon={<Music2 size={13} />} />
          <span className="max-w-[150px] truncate text-[12px] font-medium text-white/85" translate="no">{np.title}</span>
          <Eq active={np.playing} animate={!calm} />
        </div>
      );
    }
    return null;
  }, [view, current, np, ai.phase, ai.level, calm]);

  const label = view === 'ai' ? 'Sky AI' : view === 'event' ? (current?.title ?? 'Уведомление') : np?.title ?? 'Плеер';
  const toggleOpen = () => {
    if (view === 'media') setMediaOpen((v) => !v);
    else if (view === 'event') useIslandStore.getState().setExpanded(!expanded);
  };

  return (
    <>
      <style>{`
        @keyframes island-eq{from{height:4px}to{height:14px}}
        @keyframes island-dot{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
        @keyframes island-ring{0%{box-shadow:0 0 0 0 rgba(52,211,153,.7)}100%{box-shadow:0 0 0 8px rgba(52,211,153,0)}}
        .island-dot{width:6px;height:6px;border-radius:9999px;background:#fff;animation:island-dot .9s ease-in-out infinite}
        .island-ring{animation:island-ring 1.2s ease-out infinite}
        .island-range{-webkit-appearance:none;appearance:none;height:4px;border-radius:9999px;outline:none;
          background:linear-gradient(to right,#fff var(--p),rgba(255,255,255,.2) var(--p))}
        .island-range::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:9999px;background:#fff}
        .island-range::-moz-range-thumb{width:12px;height:12px;border:0;border-radius:9999px;background:#fff}
        .island-range:focus-visible{box-shadow:0 0 0 3px rgba(139,124,255,.6)}
        @media (prefers-reduced-motion: reduce){.island-dot,.island-ring{animation:none}}
      `}</style>

      {/* Индикатор: микрофон слушает фразу-активатор. Не перехватывает клики. */}
      {wake === 'listening' && view === 'hidden' && (
        <div className="pointer-events-none fixed left-1/2 z-[10000] -translate-x-1/2" aria-hidden
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 3px)' }}>
          <span className="block h-[5px] w-[5px] rounded-full" style={{ background: ACCENT, opacity: 0.8 }} />
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 z-[10000] flex justify-center"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
        <AnimatePresence>
          {view !== 'hidden' && (
            <motion.div
              ref={rootRef}
              key="island"
              layout={!calm}
              initial={calm ? { opacity: 0 } : { opacity: 0, y: -24, scale: 0.8 }}
              animate={calm ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={calm ? { opacity: 0 } : { opacity: 0, y: -20, scale: 0.8 }}
              transition={spring}
              role={current?.kind === 'call' ? 'alert' : 'status'}
              aria-live={current?.kind === 'call' ? 'assertive' : 'polite'}
              onPointerEnter={() => useIslandStore.getState().setHolding(true)}
              onPointerLeave={() => useIslandStore.getState().setHolding(false)}
              onFocus={() => useIslandStore.getState().setHolding(true)}
              onBlur={() => useIslandStore.getState().setHolding(false)}
              onPointerDown={touch}
              onKeyDown={touch}
              className="pointer-events-auto overflow-hidden text-white"
              style={{
                width: open ? 'min(94vw, 400px)' : 'auto', maxWidth: '94vw',
                borderRadius: open ? 36 : 22, background: SURFACE, border: `1px solid ${EDGE}`,
                boxShadow: '0 10px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
                backdropFilter: 'blur(22px) saturate(1.4)', WebkitBackdropFilter: 'blur(22px) saturate(1.4)',
              }}
              data-keep-dark
              data-sky-island={view}
            >
              {!open ? (
                <div className="flex items-center">
                  <button type="button" onClick={toggleOpen} aria-label={label} aria-expanded={false}
                    className="block cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                    style={{ borderRadius: 22 }}>
                    {compact}
                  </button>
                  {current?.kind !== 'call' && (
                    <button type="button" aria-label="Убрать" onClick={() => {
                      if (view === 'media' && np) { setClosedKey(np.key); setMediaOpen(false); }
                      else if (view === 'ai') useAiSession.getState().stop();
                      else useIslandStore.getState().dismiss(current?.id);
                    }} className="mr-1.5 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                      style={{ background: 'rgba(255,255,255,0.12)' }}>
                      <X size={13} />
                    </button>
                  )}
                </div>
              ) : view === 'ai' ? <AiPanel />
                : view === 'event' && current ? <EventPanel e={current} onClose={closePanel} />
                  : np ? <MediaPanel np={np} onClose={closePanel} /> : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* Ручная кнопка вызова Sky AI живёт в Настройках/быстром меню: остров по умолчанию скрыт. */}
      {manualAi && null}
    </>
  );
};
