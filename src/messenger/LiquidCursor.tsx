/* ===============================================================
   LIQUID CURSOR + THEME PICKER
   Liquid glass effect following cursor in chat
=============================================================== */
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Palette, X } from 'lucide-react';
import { useChatTheme, THEMES, type ChatTheme, type ChatThemeId } from './themes';

/* === LIQUID GLASS CURSOR ==================================== */
interface LiquidCursorProps {
  containerRef: React.RefObject<HTMLElement>;
  color:        string;    // rgba color from theme.liquidColor
  enabled?:     boolean;
}

export const LiquidCursor = ({ containerRef, color, enabled = true }: LiquidCursorProps) => {
  const blobRef   = useRef<HTMLDivElement>(null);
  const glowRef   = useRef<HTMLDivElement>(null);
  const posRef    = useRef({ x: -200, y: -200 });
  const targetRef = useRef({ x: -200, y: -200 });
  const rafRef    = useRef<number>(0);
  const [visible, setVisible] = useState(false);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  const animate = useCallback(() => {
    const blob = blobRef.current;
    const glow = glowRef.current;
    if (!blob || !glow) return;

    posRef.current.x = lerp(posRef.current.x, targetRef.current.x, 0.12);
    posRef.current.y = lerp(posRef.current.y, targetRef.current.y, 0.12);

    blob.style.transform = `translate(${posRef.current.x}px, ${posRef.current.y}px) translate(-50%, -50%)`;
    glow.style.transform = `translate(${posRef.current.x}px, ${posRef.current.y}px) translate(-50%, -50%)`;

    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      targetRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };
    const onEnter = () => { setVisible(true);  rafRef.current = requestAnimationFrame(animate); };
    const onLeave = () => { setVisible(false); cancelAnimationFrame(rafRef.current); };

    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, animate, containerRef]);

  if (!enabled) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
      {/* Outer glow */}
      <div
        ref={glowRef}
        className="absolute rounded-full"
        style={{
          width: 200, height: 200,
          background: `radial-gradient(circle, ${color.replace(/[\d.]+\)$/, '0.15)')}, transparent 70%)`,
          filter: 'blur(20px)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.3s ease',
          willChange: 'transform',
          top: 0, left: 0,
        }}
      />
      {/* Inner blob  -  liquid glass */}
      <div
        ref={blobRef}
        className="absolute rounded-full"
        style={{
          width: 80, height: 80,
          background: `radial-gradient(circle at 35% 35%, ${color.replace(/[\d.]+\)$/, '0.9)')}, ${color.replace(/[\d.]+\)$/, '0.2)')})`,
          backdropFilter: 'blur(8px) saturate(160%)',
          WebkitBackdropFilter: 'blur(8px) saturate(160%)',
          border: `1px solid ${color.replace(/[\d.]+\)$/, '0.6)')}`,
          boxShadow: `0 0 20px ${color.replace(/[\d.]+\)$/, '0.4)')}, inset 0 1px 0 ${color.replace(/[\d.]+\)$/, '0.8)')}`,
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.25s ease',
          willChange: 'transform',
          top: 0, left: 0,
        }}
      />
    </div>
  );
};

/* === THEME PICKER =========================================== */
interface ThemePickerProps {
  chatId:  string;
  onClose: () => void;
}

export const ThemePicker = ({ chatId, onClose }: ThemePickerProps) => {
  const { chatThemes, globalTheme, setTheme, getTheme } = useChatTheme();
  const current = getTheme(chatId);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="w-full max-w-lg overflow-hidden"
        style={{ borderRadius: '24px 24px 0 0', background: '#121215', maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <Palette size={18} style={{ color: '#5b9bd1' }}/>
            <span className="text-base font-bold" style={{ color: '#ffffff' }}>Тема чата</span>
          </div>
          <button type="button" onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
            <X size={16} style={{ color: 'var(--t2)' }}/>
          </button>
        </div>

        {/* Theme grid */}
        <div className="overflow-y-auto p-5" style={{ scrollbarWidth: 'none' }}>
          <div className="grid grid-cols-5 gap-3">
            {THEMES.map(theme => {
              const isActive = current.id === theme.id;
              return (
                <button key={theme.id} type="button"
                  onClick={() => { setTheme(chatId, theme.id); onClose(); }}
                  className="flex flex-col items-center gap-2 group"
                >
                  {/* Preview swatch */}
                  <div className="relative w-full overflow-hidden transition-transform group-hover:scale-105"
                    style={{
                      borderRadius: 16,
                      aspectRatio: '1/1.4',
                      background: theme.bg,
                      border: isActive
                        ? `2.5px solid ${theme.accent}`
                        : '2px solid rgba(255,255,255,0.07)',
                      boxShadow: isActive ? `0 0 0 3px ${theme.accent}30` : 'none',
                    }}>
                    {/* Mini gradient overlay */}
                    <div className="absolute inset-0"
                      style={{
                        background: theme.bgImage && theme.bgImage !== 'none'
                          ? theme.bgImage
                          : undefined,
                        backgroundSize: theme.bgSize,
                      }}/>
                    {/* Mini bubbles */}
                    <div className="absolute inset-0 flex flex-col justify-end gap-1 px-1.5 pb-1.5 pt-3">
                      <div className="self-end rounded-lg px-1.5 py-0.5 text-[4px]"
                        style={{ background: theme.mine, color: theme.mineText, fontSize: 4, maxWidth: '70%' }}>
                        Привет!
                      </div>
                      <div className="self-start rounded-lg px-1.5 py-0.5 text-[4px]"
                        style={{ background: theme.other, color: theme.otherText, fontSize: 4, maxWidth: '70%' }}>
                        Как дела?
                      </div>
                    </div>
                    {/* Active checkmark */}
                    {isActive && (
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                        className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full"
                        style={{ background: theme.accent }}>
                        <Check size={11} className="text-white"/>
                      </motion.div>
                    )}
                    {/* Liquid cursor preview dot */}
                    <div className="absolute bottom-1.5 left-1.5 h-3 w-3 rounded-full"
                      style={{ background: theme.liquidColor, border: `1px solid ${theme.liquidColor.replace(/[\d.]+\)$/, '0.8)')}` }}/>
                  </div>
                  <span className="text-[10px] font-medium text-center"
                    style={{ color: isActive ? theme.accent : 'var(--t2)' }}>
                    {theme.name}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Info */}
          <div className="mt-5 rounded-2xl px-4 py-3 flex items-start gap-3"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <span className="text-base">💡</span>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--t2)' }}>
              Тема сохраняется для каждого чата отдельно.
              Кружок внизу  -  цвет эффекта жидкого стекла при наведении.
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
