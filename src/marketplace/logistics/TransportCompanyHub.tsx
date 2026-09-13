import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Truck, Plus, X, Check, Star, Package, Users, Wallet, Route, Warehouse as WarehouseIcon,
  ShoppingCart as ExchangeIcon, Clock, AlertTriangle, CheckCircle2, Ban, Trash2, Phone,
  MapPin, TrendingUp, ChevronRight, Sparkles, ShieldCheck,
} from 'lucide-react';
import { C, StatCard } from '@/marketplace/SkyMarket';
import { GlassCard, EmptyState, Segmented, InteractiveLineChart, InteractiveBarChart } from '@/pvz/shared';
import { useAuthStore } from '@/core/auth/store';
import { useTransportStore } from './transportStore';
import { TransportMap } from './TransportMap';
import { TRANSPORT_KIND_LABEL, type TransportKind, type VehicleStatus } from './transportTypes';

/* Цветной кружок статуса раньше был эмодзи «зелёный круг» и рисовался
   шрифтом устройства. Теперь цвет один и тот же для точки и для текста
   — он и так лежит в `color`, отдельная картинка не нужна. */
const VEHICLE_STATUS_UI: Record<VehicleStatus, { label: string; color: string }> = {
  available:   { label: 'Доступен',      color: '#22c55e' },
  busy:        { label: 'Занят',         color: '#eab308' },
  maintenance: { label: 'На обслуживании', color: '#ef4444' },
  disabled:    { label: 'Отключён',      color: '#6b7280' },
};

/* ============================== Онбординг ============================== */
const Onboarding = ({ onCreate }: { onCreate: () => void }) => (
  <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
    <div className="grid h-20 w-20 place-items-center rounded-3xl" style={{ background: `${C.acc}18` }}>
      <Truck size={32} style={{ color: C.acc }}/>
    </div>
    <p className="text-lg font-black" style={{ color: C.t1 }}>Транспортная компания</p>
    <p className="max-w-xs text-[13px]" style={{ color: C.t3 }}>
      Создайте свою транспортную компанию и зарабатывайте на доставке товаров Sky Market —
      своих и чужих.
    </p>
    <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={onCreate}
      className="mt-2 flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white" style={{ background: C.acc }}>
      <Plus size={16}/>Создать ТК
    </motion.button>
  </div>
);

