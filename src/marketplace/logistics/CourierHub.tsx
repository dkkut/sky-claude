/* ======================================================================
   SKY MARKET / LOGISTICS  —  Courier Hub
   Полноценный раздел «Курьеры» в личном кабинете продавца
====================================================================== */
import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, SlidersHorizontal, Star, Heart, Send,
  CheckCircle2, Clock, MapPin, Bell, ChevronRight,
  Truck, History, Check, AlertCircle, Package, X as XIcon,
} from 'lucide-react';
import { C, fmt, fmtTs, Stars, StatCard } from '../SkyMarket';
import { SellerBatches } from './Batches';
import { useCourierStore } from './courierStore';
import { CITIES, distanceKm } from './geo';
import { SlidePanel, EmptyState, VEHICLE_CFG, OnlineDot } from './shared';
import { SkyMap } from './SkyMap';
import type { Courier } from './types';
import type { Order } from '../types';

type HubTab = 'search' | 'mine' | 'notifications' | 'pool' | 'batches';

/* ── Карточка курьера в списке ───────────────────────────────────── */
const CourierRow = ({
  courier, distance, fav, onToggleFav, onOpen,
}: {
  courier: Courier; distance: number | null; fav: boolean;
  onToggleFav: () => void; onOpen: () => void;
}) => {
  const Vehicle = VEHICLE_CFG[courier.vehicle].icon;
  return (
    <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <button type="button" onClick={onOpen} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl"
          style={{ background: C.l2 }}>
          <Vehicle size={17} style={{ color: C.t2 }}/>
          <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full"
            style={{ background: C.l1, border: `1.5px solid ${courier.online ? C.green : C.t3}` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: courier.online ? C.green : C.t3 }}/>
          </span>
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ color: C.t1 }}>{courier.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <Stars rating={courier.rating} size={10}/>
            <span className="text-[10px]" style={{ color: C.t3 }}>{courier.rating} · {courier.reviewCount} отз.</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: C.t3 }}>
              <Vehicle size={11}/> {courier.district}
            </span>
            <span className="text-[10px]" style={{ color: C.t3 }}>· {courier.deliveriesCount} доставок</span>
            {distance !== null && <span className="text-[10px]" style={{ color: C.t3 }}>· {distance.toFixed(1)} км</span>}
          </div>
        </div>
      </button>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <p className="text-xs font-black" style={{ color: C.t1 }}>{fmt(courier.pricePerDelivery)}</p>
        <button type="button" onClick={onToggleFav} className="grid h-7 w-7 place-items-center rounded-lg"
          style={{ background: fav ? 'rgba(244,63,94,0.12)' : C.l2 }}>
          <Heart size={13} fill={fav ? '#f43f5e' : 'none'} style={{ color: fav ? '#f43f5e' : C.t3 }}/>
        </button>
      </div>
    </div>
  );
};

/* ── Фильтры поиска ───────────────────────────────────────────────── */
interface Filters {
  cityId: string; district: string; radius: number;
  minRating: number; maxPrice: number; onlineOnly: boolean;
}
const DEFAULT_FILTERS: Filters = { cityId: 'msk', district: '', radius: 25, minRating: 0, maxPrice: 1000, onlineOnly: false };

