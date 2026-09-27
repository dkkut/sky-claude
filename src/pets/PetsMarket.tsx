/**
 * Маркет скинов питомцев — каталог/поиск/фильтры/покупка.
 * Встроен как модальный оверлей поверх PetsScreen, отдельного модуля
 * маркетплейса не создаёт — использует ту же серверную ручку
 * /api/pets/market, что и весь остальной клиент питомцев.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Search, Check, Loader2, Sparkles } from 'lucide-react';
import { Pet3DViewer } from './Pet3DViewer';
import { apiPetsMarket, apiPetsBuySkin, type PetSkin, type Rarity } from './petsApi';

const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Обычный', uncommon: 'Необычный', rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный', mythic: 'Мифический',
};
const RARITY_COLOR: Record<Rarity, string> = {
  common: '#94a3b8', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b', mythic: '#ec4899',
};
const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'Все' }, { key: 'new', label: 'Новые' }, { key: 'popular', label: 'Популярные' }, { key: 'rare', label: 'Редкие' },
];

export const PetsMarket = ({ myPetType, onClose, onBought }: { myPetType: string; onClose: () => void; onBought: () => void }) => {
  const [items, setItems] = useState<PetSkin[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<PetSkin | null>(null);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState('');

  const load = async () => {
    setLoading(true);
    const rarity = filter === 'rare' ? 'rare' : undefined;
    const res = await apiPetsMarket({ q: q || undefined, rarity, petType: myPetType });
    setItems(res);
    setLoading(false);
  };
  useEffect(() => { void load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = filter === 'new'
    ? [...items].slice(-12)
    : filter === 'popular'
      ? [...items].sort((a, b) => (a.rarity === b.rarity ? 0 : a.rarity === 'legendary' || a.rarity === 'mythic' ? -1 : 1))
      : items;

  const buy = async (skin: PetSkin) => {
    if (buying) return;
    setBuying(true);
    setBuyError('');
    const r = await apiPetsBuySkin(skin.id);
    setBuying(false);
    if (r.ok) {
      setSelected(null);
      onBought();
      void load();
    } else {
      setBuyError(
        r.error === 'insufficient_points' ? 'Недостаточно баллов'
          : r.error === 'already_owned' ? 'Уже куплено'
            : r.error === 'not_found' ? 'Скин недоступен'
              : 'Не удалось купить',
      );
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(8,6,16,0.92)', backdropFilter: 'blur(12px)' }}
      className="flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <h2 className="text-base font-black flex items-center gap-2" style={{ color: 'var(--t1)' }}>
          <Sparkles size={16} style={{ color: '#a855f7' }}/> Маркет скинов
        </h2>
        <button type="button" onClick={onClose} className="rounded-full p-2" style={{ background: 'var(--bg-l2)' }}>
          <X size={16} style={{ color: 'var(--t2)' }}/>
        </button>
      </div>

      <div className="px-5 py-3 space-y-2.5 shrink-0">
        <div className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <Search size={14} style={{ color: 'var(--t3)' }}/>
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && void load()}
            placeholder="Поиск скина..." className="flex-1 bg-transparent text-sm outline-none" style={{ color: 'var(--t1)' }}/>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {FILTERS.map(f => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold"
              style={{
                background: filter === f.key ? 'linear-gradient(135deg,#a855f7,#ec4899)' : 'var(--bg-l2)',
                color: filter === f.key ? '#fff' : 'var(--t2)',
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {loading ? (
          <div className="grid h-40 place-items-center"><Loader2 className="animate-spin" style={{ color: 'var(--accent)' }}/></div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm py-10" style={{ color: 'var(--t3)' }}>Ничего не найдено</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map(skin => (
              <button key={skin.id} type="button" onClick={() => { setSelected(skin); setBuyError(''); }}
                className="rounded-2xl p-3 text-left space-y-2"
                style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                <div className="h-24 rounded-xl overflow-hidden" style={{ background: 'var(--bg-l2)' }}>
                  {skin.previewUrl
                    ? <img src={skin.previewUrl} alt={skin.name} className="h-full w-full object-cover"/>
                    : <div className="h-full w-full grid place-items-center" style={{ color: RARITY_COLOR[skin.rarity] }}>
                        <Sparkles size={22}/>
                      </div>}
                </div>
                <p className="text-xs font-bold truncate" style={{ color: 'var(--t1)' }}>{skin.name}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${RARITY_COLOR[skin.rarity]}22`, color: RARITY_COLOR[skin.rarity] }}>
                    {RARITY_LABEL[skin.rarity]}
                  </span>
                  {skin.owned
                    ? <Check size={13} style={{ color: '#22c55e' }}/>
                    : <span className="text-[11px] font-black" style={{ color: 'var(--t1)' }}>{skin.price === 0 ? 'Бесплатно' : `${skin.price} ⭐`}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)' }}
          className="flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <div style={{ height: 220 }}>
              <Pet3DViewer petType={selected.petType} modelUrl={selected.modelUrl}/>
            </div>
            <div className="p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-base font-black" style={{ color: 'var(--t1)' }}>{selected.name}</p>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${RARITY_COLOR[selected.rarity]}22`, color: RARITY_COLOR[selected.rarity] }}>
                  {RARITY_LABEL[selected.rarity]}
                </span>
              </div>
              {selected.description && <p className="text-xs" style={{ color: 'var(--t3)' }}>{selected.description}</p>}
              {(selected.animations.length > 0 || selected.effects.length > 0) && (
                <p className="text-[10px]" style={{ color: 'var(--t3)' }}>
                  {[...selected.animations, ...selected.effects].join(' · ')}
                </p>
              )}
              {buyError && <p className="text-xs font-semibold" style={{ color: '#ef4444' }}>{buyError}</p>}
              {selected.owned ? (
                <div className="rounded-xl py-2.5 text-center text-sm font-bold" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>Уже куплено</div>
              ) : (
                <button type="button" disabled={buying} onClick={() => void buy(selected)}
                  className="w-full rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#a855f7,#ec4899)' }}>
                  {buying ? 'Покупка...' : selected.price === 0 ? 'Получить бесплатно' : `Купить за ${selected.price} ⭐`}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};
