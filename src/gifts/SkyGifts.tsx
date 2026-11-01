/* ===============================================================
   SKY GIFTS UI
   Модальное окно выбора подарка + отображение в чате
=============================================================== */
import { StoryVideo } from '@/stories/StoryMedia';
import { useEffect, useState } from 'react';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, type TargetAndTransition } from 'framer-motion';
import { X, ChevronLeft, Check, Heart, ShoppingCart, Star, Search, Ban, Clock3, Archive, ArchiveRestore, Eye, EyeOff } from 'lucide-react';
import {
  GIFT_CATALOG, GIFT_RARITY_LABEL, GIFT_RARITY_COLOR, GIFT_RARITY_GLOW,
  RARITY_CARD_BG, RARITY_CARD_BORDER, RARITY_SHIMMER, RARITY_STARS,
  fmtGiftPrice, type GiftItem, type SentGift, type GiftRarity,
} from './store';
import {
  apiGiftCatalog, apiSendGift, apiMyProfileGifts, apiMyReceivedGifts, apiMySentGifts,
  apiMyReceivedGiftsArchived, apiMySentGiftsArchived, apiArchiveGift, apiSaveGiftToProfile,
  apiPublicProfileGifts, toSentGift, giftMediaUrl, apiCancelGift, type GiftCatalogItem,
} from './giftsApi';
import { useMoney } from '@/wallet/store';
import { useAuthStore } from '@/core/auth/store';

const RARITIES: GiftRarity[] = ['common', 'rare', 'epic', 'legendary', 'unique'];
const asRarity = (r: string): GiftRarity => (RARITIES.includes(r as GiftRarity) ? (r as GiftRarity) : 'common');
const ANIMATIONS: GiftItem['animation'][] = ['bounce', 'spin', 'pulse', 'float', 'sparkle'];

/**
 * Каталог реальный (сервер, server/gifts.mjs), а не GIFT_CATALOG —
 * тот остаётся только как запасной, пока сервер не ответил, и как
 * источник данных для уже показанных где-то ещё старых записей.
 * Рублёвая цена в каталоге не хранится (обычные подарки продаются
 * только за баллы Прайма) — показываем производную по тому же курсу,
 * что и обмен в кошельке (10 баллов = 1 ₽), чтобы не менять экран.
 */
const toGiftItem = (i: GiftCatalogItem, idx: number): GiftItem => {
  const [c1, c2] = (i.gradient || '').split(',');
  return {
    id: i.id, name: i.name, emoji: i.emoji, description: i.description,
    rarity: asRarity(i.rarity), price: Math.round(i.pricePoints / 10), pricePoints: i.pricePoints,
    gradient: [c1 || '#1a1a1f', c2 || '#252528'],
    animation: ANIMATIONS[idx % ANIMATIONS.length],
    available: -1, sold: 0, seasonal: i.seasonal,
  };
};

/** GIFT_CATALOG остаётся запасным на время загрузки, чтобы экран не мигал пустотой. */
const useGiftCatalog = () => {
  const [catalog, setCatalog] = useState<GiftItem[]>(GIFT_CATALOG);
  useEffect(() => {
    let alive = true;
    apiGiftCatalog().then((items) => { if (alive && items.length) setCatalog(items.map(toGiftItem)); });
    return () => { alive = false; };
  }, []);
  return catalog;
};

const C = {
  bg:'var(--bg)', l1:'var(--bg-l1)', l2:'var(--bg-l2)', l3:'var(--bg-l3)',
  border:'var(--border)', b2:'var(--border-m)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)', green:'var(--green)', amber:'var(--amber)', red:'var(--red)',
};

/* -- Animation variants --------------------------------------- */
const ANIM: Record<string, TargetAndTransition> = {
  bounce:  { y: [0,-10,0,-5,0], transition: { duration:1.4, repeat:Infinity, ease:'easeInOut' } },
  spin:    { rotate: [0,360],   transition: { duration:3,   repeat:Infinity, ease:'linear'     } },
  pulse:   { scale: [1,1.15,1], transition: { duration:1.2, repeat:Infinity, ease:'easeInOut' } },
  float:   { y: [0,-8,0],       transition: { duration:2,   repeat:Infinity, ease:'easeInOut' } },
  sparkle: {
    scale:   [1,1.1,1,1.05,1],
    opacity: [1,0.85,1,0.9,1],
    transition: { duration:2, repeat:Infinity, ease:'easeInOut' },
  },
};

