/** Фото/видео историй. Теги <img>/<video> не шлют Authorization, а ручка /api/stories/media/* требует вход, поэтому файл берётся запросом с токеном и показывается через blob-ссылку. */
import { forwardRef, useEffect, useState } from 'react';
import { apiBlob } from '@/core/auth/api';

const cache = new Map<string, string>();   // путь → blob-ссылка (живёт, пока открыта вкладка; истории короткоживущие)
const pending = new Map<string, Promise<string>>();

export const loadStoryBlob = (path: string): Promise<string> => {
  const hit = cache.get(path); if (hit) return Promise.resolve(hit);
  const p = pending.get(path); if (p) return p;
  const job = apiBlob(path).then((r) => {
    if (!r.ok || !r.blob) throw new Error(`story media ${r.status}`);
    const u = URL.createObjectURL(r.blob); cache.set(path, u); return u;
  }).finally(() => pending.delete(path));
  pending.set(path, job); return job;
};

/** Адрес для тега: blob-ссылка для /api/... или как есть (локальный предпросмотр blob:/data:). */
export const useStoryUrl = (src?: string) => {
  const direct = !src || !src.startsWith('/api/');
  const [url, setUrl] = useState<string | undefined>(direct ? src : cache.get(src!));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (direct) { setUrl(src); setFailed(false); return; }
    let alive = true; setFailed(false);
    const hit = cache.get(src!); if (hit) { setUrl(hit); return; }
    setUrl(undefined);
    loadStoryBlob(src!).then((u) => { if (alive) setUrl(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [src, direct]);
  return { url, failed };
};

export const StoryImg = ({ src, className, onClick }: { src?: string; className?: string; onClick?: () => void }) => {
  const { url, failed } = useStoryUrl(src);
  if (failed) return <div className={className} style={{ display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.6)', fontSize: 12 }}>Не удалось загрузить</div>;
  return url ? <img src={url} alt="" className={className} onClick={onClick} /> : <div className={className} style={{ background: 'rgba(255,255,255,.06)' }} />;
};

export const StoryVideo = forwardRef<HTMLVideoElement, { src?: string; className?: string; autoPlay?: boolean; loop?: boolean; muted?: boolean; controls?: boolean; style?: React.CSSProperties; onClick?: React.MouseEventHandler<HTMLVideoElement> }>(({ src, ...rest }, ref) => {
  const { url, failed } = useStoryUrl(src);
  if (failed) return <div className={rest.className} style={{ display: 'grid', placeItems: 'center', color: 'rgba(255,255,255,.6)', fontSize: 12 }}>Не удалось загрузить</div>;
  return url ? <video ref={ref} src={url} playsInline {...rest} /> : <div className={rest.className} style={{ background: 'rgba(255,255,255,.06)' }} />;
});
StoryVideo.displayName = 'StoryVideo';
