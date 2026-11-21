import type { ReactNode } from 'react';

/**
 * Векторная мебель и обстановка комнат Sky Pets.
 * Стиль: плоские мягкие формы, толстый тёплый контур, тёплые пастельные цвета — рисуется кодом, без файлов.
 * Ключ — `art.icon` предмета каталога. Новая мебель = запись в `ART` (поле 100×100) и, если нужно, подпись в ui.tsx.
 */
const L = '#6b4328';
const S = { stroke: L, strokeWidth: 3, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
const R = (x: number, y: number, w: number, h: number, fill: string, rx = 4, sw = 3) => <rect x={x} y={y} width={w} height={h} rx={rx} fill={fill} {...S} strokeWidth={sw} />;
const C = (cx: number, cy: number, r: number, fill: string) => <circle cx={cx} cy={cy} r={r} fill={fill} {...S} />;
const P = (d: string, fill: string, sw = 3) => <path d={d} fill={fill} {...S} strokeWidth={sw} />;
const SH = <ellipse cx="50" cy="94" rx="40" ry="5" fill="#000" opacity=".12" />;

const ART: Record<string, ReactNode> = {
  sofa: <>{SH}{R(14, 30, 72, 34, '#7fc6b4', 14)}{R(4, 46, 22, 42, '#6fb8a5', 10)}{R(74, 46, 22, 42, '#6fb8a5', 10)}{R(22, 58, 56, 30, '#97d6c4', 10)}{R(18, 88, 8, 6, '#8a5a3a', 2)}{R(74, 88, 8, 6, '#8a5a3a', 2)}</>,
  armchair: <>{SH}{R(22, 22, 56, 44, '#e8a0b4', 16)}{R(10, 46, 20, 42, '#d98aa0', 10)}{R(70, 46, 20, 42, '#d98aa0', 10)}{R(26, 56, 48, 32, '#f4bccb', 10)}{R(20, 88, 8, 6, '#8a5a3a', 2)}{R(72, 88, 8, 6, '#8a5a3a', 2)}</>,
  bed: <>{SH}{R(8, 36, 84, 50, '#cdb8f5', 10)}{R(8, 20, 20, 66, '#e0a060', 6)}{R(14, 40, 30, 18, '#fff', 8)}{R(8, 56, 84, 30, '#9a82e8', 10)}<path d="M30 70h10M52 66h10M68 74h10" stroke="#e8dcff" strokeWidth="3" strokeLinecap="round" />{R(10, 86, 8, 8, '#8a5a3a', 2)}{R(82, 86, 8, 8, '#8a5a3a', 2)}</>,
  bowl: <>{SH}{P('M16 56h68q0 28-34 28T16 56Z', '#f0944f')}{P('M22 56q28-14 56 0', '#7d3b2a')}{C(34, 52, 5, '#c4623f')}{C(50, 48, 5, '#c4623f')}{C(66, 52, 5, '#c4623f')}{R(30, 84, 40, 6, '#d9955a', 3)}</>,
  gym: <>{SH}{R(8, 74, 84, 14, '#6b6f8a', 6)}{R(14, 40, 10, 36, '#8a8fb0', 3)}{R(76, 40, 10, 36, '#8a8fb0', 3)}{R(14, 38, 72, 10, '#c7c7d0', 5)}{R(6, 28, 12, 30, '#f08c62', 4)}{R(82, 28, 12, 30, '#f08c62', 4)}</>,
  plant: <>{SH}{P('M50 62C26 56 20 30 36 12C40 34 50 44 50 62Z', '#6fbf5a')}{P('M50 62C74 56 80 30 64 12C60 34 50 44 50 62Z', '#7fcf6a')}{P('M50 64C46 44 50 28 50 6C56 28 56 46 50 64Z', '#58aa48')}{P('M24 62h52l-6 30H30Z', '#e8845a')}{R(22, 58, 56, 10, '#f09a70', 4)}</>,
  lamp: <>{SH}<line x1="50" y1="40" x2="50" y2="86" stroke={L} strokeWidth="6" strokeLinecap="round" /><line x1="50" y1="40" x2="50" y2="86" stroke="#e0a060" strokeWidth="3" strokeLinecap="round" />{P('M24 40h52l-10-34H34Z', '#fff1d6')}<ellipse cx="50" cy="90" rx="20" ry="5" fill="#e0a060" {...S} /></>,
  table: <>{SH}{R(10, 40, 80, 14, '#e8a368', 7)}{R(18, 54, 8, 36, '#d49b66', 3)}{R(74, 54, 8, 36, '#d49b66', 3)}{R(36, 60, 28, 10, '#f3c08a', 4)}{C(36, 30, 8, '#f6c33a')}{R(52, 24, 18, 16, '#fff7e8', 4)}</>,
  chair: <>{SH}{R(26, 10, 48, 40, '#e2a56b', 10)}{R(22, 46, 56, 14, '#f0b87c', 6)}{R(26, 60, 8, 30, '#d49b66', 3)}{R(66, 60, 8, 30, '#d49b66', 3)}</>,
  fridge: <>{SH}{R(22, 4, 56, 88, '#c9e4f7', 12)}<path d="M22 36h56" stroke={L} strokeWidth="3" />{R(66, 14, 5, 16, '#fff', 2)}{R(66, 44, 5, 26, '#fff', 2)}{R(30, 16, 16, 12, '#fff3c4', 2, 2)}{R(30, 48, 12, 12, '#f7a8a0', 2, 2)}</>,
  stove: <>{SH}{R(14, 30, 72, 62, '#6b6f8a', 8)}{R(14, 30, 72, 14, '#8a8fb0', 6)}{C(32, 37, 4, '#f08c62')}{C(50, 37, 4, '#f08c62')}{C(68, 37, 4, '#f08c62')}{R(24, 52, 52, 32, '#cfe8ff', 6)}{R(30, 58, 40, 6, '#fff', 3, 2)}{R(2, 24, 96, 8, '#c7c7d0', 4)}</>,
  tub: <>{SH}{P('M6 44h88q0 38-26 42H32Q6 82 6 44Z', '#fff')}{P('M10 44h80', '#cfe6f3')}<rect x="12" y="48" width="76" height="18" rx="9" fill="#9fd4f5" opacity=".9" />{C(26, 40, 5, '#fff')}{C(34, 34, 4, '#fff')}{R(14, 86, 10, 6, '#c7c7d0', 2)}{R(76, 86, 10, 6, '#c7c7d0', 2)}{R(76, 28, 6, 18, '#c7c7d0', 3)}{R(66, 24, 18, 6, '#c7c7d0', 3)}</>,
  sink: <>{SH}{R(14, 46, 72, 46, '#fff7e8', 6)}{R(10, 40, 80, 12, '#e8a368', 6)}{R(28, 36, 44, 10, '#cfe6f3', 5)}{R(46, 14, 8, 24, '#c7c7d0', 3)}{R(46, 12, 22, 8, '#c7c7d0', 4)}{R(22, 58, 26, 28, '#f3c08a', 4)}{R(52, 58, 26, 28, '#f3c08a', 4)}</>,
  shower: <>{SH}{R(30, 4, 40, 8, '#c7c7d0', 4)}{R(46, 10, 8, 20, '#c7c7d0', 3)}{P('M26 30h48l-8 12H34Z', '#a9a9b6')}<path d="M36 50v10M46 52v14M56 52v14M66 50v10" stroke="#6fb0f0" strokeWidth="3" strokeLinecap="round" />{R(18, 70, 64, 20, '#cfe6f3', 10)}</>,
  wardrobe: <>{SH}{R(14, 6, 72, 84, '#e0a060', 8)}<path d="M50 6v84" stroke={L} strokeWidth="3" />{R(20, 14, 26, 70, '#f3b46d', 4, 2)}{R(54, 14, 26, 70, '#f3b46d', 4, 2)}{C(44, 50, 3, '#6b4328')}{C(56, 50, 3, '#6b4328')}{R(18, 90, 10, 4, '#8a5a3a', 2)}{R(72, 90, 10, 4, '#8a5a3a', 2)}</>,
  shelf: <>{SH}{R(14, 6, 72, 86, '#e0a060', 6)}{R(20, 12, 60, 24, '#fbd29a', 3, 2)}{R(20, 40, 60, 24, '#fbd29a', 3, 2)}{R(20, 68, 60, 20, '#fbd29a', 3, 2)}{R(26, 16, 8, 20, '#e8584a', 2, 2)}{R(36, 18, 8, 18, '#4aa3e8', 2, 2)}{R(46, 16, 8, 20, '#7bd36a', 2, 2)}{C(66, 52, 8, '#f6c33a')}{R(28, 52, 20, 12, '#cdb8f5', 3, 2)}</>,
  tv: <>{SH}{R(8, 14, 84, 56, '#4a4f6e', 8)}{R(14, 20, 72, 44, '#243040', 4, 2)}<path d="M22 54l14-16 10 10 12-14 16 20Z" fill="#6fb0f0" opacity=".6" />{R(40, 70, 20, 10, '#8a8fb0', 3)}{R(28, 80, 44, 8, '#8a8fb0', 4)}</>,
  nightstand: <>{SH}{R(20, 40, 60, 50, '#f3b46d', 6)}{R(26, 48, 48, 16, '#fbd29a', 3, 2)}{R(26, 68, 48, 16, '#fbd29a', 3, 2)}{C(50, 56, 2.5, '#6b4328')}{C(50, 76, 2.5, '#6b4328')}{P('M34 40L66 40L60 14L40 14Z', '#fff1d6')}</>,
  desk: <>{SH}{R(8, 44, 84, 12, '#e8a368', 6)}{R(12, 56, 8, 34, '#d49b66', 3)}{R(80, 56, 8, 34, '#d49b66', 3)}{R(60, 56, 22, 26, '#f3c08a', 3, 2)}{R(24, 18, 40, 26, '#f4e9d8', 5)}{R(28, 22, 32, 18, '#243040', 3, 2)}{R(40, 40, 8, 5, '#c7c7d0', 2, 2)}</>,
  carpet: <>{<ellipse cx="50" cy="60" rx="46" ry="26" fill="#cdb8f5" {...S} />}<ellipse cx="50" cy="60" rx="32" ry="17" fill="#e8dcff" stroke="#9a82e8" strokeWidth="2.5" strokeDasharray="3 5" /><ellipse cx="50" cy="60" rx="14" ry="7" fill="#9a82e8" opacity=".6" /></>,
  curtain: <>{R(8, 6, 84, 8, '#8a5a3a', 4)}{P('M14 14h30q-2 30-6 70H20q-6-40-6-70Z', '#f08c8c')}{P('M56 14h30q0 30-6 70H62q-4-40-6-70Z', '#f08c8c')}<path d="M26 18v62M72 18v62" stroke="#fff" strokeWidth="2" opacity=".5" /></>,
  picture: <>{R(14, 14, 72, 66, '#e0a060', 5)}{R(22, 22, 56, 50, '#bfe4ff', 3, 2)}<path d="M22 66l16-18 12 12 10-12 18 18v6H22Z" fill="#7fcf6a" stroke={L} strokeWidth="2" strokeLinejoin="round" />{C(62, 34, 6, '#ffd36b')}</>,
  clock: <>{C(50, 50, 38, '#fff7e8')}{C(50, 50, 30, '#fff')}<path d="M50 50V28M50 50l14 8" stroke={L} strokeWidth="4" strokeLinecap="round" />{C(50, 50, 3, '#e8584a')}</>,
  flowers: <>{SH}{P('M32 52h36l-5 38H37Z', '#9fd4f5')}<path d="M50 52V28M38 52L30 30M62 52l8-22" stroke="#58aa48" strokeWidth="4" strokeLinecap="round" />{C(50, 24, 9, '#f08c8c')}{C(30, 28, 8, '#ffd36b')}{C(70, 28, 8, '#cdb8f5')}</>,
  aquarium: <>{SH}{R(10, 22, 80, 64, '#bfe4ff', 8)}<rect x="14" y="40" width="72" height="42" rx="4" fill="#6fb0f0" opacity=".55" />{P('M34 60q10-12 22 0q-10 12-22 0Z', '#f6a05a', 2.5)}{P('M56 60l10-8v16Z', '#f6a05a', 2.5)}{C(30, 74, 3, '#fff')}{P('M70 82q-2-14 4-18q2 10 6 18Z', '#58aa48', 2.5)}{R(8, 18, 84, 8, '#8a8fb0', 4)}</>,
  tree: <>{SH}{R(42, 52, 16, 40, '#b0764a', 5)}{C(50, 34, 28, '#6fbf5a')}{C(30, 46, 18, '#7fcf6a')}{C(70, 46, 18, '#7fcf6a')}{C(42, 28, 4, '#e8584a')}{C(62, 40, 4, '#e8584a')}</>,
  bush: <>{SH}{C(30, 66, 22, '#6fbf5a')}{C(52, 56, 26, '#7fcf6a')}{C(72, 68, 20, '#6fbf5a')}{C(44, 62, 3, '#ff8aa8')}{C(64, 64, 3, '#ff8aa8')}</>,
  fence: <>{R(6, 52, 88, 8, '#e0a060', 3)}{R(6, 72, 88, 8, '#e0a060', 3)}{[14, 34, 54, 74].map((x) => <path key={x} d={`M${x} 90V36l8-10 8 10v54Z`} fill="#f3c08a" {...S} />)}</>,
  swing: <>{R(6, 6, 88, 8, '#8a5a3a', 4)}<path d="M26 14v56M74 14v56" stroke={L} strokeWidth="3" />{R(18, 70, 64, 10, '#e8584a', 4)}{P('M10 14L2 92M90 14l8 78', 'none')}</>,
  slide: <>{SH}{R(8, 14, 22, 8, '#8a5a3a', 3)}{R(12, 22, 6, 68, '#d49b66', 2)}{R(22, 22, 6, 68, '#d49b66', 2)}{P('M26 24L88 82V90H80L22 40Z', '#f6b84a')}{R(6, 8, 28, 10, '#e8584a', 4)}</>,
  sandbox: <>{SH}{R(8, 46, 84, 40, '#e0a060', 6)}<rect x="14" y="50" width="72" height="30" rx="4" fill="#f6dc8a" />{P('M34 66h14l-2-12H36Z', '#e8584a')}{C(66, 66, 6, '#4aa3e8')}</>,
  tunnel: <>{SH}{P('M8 88V56q0-34 42-34t42 34v32Z', '#f08c62')}<path d="M26 88V60q0-18 24-18t24 18v28Z" fill="#7d3b2a" stroke={L} strokeWidth="3" strokeLinejoin="round" /><path d="M20 40q-4 20 0 40M80 40q4 20 0 40" stroke="#fff" strokeWidth="2" opacity=".5" fill="none" /></>,
  mirror: <>{R(26, 6, 48, 74, '#e0a060', 22)}{R(32, 12, 36, 62, '#cfe8ff', 17, 2)}<path d="M40 24l6-4M42 34l10-8" stroke="#fff" strokeWidth="3" strokeLinecap="round" /></>,
  window: <>{R(10, 6, 80, 82, '#fff7e8', 8)}{R(16, 12, 68, 70, '#bfe4ff', 4, 2)}<path d="M50 12v70M16 47h68" stroke={L} strokeWidth="3" />{C(66, 28, 7, '#ffe9a8')}{R(6, 86, 88, 8, '#e0a060', 3)}</>,
  door: <>{R(22, 4, 56, 90, '#e0a060', 8)}{R(30, 12, 40, 32, '#f3b46d', 4, 2)}{R(30, 50, 40, 36, '#f3b46d', 4, 2)}{C(68, 50, 4, '#ffd36b')}</>,
  balloon: <>{P('M50 6q26 0 26 28q0 24-26 28q-26-4-26-28q0-28 26-28Z', '#f08c8c')}<path d="M50 62l-5 8h10Z" fill="#d97777" stroke={L} strokeWidth="2.5" strokeLinejoin="round" /><path d="M50 70q-8 10 0 24" stroke={L} strokeWidth="2.5" fill="none" strokeLinecap="round" /><ellipse cx="38" cy="24" rx="5" ry="8" fill="#fff" opacity=".5" /></>,
  easel: <>{SH}<path d="M24 92L44 12h12l20 80M36 56h30" stroke={L} strokeWidth="6" strokeLinecap="round" fill="none" /><path d="M24 92L44 12h12l20 80M36 56h30" stroke="#e0a060" strokeWidth="3" strokeLinecap="round" fill="none" />{R(24, 18, 52, 38, '#fff', 3)}{C(40, 34, 6, '#f08c8c')}{C(58, 40, 7, '#6fb0f0')}</>,
  ball: <>{SH}{C(50, 56, 32, '#fff')}<path d="M50 24l14 10-6 18H42l-6-18Z" fill="#4f5270" stroke={L} strokeWidth="2.5" strokeLinejoin="round" /></>,
  blocks: <>{SH}{R(14, 56, 32, 32, '#e8584a', 5)}{R(48, 56, 32, 32, '#4aa3e8', 5)}{R(30, 24, 32, 32, '#f6c33a', 5)}<text x="30" y="82" fontFamily="Nunito, sans-serif" fontWeight="900" fontSize="20" fill="#fff">A</text></>,
  teddy: <>{SH}{C(26, 28, 11, '#c98b5a')}{C(74, 28, 11, '#c98b5a')}{C(50, 62, 26, '#d9a06a')}{C(50, 32, 22, '#d9a06a')}{C(50, 40, 9, '#f6dcc0')}{C(42, 28, 3, L)}{C(58, 28, 3, L)}{C(50, 38, 3, L)}{C(30, 80, 9, '#c98b5a')}{C(70, 80, 9, '#c98b5a')}</>,
  sun: <>{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="50" y1="50" x2={50 + 46 * Math.cos((a * Math.PI) / 180)} y2={50 + 46 * Math.sin((a * Math.PI) / 180)} stroke="#f6b84a" strokeWidth="6" strokeLinecap="round" />)}{C(50, 50, 26, '#ffd36b')}</>,
  house: <>{SH}{R(14, 40, 72, 50, '#f3b46d', 4)}{P('M6 44L50 8l44 36Z', '#e8584a')}{R(40, 58, 20, 32, '#8a5a3a', 4)}{R(20, 52, 16, 16, '#bfe4ff', 3, 2)}{R(64, 52, 16, 16, '#bfe4ff', 3, 2)}</>,
  tulip: <>{SH}<path d="M50 90V46" stroke="#58aa48" strokeWidth="5" strokeLinecap="round" />{P('M50 80q16-6 20-18q-14 0-20 18Z', '#7fcf6a')}{P('M34 20q0 26 16 28q16-2 16-28l-8 8-8-12-8 12Z', '#f08c8c')}</>,
};

/** Какие ключи art.icon нарисованы векторно. */
export const hasArt = (k?: string) => !!k && k in ART;

export function FurnArt({ name, size = 56, className, style }: { name: string; size?: number | string; className?: string; style?: React.CSSProperties }) {
  const a = ART[name]; if (!a) return null;
  return <svg viewBox="0 0 100 100" width={size} height={size} className={className} style={{ display: 'block', ...style }} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">{a}</svg>;
}