/* -- Gift Card (rich rarity-specific design) ------------------ */
const GiftCard = ({ gift, selected, onClick }: {
  gift: GiftItem; selected: boolean; onClick: () => void;
}) => {
  const rc    = GIFT_RARITY_COLOR[gift.rarity];
  const rg    = GIFT_RARITY_GLOW[gift.rarity];
  const bg    = RARITY_CARD_BG[gift.rarity];
  const bdr   = RARITY_CARD_BORDER[gift.rarity];
  const shim  = RARITY_SHIMMER[gift.rarity];
  const stars = RARITY_STARS[gift.rarity];
  const epic  = gift.rarity === 'epic' || gift.rarity === 'legendary' || gift.rarity === 'unique';
  // Бесконечные анимации — только у выбранной карточки. Раньше их крутила
  // каждая (по две-три на карточку): на каталоге из десятков подарков всё
  // это шло одновременно в основном потоке, и экран зависал.
  const live  = selected;

  return (
    <motion.button type="button" onClick={onClick} whileTap={{ scale:.93 }}
      className="relative flex flex-col rounded-3xl overflow-hidden transition-all"
      style={{
        // Карточки за пределами экрана не рисуются, пока до них не докрутили.
        contentVisibility: 'auto', containIntrinsicSize: 'auto 150px',
        background: bg,
        border:     `2px solid ${selected ? rc : bdr}`,
        boxShadow:  selected
          ? `0 0 0 3px ${rc}30, 0 10px 36px ${rg}`
          : `0 4px 20px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.05)`,
        padding: 0,
      }}>
      {/* Shimmer */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background:`linear-gradient(135deg,${shim} 0%,transparent 60%,${shim} 100%)` }}/>
      {/* Epic sparkle */}
      {epic && live && (
        <motion.div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl"
          animate={{ opacity:[0.2,0.6,0.2] }} transition={{ duration:3, repeat:Infinity }}>
          <div style={{ position:'absolute', inset:0, background:`linear-gradient(120deg,transparent 20%,${rc}15 50%,transparent 80%)` }}/>
        </motion.div>
      )}
      {/* Header: stars + selected */}
      <div className="w-full flex items-center justify-between px-2.5 pt-2.5 pb-0.5">
        <span style={{ fontSize:8, color:rc, fontWeight:900, letterSpacing:'0.05em' }}>
          {gift.seasonal ? '⚡ АКЦ' : stars}
        </span>
        {selected && (
          <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
            className="grid h-5 w-5 place-items-center rounded-full"
            style={{ background:rc }}>
            <Check size={9} className="text-white"/>
          </motion.div>
        )}
      </div>
      {/* Emoji with glow bg */}
      <div className="relative flex items-center justify-center py-2 w-full">
        <motion.div className="absolute rounded-full pointer-events-none"
          style={{ width:48, height:48, background:`radial-gradient(circle,${rc}28,transparent 70%)` }}
          animate={live ? { scale:[0.9,1.15,0.9], opacity:[0.4,0.8,0.4] } : { scale:1, opacity:0.5 }}
          transition={live ? { duration:2.5, repeat:Infinity, ease:'easeInOut' } : { duration:0 }}/>
        <motion.div className="text-[38px] select-none relative z-10"
          animate={live ? ANIM[gift.animation] : { y:0, rotate:0, scale:1 }}
          transition={!live ? { duration:0 }
            : gift.animation==='spin'
              ? { duration:3, repeat:Infinity, ease:'linear' }
              : { duration:2, repeat:Infinity, ease:'easeInOut' }}>
          {gift.emoji}
        </motion.div>
      </div>
      {/* Info */}
      <div className="w-full px-2 pb-2.5 pt-1" style={{ background:'rgba(0,0,0,0.25)' }}>
        <p className="text-[11px] font-bold text-center text-white truncate">{gift.name}</p>
        <div className="flex items-center justify-center gap-0.5 mt-0.5">
          <span style={{ fontSize:9, color:'var(--amber)' }}>⭐</span>
          <span className="text-[10px] font-black" style={{ color:'var(--amber)' }}>
            {gift.pricePoints.toLocaleString('ru')}
          </span>
        </div>
      </div>
    </motion.button>
  );
};


/* === GIFT MARKET  -  Маркет подарков как у Telegram ========== */
const _shimCss=(typeof document!=="undefined"&&!document.getElementById("_sky-sh-kf"))?(()=>{const s=document.createElement("style");s.id="_sky-sh-kf";s.textContent="@keyframes _skyShimmerKf{0%{background-position:0% 50%}100%{background-position:200% 50%}}";document.head.appendChild(s);return null;})():null;

