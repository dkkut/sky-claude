/* ===============================================================
   GAMING ACCOUNTS UI
   Профиль: привязка аккаунтов + текущая игра
=============================================================== */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Check, X, ExternalLink, ChevronRight,
  Gamepad2, Clock, Zap,
} from 'lucide-react';
import {
  useGamingAccounts, PLATFORMS, POPULAR_GAMES,
  fmtSessionTime, fmtTotalHours,
  type GamingPlatform,
} from './accounts';
import { useAuthStore } from '@/core/auth/store';

const C = {
  bg:'var(--bg)', l1:'var(--bg-l1)', l2:'var(--bg-l2)',
  border:'var(--border)', t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)', green:'var(--green)',
};

/* -- Inline activity badge (for chat header / chat list) ---- */
export const GameActivityBadge = ({ userId }: { userId: string }) => {
  const { getActivity } = useGamingAccounts();
  const activity = getActivity(userId);
  if (!activity?.isPlaying) return null;
  return (
    <motion.span
      initial={{ opacity:0, scale:0.8 }} animate={{ opacity:1, scale:1 }}
      className="flex items-center gap-1 text-[11px] font-semibold"
      style={{ color:'#22c55e' }}>
      <motion.div className="h-1.5 w-1.5 rounded-full bg-green-500"
        animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.5, repeat:Infinity }}/>
      Играет в {activity.gameIcon} {activity.gameName}
    </motion.span>
  );
};

