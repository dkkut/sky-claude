/* ======================================================================
   SKY ПВЗ  —  Управление складом
====================================================================== */
import { useState, useMemo } from 'react';
import { Search, PackageCheck, PackageX, AlertTriangle, Sparkles, Boxes } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { usePVZStore } from './store';
import { GlassCard, EmptyState, KpiTile, Pill } from './shared';
import type { PVZ, Parcel } from './types';

const SIZE_COLOR: Record<Parcel['size'], string> = { S:'#4f6ef7', M:'#8b5cf6', L:'#f59e0b', XL:'#f43f5e' };

export const WarehouseScreen = ({ pvz }: { pvz: PVZ }) => {
  const { cellsFor, parcelsFor, findParcel, issueParcel, returnParcel } = usePVZStore();
  const cells = cellsFor(pvz.id);
  const parcels = parcelsFor(pvz.id);
  const [query, setQuery] = useState('');
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  const occupied = cells.filter(c => c.parcelId).length;
  const free = cells.length - occupied;
  const occPct = cells.length ? Math.round((occupied/cells.length)*100) : 0;
  const overdueCount = parcels.filter(p=>p.status==='overdue').length;

  const results = findParcel(pvz.id, query);
  const cellFor = (cellId: string | null) => cellId ? parcels.find(p => p.cellId === cellId && ['stored','overdue'].includes(p.status)) : undefined;

  const rows = useMemo(() => {
    const map = new Map<number, typeof cells>();
    cells.forEach(c => { if (!map.has(c.row)) map.set(c.row, []); map.get(c.row)!.push(c); });
    return Array.from(map.entries()).sort((a,b)=>a[0]-b[0]).map(([,row]) => row.sort((a,b)=>a.col-b.col));
  }, [cells]);

  const forecastDays = free > 0 ? Math.max(1, Math.round(free / Math.max(1, occupied/30))) : 0;
  const selectedParcel = selectedCell ? cellFor(selectedCell) : null;

  const aiSuggestion = overdueCount > 5
    ? 'Слишком много просроченных посылок — освободите ячейки L/XL в первую очередь и свяжитесь с клиентами.'
    : occPct > 85
    ? 'Склад почти заполнен — временно перенаправьте часть заказов на соседний ПВЗ или ускорьте выдачу.'
    : occPct > 60
    ? 'Заполненность выше среднего — разместите новые крупные посылки (L/XL) в дальних рядах для экономии места у стойки.'
    : 'Загрузка склада в норме — рекомендуется размещать часто запрашиваемые посылки (S/M) ближе к стойке выдачи.';

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5"><p className="text-lg font-black" style={{ color: C.t1 }}>Управление складом</p></div>

      <div className="px-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
        <KpiTile label="Заполненность" value={`${occPct}%`} icon={Boxes} color={occPct>80?C.red:occPct>60?C.amber:C.green}/>
        <KpiTile label="Свободно ячеек" value={String(free)} icon={PackageCheck} color={C.green}/>
        <KpiTile label="Просрочки" value={String(overdueCount)} icon={AlertTriangle} color={overdueCount>0?C.red:C.t3}/>
        <KpiTile label="До переполнения" value={forecastDays>0?`${forecastDays} дн.`:'—'} icon={PackageX} color={C.amber}/>
      </div>

      <div className="px-5 mt-3">
        <GlassCard className="p-3 flex items-start gap-2.5">
          <Sparkles size={15} style={{ color: C.acc }} className="mt-0.5 shrink-0"/>
          <p className="text-xs" style={{ color: C.t2 }}>{aiSuggestion}</p>
        </GlassCard>
      </div>

      <div className="px-5 mt-4">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3" style={{ background: C.l2 }}>
          <Search size={14} style={{ color: C.t3 }}/>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск посылки по коду заказа, имени или телефону..."
            className="flex-1 bg-transparent text-xs outline-none" style={{ color: C.t1 }}/>
        </div>

        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Цифровая карта склада</p>
        <GlassCard className="p-3 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
          <div className="inline-flex flex-col gap-1">
            {rows.map((row, r) => (
              <div key={r} className="flex gap-1">
                {row.map(c => {
                  const parcel = cellFor(c.id);
                  return (
                    <button key={c.id} type="button" onClick={() => setSelectedCell(c.id)}
                      className="h-6 w-6 rounded-[5px]" title={parcel ? `${parcel.orderCode} · ${parcel.clientName}` : `Ячейка ${c.size} свободна`}
                      style={{ background: parcel ? SIZE_COLOR[c.size] : C.l2, opacity: parcel ? (parcel.status==='overdue'?1:0.85) : 0.4,
                        border: parcel?.status==='overdue' ? `1.5px solid ${C.red}` : selectedCell===c.id ? `1.5px solid ${C.t1}` : 'none' }}/>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {(['S','M','L','XL'] as const).map(s => (
              <span key={s} className="flex items-center gap-1.5 text-[10px]" style={{ color: C.t3 }}>
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SIZE_COLOR[s] }}/> {s}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[10px]" style={{ color: C.t3 }}><span className="h-2.5 w-2.5 rounded-sm" style={{ background: C.l2, opacity:0.4 }}/> Свободно</span>
          </div>
        </GlassCard>

        {selectedParcel && (
          <GlassCard className="p-3 mt-3 flex items-center gap-3">
            <Pill label={selectedParcel.status==='overdue'?'Просрочена':'На складе'} color={selectedParcel.status==='overdue'?C.red:C.green}/>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{selectedParcel.orderCode} · {selectedParcel.clientName}</p>
              <p className="text-[10px]" style={{ color: C.t3 }}>{selectedParcel.clientPhone} · до {new Date(selectedParcel.dueAt).toLocaleDateString('ru-RU')}</p>
            </div>
            <button type="button" onClick={() => { issueParcel(selectedParcel.id); setSelectedCell(null); }} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-white" style={{ background: C.green }}>Выдать</button>
            <button type="button" onClick={() => { returnParcel(selectedParcel.id); setSelectedCell(null); }} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.red }}>Возврат</button>
          </GlassCard>
        )}
      </div>

      <div className="px-5 mt-4 mb-6">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Результаты поиска ({results.length})</p>
        <div className="space-y-2">
          {results.length === 0 ? <EmptyState icon={Search} title="Посылки не найдены"/> : results.slice(0,30).map(p => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: C.l1, border:`1px solid ${C.brd}` }}>
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: SIZE_COLOR[p.size] }}/>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{p.orderCode} · {p.clientName}</p>
                <p className="text-[10px]" style={{ color: C.t3 }}>{p.clientPhone}</p>
              </div>
              <Pill label={p.status==='stored'?'На складе':p.status==='overdue'?'Просрочена':p.status==='issued'?'Выдана':p.status==='returned'?'Возврат':'Ожидается'} color={p.status==='overdue'?C.red:p.status==='issued'?C.green:C.t3}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
