/**
 * Показ вложений.
 *
 * Адрес вида /api/files/… нельзя просто подставить в src: токен доступа
 * живёт в памяти вкладки, и браузер его к запросу картинки не приложит.
 * Поэтому файл скачивается обычным запросом — с тем же подтверждением
 * прав, что и остальное API, — и показывается уже из памяти.
 *
 * Скачанное держим ограниченным числом: у каждой такой ссылки есть своя
 * память в браузере, и без потолка длинная переписка с фотографиями
 * съедала бы её всю.
 */
import { useEffect, useState } from 'react';
import { apiFetchFile } from '@/core/auth/api';
import { useSettings } from '@/settings/store';

const MAX_CACHED = 40;

const cache = new Map<string, string>();          // адрес → ссылка в памяти
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

/**
 * Готовая к показу ссылка. Пока файл качается — undefined; если файл
 * недоступен (вышли из чата, сообщение удалили) — тоже.
 *
 * При выключенной авто-загрузке файл не качается сам: возвращается
 * withhold = true, и разметка показывает кнопку «загрузить». Раньше
 * тумблер «Авто-загрузка медиа» стоял в настройках и не значил ничего —
 * на мобильном трафике это заметно.
 */
export const useAttachment = (src?: string) => {
  const auto = useSettings(st => st.settings.autoDownloadMedia);
  const [ready, setReady] = useState<string | undefined>(
    src && src.startsWith('/api/files/') ? cache.get(src) : src,
  );
  // Отдельная просьба пользователя пересиливает выключенную авто-загрузку.
  const [asked, setAsked] = useState(false);

  const remote = Boolean(src && src.startsWith('/api/files/'));
  const cached = remote && src ? cache.get(src) : undefined;
  const withhold = remote && !auto && !asked && !cached;

  useEffect(() => { setAsked(false); }, [src]);

  useEffect(() => {
    if (!src) { setReady(undefined); return; }
    // Своё, ещё не отправленное вложение показывается прямо из вкладки.
    if (!remote) { setReady(src); return; }

    const known = cache.get(src);
    if (known) { setReady(known); return; }
    if (!auto && !asked) { setReady(undefined); return; }

    let alive = true;
    setReady(undefined);
    void load(src).then((url) => { if (alive) setReady(url ?? undefined); });
    return () => { alive = false; };
  }, [src, remote, auto, asked]);

  return { url: ready, withhold, request: () => setAsked(true) };
};

/** Забыть скачанное — например при выходе из аккаунта. */
export const clearAttachmentCache = () => {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
  inFlight.clear();
};
