import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Check, X, Zap, Gift, Handshake, Trophy, ChevronRight, TrendingUp, Users } from 'lucide-react';
import { useGamingStore, GAMES, GENRE_LABEL, type GameEntry } from '../store';
import { GameCard, GENRE_COLOR, K, ago } from './Primitives';

interface Props { onGame: (g: GameEntry) => void }

export const HomeView = ({ onGame }: Props) => {
  const { news, invites, answerInvite, myStats } = useGamingStore();
  const pending  = invites.filter(i => i.status === 'pending');
  const stats    = myStats();
  const topGames = [...GAMES].sort((a, b) => b.players - a.players).slice(0, 3);
  const [dismissedNews, setDismissed] = useState<Set<string>>(new Set());

  const visibleNews = news.slice(0, 5).filter(n => !dismissedNews.has(n.id));

  return (
    <div className="h-full overflow-y-auto pb-6" style={{ scrollbarWidth: 'none' }}>

      {/* ── Party invites ─────────────────────────────────── */}
      <AnimatePresence>
        {pending.map(inv => (
          <motion.div key={inv.id} layout
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} className="overflow-hidden px-4 pt-2">
            <div className="rounded-2xl overflow-hidden"
              style={{ background: 'linear-gradient(135deg,rgba(79,110,247,0.1),rgba(79,110,247,0.05))',
                border: '1px solid rgba(79,110,247,0.25)' }}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="relative shrink-0">
                  <div className="grid h-10 w-10 place-items-center rounded-xl text-sm font-black"
                    style={{ background: 'rgba(79,110,247,0.2)', color: 'var(--accent)' }}>
                    {GAMES.find(g => g.id === inv.gameId)?.cover ?? '🎮'}
                  </div>
                  <span className="absolute -top-1 -right-1 grid h-4 w-4 place-items-center rounded-full text-[8px] font-black text-white"
                    style={{ background: '#f43f5e' }}>!</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold leading-tight" style={{ color: 'var(--t1)' }}>
                    <span style={{ color: 'var(--accent)' }}>{inv.fromName}</span>
                    <span style={{ color: 'var(--t3)', fontWeight: 400 }}> зовёт в </span>
                    {inv.gameTitle}
                  </p>
                  <p className="text-[10px] mt-0.5 font-medium" style={{ color: 'var(--t3)' }}>
                    {inv.mode} · только что
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <motion.button whileTap={{ scale: 0.88 }} type="button"
                    onClick={() => answerInvite(inv.id, true)}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
                    style={{ background: 'rgba(52,211,153,0.15)', color: 'var(--green)',
                      border: '1px solid rgba(52,211,153,0.25)' }}>
                    <Check size={12}/> Принять
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.88 }} type="button"
                    onClick={() => answerInvite(inv.id, false)}
                    className="grid h-8 w-8 place-items-center rounded-xl"
                    style={{ background: 'rgba(248,113,113,0.08)', color: 'var(--red)',
                      border: '1px solid rgba(248,113,113,0.15)' }}>
                    <X size={13}/>
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* ── My games ───────────────────────────────────────── */}
      {stats.length > 0 && (
        <section className="px-4 mt-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>
              Мои игры
            </p>
            <span className="text-[10px] font-semibold" style={{ color: 'var(--accent)' }}>
              {stats.length} игр
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {stats.slice(0, 4).map(s => {
              const game = GAMES.find(g => g.id === s.gameId)!;
              return <GameCard key={s.gameId} game={game} rank={s.rank} onClick={() => onGame(game)}/>;
            })}
          </div>
        </section>
      )}

      {/* ── Live activity bar ──────────────────────────────── */}
      <section className="px-4 mt-5">
        <div className="rounded-2xl p-3 flex items-center gap-3 overflow-hidden relative"
          style={{ background: 'linear-gradient(135deg,rgba(244,63,94,0.08),rgba(139,92,246,0.06))',
            border: '1px solid rgba(244,63,94,0.15)' }}>
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 0% 50%,rgba(244,63,94,0.07) 0%,transparent 70%)' }}/>
          <div className="relative flex items-center gap-2 shrink-0">
            <motion.div className="h-2 w-2 rounded-full bg-red-500"
              animate={{ opacity: [1, 0.3, 1], scale: [1, 0.8, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}/>
            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#f43f5e' }}>
              Сейчас играют
            </span>
          </div>
          <div className="flex items-center gap-3 flex-1 overflow-hidden relative">
            {GAMES.slice(0, 3).map((g, i) => (
              <div key={g.id} className="flex items-center gap-1.5 shrink-0">
                <span className="text-base">{g.cover}</span>
                <div>
                  <p className="text-[10px] font-bold text-white leading-tight">{K(g.players)}</p>
                  <p className="text-[9px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{g.title.slice(0,8)}</p>
                </div>
                {i < 2 && <div className="h-6 w-px mx-1" style={{ background: 'rgba(255,255,255,0.08)' }}/>}
              </div>
            ))}
          </div>
          <Users size={13} style={{ color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}/>
        </div>
      </section>

      {/* ── Trending now ───────────────────────────────────── */}
      <section className="px-4 mt-5">
        <div className="flex items-center gap-1.5 mb-3">
          <TrendingUp size={12} style={{ color: 'var(--amber)' }}/>
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>
            Популярные
          </p>
        </div>
        <div className="space-y-1.5">
          {topGames.map((g, i) => {
            const col = GENRE_COLOR[g.genre];
            return (
              <motion.div key={g.id} whileHover={{ x: 2 }} whileTap={{ scale: 0.99 }}
                onClick={() => onGame(g)}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 cursor-pointer relative overflow-hidden"
                style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                <div className="absolute inset-0 pointer-events-none"
                  style={{ background: `linear-gradient(90deg,${col}08 0%,transparent 50%)` }}/>
                {/* Rank number */}
                <div className="grid h-7 w-7 place-items-center rounded-xl shrink-0 text-xs font-black relative"
                  style={{ background: `${col}15`, color: col }}>
                  {i + 1}
                </div>
                {/* Cover */}
                <span className="text-xl relative" style={{ filter: `drop-shadow(0 2px 8px ${col}60)` }}>
                  {g.cover}
                </span>
                {/* Info */}
                <div className="flex-1 min-w-0 relative">
                  <p className="text-sm font-bold leading-tight" style={{ color: 'var(--t1)' }}>{g.title}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>
                    {K(g.players)} онлайн · {GENRE_LABEL[g.genre]}
                  </p>
                </div>
                {/* Online bar */}
                <div className="relative shrink-0 flex items-center gap-2">
                  <div className="h-6 w-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-l3)' }}>
                    <motion.div className="w-full rounded-full"
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.min(100, (g.players / 70000) * 100)}%` }}
                      style={{ background: col, marginTop: 'auto', position: 'absolute', bottom: 0, left: 0, right: 0 }}/>
                  </div>
                  <ChevronRight size={13} style={{ color: 'var(--t3)' }}/>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ── News feed ──────────────────────────────────────── */}
      {visibleNews.length > 0 && (
        <section className="px-4 mt-5">
          <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--t3)' }}>
            Что нового
          </p>
          <div className="space-y-1.5">
            <AnimatePresence>
              {visibleNews.map((n, i) => {
                const col = n.gameId
                  ? (GENRE_COLOR[GAMES.find(g => g.id === n.gameId)?.genre ?? 'fps'])
                  : 'var(--accent)';
                const TypeIcon = n.type === 'update' ? Zap
                  : n.type === 'drop' ? Gift
                  : n.type === 'collab' ? Handshake
                  : Trophy;
                return (
                  <motion.div key={n.id}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }} transition={{ delay: i * 0.04 }}
                    className="group flex items-start gap-3 rounded-2xl p-3 cursor-pointer relative"
                    style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                    {/* Icon */}
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl"
                      style={{ background: `${col}15`, border: `1px solid ${col}20` }}>
                      <TypeIcon size={14} style={{ color: col }}/>
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-xs font-semibold truncate" style={{ color: 'var(--t1)' }}>{n.title}</p>
                        {n.hot && (
                          <span className="shrink-0 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-black"
                            style={{ background: 'rgba(244,63,94,0.15)', color: '#f43f5e' }}>
                            <Flame size={7}/>HOT
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] line-clamp-1" style={{ color: 'var(--t3)' }}>{n.body}</p>
                    </div>
                    <span className="text-[9px] shrink-0 pt-0.5 tabular-nums" style={{ color: 'var(--t3)' }}>
                      {ago(n.date)}
                    </span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </section>
      )}
    </div>
  );
};
