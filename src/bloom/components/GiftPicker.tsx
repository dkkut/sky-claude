import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { BLOOM_GIFT_CATALOG } from '../store';
import { GiftBadge } from '@/gifts/models';
import { useMoney } from '@/wallet/store';
import { useAuthStore } from '@/core/auth/store';

export const GiftPicker = ({ onPick, onClose }: { onPick: (modelKey: string) => void; onClose: () => void }) => {
  const currentUserId = useAuthStore(s => s.currentUserId);
  const points = useMoney(s => currentUserId ? (s.points[currentUserId] ?? 0) : 0);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ duration: 0.15 }}
        className="absolute bottom-full right-0 z-30 mb-2 w-64 rounded-2xl p-3"
        style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', boxShadow: '0 12px 32px rgba(0,0,0,0.35)' }}>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] font-bold" style={{ color: 'var(--t1)' }}>Подарить</p>
          <span className="text-[10.5px] font-semibold" style={{ color: 'var(--amber)' }}>{points.toLocaleString('ru')} баллов</span>
          <button type="button" onClick={onClose}><X size={13} style={{ color: 'var(--t3)' }}/></button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {BLOOM_GIFT_CATALOG.map(g => {
            const affordable = points >= g.cost;
            return (
              <motion.button key={g.modelKey} type="button" disabled={!affordable}
                whileTap={affordable ? { scale: 0.9 } : undefined} whileHover={affordable ? { scale: 1.06 } : undefined}
                onClick={() => affordable && onPick(g.modelKey)}
                className="flex flex-col items-center gap-1 rounded-xl p-1.5 disabled:opacity-35"
                style={{ background: 'var(--bg-l2)' }}>
                <GiftBadge modelKey={g.modelKey} rarity={g.rarity} size={34}/>
                <span className="truncate text-[9px]" style={{ color: 'var(--t3)' }}>{g.label}</span>
                <span className="text-[8.5px] font-bold" style={{ color: affordable ? 'var(--amber)' : 'var(--t3)' }}>{g.cost}</span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
