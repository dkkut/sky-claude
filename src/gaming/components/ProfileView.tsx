import React from 'react';
import { motion } from 'framer-motion';
import { Flame, Swords, Trophy, Gamepad2, Clock, TrendingUp, Award } from 'lucide-react';
import { useGamingStore, GAMES, type GameEntry } from '../store';
import { useAuthStore } from '@/core/auth/store';
import { GENRE_COLOR, RANK_GLOW, RankBadge, rankCol, rankGlow, K, countdown } from './Primitives';

const RANK_ORDER = ['Bronze','Silver','Gold','Platinum','Diamond','Master'];

interface Props { onGame: (g: GameEntry) => void }

export const ProfileView = ({ onGame }: Props) => {
  const { myStats, tourneys } = useGamingStore();
  const { accounts, currentUserId } = useAuthStore();
  const me         = accounts.find(a => a.id === currentUserId);
  const stats      = myStats();
  const myT        = tourneys.filter(t => t.participants.includes(currentUserId ?? ''));
  const totalWins  = stats.reduce((a, s) => a + s.wins,  0);
  const totalHours = stats.reduce((a, s) => a + s.hours, 0);
  const totalKills = stats.reduce((a, s) => a + Math.round(s.wins * s.kd), 0);
  const bestStat   = stats.reduce<typeof stats[0] | null>((b, s) =>
    RANK_ORDER.indexOf(s.rank) > RANK_ORDER.indexOf(b?.rank ?? '') ? s : b, null);
  const avgWR      = stats.length > 0 ? Math.round(stats.reduce((a, s) => a + s.winRate, 0) / stats.length) : 0;

  if (stats.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
      <div className="grid h-16 w-16 place-items-center rounded-3xl"
        style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
        <Swords size={28} style={{ color: 'var(--t3)', opacity: 0.5 }}/>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold" style={{ color: 'var(--t2)' }}>Профиль пустой</p>
        <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Перейди в раздел Игры и выбери игру</p>
      </div>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto pb-6" style={{ scrollbarWidth: 'none' }}>

      {/* ── Hero card ────────────────────────────────────── */}
      <div className="mx-4 mt-2 rounded-3xl overflow-hidden"
        style={{ background: 'var(--bg-l2)', border: '1px solid var(--border-m)' }}>

        {/* Banner */}
        {bestStat && (
          <div className="h-16 relative overflow-hidden">
            <div className="absolute inset-0"
              style={{ background: `linear-gradient(135deg,${rankCol(bestStat.rank)}25,${GENRE_COLOR[GAMES.find(g=>g.id===bestStat.gameId)?.genre??'fps']}15)` }}/>
            <div className="absolute inset-0"
              style={{ background: 'radial-gradient(ellipse at 20% 50%,rgba(255,255,255,0.03) 0%,transparent 70%)' }}/>
            {/* Top rank label */}
            <div className="absolute top-2 right-3 flex items-center gap-1.5">
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Лучший ранг
              </span>
              <span className="text-xs font-black" style={{ color: rankCol(bestStat.rank) }}>
                {bestStat.rank}
              </span>
            </div>
          </div>
        )}

        {/* Avatar + name */}
        <div className="px-4 pb-4 -mt-7">
          <div className="flex items-end gap-3 mb-4">
            <motion.div
              animate={bestStat ? {
                boxShadow: [rankGlow(bestStat.rank), `0 0 28px rgba(${RANK_GLOW[bestStat.rank]},0.7)`, rankGlow(bestStat.rank)]
              } : {}}
              transition={{ duration: 2.5, repeat: Infinity }}
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-xl font-black text-white"
              style={{ background: 'linear-gradient(135deg,var(--accent),#8b5cf6)', border: '2px solid rgba(255,255,255,0.12)' }}>
              {me?.name?.[0] ?? '?'}
            </motion.div>
            <div className="pb-0.5 flex-1 min-w-0">
              <p className="text-base font-bold truncate" style={{ color: 'var(--t1)' }}>{me?.name}</p>
              <p className="text-xs truncate" style={{ color: 'var(--t3)' }}>@{me?.username}</p>
            </div>
            {bestStat && <RankBadge rank={bestStat.rank} icon={bestStat.rankIcon}/>}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { Icon: Gamepad2, val: String(stats.length), label: 'Игр',     color: 'var(--accent)' },
              { Icon: Trophy,   val: K(totalWins),         label: 'Побед',   color: 'var(--amber)' },
              { Icon: TrendingUp, val: `${avgWR}%`,        label: 'WR',      color: '#10b981' },
              { Icon: Clock,    val: K(totalHours),        label: 'Часов',   color: 'var(--t2)' },
            ].map(({ Icon, val, label, color }) => (
              <div key={label} className="flex flex-col items-center gap-1 rounded-xl py-2.5"
                style={{ background: 'rgba(255,255,255,0.03)' }}>
                <Icon size={14} style={{ color }}/>
                <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--t1)' }}>{val}</p>
                <p className="text-[8px] uppercase tracking-wide" style={{ color: 'var(--t3)' }}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Per-game stats ───────────────────────────────── */}
      <section className="px-4 mt-4 space-y-2.5">
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>
          Статистика
        </p>
        {stats.map(s => {
          const game   = GAMES.find(g => g.id === s.gameId)!;
          const col    = GENRE_COLOR[game.genre];
          const rankI  = RANK_ORDER.indexOf(s.rank);
          const next   = RANK_ORDER[rankI + 1] ?? 'Master';
          const xpPct  = Math.min(100, (s.xp % 10000) / 100);

          return (
            <motion.div key={s.gameId} whileTap={{ scale: 0.99 }} onClick={() => onGame(game)}
              className="cursor-pointer rounded-2xl overflow-hidden"
              style={{ background: 'var(--bg-l2)', border: `1px solid ${rankCol(s.rank)}20` }}>
              {/* Color accent line */}
              <div className="h-[2px]"
                style={{ background: `linear-gradient(90deg,${col},${rankCol(s.rank)},transparent)` }}/>
              <div className="p-3.5 space-y-3">
                {/* Game info + rank */}
                <div className="flex items-center gap-3">
                  <span className="text-2xl shrink-0" style={{ filter: `drop-shadow(0 0 8px ${col}50)` }}>
                    {game.cover}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>{game.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <RankBadge rank={s.rank} icon={s.rankIcon}/>
                      <span className="text-xs font-bold" style={{ color: rankCol(s.rank) }}>{s.rank}</span>
                      <span className="text-[9px]" style={{ color: 'var(--t3)' }}>→ {next}</span>
                      {s.streak > 2 && (
                        <span className="flex items-center gap-0.5" style={{ color: 'var(--amber)' }}>
                          <Flame size={10}/><span className="text-[10px] font-bold">{s.streak}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-black tabular-nums" style={{ color: col }}>{K(s.xp)} XP</p>
                  </div>
                </div>

                {/* XP progress */}
                <div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-l3)' }}>
                    <motion.div initial={{ width: 0 }} animate={{ width: `${xpPct}%` }}
                      transition={{ duration: 0.9, ease: 'easeOut' }}
                      className="h-full rounded-full"
                      style={{ background: `linear-gradient(90deg,${col}60,${col})` }}/>
                  </div>
                  <p className="text-[9px] mt-1 text-right" style={{ color: 'var(--t3)' }}>
                    {Math.round(xpPct)}% до {next}
                  </p>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-5 gap-1.5">
                  {([
                    [s.wins,          'W',   '#10b981'],
                    [s.losses,        'L',   'var(--red)'],
                    [s.kd.toFixed(1), 'K/D', col],
                    [`${s.winRate}%`, 'WR',  'var(--amber)'],
                    [`${s.hours}ч`,   'Ч',   'var(--t2)'],
                  ] as [string|number, string, string][]).map(([v, l, c]) => (
                    <div key={l} className="flex flex-col items-center gap-0.5 rounded-xl py-2"
                      style={{ background: 'var(--bg-l3)' }}>
                      <p className="text-[11px] font-bold tabular-nums" style={{ color: c }}>{v}</p>
                      <p className="text-[8px] uppercase tracking-wide" style={{ color: 'var(--t3)' }}>{l}</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          );
        })}
      </section>

      {/* ── My tournaments ───────────────────────────────── */}
      {myT.length > 0 && (
        <section className="px-4 mt-4 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>
            Мои турниры
          </p>
          {myT.map(t => {
            const g   = GAMES.find(x => x.id === t.gameId);
            const col = g ? GENRE_COLOR[g.genre] : 'var(--accent)';
            const cfg = {
              live:     { c: '#f43f5e', l: 'Live' },
              upcoming: { c: 'var(--amber)', l: countdown(t.startAt) },
              finished: { c: 'var(--t3)', l: 'Завершён' },
            }[t.status];
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-2xl p-3"
                style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                <span className="text-xl shrink-0">{g?.cover ?? '🏆'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--t1)' }}>{t.title}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>
                    {t.format} · <span style={{ color: 'var(--amber)' }}>{t.prize}</span>
                  </p>
                </div>
                <span className="text-[9px] font-bold rounded-full px-2 py-1"
                  style={{ background: `${cfg.c}15`, color: cfg.c }}>{cfg.l}</span>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
};
