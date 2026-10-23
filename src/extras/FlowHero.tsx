/**
 * Карточка «Мой поток» на главной Sky Music.
 *
 * Три состояния:
 *  • ничего не играло — спокойная волна, «Мой поток» и кнопка запуска;
 *  • музыка играет — волна движется, от карточки расходятся лучи света, крупно имя исполнителя,
 *    ниже мини-плеер (пуск/пауза, название, «в избранное»), в углу — обложка трека;
 *  • музыка на паузе или недослушана — те же данные, но волна спокойная.
 * Фото исполнителя на прозрачном фоне (загружает владелец карточки исполнителя) накладывается на имя.
 */
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Heart, Music2, Pause, Play, Sparkles } from 'lucide-react';
import type { Track } from '@/platform/store';
import { SkySphere } from '@/music/SkySphere';
import { subscribeAudioLevels } from '@/music/audioLevels';
import { useCardImage } from '@/artists/CardImages';
import { getG } from '@/music/utils';

/** Лучи света вокруг карточки: вращаются, пульсируют в такт музыке. Центр — центр карточки, за её краями они и видны. */
const Rays = ({ c1, c2, on }: { c1: string; c2: string; on: boolean }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on) return undefined;
    return subscribeAudioLevels((l) => { ref.current?.style.setProperty('--lvl', String(Math.min(1, l.level * 1.6 + l.beat * 0.5))); });
  }, [on]);
  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute" style={{
      inset: -34, zIndex: 0, opacity: on ? 1 : 0, transition: 'opacity .8s ease',
      ['--lvl' as string]: 0.35,
      WebkitMaskImage: 'radial-gradient(circle, #000 28%, transparent 72%)', maskImage: 'radial-gradient(circle, #000 28%, transparent 72%)',
    }}>
      <div className="sky-flow-rays absolute" style={{
        inset: '-30% -10%', borderRadius: '50%', filter: 'blur(5px)',
        background: `repeating-conic-gradient(from 0deg, ${c1}cc 0deg 2.2deg, transparent 2.2deg 11deg), repeating-conic-gradient(from 5deg, ${c2}99 0deg 1.2deg, transparent 1.2deg 17deg)`,
        opacity: 'calc(0.35 + var(--lvl) * 0.65)' as unknown as number,
      }} />
    </div>
  );
};

