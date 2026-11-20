import { useEffect, useState } from 'react';
import { imageUrl, type Art, type View } from './api';

/** Встроенные питомцы рисуются векторно по `art` (форма и три цвета); загруженные — картинкой (в магазине — блоб с токеном). */
const D = '#3a2f3f';
export const useSpImage = (id?: string | null, thumb = false) => {
  const [u, setU] = useState<string | null>(null);
  useEffect(() => { let on = true; setU(null); if (id) void imageUrl(id, thumb).then((x) => on && setU(x)); return () => { on = false; }; }, [id, thumb]);
  return u;
};

const Eyes = ({ mood, y = 46, gap = 11, r = 4.2 }: { mood: string; y?: number; gap?: number; r?: number }) => {
  const x1 = 60 - gap, x2 = 60 + gap;
  if (mood === 'sleeping' || mood === 'tired') return <g stroke={D} strokeWidth="2.4" strokeLinecap="round" fill="none"><path d={`M${x1 - 4} ${y} q4 4 8 0`} /><path d={`M${x2 - 4} ${y} q4 4 8 0`} /></g>;
  if (mood === 'sick') return <g stroke={D} strokeWidth="2.2" strokeLinecap="round"><path d={`M${x1 - 3} ${y - 3} l6 6 m0 -6 l-6 6`} /><path d={`M${x2 - 3} ${y - 3} l6 6 m0 -6 l-6 6`} /></g>;
  return <g><circle cx={x1} cy={y} r={r} fill={D} /><circle cx={x2} cy={y} r={r} fill={D} /><circle cx={x1 + 1.3} cy={y - 1.4} r={1.4} fill="#fff" /><circle cx={x2 + 1.3} cy={y - 1.4} r={1.4} fill="#fff" />{mood === 'sad' && <g stroke={D} strokeWidth="1.8" strokeLinecap="round"><path d={`M${x1 - 5} ${y - 8} l8 2`} /><path d={`M${x2 + 5} ${y - 8} l-8 2`} /></g>}</g>;
};
const Mouth = ({ mood, y = 58 }: { mood: string; y?: number }) => {
  if (mood === 'hungry') return <ellipse cx="60" cy={y + 1} rx="4" ry="5" fill="#c4505a" />;
  if (mood === 'sad' || mood === 'sick' || mood === 'dirty') return <path d={`M53 ${y + 3} q7 -6 14 0`} stroke={D} strokeWidth="2.2" fill="none" strokeLinecap="round" />;
  if (mood === 'happy') return <path d={`M52 ${y - 1} q8 10 16 0 z`} fill="#c4505a" stroke={D} strokeWidth="1.6" strokeLinejoin="round" />;
  return <path d={`M54 ${y} q6 6 12 0`} stroke={D} strokeWidth="2.2" fill="none" strokeLinecap="round" />;
};
const Acc = ({ list }: { list: { slot: string; itemId: string }[] }) => (
  <g>{list.map((a) => a.itemId === 'acc-crown' ? <path key={a.slot} d="M44 28 l5 -12 l6 8 l5 -10 l5 10 l6 -8 l5 12 z" fill="#ffd34d" stroke="#d9a21a" strokeWidth="1.5" strokeLinejoin="round" />
    : a.itemId === 'acc-bow' ? <g key={a.slot}><path d="M72 28 l12 -6 v14 z M72 28 l-4 -8 l-2 10 z" fill="#ff7aa8" /><circle cx="72" cy="28" r="3.5" fill="#e24b84" /></g>
    : a.itemId === 'cloth-scarf' ? <g key={a.slot}><path d="M38 70 q22 12 44 0 v8 q-22 12 -44 0 z" fill="#ff6b6b" /><rect x="70" y="74" width="8" height="16" rx="3" fill="#e24b4b" /></g>
    : <path key={a.slot} d="M60 14 l3 7 8 1 -6 5 2 8 -7 -4 -7 4 2 -8 -6 -5 8 -1 z" fill="#ffd34d" />)}</g>
);

