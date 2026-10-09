/* ======================================================================
   SKY GIFTS NFT  —  Главный экран
====================================================================== */
import { memo, useMemo } from 'react';
import { Bell, ArrowUpRight, Search as SearchIcon, Clock } from 'lucide-react';
import { C, fmt } from '@/marketplace/SkyMarket';
import { useAuthStore } from '@/core/auth/store';
import { useNftGiftsStore } from './nftStore';
import { GlassCard, HRow, Pill } from './shared';
import { GiftBackground } from './backgrounds';
import { GiftCard } from './GiftCard';
import { RARITY_CONFIG, RARITY_ORDER } from './types';
import type { Gift, GiftCollection } from './types';

const CollectionCard = memo(({ col, onOpen }: { col: GiftCollection; onOpen: () => void }) => {
  const giftsInCollection = useNftGiftsStore(s => s.giftsInCollection);
  const listings = useNftGiftsStore(s => s.listings);
  const items = giftsInCollection(col.id);
  const minPrice = items.length ? Math.min(...items.map(g=>g.price)) : 0;
  const owners = new Set(items.map(g=>g.ownerId)).size;
  const volume = listings.filter(l=>l.status==='sold' && items.some(g=>g.id===l.giftId)).reduce((a,l)=>a+(l.soldPrice??0),0);

  return (
    <button type="button" onClick={onOpen} className="relative shrink-0 overflow-hidden rounded-3xl text-left" style={{ width:200, height:140, scrollSnapAlign:'start' }}>
      <GiftBackground theme={col.cover} rarity="epic" animated={false}/>
      <div className="absolute inset-0" style={{ background:'linear-gradient(180deg, transparent 30%, rgba(5,5,10,0.9))' }}/>
      <div className="absolute bottom-2.5 left-3 right-3">
        <p className="text-xs font-bold truncate" style={{ color:'#fff' }}>{col.name}</p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px]" style={{ color:'rgba(255,255,255,0.7)' }}>{items.length} предметов · {owners} владельцев</span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[10px] font-bold" style={{ color:'#fff' }}>от {fmt(minPrice)}</span>
          {volume>0 && <span className="text-[9px]" style={{ color: C.green }}>{fmt(volume)} объём</span>}
        </div>
      </div>
    </button>
  );
});
CollectionCard.displayName = 'CollectionCard';

