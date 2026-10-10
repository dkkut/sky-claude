/* ======================================================================
   SKY MARKET / LOGISTICS  —  Warehouse Hub
   Раздел «Мои склады» в личном кабинете продавца
====================================================================== */
import { useState, useRef, type ChangeEvent, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Warehouse as WhIcon, MapPin, Camera, Clock, Package,
  ArrowRightLeft, Users, History, Trash2, Pencil, ChevronRight,
  Crosshair, X, UserPlus, AlertTriangle, Boxes, Building2, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { C, fmtTs, StatCard } from '../SkyMarket';
import { useAuthStore } from '@/core/auth/store';
import { useMarketStore } from '../store';
import { useWarehouseStore, WEEK_DAYS, defaultSchedule } from './warehouseStore';
import { CITIES } from './geo';
import { SlidePanel, EmptyState, ConfirmModal } from './shared';
import { SkyMap } from './SkyMap';
import { apiGeocode } from './mapsApi';
import { SharedWarehouseTab } from './SharedWarehouseTab';
import { WarehouseViolationsTab } from '../ViolationsTab';
import type { Warehouse, DaySchedule, WarehouseStaff, GeoPoint } from './types';

/* ── Прогресс-бар загрузки склада ────────────────────────────────── */
const CapacityBar = ({ occupied, capacity }: { occupied: number; capacity: number }) => {
  const pct = capacity > 0 ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
  const color = pct >= 90 ? C.red : pct >= 70 ? C.amber : C.green;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px]" style={{ color: C.t3 }}>{occupied} / {capacity} ед.</span>
        <span className="text-[10px] font-bold" style={{ color }}>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.l2 }}>
        <motion.div className="h-full rounded-full" style={{ background: color }}
          initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }}/>
      </div>
    </div>
  );
};

/* ── Является ли склад открытым сейчас ────────────────────────────── */
const isOpenNow = (schedule: DaySchedule[]): boolean => {
  const days: DaySchedule['day'][] = ['sun','mon','tue','wed','thu','fri','sat'];
  const now = new Date();
  const today = schedule.find(d => d.day === days[now.getDay()]);
  if (!today || today.closed) return false;
  const [fh,fm] = today.from.split(':').map(Number);
  const [th,tm] = today.to.split(':').map(Number);
  const mins = now.getHours()*60 + now.getMinutes();
  return mins >= fh*60+fm && mins <= th*60+tm;
};

