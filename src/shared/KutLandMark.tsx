/**
 * Подпись «KutLand» внизу заставок входа. Логотип компании лежит в public/kutland.svg или public/kutland.png:
 * если файла нет, показывается только текст (битая картинка не рисуется).
 */
import { useEffect, useState } from 'react';

const SOURCES = ['/kutland.svg', '/kutland.png'];

export const KutLandMark = ({ light = false, style }: { light?: boolean; style?: React.CSSProperties }) => {
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const src of SOURCES) {
        const ok = await new Promise<boolean>((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = src; });
        if (ok) { if (alive) setLogo(src); return; }
      }
    })();
    return () => { alive = false; };
  }, []);
  return (
    <div translate="no" aria-label="KutLand" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, fontWeight: 600, letterSpacing: '0.14em',
      color: light ? '#6b6e80' : '#8a8a96', opacity: 0.75, userSelect: 'none', ...style }}>
      {logo && <img src={logo} alt="" style={{ height: 14, width: 'auto', objectFit: 'contain' }} />}
      <span>KutLand</span>
    </div>
  );
};
