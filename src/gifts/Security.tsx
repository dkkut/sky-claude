/* ======================================================================
   SKY GIFTS NFT  —  Безопасность
====================================================================== */
import { useState } from 'react';
import { Shield, ShieldCheck, History, Globe, Monitor, AlertTriangle, Lock } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { useAuthStore } from '@/core/auth/store';
import { useNftGiftsStore } from './nftStore';
import { GiftSlide, GlassCard, EmptyState } from './shared';

export const SecurityScreen = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const account = useAuthStore(s => s.accounts.find(a => a.id === s.currentUserId));
  const { actionLog } = useNftGiftsStore();
  const myLog = account ? actionLog.filter(l => l.userId === account.id) : [];
  const [twoStep, setTwoStep] = useState(true);
  const [confirmSale, setConfirmSale] = useState(true);

  return (
    <GiftSlide open={open} onClose={onClose} title="Безопасность">
      <div className="px-5 pt-3 space-y-2.5">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5"><ShieldCheck size={16} style={{ color: C.green }}/><div><p className="text-xs font-bold" style={{ color: C.t1 }}>Двухэтапное подтверждение</p><p className="text-[10px]" style={{ color: C.t3 }}>Для продаж и переводов на крупные суммы</p></div></div>
            <button type="button" onClick={() => setTwoStep(s=>!s)} className="rounded-full px-3 py-1 text-[10px] font-bold" style={{ background: twoStep?'rgba(0,220,90,0.12)':C.l2, color: twoStep?C.green:C.t3 }}>{twoStep?'Вкл':'Выкл'}</button>
          </div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5"><Lock size={16} style={{ color: C.acc }}/><div><p className="text-xs font-bold" style={{ color: C.t1 }}>Защита от случайной продажи</p><p className="text-[10px]" style={{ color: C.t3 }}>Подтверждение перед каждой публикацией лота</p></div></div>
            <button type="button" onClick={() => setConfirmSale(s=>!s)} className="rounded-full px-3 py-1 text-[10px] font-bold" style={{ background: confirmSale?'rgba(0,220,90,0.12)':C.l2, color: confirmSale?C.green:C.t3 }}>{confirmSale?'Вкл':'Выкл'}</button>
          </div>
        </GlassCard>
        <GlassCard className="p-3 flex items-start gap-2.5">
          <AlertTriangle size={14} style={{ color: C.amber }} className="mt-0.5 shrink-0"/>
          <p className="text-[11px]" style={{ color: C.t2 }}>Все продажи, переводы и изменения цены фиксируются в журнале действий и не могут быть отменены задним числом.</p>
        </GlassCard>
      </div>

      <div className="px-5 mt-5 mb-8">
        <p className="text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: C.t3 }}><History size={12}/> Журнал действий</p>
        <div className="space-y-2">
          {myLog.length === 0 ? <EmptyState icon={Shield} title="Действий пока нет"/> : myLog.map(l => (
            <GlassCard key={l.id} className="p-3">
              <p className="text-xs font-semibold" style={{ color: C.t1 }}>{l.description}</p>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="flex items-center gap-1 text-[10px]" style={{ color: C.t3 }}><Globe size={10}/> {l.ip}</span>
                <span className="flex items-center gap-1 text-[10px]" style={{ color: C.t3 }}><Monitor size={10}/> {l.device}</span>
                <span className="text-[10px]" style={{ color: C.t3 }}>{new Date(l.createdAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
              </div>
            </GlassCard>
          ))}
        </div>
      </div>
    </GiftSlide>
  );
};
