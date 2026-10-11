/**
 * Заказы без сети. Пока связь есть, фоном запоминаем заказы человека, их трек-номер и последнее
 * сообщение чата сделки; без связи экран «Офлайн → Заказы» показывает именно это.
 * Сообщения, написанные в чате заказа без сети, лежат в очереди и уходят на сервер сами, как только связь
 * вернулась. Кэш — копия: правду решает сервер, права и статусы он проверяет заново при отправке.
 */
import { useSyncExternalStore } from 'react';
import { useAuthStore } from '@/core/auth/store';
import { apiOrders, apiDealChats, apiShipment, apiSendDealMessage, apiOrderChat } from '@/marketplace/marketApi';
import type { Order } from '@/marketplace/types';

export interface CachedOrder {
  id: string; title: string; status: string; role: string; total: number; updatedAt: string;
  /** Трек-номер отправления, если он уже есть. */
  tracking: string | null; carrier: string | null; shipStatus: string | null;
  chatId: string | null; lastMessage: string | null; lastAt: string | null;
}
export interface OutMessage { id: string; orderId: string; chatId: string; text: string; at: number; error?: string }

const W = typeof window !== 'undefined';
const uid = () => useAuthStore.getState().currentUserId ?? '';
const kOrders = () => `sky:offline:orders:v1:${uid()}`;
const kOut = () => `sky:offline:dealout:v1:${uid()}`;

const read = <T,>(key: string, fallback: T): T => { if (!W) return fallback; try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const write = (key: string, v: unknown) => { if (W) try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* места нет — не страшно */ } };

let orders: CachedOrder[] = [];
let outbox: OutMessage[] = [];
let loadedFor = '';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const ensure = () => {
  const u = uid();
  if (u === loadedFor) return;
  loadedFor = u;
  orders = u ? read<CachedOrder[]>(kOrders(), []) : [];
  outbox = u ? read<OutMessage[]>(kOut(), []) : [];
};

export const getCachedOrders = () => { ensure(); return orders; };
export const getOutbox = () => { ensure(); return outbox; };

const snapshotKey = () => `${orders.length}:${outbox.length}:${orders[0]?.lastAt ?? ''}:${loadedFor}`;
export const useOrdersCache = () => {
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, snapshotKey, () => '');
  return { orders: getCachedOrders(), outbox: getOutbox() };
};

const pool = async <T,>(items: T[], n: number, fn: (x: T) => Promise<void>) => {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const x = items[i]; i += 1; await fn(x); } }));
};

let refreshing = false;
/** Обновить копию заказов. Без связи тихо ничего не делает — старая копия остаётся. */
export const refreshOrdersCache = async () => {
  ensure();
  if (refreshing || !uid() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  refreshing = true;
  try {
    const [b, s, chats] = await Promise.all([apiOrders('buyer'), apiOrders('seller'), apiDealChats(100)]);
    if (!b.ok && !s.ok) return;
    const byId = new Map<string, Order>();
    for (const o of [...(b.data?.items ?? []), ...(s.data?.items ?? [])]) byId.set(o.id, o);
    const chatBy = new Map((chats.data?.chats ?? []).map((c) => [c.orderId, c]));
    const prev = new Map(orders.map((o) => [o.id, o]));
    const list = [...byId.values()].sort((x, y) => (y.updatedAt ?? '').localeCompare(x.updatedAt ?? '')).slice(0, 40);
    const next: CachedOrder[] = list.map((o) => {
      const old = prev.get(o.id); const c = chatBy.get(o.id);
      return {
        id: o.id, title: o.title, status: o.status, role: o.role, total: o.total, updatedAt: o.updatedAt ?? o.createdAt ?? '',
        tracking: old?.tracking ?? null, carrier: old?.carrier ?? null, shipStatus: old?.shipStatus ?? null,
        chatId: c?.id ?? old?.chatId ?? null, lastMessage: c?.lastMessage ?? old?.lastMessage ?? null, lastAt: c?.lastAt ?? old?.lastAt ?? null,
      };
    });
    await pool(next, 4, async (o) => {
      const r = await apiShipment(o.id);
      if (r.ok && r.data?.shipment) {
        o.tracking = r.data.shipment.tracking ?? null; o.carrier = r.data.shipment.carrier?.title ?? null; o.shipStatus = r.data.shipment.statusText ?? null;
      }
    });
    orders = next; write(kOrders(), orders); emit();
  } finally { refreshing = false; }
};

/** Поставить сообщение в чат заказа в очередь (без связи) — или сразу отправить, если связь есть. */
export const sendDealMessageOffline = async (o: CachedOrder, text: string): Promise<'sent' | 'queued'> => {
  ensure();
  const t = text.trim();
  if (!t || !o.chatId) return 'queued';
  const item: OutMessage = { id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, orderId: o.id, chatId: o.chatId, text: t, at: Date.now() };
  outbox = [...outbox, item]; write(kOut(), outbox);
  o.lastMessage = t; o.lastAt = new Date().toISOString(); write(kOrders(), orders);
  emit();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'queued';
  await flushDealOutbox();
  return getOutbox().some((m) => m.id === item.id) ? 'queued' : 'sent';
};

let flushing = false;
/** Отправить накопленное. Сетевой сбой — оставляем и ждём; отказ сервера — помечаем, не теряем молча. */
export const flushDealOutbox = async () => {
  ensure();
  if (flushing || outbox.length === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  flushing = true;
  try {
    for (const m of [...outbox]) {
      if (m.error) continue;
      const r = await apiSendDealMessage(m.chatId, m.text);
      if (r.ok) outbox = outbox.filter((x) => x.id !== m.id);
      else if (r.status === 0) break; // связи всё ещё нет
      else outbox = outbox.map((x) => (x.id === m.id ? { ...x, error: r.reason ?? 'Не отправлено' } : x));
      write(kOut(), outbox); emit();
    }
    void refreshOrdersCache();
  } finally { flushing = false; }
};

export const dropOutMessage = (id: string) => { ensure(); outbox = outbox.filter((m) => m.id !== id); write(kOut(), outbox); emit(); };

/** Последние сообщения чата заказа для открытого в офлайне заказа (из кэша не берём — их там только последнее). */
export const loadOrderChatSafe = async (orderId: string) => { const r = await apiOrderChat(orderId, 20); return r.ok ? r.data?.messages ?? null : null; };

/** Запуск слежения: обновлять копию и досылать очередь. Возвращает остановку. */
export const startOrdersSync = (): (() => void) => {
  ensure();
  void refreshOrdersCache(); void flushDealOutbox();
  const onOnline = () => { void flushDealOutbox(); void refreshOrdersCache(); };
  const onVis = () => { if (document.visibilityState === 'visible') onOnline(); };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVis);
  const t = setInterval(() => { void refreshOrdersCache(); }, 10 * 60_000);
  return () => { window.removeEventListener('online', onOnline); document.removeEventListener('visibilitychange', onVis); clearInterval(t); };
};
