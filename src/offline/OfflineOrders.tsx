/* Заказы в офлайне: трек-номер и последнее сообщение из копии, написанное без связи уходит после переподключения. */
import { useState } from 'react';
import { ChevronLeft, Package, Copy, Check, Clock, Send, AlertTriangle, X } from 'lucide-react';
import { flash } from '@/shared/flash';
import { useOrdersCache, sendDealMessageOffline, dropOutMessage, type CachedOrder } from './ordersCache';

const STATUS: Record<string, string> = {
  created: 'Создан', payment_pending: 'Ждёт оплаты', buyer_payment_declared: 'Оплата заявлена', seller_payment_confirmed: 'Оплата подтверждена',
  fulfillment: 'Выдаётся', seller_shipped: 'Отправлен', in_transit: 'В пути', ready_for_pickup: 'Готов к выдаче',
  buyer_received: 'Получен', completed: 'Завершён', cancelled: 'Отменён', disputed: 'Спор',
};
const when = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
};

const Track = ({ value }: { value: string }) => {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => flash('Не удалось скопировать')); }}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold tabular-nums" aria-label="Копировать трек-номер"
      style={{ background: 'rgba(79,110,247,0.14)', color: 'var(--accent)' }}>
      <span translate="no">{value}</span>{done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
};

const Detail = ({ order, onBack }: { order: CachedOrder; onBack: () => void }) => {
  const { outbox } = useOrdersCache();
  const [text, setText] = useState('');
  const mine = outbox.filter((m) => m.orderId === order.id);
  const send = async () => {
    const t = text.trim(); if (!t) return;
    if (!order.chatId) { flash('Чат по этому заказу ещё не создан'); return; }
    setText('');
    await sendDealMessageOffline(order, t);
  };
  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg)' }}>
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ background: 'var(--bg-l1)', borderBottom: '1px solid var(--border)' }}>
        <button type="button" onClick={onBack} aria-label="Назад" className="grid h-8 w-8 place-items-center rounded-full"><ChevronLeft size={20} style={{ color: 'var(--t2)' }} /></button>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{order.title}</p>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{STATUS[order.status] ?? order.status}</p></div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: 'none' }}>
        <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Трек-номер</p>
          {order.tracking ? <Track value={order.tracking} /> : <p className="text-sm" style={{ color: 'var(--t2)' }}>Пока не присвоен</p>}
          {(order.carrier || order.shipStatus) && <p className="mt-2 text-xs" style={{ color: 'var(--t2)' }}>{[order.carrier, order.shipStatus].filter(Boolean).join(' · ')}</p>}
        </div>
        <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Последнее сообщение</p>
          {order.lastMessage ? <><p className="whitespace-pre-wrap break-words text-sm" style={{ color: 'var(--t1)' }} translate="no">{order.lastMessage}</p>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--t3)' }}>{when(order.lastAt)}</p></> : <p className="text-sm" style={{ color: 'var(--t2)' }}>Сообщений пока нет</p>}
        </div>
        {mine.length > 0 && (
          <div className="space-y-2">
            <p className="px-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Ждёт отправки</p>
            {mine.map((m) => (
              <div key={m.id} className="flex items-start gap-2 rounded-2xl px-4 py-3" style={{ background: 'rgba(79,110,247,0.12)', border: `1px solid ${m.error ? 'var(--red)' : 'rgba(79,110,247,0.3)'}` }}>
                {m.error ? <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--red)' }} /> : <Clock size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />}
                <div className="min-w-0 flex-1"><p className="whitespace-pre-wrap break-words text-sm" style={{ color: 'var(--t1)' }} translate="no">{m.text}</p>
                  <p className="mt-0.5 text-[11px]" style={{ color: m.error ? 'var(--red)' : 'var(--t3)' }}>{m.error ?? 'Отправится, когда появится связь'}</p></div>
                <button type="button" aria-label="Убрать" onClick={() => dropOutMessage(m.id)} className="shrink-0"><X size={14} style={{ color: 'var(--t3)' }} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-end gap-2 px-3 py-3" style={{ background: 'var(--bg-l1)', borderTop: '1px solid var(--border)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <div className="flex flex-1 items-end rounded-[26px] px-4 py-2.5" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', minHeight: 46 }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Сообщение по заказу…" aria-label="Сообщение по заказу"
            className="flex-1 resize-none bg-transparent py-0.5 text-sm outline-none" style={{ color: 'var(--t1)', maxHeight: 110 }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        </div>
        <button type="button" onClick={() => { void send(); }} disabled={!text.trim()} aria-label="Отправить" className="grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-40" style={{ background: 'var(--accent)' }}>
          <Send size={18} className="text-white" />
        </button>
      </div>
    </div>
  );
};

export const OfflineOrders = () => {
  const { orders, outbox } = useOrdersCache();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = orders.find((o) => o.id === openId);
  if (open) return <Detail order={open} onBack={() => setOpenId(null)} />;
  if (orders.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <Package size={40} style={{ color: 'var(--t3)' }} />
        <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>Сохранённых заказов нет</p>
        <p className="text-xs" style={{ color: 'var(--t3)' }}>Заказы и их трек-номера запоминаются, пока есть связь</p>
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
      {orders.map((o) => {
        const pending = outbox.filter((m) => m.orderId === o.id).length;
        return (
          <button key={o.id} type="button" onClick={() => setOpenId(o.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl" style={{ background: 'rgba(79,110,247,0.14)' }}><Package size={18} style={{ color: 'var(--accent)' }} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: 'var(--t1)' }} translate="no">{o.title}</p>
                <span className="shrink-0 text-[10px]" style={{ color: 'var(--t3)' }}>{when(o.lastAt || o.updatedAt)}</span></div>
              <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{STATUS[o.status] ?? o.status}{o.tracking ? <> · <span translate="no">{o.tracking}</span></> : ''}</p>
              <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--t2)' }} translate="no">{o.lastMessage ?? '—'}</p>
              {pending > 0 && <p className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: 'var(--accent)' }}><Clock size={11} /> {`Ждёт отправки: ${pending}`}</p>}
            </div>
          </button>
        );
      })}
    </div>
  );
};
