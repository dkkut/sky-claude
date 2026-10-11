/**
 * Проигрыватель видеообзора склада или пункта выдачи.
 *
 * Тег <video> не шлёт заголовок Authorization, поэтому запись открывается по
 * пропуску (кука или ?t=). Раньше экран очереди его не запрашивал и видео
 * оставалось чёрным. Здесь пропуск берётся перед показом, а при сбое
 * обновляется и запрос повторяется один раз; если и это не помогло —
 * человек видит причину и кнопку «Повторить», а не пустой чёрный прямоугольник.
 */
import { useEffect, useRef, useState } from 'react';
import { C } from '../SkyMarket';
import { apiMarketTicket } from '../marketApi';
import { videoUrl } from './sharedApi';

export const ReviewVideo = ({ id, maxHeight = 260 }: { id: string; maxHeight?: number }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);

  const start = async () => {
    setFailed(false);
    await apiMarketTicket().catch(() => false);
    setSrc(`${videoUrl(id)}${videoUrl(id).includes('?') ? '&' : '?'}n=${Date.now()}`);
  };

  useEffect(() => { retried.current = false; void start(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const onError = () => {
    if (!retried.current) { retried.current = true; void start(); return; }
    setFailed(true);
  };

  return (
    <div className="mt-2">
      {src && !failed && (
        <video src={src} controls playsInline preload="metadata" onError={onError}
          className="w-full rounded-xl" style={{ maxHeight, background: '#000' }} />
      )}
      {failed && (
        <div className="rounded-xl p-3 text-center" style={{ background: C.l2 }}>
          <p className="text-[11px]" style={{ color: C.red }}>
            Запись не открылась: файл ещё загружается, удалён или формат не поддерживается этим устройством.
          </p>
          <button type="button" onClick={() => { retried.current = false; void start(); }}
            className="mt-2 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white" style={{ background: C.acc }}>
            Повторить
          </button>
        </div>
      )}
    </div>
  );
};
