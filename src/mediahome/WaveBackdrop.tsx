import React from 'react';

/** Фон SkyWave: «дышащая» фиолетовая волна. Чистый SVG + CSS, без картинок; при «Анимации выкл» и reduced-motion — неподвижна. */
export const WaveBackdrop = () => (
  <div aria-hidden className="sky-wavebg pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl">
    <div className="sky-wavebg-glow" />
    <svg className="sky-wavebg-layer l1" viewBox="0 0 1200 300" preserveAspectRatio="none">
      <defs>
        <linearGradient id="swg1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#7c3aed" stopOpacity=".55" /><stop offset=".5" stopColor="#a855f7" stopOpacity=".5" /><stop offset="1" stopColor="#6366f1" stopOpacity=".5" /></linearGradient>
        <linearGradient id="swg2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#c084fc" stopOpacity=".4" /><stop offset="1" stopColor="#8b5cf6" stopOpacity=".4" /></linearGradient>
        <linearGradient id="swg3" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#4c1d95" stopOpacity=".6" /><stop offset="1" stopColor="#7e22ce" stopOpacity=".6" /></linearGradient>
      </defs>
      <path fill="url(#swg3)" d="M0 150 C 150 90 300 210 450 150 S 750 90 900 150 S 1100 200 1200 140 V300 H0Z" />
    </svg>
    <svg className="sky-wavebg-layer l2" viewBox="0 0 1200 300" preserveAspectRatio="none">
      <path fill="url(#swg1)" d="M0 170 C 200 110 350 230 600 170 S 1000 110 1200 180 V300 H0Z" />
    </svg>
    <svg className="sky-wavebg-layer l3" viewBox="0 0 1200 300" preserveAspectRatio="none">
      <path fill="url(#swg2)" d="M0 200 C 180 160 380 250 600 200 S 1020 160 1200 210 V300 H0Z" />
    </svg>
  </div>
);
