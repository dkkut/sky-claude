/* ======================================================================
   SKY ПВЗ  —  ИИ-центр управления
====================================================================== */
import { useState } from 'react';
import { BrainCircuit, Sparkles, Check, Users, Boxes, Timer, Gauge, Wallet, FileBarChart } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { usePVZStore } from './store';
import { GlassCard, EmptyState, Pill, ScoreRing, Segmented } from './shared';
import type { PVZ, AIReportPeriod, AIRecommendation } from './types';

const CATEGORY_ICON: Record<AIRecommendation['category'], any> = { staffing:Users, warehouse:Boxes, service_speed:Timer, quality:Gauge, finance:Wallet };
const PRIORITY_COLOR: Record<AIRecommendation['priority'], string> = { high:C.red, medium:C.amber, low:C.t3 };

export const AICenterScreen = ({ pvz }: { pvz: PVZ }) => {
  const { recommendationsFor, generateRecommendations, toggleRecommendationDone, reportsFor, generateReport } = usePVZStore();
  const recs = recommendationsFor(pvz.id);
  const reports = reportsFor(pvz.id);
  const [period, setPeriod] = useState<AIReportPeriod>('daily');
  const active = recs.filter(r=>!r.done);
  const done = recs.filter(r=>r.done);

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5 flex items-center justify-between">
        <p className="text-lg font-black" style={{ color: C.t1 }}>ИИ-центр управления</p>
        <button type="button" onClick={() => generateRecommendations(pvz.id)} className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white" style={{ background: C.acc }}>
          <Sparkles size={13}/> Обновить анализ
        </button>
      </div>

      <div className="px-5 mt-4">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Активные рекомендации ({active.length})</p>
        <div className="space-y-2">
          {active.length === 0 ? <EmptyState icon={BrainCircuit} title="Нет активных рекомендаций" sub="Нажмите «Обновить анализ», чтобы ИИ оценил текущую работу ПВЗ"/> : active.map(r => {
            const Icon = CATEGORY_ICON[r.category];
            return (
              <GlassCard key={r.id} className="p-3 flex items-start gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl mt-0.5" style={{ background: `${PRIORITY_COLOR[r.priority]}18` }}><Icon size={14} style={{ color: PRIORITY_COLOR[r.priority] }}/></div>
                <div className="flex-1">
                  <p className="text-xs" style={{ color: C.t1 }}>{r.text}</p>
                  <Pill label={r.priority==='high'?'Высокий приоритет':r.priority==='medium'?'Средний приоритет':'Низкий приоритет'} color={PRIORITY_COLOR[r.priority]}/>
                </div>
                <button type="button" onClick={() => toggleRecommendationDone(r.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: C.l2 }}>
                  <Check size={13} style={{ color: C.green }}/>
                </button>
              </GlassCard>
            );
          })}
        </div>
      </div>

      {done.length > 0 && (
        <div className="px-5 mt-4">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Выполнено ({done.length})</p>
          <div className="space-y-1.5">
            {done.map(r => <p key={r.id} className="text-[11px] line-through px-1" style={{ color: C.t3 }}>{r.text}</p>)}
          </div>
        </div>
      )}

      <div className="px-5 mt-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.t3 }}>Отчёты ИИ</p>
          <Segmented value={period} onChange={setPeriod} options={[{key:'daily',label:'День'},{key:'weekly',label:'Неделя'},{key:'monthly',label:'Месяц'}]}/>
        </div>
        <button type="button" onClick={() => generateReport(pvz.id, period)} className="w-full flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold mb-3" style={{ background: C.l2, color: C.acc }}>
          <FileBarChart size={13}/> Сформировать отчёт за {period==='daily'?'день':period==='weekly'?'неделю':'месяц'}
        </button>
        <div className="space-y-2 mb-6">
          {reports.filter(r=>r.period===period).length === 0 ? <EmptyState icon={FileBarChart} title="Отчётов пока нет"/> : reports.filter(r=>r.period===period).map(r => (
            <GlassCard key={r.id} className="p-4 flex items-center gap-4">
              <ScoreRing score={r.scoreOverall} size={64}/>
              <div className="flex-1">
                <p className="text-xs font-bold" style={{ color: C.t1 }}>{r.summary}</p>
                <div className="mt-1.5 space-y-0.5">
                  {r.highlights.map((h,i) => <p key={i} className="text-[10px]" style={{ color: C.t3 }}>• {h}</p>)}
                </div>
                <p className="text-[9px] mt-1.5" style={{ color: C.t3 }}>{new Date(r.createdAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</p>
              </div>
            </GlassCard>
          ))}
        </div>
      </div>
    </div>
  );
};
