/**
 * Карточка «Мой поток» на главной Sky Music — по образцу экрана «Моя волна».
 *
 *  • тихо / ничего не играло: чёрный фон, спокойная светящаяся волна, крупное «Мой поток», жёлтая кнопка пуска;
 *  • играет: фон розовеет, волна движется в такт музыке, от карточки расходятся лучи света, имя исполнителя
 *    большим жирным текстом на всю ширину, ниже обложка и мини-плеер (пауза, название с полосой хода, «в избранное»);
 *  • пауза или недослушанный трек: волна снова спокойная, те же данные, пуск — жёлтая кнопка на месте обложки.
 * Фото исполнителя на прозрачном фоне (его загружает владелец карточки исполнителя) ложится поверх имени.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Heart, Pause, Play, Sparkles } from 'lucide-react';
import type { Track } from '@/platform/store';
import { usePlayerStore } from '@/player/playerStore';
import { subscribeAudioLevels } from '@/music/audioLevels';
import { useCardImage } from '@/artists/CardImages';
import { Music2 } from 'lucide-react';

const YELLOW = '#ffe500';

/* Пятна волны: центр (доли ширины/высоты), размер (доля ширины), цвет, частоты и фаза. */
const BLOBS = [
  { x: 0.50, y: 0.40, s: 1.10, c: '#7a1fff', fx: 0.4, fy: 0.5, ph: 5.2, a: 0.55 },
  { x: 0.64, y: 0.28, s: 0.50, c: '#ff1ff0', fx: 0.6, fy: 1.1, ph: 1.7 },
  { x: 0.30, y: 0.26, s: 0.46, c: '#ff1a3c', fx: 1.0, fy: 0.5, ph: 3.1 },
  { x: 0.42, y: 0.66, s: 0.44, c: '#ff9a00', fx: 0.7, fy: 0.9, ph: 4.4 },
  { x: 0.50, y: 0.42, s: 0.78, c: YELLOW,    fx: 0.9, fy: 0.7, ph: 0.0 },
];

/** Волна: спокойная в тишине, живая при музыке. Позиции считаются в кадре анимации и пишутся прямо в стили — без перерисовок React. */
const Wave = ({ active }: { active: boolean }) => {
  const box = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const target = useRef({ active, level: 0, beat: 0 });
  target.current.active = active;
  useEffect(() => {
    if (!active) { target.current.level = 0; target.current.beat = 0; return undefined; }
    return subscribeAudioLevels((l) => { target.current.level = l.level; target.current.beat = l.beat; });
  }, [active]);
  useEffect(() => {
    let raf = 0; let last = performance.now(); let phase = 0; let speed = 0.16; let amp = 0.03; let pulse = 0;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = target.current;
      const wantSpeed = t.active ? 0.55 + t.level * 1.8 : 0.16;
      const wantAmp = t.active ? 0.10 + t.beat * 0.07 : 0.03;
      const wantPulse = t.active ? t.level * 0.14 + t.beat * 0.08 : 0;
      speed += (wantSpeed - speed) * Math.min(1, dt * 2.2);
      amp += (wantAmp - amp) * Math.min(1, dt * 2.2);
      pulse += (wantPulse - pulse) * Math.min(1, dt * 6);
      if (!reduce) phase += dt * speed;
      const W = box.current?.clientWidth ?? 0; const H = box.current?.clientHeight ?? 0;
      BLOBS.forEach((b, i) => {
        const el = els.current[i]; if (!el) return;
        const px = (b.x + Math.sin(phase * b.fx * 2 + b.ph) * amp * 1.4) * W;
        const py = (b.y + Math.cos(phase * b.fy * 2 + b.ph) * amp) * H;
        const size = b.s * W * (1 + pulse);
        el.style.transform = `translate(${px - size / 2}px, ${py - size / 2}px)`;
        el.style.width = el.style.height = `${size}px`;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={box} className="absolute inset-0 overflow-hidden" aria-hidden>
      {/* Розовый фон проявляется, когда музыка играет. */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,#ff2476 0%,#d3135f 38%,#5a0f45 72%,#1b0220 100%)', opacity: active ? 1 : 0, transition: 'opacity 1s ease' }} />
      <div className="absolute inset-0" style={{ filter: 'blur(26px) saturate(1.15)' }}>
        {BLOBS.map((b, i) => (
          <div key={i} ref={(el) => { els.current[i] = el; }} className="absolute left-0 top-0 rounded-full" style={{
            background: `radial-gradient(circle, ${b.c} 0%, ${b.c} 34%, transparent 70%)`, opacity: b.a ?? 1, willChange: 'transform',
          }} />
        ))}
      </div>
    </div>
  );
};

/** Лучи света вокруг карточки: вращаются и пульсируют в такт музыке (видны за краями карточки). */
const Rays = ({ on }: { on: boolean }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on) return undefined;
    return subscribeAudioLevels((l) => { ref.current?.style.setProperty('--lvl', String(Math.min(1, l.level * 1.6 + l.beat * 0.5))); });
  }, [on]);
  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute" style={{
      inset: -40, zIndex: 0, opacity: on ? 1 : 0, transition: 'opacity .8s ease', ['--lvl' as string]: 0.35,
      WebkitMaskImage: 'radial-gradient(circle, #000 30%, transparent 72%)', maskImage: 'radial-gradient(circle, #000 30%, transparent 72%)',
    }}>
      <div className="sky-flow-rays absolute" style={{
        inset: '-30% -10%', borderRadius: '50%', filter: 'blur(5px)',
        background: `repeating-conic-gradient(from 0deg, ${YELLOW}cc 0deg 2.2deg, transparent 2.2deg 11deg), repeating-conic-gradient(from 5deg, #ff1ff0aa 0deg 1.2deg, transparent 1.2deg 17deg)`,
        opacity: 'calc(0.35 + var(--lvl) * 0.65)' as unknown as number,
      }} />
    </div>
  );
};

