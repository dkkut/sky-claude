import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Bike, Footprints, Car as CarIcon, Truck as VanIcon, Check, Package, Loader2 } from 'lucide-react';
import { useCourierStore } from '@/marketplace/logistics/courierStore';
import { useAuthStore } from '@/core/auth/store';
import { CITIES } from '@/marketplace/logistics/geo';
import type { CourierVehicle } from '@/marketplace/logistics/types';
import { CourierAdmission } from './CourierAdmission';
import { CourierDashboard } from './CourierDashboard';

const VEHICLES: { key: CourierVehicle; label: string; icon: any; hint: string }[] = [
  { key: 'foot',    label: 'Пешком',     icon: Footprints, hint: 'Доставки в пределах района' },
  { key: 'bike',    label: 'Велосипед',  icon: Bike,       hint: 'Быстро по центру города' },
  { key: 'scooter', label: 'Скутер',     icon: Bike,       hint: 'Средние дистанции' },
  { key: 'car',     label: 'Автомобиль', icon: CarIcon,    hint: 'Крупные заказы, дальние адреса' },
  { key: 'van',     label: 'Фургон',     icon: VanIcon,    hint: 'Грузовые доставки' },
];

export const CourierApply = ({ onBack }: { onBack: () => void }) => {
  const { registerAsCourier, myCourierProfile, loaded, load } = useCourierStore();
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const profile = myCourierProfile();

  /* Курьерский профиль, если он уже есть, лежит на сервере — экран
     не должен предлагать регистрацию заново только потому, что до
     сюда открыли напрямую, минуя другие экраны, которые уже успели
     наполнить общий кэш логистики. */
  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);

  const [step, setStep] = useState(0);
  const [vehicle, setVehicle] = useState<CourierVehicle>('bike');
  const [cityId, setCityId] = useState(CITIES[0].id);
  const [district, setDistrict] = useState(CITIES[0].districts[0]);
  const [price, setPrice] = useState(200);
  const [bio, setBio] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const city = CITIES.find(c => c.id === cityId) ?? CITIES[0];

  if (!loaded) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 size={22} className="animate-spin" style={{ color: 'var(--t3)' }} />
      </div>
    );
  }

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

  /* ── Анкета уже подана: допуск к работе или рабочий кабинет ──────── */
  if (profile) {
    return (
      <div className="flex h-full flex-col">
        <div className="shrink-0 px-4 pt-4">
          <button type="button" onClick={onBack} className="mb-1 text-left text-[12.5px]" style={{ color: 'var(--t3)' }}>← Работа</button>
        </div>
        <div className="min-h-0 flex-1">
          {profile.status === 'approved'
            ? <CourierDashboard courier={profile} />
            : <CourierAdmission courier={profile} />}
        </div>
      </div>
    );
  }

  /* ── Заявка отправляется на сервер ────────────────────────────── */
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
