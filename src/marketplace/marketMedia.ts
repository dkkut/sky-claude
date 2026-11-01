/**
 * Картинки Market (товар, логотип, обложка игры, аватар магазина) грузятся тегом <img>, а он не шлёт заголовок входа — нужен пропуск
 * (кука или ?t=). Раньше пропуск запрашивался при входе в Market, а картинки рисовались сразу: первые запросы уходили без пропуска (401),
 * и обложка навсегда заменялась значком. Здесь: картинки ждут пропуск, а при отказе пропуск обновляется и запрос повторяется один раз.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiMarketTicket, getMarketMediaTicket } from './marketApi';

let job: Promise<boolean> | null = null;
let got = false;
export const ensureMarketTicket = (force = false): Promise<boolean> => {
  if (!force && (got || getMarketMediaTicket())) return Promise.resolve(true);
  job ??= apiMarketTicket().catch(() => false).then((ok) => { if (ok) got = true; return ok; }).finally(() => { setTimeout(() => { job = null; }, 1500); });
  return job;
};

/** ready — пропуск есть; fail(fallback) — вызвать из onError: один раз обновит пропуск и перерисует картинку, потом уже fallback. nonce меняйте как key. */
export const useMarketImage = () => {
  const [ready, setReady] = useState(() => got || !!getMarketMediaTicket());
  const [retried, setRetried] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => { let alive = true; void ensureMarketTicket().then(() => { if (alive) setReady(true); }); return () => { alive = false; }; }, []);
  const fail = useCallback((fallback: () => void) => {
    if (retried) { fallback(); return; }
    setRetried(true);
    void ensureMarketTicket(true).then(() => setNonce((n) => n + 1));
  }, [retried]);
  const reset = useCallback(() => { setRetried(false); }, []);
  return { ready, fail, nonce, reset };
};
