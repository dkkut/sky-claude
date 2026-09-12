/* ======================================================================
   SKY ПВЗ  —  Аналитика
====================================================================== */
import { useMemo, useState } from 'react';
import { Eye, Package, Timer, Hourglass, TrendingUp, PackageX, Ban, Truck, Star} from 'lucide-react';
import { C, fmt } from '@/marketplace/SkyMarket';
import { usePVZStore } from './store';
import { GlassCard, KpiTile, Segmented, InteractiveLineChart, Heatmap, type ChartPeriod, PERIOD_DAYS } from './shared';
import type { PVZ } from './types';

export const AnalyticsScreen = ({ pvz }: { pvz: PVZ }) => {
  const { snapshotsFor, staffFor } = usePVZStore();
  const all = snapshotsFor(pvz.id);
  const staff = staffFor(pvz.id);
  const [period, setPeriod] = useState<ChartPeriod>('30d');
  const slice = all.slice(-PERIOD_DAYS[period]);

  const avg = (f: (s: typeof all[0]) => number) => slice.length ? slice.reduce((a,s)=>a+f(s),0)/slice.length : 0;
  const sum = (f: (s: typeof all[0]) => number) => slice.reduce((a,s)=>a+f(s),0);

  const visitorsData = slice.map(s => ({ x: new Date(s.date).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}), y: s.visitors }));
  const issueTimeData = slice.map(s => ({ x: new Date(s.date).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}), y: s.avgIssueTimeSec }));

  const heatmap = useMemo(() => {
    const days = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const hours = Array.from({length:13},(_,i)=>String(9+i));
    const matrix = days.map((_, r) => hours.map((_, c) => {
      const peak = Math.sin((c/12)*Math.PI);
      const weekendDip = (r===5||r===6) ? 0.6 : 1;
      return Math.round((20 + peak*70) * weekendDip * (0.85 + ((r*13+c)%7)/20));
    }));
    return { days, hours, matrix };
  }, [pvz.id]);

  const peakHourIdx = heatmap.matrix.flat().reduce((maxI, v, i, arr) => v > arr[maxI] ? i : maxI, 0);
  const peakHour = heatmap.hours[peakHourIdx % heatmap.hours.length];

  const forecastLoad = Math.round(avg(s=>s.visitors) * 1.1);
  const forecastProfit = Math.round(sum(s=>s.profit) / Math.max(1,slice.length) * 30);

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5 flex items-center justify-between flex-wrap gap-2">
        <p className="text-lg font-black" style={{ color: C.t1 }}>Аналитика</p>
        <Segmented value={period} onChange={setPeriod} options={[{key:'7d',label:'7д'},{key:'30d',label:'30д'},{key:'90d',label:'90д'}]}/>
      </div>

      <div className="px-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
        <KpiTile label="Посетители" value={String(Math.round(sum(s=>s.visitors)))} icon={Eye} color="#8b5cf6"/>
        <KpiTile label="Заказов выдано" value={String(Math.round(sum(s=>s.ordersIssued)))} icon={Package} color={C.acc}/>
        <KpiTile label="Среднее обслуживание" value={`${Math.round(avg(s=>s.avgIssueTimeSec))}с`} icon={Timer} color={C.green}/>
        <KpiTile label="Среднее ожидание" value={`${Math.round(avg(s=>s.avgWaitTimeSec))}с`} icon={Hourglass} color={C.amber}/>
        <KpiTile label="Процент возвратов" value={`${avg(s=>s.returnRate).toFixed(1)}%`} icon={PackageX} color={C.red}/>
        <KpiTile label="Процент отмен" value={`${avg(s=>s.cancelRate).toFixed(1)}%`} icon={Ban} color={C.red}/>
        <KpiTile label="Прогноз нагрузки" value={String(forecastLoad)} icon={TrendingUp} color={C.acc} sub="посетителей/день"/>
        <KpiTile label="Прогноз прибыли" value={fmt(forecastProfit)} icon={TrendingUp} color={C.green} sub="на 30 дней"/>
      </div>

      <div className="px-5 mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <GlassCard className="p-4">
          <p className="text-xs font-bold mb-3" style={{ color: C.t1 }}>Посещаемость</p>
          <InteractiveLineChart data={visitorsData} label="Посетители" color="#8b5cf6"/>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-xs font-bold mb-3" style={{ color: C.t1 }}>Среднее время обслуживания</p>
          <InteractiveLineChart data={issueTimeData} label="Секунды" color={C.amber} format={v=>`${v}с`}/>
        </GlassCard>
      </div>

      <div className="px-5 mt-3">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold" style={{ color: C.t1 }}>Тепловая карта посещений</p>
            <span className="text-[10px] font-bold" style={{ color: C.acc }}>Пик: {peakHour}:00</span>
          </div>
          <Heatmap matrix={heatmap.matrix} days={heatmap.days} hours={heatmap.hours.map(h=>h)}/>
        </GlassCard>
      </div>

      <div className="px-5 mt-3">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Эффективность сотрудников</p>
        <div className="space-y-2">
          {staff.map(s => (
            <GlassCard key={s.id} className="p-3 flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl text-xs font-bold shrink-0" style={{ background: C.l2, color: C.t1 }}>{s.name[0]}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{s.name}</p>
                <p className="text-[10px]" style={{ color: C.t3 }}>{s.servedCount} клиентов · {s.avgIssueTimeSec}с/выдача · {s.errorsCount} ошибок</p>
              </div>
              <p className="flex items-center gap-1 text-xs font-bold shrink-0" style={{ color: C.amber }}><Star size={11} fill="currentColor"/> {s.rating.toFixed(1)}</p>
            </GlassCard>
          ))}
        </div>
      </div>

      <div className="px-5 mt-3 mb-2">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Показатели по курьерам</p>
        <GlassCard className="p-3 flex items-center gap-3">
          <Truck size={16} style={{ color: C.acc }}/>
          <p className="text-xs flex-1" style={{ color: C.t2 }}>Подробная статистика курьеров доступна в разделе «Курьеры» личного кабинета продавца маркетплейса</p>
        </GlassCard>
      </div>
    </div>
  );
};
