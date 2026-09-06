import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  ChevronUp, X, Music2, Mic2, Video, Radio, Mic,
  List, AlignLeft, Bookmark,
} from 'lucide-react';
import { usePlayerStore, type MediaKind, type LyricLine, type Chapter } from './playerStore';
import { useIsMobile } from '@/interface/mobile/useIsMobile';

/* ── helpers ───────────────────────────────────────────────────────────────── */
const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${ss}`;
};

const kindIcon = (k?: MediaKind, sz = 14) => {
  const style = { flexShrink: 0 as const };
  switch (k) {
    case 'podcast': return <Mic2 size={sz} style={style} />;
    case 'video':   return <Video size={sz} style={style} />;
    case 'tv':      return <Radio size={sz} style={style} />;
    case 'voice':   return <Mic size={sz} style={style} />;
    default:        return <Music2 size={sz} style={style} />;
  }
};

const gradOf = (hue?: number, color?: string) => {
  if (color) return color;
  const h = hue ?? 245;
  return `linear-gradient(135deg, hsl(${h},65%,32%), hsl(${(h + 45) % 360},55%,22%))`;
};

const accentOf = (hue?: number) => `hsl(${hue ?? 245},70%,55%)`;

/* ── Cover art ─────────────────────────────────────────────────────────────── */
const CoverArt = ({
  item, size, radius = 12, spinning = false,
}: {
  item: NonNullable<ReturnType<typeof usePlayerStore>['item']>;
  size: number; radius?: number; spinning?: boolean;
}) => {
  const grad = gradOf(item.hue, item.kind === 'music' ? undefined : item.color);
  return (
    <div
      className="shrink-0 overflow-hidden relative"
      style={{
        width: size, height: size, borderRadius: radius,
        background: grad,
        boxShadow: `0 4px 24px ${accentOf(item.hue)}40`,
        animation: spinning ? 'skyVinyl 8s linear infinite' : 'none',
      }}>
      {item.coverUrl
        ? <img src={item.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        : (
          <div className="absolute inset-0 grid place-items-center" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {kindIcon(item.kind, size * 0.38)}
          </div>
        )
      }
    </div>
  );
};

/* ── Progress ring for collapsed ──────────────────────────────────────────── */
const ProgressRing = ({ pct, color, size = 52 }: { pct: number; color: string; size?: number }) => {
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg
      width={size} height={size}
      className="absolute inset-0 pointer-events-none"
      style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={2.5} />
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color}
        strokeWidth={2.5}
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - pct / 100)}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.4s linear' }} />
    </svg>
  );
};

/* ── Waveform visualiser (decorative) ─────────────────────────────────────── */
const Waveform = ({ playing, color }: { playing: boolean; color: string }) => (
  <div className="flex items-end gap-0.5" style={{ height: 14 }}>
    {[0.4, 0.7, 1, 0.6, 0.85, 0.5, 0.75].map((h, i) => (
      <motion.div key={i}
        style={{ width: 2, borderRadius: 2, background: color, originY: 1 }}
        animate={playing
          ? { scaleY: [h * 0.4, h, h * 0.3, h * 0.8, h * 0.2, h] }
          : { scaleY: 0.15 }}
        transition={{
          duration: 0.9 + i * 0.08,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: i * 0.07,
        }}
        initial={{ scaleY: 0.15, height: 14 }}
      />
    ))}
  </div>
);

/* ── Smart Context Panel content ──────────────────────────────────────────── */
const SmartContext = ({
  item, currentTime, color,
}: {
  item: NonNullable<ReturnType<typeof usePlayerStore>['item']>;
  currentTime: number;
  color: string;
}) => {
  if (item.kind === 'podcast' && item.chapters?.length) {
    const cur = [...item.chapters].reverse().find(c => currentTime >= c.t);
    return (
      <div className="space-y-1.5">
        <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.35)' }}>
          <Bookmark size={9} className="inline mr-1" />Главы
        </p>
        {item.chapters.map((ch, i) => {
          const active = ch === cur;
          return (
            <div key={i} className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full shrink-0"
                style={{ background: active ? color : 'rgba(255,255,255,0.2)' }} />
              <p className="text-[10px] truncate"
                style={{ color: active ? '#fff' : 'rgba(255,255,255,0.4)', fontWeight: active ? 700 : 400 }}>
                {ch.title}
              </p>
              <p className="text-[9px] ml-auto shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {fmtTime(ch.t)}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  if ((item.kind === 'music' || item.kind === 'podcast') && item.lyrics?.length) {
    const idx  = item.lyrics.reduce((best, l, i) => (l.t <= currentTime ? i : best), 0);
    const show = item.lyrics.slice(Math.max(0, idx - 1), idx + 4);
    return (
      <div className="space-y-1.5 text-center px-1">
        <p className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
          <AlignLeft size={9} className="inline mr-1" />Текст
        </p>
        {show.map((line, i) => {
          const active = item.lyrics![Math.max(0, idx - 1) + i] === item.lyrics![idx];
          return (
            <motion.p key={line.t}
              animate={{ opacity: active ? 1 : 0.3, scale: active ? 1 : 0.95 }}
              className="text-[11px] leading-snug"
              style={{ fontWeight: active ? 700 : 400, color: active ? '#fff' : 'rgba(255,255,255,0.45)' }}>
              {line.text}
            </motion.p>
          );
        })}
      </div>
    );
  }

  // Default: show nothing (the main player controls are enough)
  return null;
};

/* ── Volume slider ─────────────────────────────────────────────────────────── */
const VolumeSlider = ({ volume, onChange, color }: { volume: number; onChange: (v: number) => void; color: string }) => {
  const [hover, setHover] = useState(false);
  const isMobile = useIsMobile();
  return (
    <div className="flex items-center gap-2">
      <button type="button"
        onClick={() => onChange(volume > 0 ? 0 : 0.85)}
        className="shrink-0 grid h-6 w-6 place-items-center rounded-lg hover:bg-white/10"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}>
        {volume === 0 ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </button>
      <div className="relative flex-1 h-1 rounded-full cursor-pointer group"
        style={{ background: 'rgba(255,255,255,0.12)' }}
        onMouseEnter={() => { if (!isMobile) setHover(true); }}
        onMouseLeave={() => { if (!isMobile) setHover(false); }}
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          onChange(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
        }}>
        <div className="h-full rounded-full" style={{ width: volume * 100 + '%', background: color }} />
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-white"
          style={{ left: `calc(${volume * 100}% - 6px)`, background: color }}
          animate={{ scale: (isMobile || hover) ? 1 : 0 }}
          transition={{ duration: 0.12 }}
        />
      </div>
    </div>
  );
};

/* ── Main component ────────────────────────────────────────────────────────── */
export const SkyMiniPlayer = () => {
  const {
    item, isPlaying, currentTime, duration, volume,
    setPlaying, setVolume, requestSeek, nextTrack, prevTrack, clear, requestPlay,
  } = usePlayerStore();

  const [expanded, setExpanded] = useState(false);
  const [smartTab, setSmartTab] = useState<'context' | 'queue'>('context');
  const [idle,     setIdle]     = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // auto-idle after 4 seconds of no hover when expanded
  const resetIdle = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 4000);
  }, []);

  useEffect(() => {
    if (expanded) resetIdle();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [expanded]);

  // close expanded when item cleared
  useEffect(() => { if (!item) setExpanded(false); }, [item]);

  if (!item) return null;

  const pct     = duration > 0 ? (currentTime / duration) * 100 : 0;
  const accent  = accentOf(item.hue);
  const grad    = gradOf(item.hue, item.kind === 'music' ? undefined : item.color);
  const hasContext = (item.lyrics?.length ?? 0) > 0 || (item.chapters?.length ?? 0) > 0;
  const hasQueue   = (item.queue?.length ?? 0) > 1;

  return (
    <>
      {/* ── Collapsed pill (always visible) ───────────────── */}
      <AnimatePresence>
        {!expanded && (
          <motion.div
            initial={{ opacity: 0, scale: 0.7, y: 8 }}
            animate={{ opacity: 1, scale: 1,   y: 0 }}
            exit={{ opacity: 0, scale: 0.7, y: 8 }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            className="relative mx-auto cursor-pointer select-none"
            style={{ width: 46, height: 46 }}
            title={`${item.title} — ${item.author}`}
            onClick={() => setExpanded(true)}>

            {/* Progress ring */}
            <ProgressRing pct={pct} color={accent} size={46} />

            {/* Cover */}
            <div className="absolute inset-[3px] overflow-hidden rounded-[9px]"
              style={{ background: grad }}>
              {item.coverUrl
                ? <img src={item.coverUrl} alt="" className="w-full h-full object-cover" />
                : (
                  <div className="absolute inset-0 grid place-items-center"
                    style={{ color: 'rgba(255,255,255,0.5)' }}>
                    {kindIcon(item.kind, 16)}
                  </div>
                )
              }
              {/* Playing shimmer overlay */}
              {isPlaying && (
                <div className="absolute inset-0 rounded-[9px]"
                  style={{
                    background: `linear-gradient(135deg, transparent 30%, ${accent}20 100%)`,
                    animation: 'skyShimmerPlayer 2.5s ease-in-out infinite alternate',
                  }} />
              )}
            </div>

            {/* Play/Pause micro-button overlay */}
            <motion.div
              className="absolute inset-0 rounded-[12px] grid place-items-center opacity-0 hover:opacity-100"
              style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
              whileTap={{ scale: 0.9 }}
              onClick={e => { e.stopPropagation(); requestPlay(!isPlaying); }}>
              {isPlaying
                ? <Pause size={14} className="text-white" />
                : <Play  size={14} className="text-white" style={{ marginLeft: 1 }} />
              }
            </motion.div>

            {/* Kind badge */}
            <div className="absolute -bottom-0.5 -right-0.5 rounded-full grid place-items-center"
              style={{
                width: 14, height: 14,
                background: 'var(--bg)',
                boxShadow: '0 0 0 1.5px var(--border)',
                color: accent,
              }}>
              {kindIcon(item.kind, 8)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Expanded panel (portal-positioned to the right of sidebar) ─── */}
      <AnimatePresence>
        {expanded && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 z-[300]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}
              onClick={() => setExpanded(false)}
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, x: -16, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -16, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 480, damping: 36 }}
              onMouseMove={resetIdle}
              className="fixed z-[400] flex flex-col overflow-hidden"
              style={{
                left: 70,  // sidebar width (62) + 8px gap
                bottom: 16,
                width: 300,
                borderRadius: 20,
                background: 'rgba(14,14,20,0.96)',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: `0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px ${accent}20`,
                backdropFilter: 'blur(24px)',
              }}>

              {/* ── Hero area ───────────────────────────────────── */}
              <div className="relative overflow-hidden shrink-0" style={{ height: 100 }}>
                {/* Blurred BG */}
                <div className="absolute inset-0"
                  style={{ background: grad, filter: 'blur(0px)' }} />
                <div className="absolute inset-0"
                  style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(14,14,20,0.9) 100%)' }} />

                {/* Cover in hero */}
                <div className="absolute left-4 bottom-4">
                  <CoverArt item={item} size={64} radius={14}
                    spinning={item.kind === 'music' && isPlaying} />
                </div>

                {/* Title/author */}
                <div className="absolute left-[84px] bottom-4 right-10 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span style={{ color: accent }}>{kindIcon(item.kind, 10)}</span>
                    <p className="text-[9px] font-bold uppercase tracking-widest truncate"
                      style={{ color: 'rgba(255,255,255,0.45)' }}>
                      {item.kind === 'music' ? 'Музыка' : item.kind === 'podcast' ? 'Подкаст' : item.kind === 'tv' ? 'ТВ' : item.kind === 'video' ? 'Видео' : 'Голосовое'}
                    </p>
                  </div>
                  <p className="text-[13px] font-bold text-white truncate leading-tight">{item.title}</p>
                  <p className="text-[10px] truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{item.author}</p>
                </div>

                {/* Close */}
                <button type="button"
                  onClick={() => setExpanded(false)}
                  className="absolute top-3 right-3 grid h-7 w-7 place-items-center rounded-full hover:bg-white/15"
                  style={{ background: 'rgba(255,255,255,0.08)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.6)' }}>
                  <ChevronUp size={14} />
                </button>
              </div>

              {/* ── Controls ────────────────────────────────────── */}
              <div className="px-4 pt-3 pb-2 shrink-0">
                {/* Progress bar */}
                <div className="mb-2">
                  <div
                    className="h-1 rounded-full cursor-pointer relative group"
                    style={{ background: 'rgba(255,255,255,0.12)' }}
                    onClick={e => {
                      const r = e.currentTarget.getBoundingClientRect();
                      requestSeek(((e.clientX - r.left) / r.width) * duration);
                    }}>
                    <motion.div
                      className="h-full rounded-full"
                      style={{ width: pct + '%', background: `linear-gradient(90deg, ${accent}, ${accent}cc)` }}
                      transition={{ duration: 0.3, ease: 'linear' }}
                    />
                    <motion.div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                      style={{ left: `calc(${pct}% - 6px)`, background: '#fff', boxShadow: `0 0 8px ${accent}` }}
                      transition={{ duration: 0.12 }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] tabular-nums" style={{ color: 'rgba(255,255,255,0.35)' }}>{fmtTime(currentTime)}</span>
                    <span className="text-[9px] tabular-nums" style={{ color: 'rgba(255,255,255,0.35)' }}>{duration > 0 ? fmtTime(duration) : '--:--'}</span>
                  </div>
                </div>

                {/* Main transport */}
                <div className="flex items-center justify-between">
                  <motion.button whileTap={{ scale: 0.82 }} type="button"
                    onClick={prevTrack}
                    className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.55)' }}>
                    <SkipBack size={16} />
                  </motion.button>

                  <motion.button whileTap={{ scale: 0.88 }} type="button"
                    onClick={() => requestPlay(!isPlaying)}
                    className="grid h-11 w-11 place-items-center rounded-full"
                    style={{
                      background: accent,
                      border: 'none', cursor: 'pointer',
                      boxShadow: `0 4px 20px ${accent}60`,
                    }}>
                    {isPlaying
                      ? <Pause size={18} className="text-white" />
                      : <Play  size={18} className="text-white" style={{ marginLeft: 1 }} />
                    }
                  </motion.button>

                  <motion.button whileTap={{ scale: 0.82 }} type="button"
                    onClick={nextTrack}
                    className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.55)' }}>
                    <SkipForward size={16} />
                  </motion.button>

                  {/* Waveform */}
                  <div style={{ color: accent }}>
                    <Waveform playing={isPlaying} color={accent} />
                  </div>
                </div>

                {/* Volume */}
                <div className="mt-2.5">
                  <VolumeSlider volume={volume} onChange={setVolume} color={accent} />
                </div>
              </div>

              {/* ── Smart context tabs ───────────────────────────── */}
              {(hasContext || hasQueue) && (
                <>
                  <div className="flex gap-1 px-4 pb-1 shrink-0">
                    {hasContext && (
                      <button type="button"
                        onClick={() => setSmartTab('context')}
                        className="rounded-lg px-2.5 py-1 text-[10px] font-bold"
                        style={{
                          background: smartTab === 'context' ? `${accent}22` : 'transparent',
                          color: smartTab === 'context' ? accent : 'rgba(255,255,255,0.3)',
                          border: `1px solid ${smartTab === 'context' ? `${accent}44` : 'transparent'}`,
                          cursor: 'pointer',
                        }}>
                        {item.kind === 'podcast' ? '📑 Главы' : '🎵 Текст'}
                      </button>
                    )}
                    {hasQueue && (
                      <button type="button"
                        onClick={() => setSmartTab('queue')}
                        className="rounded-lg px-2.5 py-1 text-[10px] font-bold flex items-center gap-1"
                        style={{
                          background: smartTab === 'queue' ? `${accent}22` : 'transparent',
                          color: smartTab === 'queue' ? accent : 'rgba(255,255,255,0.3)',
                          border: `1px solid ${smartTab === 'queue' ? `${accent}44` : 'transparent'}`,
                          cursor: 'pointer',
                        }}>
                        <List size={10} />Очередь
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0" style={{ maxHeight: 120, scrollbarWidth: 'none' }}>
                    {smartTab === 'context' && hasContext && (
                      <SmartContext item={item} currentTime={currentTime} color={accent} />
                    )}
                    {smartTab === 'queue' && hasQueue && item.queue && (
                      <div className="space-y-1">
                        {item.queue.map((t, i) => {
                          const active = i === (item.qIdx ?? 0);
                          return (
                            <div key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                              style={{ background: active ? `${accent}15` : 'transparent' }}>
                              {active && <div className="w-1 h-1 rounded-full shrink-0" style={{ background: accent }} />}
                              {!active && <div className="w-1 h-1 rounded-full shrink-0" style={{ background: 'rgba(255,255,255,0.15)' }} />}
                              <p className="text-[10px] flex-1 truncate"
                                style={{ color: active ? '#fff' : 'rgba(255,255,255,0.45)', fontWeight: active ? 700 : 400 }}>
                                {t.title}
                              </p>
                              <p className="text-[9px] shrink-0" style={{ color: 'rgba(255,255,255,0.25)' }}>
                                {t.author}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Bottom padding when no context */}
              {!hasContext && !hasQueue && <div className="pb-2" />}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Keyframe styles */}
      <style>{`
        @keyframes skyVinyl {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes skyShimmerPlayer {
          from { opacity: 0.4; }
          to   { opacity: 0.9; }
        }
      `}</style>
    </>
  );
};
