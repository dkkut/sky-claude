/* ======================================================================
   SKY ПВЗ  —  История событий (аудит)
====================================================================== */
import { useState, useMemo } from 'react';
import { Search, History as HistoryIcon, User, Monitor, Globe } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { usePVZStore } from './store';
import { GlassCard, EmptyState } from './shared';
import type { PVZ } from './types';

export const HistoryScreen = ({ pvz }: { pvz: PVZ | null }) => {
  const { historyFor } = usePVZStore();
  const [query, setQuery] = useState('');
  const entries = historyFor(pvz?.id ?? null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e => e.description.toLowerCase().includes(q) || e.action.toLowerCase().includes(q) || e.userName.toLowerCase().includes(q));
  }, [entries, query]);

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5"><p className="text-lg font-black" style={{ color: C.t1 }}>История событий</p></div>
      <div className="px-5 mt-3">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: C.l2 }}>
          <Search size={14} style={{ color: C.t3 }}/>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по действию, описанию или пользователю..."
            className="flex-1 bg-transparent text-xs outline-none" style={{ color: C.t1 }}/>
        </div>
      </div>
      <div className="px-5 mt-3 mb-6 space-y-2">
        {filtered.length === 0 ? <EmptyState icon={HistoryIcon} title="Событий не найдено"/> : filtered.map(e => (
          <GlassCard key={e.id} className="p-3">
            <p className="text-xs font-semibold" style={{ color: C.t1 }}>{e.description}</p>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="flex items-center gap-1 text-[10px]" style={{ color: C.t3 }}><User size={10}/> {e.userName}</span>
              <span className="flex items-center gap-1 text-[10px]" style={{ color: C.t3 }}><Globe size={10}/> {e.ip}</span>
              <span className="flex items-center gap-1 text-[10px]" style={{ color: C.t3 }}><Monitor size={10}/> {e.device}</span>
              <span className="text-[10px]" style={{ color: C.t3 }}>{new Date(e.createdAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
};
