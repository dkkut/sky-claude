/* ===========================================================
   SKY TV — TVCard
   Крупная карточка контента для горизонтальных каруселей.
=========================================================== */
import { motion } from 'framer-motion';
import { Play, Star } from 'lucide-react';
import { TVFocusable } from './TVFocusable';

interface TVCardProps {
  id: string;
  title: string;
  subtitle?: string;
  imageUrl?: string;
  rating?: number;
  badge?: string;
  progress?: number;      // 0..1 — для «Продолжить просмотр»
  aspect?: 'poster' | 'wide' | 'square';
  onEnter: () => void;
  autoFocusPriority?: number;
}

const ASPECT: Record<NonNullable<TVCardProps['aspect']>, string> = {
  poster: '2 / 3',
  wide:   '16 / 9',
  square: '1 / 1',
};

export const TVCard = ({ id, title, subtitle, imageUrl, rating, badge, progress, aspect = 'poster', onEnter, autoFocusPriority }: TVCardProps) => {
  return (
    <TVFocusable id={id} onEnter={onEnter} autoFocusPriority={autoFocusPriority} className="shrink-0" style={{ width: aspect === 'wide' ? 260 : 168 }}>
      {({ focused }) => (
        <motion.div
          animate={{ scale: focused ? 1.07 : 1 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          style={{ transformOrigin: 'center bottom' }}>
          <div className="relative rounded-xl overflow-hidden"
            style={{
              aspectRatio: ASPECT[aspect],
              background: imageUrl ? `center/cover no-repeat url(${imageUrl})` : 'linear-gradient(160deg,#232330,#101018)',
              boxShadow: focused ? '0 0 0 3px var(--accent), 0 10px 30px rgba(0,0,0,0.55)' : '0 2px 10px rgba(0,0,0,0.35)',
              transition: 'box-shadow 0.16s ease',
            }}>
            {!imageUrl && (
              <div className="absolute inset-0 grid place-items-center">
                <Play size={28} color="rgba(255,255,255,0.25)"/>
              </div>
            )}
            {badge && (
              <span className="absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: 'var(--accent)' }}>
                {badge}
              </span>
            )}
            {rating != null && (
              <span className="absolute top-2 right-2 flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>
                <Star size={10} fill="#ffc93c" color="#ffc93c"/> {rating.toFixed(1)}
              </span>
            )}
            {progress != null && progress > 0 && (
              <div className="absolute bottom-0 inset-x-0 h-[4px] bg-white/20">
                <div className="h-full" style={{ width: `${progress * 100}%`, background: 'var(--accent)' }}/>
              </div>
            )}
            {focused && (
              <div className="absolute inset-0 flex items-end p-2" style={{ background: 'linear-gradient(transparent 40%, rgba(0,0,0,0.75))' }}>
                <Play size={22} color="#fff" fill="#fff"/>
              </div>
            )}
          </div>
          <p className="mt-2 text-[15px] font-bold leading-tight truncate" style={{ color: focused ? 'var(--accent)' : 'var(--t1)' }}>{title}</p>
          {subtitle && <p className="text-[12px] truncate" style={{ color: 'var(--t3)' }}>{subtitle}</p>}
        </motion.div>
      )}
    </TVFocusable>
  );
};