/* ============================== Регистрация ============================== */
const CreateCompanyForm = ({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) => {
  const { currentUserId } = useAuthStore();
  const { createCompany } = useTransportStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [regions, setRegions] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [kinds, setKinds] = useState<TransportKind[]>([]);
  const [weekend, setWeekend] = useState(true);
  const [minPrice, setMinPrice] = useState('200');
  const [pricePerKm, setPricePerKm] = useState('25');
  const [maxWeight, setMaxWeight] = useState('500');
  const [maxVolume, setMaxVolume] = useState('5');
  const [deliveryHours, setDeliveryHours] = useState('24');
  const [paymentDetails, setPaymentDetails] = useState('');

  const toggleKind = (k: TransportKind) => setKinds(v => v.includes(k) ? v.filter(x => x !== k) : [...v, k]);
  /* Реквизиты обязательны: продавец платит компании напрямую, и
     компания, которой некуда перевести, работу выполнить не может. */
  const canSubmit = name.trim() && city.trim() && phone.trim()
    && kinds.length > 0 && paymentDetails.trim().length > 3;

  const submit = () => {
    if (!canSubmit || !currentUserId) return;
    createCompany(currentUserId, {
      name: name.trim(), logoHue: Math.floor(Math.random() * 360), description: description.trim(),
      city: city.trim(), regions: regions.split(',').map(r => r.trim()).filter(Boolean),
      contactPhone: phone.trim(), contactEmail: email.trim(),
      workDays: ['mon','tue','wed','thu','fri', ...(weekend ? ['sat','sun'] as const : [])],
      workFrom: '09:00', workTo: '21:00', weekendDelivery: weekend,
      transportKinds: kinds, zones: regions.split(',').map(r => r.trim()).filter(Boolean),
      minPrice: Number(minPrice) || 0, pricePerKm: Number(pricePerKm) || 0,
      maxWeightKg: Number(maxWeight) || 0, maxVolumeM3: Number(maxVolume) || 0,
      deliveryTimeHours: Number(deliveryHours) || 24,
      paymentDetails: paymentDetails.trim(),
    });
    onDone();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3" style={{ borderColor: C.brd }}>
        <button type="button" onClick={onCancel}><X size={18} style={{ color: C.t3 }}/></button>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Регистрация ТК</p>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: C.t3 }}>Основная информация</p>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Название компании" className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none" style={{ background: C.l1, border: `1px solid ${C.brd}`, color: C.t1 }}/>
        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Описание" rows={2} className="w-full resize-none rounded-xl px-3.5 py-2.5 text-sm outline-none" style={{ background: C.l1, border: `1px solid ${C.brd}`, color: C.t1 }}/>
        <div className="grid grid-cols-2 gap-2">
          <input value={city} onChange={e => setCity(e.target.value)} placeholder="Город работы" className="rounded-xl px-3.5 py-2.5 text-sm outline-none" style={{ background: C.l1, border: `1px solid ${C.brd}`, color: C.t1 }}/>
          <input value={regions} onChange={e => setRegions(e.target.value)} placeholder="Регионы доставки (через запятую)" className="rounded-xl px-3.5 py-2.5 text-sm outline-none" style={{ background: C.l1, border: `1px solid ${C.brd}`, color: C.t1 }}/>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон" className="rounded-xl px-3.5 py-2.5 text-sm outline-none" style={{ background: C.l1, border: `1px solid ${C.brd}`, color: C.t1 }}/>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="rounded-xl px-3.5 py-2.5 text-sm outline-none" style={{ background: C.l1, border: `1px solid ${C.brd}`, color: C.t1 }}/>
        </div>
        <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}>
          <input type="checkbox" checked={weekend} onChange={e => setWeekend(e.target.checked)}/>Доставка по выходным
        </label>

        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: C.t3 }}>Реквизиты для оплаты</p>
        <textarea value={paymentDetails} onChange={e => setPaymentDetails(e.target.value)}
          rows={2} maxLength={600}
          placeholder="Например: СБП +7 900 000-00-00, ООО «Перевозчик»"
          className="w-full resize-none rounded-xl px-3.5 py-2.5 text-sm outline-none"
          style={{ background: C.l1, border: `1px solid ${C.brd}`, color: C.t1 }}/>
        <p className="text-[11px]" style={{ color: C.t3 }}>
          Продавец увидит их, когда отдаст вам заказ, и переведёт напрямую вам.
          Sky эти деньги не принимает и не хранит. Без реквизитов компания не
          появится в выборе перевозчиков.
        </p>

        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: C.t3 }}>Тип перевозок</p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(TRANSPORT_KIND_LABEL) as TransportKind[]).map(k => (
            <button key={k} type="button" onClick={() => toggleKind(k)}
              className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
              style={{ background: kinds.includes(k) ? `${C.acc}20` : C.l1, color: kinds.includes(k) ? C.acc : C.t2, border: `1px solid ${kinds.includes(k) ? C.acc : C.brd}` }}>
              {TRANSPORT_KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: C.t3 }}>Настройки доставки</p>
        <div className="grid grid-cols-2 gap-2">
          {[['Мин. цена, ₽', minPrice, setMinPrice], ['₽/км', pricePerKm, setPricePerKm], ['Макс. вес, кг', maxWeight, setMaxWeight], ['Макс. объём, м³', maxVolume, setMaxVolume], ['Срок доставки, ч', deliveryHours, setDeliveryHours]].map(([label, val, fn]) => (
            <div key={label as string}>
              <p className="mb-1 text-[11px]" style={{ color: C.t3 }}>{label as string}</p>
              <input value={val as string} inputMode="numeric" onChange={e => (fn as Function)(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: C.l1, border: `1px solid ${C.brd}`, color: C.t1 }}/>
            </div>
          ))}
        </div>
      </div>
      <div className="shrink-0 p-4">
        <motion.button type="button" whileTap={{ scale: 0.97 }} disabled={!canSubmit} onClick={submit}
          className="w-full rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>
          Зарегистрировать компанию
        </motion.button>
      </div>
    </div>
  );
};

