/* ======================================================================
   SKY GIFTS NFT  —  Карточка подарка (полный экран)
====================================================================== */
import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform, useSpring } from 'framer-motion';
import {
  Gift as GiftIcon, Send, Tag, ShoppingBag, Heart, Share2, Eye, ThumbsUp,
  Sparkles, TrendingUp, TrendingDown, Clock, User, Crown,
  ArrowRightLeft, MessageCircle, Check, Trash2, Archive, AlertTriangle,
} from 'lucide-react';
import { C, fmt } from '@/marketplace/SkyMarket';
import { useAuthStore } from '@/core/auth/store';
import { useNftGiftsStore } from './nftStore';
import { GiftBackground } from './backgrounds';
import { GiftModel } from './models';
import { GlassCard, GiftSlide, Pill, InteractiveLineChart, ScoreRing } from './shared';
import { RARITY_CONFIG } from './types';
import type { ReactionEmoji } from './types';

const PROVENANCE_ICON: Record<string, any> = { minted: Sparkles, sale: ShoppingBag, gift: GiftIcon, transfer: ArrowRightLeft };
const PROVENANCE_LABEL: Record<string, string> = { minted: 'Выпущен', sale: 'Продан', gift: 'Подарен', transfer: 'Передан' };

const RATING_LABEL: Record<string,string> = { low:'Низкий потенциал', medium:'Средний потенциал', high:'Высокий потенциал', premium:'Премиальный актив' };
const RATING_COLOR: Record<string,string> = { low:C.t3, medium:C.amber, high:C.acc, premium:C.green };