/** Имя крупным шрифтом в одну строку. Не влезает — само плавно ездит туда-обратно (при «уменьшить анимацию» просто обрезается). */
const MarqueeName = ({ text, size }: { text: string; size: number }) => {
  const wrap = useRef<HTMLDivElement>(null); const span = useRef<HTMLSpanElement>(null); const [dx, setDx] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const w = wrap.current?.clientWidth ?? 0; const m = span.current?.scrollWidth ?? 0;
      setDx(m > w + 2 ? m - w : 0);
    };
    measure();
    void document.fonts?.ready.then(measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (wrap.current) ro?.observe(wrap.current);
    return () => ro?.disconnect();
  }, [text, size]);
  return (
    <div ref={wrap} className="w-full overflow-hidden" style={{ textAlign: dx ? 'left' : 'center' }}>
      <span ref={span} translate="no" className={`inline-block whitespace-nowrap font-black text-white ${dx ? 'sky-flow-marquee' : ''}`}
        style={{ fontSize: size, lineHeight: 1.08, letterSpacing: '-0.035em', textShadow: '0 2px 24px rgba(0,0,0,0.25)',
          ['--dx' as string]: `${-dx}px`, ['--dur' as string]: `${Math.max(5, dx / 28 + 3)}s` }}>{text}</span>
    </div>
  );
};