/* ============================== Панель "Сегодня" ============================== */
const TodayDashboard = ({ companyId }: { companyId: string }) => {
  const { ordersFor, vehiclesFor, team, financeFor, companies } = useTransportStore();
  const orders = ordersFor(companyId);
  const company = companies.find(c => c.id === companyId)!;
  const counts = {
    active: orders.filter(o => o.status === 'assigned' || o.status === 'in_progress').length,
    pending: orders.filter(o => o.status === 'new').length,
    inTransit: orders.filter(o => o.status === 'in_progress').length,
    done: orders.filter(o => o.status === 'completed').length,
    problem: orders.filter(o => o.status === 'problem' || o.status === 'cancelled').length,
  };
  const fin = financeFor(companyId);
  const todayIncome = fin.filter(f => f.at.slice(0,10) === new Date().toISOString().slice(0,10)).reduce((a,f) => a+f.amount, 0);

  return (
    <div className="space-y-4 overflow-y-auto p-4" style={{ scrollbarWidth: 'none' }}>
      <GlassCard className="p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-lg font-black text-white" style={{ background: `linear-gradient(135deg, hsl(${company.logoHue},70%,50%), hsl(${company.logoHue+40},70%,40%))` }}>
            {company.name[0]}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold" style={{ color: C.t1 }}>{company.name}</p>
            <p className="flex items-center gap-1 text-[11px]" style={{ color: C.t3 }}>
              <Star size={11} fill={C.amber} color={C.amber}/>{company.rating.toFixed(1)} · {company.completedDeliveries} доставок · {company.city}
            </p>
          </div>
          {company.verified && <ShieldCheck size={18} style={{ color: '#22c55e' }}/>}
        </div>
      </GlassCard>

      <div className="grid grid-cols-2 gap-2.5">
        <StatCard label="Активные" value={String(counts.active)} icon={Truck} color={C.acc}/>
        <StatCard label="Ожидают отправки" value={String(counts.pending)} icon={Clock} color="#eab308"/>
        <StatCard label="В пути" value={String(counts.inTransit)} icon={Route} color="#8b5cf6"/>
        <StatCard label="Завершены" value={String(counts.done)} icon={CheckCircle2} color="#22c55e"/>
      </div>
      {counts.problem > 0 && (
        <div className="flex items-center gap-2 rounded-2xl p-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertTriangle size={16} color="#ef4444"/>
          <p className="text-xs font-semibold" style={{ color: '#ef4444' }}>{counts.problem} проблемных заказов требуют внимания</p>
        </div>
      )}
      <StatCard label="Доход сегодня" value={`${todayIncome.toLocaleString('ru')} ₽`} icon={Wallet} color="#22c55e"/>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: C.t3 }}>Флот сейчас</p>
        <div className="flex gap-1.5">
          {(['available','busy','maintenance','disabled'] as VehicleStatus[]).map(st => {
            const n = vehiclesFor(companyId).filter(v => v.status === st).length;
            return (
              <div key={st} className="flex-1 rounded-xl p-2 text-center" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                <span className="mx-auto block h-2.5 w-2.5 rounded-full"
                  style={{ background: VEHICLE_STATUS_UI[st].color }}/>
                <p className="text-[10px] font-semibold" style={{ color: C.t2 }}>{n}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* ============================== Мой транспорт ============================== */
const FleetTab = ({ companyId }: { companyId: string }) => {
  const { vehiclesFor, addVehicle, updateVehicleStatus, removeVehicle, teamFor, assignDriverToVehicle } = useTransportStore();
  const vehicles = vehiclesFor(companyId);
  const team = teamFor(companyId);
  const [showAdd, setShowAdd] = useState(false);
  const [brand, setBrand] = useState(''); const [model, setModel] = useState('');
  const [plate, setPlate] = useState(''); const [kind, setKind] = useState<TransportKind>('van');
  const [cap, setCap] = useState('500'); const [vol, setVol] = useState('4');

  const submit = () => {
    if (!brand.trim() || !model.trim() || !plate.trim()) return;
    addVehicle(companyId, { photoHue: Math.floor(Math.random()*360), brand: brand.trim(), model: model.trim(), plateNumber: plate.trim(), kind, capacityKg: Number(cap)||0, volumeM3: Number(vol)||0 });
    setBrand(''); setModel(''); setPlate(''); setShowAdd(false);
  };

  return (
    <div className="space-y-3 overflow-y-auto p-4" style={{ scrollbarWidth: 'none' }}>
      <button type="button" onClick={() => setShowAdd(true)} className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-bold text-white" style={{ background: C.acc }}>
        <Plus size={15}/>Добавить транспорт
      </button>

      {vehicles.length === 0 && <EmptyState icon={Truck} title="Транспорта пока нет" sub="Добавьте первое транспортное средство"/>}

      {vehicles.map(v => {
        const driver = team.find(t => t.id === v.driverId);
        return (
          <GlassCard key={v.id} className="p-3.5">
            <div className="flex items-start gap-3">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl" style={{ background: `hsl(${v.photoHue},50%,20%)` }}>
                <Truck size={22} style={{ color: `hsl(${v.photoHue},70%,65%)` }}/>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold" style={{ color: C.t1 }}>{v.brand} {v.model}</p>
                <p className="text-[11px]" style={{ color: C.t3 }}>{v.plateNumber} · {TRANSPORT_KIND_LABEL[v.kind]}</p>
                <p className="text-[11px]" style={{ color: C.t3 }}>До {v.capacityKg} кг · {v.volumeM3} м³ · загрузка {v.currentLoadKg} кг</p>
              </div>
              <button type="button" onClick={() => removeVehicle(v.id)}><Trash2 size={14} style={{ color: C.t3 }}/></button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <select value={v.status} onChange={e => updateVehicleStatus(v.id, e.target.value as VehicleStatus)}
                className="rounded-lg px-2 py-1.5 text-[11px] font-semibold outline-none" style={{ background: `${VEHICLE_STATUS_UI[v.status].color}15`, color: VEHICLE_STATUS_UI[v.status].color, border: 'none' }}>
                {(Object.keys(VEHICLE_STATUS_UI) as VehicleStatus[]).map(s => <option key={s} value={s}>{VEHICLE_STATUS_UI[s].label}</option>)}
              </select>
              <select value={v.driverId ?? ''} onChange={e => assignDriverToVehicle(v.id, e.target.value || null)}
                className="flex-1 rounded-lg px-2 py-1.5 text-[11px] outline-none" style={{ background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>
                <option value="">Без водителя</option>
                {team.filter(t => t.role !== 'dispatcher').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </GlassCard>
        );
      })}

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowAdd(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} onClick={e => e.stopPropagation()}
              className="max-h-[85vh] w-full max-w-md space-y-2.5 overflow-y-auto rounded-t-3xl p-5" style={{ background: C.l1 }}>
              <p className="mb-2 text-sm font-bold" style={{ color: C.t1 }}>Новое транспортное средство</p>
              <div className="grid grid-cols-2 gap-2">
                <input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Марка" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
                <input value={model} onChange={e => setModel(e.target.value)} placeholder="Модель" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
              </div>
              <input value={plate} onChange={e => setPlate(e.target.value)} placeholder="Госномер" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
              <select value={kind} onChange={e => setKind(e.target.value as TransportKind)} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}>
                {(Object.keys(TRANSPORT_KIND_LABEL) as TransportKind[]).map(k => <option key={k} value={k}>{TRANSPORT_KIND_LABEL[k]}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input value={cap} onChange={e => setCap(e.target.value)} inputMode="numeric" placeholder="Грузоподъёмность, кг" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
                <input value={vol} onChange={e => setVol(e.target.value)} inputMode="numeric" placeholder="Объём кузова, м³" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
              </div>
              <button type="button" onClick={submit} className="w-full rounded-xl py-3 text-sm font-bold text-white" style={{ background: C.acc }}>Добавить</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ============================== Команда ============================== */
const TeamTab = ({ companyId }: { companyId: string }) => {
  const { teamFor, addTeamMember, toggleTeamActive, removeTeamMember } = useTransportStore();
  const team = teamFor(companyId);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'driver'|'courier'|'dispatcher'>('driver');

  const submit = () => {
    if (!name.trim() || !phone.trim()) return;
    addTeamMember(companyId, { name: name.trim(), phone: phone.trim(), role, vehicleId: null });
    setName(''); setPhone(''); setShowAdd(false);
  };

  const ROLE_LABEL = { driver: 'Водитель', courier: 'Курьер', dispatcher: 'Диспетчер' };

  return (
    <div className="space-y-3 overflow-y-auto p-4" style={{ scrollbarWidth: 'none' }}>
      <button type="button" onClick={() => setShowAdd(true)} className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-bold text-white" style={{ background: C.acc }}>
        <Plus size={15}/>Добавить в команду
      </button>
      {team.length === 0 && <EmptyState icon={Users} title="Команда пока пуста" sub="Добавьте водителей, курьеров или диспетчеров"/>}
      {team.map(m => (
        <GlassCard key={m.id} className="flex items-center gap-3 p-3.5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style={{ background: C.acc, opacity: m.active ? 1 : 0.4 }}>{m.name[0]}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold" style={{ color: C.t1 }}>{m.name}</p>
            <p className="flex items-center gap-1 text-[11px]" style={{ color: C.t3 }}><Phone size={10}/>{m.phone} · {ROLE_LABEL[m.role]}</p>
            <p className="flex items-center gap-1 text-[11px]" style={{ color: C.t3 }}><Star size={10} fill={C.amber} color={C.amber}/>{m.rating.toFixed(1)} · {m.completedDeliveries} доставок</p>
          </div>
          <button type="button" onClick={() => toggleTeamActive(m.id)} className="rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={{ background: m.active ? 'rgba(34,197,94,0.12)' : C.l2, color: m.active ? '#22c55e' : C.t3 }}>
            {m.active ? 'Активен' : 'Неактивен'}
          </button>
          <button type="button" onClick={() => removeTeamMember(m.id)}><Trash2 size={14} style={{ color: C.t3 }}/></button>
        </GlassCard>
      ))}

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowAdd(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} onClick={e => e.stopPropagation()}
              className="max-h-[85vh] w-full max-w-md space-y-2.5 overflow-y-auto rounded-t-3xl p-5" style={{ background: C.l1 }}>
              <p className="mb-2 text-sm font-bold" style={{ color: C.t1 }}>Новый участник команды</p>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Имя" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
              <div className="grid grid-cols-3 gap-2">
                {(['driver','courier','dispatcher'] as const).map(r => (
                  <button key={r} type="button" onClick={() => setRole(r)} className="rounded-xl py-2 text-[12px] font-semibold" style={{ background: role===r ? `${C.acc}20` : C.l2, color: role===r ? C.acc : C.t2 }}>{ROLE_LABEL[r]}</button>
                ))}
              </div>
              <button type="button" onClick={submit} className="w-full rounded-xl py-3 text-sm font-bold text-white" style={{ background: C.acc }}>Добавить</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ============================== Заказы доставки ============================== */
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  new: { label: 'Новый', color: '#3b82f6' },
  assigned: { label: 'Назначен', color: '#eab308' },
  in_progress: { label: 'Выполняется', color: '#8b5cf6' },
  completed: { label: 'Завершён', color: '#22c55e' },
  cancelled: { label: 'Отменён', color: '#6b7280' },
  problem: { label: 'Проблема', color: '#ef4444' },
};

const OrdersTab = ({ companyId }: { companyId: string }) => {
  const { ordersFor, vehiclesFor, teamFor, suggestAssignment, assignOrder, advanceOrderStatus, cancelOrder } = useTransportStore();
  const [filter, setFilter] = useState<'new'|'assigned'|'in_progress'|'completed'|'cancelled'>('new');
  const orders = ordersFor(companyId).filter(o => o.status === filter);
  const vehicles = vehiclesFor(companyId);
  const team = teamFor(companyId);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-3">
        <Segmented value={filter} onChange={setFilter} options={[
          { key: 'new', label: 'Новые' }, { key: 'assigned', label: 'Назначенные' },
          { key: 'in_progress', label: 'Выполняются' }, { key: 'completed', label: 'Завершённые' },
          { key: 'cancelled', label: 'Отменённые' },
        ]}/>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ scrollbarWidth: 'none' }}>
        {orders.length === 0 && <EmptyState icon={Package} title="Заказов нет" sub="В этой категории пока пусто"/>}
        {orders.map(o => {
          const vehicle = vehicles.find(v => v.id === o.vehicleId);
          const driver = team.find(t => t.id === o.driverId);
          const suggestion = filter === 'new' ? suggestAssignment(companyId, o.id) : null;
          return (
            <GlassCard key={o.id} className="p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-mono" style={{ color: C.t3 }}>№{o.id.slice(-6)}</p>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `${STATUS_LABEL[o.status].color}18`, color: STATUS_LABEL[o.status].color }}>{STATUS_LABEL[o.status].label}</span>
              </div>
              <p className="text-sm font-bold" style={{ color: C.t1 }}>{o.productName} · {o.qty} шт · {o.weightKg} кг</p>
              <p className="text-[11px]" style={{ color: C.t3 }}>Продавец: {o.sellerName}</p>
              <div className="mt-2 space-y-1">
                <p className="flex items-center gap-1.5 text-[11.5px]" style={{ color: C.t2 }}><MapPin size={11} style={{ color: '#22c55e' }}/>{o.fromAddress}</p>
                <p className="flex items-center gap-1.5 text-[11.5px]" style={{ color: C.t2 }}><MapPin size={11} style={{ color: '#ef4444' }}/>{o.toAddress}</p>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11.5px]" style={{ color: C.t3 }}>
                <span>{o.distanceKm} км · {o.etaHours} ч</span>
                <span className="font-bold" style={{ color: C.t1 }}>{(o.proposedPrice ?? o.price).toLocaleString('ru')} ₽</span>
              </div>
              {vehicle && <p className="mt-1.5 text-[11px]" style={{ color: C.t3 }}>Транспорт: {vehicle.brand} {vehicle.model} · Водитель: {driver?.name ?? '—'}</p>}

              {filter === 'new' && (
                <div className="mt-3 space-y-1.5">
                  {suggestion ? (
                    <button type="button" onClick={() => assignOrder(o.id, suggestion.vehicle.id, suggestion.driver?.id ?? null)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold text-white" style={{ background: C.acc }}>
                      <Sparkles size={13}/> Назначить: {suggestion.vehicle.brand} {suggestion.vehicle.model}{suggestion.driver ? ` · ${suggestion.driver.name}` : ''}
                    </button>
                  ) : (
                    <p className="text-[11px]" style={{ color: '#ef4444' }}>Нет свободного транспорта нужной грузоподъёмности</p>
                  )}
                </div>
              )}
              {(filter === 'assigned' || filter === 'in_progress') && (
                <button type="button" onClick={() => advanceOrderStatus(o.id)}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold text-white" style={{ background: C.acc }}>
                  {filter === 'assigned' ? 'Отметить: в пути' : 'Отметить: доставлено'}
                </button>
              )}
              {filter !== 'completed' && filter !== 'cancelled' && (
                <button type="button" onClick={() => cancelOrder(o.id)} className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-semibold" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                  <Ban size={12}/>Отменить заказ
                </button>
              )}
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
};

/* ============================== Биржа доставок ============================== */
const ExchangeTab = ({ companyId }: { companyId: string }) => {
  const { exchangeOrders, acceptExchangeOrder, declineExchangeOrder, proposePrice, companies } = useTransportStore();
  const orders = exchangeOrders();
  const myCompany = companies.find(c => c.id === companyId)!;
  const [offerFor, setOfferFor] = useState<string | null>(null);
  const [offerPrice, setOfferPrice] = useState('');

  return (
    <div className="space-y-3 overflow-y-auto p-4" style={{ scrollbarWidth: 'none' }}>
      <div className="rounded-2xl p-3 text-[11.5px]" style={{ background: `${C.acc}10`, border: `1px solid ${C.acc}30`, color: C.t2 }}>
        Здесь доступны заказы других продавцов Sky Market — принимайте их для дополнительного заработка.
      </div>
      {orders.length === 0 && <EmptyState icon={ExchangeIcon} title="Пока нет доступных заказов" sub="Новые заказы от других продавцов появятся здесь"/>}
      {orders.map(o => {
        const isMyOffer = o.offerCompanyId === companyId;
        const isOtherOffer = !!o.offerCompanyId && o.offerCompanyId !== companyId;
        return (
        <GlassCard key={o.id} className="p-3.5">
          <p className="text-sm font-bold" style={{ color: C.t1 }}>{o.productName}</p>
          <p className="text-[11px]" style={{ color: C.t3 }}>от {o.sellerName} · {o.qty} шт · {o.weightKg} кг</p>
          <div className="mt-2 space-y-1">
            <p className="flex items-center gap-1.5 text-[11.5px]" style={{ color: C.t2 }}><MapPin size={11} style={{ color: '#22c55e' }}/>{o.fromAddress}</p>
            <p className="flex items-center gap-1.5 text-[11.5px]" style={{ color: C.t2 }}><MapPin size={11} style={{ color: '#ef4444' }}/>{o.toAddress}</p>
          </div>
          <div className="mt-2 flex items-center justify-between text-[12px]" style={{ color: C.t3 }}>
            <span>{o.distanceKm} км · {o.etaHours} ч</span>
            <span className="text-sm font-black" style={{ color: '#22c55e' }}>{o.price.toLocaleString('ru')} ₽</span>
          </div>

          {isMyOffer ? (
            <div className="mt-3 rounded-xl p-2.5 text-[11.5px] font-semibold" style={{ background: 'rgba(234,179,8,0.1)', color: '#eab308' }}>
              Ваше предложение {o.proposedPrice?.toLocaleString('ru')} ₽ отправлено — ожидает решения продавца
            </div>
          ) : isOtherOffer ? (
            <div className="mt-3 rounded-xl p-2.5 text-[11.5px]" style={{ background: C.l2, color: C.t3 }}>
              Другая компания уже предложила цену — ожидание решения продавца
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <button type="button" onClick={() => { void acceptExchangeOrder(o.id); }} className="rounded-xl py-2.5 text-[11.5px] font-bold text-white" style={{ background: '#22c55e' }}>Принять</button>
                <button type="button" onClick={() => setOfferFor(o.id)} className="rounded-xl py-2.5 text-[11.5px] font-bold" style={{ background: C.l2, color: C.t2 }}>Своя цена</button>
                <button type="button" onClick={() => declineExchangeOrder(o.id)} className="rounded-xl py-2.5 text-[11.5px] font-bold" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>Отказ</button>
              </div>
              {offerFor === o.id && (
                <div className="mt-2 flex items-center gap-2">
                  <input value={offerPrice} onChange={e => setOfferPrice(e.target.value)} inputMode="numeric" placeholder="Ваша цена, ₽"
                    className="flex-1 rounded-xl px-3 py-2 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
                  <button type="button" onClick={() => { if (offerPrice) proposePrice(o.id, companyId, myCompany.name, Number(offerPrice)); setOfferFor(null); setOfferPrice(''); }}
                    className="rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: C.acc }}>Отправить</button>
                </div>
              )}
            </>
          )}
        </GlassCard>
        );
      })}
    </div>
  );
};

/* ============================== Финансы ============================== */
const FinanceTab = ({ companyId }: { companyId: string }) => {
  const { financeFor, ordersFor } = useTransportStore();
  const fin = financeFor(companyId);
  const today = new Date().toISOString().slice(0,10);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
  const todayIncome = fin.filter(f => f.at.slice(0,10) === today).reduce((a,f) => a+f.amount, 0);
  const monthIncome = fin.filter(f => f.at.slice(0,10) >= monthStart).reduce((a,f) => a+f.amount, 0);
  const completed = ordersFor(companyId).filter(o => o.status === 'completed');
  const avgCheck = completed.length ? Math.round(fin.reduce((a,f)=>a+f.amount,0) / completed.length) : 0;

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6-i));
    const key = d.toISOString().slice(0,10);
    return { x: d.toLocaleDateString('ru', { weekday: 'short' }), y: fin.filter(f => f.at.slice(0,10) === key).reduce((a,f)=>a+f.amount,0) };
  });

  const byRoute = new Map<string, number>();
  ordersFor(companyId).filter(o => o.status === 'completed').forEach(o => {
    const key = `${o.fromAddress.split(',')[0]} → ${o.toAddress.split(',')[0]}`;
    byRoute.set(key, (byRoute.get(key) ?? 0) + (o.proposedPrice ?? o.price));
  });
  const topRoutes = [...byRoute.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);

  return (
    <div className="space-y-4 overflow-y-auto p-4" style={{ scrollbarWidth: 'none' }}>
      <div className="grid grid-cols-2 gap-2.5">
        <StatCard label="Доход сегодня" value={`${todayIncome.toLocaleString('ru')} ₽`} icon={Wallet} color="#22c55e"/>
        <StatCard label="Доход за месяц" value={`${monthIncome.toLocaleString('ru')} ₽`} icon={TrendingUp} color={C.acc}/>
        <StatCard label="Доставок выполнено" value={String(completed.length)} icon={CheckCircle2} color="#8b5cf6"/>
        <StatCard label="Средний чек" value={`${avgCheck.toLocaleString('ru')} ₽`} icon={Package} color="#eab308"/>
      </div>
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: C.t3 }}>Доход по дням</p>
        <GlassCard className="p-3">
          <InteractiveBarChart data={last7} color={C.acc} format={v => `${v.toLocaleString('ru')} ₽`}/>
        </GlassCard>
      </div>
      {topRoutes.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: C.t3 }}>Самые прибыльные направления</p>
          <div className="space-y-1.5">
            {topRoutes.map(([route, amount]) => (
              <div key={route} className="flex items-center justify-between rounded-xl p-2.5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                <p className="truncate text-[12px]" style={{ color: C.t2 }}>{route}</p>
                <p className="shrink-0 text-[12px] font-bold" style={{ color: C.t1 }}>{amount.toLocaleString('ru')} ₽</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================== Тарифы ============================== */
const TariffsTab = ({ companyId }: { companyId: string }) => {
  const { tariffsFor, addTariff, removeTariff } = useTransportStore();
  const tariffs = tariffsFor(companyId);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState(''); const [maxW, setMaxW] = useState('10');
  const [price, setPrice] = useState('300'); const [desc, setDesc] = useState(''); const [express, setExpress] = useState(false);

  const submit = () => {
    if (!name.trim()) return;
    addTariff(companyId, { name: name.trim(), maxWeightKg: Number(maxW)||0, basePrice: Number(price)||0, description: desc.trim(), express });
    setName(''); setMaxW('10'); setPrice('300'); setDesc(''); setExpress(false); setShowAdd(false);
  };

  return (
    <div className="space-y-3 overflow-y-auto p-4" style={{ scrollbarWidth: 'none' }}>
      <button type="button" onClick={() => setShowAdd(true)} className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-bold text-white" style={{ background: C.acc }}>
        <Plus size={15}/>Новый тариф
      </button>
      {tariffs.length === 0 && <EmptyState icon={Wallet} title="Тарифов пока нет" sub="Например: Стандарт до 10 кг от 300 ₽"/>}
      {tariffs.map(t => (
        <GlassCard key={t.id} className="flex items-center gap-3 p-3.5">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-bold" style={{ color: C.t1 }}>{t.name} {t.express && <Sparkles size={12} style={{ color: '#eab308' }}/>}</p>
            <p className="text-[11px]" style={{ color: C.t3 }}>до {t.maxWeightKg} кг · от {t.basePrice.toLocaleString('ru')} ₽{t.description ? ` · ${t.description}` : ''}</p>
          </div>
          <button type="button" onClick={() => removeTariff(t.id)}><Trash2 size={14} style={{ color: C.t3 }}/></button>
        </GlassCard>
      ))}
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowAdd(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} onClick={e => e.stopPropagation()}
              className="max-h-[85vh] w-full max-w-md space-y-2.5 overflow-y-auto rounded-t-3xl p-5" style={{ background: C.l1 }}>
              <p className="mb-2 text-sm font-bold" style={{ color: C.t1 }}>Новый тариф</p>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Название (Стандарт, Экспресс...)" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
              <div className="grid grid-cols-2 gap-2">
                <input value={maxW} onChange={e => setMaxW(e.target.value)} inputMode="numeric" placeholder="До, кг" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
                <input value={price} onChange={e => setPrice(e.target.value)} inputMode="numeric" placeholder="Цена от, ₽" className="rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
              </div>
              <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Описание (например: доставка день в день)" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
              <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}>
                <input type="checkbox" checked={express} onChange={e => setExpress(e.target.checked)}/>Экспресс-тариф
              </label>
              <button type="button" onClick={submit} className="w-full rounded-xl py-3 text-sm font-bold text-white" style={{ background: C.acc }}>Создать тариф</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ============================== Мои склады ============================== */
const WarehousesTab = ({ companyId }: { companyId: string }) => {
  const { warehousesFor, linkWarehouse, unlinkWarehouse } = useTransportStore();
  const list = warehousesFor(companyId);
  const [showAdd, setShowAdd] = useState(false);
  const [wname, setWname] = useState(''); const [addr, setAddr] = useState(''); const [own, setOwn] = useState(true);

  const submit = () => {
    if (!wname.trim() || !addr.trim()) return;
    linkWarehouse(companyId, { warehouseName: wname.trim(), address: addr.trim(), own });
    setWname(''); setAddr(''); setShowAdd(false);
  };

  return (
    <div className="space-y-3 overflow-y-auto p-4" style={{ scrollbarWidth: 'none' }}>
      <button type="button" onClick={() => setShowAdd(true)} className="flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-sm font-bold text-white" style={{ background: C.acc }}>
        <Plus size={15}/>Привязать склад
      </button>
      {list.length === 0 && <EmptyState icon={WarehouseIcon} title="Склады не привязаны" sub="Подключите свои склады или склады продавцов"/>}
      {list.map(w => (
        <GlassCard key={w.id} className="flex items-center gap-3 p-3.5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${C.acc}18` }}><WarehouseIcon size={17} style={{ color: C.acc }}/></div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold" style={{ color: C.t1 }}>{w.warehouseName}</p>
            <p className="truncate text-[11px]" style={{ color: C.t3 }}>{w.address} · {w.own ? 'собственный' : 'склад продавца'}</p>
          </div>
          <button type="button" onClick={() => unlinkWarehouse(w.id)}><Trash2 size={14} style={{ color: C.t3 }}/></button>
        </GlassCard>
      ))}
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowAdd(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} onClick={e => e.stopPropagation()}
              className="max-h-[85vh] w-full max-w-md space-y-2.5 overflow-y-auto rounded-t-3xl p-5" style={{ background: C.l1 }}>
              <p className="mb-2 text-sm font-bold" style={{ color: C.t1 }}>Привязать склад</p>
              <input value={wname} onChange={e => setWname(e.target.value)} placeholder="Название склада" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
              <input value={addr} onChange={e => setAddr(e.target.value)} placeholder="Адрес" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 }}/>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setOwn(true)} className="rounded-xl py-2 text-[12px] font-semibold" style={{ background: own ? `${C.acc}20` : C.l2, color: own ? C.acc : C.t2 }}>Собственный</button>
                <button type="button" onClick={() => setOwn(false)} className="rounded-xl py-2 text-[12px] font-semibold" style={{ background: !own ? `${C.acc}20` : C.l2, color: !own ? C.acc : C.t2 }}>Склад продавца</button>
              </div>
              <button type="button" onClick={submit} className="w-full rounded-xl py-3 text-sm font-bold text-white" style={{ background: C.acc }}>Привязать</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ============================== Панель одобрения предложений (для продавца) ============================== */
export const DeliveryOffersPanel = ({ sellerId }: { sellerId: string }) => {
  const { offersForSeller, approveOffer, rejectOffer, load } = useTransportStore();
  /* Предложения приходят с сервера: их шлют чужие компании, и в памяти
     этой вкладки их взяться неоткуда. */
  useEffect(() => { void load(); }, []);
  const offers = offersForSeller(sellerId);
  if (offers.length === 0) return null;

  return (
    <div className="space-y-2 px-4 pt-3">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: C.t3 }}>
        <ExchangeIcon size={12}/>Предложения на доставку · {offers.length}
      </p>
      {offers.map(o => (
        <GlassCard key={o.id} className="p-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold" style={{ color: C.t1 }}>{o.offerCompanyName}</p>
            <p className="text-sm font-black" style={{ color: '#22c55e' }}>{o.proposedPrice?.toLocaleString('ru')} ₽</p>
          </div>
          <p className="mt-0.5 text-[11px]" style={{ color: C.t3 }}>{o.productName} · {o.fromAddress} → {o.toAddress} · было {o.price.toLocaleString('ru')} ₽</p>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => approveOffer(o.id)} className="flex items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-bold text-white" style={{ background: '#22c55e' }}>
              <Check size={13}/>Одобрить
            </button>
            <button type="button" onClick={() => rejectOffer(o.id)} className="flex items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-bold" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
              <X size={13}/>Отклонить
            </button>
          </div>
        </GlassCard>
      ))}
    </div>
  );
};

/* ============================== Главный компонент ============================== */
type TCTab = 'today'|'map'|'fleet'|'team'|'orders'|'exchange'|'finance'|'tariffs'|'warehouses';
const TC_TABS: { key: TCTab; label: string; icon: any }[] = [
  { key: 'today',      label: 'Сегодня',   icon: Route },
  { key: 'map',        label: 'Карта',     icon: MapPin },
  { key: 'orders',     label: 'Заказы',    icon: Package },
  { key: 'exchange',   label: 'Биржа',     icon: ExchangeIcon },
  { key: 'fleet',      label: 'Транспорт', icon: Truck },
  { key: 'team',       label: 'Команда',   icon: Users },
  { key: 'warehouses', label: 'Склады',    icon: WarehouseIcon },
  { key: 'tariffs',    label: 'Тарифы',    icon: Wallet },
  { key: 'finance',    label: 'Финансы',   icon: TrendingUp },
];

export const TransportCompanyHub = () => {
  const { currentUserId } = useAuthStore();
  const { companyByOwner, load } = useTransportStore();
  const company = currentUserId ? companyByOwner(currentUserId) : null;
  /* Компания, парк, команда и биржа приходят с сервера. */
  useEffect(() => { void load(); }, []);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<TCTab>('today');

  if (creating) return <CreateCompanyForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)}/>;
  if (!company) return <Onboarding onCreate={() => setCreating(true)}/>;

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: C.bg }}>
      <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-3 py-2" style={{ borderColor: C.brd, scrollbarWidth: 'none' }}>
        {TC_TABS.map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold"
            style={{ background: tab === t.key ? C.acc : C.l1, color: tab === t.key ? '#fff' : C.t2 }}>
            <t.icon size={13}/>{t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'today'      && <TodayDashboard companyId={company.id}/>}
        {tab === 'map'        && <TransportMap companyId={company.id}/>}
        {tab === 'orders'     && <OrdersTab companyId={company.id}/>}
        {tab === 'exchange'   && <ExchangeTab companyId={company.id}/>}
        {tab === 'fleet'      && <FleetTab companyId={company.id}/>}
        {tab === 'team'       && <TeamTab companyId={company.id}/>}
        {tab === 'warehouses' && <WarehousesTab companyId={company.id}/>}
        {tab === 'tariffs'    && <TariffsTab companyId={company.id}/>}
        {tab === 'finance'    && <FinanceTab companyId={company.id}/>}
      </div>
    </div>
  );
};
