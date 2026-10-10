/* ======================================================================
   SKY GIFTS NFT  —  Покупка / Продажа / Дарение
====================================================================== */
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShoppingBag, Tag, Send, Check, Gavel, Timer, TrendingDown,
  Search, Sparkles,
} from 'lucide-react';
import { C, fmt } from '@/marketplace/SkyMarket';
import { useAuthStore } from '@/core/auth/store';
import { useNftGiftsStore } from './nftStore';
import { GiftSlide, GlassCard, EmptyState } from './shared';
import type { ListingType } from './types';
import { MINT_ID } from './nftStore';
import { getConfirmSale } from './safety';

/* ── Покупка ──────────────────────────────────────────────────────── */
const BuyFlow = ({ giftId, onDone }: { giftId: string; onDone: () => void }) => {
  const { giftById, listingFor, buyListing, buyFromMint, provenanceFor } = useNftGiftsStore();
  const gift = giftById(giftId);
  const mintSale = gift?.ownerId === MINT_ID;       // подарок ещё не куплен — продаёт платформа
  const listing = mintSale ? null : listingFor(giftId);
  const [confirmed, setConfirmed] = useState(false);
  const [buying, setBuying] = useState(false);
  const [err, setErr] = useState('');
  if (!gift || (!listing && !mintSale)) return <EmptyState icon={ShoppingBag} title="Лот недоступен"/>;

  const price = listing ? (listing.type==='auction' ? (listing.currentBid ?? listing.price) : listing.price) : gift.price;
  const sales = provenanceFor(giftId).filter(p=>p.type==='sale').slice(-5).reverse();

  const confirm = async () => {
    setErr(''); setBuying(true);
    const r = listing ? await buyListing(listing.id) : await buyFromMint(gift.id);
    setBuying(false);
    if (!r.ok) { setErr(r.reason ?? 'Не удалось купить подарок'); return; }
    setConfirmed(true); setTimeout(onDone, 1400);
  };

  if (confirmed) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <motion.div initial={{ scale:0 }} animate={{ scale:1 }} transition={{ type:'spring', damping:12 }} className="grid h-16 w-16 place-items-center rounded-full" style={{ background:'rgba(0,220,90,0.15)' }}>
          <Check size={28} style={{ color: C.green }}/>
        </motion.div>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Покупка совершена!</p>
        <p className="text-xs" style={{ color: C.t3 }}>«{gift.name}» теперь в вашей коллекции</p>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-3">
      <GlassCard className="p-4">
        <div className="flex justify-between text-sm"><span className="font-bold" style={{ color: C.t1 }}>Итого</span><span className="font-black" style={{ color: C.acc }}>{fmt(price)}</span></div>
      </GlassCard>
      {sales.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Последние сделки</p>
          <div className="space-y-1.5">{sales.map(s => (
            <div key={s.id} className="flex justify-between text-[11px]"><span style={{ color: C.t2 }}>{s.fromName} → {s.toName}</span><span style={{ color: C.t1 }}>{fmt(s.price ?? 0)}</span></div>
          ))}</div>
        </div>
      )}
      {err && <p className="text-xs text-center" style={{ color: 'var(--red)' }}>{err}</p>}
      <button type="button" onClick={confirm} disabled={buying} className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: C.acc }}>
        <ShoppingBag size={16}/> {buying ? 'Покупка…' : `Подтвердить покупку за ${fmt(price)}`}
      </button>
    </div>
  );
};

