/* ======================================================================
   SKY GIFTS NFT  —  Карточка подарка
====================================================================== */
import { memo, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform, useSpring } from 'framer-motion';
import { Heart, Sparkles } from 'lucide-react';
import { C, fmt } from '@/marketplace/SkyMarket';
import { GiftBackground } from './backgrounds';
import { GiftModel } from './models';
import { RARITY_CONFIG } from './types';
import type { Gift } from './types';
import { useNftGiftsStore } from './nftStore';
import { useIsMobile } from '@/interface/mobile/useIsMobile';

const SIZE_CFG = {
  sm: { w:128, h:172, name:'text-[11px]', price:'text-[11px]' },
  md: { w:168, h:224, name:'text-xs',     price:'text-xs' },
  lg: { w:260, h:340, name:'text-sm',     price:'text-sm' },
} as const;

export const GiftCard = memo(({ gift, size='md', onClick, showFavorite=true }: { gift: Gift; size?: keyof typeof SIZE_CFG; onClick?: () => void; showFavorite?: boolean }) => {
  const rc = RARITY_CONFIG[gift.rarity];
  const dims = SIZE_CFG[size];
  const ref = useRef<HTMLDivElement>(null);
  const fav = useNftGiftsStore(s => s.favorites.includes(gift.id));
  const toggleFavorite = useNftGiftsStore(s => s.toggleFavorite);

  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(my, [0,1], [10,-10]), { stiffness:180, damping:16 });
  const rotateY = useSpring(useTransform(mx, [0,1], [-10,10]), { stiffness:180, damping:16 });
  const shineX = useTransform(mx, [0,1], ['0%','100%']);
  const [hovering, setHovering] = useState(false);
  const isMobile = useIsMobile();

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile) return;
    const rect = ref.current?.getBoundingClientRect(); if (!rect) return;
    mx.set((e.clientX - rect.left) / rect.width);
    my.set((e.clientY - rect.top) / rect.height);
  };
  const onLeave = () => { if (isMobile) return; mx.set(0.5); my.set(0.5); setHovering(false); };

  const priceChange = gift.priceHistory.length > 1
    ? Math.round(((gift.price - gift.priceHistory[gift.priceHistory.length-2].price) / Math.max(1,gift.priceHistory[gift.priceHistory.length-2].price)) * 100)
    : 0;

  return (
    <div ref={ref} onMouseMove={onMove} onMouseEnter={() => { if (!isMobile) setHovering(true); }} onMouseLeave={onLeave}
      onClick={onClick} className="relative shrink-0 cursor-pointer select-none" style={{ scrollSnapAlign:'start', width:dims.w, perspective:900 }}>
      <motion.div style={{ rotateX, rotateY, transformStyle:'preserve-3d', height: dims.h, borderRadius: 22 }}
        whileTap={{ scale:0.97 }} className="relative overflow-hidden"
        animate={{ boxShadow: hovering ? `0 18px 50px rgba(0,0,0,0.5), 0 0 36px ${rc.glow}` : `0 8px 28px rgba(0,0,0,0.4), 0 0 14px ${rc.glow}` }}>
        <div className="absolute inset-0 rounded-[22px] z-10 pointer-events-none" style={{ border:`1.5px solid ${rc.color}55` }}/>
        <GiftBackground theme={gift.background} rarity={gift.rarity} className="rounded-[22px]" animated={hovering}/>
        <GiftModel seed={gift.id} rarity={gift.rarity} size={dims.w*0.5} animated={hovering}/>

        {/* блик / отражение, следующее за курсором */}
        <motion.div className="absolute inset-y-0 w-1/2 pointer-events-none" style={{ left: shineX, background:'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)', mixBlendMode:'overlay' }}/>

        {/* номер экземпляра */}
        <div className="absolute top-2.5 left-2.5 rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ background:'rgba(0,0,0,0.45)', color:'#fff' }}>
          #{gift.edition}
        </div>
        {gift.hasAnimation && (
          <div className="absolute top-2.5 right-2.5 grid h-5 w-5 place-items-center rounded-full" style={{ background:'rgba(0,0,0,0.45)' }}>
            <Sparkles size={10} style={{ color: rc.color }}/>
          </div>
        )}
        {showFavorite && (
          <button type="button" onClick={e => { e.stopPropagation(); toggleFavorite(gift.id); }}
            className="absolute bottom-2.5 right-2.5 grid h-7 w-7 place-items-center rounded-full" style={{ background:'rgba(0,0,0,0.5)' }}>
            <Heart size={13} fill={fav?'#f43f5e':'none'} style={{ color: fav?'#f43f5e':'#fff' }}/>
          </button>
        )}

        {/* нижняя стеклянная панель */}
        <div className="absolute bottom-0 inset-x-0 px-3 py-2.5" style={{ background:'linear-gradient(0deg, rgba(5,5,10,0.85), rgba(5,5,10,0.35) 70%, transparent)' }}>
          <p className={`font-bold truncate ${dims.name}`} style={{ color:'#fff' }}>{gift.name}</p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:`${rc.color}30`, color: rc.color }}>{rc.label}</span>
            <div className="flex items-center gap-1">
              <span className={`font-black ${dims.price}`} style={{ color:'#fff' }}>{fmt(gift.price)}</span>
              {priceChange !== 0 && <span className="text-[9px] font-bold" style={{ color: priceChange>0?C.green:C.red }}>{priceChange>0?'+':''}{priceChange}%</span>}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
});
GiftCard.displayName = 'GiftCard';
