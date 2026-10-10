/* ===============================================================
   SKY SKIN MARKET  -  настоящий магазин косметики для питомцев
   (server/skinMarket.mjs) — надеваемые предметы с реальным медиа
   (превью/модель), покупаются за Pet Coins или Sky Money, экипируются
   на конкретного питомца. Раньше здесь была локальная перекраска
   (petSkins.ts, Баллы Прайма) — другая, чисто косметическая система;
   настоящий рынок с ней никак не связан.
=============================================================== */
import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star, Check, ShoppingBag, Lock, Coins } from 'lucide-react';
import {
  apiSkinMarketItems, apiPurchaseSkinItem, apiEquipItem, newIdempotencyKey,
  PET_RARITY_COLOR, PET_RARITY_LABEL,
  type SkinItem, type SkinItemType, type PetRarity,
} from './petsApi';
import { usePetMedia } from './petMedia';

const C = {
  bg:'var(--bg)', l1:'var(--bg-l1)', l2:'var(--bg-l2)',
  border:'var(--border)', t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)', green:'var(--green)', red:'var(--red)', amber:'var(--amber)',
};

const ITEM_TYPE_LABEL: Record<SkinItemType, string> = {
  skin:'Скин', outfit:'Наряд', headwear:'Головной убор', accessory:'Аксессуар', aura:'Аура',
  effect:'Эффект', animation:'Анимация', background:'Фон', trail:'След', emote:'Эмоция',
};

const ItemMedia = ({ item, size }: { item: SkinItem; size: number }) => {
  const url = usePetMedia(item.previewUrl);
  if (!item.previewUrl) return <span style={{ fontSize: size * 0.4 }}>🎁</span>;
  if (!url) return <div className="animate-pulse rounded-xl" style={{ width: size * 0.8, height: size * 0.8, background: 'rgba(255,255,255,0.08)' }} />;
  return <img src={url} alt={item.name} style={{ width: size * 0.9, height: size * 0.9, objectFit: 'cover', borderRadius: 12 }} />;
};

interface PetSkinShopProps {
  /** Питомец, на которого экипируются предметы (equip требует petId). */
  activePetId: string;
  onClose: () => void;
  onEquipped?: () => void;
}

