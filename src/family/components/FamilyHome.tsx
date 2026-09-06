import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Wallet, Target, Trophy, Bell, Users, ChevronRight, TrendingUp, ShoppingCart, BarChart3, Calendar, ShieldAlert, MapPin, Coins, Lock, Clock3, MessageCircle, Shield, Sparkles, Plane } from 'lucide-react';
import { useFamilyStore } from '../store';
import { fmtAgo } from '@/bloom/store';

type FamilyView = 'wallet'|'goals'|'achievements'|'members'|'approvals'|'prime'|'shopping'|'stats'|'calendar'|'security'|'location'|'allowance'|'safe'|'capsule'|'permissions'|'ai'|'travel';

export const FamilyHome = ({ onNav }: { onNav: (v: FamilyView) => void }) => {
  const { family, cashbackPct, familyLevel, isAdult, myMember, isPrimeFamilyActive, triggerSOS, checkDuePayouts, openOrCreateFamilyChat } = useFamilyStore();
  const [sosConfirm, setSosConfirm] = useState(false);
  const [sosSent, setSosSent] = useState(false);
  useEffect(() => { checkDuePayouts(); }, [checkDuePayouts]);
  if (!family) return null;

  const { level, xp, xpForNext } = familyLevel();
  const pct = Math.min(100, Math.round((xp % 500) / 5));
  const pendingApprovals = family.approvalRequests.filter(r => r.status === 'pending');
  const me = myMember();
  const canSeeApprovals = me ? (me.role === 'owner' || me.role === 'adult') : false;

  const NAV = [
    { key: 'wallet' as const,       label: 'Общий счёт',   icon: Wallet,  value: `${family.balance.toLocaleString('ru')} ₽` },
    { key: 'goals' as const,        label: 'Цели',          icon: Target,  value: `${family.goals.length}` },
    { key: 'achievements' as const, label: 'Достижения',    icon: Trophy,  value: `${family.achievements.filter(a=>a.unlocked).length}/${family.achievements.length}` },
    { key: 'members' as const,      label: 'Участники',     icon: Users,   value: `${family.members.length}/8` },
    { key: 'shopping' as const,     label: 'Список покупок',icon: ShoppingCart, value: `${family.shoppingList.filter(i=>!i.bought).length}` },
    { key: 'stats' as const,        label: 'Статистика',    icon: BarChart3, value: '' },
    { key: 'calendar' as const,     label: 'Календарь',     icon: Calendar, value: '' },
    { key: 'security' as const,     label: 'Безопасность',  icon: ShieldAlert, value: '' },
    { key: 'location' as const,     label: 'Геопозиция',    icon: MapPin, value: '' },
    { key: 'allowance' as const,    label: 'Карм. деньги',  icon: Coins, value: '' },
    { key: 'safe' as const,         label: 'Сейф',          icon: Lock, value: '' },
    { key: 'capsule' as const,      label: 'Капсула времени',icon: Clock3, value: '' },
    { key: 'permissions' as const,  label: 'Разрешения',    icon: Shield, value: '' },
    { key: 'ai' as const,           label: 'AI-ассистент',  icon: Sparkles, value: '' },
    { key: 'travel' as const,       label: 'Путешествия',   icon: Plane, value: `${family.trips.length || ''}` },
  ];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Sky Family</p>
            <h2 className="text-lg font-black" style={{ color: 'var(--t1)' }}>{family.name}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSosConfirm(true)}
              className="flex items-center gap-1 rounded-xl px-2.5 py-2 text-[11px] font-bold text-white" style={{ background: 'var(--red)' }}>
              <ShieldAlert size={13}/>SOS
            </button>
            {canSeeApprovals && (
              <button type="button" onClick={() => onNav('approvals')} className="relative rounded-xl p-2.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                <Bell size={16} style={{ color: 'var(--t2)' }}/>
              {pendingApprovals.length > 0 && (
                <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold text-white" style={{ background: 'var(--red)' }}>
                  {pendingApprovals.length}
                </span>
              )}
            </button>
          )}
          </div>
        </div>

        {/* Участники */}
        <div className="mt-3 flex items-center gap-2">
          {family.members.map(m => (
            <div key={m.id} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: m.avatarColor, border: '2px solid var(--bg)' }}>
              {m.name[0]}
            </div>
          ))}
          {family.members.length < 8 && (
            <button type="button" onClick={() => onNav('members')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: 'var(--bg-l2)', border: '1.5px dashed var(--border)' }}>
              <Plus size={15} style={{ color: 'var(--t3)' }}/>
            </button>
          )}
        </div>
      </div>

      {/* Уровень семьи */}
      <div className="mx-4 mt-3 rounded-3xl p-4" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.16), rgba(79,110,247,0.1))', border: '1px solid rgba(139,92,246,0.25)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-2xl text-lg font-black text-white" style={{ background: 'linear-gradient(135deg,#8b5cf6,#4f6ef7)' }}>{level}</div>
            <div>
              <p className="text-[13px] font-bold" style={{ color: 'var(--t1)' }}>Уровень семьи {level}</p>
              <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{xp} / {xpForNext} XP</p>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: 'rgba(34,197,94,0.15)' }}>
            <TrendingUp size={11} style={{ color: 'var(--green)' }}/>
            <span className="text-[11px] font-bold" style={{ color: 'var(--green)' }}>{cashbackPct()}% кешбэк</span>
          </div>
        </div>
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <motion.div className="h-full rounded-full" style={{ background: 'linear-gradient(90deg,#8b5cf6,#4f6ef7)' }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }}/>
        </div>
      </div>

      {/* Семейный чат */}
      <button type="button" onClick={openOrCreateFamilyChat}
        className="mx-4 mt-3 flex items-center gap-3 rounded-2xl p-3.5 text-left" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
        <div className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'var(--accent-bg)' }}>
          <MessageCircle size={15} style={{ color: 'var(--accent)' }}/>
        </div>
        <p className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--t1)' }}>Семейный чат</p>
        <ChevronRight size={14} style={{ color: 'var(--t3)' }}/>
      </button>

      {/* Sky Prime Family */}
      <button type="button" onClick={() => onNav('prime')}
        className="mx-4 mt-3 flex items-center gap-3 rounded-2xl p-3.5 text-left"
        style={{ background: isPrimeFamilyActive() ? 'rgba(34,197,94,0.1)' : 'linear-gradient(135deg, rgba(245,158,11,0.14), var(--bg-l1))', border: `1px solid ${isPrimeFamilyActive() ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)'}` }}>
        <span className="text-xl">👑</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold" style={{ color: 'var(--t1)' }}>Sky Prime Family</p>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{isPrimeFamilyActive() ? 'Активен для всей семьи' : 'Prime для всех участников по одной цене'}</p>
        </div>
        <ChevronRight size={14} style={{ color: 'var(--t3)' }}/>
      </button>

      {/* Быстрая навигация */}
      <div className="mx-4 mt-4 grid grid-cols-2 gap-2.5">
        {NAV.map(n => (
          <motion.button key={n.key} type="button" whileTap={{ scale: 0.97 }} onClick={() => onNav(n.key)}
            className="flex flex-col items-start gap-2 rounded-2xl p-3.5 text-left" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <n.icon size={17} style={{ color: 'var(--accent)' }}/>
            <div>
              <p className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>{n.value}</p>
              <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{n.label}</p>
            </div>
          </motion.button>
        ))}
      </div>

      {canSeeApprovals && pendingApprovals.length > 0 && (
        <button type="button" onClick={() => onNav('approvals')}
          className="mx-4 mt-3 flex items-center gap-3 rounded-2xl p-3.5 text-left" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <Bell size={16} style={{ color: 'var(--amber)' }}/>
          <p className="flex-1 text-[12.5px]" style={{ color: 'var(--t1)' }}>{pendingApprovals.length} {pendingApprovals.length===1?'запрос':'запроса'} ждут вашего решения</p>
          <ChevronRight size={14} style={{ color: 'var(--t3)' }}/>
        </button>
      )}

      {/* Активность */}
      <div className="mt-5 flex-1 px-4 pb-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>Последние действия</p>
        {family.activity.length === 0 ? (
          <div className="sky-empty">
            <div className="sky-empty-icon">🌤️</div>
            <p style={{ color: 'var(--t2)' }}>Здесь появится история семьи</p>
          </div>
        ) : (
          <div className="space-y-2">
            {family.activity.slice(0,8).map(a => (
              <div key={a.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                <span className="text-base">{a.icon}</span>
                <p className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: 'var(--t2)' }}>
                  <span className="font-semibold" style={{ color: 'var(--t1)' }}>{a.memberName}</span> {a.text}
                </p>
                <span className="shrink-0 text-[10.5px]" style={{ color: 'var(--t3)' }}>{fmtAgo(a.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {sosConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={() => setSosConfirm(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
              onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl p-5 text-center" style={{ background: 'var(--bg-l1)' }}>
              {sosSent ? (
                <>
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-full" style={{ background: 'rgba(34,197,94,0.15)' }}>
                    <ShieldAlert size={24} style={{ color: 'var(--green)' }}/>
                  </div>
                  <p className="mt-3 text-[14px] font-bold" style={{ color: 'var(--t1)' }}>Сигнал отправлен всем взрослым</p>
                  <button type="button" onClick={() => { setSosConfirm(false); setSosSent(false); }} className="sky-btn-ghost mt-4 px-6">Закрыть</button>
                </>
              ) : (
                <>
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-full" style={{ background: 'rgba(239,68,68,0.15)' }}>
                    <ShieldAlert size={24} style={{ color: 'var(--red)' }}/>
                  </div>
                  <p className="mt-3 text-[14px] font-bold" style={{ color: 'var(--t1)' }}>Отправить экстренный сигнал SOS?</p>
                  <p className="mt-1 text-[12px]" style={{ color: 'var(--t3)' }}>Все взрослые участники семьи мгновенно получат уведомление</p>
                  <div className="mt-4 grid grid-cols-2 gap-2.5">
                    <button type="button" onClick={() => setSosConfirm(false)} className="rounded-2xl py-3 text-[13px] font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>Отмена</button>
                    <button type="button" onClick={() => { triggerSOS(); setSosSent(true); }} className="rounded-2xl py-3 text-[13px] font-bold text-white" style={{ background: 'var(--red)' }}>Отправить SOS</button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