/* -- Full gaming panel (profile section) ------------------ */
export const GamingAccountsPanel = ({ userId }: { userId: string }) => {
  const { getAccounts, addAccount, removeAccount, getActivity, setPlaying, stopPlaying } = useGamingAccounts();
  const { accounts: allAccounts } = useAuthStore();
  const user = allAccounts.find(a => a.id === userId);

  const [view,       setView]       = useState<'main'|'add'|'setgame'>('main');
  const [selPlatform,setSelPlatform]= useState<GamingPlatform|null>(null);
  const [username,   setUsername]   = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [delConfirm, setDelConfirm] = useState<GamingPlatform|null>(null);
  const [customGame, setCustomGame] = useState('');
  const [customIcon, setCustomIcon] = useState('🎮');

  const linked   = getAccounts(userId);
  const activity = getActivity(userId);

  const handleAdd = () => {
    if (!selPlatform || !username.trim()) return;
    addAccount(userId, {
      platform:   selPlatform,
      username:   username.trim(),
      profileUrl: profileUrl.trim() || undefined,
    });
    setView('main');
    setSelPlatform(null);
    setUsername('');
    setProfileUrl('');
  };

  const handleSetGame = (gameName: string, icon: string, platform: GamingPlatform) => {
    setPlaying(userId, gameName, icon, platform);
    setView('main');
  };

  if (view === 'add') return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => { setView('main'); setSelPlatform(null); }}
          className="text-xs font-semibold" style={{ color:C.accent }}>
          ← Назад
        </button>
        <p className="text-sm font-bold" style={{ color:C.t1 }}>
          {selPlatform ? `Привязать ${PLATFORMS[selPlatform].name}` : 'Выберите платформу'}
        </p>
      </div>

      {!selPlatform ? (
        <div className="grid grid-cols-3 gap-2">
          {(Object.entries(PLATFORMS) as [GamingPlatform, any][]).map(([key, p]) => (
            <button key={key} type="button" onClick={() => setSelPlatform(key)}
              className="flex flex-col items-center gap-1.5 rounded-2xl p-3 transition-all hover:bg-white/5"
              style={{ background:C.l2, border:`1px solid ${C.border}` }}>
              <span className="text-2xl">{p.icon}</span>
              <span className="text-[10px] font-semibold text-center leading-tight"
                style={{ color:C.t2 }}>{p.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 p-3 rounded-2xl"
            style={{ background:C.l2, border:`1px solid ${C.border}` }}>
            <span className="text-2xl">{PLATFORMS[selPlatform].icon}</span>
            <div>
              <p className="text-sm font-bold" style={{ color:C.t1 }}>{PLATFORMS[selPlatform].name}</p>
              <button type="button" onClick={() => setSelPlatform(null)}
                className="text-[10px]" style={{ color:C.accent }}>Изменить</button>
            </div>
          </div>
          <input value={username} onChange={e => setUsername(e.target.value)}
            placeholder={PLATFORMS[selPlatform].placeholder}
            className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
            style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
          {selPlatform !== 'custom' && (
            <input value={profileUrl} onChange={e => setProfileUrl(e.target.value)}
              placeholder="Ссылка на профиль (необязательно)"
              className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
              style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
          )}
          <motion.button whileTap={{ scale:.97 }} type="button" onClick={handleAdd}
            disabled={!username.trim()}
            className="w-full rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-40"
            style={{ background:C.accent }}>
            Привязать аккаунт
          </motion.button>
        </div>
      )}
    </div>
  );

  if (view === 'setgame') return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setView('main')}
          className="text-xs font-semibold" style={{ color:C.accent }}>← Назад</button>
        <p className="text-sm font-bold" style={{ color:C.t1 }}>Установить игру</p>
      </div>

      {/* Popular games */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color:C.t3 }}>
          Популярные
        </p>
        <div className="space-y-1">
          {POPULAR_GAMES.map(g => {
            const hasLinked = linked.some(a => a.platform === g.platform);
            return (
              <button key={g.name} type="button"
                onClick={() => handleSetGame(g.name, g.icon, g.platform)}
                className="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                style={{ background:C.l2 }}>
                <span className="text-xl">{g.icon}</span>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold" style={{ color:C.t1 }}>{g.name}</p>
                  <p className="text-[10px]" style={{ color:C.t3 }}>
                    {PLATFORMS[g.platform].icon} {PLATFORMS[g.platform].name}
                    {hasLinked ? ' · Аккаунт привязан ✓' : ''}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom game */}
      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color:C.t3 }}>Своя игра</p>
        <div className="flex gap-2">
          <input value={customIcon} onChange={e => setCustomIcon(e.target.value)}
            maxLength={2} className="w-14 rounded-xl px-2 py-2.5 text-center text-xl outline-none"
            style={{ background:C.l2, border:`1px solid ${C.border}` }}/>
          <input value={customGame} onChange={e => setCustomGame(e.target.value)}
            placeholder="Название игры..."
            className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
        </div>
        {customGame.trim() && (
          <button type="button" onClick={() => handleSetGame(customGame.trim(), customIcon, 'custom')}
            className="w-full rounded-xl py-2.5 text-sm font-bold text-white"
            style={{ background:C.accent }}>
            Установить «{customGame}»
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">

      {/* -- Current activity ---------------------------------- */}
      <div className="rounded-2xl overflow-hidden" style={{ background:C.l1, border:`1px solid ${C.border}` }}>
        <p className="px-4 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color:C.t3 }}>
          🎮 Текущая активность
        </p>
        {activity?.isPlaying ? (
          <div className="px-4 pb-4">
            <div className="flex items-center gap-3 mb-3">
              <motion.div animate={{ scale:[1,1.1,1] }} transition={{ duration:2, repeat:Infinity }}
                className="text-3xl">{activity.gameIcon}</motion.div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <motion.div className="h-2 w-2 rounded-full bg-green-500"
                    animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.5, repeat:Infinity }}/>
                  <p className="text-sm font-bold" style={{ color:'#22c55e' }}>
                    Играет сейчас
                  </p>
                </div>
                <p className="text-base font-black text-white">{activity.gameName}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="flex items-center gap-1 text-xs" style={{ color:C.t3 }}>
                    <Clock size={10}/> {fmtSessionTime(activity.startedAt)} в этой сессии
                  </span>
                  <span className="flex items-center gap-1 text-xs" style={{ color:C.t3 }}>
                    <Zap size={10}/> {fmtTotalHours(activity.totalHours)} всего
                  </span>
                </div>
              </div>
              <button type="button" onClick={() => stopPlaying(userId)}
                className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5"
                title="Остановить">
                <X size={14} style={{ color:C.t3 }}/>
              </button>
            </div>
            <button type="button" onClick={() => setView('setgame')}
              className="w-full rounded-xl py-2 text-xs font-semibold"
              style={{ background:'rgba(255,255,255,0.05)', color:C.t2 }}>
              Изменить игру
            </button>
          </div>
        ) : (
          <div className="px-4 pb-4">
            <p className="text-xs mb-3" style={{ color:C.t3 }}>Сейчас не играет</p>
            <button type="button" onClick={() => setView('setgame')}
              className="flex items-center justify-center gap-2 w-full rounded-xl py-2.5 text-xs font-semibold"
              style={{ background:`${C.accent}15`, border:`1px solid ${C.accent}30`, color:C.accent }}>
              <Gamepad2 size={13}/> Установить игру
            </button>
          </div>
        )}
      </div>

      {/* -- Linked accounts ----------------------------------- */}
      <div className="rounded-2xl overflow-hidden" style={{ background:C.l1, border:`1px solid ${C.border}` }}>
        <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color:C.t3 }}>
            🔗 Привязанные аккаунты
          </p>
          <button type="button" onClick={() => setView('add')}
            className="flex items-center gap-1 text-xs font-semibold" style={{ color:C.accent }}>
            <Plus size={12}/> Добавить
          </button>
        </div>

        {linked.length === 0 ? (
          <div className="px-4 pb-4">
            <p className="text-xs mb-3" style={{ color:C.t3 }}>Нет привязанных аккаунтов</p>
            <button type="button" onClick={() => setView('add')}
              className="flex items-center justify-center gap-2 w-full rounded-xl py-2.5 text-xs font-semibold"
              style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t2 }}>
              <Plus size={13}/> Привязать Steam, Epic, PSN...
            </button>
          </div>
        ) : (
          <div className="pb-2">
            {linked.map(acc => {
              const p = PLATFORMS[acc.platform];
              return (
                <div key={acc.platform}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xl"
                    style={{ background:`${p.color}20` }}>
                    {p.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold truncate" style={{ color:C.t1 }}>{acc.username}</p>
                      {acc.verified && (
                        <span className="text-[8px] font-bold px-1 py-0.5 rounded"
                          style={{ background:'rgba(34,197,94,0.15)', color:'#22c55e' }}>✓</span>
                      )}
                    </div>
                    <p className="text-[10px]" style={{ color:C.t3 }}>{p.name}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {acc.profileUrl && (
                      <a href={acc.profileUrl} target="_blank" rel="noopener noreferrer"
                        className="grid h-7 w-7 place-items-center rounded-lg hover:bg-white/5"
                        onClick={e => e.stopPropagation()}>
                        <ExternalLink size={12} style={{ color:C.t3 }}/>
                      </a>
                    )}
                    {delConfirm === acc.platform ? (
                      <div className="flex gap-1">
                        <button type="button" onClick={() => { removeAccount(userId, acc.platform); setDelConfirm(null); }}
                          className="grid h-7 w-7 place-items-center rounded-lg"
                          style={{ background:'rgba(248,113,113,0.15)' }}>
                          <Check size={12} style={{ color:'var(--red)' }}/>
                        </button>
                        <button type="button" onClick={() => setDelConfirm(null)}
                          className="grid h-7 w-7 place-items-center rounded-lg hover:bg-white/5">
                          <X size={12} style={{ color:C.t3 }}/>
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setDelConfirm(acc.platform)}
                        className="grid h-7 w-7 place-items-center rounded-lg hover:bg-white/5">
                        <Trash2 size={12} style={{ color:C.t3 }}/>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="px-4 pb-2 pt-1">
              <button type="button" onClick={() => setView('add')}
                className="flex items-center gap-1.5 text-xs font-semibold" style={{ color:C.accent }}>
                <Plus size={11}/> Привязать ещё
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* -- Compact card for profile main page ------------------- */
export const GamingActivityCard = ({ userId }: { userId: string }) => {
  const { getActivity, getAccounts } = useGamingAccounts();
  const activity = getActivity(userId);
  const linked   = getAccounts(userId);

  if (!activity?.isPlaying && linked.length === 0) return null;

  return (
    <div className="rounded-2xl px-4 py-3.5 mt-3"
      style={{ background:'rgba(34,197,94,0.06)', border:'1px solid rgba(34,197,94,0.15)' }}>
      {activity?.isPlaying ? (
        <div className="flex items-center gap-3">
          <motion.span className="text-2xl" animate={{ scale:[1,1.08,1] }}
            transition={{ duration:2, repeat:Infinity }}>
            {activity.gameIcon}
          </motion.span>
          <div>
            <div className="flex items-center gap-1.5">
              <motion.div className="h-2 w-2 rounded-full"
                style={{ background:'#22c55e' }}
                animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.5, repeat:Infinity }}/>
              <p className="text-xs font-bold" style={{ color:'#22c55e' }}>Играет сейчас</p>
            </div>
            <p className="text-sm font-black text-white">{activity.gameName}</p>
            <p className="text-[10px] mt-0.5" style={{ color:'rgba(255,255,255,0.4)' }}>
              {fmtSessionTime(activity.startedAt)} · {fmtTotalHours(activity.totalHours)} всего
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Gamepad2 size={16} style={{ color:C.t3 }}/>
          <p className="text-xs" style={{ color:C.t3 }}>
            {linked.length} {linked.length===1?'аккаунт привязан':'аккаунтов привязано'}
          </p>
        </div>
      )}
    </div>
  );
};
