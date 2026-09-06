/* ======================================================================
   SKY GIFTS NFT  —  Профиль коллекционера
====================================================================== */
import { useMemo } from 'react';
import {
  UserPlus, UserCheck, Wallet, TrendingUp, Award, Activity, Sparkles,
  ChevronRight, Lock,
} from 'lucide-react';
import { C, fmt } from '@/marketplace/SkyMarket';
import { useAuthStore } from '@/core/auth/store';
import { useNftGiftsStore } from './nftStore';
import { GiftBackground } from './backgrounds';
import { GlassCard, KpiTile, HRow, EmptyState } from './shared';
import { GiftCard } from './GiftCard';
import { ACHIEVEMENT_LABELS, RARITY_ORDER } from './types';

export const GiftsProfile = ({ userId, onOpenGift, onOpenShowcase, onBack }: {
  userId: string; onOpenGift: (id: string) => void; onOpenShowcase: () => void; onBack?: () => void;
}) => {
  const account = useAuthStore(s => s.accounts.find(a => a.id === userId));
  const me = useAuthStore(s => s.currentUserId);
  const { gifts, favorites, isFollowing, toggleFollow, followersCount, statsFor, achievementsFor, provenance } = useNftGiftsStore();
  const isOwn = me === userId;

  const owned = useMemo(() => gifts.filter(g => g.ownerId === userId), [gifts, userId]);
  const stats = statsFor(userId);
  const achievements = achievementsFor(userId);
  const unlockedCount = achievements.filter(a=>a.unlocked).length;
  const rarest = useMemo(() => [...owned].sort((a,b)=>RARITY_ORDER.indexOf(b.rarity)-RARITY_ORDER.indexOf(a.rarity)).slice(0,8), [owned]);
  const favGifts = useMemo(() => isOwn ? gifts.filter(g=>favorites.includes(g.id)) : [], [gifts, favorites, isOwn]);
  const activity = useMemo(() => provenance.filter(p=>p.fromId===userId || p.toId===userId).sort((a,b)=>new Date(b.at).getTime()-new Date(a.at).getTime()).slice(0,8), [provenance, userId]);
  const following = isFollowing(userId);

  return (
    <div className="h-full overflow-y-auto pb-10" style={{ scrollbarWidth:'none' }}>
      <div className="relative h-36 overflow-hidden">
        <GiftBackground theme="galaxy" rarity="legendary"/>
        <div className="absolute inset-0" style={{ background:'linear-gradient(180deg, transparent, rgba(5,5,10,0.85))' }}/>
        {onBack && <button type="button" onClick={onBack} className="absolute top-3 left-3 grid h-8 w-8 place-items-center rounded-full" style={{ background:'rgba(0,0,0,0.4)', color:'#fff' }}>‹</button>}
      </div>

      <div className="px-5 -mt-10 flex items-end justify-between">
        <div className="flex items-end gap-3">
          <div className="grid h-20 w-20 place-items-center rounded-3xl text-2xl font-black" style={{ background: C.l1, border:`3px solid ${C.bg}`, color: C.t1 }}>
            {account?.name?.[0] ?? '?'}
          </div>
        </div>
        {!isOwn && (
          <button type="button" onClick={() => toggleFollow(userId, account?.name ?? '')}
            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold mb-1" style={{ background: following?C.l2:C.acc, color: following?C.t2:'#fff' }}>
            {following ? <UserCheck size={13}/> : <UserPlus size={13}/>} {following?'Подписаны':'Подписаться'}
          </button>
        )}
      </div>

      <div className="px-5 mt-2">
        <p className="text-lg font-black" style={{ color: C.t1 }}>{account?.name ?? 'Коллекционер'}</p>
        <p className="text-xs mt-0.5" style={{ color: C.t3 }}>@{account?.username} · {followersCount(userId)} подписчиков</p>
      </div>

      <div className="px-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
        <KpiTile label="Стоимость коллекции" value={fmt(stats.collectionValue)} icon={Wallet} color={C.acc}/>
        <KpiTile label="Прибыль" value={fmt(stats.profit)} icon={TrendingUp} color={stats.profit>=0?C.green:C.red}/>
        <KpiTile label="Достижения" value={`${unlockedCount}/${achievements.length}`} icon={Award} color={C.amber}/>
        <KpiTile label="Активность" value={String(stats.activityScore)} icon={Activity} color="#8b5cf6"/>
      </div>

      <button type="button" onClick={onOpenShowcase} className="block w-full px-5 mt-3">
        <GlassCard className="p-3 flex items-center gap-3" glow="rgba(232,121,249,0.15)">
          <Sparkles size={16} style={{ color:'#e879f9' }}/>
          <p className="text-xs flex-1 text-left" style={{ color: C.t1 }}>Витрина коллекционера</p>
          <ChevronRight size={14} style={{ color: C.t3 }}/>
        </GlassCard>
      </button>

      <div className="px-5 mt-5">
        <p className="text-sm font-bold mb-2.5" style={{ color: C.t1 }}>Достижения</p>
        <div className="grid grid-cols-2 gap-2">
          {achievements.map(a => {
            const info = ACHIEVEMENT_LABELS[a.key];
            return (
              <GlassCard key={a.key} className="p-3" style={{ opacity: a.unlocked?1:0.45 }}>
                <div className="flex items-center gap-2 mb-1">
                  {a.unlocked ? <Award size={13} style={{ color: C.amber }}/> : <Lock size={13} style={{ color: C.t3 }}/>}
                  <p className="text-[11px] font-bold truncate" style={{ color: C.t1 }}>{info.title}</p>
                </div>
                <p className="text-[10px]" style={{ color: C.t3 }}>{info.desc}</p>
              </GlassCard>
            );
          })}
        </div>
      </div>

      {rarest.length > 0 && <HRow title="Редчайшие предметы">{rarest.map(g => <GiftCard key={g.id} gift={g} size="sm" onClick={() => onOpenGift(g.id)}/>)}</HRow>}
      {isOwn && favGifts.length > 0 && <HRow title="Любимые подарки">{favGifts.map(g => <GiftCard key={g.id} gift={g} size="sm" onClick={() => onOpenGift(g.id)}/>)}</HRow>}

      <div className="px-5 mt-5 mb-4">
        <p className="text-sm font-bold mb-2.5" style={{ color: C.t1 }}>Активность</p>
        {activity.length === 0 ? <EmptyState icon={Activity} title="Пока нет активности"/> : (
          <div className="space-y-2">
            {activity.map(a => (
              <div key={a.id} className="flex items-center justify-between rounded-xl p-3" style={{ background: C.l1, border:`1px solid ${C.brd}` }}>
                <p className="text-[11px]" style={{ color: C.t2 }}>{a.type==='sale'?'Продажа':a.type==='gift'?'Подарок':a.type==='minted'?'Выпуск':'Передача'} · {a.fromName} → {a.toName}</p>
                <p className="text-[11px] font-bold" style={{ color: C.t1 }}>{a.price ? fmt(a.price) : '—'}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
