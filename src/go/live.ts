/**
 * Живые обновления Sky GO. Сервер присылает по сокету `go:order` (заказ изменился) — экран перечитывает данные сразу,
 * не дожидаясь опроса. Опрос остаётся запасом: если сокет отвалился, данные всё равно обновятся.
 */
import { useEffect } from 'react';

export const GO_ORDER_EVENT = 'sky:go-order';
export const emitGoOrder = (orderId?: string, status?: string) => { try { window.dispatchEvent(new CustomEvent(GO_ORDER_EVENT, { detail: { orderId, status } })); } catch { /* ok */ } };
export const useGoLive = (onChange: (orderId?: string) => void) => {
  useEffect(() => {
    const h = (e: Event) => onChange((e as CustomEvent).detail?.orderId);
    window.addEventListener(GO_ORDER_EVENT, h);
    return () => window.removeEventListener(GO_ORDER_EVENT, h);
  }, [onChange]);
};

/** Последнее известное состояние с отметкой времени: без связи показываем его, а не пустой экран, и честно пишем, на когда оно. */
export const cacheGet = <T,>(key: string): { at: number; data: T } | null => {
  try { const raw = localStorage.getItem(`sky:go:cache:${key}`); return raw ? JSON.parse(raw) : null; } catch { return null; }
};
export const cacheSet = (key: string, data: unknown) => { try { localStorage.setItem(`sky:go:cache:${key}`, JSON.stringify({ at: Date.now(), data })); } catch { /* ok */ } };