const FiltersPanel = ({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) => {
  const city = CITIES.find(c => c.id === filters.cityId) ?? CITIES[0];
  return (
    <div className="px-4 py-3 space-y-3" style={{ background: C.l1, borderBottom: `1px solid ${C.brd}` }}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ГОРОД</p>
          <select value={filters.cityId}
            onChange={e => onChange({ ...filters, cityId: e.target.value, district: '' })}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>
            {CITIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>РАЙОН</p>
          <select value={filters.district}
            onChange={e => onChange({ ...filters, district: e.target.value })}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>
            <option value="">Любой</option>
            {city.districts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-bold" style={{ color: C.t3 }}>РАДИУС ПОИСКА</p>
          <p className="text-[10px] font-bold" style={{ color: C.acc }}>{filters.radius} км</p>
        </div>
        <input type="range" min={1} max={50} value={filters.radius}
          onChange={e => onChange({ ...filters, radius: Number(e.target.value) })}
          className="w-full" style={{ accentColor: C.acc }}/>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-bold" style={{ color: C.t3 }}>МИН. РЕЙТИНГ</p>
            <p className="text-[10px] font-bold" style={{ color: C.acc }}>{filters.minRating.toFixed(1)}</p>
          </div>
          <input type="range" min={0} max={5} step={0.5} value={filters.minRating}
            onChange={e => onChange({ ...filters, minRating: Number(e.target.value) })}
            className="w-full" style={{ accentColor: C.acc }}/>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-bold" style={{ color: C.t3 }}>МАКС. ЦЕНА</p>
            <p className="text-[10px] font-bold" style={{ color: C.acc }}>{filters.maxPrice} ₽</p>
          </div>
          <input type="range" min={50} max={1000} step={10} value={filters.maxPrice}
            onChange={e => onChange({ ...filters, maxPrice: Number(e.target.value) })}
            className="w-full" style={{ accentColor: C.acc }}/>
        </div>
      </div>
      <button type="button" onClick={() => onChange({ ...filters, onlineOnly: !filters.onlineOnly })}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold"
        style={{ background: filters.onlineOnly ? C.accBg : C.l2, color: filters.onlineOnly ? C.acc : C.t2,
          border: `1px solid ${filters.onlineOnly ? 'rgba(79,110,247,0.3)' : C.brd}` }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: filters.onlineOnly ? C.acc : C.t3 }}/>
        Только онлайн сейчас
      </button>
    </div>
  );
};

/* ── Карточка отзыва ──────────────────────────────────────────────── */
const ReviewRow = ({ name, rating, text, date }: { name: string; rating: number; text: string; date: string }) => (
  <div className="rounded-xl p-3" style={{ background: C.l2 }}>
    <div className="flex items-center justify-between">
      <p className="text-xs font-bold" style={{ color: C.t1 }}>{name}</p>
      <Stars rating={rating} size={10}/>
    </div>
    <p className="text-xs mt-1" style={{ color: C.t2 }}>{text}</p>
    <p className="text-[10px] mt-1" style={{ color: C.t3 }}>{fmtTs(date)}</p>
  </div>
);

/* ── Чат с курьером ───────────────────────────────────────────────── */
const CourierChat = ({ courierId }: { courierId: string }) => {
  const { chatWith, sendMessage } = useCourierStore();
  const messages = chatWith(courierId);
  const [text, setText] = useState('');

  const send = () => {
    if (!text.trim()) return;
    sendMessage(courierId, text, 'seller');
    setText('');
  };

  return (
    <div className="flex flex-col" style={{ height: 360 }}>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2" style={{ scrollbarWidth: 'none' }}>
        {messages.length === 0 ? (
          <p className="text-xs text-center mt-8" style={{ color: C.t3 }}>Напишите курьеру первым — обсудите детали сотрудничества</p>
        ) : messages.map(m => (
          <div key={m.id} className={`flex ${m.from === 'seller' ? 'justify-end' : 'justify-start'}`}>
            <div className="rounded-2xl px-3 py-2 max-w-[75%]"
              style={{ background: m.from === 'seller' ? C.acc : C.l2, color: m.from === 'seller' ? '#fff' : C.t1 }}>
              <p className="text-xs">{m.text}</p>
              <p className="text-[9px] mt-0.5 opacity-60">{new Date(m.createdAt).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' })}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 p-3 shrink-0" style={{ borderTop: `1px solid ${C.brd}` }}>
        <input value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Сообщение курьеру..."
          className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}/>
        <button type="button" onClick={send}
          className="grid h-9 w-9 place-items-center rounded-xl shrink-0" style={{ background: C.acc }}>
          <Send size={15} color="#fff"/>
        </button>
      </div>
    </div>
  );
};

/* ── Детальная карточка курьера ──────────────────────────────────── */
const CourierDetail = ({
  courier, onClose, sellerOrders, onAssign,
}: { courier: Courier; onClose: () => void; sellerOrders: any[]; onAssign: (orderId: string) => void }) => {
  const { isFavorite, toggleFavorite, collabWith, sendCollabRequest, reviewsFor, assignmentForOrder } = useCourierStore();
  const [view, setView] = useState<'info' | 'chat'>('info');
  const [reqMsg, setReqMsg] = useState('Здравствуйте! Хотим предложить постоянное сотрудничество по доставке заказов.');
  const [sent, setSent] = useState(false);

  const fav = isFavorite(courier.id);
  const collab = collabWith(courier.id);
  const reviews = reviewsFor(courier.id);
  const Vehicle = VEHICLE_CFG[courier.vehicle].icon;
  const myAssignedOrders = sellerOrders.filter(o => assignmentForOrder(o.id)?.courierId === courier.id);
  /* Заказ можно отдать курьеру, только когда продавец уже выбрал
     способ «Отвезу сам» (OrderScreens.tsx) — до этого момента о
     передаче нечего говорить: 'confirmed'/'shipped' такими статусами
     заказа не бывают вовсе, только 'seller_shipped'. */
  const assignable = sellerOrders.filter(o => o.status === 'seller_shipped' && assignmentForOrder(o.id)?.courierId !== courier.id);

  return (
    <SlidePanel open onClose={onClose} title={courier.name}>
      <div className="px-4 pt-4 pb-2 flex items-center gap-3">
        <span className="grid h-16 w-16 place-items-center rounded-3xl" style={{ background: C.l2 }}>
          <Vehicle size={28} style={{ color: C.t2 }}/>
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-base font-bold" style={{ color: C.t1 }}>{courier.name}</p>
            <OnlineDot online={courier.online}/>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <Stars rating={courier.rating} size={12}/>
            <span className="text-xs" style={{ color: C.t3 }}>{courier.rating} ({courier.reviewCount})</span>
          </div>
          <p className="text-xs mt-1" style={{ color: C.t3 }}>{courier.phone}</p>
        </div>
        <button type="button" onClick={() => toggleFavorite(courier.id)}
          className="grid h-9 w-9 place-items-center rounded-xl shrink-0"
          style={{ background: fav ? 'rgba(244,63,94,0.12)' : C.l2 }}>
          <Heart size={16} fill={fav ? '#f43f5e' : 'none'} style={{ color: fav ? '#f43f5e' : C.t3 }}/>
        </button>
      </div>

      <div className="px-4 flex gap-2 mt-2">
        {(['info','chat'] as const).map(v => (
          <button key={v} type="button" onClick={() => setView(v)}
            className="flex-1 rounded-xl py-2 text-xs font-semibold"
            style={{ background: view===v ? C.accBg : C.l2, color: view===v ? C.acc : C.t3 }}>
            {v === 'info' ? 'Информация' : 'Чат'}
          </button>
        ))}
      </div>

      {view === 'chat' ? <CourierChat courierId={courier.id}/> : (
        <div className="px-4 pb-6 mt-3 space-y-4">
          <p className="text-xs" style={{ color: C.t2 }}>{courier.bio}</p>

          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Доставок" value={String(courier.deliveriesCount)} icon={Truck} color={C.acc}/>
            <StatCard label="Цена" value={fmt(courier.pricePerDelivery)} icon={Star} color={C.amber}/>
            <StatCard label="Совместно" value={String(myAssignedOrders.length)} icon={History} color={C.green}/>
          </div>

          <div className="rounded-2xl p-3 space-y-1.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><MapPin size={12}/> {courier.district}, {CITIES.find(c=>c.id===courier.cityId)?.name}</div>
            <div className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><Vehicle size={12}/> {VEHICLE_CFG[courier.vehicle].label}</div>
            <div className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><Clock size={12}/> {courier.workFrom}–{courier.workTo}</div>
          </div>

          {/* Сотрудничество */}
          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>Сотрудничество</p>
            {collab?.status === 'accepted' ? (
              <div className="flex items-center gap-2 text-xs" style={{ color: C.green }}><CheckCircle2 size={14}/> Сотрудничество активно</div>
            ) : collab?.status === 'pending' ? (
              <div className="flex items-center gap-2 text-xs" style={{ color: C.amber }}><Clock size={14}/> Заявка отправлена, ожидаем ответа курьера</div>
            ) : sent ? (
              <div className="flex items-center gap-2 text-xs" style={{ color: C.green }}><CheckCircle2 size={14}/> Заявка отправлена!</div>
            ) : (
              <div className="space-y-2">
                <textarea value={reqMsg} onChange={e => setReqMsg(e.target.value)} rows={2}
                  className="w-full resize-none rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
                <button type="button" onClick={() => { sendCollabRequest(courier.id, reqMsg); setSent(true); }}
                  className="w-full rounded-xl py-2 text-xs font-bold text-white" style={{ background: C.acc }}>
                  Отправить заявку на сотрудничество
                </button>
              </div>
            )}
          </div>

          {/* Назначить на заказ */}
          {assignable.length > 0 && (
            <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>Назначить на заказ</p>
              <div className="space-y-2">
                {assignable.map(o => (
                  <button key={o.id} type="button" onClick={() => onAssign(o.id)}
                    className="w-full flex items-center justify-between rounded-xl px-3 py-2 text-left" style={{ background: C.l2 }}>
                    <span className="text-xs truncate" style={{ color: C.t1 }}>{o.productTitle}</span>
                    <ChevronRight size={14} style={{ color: C.t3 }}/>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* История */}
          {myAssignedOrders.length > 0 && (
            <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>История сотрудничества ({myAssignedOrders.length})</p>
              <div className="space-y-1.5">
                {myAssignedOrders.map(o => (
                  <div key={o.id} className="flex items-center justify-between text-xs">
                    <span className="truncate" style={{ color: C.t2 }}>{o.productTitle}</span>
                    <span style={{ color: C.t3 }}>{fmtTs(o.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Отзывы */}
          <div>
            <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>Отзывы ({reviews.length})</p>
            {reviews.length === 0
              ? <p className="text-xs" style={{ color: C.t3 }}>Пока нет отзывов</p>
              : <div className="space-y-2">{reviews.map(r => <ReviewRow key={r.id} name={r.sellerName} rating={r.rating} text={r.text} date={r.createdAt}/>)}</div>}
          </div>
        </div>
      )}
    </SlidePanel>
  );
};

/* ── Назначить курьера на заказ (модалка выбора заказов для bulk) ─── */
const BulkAssignPanel = ({
  open, onClose, courier, orders, onConfirm,
}: { open: boolean; onClose: () => void; courier: Courier | null; orders: any[]; onConfirm: (ids: string[]) => void }) => {
  const [selected, setSelected] = useState<string[]>([]);
  if (!courier) return null;
  return (
    <SlidePanel open={open} onClose={onClose} title={`Массовое назначение · ${courier.name}`}>
      <div className="p-4 space-y-2">
        <p className="text-xs mb-2" style={{ color: C.t3 }}>Выберите заказы для назначения курьеру {courier.name}</p>
        {orders.length === 0 ? (
          <EmptyState icon={Truck} title="Нет доступных заказов" sub="Все подтверждённые заказы уже назначены"/>
        ) : orders.map(o => {
          const sel = selected.includes(o.id);
          return (
            <button key={o.id} type="button"
              onClick={() => setSelected(s => sel ? s.filter(id => id !== o.id) : [...s, o.id])}
              className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left" style={{ background: C.l1, border: `1px solid ${sel ? C.acc : C.brd}` }}>
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-lg" style={{ background: sel ? C.acc : C.l2 }}>
                {sel && <Check size={12} color="#fff"/>}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{o.productTitle}</p>
                <p className="text-[10px]" style={{ color: C.t3 }}>{o.address}</p>
              </div>
            </button>
          );
        })}
      </div>
      {orders.length > 0 && (
        <div className="p-4 sticky bottom-0" style={{ background: C.bg, borderTop: `1px solid ${C.brd}` }}>
          <button type="button" disabled={selected.length === 0}
            onClick={() => { onConfirm(selected); setSelected([]); }}
            className="w-full rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>
            Назначить на {selected.length} заказ(ов)
          </button>
        </div>
      )}
    </SlidePanel>
  );
};

/* ── Уведомления ──────────────────────────────────────────────────── */
/* Функция, а не объект на верхнем уровне модуля: CourierHub.tsx и SkyMarket.tsx
   импортируют друг друга (циклическая зависимость), поэтому обращение к C
   на этапе загрузки модуля может произойти раньше, чем C успеет
   инициализироваться в SkyMarket.tsx — что и вызывало
   "ReferenceError: Cannot access 'C' before initialization".
   Вызов внутри рендера гарантированно происходит уже после инициализации обоих модулей. */
const getNotifCfg = (): Record<string,{label:string;color:string;icon:any}> => ({
  accepted:  { label:'Принято',   color:C.acc,   icon:CheckCircle2 },
  on_way:    { label:'В пути',    color:'#8b5cf6', icon:Truck },
  delivered: { label:'Доставлено',color:C.green, icon:CheckCircle2 },
  cancelled: { label:'Отменено',  color:C.red,   icon:AlertCircle },
  /* Типы, которые шлёт сервер (server/logistics.mjs → notifyLogi). Тип —
     произвольная строка из базы, поэтому ниже есть и запасной вариант. */
  assigned:  { label:'Назначено', color:C.acc,   icon:Package },
  problem:   { label:'Проблема',  color:C.red,   icon:AlertCircle },
  approved:  { label:'Одобрено',  color:C.green, icon:CheckCircle2 },
  rejected:  { label:'Отклонено', color:C.red,   icon:AlertCircle },
  suspended: { label:'Приостановлено', color:C.red, icon:AlertCircle },
});
const NOTIF_FALLBACK = { label:'Уведомление', color:'var(--t2)', icon:Bell };

const NotificationsList = () => {
  const { myNotifications, markNotificationRead, couriers } = useCourierStore();
  // Копия, не сам массив из хранилища: sort() на месте менял состояние
  // Zustand. Дата может отсутствовать — тогда считаем её нулевой, иначе
  // NaN ломает порядок.
  const ts = (v?: string) => { const t = v ? new Date(v).getTime() : 0; return Number.isFinite(t) ? t : 0; };
  const notifs = [...(myNotifications() ?? [])].filter(Boolean).sort((a,b) => ts(b.createdAt) - ts(a.createdAt));

  if (notifs.length === 0) return <EmptyState icon={Bell} title="Пока нет уведомлений" sub="Здесь появятся события о принятии, выполнении или отмене доставок"/>;

  const NOTIF_CFG = getNotifCfg();
  return (
    <div className="p-4 space-y-2">
      {notifs.map(n => {
        // Тип — произвольная строка из базы: hasOwnProperty не даёт подобрать
        // 'constructor'/'toString' из прототипа (у них нет .icon — как раз падение).
        const cfg = Object.prototype.hasOwnProperty.call(NOTIF_CFG, String(n.type)) ? NOTIF_CFG[n.type] : NOTIF_FALLBACK;
        const Icon = cfg.icon;
        const courier = couriers.find(c => c.id === n.courierId);
        return (
          <button key={n.id} type="button" onClick={() => markNotificationRead(n.id)}
            className="w-full flex items-start gap-3 rounded-2xl p-3 text-left"
            style={{ background: n.read ? C.l1 : C.accBg, border: `1px solid ${n.read ? C.brd : 'rgba(79,110,247,0.25)'}` }}>
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background: `${cfg.color}15` }}>
              <Icon size={14} style={{ color: cfg.color }}/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{ color: C.t1 }}>{courier?.name ?? 'Курьер'} · {cfg.label}</p>
              <p className="text-xs mt-0.5" style={{ color: C.t2 }}>{n.text}</p>
              <p className="text-[10px] mt-1" style={{ color: C.t3 }}>{fmtTs(n.createdAt)}</p>
            </div>
            {!n.read && <span className="h-2 w-2 rounded-full shrink-0 mt-1" style={{ background: C.acc }}/>}
          </button>
        );
      })}
    </div>
  );
};

/* ── «Мои курьеры» — избранные + сотрудничество ──────────────────── */
const MyCouriersList = ({ onOpen }: { onOpen: (c: Courier) => void }) => {
  const { couriers, favorites, myCollabs, toggleFavorite } = useCourierStore();
  const favList = couriers.filter(c => favorites.includes(c.id));
  const collabs = myCollabs().filter(c => c.status === 'accepted');
  const collabCouriers = couriers.filter(c => collabs.some(co => co.courierId === c.id));

  if (favList.length === 0 && collabCouriers.length === 0) {
    return <EmptyState icon={Heart} title="Пока нет избранных курьеров" sub="Добавляйте курьеров в избранное в разделе «Поиск», чтобы быстро находить их здесь"/>;
  }

  return (
    <div className="p-4 space-y-5">
      {collabCouriers.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Активное сотрудничество</p>
          <div className="space-y-2">
            {collabCouriers.map(c => (
              <CourierRow key={c.id} courier={c} distance={null} fav={favorites.includes(c.id)}
                onToggleFav={() => toggleFavorite(c.id)} onOpen={() => onOpen(c)}/>
            ))}
          </div>
        </div>
      )}
      {favList.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Избранное</p>
          <div className="space-y-2">
            {favList.map(c => (
              <CourierRow key={c.id} courier={c} distance={null} fav onToggleFav={() => toggleFavorite(c.id)} onOpen={() => onOpen(c)}/>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Пул: продавец выставляет заказ, любой подходящий курьер берёт сам ── */
const PoolPostForm = ({ order, onDone }: { order: Order; onDone: () => void }) => {
  const { postOrderToPool } = useCourierStore();
  const [cityId, setCityId] = useState(CITIES[0].id);
  const [district, setDistrict] = useState(CITIES[0].districts[0]);
  const [price, setPrice] = useState(200);
  const [busy, setBusy] = useState(false);
  const city = CITIES.find(c => c.id === cityId) ?? CITIES[0];

  const submit = async () => {
    setBusy(true);
    const r = await postOrderToPool(order.id, price * 100, cityId, district);
    setBusy(false);
    if (r.ok) onDone();
  };

  return (
    <div className="mt-2 rounded-xl p-3 space-y-2" style={{ background: C.l2 }}>
      <div className="flex flex-wrap gap-1.5">
        {CITIES.map(c => (
          <button key={c.id} type="button" onClick={() => { setCityId(c.id); setDistrict(c.districts[0]); }}
            className="rounded-lg px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: cityId === c.id ? C.acc : C.l1, color: cityId === c.id ? '#fff' : C.t3 }}>{c.name}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {city.districts.map(d => (
          <button key={d} type="button" onClick={() => setDistrict(d)}
            className="rounded-lg px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: district === d ? C.acc : C.l1, color: district === d ? '#fff' : C.t3 }}>{d}</button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min={100} max={600} step={10} value={price} onChange={e => setPrice(+e.target.value)} className="flex-1"/>
        <span className="w-14 shrink-0 text-right text-xs font-black" style={{ color: C.t1 }}>{price} ₽</span>
      </div>
      <button type="button" disabled={busy} onClick={submit}
        className="w-full rounded-lg py-2 text-xs font-bold disabled:opacity-50" style={{ background: C.acc, color: '#fff' }}>
        Выставить в пул
      </button>
    </div>
  );
};

const PoolTab = ({ orders }: { orders: Order[] }) => {
  const { assignments, assignmentForOrder, cancelPoolPosting, load } = useCourierStore();
  useEffect(() => { void load(); }, []);
  const [openFormFor, setOpenFormFor] = useState<string | null>(null);

  const openPostings = assignments.filter(a => a.status === 'open');
  const eligible = orders.filter(o => o.status === 'seller_shipped' && !assignmentForOrder(o.id));

  return (
    <div className="p-4 space-y-4">
      {openPostings.length > 0 && (
        <div>
          <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>В пуле, ждут курьера</p>
          <div className="space-y-2">
            {openPostings.map(a => (
              <div key={a.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                <Package size={16} style={{ color: C.acc }}/>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold truncate" style={{ color: C.t1 }}>Заказ {a.orderId.slice(-6)}</p>
                  <p className="text-[11px]" style={{ color: C.t3 }}>{a.district || a.cityId} · {a.price} ₽</p>
                </div>
                <button type="button" onClick={() => cancelPoolPosting(a.orderId)}
                  className="grid h-7 w-7 place-items-center rounded-lg shrink-0" style={{ background: 'rgba(239,68,68,0.1)' }}>
                  <XIcon size={13} style={{ color: C.red }}/>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>Можно выставить в пул</p>
        {eligible.length === 0 ? (
          <EmptyState icon={Package} title="Нечего выставить" sub="Сюда попадают подтверждённые заказы, ещё не отданные курьеру"/>
        ) : (
          <div className="space-y-2">
            {eligible.map(o => (
              <div key={o.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold truncate" style={{ color: C.t1 }}>{o.title ?? `Заказ ${o.id.slice(-6)}`}</p>
                  <button type="button" onClick={() => setOpenFormFor(openFormFor === o.id ? null : o.id)}
                    className="text-[11px] font-bold shrink-0" style={{ color: C.acc }}>
                    {openFormFor === o.id ? 'Скрыть' : 'В пул'}
                  </button>
                </div>
                {openFormFor === o.id && <PoolPostForm order={o} onDone={() => setOpenFormFor(null)}/>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════════════════════════ */
export const CourierHub = ({ sellerId, orders }: { sellerId: string; orders: any[] }) => {
  const { couriers, favorites, toggleFavorite, assignCourier, bulkAssignCourier, myNotifications, assignmentForOrder, load } = useCourierStore();
  /* Каталог курьеров, заявки и поручения приходят с сервера. */
  useEffect(() => { void load(); }, []);
  const [tab, setTab] = useState<HubTab>('search');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [query, setQuery] = useState('');
  const [openCourier, setOpenCourier] = useState<Courier | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [bulkTarget, setBulkTarget] = useState<Courier | null>(null);
  const [showMap, setShowMap] = useState(false);

  const unreadCount = myNotifications().filter(n => !n.read).length;

  const base = useMemo(() => CITIES.find(c => c.id === filters.cityId)?.center, [filters.cityId]);

  const filtered = useMemo(() => couriers.filter(c => {
    if (c.cityId !== filters.cityId) return false;
    if (filters.district && c.district !== filters.district) return false;
    if (c.rating < filters.minRating) return false;
    if (c.pricePerDelivery > filters.maxPrice) return false;
    if (filters.onlineOnly && !c.online) return false;
    if (query.trim() && !c.name.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (base) {
      const dist = distanceKm(base, c.location);
      if (dist > filters.radius) return false;
    }
    return true;
  }).sort((a,b) => b.rating - a.rating), [couriers, filters, query, base]);

  const assignableOrders = orders.filter(o => o.status === 'seller_shipped');

  const TABS: { key: HubTab; label: string; icon: any; badge?: number }[] = [
    { key:'search',        label:'Поиск',         icon:Search },
    { key:'pool',          label:'Пул',           icon:Package },
    { key:'batches',       label:'Поставки',      icon:Truck },
    { key:'mine',          label:'Мои курьеры',   icon:Heart },
    { key:'notifications', label:'Уведомления',   icon:Bell, badge: unreadCount },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {/* Tabs */}
      <div className="flex shrink-0" style={{ background: C.l1, borderBottom: `1px solid ${C.brd}` }}>
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className="relative flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold"
              style={{ color: tab===t.key ? C.acc : C.t3 }}>
              <Icon size={13}/> {t.label}
              {!!t.badge && (
                <span className="grid h-4 min-w-[16px] place-items-center rounded-full text-[8px] font-black text-white px-1" style={{ background: C.red }}>{t.badge}</span>
              )}
              {tab===t.key && <motion.div layoutId="courier-hub-tab" className="absolute bottom-0 inset-x-3 h-[2px] rounded-full" style={{ background: C.acc }}/>}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {tab === 'search' && (
          <>
            <div className="px-4 py-3 flex items-center gap-2" style={{ background: C.l1, borderBottom: `1px solid ${C.brd}` }}>
              <div className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: C.l2 }}>
                <Search size={14} style={{ color: C.t3 }}/>
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск курьера по имени..."
                  className="flex-1 bg-transparent text-xs outline-none" style={{ color: C.t1 }}/>
              </div>
              <button type="button" onClick={() => setShowFilters(s => !s)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                style={{ background: showFilters ? C.accBg : C.l2, color: showFilters ? C.acc : C.t3 }}>
                <SlidersHorizontal size={15}/>
              </button>
              <button type="button" onClick={() => setShowMap(s => !s)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                style={{ background: showMap ? C.accBg : C.l2, color: showMap ? C.acc : C.t3 }}>
                <MapPin size={15}/>
              </button>
            </div>

            <AnimatePresence>
              {showFilters && (
                <motion.div initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }} exit={{ height:0, opacity:0 }} style={{ overflow:'hidden' }}>
                  <FiltersPanel filters={filters} onChange={setFilters}/>
                </motion.div>
              )}
            </AnimatePresence>

            {showMap && (
              <div className="px-4 py-3">
                {/* Точку показывает только тот, кто на связи: сервер
                    её и отдаёт только для таких. Ушедший со связи
                    курьер на карту не попадёт — где он, мы не знаем. */}
                <SkyMap points={filtered.map(c => ({
                  id: c.id, pos: c.location, label: c.name.split(' ')[0],
                  Icon: VEHICLE_CFG[c.vehicle].icon, online: c.online, kind: 'courier' as const,
                }))}/>
              </div>
            )}

            <div className="px-4 py-3 flex items-center justify-between">
              <p className="text-xs" style={{ color: C.t3 }}>{filtered.length} курьер(ов) найдено</p>
              {assignableOrders.length > 0 && (
                <button type="button" onClick={() => setSelectMode(s => !s)}
                  className="text-[11px] font-bold" style={{ color: selectMode ? C.red : C.acc }}>
                  {selectMode ? 'Отменить выбор' : 'Массовое назначение'}
                </button>
              )}
            </div>

            <div className="px-4 pb-6 space-y-2">
              {filtered.length === 0 ? (
                <EmptyState icon={Search} title="Курьеры не найдены" sub="Попробуйте изменить фильтры поиска"/>
              ) : filtered.map(c => (
                <CourierRow key={c.id} courier={c}
                  distance={base ? distanceKm(base, c.location) : null}
                  fav={favorites.includes(c.id)}
                  onToggleFav={() => toggleFavorite(c.id)}
                  onOpen={() => selectMode ? setBulkTarget(c) : setOpenCourier(c)}/>
              ))}
            </div>
          </>
        )}

        {tab === 'pool' && <PoolTab orders={orders}/>}
        {tab === 'batches' && <SellerBatches/>}
        {tab === 'mine' && <MyCouriersList onOpen={setOpenCourier}/>}
        {tab === 'notifications' && <NotificationsList/>}
      </div>

      {openCourier && (
        <CourierDetail courier={openCourier} onClose={() => setOpenCourier(null)}
          sellerOrders={orders}
          onAssign={(orderId) => { assignCourier(orderId, openCourier.id); setOpenCourier(null); }}/>
      )}

      <BulkAssignPanel open={!!bulkTarget} onClose={() => setBulkTarget(null)} courier={bulkTarget}
        orders={assignableOrders.filter(o => assignmentForOrder(o.id)?.courierId !== bulkTarget?.id)}
        onConfirm={(ids) => { if (bulkTarget) bulkAssignCourier(ids, bulkTarget.id); setBulkTarget(null); }}/>
    </div>
  );
};