export const GiftMarket = ({ onClose }: { onClose: () => void }) => {
  const { currentUserId } = useAuthStore();
  const { getPoints } = useMoney();
  const catalog = useGiftCatalog();
  const [filter,   setFilter]   = useState<GiftRarity|'all'>('all');
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState<GiftItem|null>(null);
  const [buying,   setBuying]   = useState(false);
  const [done,     setDone]     = useState(false);
  const [err,      setErr]      = useState('');

  const points  = getPoints(currentUserId ?? '');

  const visible = catalog.filter(g => {
    const matchRarity = filter === 'all' || g.rarity === filter;
    const matchSearch = !search || g.name.toLowerCase().includes(search.toLowerCase());
    return matchRarity && matchSearch;
  });

  const buy = async () => {
    if (!selected || !currentUserId) return;
    setErr('');
    setBuying(true);
    // Подарок себе — тот же заказ, что и в GiftModal, только сразу в профиль.
    const r = await apiSendGift({ giftCatalogId: selected.id, recipientId: currentUserId, target: 'profile' });
    setBuying(false);
    if (!r.ok) { setErr(r.reason); return; }
    setDone(true);
  };

  const RARITY_FILTERS: (GiftRarity|'all')[] = ['all','common','rare','epic','legendary','unique'];

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      className="fixed inset-0 z-[500] flex flex-col"
      style={{ background:'var(--bg-l1)' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 shrink-0"
        style={{ borderBottom:'1px solid rgba(255,255,255,0.07)' }}>
        <button type="button" onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/5">
          <X size={18} style={{ color:'var(--t2)' }}/>
        </button>
        <div className="flex-1">
          <p className="text-base font-bold text-white">Маркет подарков</p>
          <p className="text-xs mt-0.5" style={{ color:'var(--t2)' }}>Оплата баллами Прайма</p>
        </div>
        {/* Points balance */}
        <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
          style={{ background:'rgba(245,158,11,0.12)', border:'1px solid rgba(245,158,11,0.25)' }}>
          <Star size={12} style={{ color:'var(--amber)' }}/>
          <span className="text-sm font-bold" style={{ color:'var(--amber)' }}>
            {points.toLocaleString('ru')}
          </span>
        </div>
      </div>

      {/* Search + filter */}
      <div className="px-4 pt-3 pb-2 space-y-2 shrink-0">
        <div className="flex items-center gap-2 rounded-2xl px-3 py-2.5"
          style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.07)' }}>
          <Search size={14} style={{ color:'var(--t3)' }}/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск подарков..."
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color:'var(--t1)' }}/>
        </div>
        <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
          {RARITY_FILTERS.map(r => {
            const color = r === 'all' ? 'var(--accent)' : GIFT_RARITY_COLOR[r as GiftRarity];
            return (
              <button key={r} type="button" onClick={() => setFilter(r)}
                className="shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition-all"
                style={{
                  background: filter===r ? `${color}22` : 'rgba(255,255,255,0.04)',
                  border:     `1px solid ${filter===r ? color+'55' : 'var(--border)'}`,
                  color:      filter===r ? color : 'var(--t3)',
                }}>
                {r === 'all' ? 'Все' : GIFT_RARITY_LABEL[r as GiftRarity]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Gift grid */}
      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth:'none' }}>
        <div className="grid grid-cols-3 gap-3">
          {visible.map(gift => {
            const rc   = GIFT_RARITY_COLOR[gift.rarity];
            const rg   = GIFT_RARITY_GLOW[gift.rarity];
            const canAfford = points >= gift.pricePoints;
            return (
              <motion.button key={gift.id} type="button"
                whileTap={{ scale:.95 }}
                onClick={() => setSelected(selected?.id===gift.id ? null : gift)}
                className="relative flex flex-col items-center gap-2 rounded-3xl p-3.5 transition-all"
                style={{
                  background: selected?.id===gift.id ? `${rc}18` : `linear-gradient(155deg,${gift.gradient[0]},${gift.gradient[1]})`,
                  border: `2px solid ${selected?.id===gift.id ? rc : rc+'35'}`,
                  boxShadow: selected?.id===gift.id ? `0 0 0 3px ${rc}25, 0 6px 24px ${rg}` : `0 3px 12px rgba(0,0,0,0.3)`,
                  opacity: canAfford ? 1 : 0.55,
                }}>
                {!canAfford && (
                  <div className="absolute top-1.5 right-1.5 rounded-full w-2 h-2"
                    style={{ background:'var(--red)' }}/>
                )}
                {selected?.id===gift.id && (
                  <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
                    className="absolute -top-2 -right-2 grid h-6 w-6 place-items-center rounded-full"
                    style={{ background:rc }}>
                    <Check size={11} className="text-white"/>
                  </motion.div>
                )}
                <motion.div className="text-4xl select-none" animate={selected?.id===gift.id ? ANIM[gift.animation] : undefined}>
                  {gift.emoji}
                </motion.div>
                <p className="text-[10px] font-bold text-white text-center leading-tight">{gift.name}</p>
                <div className="flex items-center gap-1">
                  <Star size={9} style={{ color:'var(--amber)' }}/>
                  <span className="text-[10px] font-black" style={{ color:'var(--amber)' }}>
                    {gift.pricePoints.toLocaleString('ru')}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Bottom action */}
      <AnimatePresence>
        {selected && (
          <motion.div initial={{ y:80, opacity:0 }} animate={{ y:0, opacity:1 }} exit={{ y:80, opacity:0 }}
            className="shrink-0 px-4 pb-6 pt-3 space-y-2.5"
            style={{ borderTop:'1px solid rgba(255,255,255,0.06)', background:'var(--bg-l1)' }}>
            {err && <p className="text-xs text-center" style={{ color:'var(--red)' }}>{err}</p>}
            {done ? (
              <div className="flex items-center justify-center gap-2 py-3">
                <Check size={18} style={{ color:'var(--green)' }}/>
                <span className="text-sm font-bold" style={{ color:'var(--green)' }}>Подарок куплен и сохранён!</span>
              </div>
            ) : (
              <motion.button whileTap={{ scale:.97 }} type="button" onClick={buy}
                disabled={buying || points < selected.pricePoints}
                className="flex items-center justify-between w-full rounded-2xl px-5 py-4 text-white disabled:opacity-40"
                style={{
                  background: `linear-gradient(135deg,${GIFT_RARITY_COLOR[selected.rarity]},${GIFT_RARITY_COLOR[selected.rarity]}aa)`,
                  boxShadow: `0 8px 28px ${GIFT_RARITY_GLOW[selected.rarity]}`,
                }}>
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">{selected.emoji}</span>
                  <p className="text-sm font-bold">{buying ? 'Покупка...' : `Купить «${selected.name}»`}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Star size={13}/>
                  <span className="font-black">{selected.pricePoints.toLocaleString('ru')}</span>
                </div>
              </motion.button>
            )}
            {points < (selected?.pricePoints ?? 0) && (
              <p className="text-center text-xs" style={{ color:'var(--red)' }}>
                Не хватает {((selected?.pricePoints ?? 0) - points).toLocaleString('ru')} баллов.
                Обменяйте рубли в кошельке.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/* -- Gift Send Modal ------------------------------------------- */
export type GiftTarget = 'chat' | 'profile';

export interface GiftModalProps {
  chatId:    string;
  toUserId:  string;
  toName:    string;
  onClose:   () => void;
  onSent:    () => void;
}

export const GiftModal = ({ toUserId, toName, onClose, onSent }: GiftModalProps) => {
  const { currentUserId, accounts } = useAuthStore();
  const { getBalance, getPoints } = useMoney();
  const me = accounts.find(a => a.id === currentUserId);
  const [showMarket, setShowMarket] = useState(false);
  const [target, setTarget]         = useState<GiftTarget>('chat');
  const points = getPoints(currentUserId ?? '');

  const catalog = useGiftCatalog();

  const [selected, setSelected] = useState<GiftItem | null>(null);
  const [message,  setMessage]  = useState('');
  const [rarityFilter, setRarityFilter] = useState<GiftRarity | 'all'>('all');
  const [step, setStep]         = useState<'pick' | 'confirm' | 'success'>('pick');
  const [err,  setErr]          = useState('');
  const [sending, setSending]   = useState(false);

  const balance = getBalance(currentUserId ?? '');

  const filtered = rarityFilter === 'all'
    ? catalog
    : catalog.filter(g => g.rarity === rarityFilter);

  const buy = async () => {
    if (!selected || !currentUserId || !me) return;
    setErr('');
    setSending(true);
    // Цену и доставку решает сервер (server/gifts.mjs::sendGift) — сюда
    // едет только id подарка из каталога, не цена и не картинка.
    const r = await apiSendGift({
      giftCatalogId: selected.id, recipientId: toUserId, target,
      message,
    });
    setSending(false);
    if (!r.ok) { setErr(r.reason); return; }
    setStep('success');
    setTimeout(() => { onSent(); onClose(); }, target === 'profile' ? 2000 : 1800);
  };

  const RARITY_FILTERS: (GiftRarity | 'all')[] = ['all','common','rare','epic','legendary','unique'];

  return (
    <>
    {showMarket && createPortal(
      <GiftMarket onClose={() => setShowMarket(false)}/>,
      document.body
    )}
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      className="fixed inset-0 z-[300] flex items-end justify-center"
      style={{ background:'rgba(0,0,0,0.75)', backdropFilter:'blur(8px)' }}
      onClick={onClose}>

      <motion.div initial={{ y:80, opacity:0 }} animate={{ y:0, opacity:1 }}
        exit={{ y:80, opacity:0 }} transition={{ type:'spring', damping:28, stiffness:300 }}
        className="w-full max-w-md overflow-hidden flex flex-col"
        style={{ background:C.bg, borderRadius:'28px 28px 0 0', maxHeight:'88vh' }}
        onClick={e => e.stopPropagation()}>

        {/* -- STEP: PICK -- */}
        {step === 'pick' && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-3 shrink-0">
              <div className="flex-1">
                <p className="text-base font-bold text-white">Отправить подарок</p>
                <p className="text-xs mt-0.5" style={{ color:C.t2 }}>для {toName}</p>
              </div>
              <div className="flex items-center gap-2">
                {/* Points balance */}
                <div className="flex items-center gap-1 rounded-full px-2.5 py-1"
                  style={{ background:'rgba(245,158,11,0.12)', border:'1px solid rgba(245,158,11,0.25)' }}>
                  <Star size={11} style={{ color:'var(--amber)' }}/>
                  <span className="text-xs font-bold" style={{ color:'var(--amber)' }}>
                    {points.toLocaleString('ru')}
                  </span>
                </div>
                {/* RUB balance */}
                <div className="text-right">
                  <p className="text-xs" style={{ color:C.t3 }}>{balance.toLocaleString('ru')} ₽</p>
                </div>
                {/* Market button - closes GiftModal, opens Market */}
                <button type="button" onClick={() => setShowMarket(true)}
                  className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/5"
                  title="Маркет подарков">
                  <ShoppingCart size={18} style={{ color:C.t2 }}/>
                </button>
              </div>
              <button type="button" onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-full ml-1 hover:bg-white/5">
                <X size={18} style={{ color:C.t2 }}/>
              </button>
            </div>

            {/* Rarity filter */}
            <div className="flex gap-1.5 px-5 pb-3 overflow-x-auto shrink-0" style={{ scrollbarWidth:'none' }}>
              {RARITY_FILTERS.map(r => {
                const color = r === 'all' ? C.accent : GIFT_RARITY_COLOR[r as GiftRarity];
                return (
                  <button key={r} type="button" onClick={() => setRarityFilter(r)}
                    className="shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition-all"
                    style={{
                      background: rarityFilter===r ? `${color}20` : C.l2,
                      border:     `1px solid ${rarityFilter===r ? color+'50' : C.border}`,
                      color:      rarityFilter===r ? color : C.t3,
                    }}>
                    {r === 'all' ? 'Все' : GIFT_RARITY_LABEL[r as GiftRarity]}
                  </button>
                );
              })}
            </div>

            {/* Gift grid */}
            <div className="flex-1 overflow-y-auto px-5 pb-5" style={{ scrollbarWidth:'none' }}>
              <div className="grid grid-cols-3 gap-3">
                {filtered.map(gift => (
                  <GiftCard key={gift.id} gift={gift}
                    selected={selected?.id === gift.id}
                    onClick={() => setSelected(selected?.id === gift.id ? null : gift)}/>
                ))}
              </div>
            </div>

            {/* Bottom CTA */}
            <div className="px-5 pb-6 pt-3 shrink-0" style={{ borderTop:`1px solid ${C.border}` }}>
              {selected ? (
                <motion.button initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
                  type="button" onClick={() => setStep('confirm')}
                  className="flex items-center justify-between w-full rounded-2xl px-5 py-4 font-bold text-white"
                  style={{
                    background: `linear-gradient(135deg,${GIFT_RARITY_COLOR[selected.rarity]},${GIFT_RARITY_COLOR[selected.rarity]}aa)`,
                    boxShadow: `0 8px 28px ${GIFT_RARITY_GLOW[selected.rarity]}`,
                  }}>
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl">{selected.emoji}</span>
                    <div className="text-left">
                      <p className="text-sm">{selected.name}</p>
                      <p className="text-xs opacity-70">{GIFT_RARITY_LABEL[selected.rarity]}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-base">{fmtGiftPrice(selected.price)}</p>
                    <p className="text-xs opacity-70">Далее →</p>
                  </div>
                </motion.button>
              ) : (
                <p className="text-center text-sm" style={{ color:C.t3 }}>
                  Выберите подарок
                </p>
              )}
            </div>
          </>
        )}

        {/* -- STEP: CONFIRM -- */}
        {step === 'confirm' && selected && (
          <div className="flex flex-col">
            <div className="flex items-center gap-3 px-5 pt-5 pb-3 shrink-0">
              <button type="button" onClick={() => setStep('pick')}
                className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/5">
                <ChevronLeft size={20} style={{ color:C.t2 }}/>
              </button>
              <p className="text-base font-bold text-white flex-1">Подтверждение</p>
            </div>

            {/* Gift preview */}
            <div className="flex flex-col items-center gap-4 py-8 px-5">
              <div className="relative">
                <div className="grid h-28 w-28 place-items-center rounded-3xl"
                  style={{
                    background: `linear-gradient(155deg,${selected.gradient[0]},${selected.gradient[1]})`,
                    boxShadow:  `0 16px 48px ${GIFT_RARITY_GLOW[selected.rarity]}`,
                    border:     `2px solid ${GIFT_RARITY_COLOR[selected.rarity]}50`,
                  }}>
                  <motion.div className="text-6xl select-none" animate={ANIM[selected.animation]}>
                    {selected.emoji}
                  </motion.div>
                </div>
                {/* Sparkle particles */}
                {['epic','legendary','unique'].includes(selected.rarity) && (
                  <>
                    {[...Array(6)].map((_,i) => (
                      <motion.div key={i}
                        className="absolute w-1.5 h-1.5 rounded-full"
                        style={{ background: GIFT_RARITY_COLOR[selected.rarity], top:'50%', left:'50%' }}
                        animate={{
                          x: [0, Math.cos(i*60*Math.PI/180)*45],
                          y: [0, Math.sin(i*60*Math.PI/180)*45],
                          opacity:[0,1,0], scale:[0,1,0],
                        }}
                        transition={{ duration:1.8, repeat:Infinity, delay:i*0.15, ease:'easeOut' }}/>
                    ))}
                  </>
                )}
              </div>

              <div className="text-center">
                <p className="text-xl font-black text-white">{selected.name}</p>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full mt-1.5 inline-block"
                  style={{ background:`${GIFT_RARITY_COLOR[selected.rarity]}20`, color:GIFT_RARITY_COLOR[selected.rarity] }}>
                  {GIFT_RARITY_LABEL[selected.rarity]}
                </span>
                <p className="text-sm mt-2" style={{ color:C.t2 }}>{selected.description}</p>
              </div>
            </div>

            {/* Target switcher */}
            <div className="mx-5 mb-3">
              <div className="grid grid-cols-2 gap-2 rounded-2xl p-1"
                style={{ background:C.l2 }}>
                <button type="button" onClick={() => setTarget('chat')}
                  className="rounded-xl py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                  style={{
                    background: target==='chat' ? C.accent : 'transparent',
                    color: target==='chat' ? '#fff' : C.t2,
                  }}>
                  💬 Подарить {toName}
                </button>
                <button type="button" onClick={() => setTarget('profile')}
                  className="rounded-xl py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                  style={{
                    background: target==='profile' ? 'var(--amber)' : 'transparent',
                    color: target==='profile' ? '#fff' : C.t2,
                  }}>
                  ⭐ Сохранить себе
                </button>
              </div>
              {target === 'profile' && (
                <p className="text-[10px] mt-1.5 text-center" style={{ color:C.t3 }}>
                  Оплата баллами · будет отображаться в вашем профиле
                </p>
              )}
            </div>

            {/* Recipient / Profile label */}
            <div className="mx-5 mb-3 rounded-2xl px-4 py-3 flex items-center justify-between"
              style={{ background:C.l2, border:`1px solid ${C.border}` }}>
              <span className="text-sm" style={{ color:C.t2 }}>
                {target === 'chat' ? 'Получатель' : 'Куда'}
              </span>
              <span className="text-sm font-semibold text-white">
                {target === 'chat' ? toName : 'Мой профиль'}
              </span>
            </div>

            {/* Message */}
            <div className="mx-5 mb-3">
              <textarea value={message} onChange={e => setMessage(e.target.value)}
                placeholder="Добавьте личное послание (необязательно)..."
                rows={2} maxLength={120}
                className="w-full rounded-2xl px-4 py-3 text-sm outline-none resize-none"
                style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
            </div>

            {/* Price + balance */}
            <div className="mx-5 mb-3 rounded-2xl px-4 py-3 flex items-center justify-between"
              style={{ background:C.l2, border:`1px solid ${C.border}` }}>
              <div>
                <p className="text-xs" style={{ color:C.t3 }}>Стоимость</p>
                <p className="text-lg font-black" style={{ color:GIFT_RARITY_COLOR[selected.rarity] }}>
                  {fmtGiftPrice(selected.price)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs" style={{ color:C.t3 }}>Баланс после</p>
                <p className="text-sm font-bold"
                  style={{ color: balance >= selected.price ? C.green : C.red }}>
                  {(balance - selected.price).toLocaleString('ru')} ₽
                </p>
              </div>
            </div>

            {err && (
              <p className="mx-5 mb-3 text-xs text-center" style={{ color:C.red }}>{err}</p>
            )}

            <div className="mx-5 mb-8">
              <motion.button whileTap={{ scale:.97 }} type="button" onClick={buy} disabled={sending || points < selected.pricePoints}
                className="flex items-center justify-center gap-2 w-full rounded-2xl py-4 text-base font-bold text-white"
                style={{
                  background: `linear-gradient(135deg,${GIFT_RARITY_COLOR[selected.rarity]},${GIFT_RARITY_COLOR[selected.rarity]}aa)`,
                  opacity: sending || points < selected.pricePoints ? 0.45 : 1,
                  boxShadow: `0 8px 28px ${GIFT_RARITY_GLOW[selected.rarity]}`,
                }}>
                <Star size={18}/>
                {sending ? 'Отправляем…' : target === 'profile'
                  ? `Сохранить · ⭐${selected.pricePoints.toLocaleString('ru')}`
                  : `Подарить · ⭐${selected.pricePoints.toLocaleString('ru')}`}
              </motion.button>
            </div>
          </div>
        )}

        {/* -- STEP: SUCCESS -- */}
        {step === 'success' && selected && (
          <div className="flex flex-col items-center justify-center gap-5 py-14 px-5">
            <motion.div initial={{ scale:0, rotate:-20 }} animate={{ scale:1, rotate:0 }}
              transition={{ type:'spring', stiffness:300, damping:18 }}
              className="grid h-24 w-24 place-items-center rounded-3xl text-5xl"
              style={{
                background: `linear-gradient(155deg,${selected.gradient[0]},${selected.gradient[1]})`,
                boxShadow:  `0 20px 60px ${GIFT_RARITY_GLOW[selected.rarity]}`,
              }}>
              {selected.emoji}
            </motion.div>
            <motion.div initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} transition={{ delay:.25 }}
              className="text-center">
              <p className="text-xl font-black text-white">Подарок отправлен! 🎉</p>
              <p className="text-sm mt-1.5" style={{ color:C.t2 }}>
                «{selected.name}» отправлен для {toName}
              </p>
            </motion.div>
          </div>
        )}
      </motion.div>
    </motion.div>
    </>
  );
};

/** «2ч 14м» до конца окна отмены — пересчитывается раз в минуту, не чаще. */
const useCountdown = (deadline?: string) => {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => tick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
};

/* -- Gift Bubble (in chat message) ---------------------------- */
export const GiftBubble = ({ gift, fromMe, onCancelled }: {
  gift: SentGift; fromMe: boolean; onCancelled?: (updated: SentGift) => void;
}) => {
  const rc = GIFT_RARITY_COLOR[gift.giftRarity];
  const rg = GIFT_RARITY_GLOW[gift.giftRarity] ?? 'rgba(79,110,247,0.3)';
  const grad0 = gift.giftGrad?.[0] ?? '#262b3a';
  const grad1 = gift.giftGrad?.[1] ?? '#141824';
  const isEpic = ['epic','legendary','unique'].includes(gift.giftRarity);
  const [hovered, setHovered] = useState(false);
  const isMobile = useIsMobile();
  const isCancelled = gift.status === 'cancelled';
  const timeLeft = useCountdown(isCancelled ? undefined : gift.cancelDeadline);
  const canCancel = fromMe && !isCancelled && Boolean(onCancelled) && Boolean(timeLeft);
  const [cancelling, setCancelling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const mediaUrl = giftMediaUrl(gift.mediaId);
  const isVideo = gift.mediaKind === 'video' && Boolean(mediaUrl);

  const handleCancel = async () => {
    setCancelling(true);
    const r = await apiCancelGift(gift.id);
    setCancelling(false);
    setConfirming(false);
    if (r.ok && r.instance) onCancelled?.(toSentGift(r.instance));
  };

  return (
    <motion.div initial={{ scale:.75, opacity:0, y:20 }} animate={{ scale:1, opacity:1, y:0 }}
      transition={{ type:'spring', stiffness:350, damping:20 }}
      className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>

      {/* 3D perspective container */}
      <div style={{ perspective: 600 }}
        onMouseEnter={() => { if (!isMobile) setHovered(true); }} onMouseLeave={() => { if (!isMobile) setHovered(false); }}>
        <motion.div
          animate={{ 
            rotateY: hovered ? 15 : 0, 
            rotateX: hovered ? -8 : 0, 
            scale: hovered ? 1.06 : 1,
            y: hovered ? -4 : 0,
          }}
          transition={{ type:'spring', stiffness:280, damping:22 }}
          className="relative overflow-hidden text-center"
          data-keep-dark=""
          style={{
            background:  `linear-gradient(155deg,${grad0},${grad1})`,
            border:      `2px solid ${rc}55`,
            boxShadow:   hovered ? `0 24px 60px ${rg}, 0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.2)` : `0 12px 40px ${rg}, 0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)`,
            minWidth: 148, maxWidth: 220,
            borderRadius: 28,
            transformStyle: 'preserve-3d',
          }}>

          {/* Glass top shine */}
          <div className="absolute top-0 left-0 right-0 h-1/2 pointer-events-none"
            style={{ background:'linear-gradient(180deg,rgba(255,255,255,0.12),transparent)', borderRadius:'28px 28px 0 0' }}/>

          {/* Side light reflection */}
          <div className="absolute inset-y-0 left-0 w-px pointer-events-none"
            style={{ background:'linear-gradient(180deg,transparent,rgba(255,255,255,0.2),transparent)' }}/>

          {/* Shimmer for epic+ */}
          {isEpic && (
            <div className="absolute inset-0 pointer-events-none"
              style={{
                background:`linear-gradient(90deg,transparent 0%,${rc}18 50%,transparent 100%)`,
                backgroundSize:'200% 100%',
                animation:'_skyShimmerKf 3s linear infinite',
              }}/>
          )}

          {/* Particles */}
          {isEpic && !isCancelled && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {[...Array(6)].map((_,i) => (
                <motion.div key={i} className="absolute rounded-full"
                  style={{ width:3, height:3, background:rc, left:`${15+i*14}%`, top:`${15+Math.sin(i*1.2)*35}%` }}
                  animate={{ opacity:[0,0.9,0], scale:[0,1.8,0], y:[0,-24,0] }}
                  transition={{ duration:2.2, repeat:Infinity, delay:i*0.35, ease:'easeInOut' }}/>
              ))}
            </div>
          )}

          {isCancelled && (
            <div className="absolute inset-0 z-10 pointer-events-none"
              style={{ background:'rgba(10,10,14,0.55)', filter:'saturate(0.4)' }}/>
          )}

          <div className="px-5 pt-5 pb-4 relative" style={{ opacity: isCancelled ? 0.75 : 1 }}>
            {/* Видео-подарок анимируется само по себе — эмодзи-обёртка ему не нужна */}
            {isVideo ? (
              <div className="mx-auto mb-2 overflow-hidden rounded-2xl" style={{ width: 128, height: 128 }}>
                <StoryVideo src={mediaUrl ?? undefined} autoPlay loop muted
                  className="h-full w-full object-cover" />
              </div>
            ) : (
              <div style={{ transform:'translateZ(20px)', display:'inline-block', marginBottom:8 }}>
                <motion.div style={{ fontSize:52, lineHeight:1, display:'block', textAlign:'center',
                  filter:`drop-shadow(0 8px 16px ${rc}60)` }}
                  animate={isCancelled ? undefined : { y:[0,-10,0], scale:[1,1.15,1], rotate:[0, hovered?5:2, 0] }}
                  transition={{ duration:1.8, repeat:Infinity, ease:'easeInOut' }}>
                  {gift.giftEmoji}
                </motion.div>
              </div>
            )}

            {isCancelled && (
              <span className="mb-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-bold"
                style={{ background:'rgba(248,113,113,0.18)', color:'#fca5a5' }}>
                <Ban size={10}/> Отменён
              </span>
            )}

            {/* Rarity stars */}
            <div className="flex justify-center gap-0.5 mb-1.5">
              {({ common:1, rare:2, epic:3, legendary:4, unique:5 }[gift.giftRarity] ?? 1) > 0 &&
                [...Array({ common:1, rare:2, epic:3, legendary:4, unique:5 }[gift.giftRarity] ?? 1)].map((_,i) => (
                  <motion.span key={i} style={{ fontSize:10, color:rc }}
                    animate={{ opacity:[0.6,1,0.6] }}
                    transition={{ duration:1.5, delay:i*0.2, repeat:Infinity }}>✦</motion.span>
                ))
              }
            </div>

            {/* Gift name */}
            <p className="text-sm font-black text-white leading-tight">{gift.giftName}</p>

            {/* Rarity label */}
            <span className="inline-block mt-1.5 text-[9px] font-bold px-2.5 py-0.5 rounded-full"
              style={{ background:`${rc}20`, color:rc, border:`1px solid ${rc}35` }}>
              {GIFT_RARITY_LABEL[gift.giftRarity]}
            </span>

            {/* Message */}
            {gift.message && (
              <p className="mt-2 text-[11px] leading-relaxed px-1"
                style={{ color:'rgba(255,255,255,0.6)' }}>
                «{gift.message}»
              </p>
            )}

            {/* From/To */}
            <div className="mt-3 pt-2.5 flex items-center justify-center gap-1.5"
              style={{ borderTop:`1px solid ${rc}25` }}>
              <Heart size={10} style={{ color:rc }} fill={rc}/>
              <span className="text-[10px] font-medium" style={{ color:'rgba(255,255,255,0.5)' }}>
                {fromMe ? `для ${gift.toName}` : `от ${gift.fromName}`}
              </span>
            </div>

            {canCancel && (
              <div className="mt-2.5">
                {confirming ? (
                  <div className="flex items-center justify-center gap-1.5">
                    <button type="button" disabled={cancelling} onClick={handleCancel}
                      className="rounded-full px-3 py-1 text-[10px] font-bold"
                      style={{ background:'rgba(248,113,113,0.25)', color:'#fca5a5' }}>
                      {cancelling ? 'Отменяем…' : 'Точно отменить?'}
                    </button>
                    <button type="button" onClick={() => setConfirming(false)}
                      className="rounded-full px-3 py-1 text-[10px] font-semibold"
                      style={{ background:'rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.6)' }}>
                      Нет
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirming(true)}
                    className="mx-auto flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-semibold"
                    style={{ background:'rgba(255,255,255,0.06)', color:'rgba(255,255,255,0.55)' }}>
                    <Clock3 size={10}/> Отменить · ещё {timeLeft}
                  </button>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};


/* === PROFILE GIFTS SHOWCASE ====================================
   Красивая витрина подарков в профиле
=============================================================== */
export const ProfileGiftsShowcase = ({ userId, isOwn }: { userId: string; isOwn: boolean }) => {
  const [tab, setTab] = useState<'profile'|'received'>('profile');
  const [profileGifts,  setProfileGifts]  = useState<SentGift[]>([]);
  const [receivedGifts, setReceivedGifts] = useState<SentGift[]>([]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    if (isOwn) {
      Promise.all([apiMyProfileGifts(), apiMyReceivedGifts()]).then(([p, r]) => {
        if (!alive) return;
        setProfileGifts(p.map(toSentGift));
        setReceivedGifts(r.map(toSentGift));
      });
    } else {
      // Чужой профиль: видно только то, что человек сам сохранил и
      // разрешил показывать (showGifts) — «получено, но не сохранено»
      // не публично никогда, это не квирк экрана, а серверная приватность.
      apiPublicProfileGifts(userId).then((res) => {
        if (!alive) return;
        setHidden(res.hidden);
        setProfileGifts(res.items.map(toSentGift));
        setReceivedGifts([]);
      });
    }
    return () => { alive = false; };
  }, [userId, isOwn]);

  const list = tab === 'profile' ? profileGifts : receivedGifts;

  if (!isOwn && hidden) return (
    <div className="flex flex-col items-center gap-3 py-10">
      <span className="text-4xl">🔒</span>
      <p className="text-sm font-semibold" style={{ color:C.t2 }}>Подарки скрыты настройками приватности</p>
    </div>
  );

  if (profileGifts.length === 0 && receivedGifts.length === 0) return (
    <div className="flex flex-col items-center gap-3 py-10">
      <span className="text-4xl">🎁</span>
      <p className="text-sm font-semibold" style={{ color:C.t2 }}>
        {isOwn ? 'У вас пока нет подарков' : 'Нет подарков'}
      </p>
      {isOwn && (
        <p className="text-xs text-center leading-relaxed px-8" style={{ color:C.t3 }}>
          Отправьте подарок себе из чата или купите в маркете подарков за Баллы Прайма
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex gap-2">
        {([
          { key: 'profile'  as const, label: `⭐ В профиле (${profileGifts.length})`  },
          // «Получено, но не сохранено» — приватность, показываем только себе.
          ...(isOwn ? [{ key: 'received' as const, label: `💌 Получено (${receivedGifts.length})` }] : []),
        ]).map(({ key, label }) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className="flex-1 py-2 rounded-2xl text-xs font-bold transition-all"
            style={{
              background: tab===key ? `${C.accent}18` : C.l2,
              border:     `1.5px solid ${tab===key ? C.accent+'45' : C.border}`,
              color:      tab===key ? C.accent : C.t3,
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Gift grid */}
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8">
          <span className="text-3xl opacity-50">🎁</span>
          <p className="text-xs" style={{ color:C.t3 }}>Пусто</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          {list.map(g => {
            const rc   = GIFT_RARITY_COLOR[g.giftRarity] ?? C.accent;
            const rg   = GIFT_RARITY_GLOW[g.giftRarity]  ?? 'rgba(79,110,247,0.3)';
            const grad0 = g.giftGrad?.[0] ?? 'var(--bg)';
            const grad1 = g.giftGrad?.[1] ?? 'var(--bg-l2)';
            const gi   = GIFT_CATALOG.find(x => x.id === g.giftId);
            return (
              <motion.div key={g.id}
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.95 }}
                title={`${g.giftName}${g.message ? `  -  «${g.message}»` : ''}`}
                className="relative flex flex-col items-center gap-1.5 rounded-2xl p-2.5 cursor-pointer"
                style={{
                  background: `linear-gradient(155deg,${grad0},${grad1})`,
                  border:     `1.5px solid ${rc}35`,
                  boxShadow:  `0 4px 16px ${rg}`,
                }}>
                {/* Rarity glow ring */}
                <motion.div
                  animate={{ opacity: [0.4, 0.8, 0.4] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute inset-0 rounded-2xl pointer-events-none"
                  style={{ boxShadow: `inset 0 0 8px ${rc}40` }}/>

                {/* Animated emoji */}
                <motion.div
                  className="text-3xl select-none"
                  animate={gi ? {
                    y:     gi.animation === 'float'   ? [0,-5,0]      :
                            gi.animation === 'bounce'  ? [0,-8,0,-4,0] :
                            gi.animation === 'pulse'   ? [0,0,0]       : [0,-3,0],
                    scale: gi.animation === 'pulse'   ? [1,1.12,1]    :
                            gi.animation === 'sparkle' ? [1,1.08,1,1.05,1] : 1,
                    rotate: gi.animation === 'spin'   ? [0,360]        : 0,
                  } : { y: [0,-4,0] }}
                  transition={{
                    duration: gi?.animation === 'spin' ? 3 :
                               gi?.animation === 'bounce' ? 1.2 : 2,
                    repeat: Infinity, ease: 'easeInOut',
                  }}>
                  {g.giftEmoji}
                </motion.div>

                {/* Name */}
                <p className="text-[9px] font-bold text-white text-center leading-tight truncate w-full px-0.5">
                  {g.giftName}
                </p>

                {/* Rarity dot */}
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: rc }}/>

                {/* Message indicator */}
                {g.message && (
                  <div className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full text-[8px]"
                    style={{ background: C.accent }}>
                    💬
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* From label for received */}
      {tab === 'received' && list.length > 0 && (
        <div className="space-y-1 pt-1">
          {list.slice(0, 5).map(g => (
            <div key={g.id} className="flex items-center gap-2 px-1">
              <span className="text-base">{g.giftEmoji}</span>
              <span className="text-xs flex-1" style={{ color:C.t3 }}>
                <span style={{ color:C.t2 }}>{g.giftName}</span>
                {' от '}
                <span style={{ color:C.accent }}>{g.fromName}</span>
                {g.message && <span style={{ color:C.t3 }}> · «{g.message}»</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* -- My Gifts collection --------------------------------------- */
type ArchivedGift = SentGift & { _dir: 'received' | 'sent' };

export const MyGifts = ({ userId }: { userId: string }) => {
  const [tab, setTab] = useState<'received'|'sent'|'archived'>('received');
  const [received, setReceived] = useState<SentGift[]>([]);
  const [sent,     setSent]     = useState<SentGift[]>([]);
  const [archived, setArchived] = useState<ArchivedGift[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadActive = () => {
    Promise.all([apiMyReceivedGifts(), apiMySentGifts()]).then(([r, s]) => {
      setReceived(r.map(toSentGift));
      setSent(s.map(toSentGift));
    });
  };
  const loadArchived = () => {
    Promise.all([apiMyReceivedGiftsArchived(), apiMySentGiftsArchived()]).then(([r, s]) => {
      setArchived([
        ...r.map(g => ({ ...toSentGift(g), _dir: 'received' as const })),
        ...s.map(g => ({ ...toSentGift(g), _dir: 'sent' as const })),
      ].sort((a, b) => b.sentAt.localeCompare(a.sentAt)));
    });
  };

  useEffect(() => {
    let alive = true;
    Promise.all([apiMyReceivedGifts(), apiMySentGifts()]).then(([r, s]) => {
      if (!alive) return;
      setReceived(r.map(toSentGift));
      setSent(s.map(toSentGift));
    });
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    if (tab === 'archived') loadArchived();
  }, [tab, userId]);

  const list: (SentGift | ArchivedGift)[] = tab === 'received' ? received : tab === 'sent' ? sent : archived;

  const toggleProfile = async (g: SentGift) => {
    const on = !g.savedToProfile;
    setBusy(g.id);
    const r = await apiSaveGiftToProfile(g.id, on);
    setBusy(null);
    if (r.ok) setReceived(prev => prev.map(x => (x.id === g.id ? { ...x, savedToProfile: on } : x)));
  };

  const toggleArchive = async (g: SentGift, on: boolean) => {
    setBusy(g.id);
    const r = await apiArchiveGift(g.id, on);
    setBusy(null);
    if (!r.ok) return;
    if (on) {
      // Ушёл в архив — убираем из активного списка своей стороны.
      setReceived(prev => prev.filter(x => x.id !== g.id));
      setSent(prev => prev.filter(x => x.id !== g.id));
      if (tab === 'archived') loadArchived();
    } else {
      // Восстановлен — убираем из архива, обновляем активные списки.
      setArchived(prev => prev.filter(x => x.id !== g.id));
      loadActive();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex gap-2 px-4 pt-3 pb-2 shrink-0">
        {(['received','sent','archived'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className="flex-1 py-2.5 rounded-2xl text-xs font-bold transition-all"
            style={{
              background: tab===t ? `${C.accent}18` : C.l2,
              border:     `1.5px solid ${tab===t ? C.accent+'45' : C.border}`,
              color:      tab===t ? C.accent : C.t3,
            }}>
            {t === 'received' ? `Получено (${received.length})`
              : t === 'sent' ? `Отправлено (${sent.length})`
              : 'Архив'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth:'none' }}>
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14">
            <span className="text-5xl">{tab === 'archived' ? '🗂️' : '🎁'}</span>
            <p className="text-sm" style={{ color:C.t2 }}>
              {tab === 'received' ? 'Нет полученных подарков'
                : tab === 'sent' ? 'Нет отправленных подарков'
                : 'В архиве пусто'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 pt-2">
            {list.map(g => {
              const rc = GIFT_RARITY_COLOR[g.giftRarity] ?? 'var(--accent)';
              const rg = GIFT_RARITY_GLOW[g.giftRarity] ?? 'rgba(79,110,247,0.3)';
              const gi = GIFT_CATALOG.find(x => x.id === g.giftId);
              const grad0 = g.giftGrad?.[0] ?? 'var(--bg)';
              const grad1 = g.giftGrad?.[1] ?? 'var(--bg-l2)';
              const dir = tab === 'archived' ? (g as ArchivedGift)._dir : tab;
              return (
                <div key={`${dir}-${g.id}`} className="relative flex flex-col items-center gap-1.5 rounded-2xl p-3"
                  style={{
                    background: `linear-gradient(155deg,${grad0},${grad1})`,
                    border:     `1px solid ${rc}35`,
                    boxShadow:  `0 4px 16px ${rg}`,
                    opacity: g.status === 'cancelled' ? 0.55 : 1,
                  }}>
                  <button type="button" disabled={busy === g.id}
                    onClick={() => toggleArchive(g, tab !== 'archived')}
                    title={tab === 'archived' ? 'Вернуть из архива' : 'В архив'}
                    className="absolute top-1.5 right-1.5 p-1 rounded-full"
                    style={{ background: 'rgba(0,0,0,0.35)', color: 'rgba(255,255,255,0.7)' }}>
                    {tab === 'archived' ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                  </button>
                  {dir === 'received' && g.status !== 'cancelled' && (
                    <button type="button" disabled={busy === g.id} onClick={() => toggleProfile(g)}
                      title={g.savedToProfile ? 'Скрыть из профиля' : 'Показать в профиле'}
                      className="absolute top-1.5 left-1.5 p-1 rounded-full"
                      style={{ background: 'rgba(0,0,0,0.35)', color: g.savedToProfile ? '#86efac' : 'rgba(255,255,255,0.7)' }}>
                      {g.savedToProfile ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                  )}
                  <motion.div className="text-3xl select-none"
                    animate={undefined}>
                    {g.giftEmoji}
                  </motion.div>
                  <p className="text-[10px] font-bold text-white text-center">{g.giftName}</p>
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background:`${rc}25`, color:rc }}>
                    {GIFT_RARITY_LABEL[g.giftRarity]}
                  </span>
                  <p className="text-[9px] text-center" style={{ color:'rgba(255,255,255,0.4)' }}>
                    {dir==='received' ? `от ${g.fromName}` : `для ${g.toName}`}
                  </p>
                  {g.status === 'cancelled' && (
                    <span className="text-[8px] font-bold" style={{ color: '#fca5a5' }}>Отменён</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
