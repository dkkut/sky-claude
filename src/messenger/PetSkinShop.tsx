/* ===============================================================
   PET SKIN SHOP  -  магазин скинов для питомцев
=============================================================== */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Star, Check, ShoppingBag, Lock } from 'lucide-react';
import { PET_SKINS, SKIN_RARITY_COLOR, SKIN_RARITY_GLOW, SKIN_RARITY_LABEL, loadSkinData, saveSkinData, type PetSkin, type SkinRarity } from './petSkins';
import { PetSprite } from './PetSprite';
import { PETS } from './petData';
import { useMoney } from '@/wallet/store';
import { useAuthStore } from '@/core/auth/store';

const C = {
  bg:'var(--bg)', l1:'var(--bg-l1)', l2:'var(--bg-l2)',
  border:'var(--border)', t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)', green:'var(--green)', red:'var(--red)', amber:'var(--amber)',
};

interface PetSkinShopProps {
  activePetId: string;
  onClose:     () => void;
  onSkinChange:(petId: string, skinId: string) => void;
}

export const PetSkinShop = ({ activePetId, onClose, onSkinChange }: PetSkinShopProps) => {
  const { currentUserId } = useAuthStore();
  const { getPoints, spendPoints } = useMoney();
  const [skinData, setSkinData] = useState(loadSkinData);
  const [petFilter, setPetFilter]   = useState<string>(activePetId);
  const [rarityFilter, setRarityFilter] = useState<SkinRarity|'all'>('all');
  const [preview,  setPreview]  = useState<PetSkin|null>(null);
  const [buying,   setBuying]   = useState(false);
  const [err,      setErr]      = useState('');

  const points  = getPoints(currentUserId ?? '');

  const availablePets = PETS.filter(p => skinData.owned.includes('acc-kutuzov') || true);

  const filteredSkins = PET_SKINS.filter(s => {
    const matchPet    = petFilter === 'all' || s.petId === petFilter || s.petId === 'all';
    const matchRarity = rarityFilter === 'all' || s.rarity === rarityFilter;
    return matchPet && matchRarity;
  });

  const buy = (skin: PetSkin) => {
    setErr('');
    if (!currentUserId) return;
    const ok = spendPoints(currentUserId, skin.pricePoints, `Скин «${skin.name}»`, skin.id);
    if (!ok) { setErr('Недостаточно баллов'); return; }
    const next = { ...skinData, owned: [...skinData.owned, skin.id] };
    setSkinData(next); saveSkinData(next);
    setBuying(true);
    setTimeout(() => setBuying(false), 1500);
  };

  const equip = (skin: PetSkin) => {
    const targetPet = skin.petId === 'all' ? activePetId : skin.petId;
    const next = { ...skinData, active: { ...skinData.active, [targetPet]: skin.id } };
    setSkinData(next); saveSkinData(next);
    onSkinChange(targetPet, skin.id);
  };

  const previewPet = PETS.find(p => p.id === (preview?.petId === 'all' ? activePetId : preview?.petId ?? activePetId));

  const RARITY_FILTERS: (SkinRarity|'all')[] = ['all','common','rare','epic','legendary'];

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      className="fixed inset-0 z-[60] flex flex-col" style={{ background:'#0a0a0c' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 shrink-0"
        style={{ borderBottom:`1px solid ${C.border}` }}>
        <div className="flex items-center gap-3">
          <ShoppingBag size={18} style={{ color:C.accent }}/>
          <div>
            <p className="text-base font-bold" style={{ color:C.t1 }}>Магазин скинов</p>
            <p className="text-xs" style={{ color:C.t3 }}>Покупка за Баллы Прайма</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ background:'rgba(245,158,11,0.12)', border:'1px solid rgba(245,158,11,0.25)' }}>
            <Star size={12} style={{ color:C.amber }}/>
            <span className="text-sm font-bold" style={{ color:C.amber }}>
              {points.toLocaleString('ru')}
            </span>
          </div>
          <button type="button" onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/5">
            <X size={18} style={{ color:C.t2 }}/>
          </button>
        </div>
      </div>

      {/* Pet filter */}
      <div className="flex gap-2 px-4 py-2.5 shrink-0 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
        <button type="button" onClick={() => setPetFilter('all')}
          className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold"
          style={{ background:petFilter==='all'?C.accent:C.l2, color:petFilter==='all'?'#fff':C.t3 }}>
          Все
        </button>
        {PETS.map(p => (
          <button key={p.id} type="button" onClick={() => setPetFilter(p.id)}
            className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold"
            style={{ background:petFilter===p.id?C.accent:C.l2, color:petFilter===p.id?'#fff':C.t3 }}>
            {p.emoji} {p.name}
          </button>
        ))}
      </div>

      {/* Rarity filter */}
      <div className="flex gap-2 px-4 pb-2.5 shrink-0 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
        {RARITY_FILTERS.map(r => {
          const color = r === 'all' ? C.accent : SKIN_RARITY_COLOR[r];
          return (
            <button key={r} type="button" onClick={() => setRarityFilter(r)}
              className="shrink-0 rounded-full px-3 py-1 text-[10px] font-semibold"
              style={{
                background: rarityFilter===r ? `${color}20` : 'rgba(255,255,255,0.04)',
                border: `1px solid ${rarityFilter===r ? color+'55' : C.border}`,
                color: rarityFilter===r ? color : C.t3,
              }}>
              {r === 'all' ? 'Все' : SKIN_RARITY_LABEL[r]}
            </button>
          );
        })}
      </div>

      {/* Skin grid */}
      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth:'none' }}>
        <div className="grid grid-cols-2 gap-3">
          {filteredSkins.map(skin => {
            const rc       = SKIN_RARITY_COLOR[skin.rarity];
            const rg       = SKIN_RARITY_GLOW[skin.rarity];
            const isOwned  = skinData.owned.includes(skin.id) || skin.pricePoints === 0;
            const targetPetId = skin.petId === 'all' ? activePetId : skin.petId;
            const isEquipped = skinData.active[targetPetId] === skin.id;
            const canAfford = points >= skin.pricePoints;
            const previewPetId = skin.petId === 'all' ? activePetId : skin.petId;

            return (
              <motion.div key={skin.id} whileTap={{ scale:.97 }}
                className="relative overflow-hidden rounded-3xl cursor-pointer"
                style={{
                  background: `linear-gradient(155deg,${skin.bodyColor}15,${skin.accentColor}10)`,
                  border: `2px solid ${isEquipped ? rc : rc+'30'}`,
                  boxShadow: isEquipped ? `0 0 0 3px ${rc}25` : 'none',
                }}
                onClick={() => setPreview(preview?.id === skin.id ? null : skin)}>

                {/* Equipped badge */}
                {isEquipped && (
                  <div className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full px-2 py-0.5"
                    style={{ background:rc, fontSize:9 }}>
                    <Check size={9} className="text-white"/>
                    <span className="text-white font-bold text-[9px]">Надет</span>
                  </div>
                )}

                {/* Lock overlay */}
                {!isOwned && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center"
                    style={{ background:'rgba(0,0,0,0.45)', backdropFilter:'blur(1px)' }}>
                    <Lock size={16} style={{ color:'rgba(255,255,255,0.6)' }}/>
                    <div className="flex items-center gap-1 mt-1.5">
                      <Star size={10} style={{ color:C.amber }}/>
                      <span className="text-xs font-bold" style={{ color:C.amber }}>
                        {skin.pricePoints.toLocaleString('ru')}
                      </span>
                    </div>
                    {!canAfford && (
                      <span className="text-[9px] mt-0.5" style={{ color:C.red }}>Мало баллов</span>
                    )}
                  </div>
                )}

                {/* Pet preview */}
                <div className="flex justify-center pt-4 pb-2">
                  <PetSprite petId={previewPetId} skin={skin} mood="idle" size={80} showParticles={false}/>
                </div>

                {/* Info */}
                <div className="px-3 pb-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background:`${rc}20`, color:rc }}>
                      {SKIN_RARITY_LABEL[skin.rarity]}
                    </span>
                    {skin.badge && <span className="text-sm">{skin.badge}</span>}
                  </div>
                  <p className="text-sm font-bold" style={{ color:C.t1 }}>{skin.name}</p>
                  <p className="text-[10px] mt-0.5 leading-snug" style={{ color:C.t3 }}>{skin.description}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Skin action panel */}
      <AnimatePresence>
        {preview && (
          <motion.div initial={{ y:80, opacity:0 }} animate={{ y:0, opacity:1 }} exit={{ y:80, opacity:0 }}
            className="shrink-0 px-4 pb-6 pt-4 space-y-3"
            style={{ borderTop:`1px solid ${C.border}`, background:'#121215' }}>
            <div className="flex items-center gap-3">
              <PetSprite
                petId={preview.petId === 'all' ? activePetId : preview.petId}
                skin={preview} mood="happy" size={52} showParticles={false}/>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color:C.t1 }}>{preview.name}</p>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background:`${SKIN_RARITY_COLOR[preview.rarity]}20`, color:SKIN_RARITY_COLOR[preview.rarity] }}>
                  {SKIN_RARITY_LABEL[preview.rarity]}
                </span>
              </div>
              <button type="button" onClick={() => setPreview(null)}
                className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/5">
                <X size={14} style={{ color:C.t2 }}/>
              </button>
            </div>

            {err && <p className="text-xs text-center" style={{ color:C.red }}>{err}</p>}

            {skinData.owned.includes(preview.id) || preview.pricePoints === 0 ? (
              <motion.button whileTap={{ scale:.97 }} type="button"
                onClick={() => { equip(preview); setPreview(null); }}
                className="w-full rounded-2xl py-3.5 text-sm font-bold text-white"
                style={{ background:`linear-gradient(135deg,${SKIN_RARITY_COLOR[preview.rarity]},${SKIN_RARITY_COLOR[preview.rarity]}aa)` }}>
                ✓ Надеть скин
              </motion.button>
            ) : (
              <motion.button whileTap={{ scale:.97 }} type="button"
                disabled={points < preview.pricePoints || buying}
                onClick={() => buy(preview)}
                className="w-full rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-40"
                style={{ background:'linear-gradient(135deg,#d97706,#f59e0b)', boxShadow:'0 8px 28px rgba(245,158,11,0.35)' }}>
                {buying ? '✓ Куплено!' : (
                  <span className="flex items-center justify-center gap-2">
                    <Star size={15}/> Купить за {preview.pricePoints.toLocaleString('ru')} баллов
                  </span>
                )}
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
