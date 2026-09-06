/* ======================================================================
   SKY ПВЗ  —  Dashboard
====================================================================== */
import { useState, useMemo } from 'react';
import {
  Wallet, TrendingUp, Percent, Clock4, Package, PackageCheck,
  PackageX, AlertTriangle, Boxes, Timer, Hourglass, Star,
  Users, Truck, Eye, BrainCircuit, Banknote,
} from 'lucide-react';
import { C, fmt } from '@/marketplace/SkyMarket';
import { usePVZStore } from './store';
import { GlassCard, KpiTile, Segmented, InteractiveLineChart, InteractiveBarChart, ScoreRing, type ChartPeriod, PERIOD_DAYS } from './shared';
import type { PVZ } from './types';

const aiScore = (overdue: number, cancelRate: number, returnRate: number, issueTime: number) =>
  Math.round(Math.max(0, Math.min(100, 100 - overdue*1.5 - cancelRate*2 - returnRate*1.5 - Math.max(0, issueTime-90)/4)));

export const PVZDashboard = ({ pvz }: { pvz: PVZ }) => {
  const { snapshotsFor, staffFor, parcelsFor, balanceFor, financeFor, recommendationsFor } = usePVZStore();
  const [period, setPeriod] = useState<ChartPeriod>('30d');
  const [compare, setCompare] = useState(false);
  const [metric, setMetric] = useState<'revenue'|'orders'|'visitors'>('revenue');

  const all = snapshotsFor(pvz.id);
  const days = PERIOD_DAYS[period];
  const slice = all.slice(-days);
  const prevSlice = all.slice(-days*2, -days);

  const sum = (arr: typeof all, f: (s: typeof all[0]) => number) => arr.reduce((a,s)=>a+f(s),0);
  const today = all[all.length-1];
  const last7 = all.slice(-7);
  const last30 = all.slice(-30);

  const revenueToday = today?.revenue ?? 0;
  const revenueWeek = sum(last7, s=>s.revenue);
  const revenueMonth = sum(last30, s=>s.revenue);
  const profitMonth = sum(last30, s=>s.profit);
  const commissionMonth = sum(last30, s=>s.commission);
  const balance = balanceFor(pvz.id);
  const upcomingPayout = Math.round(balance * 0.6);

  const staff = staffFor(pvz.id);
  const onlineStaff = staff.filter(s=>s.online).length;
  const parcels = parcelsFor(pvz.id);
  const stored = parcels.filter(p=>p.status==='stored').length;
  const issuedToday = today?.ordersIssued ?? 0;
  const receivedToday = today?.ordersReceived ?? 0;
  const overdue = parcels.filter(p=>p.status==='overdue').length;
  const returns = parcels.filter(p=>p.status==='returned').length;
  const occupancyPct = pvz.capacity > 0 ? Math.round((parcels.filter(p=>['stored','overdue'].includes(p.status)).length / pvz.capacity)*100) : 0;
  const avgIssue = today?.avgIssueTimeSec ?? 0;
  const avgWait = today?.avgWaitTimeSec ?? 0;

  const score = aiScore(overdue, today?.cancelRate ?? 0, today?.returnRate ?? 0, avgIssue);
  const recs = recommendationsFor(pvz.id).filter(r=>!r.done);

  const metricKey: Record<typeof metric, (s: typeof all[0]) => number> = {
    revenue: s=>s.revenue, orders: s=>s.ordersIssued, visitors: s=>s.visitors,
  };
  const chartData = slice.map(s => ({ x: new Date(s.date).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}), y: metricKey[metric](s) }));
  const compareData = compare ? prevSlice.map(s => ({ x: new Date(s.date).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}), y: metricKey[metric](s) })) : undefined;

  const hourlyLoad = useMemo(() => Array.from({ length: 13 }, (_, i) => {
    const hour = 9 + i;
    const v = Math.round(20 + Math.sin((hour-9)/12*Math.PI)*60 + (hour===13||hour===18 ? 25 : 0));
    return { x: `${hour}`, y: Math.max(5, v) };
  }), [pvz.id]);

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-black" style={{ color: C.t1 }}>{pvz.name}</p>
            <p className="text-xs mt-0.5" style={{ color: C.t3 }}>{pvz.city}, {pvz.address}</p>
          </div>
          <GlassCard className="px-3 py-2 flex items-center gap-2">
            <BrainCircuit size={16} style={{ color: C.acc }}/>
            <div>
              <p className="text-[9px]" style={{ color: C.t3 }}>AI-оценка ПВЗ</p>
              <p className="text-sm font-black" style={{ color: score>=85?C.green:score>=60?C.amber:C.red }}>{score}/100</p>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Финансовые KPI */}
      <div className="px-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
        <KpiTile label="Доход сегодня" value={fmt(revenueToday)} icon={Wallet} color={C.acc} trend={5}/>
        <KpiTile label="Доход за неделю" value={fmt(revenueWeek)} icon={TrendingUp} color={C.green} trend={8}/>
        <KpiTile label="Доход за месяц" value={fmt(revenueMonth)} icon={Banknote} color="#8b5cf6" trend={12}/>
        <KpiTile label="Прибыль (30д)" value={fmt(profitMonth)} icon={TrendingUp} color={C.green}/>
        <KpiTile label="Комиссии (30д)" value={fmt(commissionMonth)} icon={Percent} color={C.amber}/>
        <KpiTile label="Баланс" value={fmt(balance)} icon={Wallet} color={C.t1}/>
        <KpiTile label="Выплата (план)" value={fmt(upcomingPayout)} icon={Clock4} color={C.acc}/>
        <KpiTile label="Заказов (30д)" value={String(sum(last30,s=>s.ordersIssued))} icon={Package} color={C.t1}/>
      </div>

      {/* Операционные KPI */}
      <div className="px-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-2.5">
        <KpiTile label="Получено сегодня" value={String(receivedToday)} icon={Package} color={C.acc}/>
        <KpiTile label="Выдано сегодня" value={String(issuedToday)} icon={PackageCheck} color={C.green}/>
        <KpiTile label="Возвраты" value={String(returns)} icon={PackageX} color={C.red}/>
        <KpiTile label="Просрочки" value={String(overdue)} icon={AlertTriangle} color={overdue>0?C.amber:C.t3}/>
        <KpiTile label="Загрузка склада" value={`${occupancyPct}%`} icon={Boxes} color={occupancyPct>80?C.red:occupancyPct>60?C.amber:C.green} sub={`${stored} из ${pvz.capacity} ячеек`}/>
        <KpiTile label="Среднее время выдачи" value={`${avgIssue}с`} icon={Timer} color={C.acc}/>
        <KpiTile label="Ожидание клиента" value={`${avgWait}с`} icon={Hourglass} color={avgWait>150?C.amber:C.green}/>
        <KpiTile label="Рейтинг ПВЗ" value={pvz.rating.toFixed(1)} icon={Star} color={C.amber}/>
      </div>

      {/* Люди */}
      <div className="px-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-2.5">
        <KpiTile label="Сотрудники онлайн" value={`${onlineStaff}/${staff.length}`} icon={Users} color={onlineStaff>0?C.green:C.t3}/>
        <KpiTile label="Курьеров в пути" value={String(Math.round(3 + (receivedToday%4)))} icon={Truck} color={C.acc}/>
        <KpiTile label="Посетители сегодня" value={String(today?.visitors ?? 0)} icon={Eye} color="#8b5cf6"/>
        <KpiTile label="Активных рекомендаций" value={String(recs.length)} icon={BrainCircuit} color={recs.length>0?C.amber:C.green}/>
      </div>

      {/* График */}
      <div className="px-5 mt-4">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              {(['revenue','orders','visitors'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMetric(m)}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
                  style={{ background: metric===m ? C.accBg : C.l2, color: metric===m ? C.acc : C.t3 }}>
                  {m==='revenue'?'Доход':m==='orders'?'Заказы':'Посетители'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setCompare(c=>!c)}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold" style={{ background: compare ? C.accBg : C.l2, color: compare ? C.acc : C.t3 }}>
                Сравнить с прошлым периодом
              </button>
              <Segmented value={period} onChange={setPeriod} options={[{key:'7d',label:'7д'},{key:'30d',label:'30д'},{key:'90d',label:'90д'}]}/>
            </div>
          </div>
          <InteractiveLineChart data={chartData} compareData={compareData} label="Текущий период" compareLabel="Прошлый период"
            format={metric==='revenue' ? (v)=>fmt(v) : undefined}/>
        </GlassCard>
      </div>

      {/* Загрузка по часам */}
      <div className="px-5 mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <GlassCard className="p-4">
          <p className="text-xs font-bold mb-3" style={{ color: C.t1 }}>Загруженность по часам</p>
          <InteractiveBarChart data={hourlyLoad} color={C.acc} format={v=>`${v} посетителей`}/>
        </GlassCard>
        <GlassCard className="p-4 flex items-center gap-4">
          <ScoreRing score={score} size={88}/>
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: C.t1 }}>AI-оценка работы ПВЗ</p>
            <p className="text-xs mt-1" style={{ color: C.t3 }}>
              {score>=85 ? 'Превосходные показатели по всем направлениям.' : score>=60 ? 'Хорошие показатели, есть точки роста — см. ИИ-центр.' : 'Обнаружены проблемы, требуется внимание — см. рекомендации в ИИ-центре.'}
            </p>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