export const PetSvg = ({ art, mood = 'calm', accessories = [], size = 120 }: { art: Art; mood?: string; accessories?: { slot: string; itemId: string }[]; size?: number }) => {
  const c1 = art.c1 ?? '#f0a35e', c2 = art.c2 ?? '#fff1dc', c3 = art.c3 ?? '#7a4a21'; const shape = art.shape ?? 'blob';
  const body = <ellipse cx="60" cy="86" rx="30" ry="25" fill={c1} />; const belly = <ellipse cx="60" cy="90" rx="19" ry="16" fill={c2} opacity=".9" />;
  const head = <circle cx="60" cy="50" r="27" fill={c1} />; const cheeks = <g fill="#ff9ab5" opacity=".55"><circle cx="43" cy="58" r="5" /><circle cx="77" cy="58" r="5" /></g>;
  let back: JSX.Element | null = null, front: JSX.Element | null = null, face = true, eyeY = 48;
  switch (shape) {
    case 'cat': back = <g><path d="M34 32 l-4 -22 l20 12 z M86 32 l4 -22 l-20 12 z" fill={c1} /><path d="M35 28 l-1 -11 l9 6 z M85 28 l1 -11 l-9 6 z" fill={c3} opacity=".5" /><path d="M88 96 q28 -8 18 -34" stroke={c1} strokeWidth="9" fill="none" strokeLinecap="round" /></g>; front = <g stroke={D} strokeWidth="1.2" opacity=".6"><path d="M30 56 h12 M30 62 h12 M90 56 h-12 M90 62 h-12" /><path d="M54 24 v8 M60 22 v9 M66 24 v8" stroke={c3} strokeWidth="2" /></g>; break;
    case 'dog': back = <g><ellipse cx="33" cy="48" rx="9" ry="17" fill={c3} transform="rotate(12 33 48)" /><ellipse cx="87" cy="48" rx="9" ry="17" fill={c3} transform="rotate(-12 87 48)" /><path d="M88 94 q20 -6 14 -22" stroke={c1} strokeWidth="8" fill="none" strokeLinecap="round" /></g>; front = <g><ellipse cx="60" cy="60" rx="14" ry="10" fill={c2} /><ellipse cx="60" cy="55" rx="5" ry="3.5" fill={D} /></g>; break;
    case 'rabbit': back = <g><ellipse cx="46" cy="16" rx="8" ry="22" fill={c1} /><ellipse cx="74" cy="16" rx="8" ry="22" fill={c1} /><ellipse cx="46" cy="18" rx="4" ry="15" fill={c2} /><ellipse cx="74" cy="18" rx="4" ry="15" fill={c2} /><circle cx="90" cy="98" r="7" fill={c2} /></g>; front = <ellipse cx="60" cy="56" rx="3" ry="2.2" fill="#e8809a" />; break;
    case 'bear': back = <g><circle cx="38" cy="30" r="10" fill={c1} /><circle cx="82" cy="30" r="10" fill={c1} /><circle cx="38" cy="30" r="5" fill={c2} /><circle cx="82" cy="30" r="5" fill={c2} /></g>; front = <g><ellipse cx="60" cy="60" rx="12" ry="9" fill={c2} /><ellipse cx="60" cy="56" rx="4.5" ry="3" fill={D} /></g>; break;
    case 'panda': back = <g><circle cx="38" cy="30" r="10" fill={c2} /><circle cx="82" cy="30" r="10" fill={c2} /></g>; front = <g><ellipse cx="48" cy="48" rx="7" ry="9" fill={c2} transform="rotate(-20 48 48)" /><ellipse cx="72" cy="48" rx="7" ry="9" fill={c2} transform="rotate(20 72 48)" /></g>; eyeY = 48; break;
    case 'fox': back = <g><path d="M33 34 l-5 -24 l22 14 z M87 34 l5 -24 l-22 14 z" fill={c1} /><path d="M33 28 l-2 -13 l11 8 z M87 28 l2 -13 l-11 8 z" fill={c3} /><path d="M88 98 q30 -2 22 -34 q-6 18 -22 22z" fill={c1} /><path d="M104 70 q4 12 -6 18z" fill={c2} /></g>; front = <path d="M34 58 q26 22 52 0 q-6 14 -26 16 q-20 -2 -26 -16z" fill={c2} />; break;
    case 'frog': back = <g><circle cx="42" cy="28" r="12" fill={c1} /><circle cx="78" cy="28" r="12" fill={c1} /></g>; front = <g><circle cx="42" cy="28" r="7" fill="#fff" /><circle cx="78" cy="28" r="7" fill="#fff" /><circle cx="43" cy="29" r="3.5" fill={D} /><circle cx="77" cy="29" r="3.5" fill={D} /><path d="M40 62 q20 14 40 0" stroke={c3} strokeWidth="2.4" fill="none" strokeLinecap="round" /></g>; face = false; break;
    case 'bird': back = <g><path d="M88 90 l22 -10 l-8 16 z" fill={c3} /><ellipse cx="38" cy="86" rx="9" ry="16" fill={c2} transform="rotate(20 38 86)" /></g>; front = <g><path d="M54 52 l6 8 l6 -8 z" fill="#ff9a3a" /><path d="M56 22 q4 -10 8 0" stroke={c3} strokeWidth="3" fill="none" strokeLinecap="round" /><path d="M50 108 v8 M70 108 v8" stroke="#ff9a3a" strokeWidth="3" strokeLinecap="round" /></g>; break;
    case 'dragon': back = <g><path d="M32 70 l-22 -18 l8 26 z M88 70 l22 -18 l-8 26 z" fill={c2} /><path d="M90 98 q26 0 24 -22 l-8 10 z" fill={c1} /><path d="M52 24 l3 -10 l5 8 l5 -8 l3 10" fill={c3} /></g>; front = <g><path d="M40 36 l-6 -14 l12 6 z M80 36 l6 -14 l-12 6 z" fill={c3} /><ellipse cx="60" cy="60" rx="12" ry="8" fill={c2} /><circle cx="56" cy="58" r="1.4" fill={D} /><circle cx="64" cy="58" r="1.4" fill={D} /></g>; break;
    case 'unicorn': back = <g><path d="M33 34 l-3 -16 l14 8 z M87 34 l3 -16 l-14 8 z" fill={c1} /><path d="M32 40 q-16 14 -6 38 q12 -8 8 -34z" fill={c2} /><path d="M88 40 q16 14 6 38 q-12 -8 -8 -34z" fill={c3} /></g>; front = <g><path d="M60 8 l6 22 h-12 z" fill="#ffd34d" stroke="#e0a516" strokeWidth="1.2" /><path d="M42 26 q18 -12 36 0" stroke={c3} strokeWidth="6" fill="none" strokeLinecap="round" /></g>; break;
    case 'alien': back = <g><path d="M48 26 l-8 -16 M72 26 l8 -16" stroke={c3} strokeWidth="3" strokeLinecap="round" /><circle cx="40" cy="9" r="5" fill="#ffe066" /><circle cx="80" cy="9" r="5" fill="#ffe066" /></g>; front = <g><ellipse cx="60" cy="46" rx="18" ry="11" fill={c3} opacity=".25" /></g>; break;
    default: back = <path d="M60 14 q4 -8 10 -4 q-2 8 -8 10z" fill={c3} />; front = <ellipse cx="42" cy="38" rx="7" ry="4" fill="#fff" opacity=".45" transform="rotate(-30 42 38)" />;
  }
  return (
    <svg viewBox="0 0 120 124" width={size} height={size * 124 / 120} aria-hidden>
      <ellipse cx="60" cy="116" rx="30" ry="5" fill="#000" opacity=".12" />
      {back}{body}{belly}{head}{shape === 'panda' ? front : null}{cheeks}
      {shape !== 'panda' && front}{face && <><Eyes mood={mood} y={eyeY} /><Mouth mood={mood} /></>}{shape === 'panda' && <Eyes mood={mood} y={eyeY} />}
      {shape === 'frog' && <Eyes mood={mood} y={52} />}
      {mood === 'sleeping' && <text x="86" y="30" fontSize="14" fill="#6b7cc9" fontWeight="700">z<tspan fontSize="10" dx="2" dy="-6">z</tspan></text>}
      <Acc list={accessories} />
    </svg>
  );
};