/* ── Продажа ──────────────────────────────────────────────────────── */
const SellFlow = ({ giftId, onDone }: { giftId: string; onDone: () => void }) => {
  const { giftById, createListing, listingFor, cancelListing, offersFor, respondOffer } = useNftGiftsStore();
  const gift = giftById(giftId);
  const existing = listingFor(giftId);
  const offers = offersFor(giftId);
  const [type, setType] = useState<ListingType>('fixed');
  const [price, setPrice] = useState(gift?.price ?? 100);
  const [reservePrice, setReservePrice] = useState(Math.round((gift?.price ?? 100)*1.2));
  const [decayPct, setDecayPct] = useState(5);
  const [decayOn, setDecayOn] = useState(false);
  const [durationH, setDurationH] = useState(72);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [armed, setArmed] = useState(false);          // «защита от случайной продажи»: первое нажатие только просит подтвердить
  const myId = useAuthStore(s => s.currentUserId);

  if (!gift) return null;

  if (existing) {
    const cancel = async () => {
      setErr(''); setBusy(true);
      const r = await cancelListing(existing.id);
      setBusy(false);
      if (!r.ok) setErr(r.reason ?? 'Не удалось снять лот');
    };
    return (
      <div className="p-5 space-y-3">
        <GlassCard className="p-4">
          <p className="text-xs font-bold mb-1" style={{ color: C.t1 }}>Лот уже выставлен</p>
          <p className="text-xs" style={{ color: C.t3 }}>Тип: {existing.type} · Цена: {fmt(existing.price)}</p>
        </GlassCard>
        {err && <p className="text-xs text-center" style={{ color: C.red }}>{err}</p>}
        <button type="button" onClick={cancel} disabled={busy} className="w-full rounded-xl py-2.5 text-xs font-bold disabled:opacity-50" style={{ background: C.l2, color: C.red }}>{busy ? 'Снимаем…' : 'Снять с продажи'}</button>

        {offers.length>0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>Предложения покупателей</p>
            <div className="space-y-2">{offers.map(o => (
              <div key={o.id} className="flex items-center gap-2 rounded-xl p-2.5" style={{ background: C.l1, border:`1px solid ${C.brd}` }}>
                <div className="flex-1"><p className="text-xs font-semibold" style={{ color: C.t1 }}>{o.buyerName}</p><p className="text-[10px]" style={{ color: C.t3 }}>{fmt(o.amount)}</p></div>
                {o.status==='pending' && (
                  <>
                    <button type="button" onClick={() => respondOffer(o.id, true)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-white" style={{ background: C.green }}>Принять</button>
                    <button type="button" onClick={() => respondOffer(o.id, false)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background: C.l2, color: C.red }}>Отклонить</button>
                  </>
                )}
                {o.status!=='pending' && <span className="text-[10px] font-bold" style={{ color: o.status==='accepted'?C.green:C.t3 }}>{o.status==='accepted'?'Принято':'Отклонено'}</span>}
              </div>
            ))}</div>
          </div>
        )}
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <motion.div initial={{ scale:0 }} animate={{ scale:1 }} transition={{ type:'spring', damping:12 }} className="grid h-16 w-16 place-items-center rounded-full" style={{ background:'rgba(0,220,90,0.15)' }}><Check size={28} style={{ color: C.green }}/></motion.div>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Лот опубликован!</p>
      </div>
    );
  }

  const TYPES: { key: ListingType; label: string; icon: any }[] = [
    { key:'fixed', label:'Фикс. цена', icon:Tag }, { key:'auction', label:'Аукцион', icon:Gavel },
    { key:'instant', label:'Мгновенная', icon:Sparkles }, { key:'reserve', label:'Резерв', icon:Timer },
  ];

  return (
    <div className="p-5 space-y-4">
      <div>
        <p className="text-[10px] font-bold mb-2" style={{ color: C.t3 }}>ТИП ПРОДАЖИ</p>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map(t => (
            <button key={t.key} type="button" onClick={() => setType(t.key)} className="flex items-center gap-2 rounded-xl py-2.5 px-3 text-xs font-semibold" style={{ background: type===t.key?C.accBg:C.l2, color: type===t.key?C.acc:C.t3 }}>
              <t.icon size={13}/> {t.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>{type==='auction' ? 'СТАРТОВАЯ ЦЕНА' : 'ЦЕНА'}</p>
        <input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
      </div>
      {type==='reserve' && (
        <div>
          <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>РЕЗЕРВНАЯ ЦЕНА</p>
          <input type="number" value={reservePrice} onChange={e => setReservePrice(Number(e.target.value))} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
        </div>
      )}
      <div>
        <p className="text-[10px] font-bold mb-1" style={{ color: C.t3 }}>СРОК ПУБЛИКАЦИИ</p>
        <div className="flex gap-1.5">
          {[24,72,168,336].map(h => (
            <button key={h} type="button" onClick={() => setDurationH(h)} className="flex-1 rounded-lg py-2 text-[11px] font-semibold" style={{ background: durationH===h?C.accBg:C.l2, color: durationH===h?C.acc:C.t3 }}>{h<168?`${h}ч`:`${Math.round(h/24)}д`}</button>
          ))}
        </div>
      </div>
      {type==='fixed' && (
        <button type="button" onClick={() => setDecayOn(d=>!d)} className="w-full flex items-center justify-between rounded-xl p-3" style={{ background: C.l2 }}>
          <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: C.t1 }}><TrendingDown size={13}/> Автоснижение цены</span>
          <span className="text-xs font-bold" style={{ color: decayOn?C.acc:C.t3 }}>{decayOn?'Включено':'Выключено'}</span>
        </button>
      )}
      {decayOn && type==='fixed' && (
        <div>
          <div className="flex items-center justify-between mb-1"><p className="text-[10px] font-bold" style={{ color: C.t3 }}>СНИЖЕНИЕ В СУТКИ</p><p className="text-[10px] font-bold" style={{ color: C.acc }}>{decayPct}%</p></div>
          <input type="range" min={1} max={20} value={decayPct} onChange={e => setDecayPct(Number(e.target.value))} className="w-full" style={{ accentColor: C.acc }}/>
        </div>
      )}
      {err && <p className="text-xs text-center" style={{ color: C.red }}>{err}</p>}
      <button type="button" disabled={busy} onClick={async () => {
        if (!armed && myId && getConfirmSale(myId)) { setArmed(true); return; }
        setErr(''); setBusy(true);
        const r = await createListing(giftId, { type, price, reservePrice: type==='reserve'?reservePrice:undefined, decayPct: decayOn?decayPct:0, durationH });
        setBusy(false);
        if (!r.ok) { setErr(r.reason ?? 'Не удалось выставить лот'); return; }
        setDone(true); setTimeout(onDone, 1200);
      }} className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-white disabled:opacity-50" style={{ background: C.acc }}>
        <Tag size={16}/> {busy ? 'Публикация…' : armed ? `Подтвердить: выставить за ${fmt(price)}` : 'Опубликовать лот'}
      </button>
    </div>
  );
};

