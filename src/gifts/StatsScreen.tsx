/* ======================================================================
   SKY GIFTS NFT  —  Статистика
====================================================================== */
import { useMemo } from 'react';
import { Wallet, TrendingUp, TrendingDown, BarChart3, Activity, Percent } from 'lucide-react';
import { C, fmt } from '@/marketplace/SkyMarket';
import { useAuthStore } from '@/core/auth/store';
import { useNftGiftsStore } from './nftStore';
import { GiftSlide, KpiTile, GlassCard, InteractiveLineChart } from './shared';

export const StatsScreen = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const account = useAuthStore(s => s.accounts.find(a => a.id === s.currentUserId));
  const { statsFor, myGifts, transactions } = useNftGiftsStore();
  const uid = account?.id ?? '';
  const stats = statsFor(uid);
  const owned = myGifts();

  const valueOverTime = useMemo(() => {
    const tx = transactions.filter(t=>t.userId===uid).sort((a,b)=>new Date(a.at).getTime()-new Date(b.at).getTime());
    let running = 0;
    const points = tx.map(t => {
      running += t.type==='buy' ? t.amount : t.type==='sell' ? -t.amount : 0;
      return { x: new Date(t.at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}), y: Math.max(0, running) };
    });
    return points.length ? points : [{ x:'сейчас', y: stats.collectionValue }];
  }, [transactions, uid, stats.collectionValue]);

  return (
    <GiftSlide open={open} onClose={onClose} title="Статистика">
      <div className="px-5 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <KpiTile label="Стоимость коллекции" value={fmt(stats.collectionValue)} icon={Wallet} color={C.acc}/>
        <KpiTile label="Доход" value={fmt(stats.income)} icon={TrendingUp} color={C.green}/>
        <KpiTile label="Расходы" value={fmt(stats.spent)} icon={TrendingDown} color={C.red}/>
        <KpiTile label="Прибыль" value={fmt(stats.profit)} icon={stats.profit>=0?TrendingUp:TrendingDown} color={stats.profit>=0?C.green:C.red}/>
        <KpiTile label="Средняя покупка" value={fmt(Math.round(stats.avgBuy))} icon={Wallet} color={C.t1}/>
        <KpiTile label="Средняя продажа" value={fmt(Math.round(stats.avgSell))} icon={Wallet} color={C.t1}/>
        <KpiTile label="ROI" value={`${stats.roiPct}%`} icon={Percent} color={stats.roiPct>=0?C.green:C.red}/>
        <KpiTile label="Объём торгов" value={fmt(stats.volume)} icon={BarChart3} color="#8b5cf6"/>
      </div>

      <div className="px-5 mt-4">
        <GlassCard className="p-4">
          <p className="text-xs font-bold mb-3 flex items-center gap-1.5" style={{ color: C.t1 }}><Activity size={13}/> Динамика стоимости коллекции</p>
          <InteractiveLineChart data={valueOverTime} label="Стоимость" format={v=>fmt(v)} color={C.acc}/>
        </GlassCard>
      </div>

      <div className="px-5 mt-4 mb-8">
        <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Изменение стоимости по подаркам</p>
        <div className="space-y-2">
          {owned.slice(0,12).map(g => {
            const change = g.priceHistory.length>1 ? Math.round(((g.price-g.priceHistory[0].price)/Math.max(1,g.priceHistory[0].price))*100) : 0;
            return (
              <GlassCard key={g.id} className="p-2.5 flex items-center justify-between">
                <p className="text-xs truncate flex-1" style={{ color: C.t2 }}>{g.name}</p>
                <p className="text-xs font-bold" style={{ color: change>=0?C.green:C.red }}>{change>=0?'+':''}{change}%</p>
              </GlassCard>
            );
          })}
        </div>
      </div>
    </GiftSlide>
  );
};