export const PetPic = ({ pet, size = 120, mood }: { pet: { species: { art: Art; imageId?: string | null; view?: View } | null; skin?: { art: Art; imageId?: string | null; view?: View } | null; mood?: string; accessories?: { slot: string; itemId: string }[] }; size?: number; mood?: string }) => {
  const src = pet.skin ?? pet.species; const url = useSpImage(src?.imageId, size <= 140);
  const v = src?.view ?? {};
  if (src?.imageId) return url
    ? <div style={{ width: size, height: size, overflow: 'hidden', borderRadius: v.mask === 'round' ? '50%' : 0, position: 'relative' }}><img src={url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `translate(${v.x ?? 0}%, ${v.y ?? 0}%) scale(${v.scale ?? 1})`, filter: pet.mood === 'sleeping' ? 'saturate(.8)' : undefined }} /></div>
    : <div style={{ width: size, height: size }} className="animate-pulse rounded-full bg-white/10" />;
  return <PetSvg art={src?.art ?? {}} mood={mood ?? pet.mood} accessories={pet.accessories} size={size} />;
};
export const ArtOnly = ({ art, imageId, view, size = 64 }: { art: Art; imageId?: string | null; view?: View; size?: number }) => <PetPic pet={{ species: { art, imageId, view } }} size={size} mood="happy" />;

export const EggSvg = ({ art, size = 72, wobble = false, crack = 0 }: { art: Art; size?: number; wobble?: boolean; crack?: number }) => {
  const a = art.c1 ?? '#ffe9b8', b = art.c2 ?? '#f0a35e'; const gid = `eg-${a.slice(1)}${b.slice(1)}`;
  return (
    <svg viewBox="0 0 100 120" width={size} height={size * 1.2} className={wobble ? 'sp-wobble' : ''} aria-hidden>
      <defs><radialGradient id={gid} cx=".35" cy=".3" r=".9"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></radialGradient></defs>
      <ellipse cx="50" cy="112" rx="26" ry="5" fill="#000" opacity=".12" />
      <path d="M50 6 C78 6 90 56 90 76 C90 100 72 112 50 112 C28 112 10 100 10 76 C10 56 22 6 50 6 Z" fill={`url(#${gid})`} />
      <g fill="#fff" opacity=".55"><circle cx="34" cy="54" r="6" /><circle cx="64" cy="40" r="4" /><circle cx="60" cy="78" r="7" /><circle cx="30" cy="86" r="3.5" /></g>
      {crack > 0 && <path d="M30 60 l10 8 l8 -10 l10 12 l10 -8" stroke="#6b4a22" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity={0.4 + crack * 0.2} />}
    </svg>
  );
};