/* ── Подарить ─────────────────────────────────────────────────────── */
const GiftFlow = ({ giftId, onDone }: { giftId: string; onDone: () => void }) => {
  const { giftById, giftToUser } = useNftGiftsStore();
  const { findUsersByUsername } = useAuthStore();
  const gift = giftById(giftId);
  const [q, setQ] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const results = q.trim() ? findUsersByUsername(q.trim()).slice(0,8) : [];
  if (!gift) return null;

  const handleGift = async (toId: string, toName: string) => {
    setErr('');
    setSending(true);
    const r = await giftToUser(giftId, toId, toName);
    setSending(false);
    if (!r.ok) { setErr(r.reason ?? 'Не удалось передать подарок'); return; }
    setSent(true);
    setTimeout(onDone, 1400);
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <motion.div initial={{ scale:0 }} animate={{ scale:1 }} transition={{ type:'spring', damping:12 }} className="grid h-16 w-16 place-items-center rounded-full" style={{ background:'rgba(79,110,247,0.15)' }}><Send size={26} style={{ color: C.acc }}/></motion.div>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Подарок отправлен!</p>
        <p className="text-xs" style={{ color: C.t3 }}>Сообщение с подарком появится в чате</p>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-3">
      <GlassCard className="p-3 flex items-center gap-2"><Sparkles size={14} style={{ color: C.acc }}/><p className="text-xs" style={{ color: C.t2 }}>Подарок появится в чате получателя и сразу перейдёт в его коллекцию</p></GlassCard>
      <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: C.l2 }}>
        <Search size={14} style={{ color: C.t3 }}/>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Введите @username получателя..." className="flex-1 bg-transparent text-xs outline-none" style={{ color: C.t1 }}/>
      </div>
      <div className="space-y-2">
        {results.map(a => (
          <button key={a.id} type="button" disabled={sending} onClick={() => handleGift(a.id, a.name)}
            className="w-full flex items-center gap-3 rounded-xl p-3 disabled:opacity-50" style={{ background: C.l1, border:`1px solid ${C.brd}` }}>
            <span className="grid h-9 w-9 place-items-center rounded-xl text-xs font-bold" style={{ background: C.l2, color: C.t1 }}>{a.name[0]}</span>
            <div className="flex-1 text-left"><p className="text-xs font-semibold" style={{ color: C.t1 }}>{a.name}</p><p className="text-[10px]" style={{ color: C.t3 }}>@{a.username}</p></div>
            <Send size={14} style={{ color: C.acc }}/>
          </button>
        ))}
      </div>
      {err && <p className="text-xs text-center" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════════════════════════ */
export const TradePanel = ({ mode, giftId, onClose }: { mode: 'buy'|'sell'|'gift'|null; giftId: string | null; onClose: () => void }) => {
  const { giftById } = useNftGiftsStore();
  const gift = giftId ? giftById(giftId) : null;
  if (!mode || !giftId || !gift) return null;

  const title = mode==='buy' ? `Покупка · ${gift.name}` : mode==='sell' ? `Продажа · ${gift.name}` : `Подарить · ${gift.name}`;

  return (
    <GiftSlide open onClose={onClose} title={title}>
      {mode==='buy' && <BuyFlow giftId={giftId} onDone={onClose}/>}
      {mode==='sell' && <SellFlow giftId={giftId} onDone={onClose}/>}
      {mode==='gift' && <GiftFlow giftId={giftId} onDone={onClose}/>}
    </GiftSlide>
  );
};
