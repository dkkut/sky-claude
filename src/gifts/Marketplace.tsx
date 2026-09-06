/* ======================================================================
   SKY GIFTS NFT  —  Маркетплейс
====================================================================== */
import { memo, useMemo, useState } from 'react';
import { SlidersHorizontal, Sparkles, Users, X } from 'lucide-react';
import { C, fmt } from '@/marketplace/SkyMarket';
import { useNftGiftsStore } from './nftStore';
import { GiftCard } from './GiftCard';
import { GlassCard, HRow, EmptyState } from './shared';
import { RARITY_CONFIG, RARITY_ORDER, ALL_BACKGROUNDS, BACKGROUND_LABELS } from './types';
import type { Gift, Rarity, BackgroundTheme } from './types';

interface Filters {
  rarities: Rarity[]; backgrounds: BackgroundTheme[]; collectionId: string;
  minPrice: number; maxPrice: number; minEdition: number; maxEdition: number;
  onlyLimited: boolean; onlyNew: boolean; onlyAnimated: boolean; minOwners: number;
}
const DEFAULT_FILTERS: Filters = { rarities:[], backgrounds:[], collectionId:'all', minPrice:0, maxPrice:50000, minEdition:1, maxEdition:1000, onlyLimited:false, onlyNew:false, onlyAnimated:false, minOwners:0 };

const FiltersPanel = ({ filters, onChange, collections }: { filters: Filters; onChange:(f:Filters)=>void; collections:{id:string;name:string}[] }) => (
  <div className="px-5 py-3 space-y-3" style={{ background: C.l1, borderBottom:`1px solid ${C.brd}` }}>
    <div>
      <p className="text-[10px] font-bold mb-1.5" style={{ color: C.t3 }}>РЕДКОСТЬ</p>
      <div className="flex flex-wrap gap-1.5">
        {RARITY_ORDER.map(r => (
          <button key={r} type="button" onClick={() => onChange({ ...filters, rarities: filters.rarities.includes(r) ? filters.rarities.filter(x=>x!==r) : [...filters.rarities, r] })}
            className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: filters.rarities.includes(r) ? `${RARITY_CONFIG[r].color}25` : C.l2, color: filters.rarities.includes(r) ? RARITY_CONFIG[r].color : C.t3 }}>
            {RARITY_CONFIG[r].label}
          </button>
        ))}
      </div>
    </div>
    <div>
      <p className="text-[10px] font-bold mb-1.5" style={{ color: C.t3 }}>КОЛЛЕКЦИЯ</p>
      <select value={filters.collectionId} onChange={e => onChange({ ...filters, collectionId: e.target.value })} className="w-full rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}>
        <option value="all">Все коллекции</option>
        {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
    <div>
      <p className="text-[10px] font-bold mb-1.5" style={{ color: C.t3 }}>ФОН</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth:'none' }}>
        {ALL_BACKGROUNDS.map(b => (
          <button key={b} type="button" onClick={() => onChange({ ...filters, backgrounds: filters.backgrounds.includes(b) ? filters.backgrounds.filter(x=>x!==b) : [...filters.backgrounds, b] })}
            className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: filters.backgrounds.includes(b) ? C.accBg : C.l2, color: filters.backgrounds.includes(b) ? C.acc : C.t3 }}>
            {BACKGROUND_LABELS[b]}
          </button>
        ))}
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="flex items-center justify-between mb-1"><p className="text-[10px] font-bold" style={{ color: C.t3 }}>ЦЕНА ДО</p><p className="text-[10px] font-bold" style={{ color: C.acc }}>{fmt(filters.maxPrice)}</p></div>
        <input type="range" min={100} max={50000} step={100} value={filters.maxPrice} onChange={e => onChange({ ...filters, maxPrice: Number(e.target.value) })} className="w-full" style={{ accentColor: C.acc }}/>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1"><p className="text-[10px] font-bold" style={{ color: C.t3 }}>НОМЕР ДО</p><p className="text-[10px] font-bold" style={{ color: C.acc }}>{filters.maxEdition}</p></div>
        <input type="range" min={1} max={1000} step={10} value={filters.maxEdition} onChange={e => onChange({ ...filters, maxEdition: Number(e.target.value) })} className="w-full" style={{ accentColor: C.acc }}/>
      </div>
    </div>
    <div className="flex flex-wrap gap-1.5">
      {([
        ['onlyLimited','Только лимитированные'], ['onlyNew','Только новые'], ['onlyAnimated','Только с анимацией'],
      ] as const).map(([key,label]) => (
        <button key={key} type="button" onClick={() => onChange({ ...filters, [key]: !filters[key] })}
          className="text-[10px] font-bold px-2.5 py-1.5 rounded-full" style={{ background: filters[key] ? C.accBg : C.l2, color: filters[key] ? C.acc : C.t3 }}>
          {label}
        </button>
      ))}
    </div>
  </div>
);

