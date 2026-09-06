import { motion } from 'framer-motion';
import type { Tournament } from '../store';
import { GAMES } from '../store';
import { GENRE_COLOR, countdown, rankCol } from './Primitives';

export const TourneyRow = ({ t, isIn, onJoin, onLeave }: {
  t: Tournament; isIn: boolean; onJoin: () => void; onLeave: () => void;
}) => {
  const game   = GAMES.find(g => g.id === t.gameId);
  const col    = GENRE_COLOR[game?.genre ?? 'fps'];
  const isLive = t.status === 'live';

  return (
    <motion.div className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--bg-l2)', border: `1px solid ${isLive ? col + '40' : 'var(--border)'}` }}>

      {isLive && (
        <div className="flex items-center gap-2 px-4 py-1.5"
          style={{ background: `${col}14`, borderBottom: `1px solid ${col}30` }}>
          <motion.div className="h-1.5 w-1.5 rounded-full" style={{ background: col }}
            animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }}/>
          <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: col }}>Live</span>
          <span className="ml-auto text-[10px]" style={{ color: 'var(--t3)' }}>{t.format}</span>
        </div>
      )}

      <div className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <span className="text-2xl">{game?.cover}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>{t.title}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--t3)' }}>
              {game?.title} · {!isLive && countdown(t.startAt)}
              {t.status === 'finished' && 'Завершён'}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold" style={{ color: 'var(--amber)' }}>{t.prize}</p>
            <p className="text-[9px]" style={{ color: 'var(--t3)' }}>приз</p>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-[10px] mb-1.5">
            <span style={{ color: 'var(--t3)' }}>Участников</span>
            <span style={{ color: t.teamsIn >= t.teamsMax ? '#f43f5e' : 'var(--t1)' }}>
              {t.teamsIn} / {t.teamsMax}
            </span>
          </div>
          <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-l3)' }}>
            <motion.div className="h-full rounded-full"
              initial={{ width: 0 }} animate={{ width: `${(t.teamsIn / t.teamsMax) * 100}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              style={{ background: t.teamsIn >= t.teamsMax ? '#f43f5e' : col }}/>
          </div>
        </div>

        {t.status !== 'finished' && (
          isIn
            ? <button type="button" onClick={onLeave}
                className="w-full rounded-xl py-2 text-xs font-semibold"
                style={{ background: 'rgba(248,113,113,0.08)', color: 'var(--red)', border: '1px solid rgba(248,113,113,0.2)' }}>
                Покинуть турнир
              </button>
            : <button type="button" onClick={onJoin} disabled={t.teamsIn >= t.teamsMax}
                className="w-full rounded-xl py-2 text-xs font-bold text-white disabled:opacity-30"
                style={{ background: t.teamsIn >= t.teamsMax ? 'var(--bg-l3)' : col }}>
                {t.teamsIn >= t.teamsMax ? 'Мест нет' : 'Участвовать'}
              </button>
        )}
      </div>
    </motion.div>
  );
};
