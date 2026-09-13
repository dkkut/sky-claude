/**
 * Sky Market: сделка на экране.
 *
 * Кнопки здесь рисуются по состоянию, которое пришло с сервера, и
 * нажатие уходит названием действия — accept, declare_paid,
 * confirm_paid, fulfill, received. Нового состояния клиент не
 * присылает: его выбирает машина переходов на сервере. Нарисовать себе
 * лишнюю кнопку можно; нажатие всё равно упрётся в правило.
 *
 * Про деньги сказано прямо и на экране: Sky их не держит, покупатель
 * переводит продавцу напрямую, и подтверждения «отправил» и «получил» —
 * это слова сторон, а не проверка перевода.
 */
import { useEffect, useState, useRef } from 'react';
import {
  ArrowLeft, Send, Truck, Package, MapPin, Clock, ShieldAlert,
  CheckCircle2, XCircle, Store, MessageSquare, Star, Warehouse, User,
} from 'lucide-react';
import {
  C, fmt, fmtTime, Empty, Field, inputStyle, Alert,
} from './ui';
import {
  apiOrder, apiOrderAction, apiCancelOrder, apiDisputeOrder, apiMarkPacking,
  apiLeaveReview, apiOrderChat, apiSendDealMessage, apiReadDealChat,
  apiPickupPoints, apiCarriers, apiShipOrder, apiMoveShipment, apiOrderHistory,
} from './marketApi';
import type {
  Order, Shipment, ChatMessage, OrderAction, OrderEvent,
  PickupPoint, Carrier, ShipMethod, ShipDestination,
} from './types';
import { ORDER_LABEL } from './types';

/* ── Что кому можно нажать ────────────────────────────────────────
   Это повторение серверной таблицы переходов — только для того,
   чтобы не рисовать кнопку, которая наверняка получит отказ. Право
   решает сервер: сюда можно дописать что угодно, нажатие упрётся в
   его проверку.                                                    */

const NEXT: Record<string, { action: OrderAction; who: 'buyer' | 'seller'; label: string; note?: string }[]> = {
  created: [{ action: 'accept', who: 'seller', label: 'Принять заказ' }],
  payment_pending: [{
    action: 'declare_paid', who: 'buyer', label: 'Отправил деньги',
    note: 'Переведите продавцу напрямую — Sky денег не принимает и не хранит.',
  }],
  buyer_payment_declared: [{
    action: 'confirm_paid', who: 'seller', label: 'Получил деньги',
    note: 'Проверьте поступление у себя: Sky перевод не видит.',
  }],
  seller_payment_confirmed: [{ action: 'fulfill', who: 'seller', label: 'Выдать заказ' }],
  fulfillment: [{ action: 'received', who: 'buyer', label: 'Подтверждаю выдачу товара' }],
  seller_shipped: [{ action: 'received', who: 'buyer', label: 'Подтверждаю получение' }],
  in_transit: [{ action: 'received', who: 'buyer', label: 'Подтверждаю получение' }],
  ready_for_pickup: [{ action: 'received', who: 'buyer', label: 'Забрал из пункта выдачи' }],
};

const STATUS_COLOR: Record<string, string> = {
  created: C.t3,
  payment_pending: C.amber,
  buyer_payment_declared: C.amber,
  seller_payment_confirmed: C.acc,
  fulfillment: C.acc,
  seller_shipped: '#8b5cf6',
  in_transit: '#8b5cf6',
  ready_for_pickup: C.green,
  buyer_received: C.green,
  completed: C.green,
  cancelled: C.red,
  disputed: C.red,
};

export const StatusChip = ({ status }: { status: Order['status'] }) => (
  <span className="rounded-lg px-2 py-0.5 text-[10px] font-bold"
    style={{ background: C.l2, color: STATUS_COLOR[status] ?? C.t3, border: `1px solid ${C.brd}` }}>
    {ORDER_LABEL[status]}
  </span>
);