export const Marketplace = memo(({ onOpenGift }: { onOpenGift: (id:string) => void }) => {
  const { gifts, collections, listings, transactions } = useNftGiftsStore();
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<'discover'|'browse'>('discover');

  const listed = useMemo(() => listings.filter(l => l.status==='active'), [listings]);
  const listedGifts = useMemo(() => listed.map(l => gifts.find(g=>g.id===l.giftId)).filter(Boolean) as Gift[], [listed, gifts]);

  const filtered = useMemo(() => listedGifts.filter(g => {
    if (filters.rarities.length && !filters.rarities.includes(g.rarity)) return false;
    if (filters.backgrounds.length && !filters.backgrounds.includes(g.background)) return false;
    if (filters.collectionId !== 'all' && g.collectionId !== filters.collectionId) return false;
    if (g.price > filters.maxPrice) return false;
    if (g.edition > filters.maxEdition) return false;
    if (filters.onlyLimited && !['limited','founder','one_of_one'].includes(g.rarity)) return false;
    if (filters.onlyAnimated && !g.hasAnimation) return false;
    if (filters.onlyNew) {
      const l = listed.find(x=>x.giftId===g.id);
      if (!l || Date.now()-Date.parse(l.createdAt) > 86400000*2) return false;
    }
    return true;
  }), [listedGifts, filters, listed]);

  const hotDeals = useMemo(() => [...listed].sort((a,b) => (b.watchers) - (a.watchers)).slice(0,10).map(l=>gifts.find(g=>g.id===l.giftId)).filter(Boolean) as Gift[], [listed, gifts]);
  const newLots = useMemo(() => [...listed].sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()).slice(0,10).map(l=>gifts.find(g=>g.id===l.giftId)).filter(Boolean) as Gift[], [listed, gifts]);
  const recentBuys = useMemo(() => transactions.filter(t=>t.type==='buy').slice(-10).reverse().map(t=>gifts.find(g=>g.id===t.giftId)).filter(Boolean) as Gift[], [transactions, gifts]);
  const aiPicks = useMemo(() => [...listedGifts].sort((a,b) => RARITY_ORDER.indexOf(b.rarity)-RARITY_ORDER.indexOf(a.rarity)).slice(0,10), [listedGifts]);

  const topSellers = useMemo(() => {
    const map = new Map<string, { name:string; count:number; volume:number }>();
    listed.forEach(l => { const cur = map.get(l.sellerId) ?? { name:l.sellerName, count:0, volume:0 }; cur.count++; cur.volume += l.price; map.set(l.sellerId, cur); });
    return Array.from(map.entries()).sort((a,b)=>b[1].volume-a[1].volume).slice(0,6);
  }, [listed]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 shrink-0" style={{ background: C.l1, borderBottom:`1px solid ${C.brd}` }}>
        <div className="flex rounded-xl p-1 flex-1" style={{ background: C.l2 }}>
          {(['discover','browse'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)} className="flex-1 rounded-lg py-1.5 text-xs font-semibold" style={{ background: tab===t ? C.l3 : 'transparent', color: tab===t ? C.t1 : C.t3 }}>
              {t==='discover'?'Подборки':'Все лоты'}
            </button>
          ))}
        </div>
        {tab==='browse' && (
          <button type="button" onClick={() => setShowFilters(s=>!s)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: showFilters?C.accBg:C.l2, color: showFilters?C.acc:C.t3 }}><SlidersHorizontal size={15}/></button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth:'none' }}>
        {tab === 'discover' ? (
          <div className="pb-10">
            <HRow title="Горячие предложения">{hotDeals.map(g => <GiftCard key={g.id} gift={g} onClick={() => onOpenGift(g.id)}/>)}</HRow>
            <HRow title="Новые лоты">{newLots.map(g => <GiftCard key={g.id} gift={g} onClick={() => onOpenGift(g.id)}/>)}</HRow>
            {recentBuys.length>0 && <HRow title="Недавно купленные">{recentBuys.map(g => <GiftCard key={g.id} gift={g} onClick={() => onOpenGift(g.id)}/>)}</HRow>}
            <HRow title="Подборки от ИИ">{aiPicks.map(g => <GiftCard key={g.id} gift={g} onClick={() => onOpenGift(g.id)}/>)}</HRow>

            {topSellers.length>0 && (
              <div className="mt-5 px-5">
                <p className="text-sm font-bold mb-2.5 flex items-center gap-1.5" style={{ color: C.t1 }}><Users size={14}/> Популярные продавцы</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {topSellers.map(([id,s]) => (
                    <GlassCard key={id} className="p-3">
                      <p className="text-xs font-semibold truncate" style={{ color: C.t1 }}>{s.name}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: C.t3 }}>{s.count} лотов · {fmt(s.volume)}</p>
                    </GlassCard>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {showFilters && <FiltersPanel filters={filters} onChange={setFilters} collections={collections}/>}
            <div className="px-5 py-3 flex items-center justify-between">
              <p className="text-xs" style={{ color: C.t3 }}>{filtered.length} лотов найдено</p>
              {(filters.rarities.length>0 || filters.backgrounds.length>0 || filters.collectionId!=='all') && (
                <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className="text-[11px] font-bold flex items-center gap-1" style={{ color: C.red }}><X size={11}/> Сбросить</button>
              )}
            </div>
            <div className="px-5 pb-10 grid gap-3" style={{ gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {filtered.length === 0 ? <EmptyState icon={Sparkles} title="Лоты не найдены" sub="Попробуйте изменить фильтры"/> : filtered.map(g => (
                <div key={g.id} className="flex justify-center"><GiftCard gift={g} size="sm" onClick={() => onOpenGift(g.id)}/></div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
Marketplace.displayName = 'Marketplace';
