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