/* ── Карточка заказа в списке ─────────────────────────────────────── */

export const OrderRow = ({ order, onOpen }: { order: Order; onOpen: () => void }) => (
  <button type="button" onClick={onOpen}
    className="flex w-full items-center gap-3 rounded-2xl p-3 text-left"
    style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: C.l2 }}>
      {order.marketType === 'game' ? <Store size={16} style={{ color: C.acc }} />
        : <Package size={16} style={{ color: C.acc }} />}
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[12px] font-semibold" style={{ color: C.t1 }}>{order.title}</p>
      <div className="mt-0.5 flex items-center gap-2">
        <StatusChip status={order.status} />
        <span className="text-[10px]" style={{ color: C.t3 }}>{fmtTime(order.createdAt)}</span>
      </div>
    </div>
    <p className="shrink-0 text-sm font-black" style={{ color: C.t1 }}>{fmt(order.total)}</p>
  </button>
);

/* ── Отправка заказа ──────────────────────────────────────────────── */

/**
 * Четыре способа довезти, и все настоящие.
 *
 * Службой — у неё есть трек, и состояние приходит от неё. Сам — трека
 * нет, и состояние двигает продавец руками. Назначение — пункт выдачи
 * или дверь покупателя.
 */
const ShipForm = ({ order, onDone }: { order: Order; onDone: (s: Shipment) => void }) => {
  const [method, setMethod] = useState<ShipMethod>('carrier');
  const [destination, setDestination] = useState<ShipDestination>('pickup_point');
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [points, setPoints] = useState<PickupPoint[]>([]);
  const [carrierId, setCarrierId] = useState('');
  const [pointId, setPointId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [c, p] = await Promise.all([apiCarriers(), apiPickupPoints()]);
      if (c.ok && c.data) setCarriers(c.data.carriers);
      if (p.ok && p.data) setPoints(p.data.points);
    })();
  }, []);

  const send = async () => {
    setBusy(true); setError(null);
    const r = await apiShipOrder(order.id, {
      method,
      destination,
      carrierId: method === 'carrier' ? carrierId : undefined,
      pickupPointId: destination === 'pickup_point' ? pointId : undefined,
    });
    setBusy(false);
    if (!r.ok || !r.data) { setError(r.reason ?? 'Не удалось отправить заказ'); return; }
    onDone(r.data.shipment);
  };

  const ready = (method !== 'carrier' || carrierId) && (destination !== 'pickup_point' || pointId);

  return (
    <div className="space-y-3 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Как отправляем</p>

      <div className="grid grid-cols-2 gap-2">
        {([['carrier', 'Транспортной компанией', Truck], ['seller_self', 'Отвезу сам', User]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setMethod(k)}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold"
            style={{
              background: method === k ? C.accBg : C.l2,
              color: method === k ? C.acc : C.t2,
              border: `1px solid ${method === k ? 'rgba(79,110,247,0.3)' : C.brd}`,
            }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {([['pickup_point', 'В пункт выдачи', Warehouse], ['buyer_address', 'До покупателя', MapPin]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" onClick={() => setDestination(k)}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold"
            style={{
              background: destination === k ? C.accBg : C.l2,
              color: destination === k ? C.acc : C.t2,
              border: `1px solid ${destination === k ? 'rgba(79,110,247,0.3)' : C.brd}`,
            }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {method === 'carrier' && (
        <Field label="Служба доставки"
          hint="У внешней службы появится трек-номер — его выдаёт она, а не мы.">
          <select value={carrierId} onChange={(e) => setCarrierId(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
            <option value="">Выберите службу</option>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}{c.kind === 'inhouse' ? ' (своя компания)' : ''} · от {fmt(c.minPrice)}
              </option>
            ))}
          </select>
        </Field>
      )}

      {destination === 'pickup_point' && (
        <Field label="Пункт выдачи">
          <select value={pointId} onChange={(e) => setPointId(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
            <option value="">Выберите пункт</option>
            {points.map((p) => (
              <option key={p.id} value={p.id}>{p.city}, {p.address} · {p.title}</option>
            ))}
          </select>
        </Field>
      )}

      {destination === 'buyer_address' && (
        <div className="rounded-xl px-3 py-2 text-[11px]" style={{ background: C.l2, color: C.t2 }}>
          Адрес покупателя: {order.address || '—'}
        </div>
      )}

      {error && <Alert text={error} />}

      <button type="button" disabled={!ready || busy} onClick={send}
        className="w-full rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40"
        style={{ background: C.acc, color: '#fff' }}>
        {busy ? 'Отправляем…' : 'Отправить заказ'}
      </button>
    </div>
  );
};

/* ── Посылка ──────────────────────────────────────────────────────── */

const ShipmentCard = ({ shipment, canMove, onMoved }:
{ shipment: Shipment; canMove: boolean; onMoved: (s: Shipment) => void }) => {
  const [busy, setBusy] = useState(false);

  const move = async (status: 'in_transit' | 'arrived') => {
    setBusy(true);
    const r = await apiMoveShipment(shipment.orderId, status);
    setBusy(false);
    if (r.ok && r.data) onMoved(r.data.shipment);
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex items-center gap-2">
        <Truck size={14} style={{ color: C.acc }} />
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>
          {shipment.method === 'carrier' ? (shipment.carrier?.title ?? 'Доставка') : 'Продавец везёт сам'}
        </p>
      </div>
      <p className="text-[11px]" style={{ color: C.t2 }}>{shipment.statusText}</p>
      {shipment.tracking && (
        <p className="text-[11px]" style={{ color: C.t3 }}>
          Трек-номер: <span style={{ color: C.t1 }}>{shipment.tracking}</span>
        </p>
      )}
      {shipment.pickupPoint && (
        <div className="rounded-xl px-3 py-2 text-[11px]" style={{ background: C.l2, color: C.t2 }}>
          <p style={{ color: C.t1 }}>{shipment.pickupPoint.title}</p>
          <p>{shipment.pickupPoint.city}, {shipment.pickupPoint.address}</p>
          <p>Работает {shipment.pickupPoint.workFrom}–{shipment.pickupPoint.workTo}</p>
          {shipment.pickupUntil && <p>Забрать до {fmtTime(shipment.pickupUntil)}</p>}
        </div>
      )}
      {shipment.location && (
        <p className="text-[11px]" style={{ color: C.t3 }}>Где сейчас: {shipment.location}</p>
      )}

      {canMove && shipment.method === 'seller_self' && (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => move('in_transit')}
            className="flex-1 rounded-xl py-2 text-[11px] font-bold disabled:opacity-40"
            style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
            Выехал
          </button>
          <button type="button" disabled={busy} onClick={() => move('arrived')}
            className="flex-1 rounded-xl py-2 text-[11px] font-bold disabled:opacity-40"
            style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
            На месте
          </button>
        </div>
      )}
      {canMove && shipment.method === 'carrier' && (
        <p className="text-[10px]" style={{ color: C.t3 }}>
          Состояние посылки приходит от службы доставки. Вручную его менять нельзя.
        </p>
      )}
    </div>
  );
};

/* ── Чат сделки ───────────────────────────────────────────────────── */

/**
 * Переписка по заказу.
 *
 * Это не диалог мессенджера: у него свои таблицы, свои права и своя
 * жизнь, привязанная к сделке. В списке чатов Sky Messenger он не
 * появляется.
 */
export const DealChatView = ({ orderId, meId }: { orderId: string; meId: string }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatId, setChatId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const reload = async () => {
    const r = await apiOrderChat(orderId);
    if (r.ok && r.data) {
      setChatId(r.data.chat.id);
      setMessages(r.data.messages);
      void apiReadDealChat(r.data.chat.id);
    }
  };

  useEffect(() => { void reload(); }, [orderId]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || !chatId) return;
    setBusy(true); setError(null);
    const r = await apiSendDealMessage(chatId, body);
    setBusy(false);
    if (!r.ok || !r.data) { setError(r.reason ?? 'Сообщение не ушло'); return; }
    setText('');
    setMessages((prev) => [...prev, r.data!.message]);
  };

  return (
    <div className="flex flex-col rounded-2xl" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${C.brd}` }}>
        <MessageSquare size={14} style={{ color: C.acc }} />
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Чат по заказу</p>
      </div>

      <div className="max-h-64 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="py-4 text-center text-[11px]" style={{ color: C.t3 }}>
            Договоритесь здесь о переводе: Sky деньги не принимает.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.authorId === meId && m.role !== 'system';
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%] rounded-2xl px-3 py-2"
                style={{
                  background: mine ? C.accBg : C.l2,
                  border: `1px solid ${mine ? 'rgba(79,110,247,0.25)' : C.brd}`,
                }}>
                {m.role === 'support' && (
                  <p className="mb-0.5 text-[9px] font-black" style={{ color: C.amber }}>ПОДДЕРЖКА</p>
                )}
                {m.role === 'system' && (
                  <p className="mb-0.5 text-[9px] font-black" style={{ color: C.t3 }}>SKY MARKET</p>
                )}
                <p className="whitespace-pre-wrap break-words text-[12px]" style={{ color: C.t1 }}>{m.text}</p>
                <p className="mt-0.5 text-[9px]" style={{ color: C.t3 }}>{fmtTime(m.createdAt)}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {error && <div className="px-3 pb-2"><Alert text={error} /></div>}

      <div className="flex items-center gap-2 p-2" style={{ borderTop: `1px solid ${C.brd}` }}>
        <input value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Сообщение продавцу…" maxLength={4000}
          className="flex-1 rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
        <button type="button" onClick={send} disabled={busy || !text.trim()}
          className="grid h-9 w-9 place-items-center rounded-xl disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          <Send size={15} />
        </button>
      </div>
    </div>
  );
};

/* ── Отзыв ────────────────────────────────────────────────────────── */

const ReviewForm = ({ orderId, onDone }: { orderId: string; onDone: () => void }) => {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true); setError(null);
    const r = await apiLeaveReview(orderId, rating, text.trim());
    setBusy(false);
    if (!r.ok) { setError(r.reason ?? 'Отзыв не сохранился'); return; }
    onDone();
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Оставить отзыв</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" onClick={() => setRating(i)}>
            <Star size={22} style={{ color: i <= rating ? C.amber : C.t3 }}
              fill={i <= rating ? C.amber : 'none'} />
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000}
        placeholder="Что понравилось, что нет" className="w-full rounded-xl px-3 py-2 text-[12px]"
        style={inputStyle} />
      {error && <Alert text={error} />}
      <button type="button" disabled={busy} onClick={send}
        className="w-full rounded-xl py-2 text-[12px] font-bold disabled:opacity-40"
        style={{ background: C.acc, color: '#fff' }}>
        {busy ? 'Отправляем…' : 'Отправить отзыв'}
      </button>
    </div>
  );
};

/* ── Страница заказа ──────────────────────────────────────────────── */

export const OrderPage = ({ orderId, meId, onBack, onChanged }:
{ orderId: string; meId: string; onBack: () => void; onChanged?: (o: Order) => void }) => {
  const [order, setOrder] = useState<Order | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const reload = async () => {
    const r = await apiOrder(orderId);
    if (r.ok && r.data) {
      setOrder(r.data.order);
      setShipment(r.data.shipment);
      onChanged?.(r.data.order);
    } else setError(r.reason ?? 'Заказ не открылся');
  };

  useEffect(() => { void reload(); }, [orderId]);

  const act = async (action: OrderAction) => {
    setBusy(true); setError(null);
    const r = await apiOrderAction(orderId, action);
    setBusy(false);
    if (!r.ok || !r.data) { setError(r.reason ?? 'Действие не прошло'); return; }
    setOrder(r.data.order);
    onChanged?.(r.data.order);
    void reload();
  };

  const cancel = async () => {
    const reason = window.prompt('Причина отмены') ?? '';
    setBusy(true); setError(null);
    const r = await apiCancelOrder(orderId, reason);
    setBusy(false);
    if (!r.ok || !r.data) { setError(r.reason ?? 'Отменить не вышло'); return; }
    setOrder(r.data.order);
    onChanged?.(r.data.order);
  };

  const dispute = async () => {
    const reason = window.prompt('Что случилось?') ?? '';
    setBusy(true); setError(null);
    const r = await apiDisputeOrder(orderId, reason);
    setBusy(false);
    if (!r.ok || !r.data) { setError(r.reason ?? 'Спор не открылся'); return; }
    setOrder(r.data.order);
    onChanged?.(r.data.order);
  };

  const packing = async (done: boolean) => {
    const r = await apiMarkPacking(orderId, done);
    if (r.ok && r.data) setOrder(r.data.order);
  };

  const openHistory = async () => {
    setShowHistory((v) => !v);
    if (events.length === 0) {
      const r = await apiOrderHistory(orderId);
      if (r.ok && r.data) setEvents(r.data.events);
    }
  };

  if (!order) {
    return (
      <div className="p-4">
        {error ? <Alert text={error} /> : <p className="text-[12px]" style={{ color: C.t3 }}>Загружаем…</p>}
      </div>
    );
  }

  const iam = order.role;
  const steps = (NEXT[order.status] ?? []).filter((s) => s.who === iam);
  const mayCancel = !['completed', 'cancelled', 'disputed'].includes(order.status)
    && ((iam === 'buyer' && ['created', 'payment_pending'].includes(order.status))
      || (iam === 'seller' && ['created', 'payment_pending', 'buyer_payment_declared'].includes(order.status)));
  const mayDispute = ['buyer_payment_declared', 'seller_payment_confirmed', 'fulfillment',
    'seller_shipped', 'in_transit', 'ready_for_pickup'].includes(order.status);
  const mayShip = iam === 'seller' && order.marketType === 'standard'
    && order.status === 'fulfillment' && !shipment;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.brd}` }}>
        <button type="button" onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5" style={{ color: C.acc }}>
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold" style={{ color: C.t1 }}>{order.title}</p>
          <StatusChip status={order.status} />
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between">
            <p className="text-[11px]" style={{ color: C.t3 }}>
              {order.quantity} шт. × {fmt(order.price)}
            </p>
            <p className="text-lg font-black" style={{ color: C.t1 }}>{fmt(order.total)}</p>
          </div>
          {order.address && (
            <p className="mt-2 text-[11px]" style={{ color: C.t2 }}>
              <MapPin size={11} className="mr-1 inline" />{order.address}
            </p>
          )}
          {order.contact && (
            <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>Связь: {order.contact}</p>
          )}
          {order.cancelReason && (
            <p className="mt-2 text-[11px]" style={{ color: C.red }}>Причина: {order.cancelReason}</p>
          )}
        </div>

        {/* Честно и на видном месте. */}
        <div className="rounded-2xl px-3 py-2 text-[11px]"
          style={{ background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>
          Sky не принимает и не хранит деньги этой сделки. Покупатель переводит продавцу
          напрямую, а «отправил» и «получил» — это отметки сторон, а не проверка перевода.
        </div>

        {steps.map((s) => (
          <div key={s.action} className="space-y-2">
            {s.note && (
              <p className="text-[11px]" style={{ color: C.t3 }}>{s.note}</p>
            )}
            <button type="button" disabled={busy} onClick={() => act(s.action)}
              className="w-full rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40"
              style={{ background: C.acc, color: '#fff' }}>
              {s.label}
            </button>
          </div>
        ))}

        {iam === 'seller' && order.marketType === 'standard'
          && ['seller_payment_confirmed', 'fulfillment'].includes(order.status) && (
          <div className="flex gap-2">
            <button type="button" onClick={() => packing(false)}
              className="flex-1 rounded-xl py-2 text-[11px] font-bold"
              style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
              {order.packingStartedAt ? 'Собираю…' : 'Начать сборку'}
            </button>
            <button type="button" onClick={() => packing(true)}
              className="flex-1 rounded-xl py-2 text-[11px] font-bold"
              style={{ background: C.l2, color: order.packedAt ? C.green : C.t1, border: `1px solid ${C.brd}` }}>
              {order.packedAt ? 'Собран' : 'Собрал'}
            </button>
          </div>
        )}

        {mayShip && <ShipForm order={order} onDone={(s) => { setShipment(s); void reload(); }} />}

        {shipment && (
          <ShipmentCard shipment={shipment} canMove={iam === 'seller'}
            onMoved={(s) => { setShipment(s); void reload(); }} />
        )}

        {order.status === 'completed' && iam === 'buyer' && !reviewed && (
          <ReviewForm orderId={order.id} onDone={() => setReviewed(true)} />
        )}
        {reviewed && (
          <div className="flex items-center gap-2 rounded-2xl p-3"
            style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <CheckCircle2 size={14} style={{ color: C.green }} />
            <p className="text-[11px]" style={{ color: C.t2 }}>Спасибо за отзыв</p>
          </div>
        )}

        <DealChatView orderId={order.id} meId={meId} />

        <button type="button" onClick={openHistory}
          className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-[11px] font-semibold"
          style={{ background: C.l1, color: C.t2, border: `1px solid ${C.brd}` }}>
          <Clock size={13} /> История заказа
        </button>
        {showHistory && (
          <div className="space-y-1 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            {events.length === 0 && <p className="text-[11px]" style={{ color: C.t3 }}>Пока пусто</p>}
            {events.map((e, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span style={{ color: C.t2 }}>
                  {ORDER_LABEL[e.to as Order['status']] ?? e.to}
                  {e.role === 'support' && <span style={{ color: C.amber }}> · поддержка</span>}
                  {e.role === 'system' && <span style={{ color: C.t3 }}> · сервер</span>}
                </span>
                <span style={{ color: C.t3 }}>{fmtTime(e.at)}</span>
              </div>
            ))}
          </div>
        )}

        {error && <Alert text={error} />}

        <div className="flex gap-2 pb-4">
          {mayCancel && (
            <button type="button" disabled={busy} onClick={cancel}
              className="flex-1 rounded-xl py-2 text-[11px] font-bold disabled:opacity-40"
              style={{ background: C.l2, color: C.red, border: `1px solid ${C.brd}` }}>
              <XCircle size={12} className="mr-1 inline" />Отменить
            </button>
          )}
          {mayDispute && (
            <button type="button" disabled={busy} onClick={dispute}
              className="flex-1 rounded-xl py-2 text-[11px] font-bold disabled:opacity-40"
              style={{ background: C.l2, color: C.amber, border: `1px solid ${C.brd}` }}>
              <ShieldAlert size={12} className="mr-1 inline" />Открыть спор
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/* ── Список заказов ───────────────────────────────────────────────── */

export const OrdersList = ({ orders, onOpen, empty }:
{ orders: Order[]; onOpen: (id: string) => void; empty: string }) => (
  <div className="space-y-2 p-4">
    {orders.length === 0 && <Empty title={empty} />}
    {orders.map((o) => <OrderRow key={o.id} order={o} onOpen={() => onOpen(o.id)} />)}
  </div>
);
