/**
 * Облачко Sky для Sky AI: машет в новом чате, «программирует», пока модель думает.
 * Векторное, без картинок; анимации — CSS (`.cb-*` в styles.css), при «уменьшить анимацию» всё статично.
 */
import { useEffect, useState } from 'react';

export type BuddyMood = 'wave' | 'code' | 'idle';

export const CloudBuddy = ({ mood = 'idle', size = 96 }: { mood?: BuddyMood; size?: number }) => {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    const t = setInterval(() => { setBlink(true); setTimeout(() => setBlink(false), 140); }, 3000 + Math.random() * 1800);
    return () => clearInterval(t);
  }, []);
  const coding = mood === 'code';
  const waving = mood === 'wave';
  const eyeY = coding ? 45 : 42;   // за работой смотрит вниз, на экран
  return (
    <div className={`cb-root cb-${mood}`} style={{ width: size, height: size * 0.9 }} aria-hidden="true">
      <svg viewBox="0 0 120 108" width={size} height={size * 0.9} style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="cb-g" cx="48%" cy="38%" r="62%"><stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#ddd6fe" /></radialGradient>
          <radialGradient id="cb-g2" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#f5f3ff" /><stop offset="100%" stopColor="#c4b5fd" /></radialGradient>
        </defs>
        <ellipse className="cb-shadow" cx="60" cy="98" rx="34" ry="4.5" fill="rgba(99,102,241,.22)" />
        <g className="cb-body">
          <circle cx="32" cy="58" r="19" fill="url(#cb-g2)" />
          <circle cx="58" cy="42" r="25" fill="url(#cb-g)" />
          <circle cx="84" cy="56" r="18" fill="url(#cb-g2)" />
          <circle cx="70" cy="66" r="14" fill="url(#cb-g)" />
          <circle cx="44" cy="66" r="14" fill="url(#cb-g)" />
          <rect x="24" y="56" width="68" height="22" rx="11" fill="url(#cb-g)" />
          {blink
            ? <><line x1="47" y1={eyeY} x2="55" y2={eyeY} stroke="#312e81" strokeWidth="2.8" strokeLinecap="round" /><line x1="62" y1={eyeY} x2="70" y2={eyeY} stroke="#312e81" strokeWidth="2.8" strokeLinecap="round" /></>
            : <><ellipse cx="51" cy={eyeY} rx="4.4" ry="4.8" fill="#312e81" /><circle cx="52.7" cy={eyeY - 1.8} r="1.5" fill="#fff" /><ellipse cx="66" cy={eyeY} rx="4.4" ry="4.8" fill="#312e81" /><circle cx="67.7" cy={eyeY - 1.8} r="1.5" fill="#fff" /></>}
          {coding
            ? <ellipse cx="58.5" cy="57" rx="3.2" ry="2.4" fill="#312e81" />
            : <path d={waving ? 'M 49 54 Q 58.5 63 68 54' : 'M 50 55 Q 58.5 60 67 55'} stroke="#312e81" strokeWidth="2.4" fill="none" strokeLinecap="round" />}
          {(waving || coding) && <><ellipse cx="43" cy="53" rx="5.5" ry="3.6" fill="#f9a8d4" opacity=".45" /><ellipse cx="74" cy="53" rx="5.5" ry="3.6" fill="#f9a8d4" opacity=".45" /></>}
        </g>

        {waving && (
          <g className="cb-arm">
            <ellipse cx="96" cy="52" rx="8.5" ry="7.5" fill="url(#cb-g)" />
            <path d="M90 44v5m3-6.5v6.5m3-5.5v5.5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" fill="none" />
          </g>
        )}

        {coding && (
          <g>
            {/* ноутбук */}
            <path d="M30 96 L40 74 H80 L90 96 Z" fill="#1e1b4b" />
            <rect x="38" y="68" width="44" height="28" rx="3" fill="#0f0d2e" stroke="#6366f1" strokeWidth="1.2" />
            <g className="cb-lines" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round">
              <line x1="43" y1="75" x2="58" y2="75" /><line x1="47" y1="80" x2="70" y2="80" stroke="#818cf8" /><line x1="43" y1="85" x2="54" y2="85" /><line x1="58" y1="85" x2="74" y2="85" stroke="#c4b5fd" />
            </g>
            <rect className="cb-caret" x="75" y="83" width="2.4" height="5" rx="1" fill="#e9d5ff" />
            {/* лапки на клавиатуре */}
            <ellipse className="cb-paw cb-paw1" cx="48" cy="93" rx="6" ry="4" fill="url(#cb-g)" />
            <ellipse className="cb-paw cb-paw2" cx="72" cy="93" rx="6" ry="4" fill="url(#cb-g)" />
            {/* летящие символы кода */}
            <text className="cb-sym cb-s1" x="26" y="56" fontSize="11" fill="#8b5cf6" fontFamily="ui-monospace,monospace" fontWeight="700">{'</>'}</text>
            <text className="cb-sym cb-s2" x="92" y="52" fontSize="11" fill="#6366f1" fontFamily="ui-monospace,monospace" fontWeight="700">{'{ }'}</text>
            <text className="cb-sym cb-s3" x="84" y="40" fontSize="10" fill="#a78bfa" fontFamily="ui-monospace,monospace" fontWeight="700">;</text>
          </g>
        )}
      </svg>
    </div>
  );
};
