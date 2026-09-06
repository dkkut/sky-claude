import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Star, Lock, Check, Sparkles, CircleUserRound, PawPrint } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useCustomization } from './store';
import { RARITY_COLOR, RARITY_LABEL, type Rarity, type ItemCategory, type CosmeticItem } from './types';
import { FRAME_CATALOG } from './catalog/frames';
import { BANNER_CATALOG } from './catalog/banners';
import { PROFILE_THEME_CATALOG } from './catalog/profileThemes';
import { CHAT_LIST_STYLE_CATALOG } from './catalog/chatListStyles';
import { MOTIFS } from './Decorative';

type MarketCategory = 'frame' | 'banner' | 'profileTheme' | 'chatListStyle' | 'pet';

const CATEGORY_TABS: { key: MarketCategory; label: string }[] = [
  { key: 'frame', label: 'Рамки' },
  { key: 'banner', label: 'Баннеры чата' },
  { key: 'profileTheme', label: 'Темы профиля' },
  { key: 'chatListStyle', label: 'Список чатов' },
  { key: 'pet', label: 'Питомцы' },
];

const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic', 'exclusive'];

/** Небольшое превью предмета — своя отрисовка под каждую категорию. */
const Preview = ({ category, item }: { category: MarketCategory; item: any }) => {
  if (category === 'frame') {
    return (
      <div className="relative w-14 h-14 mx-auto">
        {item.ring !== 'transparent' && <div className="absolute rounded-full" style={{ inset: -3, background: item.ring, boxShadow: item.glow }} />}
        <div className="absolute inset-0 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-l3)' }}>
          <CircleUserRound size={22} style={{ color: 'var(--t2)' }} />
        </div>
      </div>
    );
  }
  if (category === 'banner' || category === 'profileTheme') {
    const bg = category === 'banner' ? item.background : item.pageBackground;
    const Motif = MOTIFS[item.motif as keyof typeof MOTIFS];
    return (
      <div className="relative w-full h-16 rounded-xl overflow-hidden" style={{ background: bg }}>
        {(item.motifOpacity ?? 0) > 0 && <Motif accent={item.accent2 ?? item.accent} opacity={item.motifOpacity} />}
      </div>
    );
  }
  if (category === 'chatListStyle') {
    return (
      <div className="relative w-full h-10 rounded-lg flex items-center px-2"
        style={{ background: item.background ?? 'var(--bg-l3)', border: item.border, boxShadow: item.glow }}>
        {item.leftBar && <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full" style={{ background: item.leftBar }} />}
        {item.badge && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#f5a623', color: '#000' }}>{item.badge}</span>}
      </div>
    );
  }
  return <div className="w-full h-16 rounded-xl flex items-center justify-center" style={{ background: 'var(--bg-l3)' }}><PawPrint size={22} style={{ color: 'var(--t2)' }} /></div>;
};

export const CustomizationMarket = ({ onClose }: { onClose: () => void }) => {
  const { currentUserId, accounts } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const { owned, favorites, grantItem, equip, toggleFavorite, getEquipped, isFavorite } = useCustomization();

  const [cat, setCat] = useState<MarketCategory>('frame');
  const [q, setQ] = useState('');
  const [rarity, setRarity] = useState<Rarity | null>(null);
  const [onlyFav, setOnlyFav] = useState(false);
  const [preview, setPreview] = useState<CosmeticItem | null>(null);

  const catalog = useMemo(() => {
    switch (cat) {
      case 'frame': return FRAME_CATALOG.filter(i => i.id !== 'none');
      case 'banner': return BANNER_CATALOG.filter(i => i.id !== 'banner-default');
      case 'profileTheme': return PROFILE_THEME_CATALOG.filter(i => i.id !== 'theme-sky');
      case 'chatListStyle': return CHAT_LIST_STYLE_CATALOG.filter(i => i.id !== 'cls-default');
      default: return [];
    }
  }, [cat]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return catalog.filter((i: CosmeticItem) =>
      (!s || i.name.toLowerCase().includes(s) || i.description.toLowerCase().includes(s)) &&
      (!rarity || i.rarity === rarity) &&
      (!onlyFav || (me && isFavorite(me.id, i.id))),
    );
  }, [catalog, q, rarity, onlyFav, me, favorites]);

  if (!me) return null;

  const unlockedOf = (item: CosmeticItem): boolean => {
    if (item.unlock.type === 'owned') return (owned[me.id] ?? []).includes(item.id);
    if (item.unlock.type === 'prime') return !!me.isPrime;
    if (item.unlock.type === 'business') return !!me.isPrimeBusiness;
    if (item.unlock.type === 'admin') return !!me.isAdmin;
    if (item.unlock.type === 'tenure') {
      const days = Math.floor((Date.now() - new Date(me.createdAt).getTime()) / 86_400_000);
      return days >= item.unlock.days;
    }
    if (item.unlock.type === 'season') {
      const now = Date.now();
      return now >= new Date(item.unlock.from).getTime() && now <= new Date(item.unlock.to).getTime();
    }
    return item.unlock.type === 'default';
  };

  const equippedId = getEquipped(me.id, cat as ItemCategory);

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10040] flex flex-col" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 shrink-0 sky-glass" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Sparkles size={18} style={{ color: 'var(--accent)' }} />
            <h2 className="font-bold text-base" style={{ color: 'var(--t1)' }}>Маркет кастомизации</h2>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-l2)' }}>
            <X size={18} style={{ color: 'var(--t2)' }} />
          </button>
        </div>

        <div className="flex gap-1.5 px-4 sm:px-6 py-3 overflow-x-auto no-scrollbar shrink-0">
          {CATEGORY_TABS.map(t => (
            <button key={t.key} type="button" onClick={() => setCat(t.key)}
              className="px-3.5 py-1.5 rounded-full text-xs font-semibold shrink-0"
              style={{ background: cat === t.key ? 'var(--accent)' : 'var(--bg-l2)', color: cat === t.key ? '#fff' : 'var(--t2)' }}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 px-4 sm:px-6 pb-3 shrink-0">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--bg-l2)' }}>
            <Search size={14} style={{ color: 'var(--t3)' }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по маркету..."
              className="bg-transparent outline-none text-sm flex-1" style={{ color: 'var(--t1)' }} />
          </div>
          <button type="button" onClick={() => setOnlyFav(v => !v)}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: onlyFav ? 'rgba(250,204,21,0.15)' : 'var(--bg-l2)' }}>
            <Star size={16} style={{ color: onlyFav ? '#facc15' : 'var(--t2)' }} fill={onlyFav ? '#facc15' : 'none'} />
          </button>
        </div>

        <div className="flex gap-1.5 px-4 sm:px-6 pb-3 overflow-x-auto no-scrollbar shrink-0">
          <button type="button" onClick={() => setRarity(null)}
            className="px-2.5 py-1 rounded-full text-[11px] font-medium shrink-0"
            style={{ background: rarity === null ? 'var(--bg-l3)' : 'transparent', color: rarity === null ? 'var(--t1)' : 'var(--t3)', border: '1px solid var(--border)' }}>
            Все редкости
          </button>
          {RARITIES.map(r => (
            <button key={r} type="button" onClick={() => setRarity(r)}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium shrink-0"
              style={{ background: rarity === r ? `${RARITY_COLOR[r]}22` : 'transparent', color: rarity === r ? RARITY_COLOR[r] : 'var(--t3)', border: `1px solid ${rarity === r ? RARITY_COLOR[r] : 'var(--border)'}` }}>
              {RARITY_LABEL[r]}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6">
          {cat === 'pet' ? (
            <div className="sky-empty py-16 text-center text-sm" style={{ color: 'var(--t3)' }}>
              <PawPrint size={26} className="mx-auto mb-3" style={{ color: 'var(--t3)' }} />
              Питомцы живут в отдельном разделе — «Питомцы» в меню чата 🐾
            </div>
          ) : filtered.length === 0 ? (
            <div className="sky-empty py-16 text-center text-sm" style={{ color: 'var(--t3)' }}>Ничего не найдено</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filtered.map((item: CosmeticItem) => {
                const unlocked = unlockedOf(item);
                const isEquipped = equippedId === item.id;
                return (
                  <button key={item.id} type="button" onClick={() => setPreview(item)}
                    className="relative rounded-2xl p-3 flex flex-col gap-2 text-left sky-hover-lift"
                    style={{ background: 'var(--bg-l1)', border: isEquipped ? '2px solid var(--accent)' : '1px solid var(--border)' }}>
                    <button type="button" onClick={e => { e.stopPropagation(); toggleFavorite(me.id, item.id); }}
                      className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)' }}>
                      <Star size={12} style={{ color: isFavorite(me.id, item.id) ? '#facc15' : '#fff' }} fill={isFavorite(me.id, item.id) ? '#facc15' : 'none'} />
                    </button>
                    {!unlocked && <Lock size={13} className="absolute top-2 left-2 z-10" color="#fff" />}
                    <Preview category={cat} item={item} />
                    <div>
                      <div className="text-xs font-semibold truncate" style={{ color: 'var(--t1)' }}>{item.name}</div>
                      <div className="text-[10px] font-semibold mt-0.5" style={{ color: RARITY_COLOR[item.rarity] }}>{RARITY_LABEL[item.rarity]}</div>
                    </div>
                    {isEquipped && (
                      <span className="absolute bottom-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'var(--accent)', color: '#fff' }}>
                        <Check size={9} /> Надето
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* -- Предпросмотр перед применением -- */}
        {preview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10050] flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setPreview(null)}>
            <motion.div initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} onClick={e => e.stopPropagation()}
              className="w-full sm:max-w-sm sm:rounded-3xl rounded-t-3xl overflow-hidden" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <div className="p-5">
                <Preview category={cat} item={preview} />
                <h3 className="mt-4 font-bold text-base" style={{ color: 'var(--t1)' }}>{preview.name}</h3>
                <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>{preview.description}</p>
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-[11px] font-semibold px-2 py-1 rounded-full" style={{ background: `${RARITY_COLOR[preview.rarity]}22`, color: RARITY_COLOR[preview.rarity] }}>
                    {RARITY_LABEL[preview.rarity]}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--t3)' }}>{preview.obtainLabel}</span>
                </div>
              </div>
              <div className="p-4 pt-0">
                {unlockedOf(preview) ? (
                  <button type="button"
                    onClick={() => { equip(me.id, cat as ItemCategory, preview.id); setPreview(null); }}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm" style={{ background: 'var(--accent)', color: '#fff' }}>
                    {equippedId === preview.id ? 'Уже надето' : 'Применить'}
                  </button>
                ) : preview.unlock.type === 'owned' ? (
                  <button type="button"
                    onClick={() => { grantItem(me.id, preview.id); equip(me.id, cat as ItemCategory, preview.id); setPreview(null); }}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm" style={{ background: 'var(--accent)', color: '#fff' }}>
                    Получить и применить
                  </button>
                ) : (
                  <div className="w-full py-2.5 rounded-xl font-semibold text-sm text-center" style={{ background: 'var(--bg-l2)', color: 'var(--t3)' }}>
                    {preview.obtainLabel}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
