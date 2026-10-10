import { useEffect, useState } from 'react';
import { Percent } from 'lucide-react';
import { apiCodeCoupons, type Coupon } from './codesApi';

/* Плашка над тарифами Prime: у человека есть скидка по Sky Codes.
   Сама скидка применяется на сервере при покупке — здесь только подсказка. */
export const PrimeCouponNote = () => {
  const [c, setC] = useState<Coupon | null>(null);
  useEffect(() => {
    let alive = true;
    void apiCodeCoupons().then((r) => {
      if (!alive || !r.ok) return;
      setC([...r.data.items].sort((a, b) => b.percent - a.percent)[0] ?? null);
    });
    return () => { alive = false; };
  }, []);
  if (!c) return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
      style={{ background: 'color-mix(in srgb, var(--purple) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--purple) 35%, transparent)', color: 'var(--t1)' }}>
      <Percent size={14} style={{ color: 'var(--purple)' }} />
      <span>{`У вас скидка ${c.percent}% на Sky Prime по коду — она применится при покупке и спишется один раз.`}</span>
    </div>
  );
};