export const PetSkinShop = ({ activePetId, onClose, onEquipped }: PetSkinShopProps) => {
  const [items, setItems] = useState<SkinItem[] | null>(null);
  const [typeFilter, setTypeFilter] = useState<SkinItemType | 'all'>('all');
  const [rarityFilter, setRarityFilter] = useState<PetRarity | 'all'>('all');
  const [preview, setPreview] = useState<SkinItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setErr('');
    const r = await apiSkinMarketItems({
      itemType: typeFilter === 'all' ? undefined : typeFilter,
      rarity: rarityFilter === 'all' ? undefined : rarityFilter,
    });
    if (!r.ok || !r.data) { setErr('Не удалось загрузить магазин'); return; }
    setItems(r.data.items);
  }, [typeFilter, rarityFilter]);
  useEffect(() => { void load(); }, [load]);

  const buy = async (item: SkinItem) => {
    setErr(''); setBusy(true);
    const currency = item.pricePetCoins != null ? 'pet_coins' : 'sky_money';
    const r = await apiPurchaseSkinItem(item.id, { idempotencyKey: newIdempotencyKey(), currency });
    setBusy(false);
    if (!r.ok || !r.data || 'error' in r.data) {
      setErr(r.data && 'error' in r.data && r.data.error === 'insufficient_coins' ? 'Недостаточно Pet Coins'
        : r.data && 'error' in r.data && r.data.error === 'sold_out' ? 'Раскупили — лимитированная серия закончилась'
        : 'Не получилось купить');
      return;
    }
    const instanceNumber = r.data.instanceNumber ?? undefined;
    setToast('✓ Куплено!');
    setTimeout(() => setToast(''), 1500);
    void load();
    setPreview((p) => (p ? { ...p, owned: true, instanceNumber } : p));
  };

  const equip = async (item: SkinItem) => {
    setErr(''); setBusy(true);
    const r = await apiEquipItem(activePetId, item.id);
    setBusy(false);
    if (!r.ok || !r.data || 'error' in r.data) { setErr('Не получилось надеть — проверь, подходит ли предмет этому питомцу'); return; }
    setToast('✓ Надето!');
    setTimeout(() => setToast(''), 1500);
    onEquipped?.();
    setPreview(null);
  };

  const TYPE_FILTERS: (SkinItemType | 'all')[] = ['all', 'skin', 'outfit', 'headwear', 'accessory', 'aura', 'effect', 'background', 'trail', 'emote', 'animation'];
  const RARITY_FILTERS: (PetRarity | 'all')[] = ['all', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'secret'];

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      className="fixed inset-0 z-[310] flex flex-col" style={{ background:'var(--bg)' }}>

      <div className="flex items-center justify-between px-4 py-4 shrink-0" style={{ borderBottom:`1px solid ${C.border}` }}>
        <div className="flex items-center gap-3">
          <ShoppingBag size={18} style={{ color:C.accent }}/>
          <div>
            <p className="text-base font-bold" style={{ color:C.t1 }}>Sky Skin Market</p>
            <p className="text-xs" style={{ color:C.t3 }}>Косметика для питомцев — Pet Coins или Sky Money</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/5">
          <X size={18} style={{ color:C.t2 }}/>
        </button>
      </div>

      <div className="flex gap-2 px-4 py-2.5 shrink-0 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
        {TYPE_FILTERS.map((t) => (
          <button key={t} type="button" onClick={() => setTypeFilter(t)}
            className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: typeFilter===t ? C.accent : C.l2, color: typeFilter===t ? '#fff' : C.t3 }}>
            {t === 'all' ? 'Все' : ITEM_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="flex gap-2 px-4 pb-2.5 shrink-0 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
        {RARITY_FILTERS.map((r) => {
          const color = r === 'all' ? C.accent : PET_RARITY_COLOR[r];
          return (
            <button key={r} type="button" onClick={() => setRarityFilter(r)}
              className="shrink-0 rounded-full px-3 py-1 text-[10px] font-semibold"
              style={{ background: rarityFilter===r ? `${color}20` : 'rgba(255,255,255,0.04)', border:`1px solid ${rarityFilter===r?color+'55':C.border}`, color: rarityFilter===r?color:C.t3 }}>
              {r === 'all' ? 'Все' : PET_RARITY_LABEL[r]}
            </button>
          );
        })}
      </div>

      {err && <p className="px-4 pb-2 text-xs" style={{ color:C.red }}>{err}</p>}

      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth:'none' }}>
        {items === null ? (
          <p className="py-10 text-center text-xs" style={{ color:C.t3 }}>Загрузка…</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-xs" style={{ color:C.t3 }}>Пока ничего не нашлось.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {items.map((item) => {
              const rc = PET_RARITY_COLOR[item.rarity];
              return (
                <motion.div key={item.id} whileTap={{ scale:.97 }}
                  className="relative overflow-hidden rounded-3xl cursor-pointer"
                  style={{ background:`${rc}12`, border:`2px solid ${item.owned?rc:rc+'30'}` }}
                  onClick={() => setPreview(preview?.id === item.id ? null : item)}>

                  {item.owned && (
                    <div className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background:rc, fontSize:9 }}>
                      <Check size={9} className="text-white"/>
                      <span className="text-white font-bold text-[9px]">Куплено</span>
                    </div>
                  )}
                  {item.soldOut && !item.owned && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center" style={{ background:'rgba(0,0,0,0.5)' }}>
                      <Lock size={16} style={{ color:'rgba(255,255,255,0.6)' }}/>
                      <span className="text-[9px] mt-1" style={{ color:C.red }}>Раскуплено</span>
                    </div>
                  )}

                  <div className="flex justify-center pt-4 pb-2">
                    <ItemMedia item={item} size={80}/>
                  </div>

                  <div className="px-3 pb-3">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:`${rc}20`, color:rc }}>
                        {PET_RARITY_LABEL[item.rarity]}
                      </span>
                      <span className="text-[9px]" style={{ color:C.t3 }}>{ITEM_TYPE_LABEL[item.itemType]}</span>
                    </div>
                    <p className="text-sm font-bold" style={{ color:C.t1 }}>{item.name}</p>
                    <p className="text-[10px] mt-0.5 leading-snug line-clamp-2" style={{ color:C.t3 }}>{item.description}</p>
                    {!item.owned && (
                      <p className="text-[11px] font-bold mt-1 flex items-center gap-1" style={{ color:C.amber }}>
                        {item.pricePetCoins != null
                          ? <><Coins size={10}/> {item.pricePetCoins.toLocaleString('ru')}</>
                          : item.priceSkyMoneyKopecks != null ? `${(item.priceSkyMoneyKopecks/100).toLocaleString('ru')} ₽` : ''}
                      </p>
                    )}
                    {item.supply != null && (
                      <p className="text-[9px] mt-0.5" style={{ color:C.t3 }}>Осталось: {item.remaining ?? 0} из {item.supply}</p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-bold"
            style={{ background:'rgba(34,197,94,0.15)', border:'1px solid rgba(34,197,94,0.3)', color:C.green }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {preview && (
          <motion.div initial={{ y:80, opacity:0 }} animate={{ y:0, opacity:1 }} exit={{ y:80, opacity:0 }}
            className="shrink-0 px-4 pb-6 pt-4 space-y-3" style={{ borderTop:`1px solid ${C.border}`, background:'var(--bg-l1)' }}>
            <div className="flex items-center gap-3">
              <div className="shrink-0"><ItemMedia item={preview} size={56}/></div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color:C.t1 }}>{preview.name}</p>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:`${PET_RARITY_COLOR[preview.rarity]}20`, color:PET_RARITY_COLOR[preview.rarity] }}>
                  {PET_RARITY_LABEL[preview.rarity]}
                </span>
              </div>
              <button type="button" onClick={() => setPreview(null)} className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/5">
                <X size={14} style={{ color:C.t2 }}/>
              </button>
            </div>

            {preview.owned ? (
              <motion.button whileTap={{ scale:.97 }} type="button" disabled={busy} onClick={() => void equip(preview)}
                className="w-full rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-50"
                style={{ background:`linear-gradient(135deg,${PET_RARITY_COLOR[preview.rarity]},${PET_RARITY_COLOR[preview.rarity]}aa)` }}>
                ✓ Надеть на питомца
              </motion.button>
            ) : (
              <motion.button whileTap={{ scale:.97 }} type="button" disabled={busy || preview.soldOut} onClick={() => void buy(preview)}
                className="w-full rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-40"
                style={{ background:'linear-gradient(135deg,#d97706,#f59e0b)', boxShadow:'0 8px 28px rgba(245,158,11,0.35)' }}>
                <span className="flex items-center justify-center gap-2">
                  <Star size={15}/> {busy ? 'Покупаем…' : preview.soldOut ? 'Раскуплено' : 'Купить'}
                </span>
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
