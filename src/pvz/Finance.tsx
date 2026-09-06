/* ======================================================================
   SKY ПВЗ  —  Финансы
====================================================================== */
import { useState } from 'react';
import {
  Wallet, TrendingUp, Percent, Banknote, AlertTriangle, Gift,
  Download, FileSpreadsheet, ArrowUpRight, ArrowDownRight, Send,
} from 'lucide-react';
import { C, fmt } from '@/marketplace/SkyMarket';
import { usePVZStore } from './store';
import { GlassCard, KpiTile, EmptyState, InteractiveLineChart, PVZConfirm } from './shared';
import type { PVZ, FinanceOpType } from './types';

const OP_CFG: Record<FinanceOpType, { label: string; color: string; sign: 1|-1 }> = {
  income:     { label:'Поступление', color: C.green, sign: 1 },
  bonus:      { label:'Бонус',       color: C.acc,   sign: 1 },
  commission: { label:'Комиссия',    color: C.amber, sign:-1 },
  payout:     { label:'Выплата',     color: C.t1,    sign:-1 },
  fine:       { label:'Штраф',       color: C.red,   sign:-1 },
};

export const FinanceScreen = ({ pvz }: { pvz: PVZ }) => {
  const { financeFor, balanceFor, snapshotsFor, addFinanceOp } = usePVZStore();
  const ops = financeFor(pvz.id);
  const balance = balanceFor(pvz.id);
  const snaps = snapshotsFor(pvz.id).slice(-30);
  const profit30 = snaps.reduce((a,s)=>a+s.profit,0);
  const commission30 = snaps.reduce((a,s)=>a+s.commission,0);
  const fines = ops.filter(o=>o.type==='fine').reduce((a,o)=>a+o.amount,0);
  const bonuses = ops.filter(o=>o.type==='bonus').reduce((a,o)=>a+o.amount,0);
  const payouts = ops.filter(o=>o.type==='payout').reduce((a,o)=>a+o.amount,0);
  const forecast = Math.round((snaps.slice(-7).reduce((a,s)=>a+s.revenue,0)/7) * 30 * 1.08);
  const taxRate = 0.06;
  const taxEstimate = Math.round(snaps.reduce((a,s)=>a+s.revenue,0) * taxRate);

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState('');

  const chartData = snaps.map(s => ({ x: new Date(s.date).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}), y: s.revenue }));

  const exportReport = (type: 'pdf'|'excel') => {
    const rows = ops.map(o => `${new Date(o.createdAt).toLocaleDateString('ru-RU')},${OP_CFG[o.type].label},${o.amount},${o.comment}`).join('\n');
    const blob = new Blob([`Дата,Тип,Сумма,Комментарий\n${rows}`], { type: type==='excel' ? 'text/csv' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `finance_${pvz.id}.${type==='excel'?'csv':'txt'}`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5"><p className="text-lg font-black" style={{ color: C.t1 }}>Финансы</p></div>

      <div className="px-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
        <KpiTile label="Баланс" value={fmt(balance)} icon={Wallet} color={C.t1}/>
        <KpiTile label="Прибыль (30д)" value={fmt(profit30)} icon={TrendingUp} color={C.green}/>
        <KpiTile label="Комиссии (30д)" value={fmt(commission30)} icon={Percent} color={C.amber}/>
        <KpiTile label="Выплачено всего" value={fmt(payouts)} icon={Banknote} color={C.t1}/>
        <KpiTile label="Штрафы" value={fmt(fines)} icon={AlertTriangle} color={fines>0?C.red:C.t3}/>
        <KpiTile label="Бонусы" value={fmt(bonuses)} icon={Gift} color={C.acc}/>
        <KpiTile label="Прогноз дохода (30д)" value={fmt(forecast)} icon={TrendingUp} color="#8b5cf6"/>
        <KpiTile label="Налоговая оценка" value={fmt(taxEstimate)} icon={Percent} color={C.t3} sub={`${(taxRate*100).toFixed(0)}% от оборота`}/>
      </div>

      <div className="px-5 mt-4">
        <GlassCard className="p-4">
          <p className="text-xs font-bold mb-3" style={{ color: C.t1 }}>Динамика выручки</p>
          <InteractiveLineChart data={chartData} label="Выручка" format={v=>fmt(v)} color={C.green}/>
        </GlassCard>
      </div>

      <div className="px-5 mt-4 flex gap-2">
        <button type="button" onClick={() => setWithdrawOpen(true)} className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold text-white" style={{ background: C.acc }}>
          <Send size={13}/> Запросить выплату
        </button>
        <button type="button" onClick={() => exportReport('pdf')} className="rounded-xl px-3.5 py-2.5 text-xs font-bold flex items-center gap-1.5" style={{ background: C.l2, color: C.t2 }}><Download size={13}/> PDF</button>
        <button type="button" onClick={() => exportReport('excel')} className="rounded-xl px-3.5 py-2.5 text-xs font-bold flex items-center gap-1.5" style={{ background: C.l2, color: C.t2 }}><FileSpreadsheet size={13}/> Excel</button>
      </div>

      <div className="px-5 mt-4">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>История операций</p>
        <div className="space-y-2">
          {ops.length === 0 ? <EmptyState icon={Wallet} title="Операций пока нет"/> : ops.map(o => {
            const cfg = OP_CFG[o.type];
            return (
              <div key={o.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: C.l1, border:`1px solid ${C.brd}` }}>
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background:`${cfg.color}18` }}>
                  {cfg.sign>0 ? <ArrowUpRight size={14} style={{ color: cfg.color }}/> : <ArrowDownRight size={14} style={{ color: cfg.color }}/>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: C.t1 }}>{cfg.label}</p>
                  <p className="text-[10px] truncate" style={{ color: C.t3 }}>{o.comment || '—'} · {new Date(o.createdAt).toLocaleDateString('ru-RU')}</p>
                </div>
                <p className="text-xs font-bold shrink-0" style={{ color: cfg.color }}>{cfg.sign>0?'+':'−'}{fmt(o.amount)}</p>
              </div>
            );
          })}
        </div>
      </div>

      <PVZConfirm open={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="Запрос на выплату">
        <p className="text-xs mb-2" style={{ color: C.t3 }}>Доступно к выводу: {fmt(balance)}</p>
        <input value={amount} onChange={e => setAmount(e.target.value)} type="number" placeholder="Сумма"
          className="w-full rounded-xl px-3 py-2 text-sm outline-none mb-3" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
        <div className="flex gap-2">
          <button type="button" onClick={() => setWithdrawOpen(false)} className="flex-1 rounded-xl py-2 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>Отмена</button>
          <button type="button" disabled={!amount || Number(amount)<=0 || Number(amount)>balance}
            onClick={() => { addFinanceOp(pvz.id, 'payout', Number(amount), 'Запрос на выплату'); setWithdrawOpen(false); setAmount(''); }}
            className="flex-1 rounded-xl py-2 text-xs font-bold text-white disabled:opacity-40" style={{ background: C.acc }}>Запросить</button>
        </div>
      </PVZConfirm>
    </div>
  );
};
