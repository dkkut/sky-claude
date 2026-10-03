/* ===============================================================
   PET MEDIA — показ превью/модели скина Sky Skin Market.

   /api/pets/market/media/:id авторизован токеном как и всё API
   (requireProfile), поэтому прямой <img src="/api/pets/market/media/…">
   не сработает: токен живёт в памяти вкладки, браузер его к запросу
   картинки не приложит. Тот же приём, что и в messenger/mediaCache.ts —
   качаем обычным запросом с тем же подтверждением прав и показываем
   уже из памяти. Отдельный маленький кэш вместо переиспользования
   mediaCache.ts: тот жёстко завязан на префикс /api/files/ и настройку
   автозагрузки вложений в чате, что тут не к месту.
=============================================================== */
import { useEffect, useState } from 'react';
import { apiFetchFile } from '@/core/auth/api';

const MAX_CACHED = 60;
const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

const remember = (path: string, objectUrl: string) => {
  cache.set(path, objectUrl);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    const url = cache.get(oldest);
    cache.delete(oldest);
    if (url) URL.revokeObjectURL(url);
  }
};

const load = (path: string): Promise<string | null> => {
  const ready = cache.get(path);
  if (ready) return Promise.resolve(ready);
  const running = inFlight.get(path);
  if (running) return running;

  const task = apiFetchFile(path).then((blob) => {
    inFlight.delete(path);
    if (!blob) return null;
    const objectUrl = URL.createObjectURL(blob);
    remember(path, objectUrl);
    return objectUrl;
  }).catch(() => { inFlight.delete(path); return null; });

  inFlight.set(path, task);
  return task;
};

/** Ссылка в памяти для показа — undefined пока качается или если пути нет. */
export const usePetMedia = (path?: string): string | undefined => {
  const [url, setUrl] = useState<string | undefined>(path ? cache.get(path) : undefined);
  useEffect(() => {
    if (!path) { setUrl(undefined); return; }
    const known = cache.get(path);
    if (known) { setUrl(known); return; }
    let alive = true;
    setUrl(undefined);
    void load(path).then((u) => { if (alive) setUrl(u ?? undefined); });
    return () => { alive = false; };
  }, [path]);
  return url;
};
