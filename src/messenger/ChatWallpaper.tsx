/* Слой обоев за сообщениями чата. Родитель обязан быть `relative isolate` — слой лежит на z-index -1. */
import { useEffect, useState } from 'react';
import { WALLPAPERS, effectiveWallpaper, getWallpaperBlob, useWallpapers } from './wallpapers';

export const ChatWallpaper = ({ chatId, light }: { chatId?: string; light?: boolean }) => {
  const global = useWallpapers((s) => s.global);
  const chats = useWallpapers((s) => s.chats);
  const rev = useWallpapers((s) => s.imgRev);
  const { spec, key } = effectiveWallpaper({ global, chats }, chatId);
  const [url, setUrl] = useState<string>('');

  useEffect(() => {
    if (spec.kind !== 'image') { setUrl(''); return undefined; }
    let alive = true; let obj = '';
    void getWallpaperBlob(key).then((b) => { if (alive && b) { obj = URL.createObjectURL(b); setUrl(obj); } else if (alive) setUrl(''); });
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [spec.kind, key, rev]);

  if (spec.kind === 'none') return null;
  const preset = spec.kind === 'preset' ? WALLPAPERS.find((p) => p.id === spec.id) : null;
  if (spec.kind === 'preset' && !preset) return null;
  if (spec.kind === 'image' && !url) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: -1 }} data-keep-dark="">
      <div className="absolute inset-0" style={{
        background: preset ? preset.background : `center / cover no-repeat url("${url}")`,
        backgroundSize: preset?.size ?? (preset ? 'cover' : undefined),
        filter: spec.blur ? `blur(${spec.blur}px)` : undefined,
        transform: spec.blur ? 'scale(1.08)' : undefined,
      }} />
      {spec.dim > 0 && <div className="absolute inset-0" style={{ background: `rgba(${light ? '255,255,255' : '0,0,0'},${spec.dim / 100})` }} />}
    </div>
  );
};