export const GiftDetail = ({ giftId, onClose, onTrade, onOpenProfile }: {
  giftId: string; onClose: () => void;
  onTrade: (action: 'buy'|'sell'|'gift', giftId: string) => void;
  onOpenProfile: (userId: string) => void;
}) => {
  const account = useAuthStore(s => s.accounts.find(a => a.id === s.currentUserId));
  const {
    giftById, collectionById, isFavorite, toggleFavorite, valuationFor, provenanceFor,
    commentsFor, addComment, reactionFor, toggleReaction, listingFor,
    canSellFor, isArchived, toggleArchive, deleteGift, syncProvenance,
  } = useNftGiftsStore();
  const gift = giftById(giftId);
  const [commentText, setCommentText] = useState('');
  const [shared, setShared] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const heroRef = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(my, [0,1], [12,-12]), { stiffness:120, damping:14 });
  const rotateY = useSpring(useTransform(mx, [0,1], [-12,12]), { stiffness:120, damping:14 });

  useEffect(() => {
    const handler = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      mx.set(Math.max(0, Math.min(1, 0.5 + e.gamma/90)));
      my.set(Math.max(0, Math.min(1, 0.5 + e.beta/180)));
    };
    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, [mx, my]);

  // Настоящая история с сервера — локальный provenance помнит только
  // то, что произошло в этом же браузере.
  useEffect(() => { void syncProvenance(giftId); }, [giftId, syncProvenance]);

  if (!gift) return null;
  const rc = RARITY_CONFIG[gift.rarity];
  const col = collectionById(gift.collectionId);
  const fav = isFavorite(gift.id);
  const valuation = valuationFor(gift.id);
  const provenance = provenanceFor(gift.id);
  const comments = commentsFor(gift.id);
  const isOwner = account?.id === gift.ownerId;
  const listing = listingFor(gift.id);
  const priceChange = gift.priceHistory.length>1 ? gift.price - gift.priceHistory[gift.priceHistory.length-2].price : 0;
  const priceChangePct = gift.priceHistory.length>1 ? Math.round((priceChange/Math.max(1,gift.priceHistory[gift.priceHistory.length-2].price))*100) : 0;

  const REACTIONS: ReactionEmoji[] = ['🔥','😍','👏','💎','🚀'];

  const share = async () => {
    const text = `${gift.name} · ${col?.name} · ${rc.label} · #${gift.edition}`;
    try {
      if (navigator.share) await navigator.share({ title: gift.name, text });
      else await navigator.clipboard.writeText(text);
      setShared(true); setTimeout(()=>setShared(false), 1800);
    } catch {}
  };

  return (
    <GiftSlide open onClose={onClose} title={gift.name}>
      <motion.div initial={{ opacity:0, scale:0.94 }} animate={{ opacity:1, scale:1 }} transition={{ duration:0.35, ease:'easeOut' }}>
        {/* Hero */}
        <div className="px-5 pt-3">
          <div ref={heroRef}
            onMouseMove={e => { const r = heroRef.current?.getBoundingClientRect(); if(!r) return; mx.set((e.clientX-r.left)/r.width); my.set((e.clientY-r.top)/r.height); }}
            onMouseLeave={() => { mx.set(0.5); my.set(0.5); }}
            style={{ perspective: 1000 }}>
            <motion.div style={{ rotateX, rotateY, transformStyle:'preserve-3d', height: 360, borderRadius: 28 }}
              className="relative overflow-hidden" animate={{ boxShadow:`0 24px 70px rgba(0,0,0,0.55), 0 0 60px ${rc.glow}` }}>
              <div className="absolute inset-0 rounded-[28px] z-10 pointer-events-none" style={{ border:`2px solid ${rc.color}66` }}/>
              <GiftBackground theme={gift.background} rarity={gift.rarity} className="rounded-[28px]"/>
              <GiftModel seed={gift.id} rarity={gift.rarity} size={190}/>
              <div className="absolute top-3 left-3"><Pill label={`#${gift.edition} / ${gift.totalEdition}`} color="#ffffff"/></div>
              <div className="absolute top-3 right-3"><Pill label={rc.label} color={rc.color}/></div>
            </motion.div>
          </div>
        </div>

        {/* Заголовок и атрибуты */}
        <div className="px-5 mt-4">
          <p className="text-xl font-black" style={{ color: C.t1 }}>{gift.name}</p>
          <button type="button" onClick={() => col && onOpenProfile(col.authorId)} className="text-xs mt-1" style={{ color: C.acc }}>{col?.name}</button>
          <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px]" style={{ color: C.t3 }}>
            <span className="flex items-center gap-1"><Eye size={11}/> {gift.views.toLocaleString('ru-RU')}</span>
            <span className="flex items-center gap-1"><ThumbsUp size={11}/> {gift.likes.toLocaleString('ru-RU')}</span>
            <span className="flex items-center gap-1"><Clock size={11}/> {new Date(gift.releasedAt).toLocaleDateString('ru-RU')}</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 mt-4">
            <GlassCard className="p-3">
              <p className="text-[10px] flex items-center gap-1" style={{ color: C.t3 }}><User size={10}/> Автор</p>
              <p className="text-xs font-semibold mt-0.5 truncate" style={{ color: C.t1 }}>{gift.authorName}</p>
            </GlassCard>
            <button type="button" onClick={() => onOpenProfile(gift.ownerId)} className="text-left">
              <GlassCard className="p-3">
                <p className="text-[10px] flex items-center gap-1" style={{ color: C.t3 }}><Crown size={10}/> Владелец</p>
                <p className="text-xs font-semibold mt-0.5 truncate" style={{ color: C.acc }}>{gift.ownerName}</p>
              </GlassCard>
            </button>
          </div>

          <GlassCard className="p-4 mt-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px]" style={{ color: C.t3 }}>Текущая стоимость</p>
                <p className="text-2xl font-black mt-0.5" style={{ color: C.t1 }}>{fmt(gift.price)}</p>
              </div>
              {priceChangePct !== 0 && (
                <span className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full" style={{ background: priceChange>0?'rgba(0,220,90,0.12)':'rgba(244,63,94,0.12)', color: priceChange>0?C.green:C.red }}>
                  {priceChange>0?<TrendingUp size={12}/>:<TrendingDown size={12}/>}{priceChangePct>0?'+':''}{priceChangePct}%
                </span>
              )}
            </div>
            <div className="mt-3"><InteractiveLineChart data={gift.priceHistory.map(p=>({x:new Date(p.at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}),y:p.price}))} label="Цена" format={v=>fmt(v)} color={rc.color}/></div>
          </GlassCard>

          {/* Действия */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <button type="button" onClick={() => onTrade('gift', gift.id)} className="flex items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-bold text-white" style={{ background: C.acc }}><Send size={14}/> Подарить</button>
            {isOwner ? (
              canSellFor(gift.id) ? (
                <button type="button" onClick={() => onTrade('sell', gift.id)} className="flex items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-bold" style={{ background: C.l2, color: C.t1 }}><Tag size={14}/> Продать</button>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="flex items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-bold" style={{ background: 'rgba(244,63,94,0.12)', color: '#f43f5e' }}><Trash2 size={14}/> Удалить</button>
              )
            ) : (
              <button type="button" disabled={!listing && gift.ownerId !== 'sky-mint'} onClick={() => onTrade('buy', gift.id)} className="flex items-center justify-center gap-1.5 rounded-xl py-3 text-xs font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t1 }}><ShoppingBag size={14}/> {listing ? 'Купить' : 'Не продаётся'}</button>
            )}
          </div>
          {isOwner && !canSellFor(gift.id) && (
            <p className="mt-1.5 text-[10.5px]" style={{ color: C.t3 }}>
              Неделя на продажу истекла — теперь подарок можно только удалить или скрыть в архив
            </p>
          )}
          {isOwner && (
            <button type="button" onClick={() => toggleArchive(gift.id)}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold"
              style={{ background: isArchived(gift.id) ? 'rgba(59,130,246,0.12)' : C.l2, color: isArchived(gift.id) ? '#3b82f6' : C.t2 }}>
              <Archive size={13}/> {isArchived(gift.id) ? 'Вернуть из архива' : 'Скрыть в архив'}
            </button>
          )}
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button type="button" onClick={() => toggleFavorite(gift.id)} className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: fav?'rgba(244,63,94,0.12)':C.l2, color: fav?'#f43f5e':C.t2 }}>
              <Heart size={13} fill={fav?'#f43f5e':'none'}/> {fav?'В избранном':'В избранное'}
            </button>
            <button type="button" onClick={share} className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>
              {shared ? <Check size={13} style={{ color:C.green }}/> : <Share2 size={13}/>} {shared?'Скопировано':'Поделиться'}
            </button>
          </div>
        </div>

        {/* AI-оценка */}
        <div className="px-5 mt-4">
          <GlassCard className="p-4" glow="rgba(79,110,247,0.15)">
            <div className="flex items-center gap-3 mb-3">
              <ScoreRing score={valuation.saleProbabilityPct} color={RATING_COLOR[valuation.investmentRating]} size={64}/>
              <div className="flex-1">
                <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: C.t1 }}><Sparkles size={13} style={{ color: C.acc }}/> AI-оценка стоимости</p>
                <p className="text-[11px] mt-0.5" style={{ color: RATING_COLOR[valuation.investmentRating] }}>{RATING_LABEL[valuation.investmentRating]}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px]" style={{ color: C.t3 }}>Рекомендуемая цена</p>
                <p className="text-sm font-black" style={{ color: C.t1 }}>{fmt(valuation.recommendedPrice)}</p>
              </div>
            </div>
            <div className="space-y-1">{valuation.reasoning.map((r,i) => <p key={i} className="text-[11px]" style={{ color: C.t2 }}>• {r}</p>)}</div>
          </GlassCard>
        </div>

        {/* История переходов (timeline) */}
        <div className="px-5 mt-4">
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.t3 }}>История</p>
          <div className="relative pl-5">
            <div className="absolute left-[7px] top-1 bottom-1 w-px" style={{ background: C.brd }}/>
            <div className="space-y-3">
              {provenance.map(p => {
                const Icon = PROVENANCE_ICON[p.type];
                return (
                  <div key={p.id} className="relative">
                    <span className="absolute -left-5 top-0.5 grid h-4 w-4 place-items-center rounded-full" style={{ background: rc.color }}><Icon size={9} color="#000"/></span>
                    <p className="text-xs font-semibold" style={{ color: C.t1 }}>{PROVENANCE_LABEL[p.type]}{p.fromName!=='—' && p.type!=='minted' ? ` · ${p.fromName} → ${p.toName}` : ` · ${p.toName}`}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: C.t3 }}>{p.price ? fmt(p.price)+' · ' : ''}{new Date(p.at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'})}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Реакции и комментарии */}
        <div className="px-5 mt-4 mb-6">
          <div className="flex gap-1.5 mb-3">
            {REACTIONS.map(e => {
              const r = reactionFor(gift.id);
              const count = r?.emoji===e ? r.userIds.length : 0;
              const active = r?.emoji===e && account ? r.userIds.includes(account.id) : false;
              return (
                <button key={e} type="button" onClick={() => toggleReaction(gift.id, e)}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs" style={{ background: active?C.accBg:C.l2 }}>
                  {e} {count>0 && <span style={{ color: C.t3 }}>{count}</span>}
                </button>
              );
            })}
          </div>
          <p className="text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: C.t3 }}><MessageCircle size={12}/> Комментарии ({comments.length})</p>
          <div className="space-y-2 mb-3">
            {comments.map(c => (
              <div key={c.id} className="rounded-xl p-2.5" style={{ background: C.l1, border:`1px solid ${C.brd}` }}>
                <p className="text-[11px] font-bold" style={{ color: C.t1 }}>{c.authorName}</p>
                <p className="text-xs mt-0.5" style={{ color: C.t2 }}>{c.text}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Написать комментарий..."
              className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={{ background: C.l2, border:`1px solid ${C.brd}`, color: C.t1 }}/>
            <button type="button" onClick={() => { addComment(gift.id, commentText); setCommentText(''); }} className="rounded-xl px-3 py-2 text-xs font-bold text-white" style={{ background: C.acc }}>OK</button>
          </div>
        </div>
      </motion.div>

      {confirmDelete && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-5" style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setConfirmDelete(false)}>
          <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl p-5" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle size={20} color="#f43f5e"/>
              <p className="text-sm font-bold" style={{ color: C.t1 }}>Удалить подарок навсегда?</p>
            </div>
            <p className="mb-4 text-xs" style={{ color: C.t3 }}>
              Подарок «{gift.name}» будет удалён безвозвратно вместе со всей историей владения. Восстановить его будет невозможно.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)}
                className="rounded-xl py-2.5 text-xs font-bold" style={{ background: C.l2, color: C.t2 }}>Отмена</button>
              <button type="button" onClick={() => { deleteGift(gift.id); setConfirmDelete(false); onClose(); }}
                className="rounded-xl py-2.5 text-xs font-bold text-white" style={{ background: '#f43f5e' }}>Удалить навсегда</button>
            </div>
          </motion.div>
        </div>
      )}
    </GiftSlide>
  );
};
