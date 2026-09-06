/* ===============================================================
   SKY REFERRAL SYSTEM  -  Система приглашений
   Реферальные ссылки · Трекинг · Награды · Таблица лидеров
=============================================================== */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Gift, Crown, Copy, Check, Share2, Star, Trophy,
  ChevronRight, Sparkles, TrendingUp, Link2, Zap, Shield,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { create } from 'zustand';

/* === TYPES ================================================== */
interface ReferralEntry {
  referrerId: string;      // кто пригласил
  invitedId:  string;      // кого пригласили
  joinedAt:   string;
  rewarded:   boolean;     // уже вошло в награду
}

interface RewardMilestone {
  count:       number;
  label:       string;
  desc:        string;
  icon:        string;
  primeDays:   number;
  businessDays:number;
  points:       number;
  badge:        string;    // badge emoji показывается в профиле
}

export const MILESTONES: RewardMilestone[] = [
  { count:5,   label:'Первые 5',    icon:'🌱', primeDays:3,  businessDays:0,  points:200,  badge:'🌱', desc:'3 дня Prime + 200 баллов' },
  { count:10,  label:'Десятка',     icon:'🔥', primeDays:5,  businessDays:5,  points:500,  badge:'🔥', desc:'5 дней Prime + 5 дней Business + 500 баллов' },
  { count:25,  label:'Двадцать пять', icon:'⚡', primeDays:14, businessDays:7,  points:1200, badge:'⚡', desc:'2 недели Prime + неделя Business + 1200 баллов' },
  { count:50,  label:'Полсотни',    icon:'💎', primeDays:30, businessDays:14, points:3000, badge:'💎', desc:'Месяц Prime + 2 недели Business + 3000 баллов' },
  { count:100, label:'Сотня',       icon:'👑', primeDays:90, businessDays:30, points:7500, badge:'👑', desc:'3 месяца Prime + месяц Business + 7500 баллов + особый статус' },
  { count:250, label:'Амбассадор',  icon:'🏆', primeDays:180,businessDays:90, points:20000,badge:'🏆', desc:'6 мес Prime + 3 мес Business + 20000 баллов + значок Амбассадора' },
];

interface ReferralState {
  entries:       ReferralEntry[];
  claimed:       Record<string, number[]>; // userId → claimed milestone counts
  leaderboard:   { userId:string; name:string; count:number }[];

  getCode:       (userId: string) => string;
  getReferrals:  (userId: string) => ReferralEntry[];
  getCount:      (userId: string) => number;
  useCode:       (code: string, newUserId: string, newUserName: string) => boolean;
  claimMilestone:(userId: string, count: number) => boolean;
  isClaimed:     (userId: string, count: number) => boolean;
  getNextMilestone:(userId: string) => RewardMilestone | null;
  refreshLeaderboard: () => void;
}