/* ── Карточка склада в списке ─────────────────────────────────────── */
const WarehouseCard = ({ wh, onOpen }: { wh: Warehouse; onOpen: () => void }) => {
  const { occupied, staffFor } = useWarehouseStore();
  const occ = occupied(wh.id);
  const open = isOpenNow(wh.schedule);
  const staffCount = staffFor(wh.id).length;

  return (
    <button type="button" onClick={onOpen}
      className="w-full text-left rounded-2xl p-3 flex items-center gap-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="h-14 w-14 shrink-0 rounded-2xl overflow-hidden grid place-items-center" style={{ background: C.l2 }}>
        {wh.photos[0] ? <img src={wh.photos[0]} className="h-full w-full object-cover"/> : <WhIcon size={20} style={{ color: C.t3 }}/>}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold truncate" style={{ color: C.t1 }}>{wh.name}</p>
        <p className="text-[11px] truncate flex items-center gap-1 mt-0.5" style={{ color: C.t3 }}><MapPin size={10}/> {wh.address}</p>
        <div className="mt-1.5"><CapacityBar occupied={occ} capacity={wh.capacity}/></div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: open ? 'rgba(0,220,90,0.1)' : 'rgba(255,255,255,0.05)', color: open ? C.green : C.t3 }}>
            {open ? 'Открыт' : 'Закрыт'}
          </span>
          {wh.role === 'sorting_center' && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${C.acc}18`, color: C.acc }}>Сорт. центр</span>
          )}
          {staffCount > 0 && <span className="text-[10px] flex items-center gap-1" style={{ color: C.t3 }}><Users size={10}/> {staffCount}</span>}
        </div>
      </div>
      <ChevronRight size={16} style={{ color: C.t3 }}/>
    </button>
  );
};

/* ── Форма создания/редактирования склада ─────────────────────────── */
const WarehouseForm = ({ existing, onDone, onClose }: { existing?: Warehouse; onClose: () => void; onDone: (id: string) => void }) => {
  const { addWarehouse, updateWarehouse } = useWarehouseStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(existing?.name ?? '');
  const [cityId, setCityId] = useState(existing?.cityId ?? 'msk');
  const [address, setAddress] = useState(existing?.address ?? '');
  /* Никакой точки «по умолчанию» у нового склада нет и быть не может:
     выдуманная координата — это адрес, по которому приедут не туда.
     Место задаётся одним из трёх способов: разбором адреса, кнопкой
     «я здесь» или щелчком по карте. */
  const [location, setLocation] = useState<GeoPoint | null>(existing?.location ?? null);
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? []);
  const [capacity, setCapacity] = useState(existing?.capacity ?? 200);
  const [schedule, setSchedule] = useState<DaySchedule[]>(existing?.schedule ?? defaultSchedule());
  const [isSortingCenter, setIsSortingCenter] = useState(existing?.role === 'sorting_center');
  const [geoStatus, setGeoStatus] = useState<'idle'|'loading'|'done'|'error'|'notfound'>('idle');

  const onPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotos(p => [...p, reader.result as string]);
    reader.readAsDataURL(file);
  };

  const useGeo = () => {
    if (!navigator.geolocation) { setGeoStatus('error'); return; }
    setGeoStatus('loading');
    navigator.geolocation.getCurrentPosition(
      pos => { setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoStatus('done'); },
      () => setGeoStatus('error'),
      { timeout: 6000 },
    );
  };

  /* Разбор написанного адреса. Ходит сервер, своим ключом: у браузера
     ключа Google нет и не будет. Не нашлось — так и пишем, а не ставим
     точку наугад. */
  const findAddress = async () => {
    if (!address.trim()) return;
    setGeoStatus('loading');
    const point = await apiGeocode(address.trim());
    if (point) { setLocation(point); setGeoStatus('done'); }
    else setGeoStatus('notfound');
  };

  const setDay = (idx: number, patch: Partial<DaySchedule>) =>
    setSchedule(s => s.map((d,i) => i===idx ? { ...d, ...patch } : d));

  const submit = () => {
    if (!name.trim() || !address.trim()) return;
    const role = isSortingCenter ? 'sorting_center' as const : 'own' as const;
    /* Склад теперь заводится на сервере, поэтому ждём ответа: до него
       идентификатора ещё не существует. */
    /* Места нет — склад всё равно заводится: без точки он просто не
       появится на карте, и это честнее, чем поставить его наугад. */
    const spot = location ?? undefined;
    if (existing) {
      void updateWarehouse(existing.id, { name: name.trim(), address: address.trim(), cityId, location: spot, photos, capacity, schedule, role })
        .then(() => onDone(existing.id));
    } else {
      void addWarehouse({ name: name.trim(), address: address.trim(), cityId, location: spot, photos, capacity, schedule, role })
        .then((id) => { if (id) onDone(id); });
    }
  };

  return (
    <div className="p-4 space-y-4 pb-8">
      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>НАЗВАНИЕ СКЛАДА</p>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Например: Главный склад"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
      </div>

      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>АДРЕС</p>
        <div className="flex gap-2">
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Город, улица, дом"
            className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
          <button type="button" onClick={useGeo}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: C.l2, color: geoStatus==='done' ? C.green : C.t3 }}>
            <Crosshair size={16}/>
          </button>
        </div>
        <button type="button" onClick={() => void findAddress()}
          className="mt-2 w-full rounded-xl px-3 py-2 text-xs font-bold"
          style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t2 }}>
          Найти адрес на карте
        </button>
        {geoStatus === 'loading' && <p className="text-[10px] mt-1" style={{ color: C.t3 }}>Ищем место...</p>}
        {geoStatus === 'done' && <p className="text-[10px] mt-1" style={{ color: C.green }}>Место на карте задано</p>}
        {geoStatus === 'error' && <p className="text-[10px] mt-1" style={{ color: C.red }}>Не удалось получить геолокацию</p>}
        {geoStatus === 'notfound' && <p className="text-[10px] mt-1" style={{ color: C.red }}>Такой адрес не нашёлся. Уточните его или укажите место щелчком по карте.</p>}
        <select value={cityId} onChange={e => setCityId(e.target.value)}
          className="w-full mt-2 rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>
          {CITIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="mt-2">
          <SkyMap height={140} onPick={(p) => { setLocation(p); setGeoStatus('done'); }}
            points={location ? [{ id: 'new', pos: location, label: name || 'Склад', Icon: Building2, kind: 'warehouse' }] : []}/>
          <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>
            {location
              ? 'Щелчок по карте переставит метку.'
              : 'Место ещё не задано. Найдите адрес, нажмите «я здесь» или щёлкните по карте.'}
          </p>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ФОТОГРАФИИ</p>
        <div className="flex gap-2 flex-wrap">
          {photos.map((p, i) => (
            <div key={i} className="relative h-16 w-16 rounded-xl overflow-hidden">
              <img src={p} className="h-full w-full object-cover"/>
              <button type="button" onClick={() => setPhotos(ph => ph.filter((_,j)=>j!==i))}
                className="absolute top-0.5 right-0.5 grid h-4 w-4 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.6)' }}>
                <X size={10} color="#fff"/>
              </button>
            </div>
          ))}
          <button type="button" onClick={() => fileRef.current?.click()}
            className="h-16 w-16 rounded-xl grid place-items-center" style={{ background: C.l2, border: `1px dashed ${C.brd}` }}>
            <Camera size={18} style={{ color: C.t3 }}/>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto}/>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>ВМЕСТИМОСТЬ (ед. товара)</p>
        <input type="number" min={1} value={capacity} onChange={e => setCapacity(Math.max(1, Number(e.target.value)))}
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
      </div>

      <div>
        <p className="text-[10px] font-bold mb-2" style={{ color: C.t3 }}>ГРАФИК РАБОТЫ</p>
        <div className="space-y-1.5">
          {schedule.map((d, i) => (
            <div key={d.day} className="flex items-center gap-2">
              <button type="button" onClick={() => setDay(i, { closed: !d.closed })}
                className="w-16 shrink-0 rounded-lg py-1.5 text-[11px] font-bold"
                style={{ background: d.closed ? C.l2 : C.accBg, color: d.closed ? C.t3 : C.acc }}>
                {WEEK_DAYS[i].label}
              </button>
              {d.closed ? (
                <span className="text-[11px]" style={{ color: C.t3 }}>Выходной</span>
              ) : (
                <div className="flex items-center gap-1.5 flex-1">
                  <input type="time" value={d.from} onChange={e => setDay(i, { from: e.target.value })}
                    className="flex-1 rounded-lg px-2 py-1 text-[11px] outline-none" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}/>
                  <span style={{ color: C.t3 }}>—</span>
                  <input type="time" value={d.to} onChange={e => setDay(i, { to: e.target.value })}
                    className="flex-1 rounded-lg px-2 py-1 text-[11px] outline-none" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}/>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: C.l2, border: `1px solid ${C.brd}` }}>
        <div>
          <p className="text-xs font-bold" style={{ color: C.t1 }}>Сортировочный центр</p>
          <p className="text-[10px] mt-0.5" style={{ color: C.t3 }}>Будет доступен для привязки в разделе «Поставки»</p>
        </div>
        <button type="button" onClick={() => setIsSortingCenter(v => !v)}
          className="relative h-6 w-11 shrink-0 rounded-full transition-colors" style={{ background: isSortingCenter ? C.acc : C.l3 }}>
          <motion.div className="absolute top-0.5 h-5 w-5 rounded-full bg-white" animate={{ left: isSortingCenter ? 22 : 2 }} transition={{ duration: 0.15 }}/>
        </button>
      </div>

      <button type="button" onClick={submit} disabled={!name.trim() || !address.trim()}
        className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>
        {existing ? 'Сохранить изменения' : 'Создать склад'}
      </button>
    </div>
  );
};

/* ── Управление остатками ─────────────────────────────────────────── */
const StockTab = ({ wh }: { wh: Warehouse }) => {
  const { stockFor, adjustStock, setStock, free } = useWarehouseStore();
  const products = useMarketStore(s => s.myProducts).filter((p) => p.sellerId === wh.sellerId);
  const stock = stockFor(wh.id);
  const [addingId, setAddingId] = useState('');
  const [qty, setQty] = useState(1);

  const notYetAdded = products.filter(p => !stock.some(s => s.productId === p.id));

  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Занято" value={String(stock.reduce((a,s)=>a+s.quantity,0))} icon={Boxes} color={C.acc}/>
        <StatCard label="Свободно" value={String(free(wh.id))} icon={Package} color={C.green}/>
      </div>

      {notYetAdded.length > 0 && (
        <div className="rounded-2xl p-3 space-y-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-xs font-bold" style={{ color: C.t1 }}>Добавить товар на склад</p>
          <select value={addingId} onChange={e => setAddingId(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>
            <option value="">Выберите товар...</option>
            {notYetAdded.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <div className="flex gap-2">
            <input type="number" min={1} value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value)))}
              className="w-20 rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
            <button type="button" disabled={!addingId}
              onClick={() => { const p = products.find(x=>x.id===addingId); if (p) { setStock(wh.id, p.id, p.title, qty); setAddingId(''); setQty(1); } }}
              className="flex-1 rounded-xl py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>
              Добавить
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {stock.length === 0 ? (
          <EmptyState icon={Boxes} title="На складе пока нет товаров" sub="Добавьте товары, чтобы вести учёт остатков"/>
        ) : stock.map(item => (
          <div key={item.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{item.productTitle}</p>
              {item.quantity <= 3 && (
                <p className="text-[10px] flex items-center gap-1 mt-0.5" style={{ color: C.amber }}><AlertTriangle size={10}/> Низкий остаток</p>
              )}
            </div>
            <button type="button" onClick={() => adjustStock(wh.id, item.productId, item.productTitle, -1)}
              className="grid h-7 w-7 place-items-center rounded-lg text-sm font-bold" style={{ background: C.l2, color: C.t1 }}>−</button>
            <span className="w-8 text-center text-sm font-bold" style={{ color: C.t1 }}>{item.quantity}</span>
            <button type="button" onClick={() => adjustStock(wh.id, item.productId, item.productTitle, 1)}
              className="grid h-7 w-7 place-items-center rounded-lg text-sm font-bold" style={{ background: C.l2, color: C.t1 }}>+</button>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── Перемещения между складами ───────────────────────────────────── */
const TransfersTab = ({ wh }: { wh: Warehouse }) => {
  const { myWarehouses, stockFor, transfersFor, createTransfer, advanceTransfer, cancelTransfer } = useWarehouseStore();
  const others = myWarehouses().filter(w => w.id !== wh.id);
  const stock = stockFor(wh.id);
  const transfers = transfersFor(wh.id);

  const [targetId, setTargetId] = useState(others[0]?.id ?? '');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState(1);

  const product = stock.find(s => s.productId === productId);
  const maxQty = product?.quantity ?? 0;

  const submit = () => {
    if (!targetId || !productId || qty <= 0 || qty > maxQty) return;
    createTransfer({ fromWarehouseId: wh.id, toWarehouseId: targetId, productId, productTitle: product!.productTitle, quantity: qty });
    setProductId(''); setQty(1);
  };

  return (
    <div className="p-4 space-y-3">
      {others.length === 0 ? (
        <div className="rounded-2xl p-3 text-xs" style={{ background: C.l1, color: C.t3, border: `1px solid ${C.brd}` }}>
          Добавьте ещё один склад, чтобы перемещать товары между ними.
        </div>
      ) : (
        <div className="rounded-2xl p-3 space-y-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-xs font-bold" style={{ color: C.t1 }}>Новое перемещение</p>
          <select value={productId} onChange={e => setProductId(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>
            <option value="">Товар...</option>
            {stock.map(s => <option key={s.id} value={s.productId}>{s.productTitle} ({s.quantity} шт.)</option>)}
          </select>
          <select value={targetId} onChange={e => setTargetId(e.target.value)}
            className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>
            {others.map(w => <option key={w.id} value={w.id}>На склад: {w.name}</option>)}
          </select>
          <div className="flex gap-2">
            <input type="number" min={1} max={maxQty || undefined} value={qty} onChange={e => setQty(Number(e.target.value))}
              className="w-20 rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
            <button type="button" disabled={!targetId || !productId || qty<=0 || qty>maxQty}
              onClick={submit}
              className="flex-1 rounded-xl py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>
              Переместить
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {transfers.length === 0 ? <EmptyState icon={ArrowRightLeft} title="Нет перемещений" sub="История перемещений товаров между складами появится здесь"/> : transfers.map(t => {
          const isOut = t.fromWarehouseId === wh.id;
          const otherWh = (isOut ? others.find(w=>w.id===t.toWarehouseId) : others.find(w=>w.id===t.fromWarehouseId)) ;
          return (
            <div key={t.id} className="rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold" style={{ color: C.t1 }}>{isOut ? '→' : '←'} {t.productTitle} × {t.quantity}</p>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: t.status==='done' ? 'rgba(0,220,90,0.1)' : t.status==='cancelled' ? 'rgba(244,63,94,0.1)' : C.accBg,
                    color: t.status==='done' ? C.green : t.status==='cancelled' ? C.red : C.acc }}>
                  {t.status==='pending' ? 'Ожидает' : t.status==='in_transit' ? 'В пути' : t.status==='done' ? 'Завершено' : 'Отменено'}
                </span>
              </div>
              <p className="text-[10px] mt-1" style={{ color: C.t3 }}>{isOut ? 'Получатель' : 'Отправитель'}: {otherWh?.name ?? '—'} · {fmtTs(t.createdAt)}</p>
              {isOut && t.status !== 'done' && t.status !== 'cancelled' && (
                <div className="flex gap-2 mt-2">
                  <button type="button" onClick={() => advanceTransfer(t.id)} className="flex-1 rounded-lg py-1.5 text-[11px] font-bold text-white" style={{ background: C.acc }}>
                    {t.status === 'pending' ? 'Отправить в путь' : 'Подтвердить получение'}
                  </button>
                  <button type="button" onClick={() => cancelTransfer(t.id)} className="rounded-lg px-3 py-1.5 text-[11px] font-bold" style={{ background: C.l2, color: C.red }}>
                    Отменить
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ── Сотрудники склада ────────────────────────────────────────────── */
const StaffTab = ({ wh }: { wh: Warehouse }) => {
  const { staffFor, addStaff, removeStaff } = useWarehouseStore();
  const { findUsersByUsername } = useAuthStore();
  const staff = staffFor(wh.id);
  const [q, setQ] = useState('');
  const results = q.trim() ? findUsersByUsername(q.trim()).filter(a => !staff.some(s=>s.accountId===a.id)).slice(0,6) : [];

  return (
    <div className="p-4 space-y-3">
      <div className="rounded-2xl p-3 space-y-2" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-xs font-bold" style={{ color: C.t1 }}>Назначить сотрудника</p>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по @username..."
          className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
        {results.length > 0 && (
          <div className="space-y-1.5">
            {results.map(a => (
              <div key={a.id} className="flex items-center gap-2 rounded-xl p-2" style={{ background: C.l2 }}>
                <span className="grid h-7 w-7 place-items-center rounded-lg text-xs font-bold" style={{ background: C.l3, color: C.t1 }}>{a.name[0]}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{a.name}</p>
                  <p className="text-[10px]" style={{ color: C.t3 }}>@{a.username}</p>
                </div>
                <button type="button" onClick={() => { addStaff(wh.id, a.id, a.name, a.username, 'worker'); setQ(''); }}
                  className="rounded-lg px-2 py-1 text-[10px] font-bold text-white" style={{ background: C.acc }}>Сотрудник</button>
                <button type="button" onClick={() => { addStaff(wh.id, a.id, a.name, a.username, 'manager'); setQ(''); }}
                  className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: C.l3, color: C.t1 }}>Менеджер</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {staff.length === 0 ? <EmptyState icon={UserPlus} title="Нет назначенных сотрудников" sub="Найдите пользователя платформы и назначьте его на склад"/> : staff.map((s: WarehouseStaff) => (
          <div key={s.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <span className="grid h-9 w-9 place-items-center rounded-xl text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>{s.name[0]}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{s.name}</p>
              <p className="text-[10px]" style={{ color: C.t3 }}>@{s.username} · {s.role==='manager'?'Менеджер':'Сотрудник'}</p>
            </div>
            <button type="button" onClick={() => removeStaff(s.id)} className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: C.l2 }}>
              <Trash2 size={13} style={{ color: C.red }}/>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── История операций ─────────────────────────────────────────────── */
const HistoryTab = ({ wh }: { wh: Warehouse }) => {
  const { logsFor } = useWarehouseStore();
  const logs = logsFor(wh.id);
  if (logs.length === 0) return <EmptyState icon={History} title="История пуста"/>;
  return (
    <div className="p-4 space-y-2">
      {logs.map(l => (
        <div key={l.id} className="flex items-start gap-2 rounded-xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <span className="h-1.5 w-1.5 rounded-full mt-1.5 shrink-0" style={{ background: C.acc }}/>
          <div className="flex-1">
            <p className="text-xs" style={{ color: C.t1 }}>{l.text}</p>
            <p className="text-[10px] mt-0.5" style={{ color: C.t3 }}>{fmtTs(l.createdAt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ── Аналитика загрузки ───────────────────────────────────────────── */
const AnalyticsTab = ({ wh }: { wh: Warehouse }) => {
  const { occupied, free, stockFor, transfersFor } = useWarehouseStore();
  const occ = occupied(wh.id);
  const fr = free(wh.id);
  const stock = stockFor(wh.id);
  const transfers = transfersFor(wh.id);
  const pct = wh.capacity > 0 ? Math.round((occ / wh.capacity) * 100) : 0;
  const lowStock = stock.filter(s => s.quantity <= 3).length;

  return (
    <div className="p-4 space-y-3">
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-xs font-bold mb-3" style={{ color: C.t1 }}>Загрузка склада</p>
        <div className="flex items-center gap-4">
          <div className="relative h-20 w-20 shrink-0">
            <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke={C.l2} strokeWidth="3.5"/>
              <circle cx="18" cy="18" r="15.5" fill="none" stroke={pct>=90?C.red:pct>=70?C.amber:C.acc} strokeWidth="3.5"
                strokeDasharray={`${pct*0.974} 1000`} strokeLinecap="round"/>
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <span className="text-sm font-black" style={{ color: C.t1 }}>{pct}%</span>
            </div>
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="flex justify-between text-xs"><span style={{ color: C.t3 }}>Занято</span><span className="font-bold" style={{ color: C.t1 }}>{occ} ед.</span></div>
            <div className="flex justify-between text-xs"><span style={{ color: C.t3 }}>Свободно</span><span className="font-bold" style={{ color: C.t1 }}>{fr} ед.</span></div>
            <div className="flex justify-between text-xs"><span style={{ color: C.t3 }}>Позиций SKU</span><span className="font-bold" style={{ color: C.t1 }}>{stock.length}</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Перемещений" value={String(transfers.length)} icon={ArrowRightLeft} color={C.acc}/>
        <StatCard label="Низкий остаток" value={String(lowStock)} icon={AlertTriangle} color={lowStock>0?C.amber:C.green}/>
      </div>

      {lowStock > 0 && (
        <div className="rounded-2xl p-3 flex items-start gap-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <AlertTriangle size={14} style={{ color: C.amber }} className="mt-0.5 shrink-0"/>
          <p className="text-xs" style={{ color: C.t2 }}>{`${lowStock} позици${lowStock===1?'я':'и'} с низким остатком (≤3 шт.) — пополните запасы.`}</p>
        </div>
      )}
    </div>
  );
};

/* ── Детальная карточка склада ────────────────────────────────────── */
type WhTab = 'overview' | 'shared' | 'stock' | 'transfers' | 'staff' | 'violations' | 'analytics' | 'history';

const WarehouseDetail = ({ wh, onClose }: { wh: Warehouse; onClose: () => void }) => {
  const { deleteWarehouse, occupied } = useWarehouseStore();
  const myId = useAuthStore(s => s.currentUserId);
  const isOwner = wh.sellerId === myId;
  const [tab, setTab] = useState<WhTab>('overview');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const open = isOpenNow(wh.schedule);

  const TABS: { key: WhTab; label: string; icon: any }[] = [
    { key:'overview',  label:'Обзор',     icon:WhIcon },
    { key:'shared',    label:'Общий',     icon:ShieldCheck },
    { key:'stock',     label:'Остатки',   icon:Package },
    { key:'transfers', label:'Перемещ.',  icon:ArrowRightLeft },
    { key:'staff',     label:'Персонал',  icon:Users },
    /* Нарушения и штрафы по складу видит только владелец — так же,
       как в кабинете ПВЗ (см. PvzCabinet.tsx, minRole: 'owner'): сервер
       всё равно это проверит сам (listViolationsForOrg), вкладку здесь
       просто не показываем сотруднику, чтобы не звать ручку впустую. */
    ...(isOwner ? [{ key:'violations' as const, label:'Нарушения', icon:ShieldAlert }] : []),
    { key:'analytics', label:'Аналитика', icon:Boxes },
    { key:'history',   label:'История',   icon:History },
  ];

  if (editing) {
    return (
      <SlidePanel open onClose={() => setEditing(false)} onBack={() => setEditing(false)} title="Редактировать склад">
        <WarehouseForm existing={wh} onClose={() => setEditing(false)} onDone={() => setEditing(false)}/>
      </SlidePanel>
    );
  }

  return (
    <SlidePanel open onClose={onClose} title={wh.name}>
      <div className="px-4 pt-3">
        {wh.photos[0] && <img src={wh.photos[0]} className="w-full h-32 object-cover rounded-2xl mb-3"/>}
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: open ? 'rgba(0,220,90,0.1)' : 'rgba(255,255,255,0.05)', color: open ? C.green : C.t3 }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }}/>
            {open ? 'Открыт сейчас' : 'Закрыт'}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(true)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: C.l2 }}>
              <Pencil size={13} style={{ color: C.t2 }}/>
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: C.l2 }}>
              <Trash2 size={13} style={{ color: C.red }}/>
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-1 px-4 mt-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className="shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: tab===t.key ? C.accBg : C.l2, color: tab===t.key ? C.acc : C.t3 }}>
            <t.icon size={11}/> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="p-4 space-y-3">
          <SkyMap points={wh.location ? [{ id: wh.id, pos: wh.location, label: wh.name, Icon: Building2, kind: 'warehouse' }] : []}/>
          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="text-xs flex items-center gap-1.5 mb-2" style={{ color: C.t2 }}><MapPin size={12}/> {wh.address}</p>
            <CapacityBar occupied={occupied(wh.id)} capacity={wh.capacity}/>
          </div>
          <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: C.t1 }}><Clock size={12}/> График работы</p>
            <div className="space-y-1">
              {wh.schedule.map(d => (
                <div key={d.day} className="flex justify-between text-[11px]">
                  <span style={{ color: C.t3 }}>{WEEK_DAYS.find(w=>w.key===d.day)?.label}</span>
                  <span style={{ color: d.closed ? C.t3 : C.t1 }}>{d.closed ? 'Выходной' : `${d.from} – ${d.to}`}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {tab === 'shared' && <SharedWarehouseTab wh={wh}/>}
      {tab === 'stock' && <StockTab wh={wh}/>}
      {tab === 'transfers' && <TransfersTab wh={wh}/>}
      {tab === 'staff' && <StaffTab wh={wh}/>}
      {tab === 'violations' && isOwner && <WarehouseViolationsTab warehouseId={wh.id}/>}
      {tab === 'analytics' && <AnalyticsTab wh={wh}/>}
      {tab === 'history' && <HistoryTab wh={wh}/>}

      <ConfirmModal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Удалить склад?">
        <p className="text-xs mb-3" style={{ color: C.t3 }}>Все данные об остатках и сотрудниках этого склада будут удалены без возможности восстановления.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirmDelete(false)} className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>Отмена</button>
          <button type="button" onClick={() => { deleteWarehouse(wh.id); setConfirmDelete(false); onClose(); }}
            className="flex-1 rounded-xl py-2 text-xs font-bold text-white" style={{ background: C.red }}>Удалить</button>
        </div>
      </ConfirmModal>
    </SlidePanel>
  );
};

/* ══════════════════════════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════════════════════════ */
export const WarehouseHub = () => {
  const { myWarehouses, load } = useWarehouseStore();
  const warehouses = myWarehouses();
  /* Склады теперь живут на сервере — при открытии их надо прочитать. */
  useEffect(() => { void load(); }, []);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const openWh = warehouses.find(w => w.id === openId);

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ background: C.l1, borderBottom: `1px solid ${C.brd}` }}>
          <p className="text-xs" style={{ color: C.t3 }}>{warehouses.length} склад(ов)</p>
          <button type="button" onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white" style={{ background: C.acc }}>
            <Plus size={13}/> Добавить склад
          </button>
        </div>

        <div className="p-4 space-y-2">
          {warehouses.length === 0 ? (
            <EmptyState icon={WhIcon} title="Пока нет складов" sub="Добавьте первый склад, чтобы вести учёт остатков и управлять логистикой"/>
          ) : warehouses.map(w => <WarehouseCard key={w.id} wh={w} onOpen={() => setOpenId(w.id)}/>)}
        </div>
      </div>

      <SlidePanel open={creating} onClose={() => setCreating(false)} title="Новый склад">
        <WarehouseForm onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); setOpenId(id); }}/>
      </SlidePanel>

      {openWh && <WarehouseDetail wh={openWh} onClose={() => setOpenId(null)}/>}
    </div>
  );
};
