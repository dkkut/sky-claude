import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, Star, Wallet, Package } from 'lucide-react';
import { VEHICLE_CFG } from '@/marketplace/logistics/shared';
import { CourierApply } from './CourierApply';
import { useCourierStore } from '@/marketplace/logistics/courierStore';

type WorkView = 'hub' | 'courier';

export const WorkModule = () => {
  const [view, setView] = useState<WorkView>('hub');
  const { myCourierProfile } = useCourierStore();
  const courierProfile = myCourierProfile();

  if (view === 'courier') return <CourierApply onBack={() => setView('hub')}/>;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="shrink-0 px-4 pt-4 pb-2">
        <h2 className="text-lg font-black" style={{ color: 'var(--t1)' }}>Работа в Sky</h2>
        <p className="text-[12.5px]" style={{ color: 'var(--t3)' }}>Зарабатывайте вместе с платформой</p>
      </div>

      <div className="px-4 py-3 space-y-3">
        <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={() => setView('courier')}
          className="flex w-full items-center gap-4 overflow-hidden rounded-3xl p-4 text-left"
          style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.14), var(--bg-l1))', border: '1px solid rgba(6,182,212,0.22)' }}>
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl" style={{ background: 'rgba(6,182,212,0.15)' }}>
            {(() => {
              const Icon = courierProfile ? VEHICLE_CFG[courierProfile.vehicle].icon : Package;
              return <Icon size={24} style={{ color:'#06b6d4' }}/>;
            })()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-[15px] font-bold" style={{ color: 'var(--t1)' }}>Курьер</p>
              {courierProfile && <span className="h-2 w-2 rounded-full" style={{ background: courierProfile.online ? 'var(--green)' : 'var(--t3)' }}/>}
            </div>
            {courierProfile ? (
              <p className="text-[12px]" style={{ color: 'var(--t3)' }}>
                <Star size={9} className="mb-0.5 inline" fill="#f59e0b" color="#f59e0b"/> {courierProfile.rating} · {courierProfile.deliveriesCount} доставок
              </p>
            ) : (
              <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Доставляйте заказы Sky Market, гибкий график</p>
            )}
          </div>
          <ChevronRight size={16} style={{ color: 'var(--t3)' }}/>
        </motion.button>

        {courierProfile && (
          <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2">
              <Wallet size={15} style={{ color: 'var(--accent)' }}/>
              <p className="text-[12.5px] font-semibold" style={{ color: 'var(--t2)' }}>Доход от доставок</p>
            </div>
            <p className="mt-1 text-xl font-black" style={{ color: 'var(--t1)' }}>
              {courierProfile.deliveriesCount} доставок
            </p>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Выплаты приходят на баланс Sky Money</p>
          </div>
        )}
      </div>
    </div>
  );
};