export const FlowHero = ({ cur, last, playing, liked, c1, c2, onStart, onToggle, onLike, onOpenPlayer, onOpenWave }: {
  cur: Track | null;          // трек, который сейчас в плеере (играет или на паузе)
  last: Track | null;         // недослушанный трек прошлого раза, когда плеер пуст
  playing: boolean;
  liked: boolean;
  c1: string; c2: string;     // цвета волны
  onStart: () => void;        // запустить поток
  onToggle: () => void;       // пуск/пауза текущего (или запуск недослушанного)
  onLike: () => void;
  onOpenPlayer: () => void;   // открыть полноэкранный плеер
  onOpenWave: () => void;     // открыть подборку «Мой поток»
}) => {
  const t = cur ?? last;
  const isPlaying = Boolean(cur) && playing;
  const [g1, g2] = t ? getG(t.id) : [c1, c2];
  const wc1 = t ? g1 : c1; const wc2 = t ? g2 : c2;
  const cutout = useCardImage(t?.cutoutCardId ?? '', 'cutout', Boolean(t?.cutoutCardId));
  const open = () => (t ? onOpenPlayer() : onOpenWave());
  const stop = (fn: () => void) => (e: React.SyntheticEvent) => { e.stopPropagation(); fn(); };

  return (
    <div className="relative" style={{ height: t ? 248 : 212 }}>
      <style>{`@keyframes skyFlowSpin{to{transform:rotate(360deg)}} .sky-flow-rays{animation:skyFlowSpin 38s linear infinite} @media (prefers-reduced-motion: reduce){.sky-flow-rays{animation:none}}`}</style>
      <Rays c1={wc1} c2={wc2} on={isPlaying} />
      <motion.div role="button" tabIndex={0} onClick={open} whileTap={{ scale: 0.985 }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        aria-label={t ? 'Открыть плеер' : 'Мой поток — открыть подборку'}
        className="absolute inset-0 cursor-pointer overflow-hidden rounded-[28px] text-left" style={{ background: '#07070c', zIndex: 1 }}>
        <div className="absolute inset-0" style={{ zIndex: 0 }}><SkySphere color1={wc1} color2={wc2} active={isPlaying} /></div>
        <div className="absolute inset-0" style={{ zIndex: 1, background: 'linear-gradient(to top, rgba(4,4,8,0.86) 0%, rgba(4,4,8,0.3) 48%, transparent 78%)' }} />

        {t ? (
          <>
            {/* Имя исполнителя — крупно, жирно. Фото исполнителя ложится поверх последних букв. */}
            <p translate="no" className="absolute left-5 right-5 font-black text-white" style={{
              top: '34%', zIndex: 2, fontSize: 'clamp(26px, 8.4vw, 36px)', lineHeight: 1.02, letterSpacing: '-0.04em',
              textShadow: '0 2px 22px rgba(0,0,0,0.6)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{t.artist || 'Исполнитель'}</p>
            {cutout && <img src={cutout} alt="" draggable={false} className="pointer-events-none absolute" style={{
              right: 6, bottom: 0, height: '86%', maxWidth: '58%', objectFit: 'contain', objectPosition: 'bottom right', zIndex: 3,
              filter: 'drop-shadow(0 8px 18px rgba(0,0,0,0.5))',
              WebkitMaskImage: 'linear-gradient(to bottom, #000 78%, transparent 100%)', maskImage: 'linear-gradient(to bottom, #000 78%, transparent 100%)',
            }} />}
          </>
        ) : null}

        <div className="relative flex h-full flex-col justify-between p-5" style={{ zIndex: 4 }}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Sparkles size={14} color="rgba(255,255,255,0.85)" />
              <span className="text-[12px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {isPlaying && liked ? 'Мои любимые' : 'Моя волна'}
              </span>
            </div>
            {t && (
              <button type="button" onClick={stop(onOpenWave)}
                className="rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', backdropFilter: 'blur(8px)' }}>
                Мой поток
              </button>
            )}
          </div>

          {t ? (
            <div className="flex items-center gap-2.5">
              {/* Обложка («логотип песни») — в нижнем левом углу. */}
              <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl"
                style={{ background: t.coverUrl ? undefined : `linear-gradient(150deg,${g1},${g2})`, boxShadow: '0 6px 18px rgba(0,0,0,0.5)' }}>
                {t.coverUrl ? <img src={t.coverUrl} alt="" className="h-full w-full object-cover" /> : <Music2 size={18} color="rgba(255,255,255,0.5)" />}
              </span>
              {/* Мини-плеер: пуск/пауза, название, в избранное. */}
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3" style={{ background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(14px)' }}>
                <button type="button" onClick={stop(onToggle)} aria-label={isPlaying ? 'Пауза' : 'Играть'}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.95)' }}>
                  {isPlaying ? <Pause size={15} fill="#0a0a0f" color="#0a0a0f" /> : <Play size={15} fill="#0a0a0f" color="#0a0a0f" style={{ marginLeft: 2 }} />}
                </button>
                <span translate="no" className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">{t.title}</span>
                <button type="button" onClick={stop(onLike)} aria-label={liked ? 'Убрать из избранного' : 'В избранное'} aria-pressed={liked}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full">
                  <Heart size={17} color={liked ? '#ff4d6d' : '#fff'} fill={liked ? '#ff4d6d' : 'none'} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[26px] font-extrabold text-white" style={{ letterSpacing: '-0.03em', textShadow: '0 2px 18px rgba(0,0,0,0.55)' }}>Мой поток</p>
                <p className="mt-0.5 truncate text-[12.5px]" style={{ color: 'rgba(255,255,255,0.72)' }}>Подобрано специально для тебя</p>
              </div>
              <span role="button" tabIndex={0} aria-label="Включить поток" onClick={stop(onStart)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onStart(); } }}
                className="grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.95)', boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }}>
                <Play size={19} fill="#0a0a0f" color="#0a0a0f" style={{ marginLeft: 2 }} />
              </span>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
