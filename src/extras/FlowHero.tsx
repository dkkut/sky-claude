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
import { AlignLeft, Heart, Pause, Play, Sparkles } from 'lucide-react';
import type { Track } from '@/platform/store';
import { usePlayerStore } from '@/player/playerStore';
import { subscribeAudioLevels } from '@/music/audioLevels';
import { useCardImage } from '@/artists/CardImages';
import { Music2 } from 'lucide-react';
import { apiLyrics } from '@/music/musicApi';
import { parseTimedLyrics } from '@/music/lyrics';
import { FlowSheet } from './FlowSheet';

const ACCENT = '#e9d5ff';

/* Пятна волны: центр (доли ширины/высоты), размер (доля ширины), цвет, частоты и фаза. */
const BLOBS = [
  { x: 0.50, y: 0.40, s: 1.10, c: '#6d28d9', fx: 0.4, fy: 0.5, ph: 5.2, a: 0.65, hd: 17 },   // глубокий фиолетовый
  { x: 0.66, y: 0.28, s: 0.52, c: '#ff4fd8', fx: 0.6, fy: 1.1, ph: 1.7, hd: 11 },            // розовый
  { x: 0.28, y: 0.26, s: 0.48, c: '#3b82f6', fx: 1.0, fy: 0.5, ph: 3.1, hd: 13 },            // синий
  { x: 0.42, y: 0.68, s: 0.46, c: '#a855f7', fx: 0.7, fy: 0.9, ph: 4.4, hd: 9 },             // сиреневый
  { x: 0.52, y: 0.42, s: 0.78, c: '#8ec5ff', fx: 0.9, fy: 0.7, ph: 0.0, a: 0.8, hd: 15 },     // голубой
  { x: 0.76, y: 0.62, s: 0.40, c: '#f0abfc', fx: 0.5, fy: 0.8, ph: 2.4, a: 0.8, hd: 12 },    // светло-розовый
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
      <div className="sky-flow-hue absolute inset-0" style={{ background: 'linear-gradient(180deg,#c026d3 0%,#7c3aed 34%,#3730a3 66%,#0f0a2e 100%)', opacity: active ? 1 : 0, transition: 'opacity 1s ease', animationDuration: '19s' }} />
      <div className="absolute inset-0" style={{ filter: 'blur(26px) saturate(1.15)' }}>
        {BLOBS.map((b, i) => (
          <div key={i} ref={(el) => { els.current[i] = el; }} className="sky-flow-hue absolute left-0 top-0 rounded-full" style={{
            animationDuration: `${b.hd}s`, animationDelay: `${-b.ph * 2}s`,
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
        background: `repeating-conic-gradient(from 0deg, ${ACCENT}cc 0deg 2.2deg, transparent 2.2deg 11deg), repeating-conic-gradient(from 5deg, #38bdf8aa 0deg 1.2deg, transparent 1.2deg 17deg)`,
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
        style={{ fontSize: size, lineHeight: 1.08, letterSpacing: '-0.035em',
          ['--dx' as string]: `${-dx}px`, ['--dur' as string]: `${Math.max(5, dx / 28 + 3)}s` }}>{text}</span>
    </div>
  );
};

/** Текст песни в пустом месте карточки. С метками времени — три строки, текущая выделена; без меток — просто текст, листается. */
const LyricsBox = ({ trackId, time }: { trackId: string; time: number }) => {
  const [lines, setLines] = useState<{ t: number; text: string }[] | null>(null);
  useEffect(() => {
    let alive = true; setLines(null);
    void apiLyrics(trackId).then((r) => { if (alive) setLines(parseTimedLyrics(r?.lyrics ?? '')); });
    return () => { alive = false; };
  }, [trackId]);
  if (lines === null) return null;
  if (lines.length === 0) return <p className="text-[12.5px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>Текста этой песни нет</p>;
  const timed = lines.some((l) => l.t > 0);
  if (!timed) {
    return (
      <div translate="no" className="h-full overflow-y-auto pr-1 text-[13.5px] font-semibold leading-snug" style={{ color: 'rgba(255,255,255,0.94)', scrollbarWidth: 'none' }}>
        {lines.map((l, i) => <p key={i} className="mb-1">{l.text}</p>)}
      </div>
    );
  }
  const idx = lines.reduce((best, l, i) => (l.t <= time ? i : best), 0);
  const show = [idx - 1, idx, idx + 1].map((i) => (i >= 0 && i < lines.length ? { i, text: lines[i].text } : null));
  return (
    <div translate="no" className="flex h-full flex-col justify-center gap-1.5">
      {show.map((l, k) => (
        <p key={k} className="transition-all duration-300" style={{
          display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: k === 1 ? 2 : 1, overflow: 'hidden',
          fontSize: k === 1 ? 17 : 12.5, fontWeight: k === 1 ? 900 : 600, color: k === 1 ? '#fff' : 'rgba(255,255,255,0.72)', minHeight: k === 1 ? 24 : 18, lineHeight: 1.25,
        }}>{l ? l.text : '\u00a0'}</p>
      ))}
    </div>
  );
};

export const FlowHero = ({ cur, last, playing, liked, tracks, favorites, onPlayPool, onStart, onToggle, onLike, onOpenPlayer, onOpenWave }: {
  cur: Track | null;          // трек в плеере (играет или на паузе)
  last: Track | null;         // недослушанный трек прошлого раза, когда плеер пуст
  playing: boolean;
  liked: boolean;
  tracks: Track[]; favorites: string[];            // каталог и избранное — для окошка «Мои любимые»
  onPlayPool: (t: Track, pool: Track[]) => void;   // включить трек из подборки
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
  const [sheet, setSheet] = useState(false);
  const [lyrOn, setLyrOn] = useState(() => { try { return localStorage.getItem('sky:flow:lyrics') === '1'; } catch { return false; } });
  const toggleLyr = () => setLyrOn((v) => { const n = !v; try { localStorage.setItem('sky:flow:lyrics', n ? '1' : '0'); } catch { /* без хранилища — на этот сеанс */ } return n; });
  const showLyr = Boolean(t) && lyrOn;

  return (
    <div className="relative" style={{ height: 340 }}>
      <style>{`@keyframes skyFlowSpin{to{transform:rotate(360deg)}} @keyframes skyFlowHue{from{filter:hue-rotate(-34deg)}to{filter:hue-rotate(34deg)}} .sky-flow-hue{animation:skyFlowHue 14s ease-in-out infinite alternate} .sky-flow-rays{animation:skyFlowSpin 38s linear infinite}
        @keyframes skyFlowMarquee{0%,12%{transform:translateX(0)}88%,100%{transform:translateX(var(--dx))}} .sky-flow-marquee{animation:skyFlowMarquee var(--dur) ease-in-out infinite alternate}
        @media (prefers-reduced-motion: reduce){.sky-flow-rays,.sky-flow-marquee,.sky-flow-hue{animation:none}}`}</style>
      <Rays on={isPlaying} />
      <div role="button" tabIndex={0} onClick={open} aria-label={t ? 'Открыть плеер' : 'Мой поток — открыть подборку'}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        className="absolute inset-0 cursor-pointer overflow-hidden rounded-[30px]" style={{ background: '#000', zIndex: 1 }}>
        <Wave active={isPlaying} />
        <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 36%)' }} />

        {/* Шапка: значок · «Мои любимые» (пока играет песня) · «Мой поток». */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-3.5" style={{ zIndex: 6 }}>
          <Sparkles size={20} color="rgba(255,255,255,0.9)" />
          <button type="button" onClick={stop(() => setSheet(true))} aria-haspopup="dialog" className="rounded-full px-4 py-1.5 text-[13px] font-extrabold" style={{ background: 'rgba(30,10,70,0.5)', color: ACCENT, backdropFilter: 'blur(10px)' }}>
            {isPlaying ? 'Мои любимые' : 'Моя волна'}
          </button>
          {t ? (
            <button type="button" onClick={stop(onOpenWave)} className="rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', backdropFilter: 'blur(10px)' }}>Мой поток</button>
          ) : <span className="w-6" />}
        </div>

        {/* Имя исполнителя (или «Мой поток») — крупно и жирно на всю ширину; длинное само листается. */}
        <div className="absolute inset-x-4" style={{ top: 66, zIndex: 2 }}>
          <MarqueeName text={t ? (t.artist || 'Исполнитель') : 'Мой поток'} size={t ? 68 : 56} />
          {!t && <p className="mt-1 text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.8)' }}>Подобрано специально для тебя</p>}
        </div>

        {/* Фото исполнителя на прозрачном фоне — поверх имени, стоит на панели у правого края. */}
        {cutout && <img src={cutout} alt="" draggable={false} className="pointer-events-none absolute" style={{
          right: 6, bottom: t ? PANEL : 0, height: '68%', maxWidth: '52%', objectFit: 'contain', objectPosition: 'bottom right', zIndex: 3,
          filter: 'drop-shadow(0 8px 18px rgba(0,0,0,0.45))', opacity: showLyr ? 0.28 : 1, transition: 'opacity .3s ease',
        }} />}

        {/* Тишина или пауза — жёлтая кнопка пуска по центру. */}
        {!t && (
          <div className="absolute inset-x-0 flex justify-center" style={{ top: 184, zIndex: 4 }}>
            <button type="button" onClick={stop(onStart)} aria-label="Включить поток"
              className="grid h-[84px] w-[84px] place-items-center rounded-full" style={{ background: 'linear-gradient(135deg,#ffffff,#e9d5ff)', boxShadow: '0 10px 34px rgba(167,139,250,0.5)' }}>
              <Play size={30} fill="#111" color="#111" style={{ marginLeft: 4 }} />
            </button>
          </div>
        )}

        {t && (
          <>
            {/* Текст песни — в пустом месте между именем и панелью (справа от обложки), если включён. */}
            {showLyr && cur && (
              <div className="absolute" style={{ left: 86, right: 60, top: 150, bottom: PANEL + 10, zIndex: 4 }} onClick={(e) => e.stopPropagation()}>
                <LyricsBox trackId={t.id} time={time} />
              </div>
            )}
            {showLyr && !cur && (
              <p className="absolute text-[12.5px] font-semibold" style={{ left: 86, right: 60, top: 150, zIndex: 4, color: 'rgba(255,255,255,0.7)' }}>Включите песню, чтобы увидеть текст</p>
            )}

            {/* Обложка («логотип песни»): с текстом — маленькая в левом углу, без текста — по центру и крупнее. На паузе на ней значок пуска. */}
            <button type="button" onClick={stop(isPlaying ? onOpenPlayer : onToggle)} aria-label={isPlaying ? 'Открыть плеер' : 'Играть'}
              className="absolute grid place-items-center overflow-hidden"
              style={{
                left: showLyr ? 14 : 'calc(50% - 50px)', bottom: showLyr ? PANEL + 10 : PANEL + 16, width: showLyr ? 58 : 100, height: showLyr ? 58 : 100,
                borderRadius: showLyr ? 13 : 22, zIndex: 5, background: '#1a1a22', boxShadow: '0 12px 32px rgba(10,0,40,0.55)',
                transition: 'left .35s ease, bottom .35s ease, width .35s ease, height .35s ease, border-radius .35s ease',
              }}>
              {t.coverUrl ? <img src={t.coverUrl} alt="" className="h-full w-full object-cover" /> : <Music2 size={showLyr ? 22 : 34} color="rgba(255,255,255,0.4)" />}
              {!isPlaying && (
                <span className="absolute inset-0 grid place-items-center" style={{ background: 'rgba(15,5,45,0.38)' }}>
                  <Play size={showLyr ? 20 : 32} fill="#fff" color="#fff" style={{ marginLeft: 3 }} />
                </span>
              )}
            </button>

            {/* Кнопка «Текст песни» — в пустом месте справа. */}
            <button type="button" onClick={stop(toggleLyr)} aria-pressed={lyrOn} aria-label={lyrOn ? 'Скрыть текст песни' : 'Показать текст песни'}
              className="absolute grid h-10 w-10 place-items-center rounded-full"
              style={{ right: 14, bottom: PANEL + 14, zIndex: 6, background: lyrOn ? '#fff' : 'rgba(255,255,255,0.18)', color: lyrOn ? '#4c1d95' : '#fff', backdropFilter: 'blur(10px)' }}>
              <AlignLeft size={18} />
            </button>

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
        {sheet && <FlowSheet tracks={tracks} favorites={favorites} onPlay={onPlayPool} onClose={() => setSheet(false)} />}
      </div>
    </div>
  );
};
