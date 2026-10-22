/**
 * Видеофон полноэкранного плеера: клип, который загрузил владелец трека,
 * вместо статичного фона. Без звука, по кругу, затемнён — чтобы не мешать
 * названию, тексту и кнопкам. Идёт только пока трек играет; при
 * «Анимации выкл» и prefers-reduced-motion не показывается совсем.
 */
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '@/settings/store';

export const VideoBackdrop = ({ src, playing, z }: { src?: string; playing: boolean; z?: number }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const animationsOn = useSettings((s) => s.settings.animationsOn);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => { setReady(false); setFailed(false); }, [src]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing) void v.play().catch(() => {});
    else v.pause();
  }, [playing, src, ready]);

  if (!src || failed || !animationsOn || reduced) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: z }}>
      <video ref={ref} src={src} muted loop playsInline preload="auto"
        onCanPlay={() => setReady(true)} onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ opacity: ready ? 1 : 0, transition: 'opacity 0.9s ease' }} />
      {/* Затемнение: ровное + сильнее у краёв, где лежат кнопки и текст. */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.42) 40%, rgba(0,0,0,0.68) 100%)' }} />
    </div>
  );
};
