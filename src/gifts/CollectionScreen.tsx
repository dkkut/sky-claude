/* ======================================================================
   SKY GIFTS NFT  —  Экран коллекции
====================================================================== */
import { useMemo, useState } from 'react';
import { Users, Layers, TrendingUp, Sparkles } from 'lucide-react';
import { C, fmt } from '@/marketplace/SkyMarket';
import { useNftGiftsStore, MINT_ID } from './nftStore';
import { GiftBackground } from './backgrounds';
import { GiftCard } from './GiftCard';
import { GiftSlide, GlassCard, EmptyState, Segmented, Pill } from './shared';
import { COLLECTION_KIND_LABELS, RARITY_ORDER } from './types';

export const CollectionScreen = ({ collectionId, onClose, onOpenGift }: { collectionId: string; onClose: () => void; onOpenGift: (id:string) => void }) => {
  const { collectionById, giftsInCollection, listings } = useNftGiftsStore();
  const col = collectionById(collectionId);
  const [sort, setSort] = useState<'rarity'|'price'|'edition'>('rarity');

  const items = giftsInCollection(collectionId);
  const owners = new Set(items.filter(g=>g.ownerId!==MINT_ID).map(g=>g.ownerId)).size;   // Sky Mint — платформа, не владелец-человек
  const minPrice = items.length ? Math.min(...items.map(g=>g.price)) : 0;
  const volume = listings.filter(l=>l.status==='sold' && items.some(g=>g.id===l.giftId)).reduce((a,l)=>a+(l.soldPrice??0),0);
  const change = items.length ? Math.round(items.reduce((a,g) => a + (g.priceHistory.length>1 ? (g.price-g.priceHistory[0].price)/Math.max(1,g.priceHistory[0].price) : 0), 0)/items.length*100) : 0;

  const sorted = useMemo(() => [...items].sort((a,b) => {
    if (sort==='rarity') return RARITY_ORDER.indexOf(b.rarity)-RARITY_ORDER.indexOf(a.rarity);
    if (sort==='price') return b.price-a.price;
    return a.edition-b.edition;
  }), [items, sort]);

  // Проверка после всех хуков: иначе их количество меняется между
  // отрисовками и React роняет экран.
  if (!col) return null;

  return (
    <GiftSlide open onClose={onClose} title={col.name}>
      <div className="relative h-44 overflow-hidden">
        <GiftBackground theme={col.cover} rarity="legendary"/>
        <div className="absolute inset-0" style={{ background:'linear-gradient(180deg, transparent, rgba(5,5,10,0.92))' }}/>
        <div className="absolute bottom-3 left-5 right-5">
          <Pill label={COLLECTION_KIND_LABELS[col.kind]} color="#fff"/>
          <p className="text-xl font-black mt-1.5" style={{ color:'#fff' }}>{col.name}</p>
          <p className="text-[11px] mt-0.5" style={{ color:'rgba(255,255,255,0.7)' }}>Автор: {col.authorName}</p>
        </div>
      </div>

      <div className="px-5 pt-4">
        <p className="text-xs" style={{ color: C.t2 }}>{col.description}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
          <GlassCard className="p-3"><p className="text-[10px] flex items-center gap-1" style={{ color: C.t3 }}><Layers size={10}/> Предметов</p><p className="text-sm font-black mt-0.5" style={{ color: C.t1 }}>{items.length} / {col.totalSupply}</p></GlassCard>
          <GlassCard className="p-3"><p className="text-[10px] flex items-center gap-1" style={{ color: C.t3 }}><Users size={10}/> Владельцев</p><p className="text-sm font-black mt-0.5" style={{ color: C.t1 }}>{owners}</p></GlassCard>
          <GlassCard className="p-3"><p className="text-[10px]" style={{ color: C.t3 }}>Мин. цена</p><p className="text-sm font-black mt-0.5" style={{ color: C.t1 }}>{fmt(minPrice)}</p></GlassCard>
          <GlassCard className="p-3"><p className="text-[10px] flex items-center gap-1" style={{ color: C.t3 }}><TrendingUp size={10}/> Изменение</p><p className="text-sm font-black mt-0.5" style={{ color: change>=0?C.green:C.red }}>{change>=0?'+':''}{change}%</p></GlassCard>
        </div>
        {volume>0 && <GlassCard className="p-3 mt-2.5 flex items-center gap-2"><Sparkles size={13} style={{ color: C.acc }}/><p className="text-xs" style={{ color: C.t2 }}>Объём торгов: {fmt(volume)}</p></GlassCard>}

        <div className="mt-4"><Segmented value={sort} onChange={setSort} options={[{key:'rarity',label:'По редкости'},{key:'price',label:'По цене'},{key:'edition',label:'По номеру'}]}/></div>
      </div>

      <div className="px-5 mt-4 pb-10 grid gap-3" style={{ gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {sorted.length === 0 ? <EmptyState icon={Layers} title="В коллекции пока нет предметов"/> : sorted.map(g => (
          <div key={g.id} className="flex justify-center"><GiftCard gift={g} size="sm" onClick={() => onOpenGift(g.id)}/></div>
        ))}
      </div>
    </GiftSlide>
  );
};