export const FlowHero = ({ cur, last, playing, liked, onStart, onToggle, onLike, onOpenPlayer, onOpenWave }: {
  cur: Track | null;          // трек в плеере (играет или на паузе)
  last: Track | null;         // недослушанный трек прошлого раза, когда плеер пуст
  playing: boolean;
  liked: boolean;
  onStart: () => void;        // запустить поток
  onToggle: () => void;       // пуск/пауза текущего (или запуск недослушанного)
  onLike: () => void;
  onOpenPlayer: () => void;   // открыть полноэкранный плеер
  onOpenWave: () => void;     // открыть подборку «Мой поток»
}) => {
  const t = cur ?? last;
  const isPlaying = Boolean(cur) && playing;
  const cutout = useCardImage(t?.cutoutCardId ?? '', 'cutout', Boolean(t?.cutoutCardId));
  const time = usePlayerStore((s) => s.currentTime); const dur = usePlayerStore((s) => s.duration);
  const pct = cur && dur > 0 ? Math.max(0, Math.min(100, (time / dur) * 100)) : 0;
  const open = () => (t ? onOpenPlayer() : onOpenWave());
  const stop = (fn: () => void) => (e: React.SyntheticEvent) => { e.stopPropagation(); fn(); };
  const PANEL = 64;

  return (
    <div className="relative" style={{ height: 340 }}>
      <style>{`@keyframes skyFlowSpin{to{transform:rotate(360deg)}} .sky-flow-rays{animation:skyFlowSpin 38s linear infinite}
        @keyframes skyFlowMarquee{0%,12%{transform:translateX(0)}88%,100%{transform:translateX(var(--dx))}} .sky-flow-marquee{animation:skyFlowMarquee var(--dur) ease-in-out infinite alternate}
        @media (prefers-reduced-motion: reduce){.sky-flow-rays,.sky-flow-marquee{animation:none}}`}</style>
      <Rays on={isPlaying} />
      <div role="button" tabIndex={0} onClick={open} aria-label={t ? 'Открыть плеер' : 'Мой поток — открыть подборку'}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        className="absolute inset-0 cursor-pointer overflow-hidden rounded-[30px]" style={{ background: '#000', zIndex: 1 }}>
        <Wave active={isPlaying} />
        <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 36%)' }} />

        {/* Шапка: значок · «Мои любимые» (пока играет песня) · «Мой поток». */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-3.5" style={{ zIndex: 6 }}>
          <Sparkles size={20} color="rgba(255,255,255,0.9)" />
          <span className="rounded-full px-4 py-1.5 text-[13px] font-extrabold" style={{ background: 'rgba(60,0,30,0.45)', color: YELLOW, backdropFilter: 'blur(10px)' }}>
            {isPlaying ? 'Мои любимые' : 'Моя волна'}
          </span>
          {t ? (
            <button type="button" onClick={stop(onOpenWave)} className="rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', backdropFilter: 'blur(10px)' }}>Мой поток</button>
          ) : <span className="w-6" />}
        </div>

        {/* Имя исполнителя (или «Мой поток») — крупно и жирно на всю ширину; длинное само листается. */}
        <div className="absolute inset-x-4" style={{ top: 66, zIndex: 2 }}>
          <MarqueeName text={t ? (t.artist || 'Исполнитель') : 'Мой поток'} size={68} />
          {!t && <p className="mt-1 text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.8)' }}>Подобрано специально для тебя</p>}
        </div>

        {/* Фото исполнителя на прозрачном фоне — поверх имени, стоит на панели у правого края. */}
        {cutout && <img src={cutout} alt="" draggable={false} className="pointer-events-none absolute" style={{
          right: 6, bottom: t ? PANEL : 0, height: '68%', maxWidth: '52%', objectFit: 'contain', objectPosition: 'bottom right', zIndex: 3,
          filter: 'drop-shadow(0 8px 18px rgba(0,0,0,0.45))',
        }} />}

        {/* Тишина или пауза — жёлтая кнопка пуска по центру. */}
        {!isPlaying && (
          <div className="absolute inset-x-0 flex justify-center" style={{ top: t ? 150 : 140, zIndex: 4 }}>
            <button type="button" onClick={stop(t ? onToggle : onStart)} aria-label={t ? 'Играть' : 'Включить поток'}
              className="grid h-[84px] w-[84px] place-items-center rounded-full" style={{ background: YELLOW, boxShadow: '0 10px 34px rgba(255,229,0,0.35)' }}>
              <Play size={30} fill="#111" color="#111" style={{ marginLeft: 4 }} />
            </button>
          </div>
        )}

        {t && (
          <>
            {/* Обложка («логотип песни») — в нижнем левом углу, над панелью. */}
            <span className="absolute grid h-[58px] w-[58px] place-items-center overflow-hidden rounded-[13px]"
              style={{ left: 14, bottom: PANEL + 10, zIndex: 5, background: '#1a1a22', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
              {t.coverUrl ? <img src={t.coverUrl} alt="" className="h-full w-full object-cover" /> : <Music2 size={22} color="rgba(255,255,255,0.4)" />}
            </span>

            {/* Мини-плеер — одна панель, прижатая к низу карточки (скругление даёт сама карточка). */}
            <div className="absolute inset-x-0 bottom-0 flex items-center overflow-hidden" onClick={(e) => e.stopPropagation()}
              style={{ height: PANEL, zIndex: 5, borderRadius: '26px 26px 0 0', background: isPlaying ? 'rgba(255,255,255,0.14)' : 'rgba(18,18,22,0.92)', backdropFilter: 'blur(16px)' }}>
              <span className="pointer-events-none absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: 'rgba(255,255,255,0.1)' }} />
              <button type="button" onClick={stop(onToggle)} aria-label={isPlaying ? 'Пауза' : 'Играть'} className="relative grid h-full w-16 shrink-0 place-items-center">
                {isPlaying ? <Pause size={20} fill="#fff" color="#fff" /> : <Play size={20} fill="#fff" color="#fff" style={{ marginLeft: 2 }} />}
              </button>
              <button type="button" onClick={stop(onOpenPlayer)} aria-label="Открыть плеер" className="relative min-w-0 flex-1 truncate text-center text-[14px] font-bold text-white">
                <span translate="no">{t.title}</span>
              </button>
              <button type="button" onClick={stop(onLike)} aria-label={liked ? 'Убрать из избранного' : 'В избранное'} aria-pressed={liked} className="relative grid h-full w-16 shrink-0 place-items-center">
                <Heart size={20} color={liked ? '#ff4d6d' : '#fff'} fill={liked ? '#ff4d6d' : '#fff'} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
