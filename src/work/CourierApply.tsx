import { useState } from 'react';
import { motion } from 'framer-motion';
import { Bike, Footprints, Car as CarIcon, Truck as VanIcon, Check, Star, Package, Power } from 'lucide-react';
import { VEHICLE_CFG } from '@/marketplace/logistics/shared';
import { useCourierStore } from '@/marketplace/logistics/courierStore';
import { useAuthStore } from '@/core/auth/store';
import { CITIES } from '@/marketplace/logistics/geo';
import type { CourierVehicle } from '@/marketplace/logistics/types';

const VEHICLES: { key: CourierVehicle; label: string; icon: any; hint: string }[] = [
  { key: 'foot',    label: 'Пешком',     icon: Footprints, hint: 'Доставки в пределах района' },
  { key: 'bike',    label: 'Велосипед',  icon: Bike,       hint: 'Быстро по центру города' },
  { key: 'scooter', label: 'Скутер',     icon: Bike,       hint: 'Средние дистанции' },
  { key: 'car',     label: 'Автомобиль', icon: CarIcon,    hint: 'Крупные заказы, дальние адреса' },
  { key: 'van',     label: 'Фургон',     icon: VanIcon,    hint: 'Грузовые доставки' },
];

export const CourierApply = ({ onBack }: { onBack: () => void }) => {
  const { registerAsCourier, myCourierProfile, setMyOnline } = useCourierStore();
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const profile = myCourierProfile();

  const [step, setStep] = useState(0);
  const [vehicle, setVehicle] = useState<CourierVehicle>('bike');
  const [cityId, setCityId] = useState(CITIES[0].id);
  const [district, setDistrict] = useState(CITIES[0].districts[0]);
  const [price, setPrice] = useState(200);
  const [bio, setBio] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const city = CITIES.find(c => c.id === cityId) ?? CITIES[0];

  const submit = () => {
    setSubmitting(true);
    setTimeout(() => {
      registerAsCourier({
        name: me?.name ?? 'Курьер Sky',
        phone: me?.phone ?? '+7 (999) 000-00-00',
        cityId, district, vehicle, pricePerDelivery: price,
        workFrom: '09:00', workTo: '21:00', bio: bio.trim() || 'Новый курьер Sky, готов к заказам!',
      });
      setSubmitting(false);
    }, 700);
  };

  /* ── Уже работает курьером ─────────────────────────────────────── */
  if (profile) {
    return (
      <div className="flex h-full flex-col overflow-y-auto px-4 py-4">
        <button type="button" onClick={onBack} className="mb-3 text-left text-[12.5px]" style={{ color: 'var(--t3)' }}>← Работа</button>

        <div className="rounded-3xl p-5 text-center" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.15), var(--bg-l1))', border: '1px solid rgba(6,182,212,0.25)' }}>
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full" style={{ background: 'var(--bg-l2)' }}>
            {(() => { const Icon = VEHICLE_CFG[profile.vehicle].icon; return <Icon size={28} style={{ color:'var(--t2)' }}/>; })()}
          </div>
          <p className="text-lg font-black" style={{ color: 'var(--t1)' }}>{profile.name}</p>
          <div className="mt-1 flex items-center justify-center gap-1 text-[12.5px]" style={{ color: 'var(--t3)' }}>
            <Star size={12} fill="#f59e0b" color="#f59e0b"/>{profile.rating} · {profile.deliveriesCount} доставок
          </div>
        </div>

        <button type="button" onClick={() => setMyOnline(!profile.online)}
          className="mt-4 flex items-center justify-center gap-2 rounded-2xl py-3.5 text-[13.5px] font-bold"
          style={{ background: profile.online ? 'rgba(34,197,94,0.15)' : 'var(--bg-l2)', color: profile.online ? 'var(--green)' : 'var(--t3)' }}>
          <Power size={15}/>{profile.online ? 'Вы на линии' : 'Выйти на линию'}
        </button>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl p-3.5 text-center" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <p className="text-lg font-black" style={{ color: 'var(--t1)' }}>{profile.pricePerDelivery} ₽</p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>за доставку</p>
          </div>
          <div className="rounded-2xl p-3.5 text-center" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <p className="text-lg font-black" style={{ color: 'var(--t1)' }}>{city?.name ?? profile.cityId}</p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{profile.district}</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>О себе</p>
          <p className="text-[13px]" style={{ color: 'var(--t2)' }}>{profile.bio}</p>
        </div>

        <p className="mt-4 text-center text-[11.5px]" style={{ color: 'var(--t3)' }}>
          Ваш профиль уже виден продавцам в разделе «Курьеры» — заказы будут поступать через тот же личный кабинет.
        </p>
      </div>
    );
  }

  /* ── Успешная подача заявки (мгновенное одобрение для демо) ──── */
  if (submitting) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="h-8 w-8 rounded-full border-2 border-t-transparent" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}/>
        <p className="text-[12.5px]" style={{ color: 'var(--t3)' }}>Оформляем анкету…</p>
      </div>
    );
  }

  /* ── Анкета трудоустройства ────────────────────────────────────── */
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="mb-2 text-left text-[12.5px]" style={{ color: 'var(--t3)' }}>← Работа</button>
        <h2 className="text-lg font-black" style={{ color: 'var(--t1)' }}>Стать курьером Sky</h2>
        <p className="text-[12.5px]" style={{ color: 'var(--t3)' }}>Шаг {step+1} из 3</p>
        <div className="mt-2 flex gap-1.5">
          {[0,1,2].map(i => <div key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? 'var(--accent)' : 'var(--bg-l2)' }}/>)}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {step === 0 && (
          <div className="space-y-2.5">
            <p className="mb-1 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Выберите транспорт</p>
            {VEHICLES.map(v => (
              <button key={v.key} type="button" onClick={() => setVehicle(v.key)}
                className="flex w-full items-center gap-3 rounded-2xl p-3.5 text-left"
                style={{ background: vehicle === v.key ? 'var(--accent-bg)' : 'var(--bg-l1)', border: `1.5px solid ${vehicle === v.key ? 'var(--accent)' : 'var(--border)'}` }}>
                <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: 'var(--bg-l2)' }}><v.icon size={17} style={{ color: 'var(--t2)' }}/></div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold" style={{ color: 'var(--t1)' }}>{v.label}</p>
                  <p className="truncate text-[11.5px]" style={{ color: 'var(--t3)' }}>{v.hint}</p>
                </div>
                {vehicle === v.key && <Check size={16} style={{ color: 'var(--accent)' }}/>}
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Город</p>
              <div className="flex flex-wrap gap-2">
                {CITIES.map(c => (
                  <button key={c.id} type="button" onClick={() => { setCityId(c.id); setDistrict(c.districts[0]); }}
                    className="rounded-xl px-3 py-2 text-[12.5px] font-semibold"
                    style={{ background: cityId === c.id ? 'var(--accent)' : 'var(--bg-l1)', color: cityId === c.id ? '#fff' : 'var(--t2)', border: '1px solid var(--border)' }}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Район</p>
              <div className="flex flex-wrap gap-2">
                {city.districts.map(d => (
                  <button key={d} type="button" onClick={() => setDistrict(d)}
                    className="rounded-xl px-3 py-2 text-[12.5px] font-semibold"
                    style={{ background: district === d ? 'var(--accent)' : 'var(--bg-l1)', color: district === d ? '#fff' : 'var(--t2)', border: '1px solid var(--border)' }}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Цена за доставку</p>
              <div className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                <input type="range" min={100} max={600} step={10} value={price} onChange={e => setPrice(+e.target.value)} className="flex-1"/>
                <span className="w-16 shrink-0 text-right text-[14px] font-black" style={{ color: 'var(--t1)' }}>{price} ₽</span>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Расскажите о себе (необязательно)</p>
            <textarea value={bio} onChange={e => setBio(e.target.value)} rows={4} placeholder="Например: работаю быстро, есть термобокс, доступен с утра до вечера"
              className="w-full resize-none rounded-2xl px-4 py-3 text-[13px] outline-none" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
            <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Проверьте анкету</p>
              {[['Транспорт', VEHICLES.find(v=>v.key===vehicle)?.label],['Город', city.name],['Район', district],['Цена', `${price} ₽`]].map(([k,v]) => (
                <div key={k} className="flex items-center justify-between py-1.5 text-[12.5px]">
                  <span style={{ color: 'var(--t3)' }}>{k}</span><span style={{ color: 'var(--t1)' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 p-4">
        {step < 2 ? (
          <button type="button" onClick={() => setStep(s => s+1)} className="sky-btn-primary w-full justify-center py-3.5">Далее</button>
        ) : (
          <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={submit} className="sky-btn-primary w-full justify-center py-3.5 text-[14px]">
            <Package size={15}/>Отправить анкету
          </motion.button>
        )}
      </div>
    </div>
  );
};