const SK_REF  = 'sky:referrals:v1';
const SK_CLM  = 'sky:referrals:claimed:v1';
const SK_LB   = 'sky:referrals:lb:v1';
function load<T>(k: string, def: T): T { try { return JSON.parse(localStorage.getItem(k)||'null') ?? def; } catch { return def; } }
const save    = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const useReferralStore = create<ReferralState>((set, get) => ({
  entries:     load<ReferralEntry[]>(SK_REF, []),
  claimed:     load<Record<string,number[]>>(SK_CLM, {}),
  leaderboard: load<any[]>(SK_LB, []),

  getCode: (userId) => {
    // Короткий детерминированный код: first 8 chars of btoa(userId)
    return btoa(userId).replace(/[+=\/]/g,'').slice(0, 8).toUpperCase();
  },

  getReferrals: (userId) => get().entries.filter(e => e.referrerId === userId),

  getCount: (userId) => get().entries.filter(e => e.referrerId === userId).length,

  useCode: (code, newUserId, newUserName) => {
    // Find who owns this code
    const { accounts } = useAuthStore.getState();
    const owner = accounts.find(a => {
      const c = btoa(a.id).replace(/[+=\/]/g,'').slice(0, 8).toUpperCase();
      return c === code;
    });
    if (!owner) return false;
    if (owner.id === newUserId) return false; // нельзя себя пригласить
    // Check not already referred
    const already = get().entries.some(e => e.invitedId === newUserId);
    if (already) return false;
    const entry: ReferralEntry = {
      referrerId: owner.id,
      invitedId:  newUserId,
      joinedAt:   new Date().toISOString(),
      rewarded:   false,
    };
    const next = [...get().entries, entry];
    save(SK_REF, next);
    set({ entries: next });
    get().refreshLeaderboard();
    return true;
  },

  claimMilestone: (userId, count) => {
    if (get().isClaimed(userId, count)) return false;
    if (get().getCount(userId) < count) return false;
    const ms = MILESTONES.find(m => m.count === count);
    if (!ms) return false;

    // Grant rewards
    const { grantPrime, grantPrimeBusiness, accounts } = useAuthStore.getState();
    if (ms.primeDays > 0)    grantPrime(userId, ms.primeDays);
    if (ms.businessDays > 0) grantPrimeBusiness(userId, ms.businessDays);

    const claimed = { ...get().claimed };
    claimed[userId] = [...(claimed[userId] ?? []), count];
    save(SK_CLM, claimed);
    set({ claimed });
    return true;
  },

  isClaimed: (userId, count) => (get().claimed[userId] ?? []).includes(count),

  getNextMilestone: (userId) => {
    const count = get().getCount(userId);
    return MILESTONES.find(m => m.count > count && !get().isClaimed(userId, m.count)) ?? null;
  },

  refreshLeaderboard: () => {
    const { accounts } = useAuthStore.getState();
    const counts: Record<string, number> = {};
    get().entries.forEach(e => { counts[e.referrerId] = (counts[e.referrerId] ?? 0) + 1; });
    const lb = Object.entries(counts)
      .map(([uid, cnt]) => ({
        userId: uid,
        name:   accounts.find(a => a.id === uid)?.name ?? uid,
        count:  cnt,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    save(SK_LB, lb);
    set({ leaderboard: lb });
  },
}));

/* === HELPERS ================================================ */
const C = {
  bg:'#0a0a10', l1:'#111118', l2:'var(--bg-l2)',
  border:'var(--border)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)', green:'var(--green)', amber:'var(--amber)', red:'var(--red)',
};

const MEDAL = ['🥇','🥈','🥉'];

/* -- Progress bar ------------------------------------------ */
const ProgressBar = ({ current, target, color }: { current:number; target:number; color:string }) => {
  const pct = Math.min(100, (current / target) * 100);
  return (
    <div className="relative h-2 rounded-full overflow-hidden" style={{ background:'var(--border)' }}>
      <motion.div className="absolute inset-y-0 left-0 rounded-full"
        style={{ background:`linear-gradient(90deg,${color}80,${color})` }}
        initial={{ width:0 }}
        animate={{ width:`${pct}%` }}
        transition={{ duration:0.8, ease:'easeOut' }}/>
    </div>
  );
};

/* -- Milestone Card ---------------------------------------- */
const MilestoneCard = ({
  ms, current, claimed, onClaim,
}: {
  ms: RewardMilestone;
  current: number;
  claimed: boolean;
  onClaim: () => void;
}) => {
  const done    = current >= ms.count;
  const locked  = !done;

  return (
    <motion.div
      whileTap={done && !claimed ? { scale:.97 } : {}}
      className="rounded-2xl overflow-hidden relative"
      style={{
        background: claimed
          ? `linear-gradient(135deg,${C.green}12,${C.l1})`
          : done
            ? `linear-gradient(135deg,${C.amber}12,${C.l1})`
            : C.l1,
        border: `1.5px solid ${claimed ? C.green+'35' : done ? C.amber+'40' : C.border}`,
        opacity: locked ? 0.55 : 1,
      }}>
      {/* Claimed stamp */}
      {claimed && (
        <div className="absolute top-3 right-3 grid h-7 w-7 place-items-center rounded-full"
          style={{ background:C.green }}>
          <Check size={14} className="text-white"/>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl text-2xl shrink-0"
            style={{ background: done ? `${C.amber}15` : 'rgba(255,255,255,0.04)' }}>
            {ms.icon}
          </div>
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <p className="text-sm font-black text-white">{ms.label}</p>
              <span className="text-xs font-bold" style={{ color:C.amber }}>{ms.count} чел.</span>
            </div>
            <p className="text-[11px] mt-0.5 leading-tight" style={{ color:C.t3 }}>{ms.desc}</p>
          </div>
        </div>

        {/* Rewards chips */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {ms.primeDays > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background:'rgba(245,158,11,0.12)', color:C.amber }}>
              ⭐ Prime {ms.primeDays}д
            </span>
          )}
          {ms.businessDays > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background:'rgba(79,110,247,0.12)', color:C.accent }}>
              💼 Business {ms.businessDays}д
            </span>
          )}
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background:'rgba(52,211,153,0.12)', color:C.green }}>
            ✦ {ms.points.toLocaleString('ru')} баллов
          </span>
        </div>

        {/* Progress */}
        {!claimed && (
          <>
            <ProgressBar current={Math.min(current, ms.count)} target={ms.count} color={done?C.amber:C.accent}/>
            <div className="flex justify-between text-[10px] mt-1.5">
              <span style={{ color:C.t3 }}>{Math.min(current, ms.count)} / {ms.count}</span>
              {done && !claimed && (
                <span className="font-bold" style={{ color:C.amber }}>Готово!</span>
              )}
            </div>
          </>
        )}

        {/* Claim button */}
        {done && !claimed && (
          <motion.button whileTap={{ scale:.95 }} type="button" onClick={onClaim}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black text-black"
            style={{ background:`linear-gradient(135deg,${C.amber},#d97706)`, boxShadow:`0 4px 16px ${C.amber}40` }}>
            <Gift size={13}/>Забрать награду
          </motion.button>
        )}
      </div>
    </motion.div>
  );
};

