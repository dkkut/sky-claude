import { motion } from 'framer-motion';
import { ChevronLeft, Flame, Zap } from 'lucide-react';
import { useGamingStore, GAMES, GENRE_LABEL, type GameEntry } from '../store';
import { useAuthStore } from '@/core/auth/store';
import { GENRE_COLOR, RankBadge, StatPill, rankCol, rankGlow, K } from './Primitives';
import { TourneyRow } from './TourneyRow';

interface Props { game: GameEntry; onBack: () => void }

export const GamePage = ({ game, onBack }: Props) => {
  const { myStats, tourneys, joinTourney, leaveTourney, sendInvite } = useGamingStore();
  const { accounts, currentUserId } = useAuthStore();
  const stat      = myStats(game.id)[0];
  const col       = GENRE_COLOR[game.genre];
  const friends   = accounts.filter(a => a.id !== currentUserId).slice(0, 4);
  const gTourneys = tourneys.filter(t => t.gameId === game.id);
  const uid       = currentUserId ?? '';

  return (
    <motion.div className="flex h-full flex-col overflow-hidden"
      initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }}>

      {/* Hero-баннер */}
      <div className="relative shrink-0 overflow-hidden" style={{ background: game.gradient }}>
        <div className="absolute inset-0"
          style={{ background: `radial-gradient(ellipse at 20% 50%,${col}40 0%,transparent 60%)` }}/>
        <div className="relative px-5 pt-4 pb-6">
          <button type="button" onClick={onBack}
            className="flex items-center gap-1.5 mb-4 text-xs font-medium"
            style={{ color: 'rgba(255,255,255,0.5)' }}>
            <ChevronLeft size={14}/> Назад
          </button>
          <div className="flex items-end gap-5">
            <motion.div
              className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl text-3xl font-black select-none"
              style={{ background: `${col}20`, border: `2px solid ${col}50`, color: col }}
              animate={{ boxShadow: [`0 0 16px ${col}40`, `0 0 32px ${col}70`, `0 0 16px ${col}40`] }}
              transition={{ duration: 3, repeat: Infinity }}>
              {game.title.slice(0, 2).toUpperCase()}
            </motion.div>
            <div>
              <p className="text-2xl font-bold text-white leading-tight">{game.title}</p>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {game.developer} · {game.releaseYear} · {GENRE_LABEL[game.genre]}
              </p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs text-white font-semibold">{game.format}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4 flex-wrap">
            {game.tags.map(tag => (
              <span key={tag} className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
                style={{ background: `${col}20`, color: col, border: `1px solid ${col}35` }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-6"
          style={{ background: 'linear-gradient(transparent,var(--bg-l1))' }}/>
      </div>

      {/* Тело */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--t2)' }}>{game.description}</p>

        {/* Моя стата */}
        {stat ? (
          <div className="rounded-3xl p-4 space-y-4"
            style={{ background: 'var(--bg-l2)', border: `1px solid ${rankCol(stat.rank)}30` }}>
            <div className="flex items-center gap-3">
              <RankBadge rank={stat.rank} icon={stat.rankIcon} large/>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Мой ранг</p>
                <p className="text-xl font-bold mt-0.5"
                  style={{ color: rankCol(stat.rank), textShadow: rankGlow(stat.rank) }}>
                  {stat.rank}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--t3)' }}>Пик: {stat.peakRank}</p>
              </div>
              {stat.streak > 0 && (
                <div className="flex flex-col items-center gap-0.5">
                  <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
                    <Flame size={22} style={{ color: 'var(--amber)' }}/>
                  </motion.div>
                  <span className="text-[10px] font-bold" style={{ color: 'var(--amber)' }}>{stat.streak}</span>
                </div>
              )}
            </div>
            <div>
              <div className="flex justify-between text-[10px] mb-1.5">
                <span style={{ color: 'var(--t3)' }}>{K(stat.xp)} XP</span>
                <span style={{ color: col }}>До следующего уровня</span>
              </div>
              <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-l3)' }}>
                <motion.div initial={{ width: 0 }}
                  animate={{ width: `${(stat.xp % 10000) / 100}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg,${col}99,${col})` }}/>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <StatPill label="Победы" value={stat.wins}            color="#34d399"/>
              <StatPill label="K/D"    value={stat.kd.toFixed(1)}   color={col}/>
              <StatPill label="WR%"    value={`${stat.winRate}%`}   color="#f59e0b"/>
              <StatPill label="Часов"  value={stat.hours}/>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl p-5 text-center"
            style={{ background: 'var(--bg-l2)', border: '1px dashed var(--border-m)' }}>
            <div className="text-2xl font-black mb-2 h-14 w-14 mx-auto grid place-items-center rounded-2xl" style={{ background: `${col}15`, color: col }}>{game.title.slice(0,2).toUpperCase()}</div>
            <p className="text-sm font-semibold" style={{ color: 'var(--t2)' }}>Вы ещё не играли</p>
            <p className="text-xs mt-1" style={{ color: 'var(--t3)' }}>Статистика появится после первой игры</p>
          </div>
        )}

        {/* Позвать друзей */}
        {friends.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
              Позвать играть
            </p>
            <div className="grid grid-cols-2 gap-2">
              {friends.map(f => (
                <motion.div key={f.id} whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-2.5 rounded-2xl p-2.5"
                  style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                    style={{ background: col + '33', border: `1px solid ${col}50` }}>
                    {f.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--t1)' }}>{f.name}</p>
                    <p className="text-[9px]" style={{ color: 'var(--t3)' }}>@{f.username}</p>
                  </div>
                  <button type="button"
                    onClick={() => sendInvite(f.id, game.id, `Ранговый ${game.format}`)}
                    className="grid h-7 w-7 place-items-center rounded-xl text-white shrink-0"
                    style={{ background: col }}>
                    <Zap size={12}/>
                  </button>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Турниры игры */}
        {gTourneys.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
              Турниры
            </p>
            {gTourneys.map(t => (
              <TourneyRow key={t.id} t={t}
                isIn={t.participants.includes(uid)}
                onJoin={() => joinTourney(t.id)}
                onLeave={() => leaveTourney(t.id)}/>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};
