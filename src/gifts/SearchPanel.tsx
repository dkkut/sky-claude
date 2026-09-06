/* ======================================================================
   SKY GIFTS NFT  —  Глобальный поиск
====================================================================== */
import { useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { useNftGiftsStore } from './nftStore';
import { GiftSlide, EmptyState } from './shared';
import { GiftCard } from './GiftCard';

export const SearchPanel = ({ open, onClose, onOpenGift }: { open: boolean; onClose: () => void; onOpenGift: (id:string) => void }) => {
  const { search } = useNftGiftsStore();
  const [q, setQ] = useState('');
  const results = search(q);

  return (
    <GiftSlide open={open} onClose={onClose} title="Поиск">
      <div className="px-5 pt-3">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: C.l2 }}>
          <SearchIcon size={15} style={{ color: C.t3 }}/>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Название, коллекция, владелец, автор, номер, редкость, цена, теги..."
            className="flex-1 bg-transparent text-sm outline-none" style={{ color: C.t1 }}/>
        </div>
      </div>
      <div className="px-5 pt-4 pb-10">
        {!q.trim() ? <EmptyState icon={SearchIcon} title="Начните вводить запрос" sub="Поиск работает по названию, коллекции, владельцу, автору, номеру, редкости, цене и тегам"/> :
          results.length === 0 ? <EmptyState icon={SearchIcon} title="Ничего не найдено"/> : (
          <div className="grid gap-3" style={{ gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {results.map(g => <div key={g.id} className="flex justify-center"><GiftCard gift={g} size="sm" onClick={() => onOpenGift(g.id)}/></div>)}
          </div>
        )}
      </div>
    </GiftSlide>
  );
};
