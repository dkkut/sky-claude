/**
 * Пропуск на медиа живёт 6 часов (server/musicticket.mjs и его аналоги),
 * а запрашивается при открытии раздела. Открытая дольше вкладка после
 * этого получала 401 на каждый кусок видео и звука, пока её не
 * перезагрузят. Здесь пропуск обновляется заранее: по таймеру и сразу
 * при возврате на вкладку, где таймер мог быть приостановлен браузером.
 */
const REFRESH_MS = 4 * 60 * 60 * 1000;

export const withTicketRefresh = (request: () => Promise<boolean>) => {
  let issuedAt = 0;
  let started = false;

  const run = async () => {
    const ok = await request();
    if (ok) issuedAt = Date.now();
    return ok;
  };

  return async () => {
    const ok = await run();
    if (ok && !started && typeof document !== 'undefined') {
      started = true;
      setInterval(() => { void run(); }, REFRESH_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - issuedAt > REFRESH_MS) void run();
      });
    }
    return ok;
  };
};

/**
 * Файл не открылся — чаще всего просто протух пропуск (вкладка открыта
 * давно, телефон вышел из сна). Обновляем его и перезагружаем элемент с
 * того же места; решать, показывать ли ошибку, остаётся за вызывающим:
 * false — пропуск не выдали, повтор бессмысленен.
 */
export const reloadWithFreshTicket = async (
  el: HTMLMediaElement,
  refresh: () => Promise<boolean>,
  url: () => string,
): Promise<boolean> => {
  const at = el.currentTime;
  if (!(await refresh())) return false;
  el.src = url();
  el.load();
  if (at > 0) el.addEventListener('loadedmetadata', () => { el.currentTime = at; }, { once: true });
  return true;
};

const MEDIA_ERR = ['', 'загрузка прервана', 'сеть', 'не удалось декодировать', 'формат или доступ не поддерживается'];

/**
 * Что именно не так с файлом: код ошибки элемента и ответ сервера на
 * тот же адрес. «Воспроизведение прервалось» без причины не помогает ни
 * человеку, ни тому, кто разбирает жалобу.
 */
export const describeMediaFailure = async (el: HTMLMediaElement | null, url: string): Promise<string> => {
  const code = el?.error?.code ?? 0;
  let http = '';
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1' }, credentials: 'include' });
    http = `ответ сервера ${r.status}${r.headers.get('content-type') ? ` (${r.headers.get('content-type')})` : ''}`;
    if (r.status === 403) {
      // Ограничение Sky Media (server/mediarestrict.mjs): понятный текст вместо кода ошибки плеера.
      const j = await r.clone().json().catch(() => null) as { error?: string; restriction?: { scope?: string } } | null;
      if (j?.error === 'media_blocked') return j.restriction?.scope === 'author_direction' ? 'Доступ к материалам этого автора в этом разделе ограничен.' : 'Доступ к этому произведению ограничен.';
    }
    void r.body?.cancel();
  } catch { http = 'сервер недоступен'; }
  return `Код ${code}${MEDIA_ERR[code] ? `: ${MEDIA_ERR[code]}` : ''}; ${http}`;
};

/** HTTP-статус файла (0 — сервер не ответил). Нужен, чтобы отличить «сломан этот файл» от «отказ на всё». */
export const mediaStatus = async (url: string): Promise<number> => {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1' }, credentials: 'include' });
    void r.body?.cancel();
    return r.status;
  } catch { return 0; }
};
