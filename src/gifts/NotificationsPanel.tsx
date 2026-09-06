/* ======================================================================
   SKY GIFTS NFT  —  Уведомления
====================================================================== */
import {
  Bell, ShoppingBag, Tag, Gift as GiftIcon, TrendingUp, TrendingDown,
  Gavel, MessageSquare, Sparkles,
} from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { useAuthStore } from '@/core/auth/store';
import { useNftGiftsStore } from './nftStore';
import { GiftSlide, GlassCard, EmptyState } from './shared';
import type { GiftNotificationType } from './types';

const NOTIF_CFG: Record<GiftNotificationType, { icon: any; color: string }> = {
  purchase: { icon: ShoppingBag, color: C.acc }, sale: { icon: Tag, color: C.green },
  gift: { icon: GiftIcon, color: '#e879f9' }, price_up: { icon: TrendingUp, color: C.green },
  price_down: { icon: TrendingDown, color: C.red }, auction_end: { icon: Gavel, color: C.amber },
  offer: { icon: MessageSquare, color: C.acc }, new_collection: { icon: Sparkles, color: '#8b5cf6' },
};

export const NotificationsPanel = ({ open, onClose, onOpenGift }: { open: boolean; onClose: () => void; onOpenGift: (id:string) => void }) => {
  const account = useAuthStore(s => s.accounts.find(a => a.id === s.currentUserId));
  const { notificationsFor, markNotificationRead } = useNftGiftsStore();
  const notifs = account ? notificationsFor(account.id) : [];

  return (
    <GiftSlide open={open} onClose={onClose} title="Уведомления">
      <div className="p-5 space-y-2">
        {notifs.length === 0 ? <EmptyState icon={Bell} title="Уведомлений пока нет" sub="Здесь появятся покупки, продажи, подарки и обновления цен"/> : notifs.map(n => {
          const cfg = NOTIF_CFG[n.type];
          const Icon = cfg.icon;
          return (
            <button key={n.id} type="button" onClick={() => { markNotificationRead(n.id); if (n.giftId) onOpenGift(n.giftId); }} className="w-full text-left">
              <GlassCard className="p-3 flex items-start gap-3" style={{ opacity: n.read?0.6:1 }}>
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background:`${cfg.color}18` }}><Icon size={15} style={{ color: cfg.color }}/></div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold" style={{ color: C.t1 }}>{n.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: C.t2 }}>{n.text}</p>
                  <p className="text-[10px] mt-1" style={{ color: C.t3 }}>{new Date(n.createdAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</p>
                </div>
                {!n.read && <span className="h-2 w-2 rounded-full shrink-0 mt-1" style={{ background: C.acc }}/>}
              </GlassCard>
            </button>
          );
        })}
      </div>
    </GiftSlide>
  );
};