export const GiftsHome = memo(({ onOpenGift, onOpenCollection, onOpenSearch, onOpenNotifications, onOpenProfile }: {
  onOpenGift: (id: string) => void; onOpenCollection: (id: string) => void;
  onOpenSearch: () => void; onOpenNotifications: () => void; onOpenProfile: () => void;
}) => {
  const account = useAuthStore(s => s.accounts.find(a => a.id === s.currentUserId));
  const { gifts, collections, myGifts, activeListings, notificationsFor, listings, isArchived } = useNftGiftsStore();
  const uid = account?.id ?? '';

  const owned = myGifts().filter(g => !isArchived(g.id));
  const collectionValue = owned.reduce((a,g)=>a+g.price,0);
  const uniqueCollections = new Set(owned.map(g=>g.collectionId)).size;
  const rarestOwned = owned.reduce<Gift|null>((best,g) => !best || RARITY_ORDER.indexOf(g.rarity) > RARITY_ORDER.indexOf(best.rarity) ? g : best, null);
  const unread = notificationsFor(uid).filter(n=>!n.read).length;

  const recentSales = useMemo(() => listings.filter(l=>l.status==='sold').sort((a,b)=>new Date(b.soldAt!).getTime()-new Date(a.soldAt!).getTime()).slice(0,3), [listings]);

  const popularCollections = useMemo(() => [...collections].sort((a,b) => {
    const va = gifts.filter(g=>g.collectionId===a.id).reduce((s,g)=>s+g.views,0);
    const vb = gifts.filter(g=>g.collectionId===b.id).reduce((s,g)=>s+g.views,0);
    return vb-va;
  }).slice(0,8), [collections, gifts]);
  const newCollections = useMemo(() => [...collections].sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()).slice(0,8), [collections]);
  const limitedCollections = useMemo(() => collections.filter(c=>['limited','exclusive','anniversary'].includes(c.kind)), [collections]);
  const mostExpensive = useMemo(() => [...gifts].sort((a,b)=>b.price-a.price).slice(0,10), [gifts]);
  const rarest = useMemo(() => [...gifts].sort((a,b)=>RARITY_ORDER.indexOf(b.rarity)-RARITY_ORDER.indexOf(a.rarity)).slice(0,10), [gifts]);
  const trends = useMemo(() => [...gifts].sort((a,b) => {
    const ca = a.priceHistory.length>1 ? a.price-a.priceHistory[a.priceHistory.length-2].price : 0;
    const cb = b.priceHistory.length>1 ? b.price-b.priceHistory[b.priceHistory.length-2].price : 0;
    return cb-ca;
  }).slice(0,10), [gifts]);
  const recentlySoldGifts = useMemo(() => recentSales.map(l=>gifts.find(g=>g.id===l.giftId)).filter(Boolean) as Gift[], [recentSales, gifts]);
  const comingSoon = useMemo(() => [...collections].sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()).slice(0,4), [collections]);

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="px-5 pt-5 flex items-center justify-between">
        <div>
          <p className="text-lg font-black" style={{ color: C.t1 }}>Sky Gifts</p>
          <p className="text-xs mt-0.5" style={{ color: C.t3 }}>Коллекционные NFT-подарки</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onOpenSearch} className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: C.l2, color: C.t3 }}><SearchIcon size={15}/></button>
          <button type="button" onClick={onOpenNotifications} className="relative grid h-9 w-9 place-items-center rounded-xl" style={{ background: C.l2, color: C.t3 }}>
            <Bell size={15}/>
            {unread>0 && <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-[16px] place-items-center rounded-full text-[8px] font-black text-white px-1" style={{ background: C.red }}>{unread}</span>}
          </button>
        </div>
      </div>

      <button type="button" onClick={onOpenProfile} className="block w-full px-5 mt-4">
        <GlassCard className="p-4" glow="rgba(79,110,247,0.18)">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><p className="text-[10px]" style={{ color: C.t3 }}>Стоимость коллекции</p><p className="text-base font-black mt-0.5" style={{ color: C.t1 }}>{fmt(collectionValue)}</p></div>
            <div><p className="text-[10px]" style={{ color: C.t3 }}>Подарков</p><p className="text-base font-black mt-0.5" style={{ color: C.t1 }}>{owned.length}</p></div>
            <div><p className="text-[10px]" style={{ color: C.t3 }}>Коллекций</p><p className="text-base font-black mt-0.5" style={{ color: C.t1 }}>{uniqueCollections}</p></div>
            <div><p className="text-[10px]" style={{ color: C.t3 }}>Редчайший</p><p className="text-xs font-bold mt-0.5 truncate" style={{ color: rarestOwned?RARITY_CONFIG[rarestOwned.rarity].color:C.t3 }}>{rarestOwned?RARITY_CONFIG[rarestOwned.rarity].label:'—'}</p></div>
          </div>
        </GlassCard>
      </button>

      {recentSales.length > 0 && (
        <div className="px-5 mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {recentSales.map(l => {
            const g = gifts.find(x=>x.id===l.giftId); if (!g) return null;
            return (
              <GlassCard key={l.id} className="p-2.5 flex items-center gap-2">
                <ArrowUpRight size={13} style={{ color: C.green }}/>
                <p className="text-[11px] truncate flex-1" style={{ color: C.t2 }}>{g.name} · {fmt(l.soldPrice ?? 0)}</p>
              </GlassCard>
            );
          })}
        </div>
      )}

      <HRow title="Популярные коллекции" action="Все">{popularCollections.map(c => <CollectionCard key={c.id} col={c} onOpen={() => onOpenCollection(c.id)}/>)}</HRow>
      <HRow title="Новые коллекции">{newCollections.map(c => <CollectionCard key={c.id} col={c} onOpen={() => onOpenCollection(c.id)}/>)}</HRow>
      {limitedCollections.length > 0 && <HRow title="Ограниченные серии">{limitedCollections.map(c => <CollectionCard key={c.id} col={c} onOpen={() => onOpenCollection(c.id)}/>)}</HRow>}
      <HRow title="Самые дорогие подарки">{mostExpensive.map(g => <GiftCard key={g.id} gift={g} onClick={() => onOpenGift(g.id)}/>)}</HRow>
      <HRow title="Самые редкие подарки">{rarest.map(g => <GiftCard key={g.id} gift={g} onClick={() => onOpenGift(g.id)}/>)}</HRow>
      <HRow title="Тренды дня">{trends.map(g => <GiftCard key={g.id} gift={g} onClick={() => onOpenGift(g.id)}/>)}</HRow>
      {recentlySoldGifts.length > 0 && <HRow title="Недавно проданные">{recentlySoldGifts.map(g => <GiftCard key={g.id} gift={g} onClick={() => onOpenGift(g.id)}/>)}</HRow>}

      <div className="mt-5">
        <div className="px-5 flex items-center gap-1.5 mb-2.5"><Clock size={13} style={{ color: C.t3 }}/><p className="text-sm font-bold" style={{ color: C.t1 }}>Скоро появятся</p></div>
        <div className="flex gap-3 overflow-x-auto px-5 pb-1" style={{ scrollbarWidth:'none' }}>
          {comingSoon.map(c => (
            <div key={c.id} className="relative shrink-0 overflow-hidden rounded-3xl" style={{ width:160, height:120 }}>
              <GiftBackground theme={c.cover} rarity="legendary" animated={false}/>
              <div className="absolute inset-0 grid place-items-center" style={{ background:'rgba(5,5,10,0.55)', backdropFilter:'blur(2px)' }}>
                <Pill label="Скоро" color={C.amber}/>
              </div>
              <p className="absolute bottom-2 left-2.5 right-2.5 text-[11px] font-bold truncate" style={{ color:'#fff' }}>{c.name}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
GiftsHome.displayName = 'GiftsHome';