/* === MAIN REFERRAL PANEL =================================== */
export const ReferralPanel = () => {
  const { accounts, currentUserId, grantPrime } = useAuthStore();
  const {
    getCode, getReferrals, getCount, claimMilestone, isClaimed,
    getNextMilestone, leaderboard, refreshLeaderboard,
  } = useReferralStore();

  const me     = accounts.find(a => a.id === currentUserId);
  const myId   = currentUserId ?? '';
  const code   = getCode(myId);
  const refs   = getReferrals(myId);
  const count  = getCount(myId);
  const next   = getNextMilestone(myId);
  const link   = `https://skymessenger.online/join?ref=${code}`;

  const [tab,      setTab]      = useState<'main'|'leaderboard'|'history'>('main');
  const [copied,   setCopied]   = useState(false);
  const [claimed,  setClaimed]  = useState<number|null>(null);
  const [testInput, setTestInput] = useState('');

  useEffect(() => { refreshLeaderboard(); }, []);

  const copyLink = async () => {
    await navigator.clipboard.writeText(link).catch(()=>{});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const share = () => {
    if (navigator.share) {
      navigator.share({ title:'Присоединись к Sky!', text:'Попробуй Sky  -  лучший мессенджер!', url:link });
    } else {
      copyLink();
    }
  };

  const handleClaim = (ms: RewardMilestone) => {
    const ok = claimMilestone(myId, ms.count);
    if (ok) setClaimed(ms.count);
    setTimeout(() => setClaimed(null), 3000);
  };

  // DEV: simulate using referral code (for testing)
  const simulateRef = () => {
    const code2 = getCode(myId);
    const fakeId = `test-${Date.now()}`;
    const fakeName = testInput.trim() || `Пользователь ${count + 1}`;
    const store = useReferralStore.getState();
    store.useCode(code2, fakeId, fakeName);
    setTestInput('');
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:C.bg }}>

      {/* Success toast */}
      <AnimatePresence>
        {claimed !== null && (
          <motion.div initial={{ opacity:0, y:-40 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-40 }}
            className="absolute top-4 left-4 right-4 z-50 rounded-2xl px-4 py-3 flex items-center gap-3"
            style={{ background:`linear-gradient(135deg,${C.amber},#d97706)`, boxShadow:`0 8px 32px ${C.amber}50` }}>
            <span className="text-2xl">🎉</span>
            <div>
              <p className="text-sm font-black text-black">Награда получена!</p>
              <p className="text-[11px] text-black/70">
                {MILESTONES.find(m=>m.count===claimed)?.desc}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="px-4 pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl text-2xl shrink-0"
            style={{ background:`linear-gradient(135deg,${C.accent}20,rgba(167,139,250,0.12))`,
              border:`1.5px solid ${C.accent}30` }}>
            👥
          </div>
          <div>
            <p className="text-lg font-black text-white">Пригласи друзей</p>
            <p className="text-xs" style={{ color:C.t3 }}>Получай Prime и Business за каждого</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label:'Приглашено', val:count,  color:C.accent },
            { label:'Наград',     val:MILESTONES.filter(m=>isClaimed(myId,m.count)).length, color:C.green },
            { label:'До след.',   val:next ? `${next.count - count}` : '✓', color:C.amber },
          ].map(({label,val,color}) => (
            <div key={label} className="rounded-2xl py-3 px-2 text-center"
              style={{ background:C.l1, border:`1px solid ${C.border}` }}>
              <p className="text-xl font-black" style={{ color }}>{val}</p>
              <p className="text-[9px] mt-0.5 font-medium" style={{ color:C.t3 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Invite card */}
        <div className="rounded-3xl overflow-hidden mb-4"
          style={{ background:`linear-gradient(135deg,#1a1a4e,#2d1b69,#1a0533)`,
            boxShadow:`0 8px 32px rgba(79,110,247,0.25)` }}>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <Link2 size={14} style={{ color:'rgba(255,255,255,0.5)' }}/>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color:'rgba(255,255,255,0.4)' }}>
                Твоя реферальная ссылка
              </p>
            </div>
            <p className="text-sm font-mono font-semibold text-white mb-3 break-all">{link}</p>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs" style={{ color:'rgba(255,255,255,0.4)' }}>Код: </span>
              <span className="text-lg font-black tracking-widest" style={{ color:C.amber }}>{code}</span>
            </div>
            <div className="flex gap-2">
              <motion.button whileTap={{ scale:.93 }} type="button" onClick={copyLink}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-bold transition-all"
                style={{ background: copied ? C.green+'25' : 'var(--border-m)',
                  color: copied ? C.green : 'white', border:`1px solid ${copied?C.green+'40':'rgba(255,255,255,0.15)'}` }}>
                {copied ? <><Check size={15}/>Скопировано</> : <><Copy size={15}/>Копировать</>}
              </motion.button>
              <motion.button whileTap={{ scale:.93 }} type="button" onClick={share}
                className="flex items-center justify-center gap-1.5 rounded-xl py-3 px-5 text-sm font-bold"
                style={{ background:C.accent, color:'white', boxShadow:`0 4px 16px ${C.accent}40` }}>
                <Share2 size={15}/>Поделиться
              </motion.button>
            </div>
          </div>
        </div>

        {/* Next milestone banner */}
        {next && (
          <div className="rounded-2xl px-4 py-3 flex items-center gap-3 mb-3"
            style={{ background:`${C.amber}08`, border:`1px solid ${C.amber}20` }}>
            <span className="text-2xl">{next.icon}</span>
            <div className="flex-1">
              <p className="text-xs font-bold" style={{ color:C.amber }}>
                Следующая награда: {next.count} чел.
              </p>
              <ProgressBar current={count} target={next.count} color={C.amber}/>
              <p className="text-[10px] mt-1" style={{ color:C.t3 }}>
                Ещё {next.count - count} → {next.desc}
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1">
          {([['main','🎁 Награды'],['history','👥 Кто пришёл'],['leaderboard','🏆 Топ']] as const).map(([k,l]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className="flex-1 rounded-full py-2 text-[11px] font-semibold transition-all"
              style={{ background:tab===k?C.accent:'var(--border)',
                color:tab===k?'white':C.t3 }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-3" style={{ scrollbarWidth:'none' }}>

        {/* REWARDS */}
        {tab === 'main' && (
          <>
            {MILESTONES.map(ms => (
              <MilestoneCard key={ms.count} ms={ms} current={count}
                claimed={isClaimed(myId, ms.count)}
                onClaim={() => handleClaim(ms)}/>
            ))}
            {/* DEV helper */}
            <div className="rounded-xl p-3 mt-2"
              style={{ background:'rgba(255,255,255,0.02)', border:`1px solid ${C.border}` }}>
              <p className="text-[10px] font-bold mb-2" style={{ color:C.t3 }}>
                🧪 Тест (только для разработки)
              </p>
              <div className="flex gap-2">
                <input value={testInput} onChange={e=>setTestInput(e.target.value)}
                  placeholder="Имя тест-пользователя"
                  className="flex-1 rounded-lg px-2 py-1.5 text-xs outline-none"
                  style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
                <button type="button" onClick={simulateRef}
                  className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                  style={{ background:C.accent }}>+1</button>
              </div>
            </div>
          </>
        )}

        {/* HISTORY */}
        {tab === 'history' && (
          <>
            {refs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <span className="text-4xl">👥</span>
                <p className="text-sm font-bold text-white">Пока никого</p>
                <p className="text-xs text-center" style={{ color:C.t2 }}>
                  Поделись ссылкой и жди первых друзей!
                </p>
              </div>
            ) : (
              refs.map((r, i) => {
                const inv = accounts.find(a => a.id === r.invitedId);
                return (
                  <div key={r.invitedId}
                    className="flex items-center gap-3 rounded-2xl px-4 py-3"
                    style={{ background:C.l1, border:`1px solid ${C.border}` }}>
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                      style={{ background:C.accent }}>
                      {(inv?.name ?? 'П')[0]}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-white">{inv?.name ?? `Пользователь ${i+1}`}</p>
                      <p className="text-[10px]" style={{ color:C.t3 }}>
                        {new Date(r.joinedAt).toLocaleDateString('ru',{day:'numeric',month:'short'})}
                      </p>
                    </div>
                    <Check size={14} style={{ color:C.green }}/>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* LEADERBOARD */}
        {tab === 'leaderboard' && (
          <>
            <div className="rounded-2xl overflow-hidden"
              style={{ background:C.l1, border:`1px solid ${C.border}` }}>
              <div className="px-4 py-3 border-b" style={{ borderColor:C.border }}>
                <p className="text-xs font-bold text-white">🏆 Топ приглашающих</p>
                <p className="text-[10px] mt-0.5" style={{ color:C.t3 }}>За всё время</p>
              </div>
              {leaderboard.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm" style={{ color:C.t3 }}>Пока никого нет</p>
                </div>
              ) : (
                leaderboard.map((entry, i) => (
                  <div key={entry.userId}
                    className="flex items-center gap-3 px-4 py-3 border-t"
                    style={{ borderColor:C.border,
                      background:entry.userId===myId?`${C.accent}08`:'transparent' }}>
                    <span className="text-lg w-6 shrink-0 text-center">
                      {i < 3 ? MEDAL[i] : `${i+1}`}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-white">{entry.name}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Users size={11} style={{ color:C.t3 }}/>
                      <span className="text-sm font-black" style={{ color: i===0?C.amber:i===1?'#c0c0c0':i===2?'#cd7f32':C.t2 }}>
                        {entry.count}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* How it works */}
            <div className="rounded-2xl p-4 space-y-3"
              style={{ background:C.l1, border:`1px solid ${C.border}` }}>
              <p className="text-xs font-bold text-white">💡 Как привлечь больше людей</p>
              {[
                { icon:'📱', text:'Поделись ссылкой в Stories/Reels  -  охват 1000+ за час' },
                { icon:'🎮', text:'Отправь в геймерский Discord/чат  -  там активная аудитория' },
                { icon:'💬', text:'Добавь в подпись email или Telegram Bio' },
                { icon:'🎁', text:'Скажи друзьям про подарок 3 дня Prime  -  конверсия выше' },
                { icon:'📢', text:'Сделай пост ВКонтакте с кодом  -  он уникален только у тебя' },
              ].map(({icon,text}) => (
                <div key={text} className="flex items-start gap-2.5">
                  <span className="text-base shrink-0">{icon}</span>
                  <p className="text-xs leading-relaxed" style={{ color:C.t2 }}>{text}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/* --- Use on register: apply referral code ------------------- */
export const applyReferralCode = (code: string, userId: string, userName: string): boolean => {
  return useReferralStore.getState().useCode(code, userId, userName);
};
